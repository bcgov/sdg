import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { OidcTokens } from '@repo/auth';
import type supertest from 'supertest';

import type { TestApp } from './app.js';

/** One request the stand-in notification-api received. */
export interface Received {
  method: string;
  url: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: string;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface Upstream {
  url: string;
  received: Received[];
  respond: { with: Handler };
  server: Server;
}

export const json: Handler = (_req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ items: [] }));
};

/** A stand-in notification-api on a loopback port that records every request it receives. */
export async function startUpstream(): Promise<Upstream> {
  const received: Received[] = [];
  const respond = { with: json };
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({
        method: req.method ?? '',
        url: req.url ?? '',
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
      });
      respond.with(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('upstream did not bind a TCP port');
  // The trailing slash also checks that portal-api strips it from NOTIFICATION_API_URL.
  return { url: `http://127.0.0.1:${address.port}/`, received, respond, server };
}

export function tokens(overrides: Partial<OidcTokens> = {}): OidcTokens {
  return {
    idToken: 'id-token',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: null,
    ...overrides,
  };
}

/** Signs in through the stubbed login flow with the given session tokens. */
export async function signIn(t: TestApp, sessionTokens: OidcTokens = tokens()): Promise<supertest.Agent> {
  t.oidc.handleCallback.mockResolvedValue({
    user: {
      issuer: 'https://keycloak.example.com/realms/portal',
      subject: 'sub-1',
      name: 'Ada',
      email: null,
      emailVerified: false,
      username: null,
      claims: {},
    },
    tokens: sessionTokens,
  });
  const agent = t.http();
  await agent.get('/api/auth/login');
  await agent.get('/api/auth/callback').query({ code: 'code-1', state: 'state-1' });
  return agent;
}
