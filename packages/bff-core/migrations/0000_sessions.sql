CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"sess" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"destroyed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
-- Prunes expired sessions, ended ones (tombstones) included, every 15 minutes. pg_cron runs a job as the login that
-- scheduled it, so each BFF login schedules its own job, named after itself, over the table it just created in its own
-- schema (the first schema on its search_path). cron.schedule upserts by job name. The extension and the login's
-- USAGE on the cron schema come from the cluster's init SQL (charts/postgres; compose's dev-postgres).
DO $$
BEGIN
  PERFORM cron.schedule(
    format('%s-prune-expired-sessions', current_user),
    '*/15 * * * *',
    format('DELETE FROM %I.sessions WHERE expires_at <= now()', current_schema())
  );
END
$$;
