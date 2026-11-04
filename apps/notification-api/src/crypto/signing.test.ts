import { describe, expect, it } from 'vitest';

import { generateWebhookSecret, signWebhook, verifyWebhook } from './signing.js';

describe('Standard Webhooks v1 signing (KTD10)', () => {
  it('matches the Standard Webhooks reference signature', () => {
    // The example from the Standard Webhooks specification's reference libraries.
    const headers = signWebhook({
      secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
      id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      timestamp: new Date(1_614_265_330 * 1000),
      body: '{"test": 2432232314}',
    });

    expect(headers).toEqual({
      'webhook-id': 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      'webhook-timestamp': '1614265330',
      'webhook-signature': 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
    });
  });

  it("a signature for one endpoint's secret does not verify with another endpoint's secret", () => {
    const [mine, theirs] = [generateWebhookSecret(), generateWebhookSecret()];
    const message = { id: 'delivery-1', timestamp: new Date(), body: '{"permit":"approved"}' };
    const headers = signWebhook({ secret: mine, ...message });

    expect(verifyWebhook({ secret: mine, headers, body: message.body })).toBe(true);
    expect(verifyWebhook({ secret: theirs, headers, body: message.body })).toBe(false);
  });

  it('does not verify a body that was changed after signing', () => {
    const secret = generateWebhookSecret();
    const headers = signWebhook({ secret, id: 'delivery-2', timestamp: new Date(), body: '{"amount":10}' });

    expect(verifyWebhook({ secret, headers, body: '{"amount":1000}' })).toBe(false);
  });

  it('generates whsec_ secrets of 32 random bytes', () => {
    const secret = generateWebhookSecret();

    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(Buffer.from(secret.slice('whsec_'.length), 'base64')).toHaveLength(32);
    expect(generateWebhookSecret()).not.toBe(secret);
  });
});
