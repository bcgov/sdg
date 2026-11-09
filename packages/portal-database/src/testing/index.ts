/** A client that runs multi-statement SQL, such as PGlite. */
export interface SqlExecutor {
  exec(query: string): Promise<unknown>;
}

/**
 * Stands in for pg_cron in databases without it (PGlite in tests), so the migrations that schedule jobs apply.
 * `cron.schedule` upserts into `cron.job` by name like the real one; nothing runs the jobs.
 */
export const PG_CRON_STUB_SQL = `
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigserial PRIMARY KEY,
  jobname text UNIQUE,
  schedule text NOT NULL,
  command text NOT NULL
);
CREATE TABLE cron.job_run_details (
  runid bigserial PRIMARY KEY,
  jobid bigint,
  status text,
  end_time timestamptz
);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = excluded.schedule, command = excluded.command
  RETURNING jobid
$$;
`;

/** Installs {@link PG_CRON_STUB_SQL}. Run it before migrating. */
export async function installPgCronStub(client: SqlExecutor): Promise<void> {
  await client.exec(PG_CRON_STUB_SQL);
}
