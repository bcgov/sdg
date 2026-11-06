import { describe, expect, it } from 'vitest';

import { chunkedBody } from '../test-support/fake-transport.js';
import { readEvents, type StreamEvent } from './event-stream.js';

async function collect(chunks: string[]): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of readEvents(chunkedBody(chunks))) events.push(event);
  return events;
}

describe('readEvents', () => {
  it('yields an event split across chunks once its blank line arrives', async () => {
    await expect(collect(['ev', 'ent: chan', 'ged\nda', 'ta: 1\n', '\n'])).resolves.toEqual([
      { event: 'changed', data: '1' },
    ]);
  });

  it('yields every event in one chunk, in order, with CRLF line ends', async () => {
    await expect(
      collect(['event: changed\r\ndata: 1\r\n\r\nevent: changed\ndata: 2\n\ndata: plain\n\n']),
    ).resolves.toEqual([
      { event: 'changed', data: '1' },
      { event: 'changed', data: '2' },
      { event: 'message', data: 'plain' },
    ]);
  });

  it('ignores comments, including the opening comment and keep-alives', async () => {
    await expect(collect([': open\n\n', ': keep-alive\n\n', 'event: changed\n: inside\ndata: 1\n\n'])).resolves.toEqual(
      [{ event: 'changed', data: '1' }],
    );
  });

  it('joins multiple data lines with a newline and drops an event left unfinished when the body ends', async () => {
    await expect(collect(['data: a\ndata: b\n\nevent: changed\ndata: 1'])).resolves.toEqual([
      { event: 'message', data: 'a\nb' },
    ]);
  });
});
