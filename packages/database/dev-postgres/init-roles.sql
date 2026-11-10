-- Local mirror of charts/postgres's init SQL (templates/init-sql.yaml): one login per service, each owning the schema
-- of its own name, which Postgres's default search_path ("$user", public) resolves first. No login can use another's
-- schema. Runs once on a fresh volume as the compose superuser, after init-pg-cron.sql (files run in name order).
-- PGO creates the logins in real environments; here this script does, with local-dev passwords (compose.yaml).
CREATE ROLE core LOGIN PASSWORD 'core';
CREATE ROLE portal LOGIN PASSWORD 'portal';
CREATE ROLE admin LOGIN PASSWORD 'admin';

-- As PGO grants a user its databases. drizzle's migrator needs CREATE: it runs CREATE SCHEMA IF NOT EXISTS for its
-- journal's schema, which Postgres checks against the database even when the schema exists.
DO $$ BEGIN EXECUTE format('GRANT ALL ON DATABASE %I TO core, portal, admin', current_database()); END $$;

-- Nothing lives in public: every table belongs to one login's schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA core AUTHORIZATION core;
CREATE SCHEMA portal AUTHORIZATION portal;
CREATE SCHEMA admin AUTHORIZATION admin;

-- The BFF logins schedule their own session-pruning jobs in their migrations.
GRANT USAGE ON SCHEMA cron TO portal, admin;

-- pg_cron logs every run in cron.job_run_details; keep a week of every login's runs. Scheduled as the superuser.
SELECT cron.schedule('purge-cron-run-details', '0 3 * * *', $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$);
