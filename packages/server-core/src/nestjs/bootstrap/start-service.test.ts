import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startService } from './start-service.js';

@Module({})
class EmptyModule {}

class ExitCalled extends Error {}

const swagger = { title: 'Probe', description: 'startService tests', version: '0.0.0' };

/** Stops startService at NestFactory.create: these tests check what it asks Nest for, not a running server. */
function stubBootstrap() {
  vi.spyOn(process, 'on').mockReturnValue(process);
  return {
    create: vi.spyOn(NestFactory, 'create').mockRejectedValue(new Error('create stopped by the test')),
    fatal: vi.spyOn(Logger.prototype, 'fatal').mockImplementation(() => undefined),
    exit: vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ExitCalled(`exit ${String(code)}`);
    }),
  };
}

describe('startService', () => {
  let spies: ReturnType<typeof stubBootstrap>;

  beforeEach(() => {
    spies = stubBootstrap();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers bootstrap logs and leaves the raw body off by default', async () => {
    await expect(startService(EmptyModule, { serviceName: 'probe', swagger })).rejects.toThrow('exit 1');
    expect(spies.create).toHaveBeenCalledWith(EmptyModule, { bufferLogs: true, rawBody: false });
  });

  it('keeps the raw body when asked, for a forwarder that relays bodies byte for byte', async () => {
    await expect(startService(EmptyModule, { serviceName: 'probe', swagger, rawBody: true })).rejects.toThrow('exit 1');
    expect(spies.create).toHaveBeenCalledWith(EmptyModule, { bufferLogs: true, rawBody: true });
  });

  it('logs a failed start as fatal with its cause and exits non-zero', async () => {
    await expect(startService(EmptyModule, { serviceName: 'probe', swagger })).rejects.toThrow(ExitCalled);
    expect(spies.fatal).toHaveBeenCalledWith(
      expect.stringContaining('Failed to start probe: Error: create stopped by the test'),
    );
    expect(spies.exit).toHaveBeenCalledWith(1);
  });
});
