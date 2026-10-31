import 'reflect-metadata';
import { Global, Logger, Module, type FactoryProvider, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
  createValkeyClient,
  VALKEY_CLIENT,
  ValkeyModule,
  type ValkeyClient,
} from '../../../src/valkey/valkey.module.js';
import { createMockConfig } from '../../utils/config.service.js';

type ErrorListener = (error: unknown) => void;
type OnFn = (event: string, listener: ErrorListener) => MockRedisClient;
type AsyncFn = () => Promise<void>;
type VoidFn = () => void;

interface MockRedisClient {
  isOpen: boolean;
  on: Mock<OnFn>;
  connect: Mock<AsyncFn>;
  close: Mock<AsyncFn>;
  destroy: Mock<VoidFn>;
}

function isValkeyClient(value: unknown): value is ValkeyClient {
  return typeof value === 'object' && value !== null;
}

function createMockRedisClient(
  options: {
    isOpen?: boolean;
    connectPromise?: Promise<void>;
  } = {},
): {
  client: ValkeyClient;
  mock: MockRedisClient;
  listeners: Map<string, ErrorListener[]>;
} {
  const listeners = new Map<string, ErrorListener[]>();
  const onMock = vi.fn<OnFn>((event, listener) => {
    const list = listeners.get(event) ?? [];
    list.push(listener);
    listeners.set(event, list);
    return mock;
  });
  const connectMock = vi.fn<AsyncFn>(() => options.connectPromise ?? Promise.resolve());
  const closeMock = vi.fn<AsyncFn>(() => Promise.resolve());
  const destroyMock = vi.fn<VoidFn>();

  const mock: MockRedisClient = {
    isOpen: options.isOpen ?? false,
    on: onMock,
    connect: connectMock,
    close: closeMock,
    destroy: destroyMock,
  };

  const clientUnknown: unknown = mock;
  if (isValkeyClient(clientUnknown)) {
    return { client: clientUnknown, mock, listeners };
  }
  throw new Error('Invalid Valkey client');
}

const createClientMock = vi.fn<(options?: { url?: string }) => ValkeyClient>();

vi.mock('redis', () => ({
  createClient: (options?: { url?: string }) => createClientMock(options),
}));

interface LifecycleConstructor {
  new (client: ValkeyClient): OnApplicationShutdown;
}

function isLifecycleConstructor(value: unknown): value is LifecycleConstructor {
  return typeof value === 'function';
}

function getValkeyLifecycleClass(): LifecycleConstructor {
  const providers: unknown[] = Reflect.getMetadata('providers', ValkeyModule) ?? [];
  const found = providers.find(isLifecycleConstructor);
  if (found) return found;
  throw new Error('ValkeyLifecycle not found in ValkeyModule providers');
}

@Global()
@Module({})
class TestConfigModule {}

describe('ValkeyModule Unit Test Suite', () => {
  let loggerErrorSpy: Mock<(message: unknown, stackOrContext?: string) => void>;

  beforeEach(() => {
    loggerErrorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createValkeyClient', () => {
    it('Should create client, registers error listener and connects', async () => {
      const { client, mock, listeners } = createMockRedisClient();
      createClientMock.mockReturnValue(client);

      const returnedClient = createValkeyClient('redis://localhost:6379');
      expect(returnedClient).toBe(client);
      expect(createClientMock).toHaveBeenCalledWith({
        url: 'redis://localhost:6379',
      });
      expect(mock.connect).toHaveBeenCalledTimes(1);

      // Trigger error listener with Error instance
      const errorListeners = listeners.get('error') ?? [];
      expect(errorListeners.length).toBeGreaterThan(0);
      const firstListener = errorListeners[0]!;
      const errorObj = new Error('Connection dropped');
      firstListener(errorObj);
      expect(loggerErrorSpy).toHaveBeenCalledWith('Valkey connection error', errorObj.stack);

      // Trigger error listener with non-Error value
      firstListener('string-error-message');
      expect(loggerErrorSpy).toHaveBeenCalledWith('Valkey connection error', 'string-error-message');
    });

    it('Should log error when connect rejects with an Error instance', async () => {
      const connectError = new Error('Connect failure');
      const { client } = createMockRedisClient({
        connectPromise: Promise.reject(connectError),
      });
      createClientMock.mockReturnValue(client);

      createValkeyClient('redis://localhost:6379');
      // Allow the catch microtask to execute
      await Promise.resolve();

      expect(loggerErrorSpy).toHaveBeenCalledWith('Valkey initial connection failed', connectError.stack);
    });

    it('Should log error when connect rejects with a non-Error value', async () => {
      const { client } = createMockRedisClient({
        connectPromise: Promise.reject('raw-connect-error'),
      });
      createClientMock.mockReturnValue(client);

      createValkeyClient('redis://localhost:6379');
      // Allow the catch microtask to execute
      await Promise.resolve();

      expect(loggerErrorSpy).toHaveBeenCalledWith('Valkey initial connection failed', 'raw-connect-error');
    });
  });

  describe('ValkeyLifecycle', () => {
    const LifecycleClass = getValkeyLifecycleClass();

    it('Should close open client on application shutdown', async () => {
      const { client, mock } = createMockRedisClient({ isOpen: true });
      const lifecycle = new LifecycleClass(client);

      await lifecycle.onApplicationShutdown();
      expect(mock.close).toHaveBeenCalledTimes(1);
      expect(mock.destroy).not.toHaveBeenCalled();
    });

    it('Should destroy non-open client on application shutdown', async () => {
      const { client, mock } = createMockRedisClient({ isOpen: false });
      const lifecycle = new LifecycleClass(client);

      await lifecycle.onApplicationShutdown();
      expect(mock.destroy).toHaveBeenCalledTimes(1);
      expect(mock.close).not.toHaveBeenCalled();
    });
  });

  describe('module metadata and integration', () => {
    it('Should define VALKEY_CLIENT factory provider injecting ConfigService', () => {
      const providers: unknown[] = Reflect.getMetadata('providers', ValkeyModule) ?? [];
      const factoryProvider = providers.find(
        (p): p is FactoryProvider<ValkeyClient> =>
          typeof p === 'object' && p !== null && 'provide' in p && p.provide === VALKEY_CLIENT,
      );

      expect(factoryProvider).toBeDefined();
      expect(factoryProvider!.inject).toEqual([ConfigService]);

      const { client } = createMockRedisClient();
      createClientMock.mockReturnValue(client);

      const { config, getMock } = createMockConfig({
        VALKEY_URL: 'redis://localhost:6379',
      });
      const resolvedClient = factoryProvider!.useFactory(config);

      expect(resolvedClient).toBe(client);
      expect(getMock).toHaveBeenCalledWith('VALKEY_URL', { infer: true });
    });

    it('Should export VALKEY_CLIENT provider', () => {
      const exportsList: unknown[] = Reflect.getMetadata('exports', ValkeyModule) ?? [];
      expect(exportsList).toContain(VALKEY_CLIENT);
    });

    it('Should compile in a NestJS testing module and runs lifecycle shutdown', async () => {
      const { client, mock } = createMockRedisClient({ isOpen: true });
      createClientMock.mockReturnValue(client);

      const { config } = createMockConfig({
        VALKEY_URL: 'redis://localhost:6379',
      });

      const moduleRef = await Test.createTestingModule({
        imports: [
          ValkeyModule,
          {
            module: TestConfigModule,
            providers: [{ provide: ConfigService, useValue: config }],
            exports: [ConfigService],
            global: true,
          },
        ],
      }).compile();

      expect(moduleRef).toBeDefined();
      expect(moduleRef.get(VALKEY_CLIENT)).toBe(client);

      await moduleRef.close();
      expect(mock.close).toHaveBeenCalledTimes(1);
    }, 10_000);
  });
});
