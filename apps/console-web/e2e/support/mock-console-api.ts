import type { Page, Route } from '@playwright/test';

import { flagHistoryPage, flagListPage } from './mock-flag-pages';

export const admin = { id: '0b6f8d0e-5c43-4a8e-9a43-2f1a3d9e7c11', name: 'Ada Lovelace', email: 'ada@gov.bc.ca' };

const unauthorized = { status: 401, json: { statusCode: 401, message: 'Unauthorized' } };

/**
 * Fakes console-api's /api/auth/me in the browser, so the mocked specs need no API or Keycloak, and the signed-in
 * shell's flag list (no flags on) so it never reaches for a console-api that isn't there. A spec routing
 * `/api/v1/shared/flags` itself afterwards takes precedence.
 */
export async function mockSession(page: Page, signedIn: () => boolean): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    signedIn() ? route.fulfill({ json: admin }) : route.fulfill(unauthorized),
  );
  await page.route('**/api/v1/shared/flags', (route) =>
    signedIn() ? route.fulfill({ json: {} }) : route.fulfill(unauthorized),
  );
}

/** A signed-in administrator with one registered client and its history, all answered in the browser. */
export async function mockRegistry(page: Page): Promise<void> {
  await mockSession(page, () => true);
  const at = '2026-11-02T18:00:00.000Z';
  await page.route('**/api/v1/console/service-clients/history**', (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: 1,
            clientId: 'billing-1',
            action: 'added',
            actor: { principalId: admin.id, name: admin.name },
            createdAt: at,
          },
        ],
        nextBefore: null,
      },
    }),
  );
  await page.route('**/api/v1/console/service-clients', (route) =>
    route.fulfill({
      json: [{ clientId: 'billing-1', displayName: 'Billing', enabled: true, createdAt: at, updatedAt: at }],
    }),
  );
}

/** A flag as console-api answers `GET /api/v1/console/feature-flags/:key` (the list leaves out `overrides`). */
export interface MockFlag {
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPct: number;
  audience: 'portal' | 'console' | 'both';
  overrideCounts: { on: number; off: number };
  overrides: { principalId: string; name: string; email: string | null; kind: string; enabled: boolean }[];
}

/** What the page sent to the faked feature-flag routes. */
export interface FlagRequests {
  creates: unknown[];
  patches: unknown[];
}

export interface FlagEvent {
  id: number;
  flagKey: string;
  action: string;
  actor: { principalId: string; name: string };
  subject: null;
  changes: Record<string, unknown>;
  createdAt: string;
}

const FLAGS_BASE = '/api/v1/console/feature-flags';

/** The fields a request body sets, recorded as core-api records them (`rollout_pct`). */
function changesOf(current: Partial<MockFlag>, body: Partial<MockFlag>): Record<string, unknown> {
  const fields = ['description', 'enabled', 'rolloutPct', 'audience'] as const;
  return Object.fromEntries(
    fields
      .filter((field) => body[field] !== undefined && body[field] !== current[field])
      .map((field) => [
        field === 'rolloutPct' ? 'rollout_pct' : field,
        { from: current[field] ?? null, to: body[field] },
      ]),
  );
}

const isAudience = (value: unknown): value is MockFlag['audience'] =>
  value === 'portal' || value === 'console' || value === 'both';

/** The flag fields a request body carries, typed. */
function flagBody(value: unknown): Partial<MockFlag> {
  if (typeof value !== 'object' || value === null) return {};
  const get = (name: string): unknown => Reflect.get(value, name);
  const [key, description, enabled, rolloutPct, audience] = [
    'key',
    'description',
    'enabled',
    'rolloutPct',
    'audience',
  ].map(get);
  return {
    ...(typeof key === 'string' ? { key } : {}),
    ...(typeof description === 'string' || description === null ? { description } : {}),
    ...(typeof enabled === 'boolean' ? { enabled } : {}),
    ...(typeof rolloutPct === 'number' ? { rolloutPct } : {}),
    ...(isAudience(audience) ? { audience } : {}),
  };
}

/** The in-memory flags and history behind the faked routes, and what the page sent them. */
class FlagStore {
  readonly flags: Map<string, MockFlag>;
  readonly requests: FlagRequests = { creates: [], patches: [] };
  readonly events: FlagEvent[];

  constructor(initial: MockFlag[], events: FlagEvent[]) {
    this.flags = new Map(initial.map((flag) => [flag.key, flag]));
    this.events = events;
  }

  record(flagKey: string, action: string, changes: Record<string, unknown>): void {
    const id = this.events.length + 1;
    const createdAt = new Date(Date.parse('2026-11-10T17:00:00.000Z') + id * 60_000).toISOString();
    const actor = { principalId: admin.id, name: admin.name };
    this.events.push({ id, flagKey, action, actor, subject: null, changes, createdAt });
  }

  create(body: Partial<MockFlag>): MockFlag {
    this.requests.creates.push(body);
    const created: MockFlag = {
      description: null,
      ...body,
      key: String(body.key),
      enabled: body.enabled ?? false,
      rolloutPct: body.rolloutPct ?? 100,
      audience: body.audience ?? 'portal',
      overrideCounts: { on: 0, off: 0 },
      overrides: [],
    };
    this.flags.set(created.key, created);
    this.record(created.key, 'created', changesOf({}, created));
    return created;
  }

  update(current: MockFlag, body: Partial<MockFlag>): MockFlag {
    this.requests.patches.push(body);
    this.record(current.key, 'updated', changesOf(current, body));
    const updated = { ...current, ...body };
    this.flags.set(current.key, updated);
    return updated;
  }
}

const summary = ({ overrides: _overrides, ...rest }: MockFlag) => rest;

/** `/api/v1/console/feature-flags` (GET, POST) and `/feature-flags/:key` (GET, PATCH). */
function answerFlagRoute(route: Route, store: FlagStore): Promise<void> {
  const request = route.request();
  const key = decodeURIComponent(new URL(request.url()).pathname.slice(FLAGS_BASE.length + 1));
  const body = flagBody(request.postDataJSON());
  if (key === '' && request.method() === 'POST') {
    return route.fulfill({ status: 201, json: summary(store.create(body)) });
  }
  if (key === '') {
    const query = new URL(request.url()).searchParams;
    return route.fulfill({ json: flagListPage([...store.flags.values()].map(summary), query) });
  }
  const current = store.flags.get(key);
  if (!current) return route.fulfill({ status: 404, json: { statusCode: 404, message: `No feature flag ${key}` } });
  if (request.method() === 'PATCH') return route.fulfill({ json: summary(store.update(current, body)) });
  return route.fulfill({ json: current });
}

/**
 * A signed-in administrator with console-api's feature-flag routes answered in memory: the paged list, create, read,
 * edit and the cursor-paged history (no people match a search); `events` is history for flags that may no longer
 * exist. Returns the bodies the page sent.
 */
export async function mockFeatureFlagsAdmin(
  page: Page,
  initial: MockFlag[],
  events: FlagEvent[] = [],
): Promise<FlagRequests> {
  await mockSession(page, () => true);
  const store = new FlagStore(initial, events);
  await page.route('**/api/v1/console/feature-flag-history**', (route) =>
    route.fulfill({ json: flagHistoryPage(store.events, new URL(route.request().url()).searchParams) }),
  );
  await page.route('**/api/v1/console/people/search', (route) => route.fulfill({ json: { results: [], more: false } }));
  await page.route(
    (url) => url.pathname === FLAGS_BASE || url.pathname.startsWith(`${FLAGS_BASE}/`),
    (route) => answerFlagRoute(route, store),
  );
  return store.requests;
}
