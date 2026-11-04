import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { permitType, templatesApi, type TemplatesApi } from '../testing/templates.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { RenderService } from './render.service.js';

let t: TestApp;
let issuer: TestIssuer;
let api: TemplatesApi;

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({ env: issuer.env, issuerFetch: issuer.fetch });
  api = templatesApi(t, await issuer.ownClientUserToken({ admin: true }));
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

async function payload(typeKey: string, data: Record<string, unknown>): Promise<unknown> {
  const result = await t.app.get(RenderService).render({
    pinned: await api.pin(typeKey),
    channel: 'webhook',
    data,
    recipientId: 'system-1',
  });
  if (result.status !== 'rendered' || result.parts.channel !== 'webhook') throw new Error('Expected a webhook payload');
  return JSON.parse(result.parts.payload);
}

describe('webhook payload templates (R21, R24, KTD6)', () => {
  it('keeps sender data inside its string value, so the payload stays valid JSON with the same keys', async () => {
    await api.defineType(permitType('payload-injection'));
    const template = JSON.stringify({
      type: 'permit.issued',
      permit: { number: '{{ permit.number }}', tags: ['{{ permit.number | upcase }}', 7, true, null] },
    });
    expect((await api.save('payload-injection', 'webhook', 'en-CA', { payload: template })).status).toBe(201);

    const hostile = 'P-1", "type": "evil"} ,"type":';
    expect(await payload('payload-injection', { permit: { number: hostile }, expires_at: 'x' })).toEqual({
      type: 'permit.issued',
      permit: { number: hostile, tags: [hostile.toUpperCase(), 7, true, null] },
    });
  });

  it('sends the standard envelope when the template sets no payload', async () => {
    await api.defineType(permitType('payload-envelope'));
    expect((await api.save('payload-envelope', 'webhook', 'en-CA', { payload: '' })).status).toBe(201);

    const data = { permit: { number: 'P-2' }, expires_at: '2027-03-04' };
    expect(await payload('payload-envelope', data)).toEqual({
      type: 'payload-envelope',
      recipient: { id: 'system-1' },
      data,
    });
  });

  it('rejects a payload template that is not valid JSON when it is saved', async () => {
    await api.defineType(permitType('payload-invalid'));
    const res = await api.save('payload-invalid', 'webhook', 'en-CA', {
      payload: '{"permit": "{{ permit.number }}",}',
    });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.errors)).toContain('payload: Not valid JSON');
    expect(
      await t.app.get(RenderService).render({
        pinned: await api.pin('payload-invalid'),
        channel: 'webhook',
        data: {},
        recipientId: 'system-1',
      }),
    ).toEqual({ status: 'no-template' });
  });
});
