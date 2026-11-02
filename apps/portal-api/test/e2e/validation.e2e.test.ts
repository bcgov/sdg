import { Body, Controller, Post } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp, resetOidcStub, type TestApp } from '../../src/testing/app.js';

const probeSchema = z.object({
  name: z.string().min(1),
  count: z.coerce.number().int(),
});

/** Test-only controller: proves the global StandardSchemaValidationPipe validates `{ schema }` params. */
@Controller({ path: 'probe', version: '1' })
class ProbeController {
  @Post()
  create(@Body({ schema: probeSchema }) body: z.infer<typeof probeSchema>): z.infer<typeof probeSchema> {
    return body;
  }
}

describe('Global StandardSchemaValidationPipe Integration Test Suite', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ controllers: [ProbeController] });
  });

  afterAll(() => t.close());

  beforeEach(() => resetOidcStub(t.oidc));

  it('Should return the parsed (coerced) value for a valid body', async () => {
    const res = await t.http().post('/api/v1/probe').send({ name: 'ada', count: '3' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ name: 'ada', count: 3 });
    expect(typeof res.body.count).toBe('number');
  });

  it('Should return 400 with path-prefixed messages for an invalid body', async () => {
    const res = await t.http().post('/api/v1/probe').send({ name: '', count: 'many' });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.message).toEqual(
      expect.arrayContaining([expect.stringContaining('name'), expect.stringContaining('count')]),
    );
  });

  it('Should keep the login fallback: a repeated returnTo redirects with returnTo "/" instead of 400', async () => {
    const res = await t.http().get('/api/auth/login?returnTo=/a&returnTo=/b');
    expect(res.status).toBe(302);
    expect(t.oidc.createAuthorizationRequest).toHaveBeenCalledWith('/');
  });

  it('Should pass a valid relative returnTo through to the authorization request', async () => {
    const res = await t.http().get('/api/auth/login?returnTo=/reports?tab=2');
    expect(res.status).toBe(302);
    expect(t.oidc.createAuthorizationRequest).toHaveBeenCalledWith('/reports?tab=2');
  });
});
