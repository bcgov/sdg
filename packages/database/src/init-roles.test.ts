import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { migrationsFolder, migrationsSchema } from './migrations-folder.js';
import * as schema from './schema/index.js';
import { installPgCronStub } from './testing/index.js';

// compose's dev Postgres init (the local mirror of charts/postgres's init SQL), run as the superuser like the
// entrypoint does, after the pg_cron stub stands in for init-pg-cron.sql.
const initRolesSql = readFileSync(new URL('../dev-postgres/init-roles.sql', import.meta.url), 'utf8');

const LOGINS = ['core', 'portal', 'console'] as const;
type Login = (typeof LOGINS)[number];

describe('dev-postgres init-roles.sql', () => {
  let client: PGlite;

  /** Runs `query` as `login`, resolving to the SQLSTATE it fails with, or 'ok'. */
  async function as(login: Login, query: string): Promise<string> {
    await client.exec(`SET ROLE ${login}`);
    try {
      await client.exec(query);
      return 'ok';
    } catch (error) {
      return error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
    } finally {
      await client.exec('RESET ROLE');
    }
  }

  beforeAll(async () => {
    client = new PGlite();
    // PGlite starts with search_path = public; restore Postgres's default, which the per-login schemas rely on.
    await client.exec(`SET search_path TO "$user", public`);
    await installPgCronStub(client);
    await client.exec(initRolesSql);
    // The core login applies the core migrations into its own schema, as the database image does.
    await client.exec('SET ROLE core');
    await migrate(drizzle({ client, schema, casing: 'snake_case' }), { migrationsFolder, migrationsSchema });
    await client.exec('RESET ROLE');
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it('creates core, portal and console as non-superuser logins, each owning the schema of its name', async () => {
    const roles = await client.query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean }>(
      `select rolname, rolcanlogin, rolsuper from pg_roles where rolname = any($1) order by rolname`,
      [LOGINS],
    );
    expect(roles.rows).toEqual(
      ['console', 'core', 'portal'].map((rolname) => ({ rolname, rolcanlogin: true, rolsuper: false })),
    );
    const schemas = await client.query<{ nspname: string; owner: string }>(
      `select nspname, nspowner::regrole::text as owner from pg_namespace where nspname = any($1) order by nspname`,
      [LOGINS],
    );
    expect(schemas.rows).toEqual(['console', 'core', 'portal'].map((name) => ({ nspname: name, owner: name })));
  });

  it('lets only core read the core tables', async () => {
    expect(await as('core', 'select from core.principals')).toBe('ok');
    expect(await as('portal', 'select from core.principals')).toBe('42501');
    expect(await as('console', 'select from core.identities')).toBe('42501');
  });

  it('resolves an unqualified table to the login schema, which the other logins cannot read', async () => {
    expect(await as('portal', 'create table sessions (sid text primary key)')).toBe('ok');
    const created = await client.query<{ schemaname: string }>(
      `select schemaname from pg_tables where tablename = 'sessions'`,
    );
    expect(created.rows).toEqual([{ schemaname: 'portal' }]);
    expect(await as('console', 'select from portal.sessions')).toBe('42501');
    expect(await as('core', 'select from portal.sessions')).toBe('42501');
  });

  it('lets no login create objects in public', async () => {
    // One at a time: `as` switches the role of PGlite's single connection.
    expect(await as('core', 'create table public.core_probe (id int)')).toBe('42501');
    expect(await as('portal', 'create table public.portal_probe (id int)')).toBe('42501');
    expect(await as('console', 'create table public.console_probe (id int)')).toBe('42501');
  });

  it('grants the cron schema to the BFF logins only', async () => {
    const usage = await client.query<{ login: string; usage: boolean }>(
      `select login, has_schema_privilege(login, 'cron', 'USAGE') as usage from unnest($1::text[]) as login`,
      [LOGINS],
    );
    expect(usage.rows).toEqual([
      { login: 'core', usage: false },
      { login: 'portal', usage: true },
      { login: 'console', usage: true },
    ]);
  });

  it('schedules purge-cron-run-details, which keeps a week of runs', async () => {
    const jobs = await client.query<{ jobname: string; schedule: string; command: string }>(
      'select jobname, schedule, command from cron.job',
    );
    expect(jobs.rows).toEqual([
      { jobname: 'purge-cron-run-details', schedule: '0 3 * * *', command: expect.stringContaining('job_run_details') },
    ]);
    await client.exec(`insert into cron.job_run_details (end_time) values
      (now() - interval '8 days'), (now() - interval '1 day')`);
    await client.exec(jobs.rows[0]?.command ?? '');
    expect((await client.query('select runid from cron.job_run_details')).rows).toHaveLength(1);
  });
});
