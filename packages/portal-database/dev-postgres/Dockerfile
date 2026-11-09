# Local (compose) Postgres: the PostGIS image the chart's PostgresCluster matches (17 + 3.5), plus pg_cron, which
# Crunchy's images ship and the alpine PostGIS image can't install. The 17-3.5 image is Debian bullseye, which PGDG
# serves only from its archive.
FROM docker.io/postgis/postgis:17-3.5

RUN echo 'deb [ signed-by=/usr/local/share/keyrings/postgres.gpg.asc ] https://apt-archive.postgresql.org/pub/repos/apt bullseye-pgdg-archive main' \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-cron \
  && rm -rf /var/lib/apt/lists/*

# Runs once, on a fresh data volume. The compose user is a superuser, so no grant is needed.
COPY init-pg-cron.sql /docker-entrypoint-initdb.d/

# The entrypoint supports starting unprivileged: PGDATA is postgres-owned in the image, and a new named volume copies
# that ownership, so initdb runs without the root-then-gosu step.
USER postgres
