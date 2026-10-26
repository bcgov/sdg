import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from '../testing/app.js';

interface SchemaObject {
  type?: string;
  properties?: Record<string, SchemaObject>;
  required?: string[];
}

interface Operation {
  parameters?: { name: string; in: string; required?: boolean }[];
  responses: Record<string, { content?: Record<string, { schema: SchemaObject }> }>;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string };
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes?: Record<string, { type: string; in: string; name: string }> };
}

describe('OpenAPI (non-production)', () => {
  let t: TestApp;
  let doc: OpenApiDocument;

  beforeAll(async () => {
    t = await createTestApp();
    const res = await t.http().get('/api/docs-json');
    doc = res.body;
  });

  afterAll(() => t.close());

  it('serves the OpenAPI 3 document at /api/docs-json', async () => {
    const res = await t.http().get('/api/docs-json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(doc.openapi).toMatch(/^3\./);
    expect(doc.info.title).toBe('Portal API');
  });

  it('serves Swagger UI at /api/docs without a session cookie', async () => {
    const res = await t.http().get('/api/docs').redirects(1);
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('documents the auth and health routes', () => {
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

  it('derives the /api/auth/me 200 schema from zod and documents 401', () => {
    const me = doc.paths['/api/auth/me']!.get!;
    const schema = me.responses['200']?.content?.['application/json']?.schema;
    expect(schema?.type).toBe('object');
    expect(Object.keys(schema?.properties ?? {})).toEqual(['id', 'name', 'email']);
    expect(schema?.required).toEqual(['id', 'name', 'email']);
    expect(me.responses['401']).toBeDefined();
  });

  it('documents the login returnTo query parameter and the logout response', () => {
    const params = doc.paths['/api/auth/login']!.get!.parameters ?? [];
    expect(params).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'returnTo', in: 'query' })]));
    expect(params.find((p) => p.name === 'returnTo')?.required).not.toBe(true);
    const logout = doc.paths['/api/auth/logout']!.post!.responses['200']?.content?.['application/json']?.schema;
    expect(logout?.properties?.redirectUrl?.type).toBe('string');
  });

  it('declares the portal.sid cookie as the security scheme', () => {
    expect(doc.components.securitySchemes?.['portal.sid']).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'portal.sid' }),
    );
  });
});
