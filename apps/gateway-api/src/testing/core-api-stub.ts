import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
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

/** Answers like core-api's GET /api/v1/gateway/me for a registered client, with a cookie the gateway must drop. */
const defaultRespond: StubResponder = json(
  200,
  { clientId: 'partner-client', displayName: 'Partner', enabled: true },
  { 'set-cookie': 'core=1' },
);

/** Starts a {@link CoreApiStub} on a free loopback port. */
export async function startCoreApiStub(): Promise<CoreApiStub> {
  const server: Server = createServer((req, res) => {
    stub.received.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
    stub.respond(req, res);
  });
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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') throw new Error('core-api stub did not bind a TCP port');
  stub.url = `http://127.0.0.1:${address.port}`;
  return stub;
}
