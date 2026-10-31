import 'reflect-metadata';
import { Global, Module, type DynamicModule, type FactoryProvider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { OidcClient } from '@repo/auth';
import { OIDC_CLIENT } from '@repo/auth/nestjs';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { AuthController } from '../../../src/auth/auth.controller.js';
import { AuthModule } from '../../../src/auth/auth.module.js';
import { SessionAuthGuard } from '../../../src/auth/session-auth.guard.js';
import type { Env } from '../../../src/config/env.js';
import { PrincipalsModule } from '../../../src/principals/principals.module.js';
import { PrincipalsService } from '../../../src/principals/principals.service.js';

type MockEnv = Pick<Env, 'APP_URL' | 'KEYCLOAK_ISSUER_URL' | 'KEYCLOAK_CLIENT_ID' | 'KEYCLOAK_CLIENT_SECRET'>;

type MockConfigGet = (key: keyof MockEnv, options?: { infer: true }) => string;

interface MockConfigService {
  get: Mock<MockConfigGet>;
}

function createMockEnvConfig(env: MockEnv): MockConfigService {
  return {
    get: vi.fn<MockConfigGet>((key: keyof MockEnv, _options?: { infer: true }) => env[key]),
  };
}

const getOidcModuleProvider = (module: object) => {
  const imports: unknown[] = Reflect.getMetadata('imports', module) ?? [];
  const oidcDynamicModule = imports.find(
    (item): item is DynamicModule => typeof item === 'object' && item !== null && 'module' in item,
  );

  const provider = oidcDynamicModule?.providers?.find(
    (p): p is FactoryProvider<Promise<OidcClient>> =>
      typeof p === 'object' && p !== null && 'provide' in p && p.provide === OIDC_CLIENT && 'useFactory' in p,
  );
  return { oidcDynamicModule, provider };
};

describe('AuthModule Unit Test Suite', () => {
  it('Should define module metadata with expected imports, controllers, providers and exports', () => {
    const imports: unknown[] = Reflect.getMetadata('imports', AuthModule) ?? [];
    const controllers: unknown[] = Reflect.getMetadata('controllers', AuthModule) ?? [];
    const providers: unknown[] = Reflect.getMetadata('providers', AuthModule) ?? [];
    const exports: unknown[] = Reflect.getMetadata('exports', AuthModule) ?? [];

    expect(controllers).toEqual([AuthController]);
    expect(providers).toEqual([SessionAuthGuard]);
    expect(imports).toContain(PrincipalsModule);

    const oidcDynamicModule = imports.find(
      (item): item is DynamicModule => typeof item === 'object' && item !== null && 'module' in item,
    );
    expect(oidcDynamicModule).toBeDefined();
    expect(exports).toContain(oidcDynamicModule);
  });

  it('Should configure OidcModule options correctly when KEYCLOAK_ISSUER_URL uses http (insecure allowed)', async () => {
    const { oidcDynamicModule, provider } = getOidcModuleProvider(AuthModule);
    expect(oidcDynamicModule).toBeDefined();
    expect(provider).toBeDefined();
    expect(provider!.inject).toEqual([ConfigService]);

    const mockConfig = createMockEnvConfig({
      APP_URL: 'http://localhost:5173',
      KEYCLOAK_ISSUER_URL: 'http://localhost:8080/realms/portal',
      KEYCLOAK_CLIENT_ID: 'portal-app',
      KEYCLOAK_CLIENT_SECRET: 'test-secret',
    });

    const client = await provider!.useFactory(mockConfig);
    expect(client).toBeDefined();
    expect(mockConfig.get).toHaveBeenCalledWith('APP_URL', { infer: true });
    expect(mockConfig.get).toHaveBeenCalledWith('KEYCLOAK_ISSUER_URL', {
      infer: true,
    });
    expect(mockConfig.get).toHaveBeenCalledWith('KEYCLOAK_CLIENT_ID', {
      infer: true,
    });
    expect(mockConfig.get).toHaveBeenCalledWith('KEYCLOAK_CLIENT_SECRET', {
      infer: true,
    });
  });

  it('Should configure OidcModule options correctly when KEYCLOAK_ISSUER_URL uses https (insecure disallowed)', async () => {
    const { oidcDynamicModule, provider } = getOidcModuleProvider(AuthModule);
    expect(oidcDynamicModule).toBeDefined();
    expect(provider).toBeDefined();

    const mockConfig = createMockEnvConfig({
      APP_URL: 'https://portal.example.com',
      KEYCLOAK_ISSUER_URL: 'https://keycloak.example.com/realms/portal',
      KEYCLOAK_CLIENT_ID: 'portal-prod',
      KEYCLOAK_CLIENT_SECRET: 'prod-secret',
    });

    const client = await provider!.useFactory(mockConfig);
    expect(client).toBeDefined();
    expect(mockConfig.get).toHaveBeenCalledWith('KEYCLOAK_ISSUER_URL', {
      infer: true,
    });
  });

  it('Should compile within a NestJS testing module and provide all dependencies', async () => {
    const mockConfig = createMockEnvConfig({
      APP_URL: 'http://localhost:5173',
      KEYCLOAK_ISSUER_URL: 'http://localhost:8080/realms/portal',
      KEYCLOAK_CLIENT_ID: 'portal-app',
      KEYCLOAK_CLIENT_SECRET: 'test-secret',
    });

    @Global()
    @Module({
      providers: [
        {
          provide: ConfigService,
          useValue: mockConfig,
        },
      ],
      exports: [ConfigService],
    })
    class TestConfigModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [TestConfigModule, AuthModule],
    })
      .overrideModule(PrincipalsModule)
      .useModule({
        module: PrincipalsModule,
        providers: [
          {
            provide: PrincipalsService,
            useValue: {
              upsertFromLogin: vi.fn<() => void>(),
            },
          },
        ],
        exports: [PrincipalsService],
      })
      .compile();

    const authModule = moduleRef.get(AuthModule);
    expect(authModule).toBeInstanceOf(AuthModule);

    const guard = moduleRef.get(SessionAuthGuard);
    expect(guard).toBeInstanceOf(SessionAuthGuard);

    const controller = moduleRef.get(AuthController);
    expect(controller).toBeInstanceOf(AuthController);

    const oidcClient = moduleRef.get(OIDC_CLIENT);
    expect(oidcClient).toBeDefined();

    await moduleRef.close();
  });
});
