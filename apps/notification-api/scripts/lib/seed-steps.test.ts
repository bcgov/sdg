import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { seed, type SeedConfig } from '../seed.ts';
import { PLATFORM_TOPIC, TYPE_KEYS } from './catalog.ts';
import { fakeJwt, fakeNotificationApi, type FakeNotificationApi } from './fake-notification-api.ts';
import { staticToken } from './tokens.ts';

const ISSUER = 'https://keycloak.test/realms/idir';
const CLIENTS = ['client-a', 'client-b'] as const;

const config = (callbackUrl?: string): SeedConfig => ({
  notifyUrl: 'https://notify.test',
  admin: staticToken(fakeJwt(ISSUER, 'admin-subject')),
  credentialClientIds: CLIENTS,
  callbackUrl,
  escalationDelayMinutes: 60,
});

let fake: FakeNotificationApi;

beforeEach(() => {
  fake = fakeNotificationApi();
  vi.stubGlobal('fetch', fake.fetch);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The writes since the last call. */
function writesSince(before: number): string[] {
  return fake.writes().slice(before);
}

const onlySender = () => {
  const [sender, ...others] = fake.state.senders.values();
  expect(others).toHaveLength(0);
  return sender!;
};

describe('seed', () => {
  it('fills an empty catalog: types with templates, the topic, the sender and both scoped credentials', async () => {
    const seeded = await seed(config());

    expect([...fake.state.types.keys()].toSorted()).toEqual(Object.values(TYPE_KEYS).toSorted());
    expect(fake.state.types.get(TYPE_KEYS.permitStatus)?.size).toBe(5);
    const [topic] = fake.state.topics;
    expect(topic).toMatchObject({ id: seeded.platformTopicId, key: PLATFORM_TOPIC.key, selfSubscribe: true });
    expect(topic?.broadcasters).toEqual([seeded.senderId]);
    const sender = onlySender();
    expect(sender).toMatchObject({ id: seeded.senderId, name: 'Permits Office', callbackUrl: null });
    expect(sender.owners).toEqual([{ issuer: ISSUER, subject: 'admin-subject' }]);
    expect(sender.grantedTypes.toSorted()).toEqual(Object.values(TYPE_KEYS).toSorted());
    expect(seeded.credentials.a).toMatchObject({ clientId: 'client-a' });
    expect(seeded.credentials.a.scopedTypes.toSorted()).toEqual(Object.values(TYPE_KEYS).toSorted());
    expect(seeded.credentials.b).toMatchObject({ clientId: 'client-b', scopedTypes: [TYPE_KEYS.formReceived] });
  });

  it('grants a new sender on the platform topic before any other sender step', async () => {
    await seed(config('https://receiver.test/callbacks'));

    const writes = fake.writes();
    const created = writes.indexOf('POST /api/v1/admin/senders');
    const senderSteps = writes.filter((write) => /\/senders\/[^/]+\//.test(write));
    expect(writes[created + 1]).toMatch(/^PUT \/api\/v1\/admin\/topics\/[^/]+\/broadcasters\/[^/]+$/);
    expect(senderSteps.every((write) => writes.indexOf(write) > created + 1)).toBe(true);
  });

  it('creates nothing on a second full run, and returns the same objects', async () => {
    const first = await seed(config('https://receiver.test/callbacks'));
    const before = fake.writes().length;

    const second = await seed(config('https://receiver.test/callbacks'));

    expect(writesSince(before)).toEqual([]);
    expect(second).toEqual(first);
  });

  it('finishes a partial seed: finds the sender through the topic and links only the missing credential', async () => {
    const first = await seed(config());
    const sender = onlySender();
    sender.credentials = sender.credentials.filter((credential) => credential.clientId === 'client-a');
    const before = fake.writes().length;

    const second = await seed(config());

    expect(second.senderId).toBe(first.senderId);
    expect(fake.state.senders.size).toBe(1);
    expect(writesSince(before)).toEqual([
      `POST /api/v1/senders/${first.senderId}/credentials`,
      `PUT /api/v1/senders/${first.senderId}/credentials/${second.credentials.b.id}/scopes`,
    ]);
    expect(fake.calls.findLast((call) => call.method === 'POST')?.body).toEqual({ clientId: 'client-b' });
    expect(second.credentials.a).toEqual(first.credentials.a);
    expect(second.credentials.b).toMatchObject({ clientId: 'client-b', scopedTypes: [TYPE_KEYS.formReceived] });
  });

  it('finishes a partial seed that stopped after creating the sender: no second sender, every missing step', async () => {
    const first = await seed(config());
    const sender = onlySender();
    Object.assign(sender, { owners: [], grantedTypes: [], credentials: [] });
    const before = fake.writes().length;

    const second = await seed(config());

    expect(second.senderId).toBe(first.senderId);
    expect(fake.state.senders.size).toBe(1);
    const writes = writesSince(before);
    expect(writes).not.toContain('POST /api/v1/admin/senders');
    expect(writes.filter((write) => write.endsWith('/credentials'))).toHaveLength(2);
    expect(onlySender().grantedTypes.toSorted()).toEqual(Object.values(TYPE_KEYS).toSorted());
    expect(onlySender().owners).toEqual([{ issuer: ISSUER, subject: 'admin-subject' }]);
  });

  it('saves only the missing templates of a type that already exists', async () => {
    await seed(config());
    fake.state.types.get(TYPE_KEYS.formReceived)?.delete('email/fr-CA');
    const before = fake.writes().length;

    await seed(config());

    expect(writesSince(before)).toEqual([
      `POST /api/v1/admin/types/${TYPE_KEYS.formReceived}/templates/email/fr-CA/versions`,
    ]);
  });

  it('does not create a second sender with the same name when another one is not on the topic', async () => {
    await seed(config());
    const stray = { ...onlySender(), id: crypto.randomUUID(), credentials: [] };
    fake.state.senders.set(stray.id, stray);
    const topic = fake.state.topics[0]!;
    const before = fake.writes().length;

    const seeded = await seed(config());

    expect(seeded.senderId).toBe(topic.broadcasters[0]);
    expect(writesSince(before)).toEqual([]);
  });

  it('sets no failure callback without a receiver URL, and sets it when one is given', async () => {
    await seed(config());
    expect(fake.writes().some((write) => write.endsWith('/callback'))).toBe(false);
    expect(onlySender().callbackUrl).toBeNull();

    await seed(config('https://receiver.test/callbacks'));
    expect(onlySender().callbackUrl).toBe('https://receiver.test/callbacks');
  });

  it('prints the base URL and issuer before its first write', async () => {
    const printed = vi.mocked(console.error);
    let writesWhenPrinted = -1;
    printed.mockImplementation(() => {
      writesWhenPrinted = fake.writes().length;
    });

    await seed(config());

    expect(printed).toHaveBeenCalledWith(expect.stringContaining('https://notify.test'));
    expect(printed).toHaveBeenCalledWith(expect.stringContaining(ISSUER));
    expect(writesWhenPrinted).toBe(0);
  });

  it('stops before writing when the token lacks the admin role', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 403 })));

    await expect(seed(config())).rejects.toThrow(/admin client role/);
  });
});
