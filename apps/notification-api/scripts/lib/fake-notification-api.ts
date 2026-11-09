// An in-memory notification-api (and Keycloak token endpoint) behind `fetch`, for the scripts' tests. It answers the
// routes the seed and send scripts call, keeps the state they change and records every call.
import { z } from 'zod';

export interface FakeCredential {
  id: string;
  clientId: string;
  scopedTypes: string[];
}

export interface FakeSender {
  id: string;
  name: string;
  owners: { issuer: string; subject: string }[];
  grantedTypes: string[];
  callbackUrl: string | null;
  credentials: FakeCredential[];
}

export interface FakeTopic {
  id: string;
  key: string;
  name: string;
  scope: 'platform';
  selfSubscribe: boolean;
  broadcasters: string[];
}

export interface FakeState {
  /** Type key → the `channel/language` pairs that have a template. */
  types: Map<string, Set<string>>;
  topics: FakeTopic[];
  senders: Map<string, FakeSender>;
  /** POST /api/v1/notifications bodies. */
  sent: unknown[];
}

export interface FakeCall {
  method: string;
  url: string;
  body: unknown;
}

/** The fake issuer; discovery and the token endpoint answer under it. */
export const FAKE_ISSUER = 'https://keycloak.test/realms/standard';

type Handler = (match: RegExpMatchArray, body: unknown) => Response;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const notFound = (): Response => json(404, { message: 'Not Found' });

const recordSchema = z.record(z.string(), z.unknown());

const field = (body: unknown, name: string): unknown => {
  const parsed = recordSchema.safeParse(body);
  return parsed.success ? parsed.data[name] : undefined;
};

function senderView({ credentials: _, ...sender }: FakeSender): Omit<FakeSender, 'credentials'> {
  return sender;
}

function routes(state: FakeState): [string, RegExp, Handler][] {
  const sender = (id: string | undefined, then: (found: FakeSender) => Response): Response => {
    const found = state.senders.get(id ?? '');
    return found ? then(found) : notFound();
  };
  return [
    [
      'GET',
      /^\/api\/v1\/admin\/types$/,
      () =>
        json(
          200,
          [...state.types.keys()].map((key) => ({ key })),
        ),
    ],
    [
      'POST',
      /^\/api\/v1\/admin\/types$/,
      (_, body) => {
        const key = String(field(body, 'key'));
        if (state.types.has(key)) return json(409, { message: 'exists' });
        state.types.set(key, new Set());
        return json(201, { key });
      },
    ],
    [
      'GET',
      /^\/api\/v1\/admin\/types\/([^/]+)\/templates$/,
      ([, key]) => {
        const templates = state.types.get(key ?? '');
        if (!templates) return notFound();
        const list = [...templates].map((pair) => {
          const [channel, language] = pair.split('/');
          return { channel, language };
        });
        return json(200, list);
      },
    ],
    [
      'POST',
      /^\/api\/v1\/admin\/types\/([^/]+)\/templates\/([^/]+)\/([^/]+)\/versions$/,
      ([, key, channel, language]) => {
        const templates = state.types.get(key ?? '');
        if (!templates) return notFound();
        templates.add(`${channel}/${language}`);
        return json(201, { typeKey: key, channel, language });
      },
    ],
    ['GET', /^\/api\/v1\/admin\/topics$/, () => json(200, state.topics)],
    [
      'POST',
      /^\/api\/v1\/admin\/topics$/,
      (_, body) => {
        const topic: FakeTopic = {
          id: crypto.randomUUID(),
          key: String(field(body, 'key')),
          name: String(field(body, 'name')),
          scope: 'platform',
          selfSubscribe: field(body, 'selfSubscribe') === true,
          broadcasters: [],
        };
        state.topics.push(topic);
        return json(201, topic);
      },
    ],
    [
      'PUT',
      /^\/api\/v1\/admin\/topics\/([^/]+)\/broadcasters\/([^/]+)$/,
      ([, topicId, senderId]) => {
        const topic = state.topics.find((candidate) => candidate.id === topicId);
        if (!topic || !state.senders.has(senderId ?? '')) return notFound();
        if (!topic.broadcasters.includes(senderId ?? '')) topic.broadcasters.push(senderId ?? '');
        return json(200, topic);
      },
    ],
    [
      'POST',
      /^\/api\/v1\/admin\/senders$/,
      (_, body) => {
        const created: FakeSender = {
          id: crypto.randomUUID(),
          name: String(field(body, 'name')),
          owners: [],
          grantedTypes: [],
          callbackUrl: null,
          credentials: [],
        };
        state.senders.set(created.id, created);
        return json(201, senderView(created));
      },
    ],
    [
      'POST',
      /^\/api\/v1\/admin\/senders\/([^/]+)\/owners$/,
      ([, id], body) =>
        sender(id, (found) => {
          found.owners.push({ issuer: String(field(body, 'issuer')), subject: String(field(body, 'subject')) });
          return json(200, senderView(found));
        }),
    ],
    [
      'PUT',
      /^\/api\/v1\/admin\/senders\/([^/]+)\/grants\/([^/]+)$/,
      ([, id, typeKey]) =>
        sender(id, (found) => {
          if (!found.grantedTypes.includes(typeKey ?? '')) found.grantedTypes.push(typeKey ?? '');
          return json(200, senderView(found));
        }),
    ],
    ['GET', /^\/api\/v1\/senders\/([^/]+)$/, ([, id]) => sender(id, (found) => json(200, senderView(found)))],
    [
      'PUT',
      /^\/api\/v1\/senders\/([^/]+)\/callback$/,
      ([, id], body) =>
        sender(id, (found) => {
          found.callbackUrl = String(field(body, 'url'));
          return json(200, { url: found.callbackUrl, secret: 'whsec_fake' });
        }),
    ],
    [
      'GET',
      /^\/api\/v1\/senders\/([^/]+)\/credentials$/,
      ([, id]) => sender(id, (found) => json(200, found.credentials)),
    ],
    [
      'POST',
      /^\/api\/v1\/senders\/([^/]+)\/credentials$/,
      ([, id], body) =>
        sender(id, (found) => {
          const credential = { id: crypto.randomUUID(), clientId: String(field(body, 'clientId')), scopedTypes: [] };
          found.credentials.push(credential);
          return json(201, credential);
        }),
    ],
    [
      'PUT',
      /^\/api\/v1\/senders\/([^/]+)\/credentials\/([^/]+)\/scopes$/,
      ([, id, credentialId], body) =>
        sender(id, (found) => {
          const credential = found.credentials.find((candidate) => candidate.id === credentialId);
          if (!credential) return notFound();
          credential.scopedTypes = z.array(z.string()).parse(field(body, 'typeKeys'));
          return json(200, credential);
        }),
    ],
    [
      'POST',
      /^\/api\/v1\/notifications$/,
      (_, body) => {
        state.sent.push(body);
        return json(202, { notificationId: crypto.randomUUID(), status: 'accepted' });
      },
    ],
  ];
}

/** Keycloak discovery and a client-credentials token endpoint for FAKE_ISSUER. */
function keycloak(url: URL): Response | undefined {
  if (url.href === `${FAKE_ISSUER}/.well-known/openid-configuration`) {
    return json(200, { issuer: FAKE_ISSUER, token_endpoint: `${FAKE_ISSUER}/token` });
  }
  if (url.href === `${FAKE_ISSUER}/token`) {
    return json(200, { access_token: 'credential-token', token_type: 'Bearer', expires_in: 300 });
  }
  return undefined;
}

export interface FakeNotificationApi {
  state: FakeState;
  calls: FakeCall[];
  /** `METHOD /path` of every call that isn't a GET: what a run changed. */
  writes(): string[];
  fetch: typeof fetch;
}

export function fakeNotificationApi(): FakeNotificationApi {
  const state: FakeState = { types: new Map(), topics: [], senders: new Map(), sent: [] };
  const calls: FakeCall[] = [];
  const table = routes(state);
  const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url: url.href, body });
    const identity = keycloak(url);
    if (identity) return Promise.resolve(identity);
    for (const [routeMethod, pattern, handle] of table) {
      const match = url.pathname.match(pattern);
      if (match && routeMethod === method) return Promise.resolve(handle(match, body));
    }
    return Promise.resolve(notFound());
  };
  return {
    state,
    calls,
    writes: () =>
      calls
        .filter((call) => call.method !== 'GET' && !call.url.startsWith(FAKE_ISSUER))
        .map((call) => `${call.method} ${new URL(call.url).pathname}`),
    fetch: fakeFetch,
  };
}

const jwtPart = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An unsigned JWT naming `iss` and `sub`, enough for personOf(). */
export function fakeJwt(issuer: string, subject: string): string {
  return `${jwtPart({ alg: 'none' })}.${jwtPart({ iss: issuer, sub: subject })}.`;
}
