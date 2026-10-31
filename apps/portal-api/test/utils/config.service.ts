import { ConfigService } from '@nestjs/config';
import { vi, type Mock } from 'vitest';

import type { Env } from '../../src/config/env.js';

type MockConfigGet<T extends Partial<Env>> = (key: keyof T, options?: { infer: true }) => T[keyof T];

export function isConfigService(value: unknown): value is ConfigService<Env, true> {
  return typeof value === 'object' && value !== null && 'get' in value;
}

export function createMockConfig<T extends Partial<Env>>(
  env: T,
): {
  config: ConfigService<Env, true>;
  getMock: Mock<MockConfigGet<T>>;
} {
  const getMock = vi.fn<MockConfigGet<T>>((key: keyof T, _options?: { infer: true }) => env[key]);
  const configObj: unknown = { get: getMock };
  if (isConfigService(configObj)) {
    return { config: configObj, getMock };
  }
  throw new Error('Invalid config service');
}
