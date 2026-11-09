import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { RecipientsService } from '../recipients/recipients.service.js';
import { createTestDatabase, type TestDatabase } from '../testing/database.js';
import {
  defineDeliveryType,
  relayedUser,
  runWorker,
  sendNotification,
  startDeliveryApp,
  type DeliveryApp,
  type RelayedUser,
} from '../testing/delivery.js';
import { bearer } from '../testing/senders.js';
import { sendingSender } from '../testing/sending.js';
import { settleSignals } from '../testing/signals.js';
import type { InboxSignals } from './signals/inbox-signals.js';

const TYPE = 'stream-type';
const STREAM = '/api/v1/me/inbox/stream';
const CHANGED = 'event: changed\ndata: {}';

/** The app's signals, counting each recipient's live subscriptions. */
function countingSignals(inner: InboxSignals): { signals: InboxSignals; live: (recipientId: string) => number } {
  const live = new Map<string, number>();
  const bump = (recipientId: string, by: number) => live.set(recipientId, (live.get(recipientId) ?? 0) + by);
  return {
    live: (recipientId) => live.get(recipientId) ?? 0,
    signals: {
      subscribe(recipientId, callback) {
        bump(recipientId, 1);
        const unsubscribe = inner.subscribe(recipientId, callback);
        return () => {
          bump(recipientId, -1);
          unsubscribe();
        };
      },
    },
  };
}

let app: DeliveryApp;
let base: string;
let credential: { authorization: string };
let counting: ReturnType<typeof countingSignals>;

async function listen(target: DeliveryApp): Promise<string> {
  await target.t.app.listen(0, '127.0.0.1');
  const address: string | AddressInfo | null = target.t.app.getHttpServer().address();
  if (address === null || typeof address === 'string') throw new Error('The app is not listening on a port');
  return `http://127.0.0.1:${address.port}`;
}

beforeAll(async () => {
  app = await startDeliveryApp({
    database: async (): Promise<TestDatabase> => {
      const database = await createTestDatabase();
      if (!database.signals) throw new Error('The test database has no signals');
      counting = countingSignals(database.signals);
      return { ...database, signals: counting.signals };
    },
  });
  await defineDeliveryType(app.t, app.adminToken, {
    key: TYPE,
    policy: { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] },
  });
  const sender = await sendingSender(app.t, app.issuer, app.adminToken, 'stream-sender', [TYPE]);
  credential = await sender.credential('stream-sender-client', [TYPE]);
  base = await listen(app);
});

afterAll(() => app.close());

afterEach(() => {
  vi.useRealTimers();
});

interface EventStream {
  response: Response;
  /** The next frame without its blank line, or null once the server has ended the stream. */
  next: () => Promise<string | null>;
  /** The next frame, or 'nothing' when none arrives within `ms` (real time). */
  nextWithin: (ms: number) => Promise<string | null>;
  cancel: () => Promise<void>;
}

async function openStream(origin: string, auth: { authorization: string }): Promise<EventStream> {
  const response = await fetch(`${origin}${STREAM}`, { headers: auth });
  if (!response.body) throw new Error('The stream has no body');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let pending: Promise<string | null> | null = null;
  const read = async (): Promise<string | null> => {
    for (;;) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        return frame;
      }
      // oxlint-disable-next-line no-await-in-loop -- frames arrive one chunk at a time.
      const { done, value } = await reader.read();
      if (done) return null;
      buffer += value;
    }
  };
  const next = (): Promise<string | null> => {
    const current = pending ?? read();
    pending = null;
    return current;
  };
  const nextWithin = async (ms: number): Promise<string | null> => {
    pending ??= read();
    const timeout = new Promise<'nothing'>((resolve) => {
      setTimeout(() => resolve('nothing'), ms);
    });
    const result = await Promise.race([pending, timeout]);
    if (result !== 'nothing') pending = null;
    return result;
  };
  return { response, next, nextWithin, cancel: () => reader.cancel() };
}

/** Opens the user's stream and reads its opening comment. */
async function opened(user: RelayedUser, origin = base): Promise<EventStream> {
  const stream = await openStream(origin, user.auth);
  expect(await stream.next()).toMatch(/^:/);
  return stream;
}

async function notify(user: RelayedUser): Promise<void> {
  await sendNotification(app.t, credential, TYPE, user.audience);
  await runWorker(app.t);
  await settleSignals(counting.signals, app.t.database.db);
}

describe('GET me/inbox/stream (KTD4)', () => {
  it('answers an event stream and sends changed once a notification is planned for the user', async () => {
    const user = await relayedUser(app);
    const stream = await openStream(base, user.auth);

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(stream.response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
    expect(await stream.next()).toMatch(/^:/);

    await notify(user);

    expect(await stream.next()).toBe(CHANGED);
    await stream.cancel();
  });

  it('sends nothing for another recipient’s notification', async () => {
    const user = await relayedUser(app);
    const other = await relayedUser(app);
    const stream = await opened(user);

    await notify(other);

    expect(await stream.nextWithin(200)).toBe('nothing');
    await stream.cancel();
  });

  it('sends a keep-alive comment every 15 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const stream = await opened(await relayedUser(app));

    await vi.advanceTimersByTimeAsync(15_000);
    expect(await stream.next()).toBe(': keep-alive');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(await stream.nextWithin(100)).toBe('nothing');
    await vi.advanceTimersByTimeAsync(1);
    expect(await stream.next()).toBe(': keep-alive');
    await stream.cancel();
  });

  it('ends the stream cleanly when the token expires', async () => {
    const subject = `user-${crypto.randomUUID()}`;
    const user = await relayedUser(app, subject);
    const auth = bearer(await app.issuer.relayingUserToken({ subject, sign: { expiresIn: '2s' } }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const stream = await opened({ ...user, auth });

    // `exp` is in whole seconds, so it falls between 1 and 2 seconds from now.
    await vi.advanceTimersByTimeAsync(900);
    await notify(user);
    expect(await stream.next()).toBe(CHANGED);
    await vi.advanceTimersByTimeAsync(1_200);

    expect(await stream.next()).toBeNull();
  });

  it('answers 403 to a credential token and 401 to no token', async () => {
    const asCredential = await app.t.http().get(STREAM).set(credential);
    const anonymous = await app.t.http().get(STREAM);

    expect(asCredential.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });

  it('unsubscribes from the signals when the client goes away', async () => {
    const user = await relayedUser(app);
    const stream = await opened(user);
    expect(counting.live(user.recipientId)).toBe(1);

    await stream.cancel();

    await vi.waitFor(() => expect(counting.live(user.recipientId)).toBe(0));
  });

  it('subscribes nothing when the client leaves while the stream is being set up', async () => {
    const user = await relayedUser(app);
    const recipients = app.t.app.get(RecipientsService);
    const claim = recipients.claimUser.bind(recipients);
    const { promise: entered, resolve: enter } = Promise.withResolvers<void>();
    const { promise: gate, resolve: release } = Promise.withResolvers<void>();
    const spy = vi.spyOn(recipients, 'claimUser').mockImplementationOnce(async (person) => {
      enter();
      await gate;
      return claim(person);
    });
    const controller = new AbortController();
    const request = fetch(`${base}${STREAM}`, { headers: user.auth, signal: controller.signal }).catch(() => undefined);
    await entered;
    controller.abort();
    await request;
    await new Promise((resolve) => setTimeout(resolve, 50));

    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(counting.live(user.recipientId)).toBe(0);
    spy.mockRestore();
  });

  it('ends open streams when the app shuts down', async () => {
    const own = await startDeliveryApp();
    const stream = await opened(await relayedUser(own), await listen(own));

    const closing = own.close();

    expect(await stream.next()).toBeNull();
    await closing;
  });
});
