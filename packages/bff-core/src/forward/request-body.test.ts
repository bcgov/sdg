import { Readable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { RawBodyUnavailableError, requestBody, type BodyRequest } from './request-body.js';

interface FakeRequest {
  method: string;
  chunks?: string[];
  rawBody?: Buffer;
  body?: unknown;
  /** Read the stream to its end first, as Nest's JSON and urlencoded parsers do. */
  consumed?: boolean;
}

/** A readable request stream carrying the fields requestBody reads. */
async function fakeRequest({
  method,
  chunks = [],
  rawBody,
  body,
  consumed = false,
}: FakeRequest): Promise<BodyRequest> {
  const stream = Object.assign(Readable.from(chunks.map((chunk) => Buffer.from(chunk))), { method, rawBody, body });
  if (consumed) await stream.toArray();
  return stream;
}

const text = (body: Uint8Array | undefined) => (body === undefined ? undefined : Buffer.from(body).toString());

describe('requestBody', () => {
  it.each(['GET', 'head'])('has no body for %s', async (method) => {
    expect(await requestBody(await fakeRequest({ method, chunks: ['ignored'] }))).toBeUndefined();
  });

  it('returns the raw body Nest kept for a parsed JSON or form body', async () => {
    const rawBody = Buffer.from('{"name":"a"}');
    const req = await fakeRequest({ method: 'POST', rawBody, body: { name: 'a' }, consumed: true });
    expect(await requestBody(req)).toBe(rawBody);
  });

  it('reads a body no parser touched (another content type) from the stream', async () => {
    const req = await fakeRequest({ method: 'PUT', chunks: ['part one, ', 'part two'] });
    expect(text(await requestBody(req))).toBe('part one, part two');
  });

  it('has no body when the stream was read but nothing was parsed', async () => {
    expect(await requestBody(await fakeRequest({ method: 'POST', consumed: true }))).toBeUndefined();
  });

  it('throws RawBodyUnavailableError when a parser consumed the body and the app kept no raw body', async () => {
    const req = await fakeRequest({ method: 'POST', chunks: ['{"name":"a"}'], body: { name: 'a' }, consumed: true });
    const error = await requestBody(req).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RawBodyUnavailableError);
    expect(String(error)).toContain('rawBody: true');
  });
});
