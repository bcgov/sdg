/** One Server-Sent Event: `event` is "message" when the stream named none. */
export interface StreamEvent {
  event: string;
  data: string;
}

/**
 * Parses a `text/event-stream` body into events, skipping comments (lines starting with `:`). Ends when the body ends
 * or `signal` aborts.
 */
export async function* readEvents(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const cancel = (): void => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', cancel);
  const decoder = new TextDecoder();
  const event = new EventBuilder();
  let buffer = '';
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- a stream is read one chunk at a time.
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      // A trailing CR might be the first half of a CRLF; keep it until the next chunk.
      const lines = buffer.split(/\r\n|\r(?!$)|\n/u);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const complete = event.line(line);
        if (complete) yield complete;
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

class EventBuilder {
  #type = '';
  #data: string[] = [];

  /** Takes one line; returns the finished event on a blank line that ends one with data. */
  line(line: string): StreamEvent | undefined {
    if (line === '') return this.#dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /u, '');
    if (field === 'event') this.#type = value;
    else if (field === 'data') this.#data.push(value);
    return undefined;
  }

  #dispatch(): StreamEvent | undefined {
    const finished =
      this.#data.length > 0 ? { event: this.#type || 'message', data: this.#data.join('\n') } : undefined;
    this.#type = '';
    this.#data = [];
    return finished;
  }
}
