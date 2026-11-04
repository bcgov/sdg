import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { bearer, createSender } from '../testing/senders.js';
import { mjml, permitType, templatesApi, type TemplatesApi } from '../testing/templates.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';

let t: TestApp;
let issuer: TestIssuer;
let adminToken: string;
let api: TemplatesApi;

const TYPE = 'permit-saves';
const templatesPath = `/api/v1/admin/types/${TYPE}/templates`;

beforeAll(async () => {
  issuer = await startTestIssuer();
  t = await createTestApp({ env: issuer.env, issuerFetch: issuer.fetch });
  adminToken = await issuer.ownClientUserToken({ admin: true });
  api = templatesApi(t, adminToken);
  await api.defineType(permitType(TYPE));
});

afterAll(async () => {
  await t.close();
  await issuer.close();
});

const email = (html: string) => ({ subject: 'Permit {{ permit.number }}', html: mjml(html) });

async function versionCount(channel: string, language: string): Promise<number> {
  const res = await t.http().get(`${templatesPath}/${channel}/${language}/versions`).set(bearer(adminToken));
  return res.status === 404 ? 0 : res.body.length;
}

const preview = (channel: string, language: string) =>
  t.http().get(`${templatesPath}/${channel}/${language}/preview`).set(bearer(adminToken));

describe('saving a template (R23, R25)', () => {
  it('creates a new immutable version on each save', async () => {
    const first = await api.save(TYPE, 'email', 'en-CA', email('First {{ permit.number }}'));
    const second = await api.save(TYPE, 'email', 'en-CA', email('Second {{ permit.number }}'));

    expect([first.body.version, second.body.version]).toEqual([1, 2]);
    const admin = bearer(adminToken);
    const [versions, v1, current] = await Promise.all([
      t.http().get(`${templatesPath}/email/en-CA/versions`).set(admin),
      t.http().get(`${templatesPath}/email/en-CA/versions/1`).set(admin),
      t.http().get(templatesPath).set(admin),
    ]);
    expect(versions.body.map((version: { version: number }) => version.version)).toEqual([2, 1]);
    expect(v1.body.parts.html).toContain('First {{ permit.number }}');
    expect(current.body).toEqual([expect.objectContaining({ channel: 'email', language: 'en-CA', version: 2 })]);
  });

  it('rejects a template using an undefined variable, storing nothing', async () => {
    const res = await api.save(TYPE, 'email', 'fr-CA', email('{{ permit.nmber }}'));

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('undefined variable: permit.nmber')]),
    );
    expect(await versionCount('email', 'fr-CA')).toBe(0);
  });

  it('rejects an optional field printed outside if or default, in the required-fields-only render', async () => {
    const outside = await api.save(TYPE, 'in-app', 'en-CA', { title: 'x', body: 'Holder {{ permit.holder }}' });
    const guarded = await api.save(TYPE, 'in-app', 'en-CA', {
      title: 'x',
      body: '{% if permit.holder %}Holder {{ permit.holder }}{% endif %} {{ message | default: "none" }}',
    });

    expect(outside.status).toBe(400);
    expect(outside.body.errors).toEqual([
      expect.stringMatching(/^With only the required fields: body: undefined variable: permit.holder/),
    ]);
    expect(guarded.status).toBe(201);
  });

  it('rejects an include of a file path, which resolves only among the admin partials', async () => {
    const res = await api.save(TYPE, 'in-app', 'fr-CA', { title: 'x', body: '{% include "/etc/passwd" %}' });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining('ENOENT: Failed to lookup "/etc/passwd"')]),
    );
    expect(await versionCount('in-app', 'fr-CA')).toBe(0);
  });

  it('rejects MJML that does not validate, and a template part the channel does not declare', async () => {
    const [invalid, undeclared] = await Promise.all([
      api.save(TYPE, 'email', 'en-GB', { subject: 'x', html: '<mjml><mj-body><mj-bogus /></mj-body></mjml>' }),
      api.save(TYPE, 'email', 'en-GB', { subject: 'x', html: mjml('x'), title: 'x' }),
    ]);

    expect([invalid.status, undeclared.status]).toEqual([400, 400]);
    expect(JSON.stringify(invalid.body.errors)).toContain('mj-bogus');
    expect(JSON.stringify(undeclared.body.errors)).toContain('title');
  });
});

describe('layouts and partials (R22, KTD7)', () => {
  it('include a saved partial, and a partial version that breaks a template using it is rejected', async () => {
    expect((await api.savePartial('signature', 'Permits office')).status).toBe(201);
    const saved = await api.save(TYPE, 'in-app', 'en-US', { title: 'x', body: 'Hi {% include "signature" %}' });
    expect(saved.status).toBe(201);

    const broken = await api.savePartial('signature', 'Office {{ office.name }}');
    expect(broken.status).toBe(400);
    expect(broken.body.errors).toEqual(
      expect.arrayContaining([expect.stringContaining(`${TYPE} in-app en-US v1: With sample data: body`)]),
    );
    const versions = await t.http().get('/api/v1/admin/partials/signature/versions').set(bearer(adminToken));
    expect(versions.body.map((version: { version: number }) => version.version)).toEqual([1]);
  });

  it('share one name space: a layout cannot take a partial name', async () => {
    expect((await api.savePartial('footer', 'Footer')).status).toBe(201);
    expect((await api.saveLayout('footer', '{% block content %}{% endblock %}')).status).toBe(409);
  });
});

describe('previews (R23)', () => {
  it('render each channel in each of its languages with sample data', async () => {
    const saves = await Promise.all([
      api.save(TYPE, 'webhook', 'en-CA', { payload: '{"permit": "{{ permit.number }}"}' }),
      api.save(TYPE, 'webhook', 'fr-CA', {}),
    ]);
    expect(saves.map((save) => save.status)).toEqual([201, 201]);

    const [emailEn, inAppEn, webhookEn, webhookFr] = await Promise.all([
      preview('email', 'en-CA'),
      preview('in-app', 'en-CA'),
      preview('webhook', 'en-CA'),
      preview('webhook', 'fr-CA'),
    ]);

    expect(emailEn.body).toMatchObject({ version: 2, language: 'en-CA', rendered: { subject: 'Permit number' } });
    expect(emailEn.body.rendered.html).toContain('Second number');
    expect(inAppEn.body.rendered.body).toContain('Holder holder');
    expect(JSON.parse(webhookEn.body.rendered.payload)).toEqual({ permit: 'number' });
    expect(JSON.parse(webhookFr.body.rendered.payload)).toMatchObject({
      type: TYPE,
      data: { permit: { number: 'number' } },
    });
    expect((await preview('email', 'de-DE')).status).toBe(404);
  });
});

describe('access (R22)', () => {
  it('refuses template, layout and partial writes and previews to relaying-app and credential tokens', async () => {
    const sender = await createSender(t, issuer, adminToken, { name: 'Permits', owner: 'templates-owner' });
    const linked = await t
      .http()
      .post(`/api/v1/senders/${sender.id}/credentials`)
      .set(bearer(sender.ownerToken))
      .send({ clientId: 'permits-batch' });
    expect(linked.status).toBe(201);
    const tokens = await Promise.all([
      issuer.relayingUserToken({ admin: true }),
      issuer.credentialToken('permits-batch'),
    ]);

    const statuses = await Promise.all(
      tokens.map(async (token) => {
        const responses = await Promise.all([
          t
            .http()
            .post(`${templatesPath}/email/en-CA/versions`)
            .set(bearer(token))
            .send({ parts: email('x') }),
          t.http().post('/api/v1/admin/layouts/frame/versions').set(bearer(token)).send({ source: 'x' }),
          t.http().post('/api/v1/admin/partials/sig/versions').set(bearer(token)).send({ source: 'x' }),
          t.http().get(`${templatesPath}/email/en-CA/preview`).set(bearer(token)),
        ]);
        return responses.map((res) => res.status);
      }),
    );
    expect(statuses).toEqual([
      [403, 403, 403, 403],
      [403, 403, 403, 403],
    ]);
    expect(await versionCount('email', 'en-CA')).toBe(2);
  });
});
