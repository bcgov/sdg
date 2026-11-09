import 'reflect-metadata';
import { Global, Module, RequestMethod, type FactoryProvider, type MiddlewareConsumer } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDrizzleToken } from '@nestjs/drizzle';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { createMockConfig } from '../../test/utils/config.service.js';
import { isRequest } from '../../test/utils/http.js';
import type { PortalDatabase } from '../database/database.module.js';
import { PostgresSessionStore } from './postgres-session.store.js';
import { SESSION_COOKIE, SESSION_STORE, SessionModule, sessionOp } from './session.module.js';

interface MockSession {
  save: (fn: (err?: unknown) => void) => void;
  regenerate: (fn: (err?: unknown) => void) => void;
  destroy: (fn: (err?: unknown) => void) => void;
}

function createRequestWithSession(sessionObj: MockSession): Request {
  const req: unknown = { session: sessionObj };
  if (isRequest(req)) return req;
  throw new Error('Invalid request');
}

function isPortalDatabase(value: unknown): value is PortalDatabase {
  return typeof value === 'object' && value !== null;
}

function createMockDatabase(): PortalDatabase {
  const db: unknown = {};
  if (isPortalDatabase(db)) return db;
  throw new Error('Invalid database');
}

function createMockStore(): PostgresSessionStore {
  return new PostgresSessionStore(createMockDatabase(), {
    key: Buffer.alloc(32),
    ttlSeconds: 1800,
  });
}

type ForRoutesFn = (route: { path: string; method: RequestMethod }) => MiddlewareConsumer;
type ApplyFn = (...middleware: unknown[]) => MockMiddlewareConfigProxy;

interface MockMiddlewareConfigProxy {
  forRoutes: Mock<ForRoutesFn>;
}

function isMiddlewareConsumer(value: unknown): value is MiddlewareConsumer {
  return typeof value === 'object' && value !== null && 'apply' in value;
}

function createMockConsumer(): {
  consumer: MiddlewareConsumer;
  applyMock: Mock<ApplyFn>;
  forRoutesMock: Mock<ForRoutesFn>;
} {
  const forRoutesMock = vi.fn<ForRoutesFn>();
  const proxy: MockMiddlewareConfigProxy = { forRoutes: forRoutesMock };
  const applyMock = vi.fn<ApplyFn>(() => proxy);
  const consumerObj: unknown = { apply: applyMock };
  if (isMiddlewareConsumer(consumerObj)) {
    return { consumer: consumerObj, applyMock, forRoutesMock };
  }
  throw new Error('Invalid middleware consumer');
}

@Global()
@Module({})
class TestConfigModule {}

describe('SessionModule Unit Test Suite', () => {
  it('Should define SESSION_STORE provider with getDrizzleToken and ConfigService injection', () => {
    const providers: unknown[] = Reflect.getMetadata('providers', SessionModule) ?? [];
    const provider = providers.find(
      (p): p is FactoryProvider<PostgresSessionStore> =>
        typeof p === 'object' && p !== null && 'provide' in p && p.provide === SESSION_STORE,
    );

    expect(provider).toBeDefined();
    expect(provider!.inject).toEqual([getDrizzleToken(), ConfigService]);

    const mockDb = createMockDatabase();
    const { config: mockConfig, getMock } = createMockConfig({
      SESSION_SECRET: 's'.repeat(32),
      SESSION_TTL_SECONDS: 3600,
    });

    const store = provider!.useFactory(mockDb, mockConfig);
    expect(store).toBeInstanceOf(PostgresSessionStore);
    expect(getMock).toHaveBeenCalledWith('SESSION_SECRET', { infer: true });
    expect(getMock).toHaveBeenCalledWith('SESSION_TTL_SECONDS', { infer: true });
  });

  describe('configure', () => {
    it('Should configure session middleware with secure cookies when APP_URL uses https', () => {
      const { config: mockConfig, getMock } = createMockConfig({
        APP_URL: 'https://portal.example.com',
        SESSION_SECRET: 's'.repeat(32),
        SESSION_TTL_SECONDS: 1800,
      });
      const mockStore = createMockStore();
      const module = new SessionModule(mockConfig, mockStore);

      const { consumer, applyMock, forRoutesMock } = createMockConsumer();
      module.configure(consumer);

      expect(applyMock).toHaveBeenCalledTimes(1);
      expect(forRoutesMock).toHaveBeenCalledWith({
        path: '*path',
        method: RequestMethod.ALL,
      });
      expect(getMock).toHaveBeenCalledWith('SESSION_TTL_SECONDS', { infer: true });
      expect(getMock).toHaveBeenCalledWith('SESSION_SECRET', { infer: true });
      expect(getMock).toHaveBeenCalledWith('APP_URL', { infer: true });
    });

    it('Should configure session middleware with non-secure cookies when APP_URL uses http', () => {
      const { config: mockConfig } = createMockConfig({
        APP_URL: 'http://localhost:5173',
        SESSION_SECRET: 's'.repeat(32),
        SESSION_TTL_SECONDS: 3600,
      });
      const mockStore = createMockStore();
      const module = new SessionModule(mockConfig, mockStore);

      const { consumer, applyMock, forRoutesMock } = createMockConsumer();
      module.configure(consumer);

      expect(applyMock).toHaveBeenCalledTimes(1);
      expect(forRoutesMock).toHaveBeenCalledWith({
        path: '*path',
        method: RequestMethod.ALL,
      });
    });
  });

  describe('module compilation', () => {
    it('Should compile inside a NestJS testing module', async () => {
      const { config: mockConfig } = createMockConfig({
        APP_URL: 'https://portal.example.com',
        SESSION_SECRET: 's'.repeat(32),
        SESSION_TTL_SECONDS: 3600,
      });
      const mockDb = createMockDatabase();

      const moduleRef = await Test.createTestingModule({
        imports: [
          SessionModule,
          {
            module: TestConfigModule,
            providers: [
              { provide: ConfigService, useValue: mockConfig },
              { provide: getDrizzleToken(), useValue: mockDb },
            ],
            exports: [ConfigService, getDrizzleToken()],
            global: true,
          },
        ],
      }).compile();

      expect(moduleRef).toBeDefined();
      expect(moduleRef.get(SessionModule)).toBeInstanceOf(SessionModule);
      expect(moduleRef.get(SESSION_STORE)).toBeInstanceOf(PostgresSessionStore);
    });
  });

  describe('constants', () => {
    it('Should export expected cookie name and store symbol', () => {
      expect(SESSION_COOKIE).toBe('portal.sid');
      expect(typeof SESSION_STORE).toBe('symbol');
    });
  });

  describe('SessionOp', () => {
    it('Should resolve when save succeeds', async () => {
      const sessionObj: MockSession = {
        save: vi.fn<(fn: (err?: unknown) => void) => void>((cb) => cb()),
        regenerate: vi.fn<(fn: (err?: unknown) => void) => void>(),
        destroy: vi.fn<(fn: (err?: unknown) => void) => void>(),
      };
      const req = createRequestWithSession(sessionObj);
      await expect(sessionOp(req, 'save')).resolves.toBeUndefined();
      expect(sessionObj.save).toHaveBeenCalledTimes(1);
    });

    it('Should resolve when regenerate succeeds', async () => {
      const sessionObj: MockSession = {
        save: vi.fn<(fn: (err?: unknown) => void) => void>(),
        regenerate: vi.fn<(fn: (err?: unknown) => void) => void>((cb) => cb()),
        destroy: vi.fn<(fn: (err?: unknown) => void) => void>(),
      };
      const req = createRequestWithSession(sessionObj);
      await expect(sessionOp(req, 'regenerate')).resolves.toBeUndefined();
      expect(sessionObj.regenerate).toHaveBeenCalledTimes(1);
    });

    it('Should resolve when destroy succeeds', async () => {
      const sessionObj: MockSession = {
        save: vi.fn<(fn: (err?: unknown) => void) => void>(),
        regenerate: vi.fn<(fn: (err?: unknown) => void) => void>(),
        destroy: vi.fn<(fn: (err?: unknown) => void) => void>((cb) => cb()),
      };
      const req = createRequestWithSession(sessionObj);
      await expect(sessionOp(req, 'destroy')).resolves.toBeUndefined();
      expect(sessionObj.destroy).toHaveBeenCalledTimes(1);
    });

    it('Should reject with the original error when error is an Error instance', async () => {
      const originalError = new Error('Save error');
      const sessionObj: MockSession = {
        save: vi.fn<(fn: (err?: unknown) => void) => void>((cb) => cb(originalError)),
        regenerate: vi.fn<(fn: (err?: unknown) => void) => void>(),
        destroy: vi.fn<(fn: (err?: unknown) => void) => void>(),
      };
      const req = createRequestWithSession(sessionObj);
      await expect(sessionOp(req, 'save')).rejects.toThrow('Save error');
    });

    it('Should reject with a wrapped Error when error is not an Error instance', async () => {
      const sessionObj: MockSession = {
        save: vi.fn<(fn: (err?: unknown) => void) => void>(),
        regenerate: vi.fn<(fn: (err?: unknown) => void) => void>(),
        destroy: vi.fn<(fn: (err?: unknown) => void) => void>((cb) => cb('string failure')),
      };
      const req = createRequestWithSession(sessionObj);
      let caughtError: unknown;
      try {
        await sessionOp(req, 'destroy');
      } catch (error) {
        caughtError = error;
      }
      expect(caughtError).toBeInstanceOf(Error);
      expect(caughtError).toMatchObject({
        message: 'Session destroy failed',
        cause: 'string failure',
      });
    });
  });
});
