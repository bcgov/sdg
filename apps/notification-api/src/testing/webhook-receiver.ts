import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

/** One request the receiver got. */
export interface ReceivedWebhook {
  path: string;
  headers: Record<string, string>;
  body: string;
}

/** How the receiver answers a path: a status, after an optional delay. */
export interface WebhookResponse {
  status: number;
  delayMs?: number;
}

/** An HTTP server on 127.0.0.1 that records every request and answers 204 unless told otherwise. */
export interface TestWebhookReceiver {
  url(path: string): string;
  readonly requests: ReceivedWebhook[];
  /** The requests to one path. */
  requestsTo(path: string): ReceivedWebhook[];
  respond(path: string, response: WebhookResponse): void;
  close(): Promise<void>;
}

function headersOf(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(req.headers).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])),
  );
}

export async function startWebhookReceiver(): Promise<TestWebhookReceiver> {
  const requests: ReceivedWebhook[] = [];
  const responses = new Map<string, WebhookResponse>();
  const sockets = new Set<Socket>();
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '/';
      requests.push({ path, headers: headersOf(req), body: Buffer.concat(chunks).toString('utf8') });
      const { status, delayMs = 0 } = responses.get(path) ?? { status: 204 };
      setTimeout(() => res.writeHead(status).end(), delayMs);
    });
  };
  const server = createServer(handle);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an HTTP server listening on a port.
  const { port } = server.address() as AddressInfo;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    requests,
    requestsTo: (path) => requests.filter((request) => request.path === path),
    respond: (path, response) => responses.set(path, response),
    close: () =>
      new Promise((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
