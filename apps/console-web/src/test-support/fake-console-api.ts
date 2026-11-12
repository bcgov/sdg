import { vi } from 'vitest';

import type { ServiceClient, ServiceClientAction, ServiceClientEvent } from '../api/service-clients';

export const ADMIN = { id: '0b6f8d0e-5c43-4a8e-9a43-2f1a3d9e7c11', name: 'Ada Lovelace', email: 'ada@gov.bc.ca' };

const BASE = '/api/v1/console/service-clients';
const T0 = Date.parse('2026-11-01T17:00:00.000Z');

export function serviceClient(clientId: string, overrides: Partial<ServiceClient> = {}): ServiceClient {
  const at = new Date(T0).toISOString();
  return { clientId, displayName: `${clientId} display`, enabled: true, createdAt: at, updatedAt: at, ...overrides };
}

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

type Refusal = { method: string; path: string | RegExp; respond: () => Response | Promise<Response> };

export const nestError = (statusCode: number, message: string | string[], error?: string) =>
  Response.json({ statusCode, message, ...(error ? { error } : {}) }, { status: statusCode });

/** The URL a `fetch` call was made with. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/**
 * An in-memory console-api behind a stubbed `fetch`: the session, the registry and its history behave like
 * core-api's (409 on a duplicate, 404 on a missing client, history newest first with `nextBefore`). `refuseNext`
 * makes the next matching call answer something else, e.g. a 503, without touching the registry.
 */
export class FakeConsoleApi {
  signedIn: boolean;
  clients: ServiceClient[];
  events: ServiceClientEvent[];
  readonly calls: RecordedCall[] = [];
  readonly fetch = vi.fn<typeof fetch>((input, init) => this.handle(input, init));
  private readonly refusals: Refusal[] = [];
  private clock = T0;

  constructor({
    signedIn = true,
    clients = [],
    events = [],
  }: Partial<Pick<FakeConsoleApi, 'signedIn' | 'clients' | 'events'>> = {}) {
    this.signedIn = signedIn;
    this.clients = [...clients];
    this.events = [...events];
    vi.stubGlobal('fetch', this.fetch);
  }

  refuseNext(method: string, path: string | RegExp, respond: Refusal['respond']): void {
    this.refusals.push({ method, path, respond });
  }

  callsTo(method: string, path: string): RecordedCall[] {
    return this.calls.filter((call) => call.method === method && call.path.split('?')[0] === path);
  }

  record(clientId: string, action: ServiceClientAction): void {
    this.clock += 60_000;
    const id = (this.events.at(-1)?.id ?? 0) + 1;
    const createdAt = new Date(this.clock).toISOString();
    this.events.push({ id, clientId, action, actor: { principalId: ADMIN.id, name: ADMIN.name }, createdAt });
  }

  private async handle(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const url = new URL(requestUrl(input), 'https://console.example.test');
    const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    this.calls.push({ method, path: `${url.pathname}${url.search}`, body });
    const refusal = this.refusals.findIndex(
      (r) => r.method === method && (typeof r.path === 'string' ? r.path === url.pathname : r.path.test(url.pathname)),
    );
    if (refusal >= 0) return this.refusals.splice(refusal, 1)[0]!.respond();
    return this.route(method, url, body);
  }

  private route(method: string, url: URL, body: unknown): Response {
    const auth = this.authRoute(method, url.pathname);
    if (auth) return auth;
    if (!this.signedIn) return nestError(401, 'Unauthorized');
    if (url.pathname === BASE && method === 'GET') return Response.json(this.clients);
    if (url.pathname === `${BASE}/history` && method === 'GET') return this.history(url.searchParams);
    if (url.pathname === BASE && method === 'POST') return this.add(body);
    return this.clientRoute(method, url.pathname);
  }

  /** console-api's own /api/auth routes, answered whether or not the administrator is signed in. */
  private authRoute(method: string, pathname: string): Response | undefined {
    if (pathname === '/api/auth/me') {
      return this.signedIn ? Response.json(ADMIN) : nestError(401, 'Unauthorized');
    }
    if (pathname === '/api/auth/logout' && method === 'POST') {
      this.signedIn = false;
      return Response.json({ redirectUrl: '/' });
    }
    return undefined;
  }

  /** `/service-clients/:clientId` (DELETE) and `/service-clients/:clientId/disable|enable` (POST). */
  private clientRoute(method: string, pathname: string): Response {
    const notFound = () => nestError(404, `Cannot ${method} ${pathname}`, 'Not Found');
    const match = /^\/api\/v1\/console\/service-clients\/([^/]+)(?:\/(disable|enable))?$/.exec(pathname);
    if (!match) return notFound();
    const clientId = decodeURIComponent(match[1]!);
    if (!this.clients.some((client) => client.clientId === clientId)) {
      return nestError(404, `No service client ${clientId} is registered`, 'Not Found');
    }
    const toggle = match[2];
    if (method === 'DELETE' && !toggle) return this.remove(clientId);
    if (method === 'POST' && toggle) return this.setEnabled(clientId, toggle === 'enable');
    return notFound();
  }

  private history(query: URLSearchParams): Response {
    const limit = Number(query.get('limit') ?? 50);
    const before = query.has('before') ? Number(query.get('before')) : Infinity;
    const older = this.events.filter((event) => event.id < before).toSorted((a, b) => b.id - a.id);
    const events = older.slice(0, limit);
    return Response.json({ events, nextBefore: older.length > limit ? events.at(-1)!.id : null });
  }

  private add(body: unknown): Response {
    const field = (name: string) => (typeof body === 'object' && body !== null ? String(Reflect.get(body, name)) : '');
    const [clientId, displayName] = [field('clientId'), field('displayName')];
    if (this.clients.some((client) => client.clientId === clientId)) {
      return nestError(409, `Service client ${clientId} is already registered`, 'Conflict');
    }
    const client = serviceClient(clientId, { displayName });
    this.clients = [...this.clients, client].toSorted((a, b) => (a.clientId < b.clientId ? -1 : 1));
    this.record(clientId, 'added');
    return Response.json(client, { status: 201 });
  }

  private setEnabled(clientId: string, enabled: boolean): Response {
    const current = this.clients.find((client) => client.clientId === clientId)!;
    const updated = { ...current, enabled };
    if (current.enabled !== enabled) {
      this.clients = this.clients.map((client) => (client.clientId === clientId ? updated : client));
      this.record(clientId, enabled ? 'enabled' : 'disabled');
    }
    return Response.json(updated);
  }

  private remove(clientId: string): Response {
    this.clients = this.clients.filter((client) => client.clientId !== clientId);
    this.record(clientId, 'removed');
    return new Response(null, { status: 204 });
  }
}

export function fakeConsoleApi(init: ConstructorParameters<typeof FakeConsoleApi>[0] = {}): FakeConsoleApi {
  return new FakeConsoleApi(init);
}
