import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';
import { ensureSaved, mjml, permitType, templatesApi, type TemplatesApi } from '../testing/templates.js';
import { startTestIssuer, type TestIssuer } from '../testing/tokens.js';
import { RenderService, type RenderRequest, type RenderResult } from './render.service.js';

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

const data = (overrides: Record<string, unknown> = {}) => ({
  permit: { number: 'P-1' },
  expires_at: '2027-03-04T19:00:00Z',
  ...overrides,
});

const render = (request: Omit<RenderRequest, 'recipientId'>): Promise<RenderResult> =>
  t.app.get(RenderService).render({ recipientId: 'recipient-1', ...request });

async function rendered(request: Omit<RenderRequest, 'recipientId'>) {
  const result = await render(request);
  if (result.status !== 'rendered') throw new Error('Expected a template');
  return result;
}

describe('email (R21, R24)', () => {
  it('compiles the Liquid output as MJML and HTML-escapes the data, generating the text part', async () => {
    await api.defineType(permitType('email-escape'));
    const saved = await api.save('email-escape', 'email', 'en-CA', {
      subject: 'Permit {{ permit.number }}',
      html: mjml('Permit {{ permit.number }} approved'),
    });
    expect(saved.status).toBe(201);

    const pinned = await api.pin('email-escape');
    const { parts } = await rendered({
      pinned,
      channel: 'email',
      data: data({ permit: { number: '<b>P-1 & co</b>' } }),
    });

    if (parts.channel !== 'email') throw new Error('Expected email parts');
    expect(parts.html).toMatch(/^<!doctype html>/i);
    expect(parts.html).toContain('Permit &lt;b&gt;P-1 &amp; co&lt;/b&gt; approved');
    expect(parts.html).not.toContain('<b>P-1');
    expect(parts.subject).toBe('Permit <b>P-1 & co</b>');
    expect(parts.text.trim()).toBe('Permit <b>P-1 & co</b> approved');
  });
});

describe('in-app (R21, R24, KTD6)', () => {
  const inApp = {
    title: 'Permit {{ permit.number }}',
    body: 'Hello {{ message | default: "" }}',
    actionUrl: '{{ link | default: "" }}',
  };
  let pinned: Awaited<ReturnType<TemplatesApi['pin']>>;

  beforeAll(async () => {
    await api.defineType(permitType('in-app-links'));
    ensureSaved(await api.save('in-app-links', 'in-app', 'en-CA', inApp));
    pinned = await api.pin('in-app-links');
  });

  it('accepts an absolute https action link or a relative path, and none when it renders empty', async () => {
    const links = await Promise.all(
      ['https://permits.gov.bc.ca/p/1', '/permits/1', ''].map(async (link) => {
        const { parts } = await rendered({ pinned, channel: 'in-app', data: data({ link }) });
        return parts.channel === 'in-app' ? parts.actionUrl : undefined;
      }),
    );
    expect(links).toEqual(['https://permits.gov.bc.ca/p/1', '/permits/1', null]);
  });

  it('fails the render when sender data makes the action link anything else', async () => {
    const attempts = ['javascript:alert(1)', 'java\tscript:alert(1)', 'http://permits.gov.bc.ca', '//evil.example'];
    const results = await Promise.allSettled(
      attempts.map((link) => render({ pinned, channel: 'in-app', data: data({ link }) })),
    );
    const outcomes = results.map((result) => (result.status === 'rejected' ? String(result.reason) : 'rendered'));
    expect(outcomes).toEqual(attempts.map(() => expect.stringContaining('actionUrl: Must be an absolute https URL')));
  });

  it('renders Markdown to sanitized HTML: a script tag is text and a javascript: link loses its URL', async () => {
    const { parts } = await rendered({
      pinned,
      channel: 'in-app',
      data: data({ message: '**now** <script>alert(1)</script> [click](javascript:alert(1))' }),
    });

    if (parts.channel !== 'in-app') throw new Error('Expected in-app parts');
    expect(parts.body).toContain('<strong>now</strong>');
    expect(parts.body).not.toContain('<script');
    expect(parts.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(parts.body).not.toContain('javascript:');
    expect(parts.title).toBe('Permit P-1');
  });
});

describe('languages and time zones (R24, R39)', () => {
  let pinned: Awaited<ReturnType<TemplatesApi['pin']>>;

  beforeAll(async () => {
    await api.defineType(permitType('expiry'));
    const parts = { title: 'Expires {{ expires_at | date: "long" }}', body: 'x' };
    const saves = await Promise.all([
      api.save('expiry', 'in-app', 'en-CA', parts),
      api.save('expiry', 'in-app', 'fr-CA', { ...parts, title: 'Expire le {{ expires_at | date: "long" }}' }),
    ]);
    saves.forEach(ensureSaved);
    pinned = await api.pin('expiry');
  });

  const title = async (language: string | null, timeZone: string | null, expiresAt = '2027-03-04T19:00:00Z') => {
    const result = await rendered({
      pinned,
      channel: 'in-app',
      language,
      timeZone,
      data: data({ expires_at: expiresAt }),
    });
    return [result.language, result.parts.channel === 'in-app' ? result.parts.title : null];
  };

  it('formats dates in the template language', async () => {
    expect(await title('en-CA', 'America/Vancouver')).toEqual(['en-CA', 'Expires March 4, 2027']);
    expect(await title('fr-CA', 'America/Vancouver')).toEqual(['fr-CA', 'Expire le 4 mars 2027']);
  });

  it('formats in the recipient zone, or the platform default zone when the recipient has none', async () => {
    // 03:00 UTC on March 5 is 19:00 on March 4 in Vancouver (the test environment's DEFAULT_TIMEZONE default).
    expect(await title('en-CA', 'UTC', '2027-03-05T03:00:00Z')).toEqual(['en-CA', 'Expires March 5, 2027']);
    expect(await title('en-CA', null, '2027-03-05T03:00:00Z')).toEqual(['en-CA', 'Expires March 4, 2027']);
  });

  it('falls back to the type default language when the recipient language has no template (AE9)', async () => {
    expect(await title('de-DE', 'UTC')).toEqual(['en-CA', 'Expires March 4, 2027']);
    expect(await title(null, 'UTC')).toEqual(['en-CA', 'Expires March 4, 2027']);
  });

  it('reports no template for a channel the type has none for (R14)', async () => {
    expect(await render({ pinned, channel: 'webhook', data: data() })).toEqual({ status: 'no-template' });
    expect(await render({ pinned, channel: 'email', data: data() })).toEqual({ status: 'no-template' });
  });
});

const layout = (marker: string) => mjml(`${marker} {% block content %}{% endblock %}`);

describe('pinned versions (R25, KTD7)', () => {
  it('renders a notification pinned to version 3 with version 3 and its layout after version 4 (AE10)', async () => {
    await api.defineType(permitType('pinned'));
    expect((await api.saveLayout('permit-frame', layout('Frame one'))).status).toBe(201);
    const save = (version: number) =>
      api.save('pinned', 'email', 'en-CA', {
        subject: `Version ${version}`,
        html: `{% layout "permit-frame" %}{% block content %}Body ${version}{% endblock %}`,
      });
    expect((await save(1)).body.version).toBe(1);
    expect((await save(2)).body.version).toBe(2);
    expect((await save(3)).body.version).toBe(3);
    const atVersion3 = await api.pin('pinned');

    expect((await api.saveLayout('permit-frame', layout('Frame two'))).body.version).toBe(2);
    expect((await save(4)).body.version).toBe(4);

    const [old, current] = await Promise.all([
      rendered({ pinned: atVersion3, channel: 'email', data: data() }),
      rendered({ pinned: await api.pin('pinned'), channel: 'email', data: data() }),
    ]);
    const summary = (result: typeof old) =>
      result.parts.channel === 'email' ? [result.parts.subject, result.parts.text.trim()] : null;
    expect(summary(old)).toEqual(['Version 3', 'Frame one Body 3']);
    expect(summary(current)).toEqual(['Version 4', 'Frame two Body 4']);
  });
});
