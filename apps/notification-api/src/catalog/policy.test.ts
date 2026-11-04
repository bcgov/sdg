import { describe, expect, it } from 'vitest';

import { policyChannels, policySchema } from './policy.js';

const issues = (input: unknown): string[] => {
  const result = policySchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('delivery policy (R14, KTD8)', () => {
  it('accepts an escalation of email 60 minutes after the in-app item', () => {
    const policy = { mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 60 }] };
    expect(policySchema.parse(policy)).toEqual(policy);
  });

  it('accepts ordered escalation steps, including a repeated channel as a reminder', () => {
    const policy = {
      mode: 'escalation',
      steps: [
        { channel: 'email', delayMinutes: 0 },
        { channel: 'webhook', delayMinutes: 30 },
        { channel: 'email', delayMinutes: 1440 },
      ],
    };
    expect(policySchema.parse(policy)).toEqual(policy);
  });

  it('rejects a negative escalation delay', () => {
    expect(issues({ mode: 'escalation', steps: [{ channel: 'email', delayMinutes: -5 }] })).toEqual([
      'Too small: expected number to be >=0',
    ]);
  });

  it('rejects a fractional delay and an escalation without steps', () => {
    expect(issues({ mode: 'escalation', steps: [{ channel: 'email', delayMinutes: 1.5 }] })).toHaveLength(1);
    expect(issues({ mode: 'escalation', steps: [] })).toHaveLength(1);
  });

  it('rejects in-app as an escalation step or an all-at-once channel (R38)', () => {
    const inApp = 'In-app is not a policy channel: every recipient with an inbox always gets the in-app item (R38)';
    expect(issues({ mode: 'escalation', steps: [{ channel: 'in-app', delayMinutes: 0 }] })).toEqual([inApp]);
    expect(issues({ mode: 'all-at-once', channels: ['email', 'in-app'] })).toEqual([inApp]);
  });

  it('accepts all at once over email and webhook, and over no channel for an inbox-only type', () => {
    expect(policySchema.parse({ mode: 'all-at-once', channels: ['email', 'webhook'] })).toEqual({
      mode: 'all-at-once',
      channels: ['email', 'webhook'],
    });
    expect(policySchema.parse({ mode: 'all-at-once', channels: [] })).toEqual({ mode: 'all-at-once', channels: [] });
  });

  it('rejects a channel listed twice in an all-at-once policy', () => {
    expect(issues({ mode: 'all-at-once', channels: ['email', 'email'] })).toEqual(['email is listed more than once']);
  });

  it('rejects an unknown mode and unknown keys', () => {
    expect(issues({ mode: 'round-robin', channels: ['email'] })).toHaveLength(1);
    expect(issues({ mode: 'all-at-once', channels: ['email'], mandatory: true })).toHaveLength(1);
  });
});

describe('policyChannels (R19)', () => {
  it('gives the distinct channels in step order, which address-only recipients get all at once', () => {
    expect(
      policyChannels({
        mode: 'escalation',
        steps: [
          { channel: 'webhook', delayMinutes: 0 },
          { channel: 'email', delayMinutes: 60 },
          { channel: 'webhook', delayMinutes: 120 },
        ],
      }),
    ).toEqual(['webhook', 'email']);
    expect(policyChannels({ mode: 'all-at-once', channels: ['email'] })).toEqual(['email']);
  });
});
