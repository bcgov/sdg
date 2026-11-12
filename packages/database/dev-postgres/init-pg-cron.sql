-- pg_cron needs a superuser to install. Runs before init-roles.sql, which grants the BFF logins its schema.
CREATE EXTENSION IF NOT EXISTS pg_cron;
