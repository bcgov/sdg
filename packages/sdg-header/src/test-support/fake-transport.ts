import type { FetchFn } from '../notifications/source.js';

/** One request the header sent through the fake transport. */
export interface RecordedRequest {
  /** The URL as requested. */
  url: string;
  /** The path after the source URL, e.g. `inbox/unread-count`. */
  path: string;
  method: string;
  headers: Record<string, string>;
  credentials: RequestCredentials | undefined;
  signal: AbortSignal | undefined;
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

/** A fetch that records each request and answers it with `handler`. */
export function fakeFetch(baseUrl: string, handler: Handler): { fetch: FetchFn; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: FetchFn = async (url, init) => {
    const request: RecordedRequest = {
      url,
      path: url.startsWith(`${baseUrl}/`) ? url.slice(baseUrl.length + 1) : url,
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers)),
      credentials: init.credentials,
      signal: init.signal ?? undefined,
    };
    requests.push(request);
    return handler(request);
  };
  return { fetch, requests };
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A stream response body the test feeds: `push` sends text, `end` closes it cleanly, `fail` errors it. */
export interface StreamBody {
  response: Response;
  push: (text: string) => void;
  end: () => void;
  fail: () => void;
}

export function streamBody(): StreamBody {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(started) {
      controller = started;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (text) => controller?.enqueue(encoder.encode(text)),
    end: () => controller?.close(),
    fail: () => controller?.error(new TypeError('network error')),
  };
}

/** A body that emits the given text chunks and then ends. */
export function chunkedBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}
