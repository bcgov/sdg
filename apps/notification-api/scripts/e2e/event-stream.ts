// A Server-Sent Events response read as it arrives, for scripts/e2e.ts: each frame (an event or a `:` comment) with
// the time it arrived, so a check can measure how soon a signal came through.
import { waitFor } from './support.ts';

export interface Frame {
  /** `Date.now()` when the frame's last line arrived. */
  at: number;
  /** The frame's lines without the blank line that ends it, e.g. `: keep-alive` or `event: changed\ndata: {}`. */
  text: string;
}

export interface EventStream {
  /** Every frame so far, oldest first. */
  frames(): readonly Frame[];
  /** Whether the response has ended (the server or something in between closed it). */
  ended(): boolean;
  /** The first frame that arrived at or after `since` and matches; throws when the stream ends or after `timeoutMs`. */
  next(what: string, match: (text: string) => boolean, options: { timeoutMs: number; since?: number }): Promise<Frame>;
  close(): void;
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

interface PumpState {
  frames: Frame[];
  ended: boolean;
  /** Why the read failed, unless the stream was closed on purpose. */
  failure: string | undefined;
}

/** Reads `body` in the background, splitting it into frames as they arrive. */
function pump(body: ReadableStream<Uint8Array>, closed: AbortSignal): PumpState {
  const state: PumpState = { frames: [], ended: false, failure: undefined };
  const read = async (): Promise<void> => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of body) {
        buffer = (buffer + decoder.decode(chunk, { stream: true })).replaceAll('\r\n', '\n');
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const text of parts) state.frames.push({ at: Date.now(), text });
      }
    } catch (error) {
      if (!closed.aborted) state.failure = reason(error);
    } finally {
      state.ended = true;
    }
  };
  void read();
  return state;
}

/** Opens `url` as an event stream; anything but a 200 `text/event-stream` throws naming `what`. */
export async function openEventStream(
  what: string,
  url: string,
  headers: Record<string, string>,
): Promise<EventStream> {
  const abort = new AbortController();
  const response = await fetch(url, {
    headers: { accept: 'text/event-stream', ...headers },
    redirect: 'manual',
    signal: abort.signal,
  });
  const type = response.headers.get('content-type') ?? '';
  if (response.status !== 200 || !type.startsWith('text/event-stream') || response.body === null) {
    abort.abort();
    throw new Error(`${what}: expected a 200 event stream, got ${response.status} ${type}`);
  }

  const state = pump(response.body, abort.signal);

  return {
    frames: () => state.frames,
    ended: () => state.ended,
    next: (description, match, { timeoutMs, since = 0 }) =>
      waitFor(
        description,
        () => {
          const found = state.frames.find((frame) => frame.at >= since && match(frame.text));
          if (found === undefined && state.ended) {
            const failure = state.failure === undefined ? '' : `: ${state.failure}`;
            throw new Error(`${what} ended before ${description}${failure}`);
          }
          return Promise.resolve(found);
        },
        { timeoutMs, intervalMs: 50 },
      ),
    close: () => abort.abort(),
  };
}
