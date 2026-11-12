import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

interface OpenApiDocument {
  openapi: string;
  info: { title: string };
  paths: Record<string, unknown>;
  components: { securitySchemes?: Record<string, { type: string; in: string; name: string }> };
}

describe('OpenAPI (non-production) Unit Test Suite', () => {
  let t: TestApp;
  let doc: OpenApiDocument;

  beforeAll(async () => {
    t = await createTestApp();
    doc = (await t.http().get('/api/docs-json')).body;
  });

  afterAll(() => t.close());

  it('Should serve the Console API document at /api/docs-json', () => {
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe('Console API');
  });

  it('Should document the auth and health routes', () => {
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/auth/login',
        '/api/auth/callback',
        '/api/auth/me',
        '/api/auth/logout',
        '/healthz/live',
        '/healthz/ready',
      ]),
    );
  });

  it('Should declare the console.sid cookie as the session security scheme', () => {
    expect(doc.components.securitySchemes?.['session']).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'console.sid' }),
    );
  });
});
