import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK, type JWTPayload } from 'jose';
import { calculatePKCECodeChallenge } from 'openid-client';

export const CLIENT_ID = 'portal';
export const CLIENT_SECRET = 'test-secret';

interface IssuedCode {
  nonce: string;
  /** `code_challenge` from the authorization URL; the token request's verifier must match it (S256). */
  codeChallenge: string;
  claims: JWTPayload;
}

export interface SignOptions {
  alg?: string;
  kid?: string;
  expiresIn?: string | number;
  issuer?: string;
  audience?: string;
}

/** In-process OpenID Provider on an ephemeral loopback port, for tests only. */
export interface FakeIdp {
  issuer: string;
  /** Counts `/.well-known/openid-configuration` requests. */
  discoveryRequests: number;
  /** When true, discovery responds 500. */
  failDiscovery: boolean;
  issueCode(code: IssuedCode): string;
  sign(claims: JWTPayload, options?: SignOptions): Promise<string>;
  close(): Promise<void>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function metadata(issuer: string): Record<string, unknown> {
  return {
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    end_session_endpoint: `${issuer}/logout`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
  };
}

export async function startFakeIdp(): Promise<FakeIdp> {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, IssuedCode>();
  let counter = 0;

  const idp: FakeIdp = {
    issuer: '',
    discoveryRequests: 0,
    failDiscovery: false,
    issueCode(code) {
      counter += 1;
      const value = `code-${counter}`;
      codes.set(value, code);
      return value;
    },
    sign: (claims, options = {}) => signToken(privateKey, idp.issuer, claims, options),
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };

  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = await readForm(req);
    const issued = codes.get(form.get('code') ?? '');
    codes.delete(form.get('code') ?? '');
    if (form.get('client_id') !== CLIENT_ID || form.get('client_secret') !== CLIENT_SECRET) {
      return sendJson(res, 401, { error: 'invalid_client' });
    }
    const challenge = await calculatePKCECodeChallenge(form.get('code_verifier') ?? '');
    if (issued?.codeChallenge !== challenge) {
      return sendJson(res, 400, { error: 'invalid_grant' });
    }
    const idToken = await signToken(privateKey, idp.issuer, { nonce: issued.nonce, ...issued.claims }, {});
    sendJson(res, 200, {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      id_token: idToken,
      token_type: 'Bearer',
      expires_in: 300,
    });
  }

  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/.well-known/openid-configuration') {
      idp.discoveryRequests += 1;
      return idp.failDiscovery ? sendJson(res, 500, { error: 'down' }) : sendJson(res, 200, metadata(idp.issuer));
    }
    if (path === '/jwks') return sendJson(res, 200, { keys: [publicJwk] });
    if (path === '/token' && req.method === 'POST') {
      token(req, res).catch((error: unknown) => {
        console.error('fake idp token endpoint failed', error);
        sendJson(res, 500, { error: 'server_error' });
      });
      return;
    }
    sendJson(res, 404, { error: 'not_found' });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('fake idp did not bind a TCP port');
  idp.issuer = `http://127.0.0.1:${address.port}`;
  return idp;
}

function signToken(key: CryptoKey, issuer: string, claims: JWTPayload, options: SignOptions): Promise<string> {
  // Explicit claims (e.g. a wrong `aud`) win over the defaults.
  return new SignJWT({ iss: options.issuer ?? issuer, aud: options.audience ?? CLIENT_ID, ...claims })
    .setProtectedHeader({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'k1' })
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(key);
}
