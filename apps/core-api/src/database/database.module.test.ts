import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCoreDatabase } from './database.module.js';

describe('createCoreDatabase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs an idle client's error instead of crashing the process", async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // pg connects lazily, so no database is needed.
    const db = createCoreDatabase('postgres://core:core@127.0.0.1:1/core');
    const dropped = new Error('terminating connection due to administrator command');
    try {
      // pg emits this when Postgres closes an idle pooled connection (restart, Patroni switchover).
      expect(() => db.$client.emit('error', dropped)).not.toThrow();
      expect(error).toHaveBeenCalledWith({
        msg: 'Idle Postgres client error',
        error: expect.objectContaining({ type: 'Error', message: dropped.message }),
      });
    } finally {
      await db.$client.end();
    }
  });
});
