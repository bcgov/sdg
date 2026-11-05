// The local stack's webhook receiver (compose.yaml `webhook-receiver`): records every request notification-api sends
// (webhook deliveries and failure callbacks) and answers 204, so scripts/e2e.ts can read them back.
//   GET    /requests[?path=<prefix>]  the recorded requests, oldest first, optionally only paths under <prefix>
//   DELETE /requests                  forgets them all
//   GET    /healthz                   200
// Any other request is recorded. Node built-ins only: compose runs it on the plain Node image with no install.
// Records live in memory until the container restarts. PORT defaults to 8080.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

process.on('unhandledRejection', (reason) => {
  console.error('webhook-receiver: unhandled rejection', reason instanceof Error ? reason.message : reason);
  process.exit(1);
});

interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  receivedAt: string;
}

const recorded: RecordedRequest[] = [];

function headersOf(req: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    Object.entries(req.headers).flatMap(([name, value]) => (typeof value === 'string' ? [[name, value]] : [])),
  );
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}

function serveRequests(req: IncomingMessage, res: ServerResponse, url: URL): void {
  if (req.method === 'DELETE') {
    recorded.length = 0;
    res.writeHead(204).end();
    return;
  }
  const prefix = url.searchParams.get('path');
  json(res, 200, prefix === null ? recorded : recorded.filter((request) => request.path.startsWith(prefix)));
}

function record(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('error', (error) => {
    console.error(`webhook-receiver: reading ${req.url ?? '/'} failed: ${error.message}`);
    res.writeHead(400).end();
  });
  req.on('end', () => {
    const path = req.url ?? '/';
    const body = Buffer.concat(chunks).toString('utf8');
    recorded.push({
      method: req.method ?? 'GET',
      path,
      headers: headersOf(req),
      body,
      receivedAt: new Date().toISOString(),
    });
    console.log(`webhook-receiver: ${req.method ?? 'GET'} ${path} (${body.length} bytes)`);
    res.writeHead(204).end();
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://webhook-receiver.invalid');
  if (url.pathname === '/healthz') json(res, 200, { status: 'ok' });
  else if (url.pathname === '/requests' && (req.method === 'GET' || req.method === 'DELETE')) {
    serveRequests(req, res, url);
  } else record(req, res);
});

const port = Number(process.env['PORT'] ?? '8080');
server.listen(port, '0.0.0.0', () => console.log(`webhook-receiver: listening on port ${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
