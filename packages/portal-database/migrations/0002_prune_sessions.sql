-- pg_cron jobs, run as the migrating (app) user in its database. The extension is installed by a superuser
-- beforehand (charts/postgres init SQL; compose's dev-postgres); without it this fails and the deploy stops.
-- cron.schedule upserts by job name.
SELECT cron.schedule('prune-expired-sessions', '*/15 * * * *', $$DELETE FROM sessions WHERE expires_at <= now()$$);
--> statement-breakpoint
-- pg_cron logs every run in cron.job_run_details; keep a week of the app user's own runs.
SELECT cron.schedule('purge-cron-run-details', '0 3 * * *', $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'$$);
