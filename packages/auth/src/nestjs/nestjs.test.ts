import 'reflect-metadata';
import { Controller, Get, Inject, Logger, Module, UseGuards, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CLIENT_ID, CLIENT_SECRET, startFakeIdp, type FakeIdp } from '../test-support/fake-idp.js';
import type { AuthUser, JwtVerifier, OidcClient, OidcClientOptions } from '../types.js';
import { CurrentUser, JWT_VERIFIER, JwtAuthGuard, JwtAuthModule, OIDC_CLIENT, OidcModule } from './index.js';

const CONFIG = Symbol('CONFIG');

interface TestConfig {
  issuerUrl: string;
}

let idp: FakeIdp;

@Module({})
class ConfigModule {
  static with(config: TestConfig) {
    return { module: ConfigModule, providers: [{ provide: CONFIG, useValue: config }], exports: [CONFIG] };
  }
}

@Controller()
class TestController {
  @Get('protected')
  @UseGuards(JwtAuthGuard)
  protected(@CurrentUser() user: AuthUser): { subject: string; name: string } {
    return { subject: user.subject, name: user.name };
  }

  @Get('open')
  open(@CurrentUser() user: AuthUser | undefined): { user: AuthUser | null } {
    return { user: user ?? null };
  }
}

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      JwtAuthModule.forRootAsync({
        imports: [ConfigModule.with({ issuerUrl: idp.issuer })],
        inject: [CONFIG],
        useFactory: (config: TestConfig) => ({ issuerUrl: config.issuerUrl, audience: CLIENT_ID }),
      }),
    ],
    controllers: [TestController],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

beforeAll(async () => {
  idp = await startFakeIdp();
});
afterAll(() => idp.close());

describe('@repo/auth/nestjs', () => {
  describe('OidcModule', () => {
    it('provides OIDC_CLIENT from forRootAsync with injected config', async () => {
      const factory = vi.fn<(config: TestConfig) => OidcClientOptions>((config: TestConfig): OidcClientOptions => ({
        issuerUrl: config.issuerUrl,
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
        redirectUri: 'http://app.test/api/auth/callback',
        postLogoutRedirectUri: 'http://app.test/',
        allowInsecureRequests: true,
      }));
      @Module({
        imports: [
          OidcModule.forRootAsync({
            imports: [ConfigModule.with({ issuerUrl: idp.issuer })],
            inject: [CONFIG],
            useFactory: factory,
          }),
        ],
      })
      class AppModule {
        readonly client: OidcClient;
        constructor(@Inject(OIDC_CLIENT) client: OidcClient) {
          this.client = client;
        }
      }
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      expect(factory).toHaveBeenCalledWith({ issuerUrl: idp.issuer });
      const client = moduleRef.get<OidcClient>(OIDC_CLIENT);
      expect(moduleRef.get(AppModule).client).toBe(client);
      const { url } = await client.createAuthorizationRequest('/');
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      await moduleRef.close();
    });
  });

  describe('JwtAuthGuard', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp();
    });
    afterAll(() => app.close());

    it('exports JWT_VERIFIER and the guard', () => {
      expect(typeof app.get<JwtVerifier>(JWT_VERIFIER).verify).toBe('function');
      expect(app.get(JwtAuthGuard)).toBeInstanceOf(JwtAuthGuard);
    });
    it('sets request.user and allows a valid bearer token', async () => {
      const token = await idp.sign({ sub: 'svc-1', name: 'Service One' });
      const response = await request(app.getHttpServer()).get('/protected').set('Authorization', `Bearer ${token}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ subject: 'svc-1', name: 'Service One' });
    });
    it('returns 401 without an Authorization header', async () => {
      const response = await request(app.getHttpServer()).get('/protected');
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    });
    it('returns 401 for a malformed header or invalid token without echoing the error', async () => {
      const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
      const expired = await idp.sign({ sub: 'x' }, { expiresIn: Math.floor(Date.now() / 1000) - 300 });
      const headers = ['Basic dXNlcjpwYXNz', 'Bearer', 'bearer abc', `Bearer ${expired}`, `Bearer ${expired} x`];
      const responses = await Promise.all(
        headers.map((header) => request(app.getHttpServer()).get('/protected').set('Authorization', header)),
      );
      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
        expect(response.text).not.toMatch(/exp|claim|timestamp/i);
      }
      const logged = debug.mock.calls.map(([message]) => String(message)).join('\n');
      expect(logged).toMatch(/exp/);
      expect(logged).not.toContain(expired);
      debug.mockRestore();
    });
  });

  describe('CurrentUser', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await createApp();
    });
    afterAll(() => app.close());

    it('injects request.user into the handler', async () => {
      const token = await idp.sign({ sub: 'svc-2', preferred_username: 'svc2' });
      const guarded = await request(app.getHttpServer()).get('/protected').set('Authorization', `Bearer ${token}`);
      expect(guarded.body).toEqual({ subject: 'svc-2', name: 'svc2' });
    });
    it('is undefined on unguarded routes', async () => {
      const response = await request(app.getHttpServer()).get('/open');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ user: null });
    });
  });
});
