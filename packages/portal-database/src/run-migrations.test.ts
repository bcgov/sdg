import { describe, expect, it } from 'vitest';

import { MigrationError, runMigrations } from './run-migrations.js';

describe('runMigrations', () => {
  it('rejects when DATABASE_URL is missing', async () => {
    const run = runMigrations(undefined);
    await expect(run).rejects.toBeInstanceOf(MigrationError);
    await expect(run).rejects.toThrow('DATABASE_URL is not set.');
    await expect(runMigrations('')).rejects.toThrow('DATABASE_URL is not set.');
  });

  it('rejects a non-postgres URL without echoing it', async () => {
    const url = 'mysql://portal:s3cret-pw@db.internal:3306/portal';
    const error = await runMigrations(url).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MigrationError);
    expect(String(error)).toContain('must use postgres:// or postgresql://');
    expect(String(error)).not.toContain('s3cret-pw');
    await expect(runMigrations('not a url')).rejects.toThrow('DATABASE_URL is not a valid URL.');
  });

  it('rejects an unreachable database without leaking the password', async () => {
    // Port 1 on loopback refuses immediately, so no real database is needed.
    const error = await runMigrations('postgres://portal:s3cret%2Fpw@127.0.0.1:1/portal').catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(MigrationError);
    if (!(error instanceof MigrationError)) return;
    expect(error.message).toMatch(/^Migrating 127\.0\.0\.1:1\/portal failed: /);
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).not.toMatch(/s3cret/);
    expect(error.cause).toBeUndefined();
  });
});
