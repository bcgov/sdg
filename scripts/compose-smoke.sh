#!/usr/bin/env bash
# Smoke test for the compose dev stack (DEVELOPER.md, Local Stack).
# Validates both Caddyfiles, brings the stack up, then checks it end to end through https://sdg.localhost.
#
# Usage: scripts/compose-smoke.sh [--no-up] [--down]
#   --no-up  test an already running stack
#   --down   stop the stack afterwards
# ENGINE=docker uses Docker instead of Podman.
set -euo pipefail

ENGINE="${ENGINE:-podman}"
COMPOSE="${COMPOSE:-$ENGINE compose}"
PROJECT=portal
SITE=https://sdg.localhost
ADMIN_SITE=https://admin.sdg.localhost
GATEWAY_SITE=https://gateway.sdg.localhost
WAIT_SECONDS="${WAIT_SECONDS:-420}"

UP=true
DOWN=false
for arg in "$@"; do
  case "$arg" in
    --no-up) UP=false ;;
    --down) DOWN=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; if $DOWN; then $COMPOSE down >/dev/null 2>&1 || true; fi' EXIT

PASSED=0
FAILED=0
pass() { PASSED=$((PASSED + 1)); printf '  \033[32m✔\033[0m %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  \033[31m✘\033[0m %s\n' "$1"; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi; }

container() {
  "$ENGINE" ps -aq \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$1" | head -n 1
}

# Caddy validates upstream addresses, so give the placeholders real values.
# A second argument "on" validates with browser telemetry enabled (collect_on snippet).
caddy_validate() {
  local telemetry=(-e TELEMETRY="${2:-off}")
  [ "${2:-off}" = on ] && telemetry+=(-e FARO_COLLECTOR_URL=http://alloy:12347 -e TELEMETRY_ENVIRONMENT=local)
  $COMPOSE run --rm --no-deps -T \
    -e PORTAL_API_URL=http://portal-api:3000 -e PORTAL_WEB_URL=http://portal-web:5173 -e LOG_LEVEL=INFO \
    "${telemetry[@]}" --entrypoint caddy caddy validate --adapter caddyfile --config "/etc/caddy/$1"
}

echo "Caddy config"
$COMPOSE build caddy >/dev/null
check "Caddyfile (production) validates" caddy_validate Caddyfile
check "Caddyfile.dev validates" caddy_validate Caddyfile.dev
check "Caddyfile (production) validates with telemetry on" caddy_validate Caddyfile on
check "Caddyfile.dev validates with telemetry on" caddy_validate Caddyfile.dev on

if $UP; then
  echo "Starting stack (first run installs dependencies, this takes a while)"
  $COMPOSE up -d --build >/dev/null
fi

deadline=$((SECONDS + WAIT_SECONDS))
# wait_for <site>: until it serves / (admin-web starts only after portal-web is up, so it comes second).
wait_for() {
  echo "Waiting for $1"
  until curl -ksSf -o /dev/null "$1/"; do
    if ((SECONDS > deadline)); then
      fail "stack reachable at $1 within ${WAIT_SECONDS}s"
      $COMPOSE ps || true
      echo "Passed: $PASSED  Failed: $FAILED"
      exit 1
    fi
    sleep 5
  done
}
wait_for "$SITE"
wait_for "$ADMIN_SITE"

CADDY="$(container caddy)"
API="$(container portal-api)"
CORE="$(container core-api)"
WEB="$(container portal-web)"
ADMIN_WEB="$(container admin-web)"
MIGRATE="$(container migrate)"
MIGRATE_PORTAL="$(container migrate-portal)"
MIGRATE_ADMIN="$(container migrate-admin)"
ADMIN_API="$(container admin-api)"
GATEWAY_API="$(container gateway-api)"
POSTGIS="$(container postgis)"

# Verify TLS against Caddy's own local root, not with -k.
"$ENGINE" cp "$CADDY:/data/caddy/pki/authorities/local/root.crt" "$TMP/root.crt"
CURL=(curl -sS --cacert "$TMP/root.crt" --max-time 15)
status() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }

echo "TLS and SPA"
"${CURL[@]}" -D "$TMP/headers" -o "$TMP/index.html" "$SITE/"
check "GET / verifies against the Caddy local CA" test -s "$TMP/index.html"
check "GET / serves the SPA shell" grep -q '<div id="root">' "$TMP/index.html"
check "GET /deep/link falls through to the SPA" test "$(status "$SITE/deep/link")" = 200
check "Vite dev client is served" test "$(status "$SITE/@vite/client")" = 200
check "HMR websocket upgrades through Caddy" bash -c \
  "curl -sS --cacert '$TMP/root.crt' --http1.1 -i -N --max-time 3 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Protocol: vite-hmr' \
    '$SITE/' 2>/dev/null | head -n 1 | grep -q ' 101'"

echo "Security headers"
header() { grep -i "^$1:" "$TMP/headers" | head -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ //'; }
check "Server header removed" bash -c "! grep -qi '^server:' '$TMP/headers'"
check "X-Frame-Options SAMEORIGIN" test "$(header X-Frame-Options)" = SAMEORIGIN
check "X-Content-Type-Options nosniff" test "$(header X-Content-Type-Options)" = nosniff
check "Strict-Transport-Security set" test "$(header Strict-Transport-Security)" = max-age=31536000
check "Cross-Origin-Embedder-Policy credentialless" test "$(header Cross-Origin-Embedder-Policy)" = credentialless
check "CSP frame-ancestors 'self'" grep -qi "^content-security-policy:.*frame-ancestors 'self'" "$TMP/headers"
check "Dev CSP allows Vite inline scripts only" \
  grep -qi "^content-security-policy:.*script-src 'self' https://\*\.gov\.bc\.ca 'unsafe-inline';" "$TMP/headers"
check "Dev CSP allows Vite's injected styles" \
  grep -qi "^content-security-policy:.*style-src [^;]*'unsafe-inline';" "$TMP/headers"

echo "API proxy"
check "GET /api/auth/me without a session is 401 from portal-api" \
  test "$("${CURL[@]}" -o "$TMP/me.json" -w '%{http_code} %{content_type}' "$SITE/api/auth/me")" \
  = "401 application/json; charset=utf-8"
check "portal-api is ready (its database only) inside the network" "$ENGINE" exec "$API" node -e \
  "fetch('http://localhost:3000/healthz/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
check "GET /api/v1/portal/… without a session is 401 from portal-api" \
  test "$(status "$SITE/api/v1/portal/anything")" = 401
check "GET /api/v1/admin/… is 404 on the portal host (AE2)" test "$(status "$SITE/api/v1/admin/anything")" = 404
check "core-api is ready (its database) and reachable from portal-api" "$ENGINE" exec "$API" node -e \
  "fetch('http://core-api:3000/healthz/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
check "core-api answers 401 to a request without a token" "$ENGINE" exec "$CORE" node -e \
  "fetch('http://localhost:3000/api/v1/shared/me').then((r) => process.exit(r.status === 401 ? 0 : 1), () => process.exit(1))"

echo "Admin host"
# admin-api needs the admin Keycloak client (apps/admin-api/.env), which a developer may not have; the rest of the
# stack must work without it.
check "the admin host is routed by Caddy (/telemetry.json from the edge)" \
  test "$("${CURL[@]}" "$ADMIN_SITE/telemetry.json")" = '{"enabled":false}'
"${CURL[@]}" -o "$TMP/admin-index.html" "$ADMIN_SITE/" || true
check "GET / on the admin host serves admin-web's SPA shell" grep -q '<title>SDG Admin</title>' "$TMP/admin-index.html"
check "GET /service-clients on the admin host falls through to admin-web" \
  test "$(status "$ADMIN_SITE/service-clients")" = 200
if [ -n "$ADMIN_API" ] && [ "$("$ENGINE" inspect -f '{{.State.Health.Status}}' "$ADMIN_API")" = healthy ]; then
  check "GET /api/auth/me without a session is 401 from admin-api" test "$(status "$ADMIN_SITE/api/auth/me")" = 401
  check "GET /api/v1/portal/… is 404 on the admin host (R4)" test "$(status "$ADMIN_SITE/api/v1/portal/anything")" = 404
  check "admin-api publishes no host port" test -z "$("$ENGINE" port "$ADMIN_API" 2>/dev/null)"
else
  echo "  - admin-api is not healthy (no apps/admin-api/.env?): skipping its API checks"
fi

echo "Gateway host"
# gateway-api needs no .env, but starts after the admin build; wait for it rather than for a web app.
until [ "$(status "$GATEWAY_SITE/api/v1/gateway/me")" = 401 ] || ((SECONDS > deadline)); do sleep 5; done
check "GET / on the gateway host is 404 (gateway-api serves /api only)" test "$(status "$GATEWAY_SITE/")" = 404
check "GET /api/v1/gateway/me without a token is 401 from gateway-api" \
  test "$(status "$GATEWAY_SITE/api/v1/gateway/me")" = 401
check "POST /api/v1/gateway/me is 405 from gateway-api (R19)" \
  test "$(status -X POST -H 'Authorization: Bearer smoke' "$GATEWAY_SITE/api/v1/gateway/me")" = 405
check "GET /api/v1/portal/… is 404 on the gateway host (R4)" \
  test "$(status -H 'Authorization: Bearer smoke' "$GATEWAY_SITE/api/v1/portal/anything")" = 404
check "gateway-api publishes no host port" test -z "$("$ENGINE" port "$GATEWAY_API" 2>/dev/null)"

echo "Telemetry (off without compose.observability.yaml)"
check "GET /telemetry.json reports telemetry off" test "$("${CURL[@]}" "$SITE/telemetry.json")" = '{"enabled":false}'
check "POST /collect is a no-op 204" test "$(status -X POST -d '{}' "$SITE/collect")" = 204
check "Caddy metrics served on :3003" "$ENGINE" exec "$API" node -e \
  "fetch('http://caddy:3003/metrics').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
check "Caddy admin API not reachable from other containers" "$ENGINE" exec "$API" node -e \
  "fetch('http://caddy:2019/config/').then(() => process.exit(1), () => process.exit(0))"

echo "WAF"
check "/.env is blocked (rule 1004)" test "$(status "$SITE/.env")" = 403
check "TRACE is 405 (rule 1009)" test "$(status -X TRACE "$SITE/")" = 405
# Rules using `block` follow Coraza's default action (pass): they log a warning but let the request through.
MARK="smoke$RANDOM$RANDOM"
detected() { "$ENGINE" logs --since 2m "$CADDY" 2>&1 | grep "$MARK" | grep -q "Coraza: Warning. $1"; }
check "XSS in a query string is passed through (detect-only)" \
  test "$(status "$SITE/?q=%3Cscript%3Ealert(%27$MARK%27)%3C%2Fscript%3E")" = 200
check "XSS in a query string is logged (rule 1002)" detected "XSS Attack Detected"
sqli_logged() {
  status "$SITE/api/auth/me?id=$MARK%20union%20select%20password" >/dev/null
  detected "SQL Injection Pattern Detected"
}
check "SQL injection in a query string is logged (rule 1005)" sqli_logged
check "Scanner User-Agent is blocked (rule 1003)" test "$(status -A 'sqlmap/1.8' "$SITE/")" = 403

echo "Isolation"
check "portal-api publishes no host port" test -z "$("$ENGINE" port "$API" 2>/dev/null)"
check "portal-web publishes no host port" test -z "$("$ENGINE" port "$WEB" 2>/dev/null)"
check "admin-web publishes no host port" test -z "$("$ENGINE" port "$ADMIN_WEB" 2>/dev/null)"

echo "Migrations"
# Each init service touches /tmp/ready only after its migrations succeed; its app waits for that (service_healthy).
ready_before() { test "$("$ENGINE" exec "$1" stat -c %Y /tmp/ready)" -le "$("$ENGINE" inspect -f '{{.State.StartedAt.Unix}}' "$2")"; }
check "migrate completed (healthy)" test "$("$ENGINE" inspect -f '{{.State.Health.Status}}' "$MIGRATE")" = healthy
check "core migrations completed before core-api started" ready_before "$MIGRATE" "$CORE"
check "migrate-portal completed (healthy)" test "$("$ENGINE" inspect -f '{{.State.Health.Status}}' "$MIGRATE_PORTAL")" = healthy
check "sessions migrations completed before portal-api started" ready_before "$MIGRATE_PORTAL" "$API"
check "migrate-admin completed (healthy)" test "$("$ENGINE" inspect -f '{{.State.Health.Status}}' "$MIGRATE_ADMIN")" = healthy
# Runs SQL as login $1 over the container's local socket (trusted by the image's pg_hba).
psql_as() { "$ENGINE" exec "$POSTGIS" sh -c "psql -v ON_ERROR_STOP=1 -U $1 -d \"\$POSTGRES_DB\" -tAc \"$2\""; }
expected="$(grep -c '"tag"' packages/database/migrations/meta/_journal.json)"
applied="$(psql_as core 'select count(*) from core.__drizzle_migrations' 2>/dev/null || echo 0)"
check "all $expected core journal migrations applied (found $applied)" test "$applied" = "$expected"
expected="$(grep -c '"tag"' packages/bff-core/migrations/meta/_journal.json)"
applied="$(psql_as portal 'select count(*) from portal.__drizzle_migrations' 2>/dev/null || echo 0)"
check "all $expected sessions journal migrations applied in portal (found $applied)" test "$applied" = "$expected"
check "the portal login scheduled its session prune job" test "$(psql_as portal \
  "select count(*) from cron.job where jobname = 'portal-prune-expired-sessions'")" = 1
applied="$(psql_as admin 'select count(*) from admin.__drizzle_migrations' 2>/dev/null || echo 0)"
check "all $expected sessions journal migrations applied in admin (found $applied)" test "$applied" = "$expected"
check "the admin login scheduled its session prune job" test "$(psql_as admin \
  "select count(*) from cron.job where jobname = 'admin-prune-expired-sessions'")" = 1

echo "Database logins"
check "core reads its own schema" psql_as core 'select count(*) from core.principals'
check "portal reads its own sessions" psql_as portal 'select count(*) from portal.sessions'
check "admin reads its own sessions" psql_as admin 'select count(*) from admin.sessions'
denied() { ! psql_as "$@"; }
check "portal cannot read the core schema" denied portal 'select count(*) from core.principals'
check "core cannot read portal's sessions" denied core 'select count(*) from portal.sessions'
check "admin cannot read the core schema" denied admin 'select count(*) from core.identities'
check "admin cannot read portal's sessions" denied admin 'select count(*) from portal.sessions'
check "portal cannot read admin's sessions" denied portal 'select count(*) from admin.sessions'
check "no login is a superuser" test "$(psql_as core \
  "select count(*) from pg_roles where rolname in ('core', 'portal', 'admin') and not rolsuper")" = 3

echo
echo "Passed: $PASSED  Failed: $FAILED"
((FAILED == 0))
