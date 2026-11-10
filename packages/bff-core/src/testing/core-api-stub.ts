import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

/** The principal every accepted sign-in gets from the stub. */
export const PRINCIPAL_ID = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5d6e';
/** The profile core-api answers a sign-in with: Keycloak userinfo's, which may differ from the ID token's claims. */
export const CORE_API_PROFILE: { readonly name: string; readonly email: string | null } = {
  name: 'Ada King, Countess of Lovelace',
  email: 'ada.king@example.com',
};

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export type StubResponder = (req: IncomingMessage, res: ServerResponse) => void;

/** A stand-in for core-api on a loopback port: records every request and answers with `respond`. */
export interface CoreApiStub {
  url: string;
  received: ReceivedRequest[];
  respond: StubResponder;
  reset(): void;
  close(): Promise<void>;
}

export const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): StubResponder =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

/** Drops the connection, as an unreachable core-api would. */
export const unreachable: StubResponder = (req) => req.socket.destroy();

/** Accepts every principal login, answering as core-api does, and echoes forwarded calls. */
const defaultRespond: StubResponder = (req, res) => {
  if (req.url === '/internal/principals/login') {
    return json(200, { principalId: PRINCIPAL_ID, ...CORE_API_PROFILE })(req, res);
  }
  return json(200, { forwarded: req.url }, { 'set-cookie': 'core=1' })(req, res);
};

/** Starts a {@link CoreApiStub} on a free loopback port. */
export async function startCoreApiStub(): Promise<CoreApiStub> {
  const stub: CoreApiStub = {
    url: '',
    received: [],
    respond: defaultRespond,
    reset() {
      stub.received.length = 0;
      stub.respond = defaultRespond;
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      stub.received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      stub.respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('core-api stub did not bind a TCP port');
  stub.url = `http://127.0.0.1:${address.port}`;
  return stub;
}
