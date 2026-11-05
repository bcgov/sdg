// A small JSON client for the local scripts. Errors name the call and status, never a token or cookie.
import type { z } from 'zod';

import type { TokenSource } from './tokens.ts';

export interface Reply {
  status: number;
  /** Parsed JSON, or the text when the response is not JSON. */
  body: unknown;
}

/** Extra headers per call, e.g. a bearer token. */
export type HeaderSource = () => Promise<Record<string, string>>;

export interface Api {
  call(method: string, path: string, body?: unknown): Promise<Reply>;
}

export const noHeaders: HeaderSource = () => Promise.resolve({});

export function bearer(source: TokenSource): HeaderSource {
  return async () => ({ authorization: `Bearer ${await source.token()}` });
}

/** A cookie header, e.g. the portal's `portal.sid` session. */
export function cookie(value: string): HeaderSource {
  return () => Promise.resolve({ cookie: value });
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!(response.headers.get('content-type') ?? '').includes('json') || text === '') return text;
  return JSON.parse(text);
}

export function api(base: string, headers: HeaderSource = noHeaders): Api {
  return {
    async call(method, path, body) {
      const sent: Record<string, string> = { accept: 'application/json', ...(await headers()) };
      const init: RequestInit = { method, headers: sent, redirect: 'manual' };
      if (body !== undefined) {
        sent['content-type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      const response = await fetch(`${base}${path}`, init);
      return { status: response.status, body: await readBody(response) };
    },
  };
}

const snippet = (body: unknown): string => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};

/** The reply when its status is one of `expected` (any 2xx when omitted); otherwise throws naming `what`. */
export function expectStatus(reply: Reply, what: string, expected?: readonly number[]): Reply {
  const ok = expected === undefined ? reply.status >= 200 && reply.status < 300 : expected.includes(reply.status);
  if (!ok) {
    const wanted = expected === undefined ? '2xx' : expected.join(' or ');
    throw new Error(`${what}: expected ${wanted}, got ${reply.status} ${snippet(reply.body)}`);
  }
  return reply;
}

/** A successful reply's body, parsed with `schema`. */
export function expectBody<T>(reply: Reply, what: string, schema: z.ZodType<T>, expected?: readonly number[]): T {
  const { body } = expectStatus(reply, what, expected);
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`${what}: unexpected response ${snippet(body)}`);
  return parsed.data;
}
