import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

const BODYLESS_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD']);

/** The request body exactly as the browser sent it could not be recovered. */
export class RawBodyUnavailableError extends Error {
  constructor() {
    super('A body parser consumed the request body; create the BFF app with NestFactory.create(…, { rawBody: true })');
    this.name = 'RawBodyUnavailableError';
  }
}

async function readStream(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks);
}

/**
 * The request body as received, for forwarding byte for byte. Nest's JSON and urlencoded parsers consume the stream
 * first, so for those the app must keep `req.rawBody` (`rawBody: true`); any other content type is still unread.
 */
export async function requestBody(req: RawBodyRequest<Request>): Promise<Uint8Array | undefined> {
  if (BODYLESS_METHODS.has(req.method.toUpperCase())) return undefined;
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (!req.readableEnded) return readStream(req);
  if (req.body === undefined) return undefined;
  throw new RawBodyUnavailableError();
}
