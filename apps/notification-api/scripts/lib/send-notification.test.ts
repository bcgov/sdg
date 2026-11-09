import { spawnSync } from 'node:child_process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSend } from '../send.ts';
import { TYPE_KEYS } from './catalog.ts';
import { APP_DIR } from './env.ts';
import { FAKE_ISSUER, fakeNotificationApi, type FakeNotificationApi } from './fake-notification-api.ts';
import { UsageError } from './send-notification.ts';

const TOPIC_ID = '7d4c1a52-3f0e-4b8a-9a43-2f6f1b0c9e11';

let fake: FakeNotificationApi;

beforeEach(() => {
  fake = fakeNotificationApi();
  vi.stubGlobal('fetch', fake.fetch);
  vi.stubEnv('NOTIFICATION_API_BASE_URL', 'https://notify.test/');
  vi.stubEnv('KEYCLOAK_ISSUER_URL', FAKE_ISSUER);
  vi.stubEnv('SENDER_CREDENTIAL_A_CLIENT_ID', 'client-a');
  vi.stubEnv('SENDER_CREDENTIAL_A_CLIENT_SECRET', 'client-a-secret');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const sentRequests = () => fake.calls.filter((call) => call.url === 'https://notify.test/api/v1/notifications');

describe('send', () => {
  it('posts a topic-audience notification with --topic, as credential A', async () => {
    const notificationId = await runSend(['--topic', TOPIC_ID]);

    const [request] = sentRequests();
    expect(sentRequests()).toHaveLength(1);
    expect(request?.method).toBe('POST');
    expect(request?.body).toMatchObject({
      type: TYPE_KEYS.permitStatus,
      audience: { kind: 'topic', topicId: TOPIC_ID },
    });
    expect(notificationId).toMatch(/^[0-9a-f-]{36}$/);
    const tokenRequest = fake.calls.find((call) => call.url === `${FAKE_ISSUER}/token`);
    expect(String(tokenRequest?.body)).toContain('client_id=client-a');
  });

  it('posts a recipient-reference notification with --issuer and --subject', async () => {
    await runSend(['--issuer', 'https://bcsc.test', '--subject', 'tester-sub']);

    expect(sentRequests()[0]?.body).toMatchObject({
      audience: {
        kind: 'recipients',
        recipients: [{ kind: 'user', issuer: 'https://bcsc.test', subject: 'tester-sub' }],
      },
    });
  });

  it.each([
    ['neither a topic nor a subject', []],
    ['an issuer without a subject', ['--issuer', 'https://bcsc.test']],
    ['a subject without an issuer', ['--subject', 'tester-sub']],
    ['both a topic and a subject', ['--topic', TOPIC_ID, '--issuer', 'https://bcsc.test', '--subject', 's']],
    ['an unknown flag', ['--everyone']],
  ])('refuses %s before calling anything', async (_, argv) => {
    await expect(runSend(argv)).rejects.toBeInstanceOf(UsageError);

    expect(fake.calls).toEqual([]);
  });

  it('prints the base URL and issuer before sending', async () => {
    const printed = vi.mocked(console.error);
    let callsWhenPrinted = -1;
    printed.mockImplementation(() => {
      callsWhenPrinted = fake.calls.length;
    });

    await runSend(['--topic', TOPIC_ID]);

    expect(printed).toHaveBeenCalledWith(expect.stringContaining('https://notify.test'));
    expect(printed).toHaveBeenCalledWith(expect.stringContaining(FAKE_ISSUER));
    expect(callsWhenPrinted).toBe(0);
  });

  it('exits 1 with the usage when run with no audience', () => {
    const run = spawnSync(process.execPath, ['scripts/send.ts'], {
      cwd: APP_DIR,
      encoding: 'utf8',
      env: { ...process.env, NOTIFICATION_API_BASE_URL: 'http://127.0.0.1:9' },
    });

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/usage:/);
    expect(run.stdout).toBe('');
  });
});
