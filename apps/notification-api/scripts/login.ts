// `pnpm --filter notification-api --silent login`: signs a person in to notification-api's own Keycloak client with
// authorization code + PKCE (S256) on a localhost callback, then prints their access token to stdout (nothing else
// goes to stdout). The token is short-lived; use it for admin and sender-owner calls, e.g.
//   export NOTIFICATION_ADMIN_TOKEN="$(pnpm --filter notification-api --silent login)"
// seed.ts and e2e.ts call login() themselves when NOTIFICATION_ADMIN_TOKEN is unset, and refresh the token as needed.
//
// Reads apps/notification-api/.env (the process env wins):
//   KEYCLOAK_ISSUER_URL         the realm (https)
//   NOTIFICATION_CLIENT_ID      notification-api's own client; an admin needs its `admin` client role
//   NOTIFICATION_CLIENT_SECRET  that client's secret; leave blank for a public client
//   NOTIFICATION_LOGIN_PORT     callback port (default 8400); register http://localhost:<port>/callback on the client
// Exit code 0: signed in and printed the token. 1: missing settings, sign-in failed or timed out (5 minutes).
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import * as client from 'openid-client';

import { exitWithError, loadAppEnv, optionalEnv, requiredEnv } from './lib/env.ts';
import { discover, refreshingToken, type TokenSource } from './lib/tokens.ts';

const LOGIN_TIMEOUT_MS = 5 * 60_000;

type TokenResponse = client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;

interface PendingLogin {
  config: client.Configuration;
  redirectUri: string;
  codeVerifier: string;
  state: string;
  nonce: string;
}

async function startLogin(): Promise<{ pending: PendingLogin; authorizationUrl: URL; port: number }> {
  const issuer = requiredEnv('KEYCLOAK_ISSUER_URL');
  const clientId = requiredEnv('NOTIFICATION_CLIENT_ID');
  const port = Number(optionalEnv('NOTIFICATION_LOGIN_PORT', '8400'));
  const config = await discover(issuer, clientId, optionalEnv('NOTIFICATION_CLIENT_SECRET'));
  const pending: PendingLogin = {
    config,
    redirectUri: `http://localhost:${port}/callback`,
    codeVerifier: client.randomPKCECodeVerifier(),
    state: client.randomState(),
    nonce: client.randomNonce(),
  };
  const authorizationUrl = client.buildAuthorizationUrl(config, {
    redirect_uri: pending.redirectUri,
    response_type: 'code',
    scope: 'openid profile email',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(pending.codeVerifier),
    code_challenge_method: 'S256',
  });
  return { pending, authorizationUrl, port };
}

/** Opens the URL in the default browser; when that fails the URL printed on stderr still works. */
function openBrowser(url: URL): void {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url.href], { stdio: 'ignore', detached: true });
  child.on('error', (error) => console.error(`login: could not open a browser (${error.message}); open the URL above`));
  child.unref();
}

/** Exchanges the callback's code for tokens, answering the browser either way. */
async function exchange(pending: PendingLogin, url: URL, res: ServerResponse): Promise<TokenResponse> {
  try {
    const tokens = await client.authorizationCodeGrant(pending.config, url, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: pending.state,
      expectedNonce: pending.nonce,
    });
    res.writeHead(200, { 'content-type': 'text/plain' }).end('Signed in. You can close this tab.');
    return tokens;
  } catch (error) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('Sign-in failed; see the terminal.');
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Exchanging the authorization code failed: ${reason}`, { cause: error });
  }
}

/**
 * Both loopback addresses: `localhost` resolves to either, and binding the name alone takes only the first (::1 on
 * macOS), so a browser that connects to 127.0.0.1 would find nothing listening.
 */
const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

/** A host without that address family (e.g. no IPv6), which is skipped rather than fatal. */
const MISSING_FAMILY = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

/**
 * Listens on every loopback address. Any other error (e.g. the port is taken on one of them, where the browser could
 * reach someone else's server) fails the sign-in, as does having no address at all.
 */
function listenOnLoopback(servers: readonly Server[], port: number, fail: (error: Error) => void): void {
  let missing = 0;
  servers.forEach((server, index) => {
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (MISSING_FAMILY.has(error.code ?? '') && (missing += 1) < servers.length) return;
      fail(new Error(`The callback server failed on ${LOOPBACK_HOSTS[index]}:${port}: ${error.message}`));
    });
    server.listen(port, LOOPBACK_HOSTS[index]);
  });
}

/** Serves /callback once, exchanging the code for tokens. */
function awaitCallback(pending: PendingLogin, port: number): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    let servers: Server[] = [];
    const finish = (error: unknown, tokens?: TokenResponse): void => {
      clearTimeout(timer);
      for (const server of servers) server.close();
      if (tokens) resolve(tokens);
      else reject(error instanceof Error ? error : new Error(String(error)));
    };
    const timer = setTimeout(() => finish(new Error('Timed out waiting for the sign-in callback')), LOGIN_TIMEOUT_MS);
    const handle = (req: IncomingMessage, res: ServerResponse): void => {
      const url = new URL(req.url ?? '/', pending.redirectUri);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      void (async () => {
        try {
          finish(undefined, await exchange(pending, url, res));
        } catch (error) {
          finish(error);
        }
      })();
    };
    servers = LOOPBACK_HOSTS.map(() => createServer(handle));
    listenOnLoopback(servers, port, finish);
  });
}

/** Signs the developer in through the browser. The source refreshes the access token when it nears expiry. */
export async function login(): Promise<TokenSource> {
  const { pending, authorizationUrl, port } = await startLogin();
  console.error(`login: sign in to notification-api in your browser:\n  ${authorizationUrl.href}`);
  openBrowser(authorizationUrl);
  const tokens = await awaitCallback(pending, port);
  return refreshingToken(pending.config, tokens);
}

if (import.meta.main) {
  process.on('unhandledRejection', exitWithError('login'));
  loadAppEnv();
  try {
    const source = await login();
    process.stdout.write(`${await source.token()}\n`);
  } catch (error) {
    exitWithError('login')(error);
  }
}
