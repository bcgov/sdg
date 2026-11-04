import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { OutboundGuard, type HostVetter } from '../outbound/outbound-guard.js';
import { startTestSmtpServer, type TestSmtpServer } from '../testing/smtp-server.js';
import { sendEmail, type SmtpConfig } from './types/smtp.js';

let server: TestSmtpServer;

beforeAll(async () => {
  server = await startTestSmtpServer();
});

afterAll(() => server.close());

afterEach(() => {
  server.commands.length = 0;
  server.messages.length = 0;
});

const message = {
  to: 'pat@example.com',
  subject: 'Your permit is approved',
  html: '<p>Approved</p>',
  text: 'Approved',
  messageId: '5f0c8a43-6c2e-4d55-9a7d-1f1d3b2c9e10',
};

const config = (host: string): SmtpConfig => ({ host, port: server.port, secure: false, from: 'permits@example.com' });

describe('sendEmail', () => {
  it('delivers in plain text to an allow-listed host, with the delivery ID as the Message-ID', async () => {
    const guard = new OutboundGuard({ allowHosts: ['127.0.0.1'] });

    const outcome = await sendEmail(guard, config('127.0.0.1'), message);

    expect(outcome).toEqual({ status: 'accepted' });
    expect(server.commands).toContain('MAIL FROM:<permits@example.com>');
    expect(server.commands).toContain('RCPT TO:<pat@example.com>');
    const [raw] = server.messages;
    expect(raw).toMatch(/^Message-ID: <5f0c8a43-6c2e-4d55-9a7d-1f1d3b2c9e10@example\.com>$/m);
    expect(raw).toMatch(/^Subject: Your permit is approved$/m);
  });

  it('fails, without retrying, when a host that is not allow-listed does not offer STARTTLS', async () => {
    // A public mail host whose connection lands on the plain-text test server.
    const publicHost: HostVetter = {
      vet: (host) => Promise.resolve({ host, address: '127.0.0.1', family: 4, exempt: false }),
    };

    const outcome = await sendEmail(publicHost, config('smtp.example.com'), message);

    expect(outcome).toMatchObject({ status: 'failed', retryable: false });
    expect(outcome.status === 'failed' && outcome.error).toContain('STARTTLS');
    expect(server.commands.some((command) => command.startsWith('MAIL FROM'))).toBe(false);
    expect(server.messages).toEqual([]);
  });

  it('never connects to a host that resolves to a private address', async () => {
    const guard = new OutboundGuard({
      allowHosts: [],
      lookup: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
    });

    const outcome = await sendEmail(guard, config('mail.internal.example.com'), message);

    expect(outcome).toEqual({
      status: 'failed',
      retryable: false,
      error: 'mail.internal.example.com resolves to a non-public address',
    });
    expect(server.commands).toEqual([]);
  });
});
