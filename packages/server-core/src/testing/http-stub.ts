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
  body: string;
}

export type StubResponder = (req: IncomingMessage, res: ServerResponse) => void;

/** A stand-in for an upstream service on a loopback port: records every request and answers with `respond`. */
export interface HttpStub {
  url: string;
  received: ReceivedRequest[];
  respond: StubResponder;
  /** Clears `received` and restores the default responder. */
  reset(): void;
  close(): Promise<void>;
}

export const json =
  (status: number, body: unknown, headers: Record<string, string> = {}): StubResponder =>
  (_req, res) => {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };

/** Drops the connection, as an unreachable upstream would. */
export const unreachable: StubResponder = (req) => req.socket.destroy();

/** Starts an {@link HttpStub} on a free loopback port, answering with `defaultRespond` until a test swaps it. */
export async function startHttpStub(defaultRespond: StubResponder): Promise<HttpStub> {
  const stub: HttpStub = {
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
  if (address === null || typeof address === 'string') throw new Error('HTTP stub did not bind a TCP port');
  stub.url = `http://127.0.0.1:${address.port}`;
  return stub;
}
