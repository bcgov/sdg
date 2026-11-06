import type { ServerResponse } from 'node:http';

/** Inside the platform's 30-second idle limit (KTD4, R30). */
export const KEEP_ALIVE_MS = 15_000;

/** One open Server-Sent Events response. */
export interface EventStream {
  /** Sends `event: changed` (the only event: it carries no content, R27). */
  changed(): void;
  /** Ends the response; later calls and sends do nothing. */
  end(): void;
  /** Runs once when the stream ends, by `end()` or because the client went away. */
  onEnd(listener: () => void): void;
}

/**
 * Hand-written SSE on a raw response (KTD4): writes the headers with an opening comment so they flush at once, then a
 * `: keep-alive` comment every 15 seconds until the stream ends.
 */
export function openEventStream(res: ServerResponse): EventStream {
  let ended = false;
  const listeners: (() => void)[] = [];
  const finish = (): void => {
    if (ended) return;
    ended = true;
    clearInterval(keepAlive);
    for (const listener of listeners) listener();
  };
  const write = (frame: string): void => {
    if (!ended) res.write(frame);
  };

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });
  res.write(': open\n\n');
  const keepAlive = setInterval(() => write(': keep-alive\n\n'), KEEP_ALIVE_MS);
  res.on('close', finish);

  return {
    changed: () => write('event: changed\ndata: {}\n\n'),
    end: () => {
      if (ended) return;
      finish();
      res.end();
    },
    onEnd: (listener) => {
      listeners.push(listener);
    },
  };
}
