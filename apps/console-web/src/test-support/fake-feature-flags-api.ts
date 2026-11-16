import { vi } from 'vitest';

import {
  FEATURE_FLAGS_PATH,
  FLAG_HISTORY_PATH,
  FLAG_KEY_PATTERN,
  isAudience,
  PEOPLE_SEARCH_PATH,
  type Audience,
  type EventChanges,
  type FieldValue,
  type FlagDetail,
  type FlagEvent,
  type FlagEventAction,
  type FlagOverride,
  type FlagSummary,
  type Person,
  type PersonKind,
} from '../api/feature-flags';
import { ADMIN, fakeConsoleApi, nestError, type FakeConsoleApi, type RecordedCall } from './fake-console-api';
import { flagHistoryPage, flagListPage } from './fake-feature-flag-list';

const T0 = Date.parse('2026-11-10T17:00:00.000Z');
const SEARCH_LIMIT = 20;
const FIELDS = ['description', 'enabled', 'rolloutPct', 'audience'] as const;
/** core-api records `rolloutPct` under its column name. */
const COLUMN: Readonly<Record<string, string>> = { rolloutPct: 'rollout_pct' };

let nextPerson = 1;

/** A person who signed in; residents sign in to the portal, console users to the console. */
export function person(displayName: string, kind: PersonKind, overrides: Partial<Person> = {}): Person {
  const principalId = `00000000-0000-4000-8000-${String(nextPerson++).padStart(12, '0')}`;
  const email = `${displayName.toLowerCase().replaceAll(/[^a-z]+/g, '.')}@example.test`;
  return { principalId, displayName, email, kind, lastSignInAt: new Date(T0).toISOString(), ...overrides };
}

export const overrideFor = (who: Person, enabled: boolean): FlagOverride => ({
  principalId: who.principalId,
  name: who.displayName,
  email: who.email,
  kind: who.kind,
  enabled,
});

const countsOf = (overrides: readonly FlagOverride[]) => ({
  on: overrides.filter(({ enabled }) => enabled).length,
  off: overrides.filter(({ enabled }) => !enabled).length,
});

/** A stored flag; its override counts always follow its overrides. */
export function flag(key: string, fields: Partial<Omit<FlagDetail, 'key' | 'overrideCounts'>> = {}): FlagDetail {
  const overrides = fields.overrides ?? [];
  const base = { description: null, enabled: false, rolloutPct: 100, audience: 'portal' as const };
  return { key, ...base, ...fields, overrides, overrideCounts: countsOf(overrides) };
}

const summaryOf = ({ overrides: _overrides, ...summary }: FlagDetail): FlagSummary => summary;

export function flagEvent(
  id: number,
  flagKey: string,
  action: FlagEventAction,
  changes: EventChanges = {},
  subject: FlagEvent['subject'] = null,
): FlagEvent {
  const createdAt = new Date(T0 + id * 60_000).toISOString();
  return { id, flagKey, action, actor: { principalId: ADMIN.id, name: ADMIN.name }, subject, changes, createdAt };
}

const inAudience = (audience: Audience, kind: PersonKind) =>
  audience === 'both' || (audience === 'portal' ? kind === 'resident' : kind === 'console-user');

type Body = Record<string, unknown>;
type EditableFields = Partial<Pick<FlagDetail, (typeof FIELDS)[number]>>;
type ChangedField = { from: FieldValue; to: FieldValue };

const isBody = (value: unknown): value is Body => typeof value === 'object' && value !== null;

/** The editable fields a request body sets, read the way core-api's schema reads them. */
function fieldsOf(body: Body): EditableFields {
  const { description, enabled, rolloutPct, audience } = body;
  return {
    ...(typeof description === 'string' || description === null ? { description } : {}),
    ...(typeof enabled === 'boolean' ? { enabled } : {}),
    ...(typeof rolloutPct === 'number' && Number.isInteger(rolloutPct) ? { rolloutPct } : {}),
    ...(isAudience(audience) ? { audience } : {}),
  };
}
type Refusal = { method: string; path: string; respond: () => Response | Promise<Response> };

interface Init {
  flags?: FlagDetail[];
  people?: Person[];
  events?: FlagEvent[];
  consoleApi?: FakeConsoleApi;
}

const notFound = (message: string) => nestError(404, message, 'Not Found');
const missingFlag = (key: string) => notFound(`No feature flag ${key} exists`);
const noContent = () => new Response(null, { status: 204 });

/**
 * core-api's console feature-flag routes, in memory, in front of a FakeConsoleApi (which answers everything else and
 * owns the session): 409 on a duplicate key, 404 on a missing flag or override, overrides only for people in the
 * flag's audience, the list paged and the history a cursor page newest first (kept after a delete), and people search
 * capped at 20 with `more`.
 */
/** A fetch input's URL, whichever form it came in. */
function hrefOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

export class FakeFeatureFlagsApi {
  flags: FlagDetail[];
  people: Person[];
  events: FlagEvent[];
  readonly consoleApi: FakeConsoleApi;
  readonly calls: RecordedCall[] = [];
  private readonly refusals: Refusal[] = [];

  constructor({ flags = [], people = [], events = [], consoleApi = fakeConsoleApi() }: Init = {}) {
    this.flags = [...flags];
    this.people = [...people];
    this.events = [...events];
    this.consoleApi = consoleApi;
    const delegate = consoleApi.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input, init) => this.handle(input, init, delegate)),
    );
  }

  /** The next matching call (exact path, no query) answers `respond()` instead; nothing changes. */
  refuseNext(method: string, path: string, respond: Refusal['respond']): void {
    this.refusals.push({ method, path, respond });
  }

  callsTo(method: string, path: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && call.path.split('?')[0] === path);
  }

  find(key: string): FlagDetail | undefined {
    return this.flags.find((stored) => stored.key === key);
  }

  private has(key: string): boolean {
    return this.flags.some((stored) => stored.key === key);
  }

  private async handle(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    delegate: typeof fetch,
  ): Promise<Response> {
    const url = new URL(hrefOf(input), 'https://console.example.test');
    const isOurs = [FEATURE_FLAGS_PATH, FLAG_HISTORY_PATH, PEOPLE_SEARCH_PATH].some((path) =>
      url.pathname.startsWith(path),
    );
    if (!isOurs) return delegate(input, init);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, path: `${url.pathname}${url.search}`, body });
    if (!this.consoleApi.signedIn) return nestError(401, 'Unauthorized');
    const refusal = this.refusals.findIndex((r) => r.method === method && r.path === url.pathname);
    if (refusal >= 0) return this.refusals.splice(refusal, 1)[0]!.respond();
    return this.route(method, url, isBody(body) ? body : {});
  }

  private route(method: string, url: URL, body: Body): Response {
    const { pathname } = url;
    if (pathname === FEATURE_FLAGS_PATH && method === 'GET') {
      return Response.json(flagListPage(this.flags.map(summaryOf), url.searchParams));
    }
    if (pathname === FEATURE_FLAGS_PATH && method === 'POST') return this.create(body);
    if (pathname === FLAG_HISTORY_PATH && method === 'GET') {
      return Response.json(flagHistoryPage(this.events, url.searchParams));
    }
    if (pathname === PEOPLE_SEARCH_PATH && method === 'POST') return this.search(body);
    const match = /^\/api\/v1\/console\/feature-flags\/([^/]+)(?:\/overrides\/([^/]+))?$/.exec(pathname);
    if (!match) return notFound(`Cannot ${method} ${pathname}`);
    const key = decodeURIComponent(match[1]!);
    if (!this.has(key)) return missingFlag(key);
    if (match[2]) return this.overrideRoute(method, key, decodeURIComponent(match[2]), body);
    if (method === 'GET') return Response.json(this.find(key));
    if (method === 'PATCH') return this.update(key, body);
    if (method === 'DELETE') return this.remove(key);
    return notFound(`Cannot ${method} ${pathname}`);
  }

  private overrideRoute(method: string, key: string, principalId: string, body: Body): Response {
    if (method === 'PUT') return this.setOverride(key, principalId, body['enabled'] === true);
    if (method === 'DELETE') return this.removeOverride(key, principalId);
    return notFound(`Cannot ${method}`);
  }

  private record(flagKey: string, action: FlagEventAction, changes: EventChanges, subject?: Person): void {
    const id = Math.max(0, ...this.events.map((event) => event.id)) + 1;
    const about = subject ? { principalId: subject.principalId, name: subject.displayName } : null;
    this.events.push(flagEvent(id, flagKey, action, changes, about));
  }

  private save(next: FlagDetail): FlagDetail {
    const stored = flag(next.key, next);
    this.flags = [...this.flags.filter(({ key }) => key !== next.key), stored];
    return stored;
  }

  /** The `{ column: { from, to } }` of each field in `body` that differs from `current`. */
  private changesOf(current: Partial<FlagDetail>, next: EditableFields): Record<string, ChangedField> {
    const changes: Record<string, ChangedField> = {};
    for (const field of FIELDS) {
      const to = next[field];
      if (to === undefined || to === current[field]) continue;
      changes[COLUMN[field] ?? field] = { from: current[field] ?? null, to };
    }
    return changes;
  }

  private create(body: Body): Response {
    const key = String(body['key']);
    if (!FLAG_KEY_PATTERN.test(key)) return nestError(400, ['key: Must start with a lower-case letter'], 'Bad Request');
    if (this.has(key)) return nestError(409, `Feature flag ${key} already exists`, 'Conflict');
    const created = this.save(flag(key, fieldsOf(body)));
    this.record(key, 'created', this.changesOf({}, created));
    return Response.json(summaryOf(created), { status: 201 });
  }

  private update(key: string, body: Body): Response {
    const current = this.find(key)!;
    const fields = fieldsOf(body);
    const changes = this.changesOf(current, fields);
    const updated = this.save({ ...current, ...fields });
    if (Object.keys(changes).length > 0) this.record(key, 'updated', changes);
    return Response.json(summaryOf(updated));
  }

  private remove(key: string): Response {
    const overridesRemoved = this.find(key)!.overrides.length;
    this.flags = this.flags.filter((stored) => stored.key !== key);
    this.record(key, 'deleted', { overridesRemoved });
    return noContent();
  }

  private setOverride(key: string, principalId: string, enabled: boolean): Response {
    const current = this.find(key)!;
    const who = this.people.find((p) => p.principalId === principalId);
    if (!who || !inAudience(current.audience, who.kind)) return notFound(`No one with principal id ${principalId}`);
    const existing = current.overrides.find((o) => o.principalId === principalId);
    const overrides = current.overrides.filter((o) => o.principalId !== principalId);
    const set = overrideFor(who, enabled);
    const sorted = [...overrides, set].toSorted((a, b) => (a.name < b.name ? -1 : 1));
    this.save({ ...current, overrides: sorted });
    if (existing?.enabled !== enabled) {
      this.record(key, 'override_set', { enabled: { from: existing?.enabled ?? null, to: enabled } }, who);
    }
    return Response.json(set);
  }

  private removeOverride(key: string, principalId: string): Response {
    const current = this.find(key)!;
    const existing = current.overrides.find((o) => o.principalId === principalId);
    if (!existing) return notFound(`Feature flag ${key} has no override for ${principalId}`);
    this.save({ ...current, overrides: current.overrides.filter((o) => o !== existing) });
    const who = this.people.find((p) => p.principalId === principalId);
    this.record(key, 'override_removed', { enabled: { from: existing.enabled, to: null } }, who);
    return noContent();
  }

  private search(body: Body): Response {
    const query = String(body['query']).trim().toLowerCase();
    const audience = isAudience(body['audience']) ? body['audience'] : 'portal';
    const matches = this.people
      .filter((p) => inAudience(audience, p.kind))
      .filter((p) => `${p.displayName}\n${p.email ?? ''}`.toLowerCase().includes(query))
      .toSorted((a, b) => (a.displayName < b.displayName ? -1 : 1));
    return Response.json({ results: matches.slice(0, SEARCH_LIMIT), more: matches.length > SEARCH_LIMIT });
  }
}

export function fakeFeatureFlagsApi(init: Init = {}): FakeFeatureFlagsApi {
  return new FakeFeatureFlagsApi(init);
}
