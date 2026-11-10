#!/usr/bin/env bash
# Smoke test for the production images (DEVELOPER.md, Production Images).
# Builds database, core-api, portal-api, admin-api, gateway-api, portal-web, admin-web and the edge, then runs them
# the way OpenShift's restricted SCC does (arbitrary UID in group 0, no capabilities, no privilege escalation) against
# the compose postgis.
#
# Usage: scripts/images-smoke.sh [--no-build]
#   --no-build  reuse images built by an earlier run
# ENGINE=docker uses Docker instead of Podman. COMPOSE_PROJECT_NAME (default portal, the dev stack's) runs against
# another project's postgis, e.g. COMPOSE_PROJECT_NAME=sdg-smoke POSTGRES_PORT=5433 beside a running dev stack.
set -euo pipefail

ENGINE="${ENGINE:-podman}"
COMPOSE="${COMPOSE:-$ENGINE compose}"
PROJECT="${COMPOSE_PROJECT_NAME:-portal}"
export COMPOSE_PROJECT_NAME="$PROJECT"
NETWORK="${PROJECT}_default"
PREFIX=sdg-images-smoke
SMOKE_DB=portal_images_smoke
WAIT_SECONDS="${WAIT_SECONDS:-120}"

BUILD=true
for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=false ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
cleanup() {
  "$ENGINE" rm -f "$PREFIX-core" "$PREFIX-api" "$PREFIX-admin" "$PREFIX-gateway" "$PREFIX-web" "$PREFIX-admin-web" "$PREFIX-edge" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

PASSED=0
FAILED=0
pass() { PASSED=$((PASSED + 1)); printf '  \033[32m✔\033[0m %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  \033[31m✘\033[0m %s\n' "$1"; }
check() { local name="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$name"; else fail "$name"; fi; }

# OpenShift restricted-v2: a random UID in group 0, every capability dropped, no setuid/file-capability gains.
OCP=(--user 1000680000:0 --cap-drop ALL --security-opt no-new-privileges --network "$NETWORK")
image() { echo "localhost/$PREFIX/$1:latest"; }

if $BUILD; then
  echo "Building images"
  "$ENGINE" build -q -t "$(image database)" -f packages/database/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image core-api)" -f apps/core-api/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image portal-api)" -f apps/portal-api/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image admin-api)" -f apps/admin-api/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image gateway-api)" -f apps/gateway-api/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image portal-web)" -f apps/portal-web/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image admin-web)" -f apps/admin-web/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image edge)" apps/portal-web/caddy >/dev/null
fi

echo "Image contents"
node_in() { "$ENGINE" run --rm "$(image "$1")" node -e "$2"; }
for app in core-api portal-api admin-api gateway-api; do
  check "$app ships dist and no sources" node_in "$app" \
    "const fs = require('fs'); process.exit(fs.existsSync('dist/main.js') && !fs.existsSync('src') ? 0 : 1)"
  check "$app ships no devDependencies (pino-pretty, typescript, @nestjs/cli)" node_in "$app" \
    "const fs = require('fs'); process.exit(['pino-pretty', 'typescript', '@nestjs/cli'].some((d) => fs.existsSync('node_modules/' + d)) ? 1 : 0)"
done
for app in portal-api admin-api; do
  check "$app ships dist/migrate.js and bff-core's sessions migrations" node_in "$app" \
    "const fs = require('fs'); process.exit(fs.existsSync('dist/migrate.js') && fs.existsSync('node_modules/@repo/bff-core/migrations/meta/_journal.json') ? 0 : 1)"
done
check "database ships dist/migrate.js and the migrations" node_in database \
  "const fs = require('fs'); process.exit(fs.existsSync('dist/migrate.js') && fs.existsSync('migrations/meta/_journal.json') ? 0 : 1)"
check "no .env files in the Node images" bash -c "! for i in core-api portal-api admin-api gateway-api database; do \
  $ENGINE run --rm \"localhost/$PREFIX/\$i:latest\" find / -xdev -name '.env*' -not -name '.env.example'; done | grep -q ."
check "no package manager in the final images" bash -c "for i in core-api portal-api admin-api gateway-api database portal-web admin-web edge; do \
  ! $ENGINE run --rm \"localhost/$PREFIX/\$i:latest\" sh -c 'command -v apk || command -v npm || command -v pnpm' || exit 1; done"

echo "Waiting for compose postgis"
$COMPOSE up -d postgis >/dev/null
POSTGIS="$("$ENGINE" ps -q --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=postgis)"
deadline=$((SECONDS + WAIT_SECONDS))
until [ "$("$ENGINE" inspect -f '{{.State.Health.Status}}' "$POSTGIS")" = healthy ]; do
  ((SECONDS > deadline)) && { fail "postgis healthy within ${WAIT_SECONDS}s"; exit 1; }
  sleep 2
done
psql() { "$ENGINE" exec "$POSTGIS" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"$1\""; }
psql_smoke() { "$ENGINE" exec "$POSTGIS" sh -c "psql -U \"\$POSTGRES_USER\" -d $SMOKE_DB -tAc \"$1\""; }
psql "drop database if exists $SMOKE_DB with (force)" >/dev/null 2>&1
psql "create database $SMOKE_DB" >/dev/null
# The compose logins (packages/database/dev-postgres/init-roles.sql), each owning its schema, as in the main database.
psql_smoke "grant all on database $SMOKE_DB to core, portal, admin; revoke create on schema public from public; \
  create schema core authorization core; create schema portal authorization portal; \
  create schema admin authorization admin" >/dev/null
# pg_cron runs only in the main database (cron.database_name), so a stand-in takes the sessions migration's
# cron.schedule here; compose-smoke.sh checks the real job.
psql_smoke "create schema cron; grant usage on schema cron to portal, admin; create function cron.schedule(job_name text, \
  schedule text, command text) returns bigint language sql as 'select 1::bigint'" >/dev/null
CORE_URL="postgres://core:core@postgis:5432/$SMOKE_DB"
DATABASE_URL="postgres://portal:portal@postgis:5432/$SMOKE_DB"
ADMIN_DATABASE_URL="postgres://admin:admin@postgis:5432/$SMOKE_DB"

echo "database (initContainer)"
# Runs the migrator once; its output goes to $TMP/<name>.log and its exit code to $TMP/<name>.code.
migrate() {
  local name="$1"; shift
  local code=0
  "$ENGINE" run --rm --read-only "${OCP[@]}" "$@" "$(image database)" >"$TMP/$name.log" 2>&1 || code=$?
  echo "$code" >"$TMP/$name.code"
}
exit_code() { cat "$TMP/$1.code"; }
migrate no-url
check "exits 1 without DATABASE_URL" test "$(exit_code no-url)" = 1
check "explains the missing DATABASE_URL" grep -q 'DATABASE_URL is not set' "$TMP/no-url.log"
migrate first -e "DATABASE_URL=$CORE_URL"
check "migrates an empty database as the core login (exit 0)" test "$(exit_code first)" = 0
expected="$(grep -c '"tag"' packages/database/migrations/meta/_journal.json)"
applied="$(psql_smoke 'select count(*) from core.__drizzle_migrations' || echo 0)"
check "all $expected journal migrations recorded in core (found $applied)" test "$applied" = "$expected"
check "core.principals and core.identities exist" test "$(psql_smoke "select count(*) from information_schema.tables \
  where table_schema = 'core' and table_name in ('principals', 'identities')")" = 2
migrate again -e "DATABASE_URL=$CORE_URL"
check "re-running with nothing pending exits 0" test "$(exit_code again)" = 0
migrate bad-pw -e "DATABASE_URL=postgres://core:smoke-s3cret@postgis:5432/$SMOKE_DB"
check "a wrong password exits 1" test "$(exit_code bad-pw)" = 1
check "the password never reaches the output" bash -c "! grep -q 'smoke-s3cret' '$TMP/bad-pw.log'"

echo "core-api"
"$ENGINE" run -d --name "$PREFIX-core" --read-only "${OCP[@]}" \
  -e "DATABASE_URL=$CORE_URL" \
  -e KEYCLOAK_ISSUER_URL=https://keycloak.example.com/realms/portal -e PORTAL_CLIENT_ID=portal \
  "$(image core-api)" >/dev/null
# fetch_in <container> <path> <expected status>: an HTTP request from inside the container
fetch_in() { "$ENGINE" exec "$1" node -e \
  "fetch('http://localhost:3000$2').then((r) => process.exit(r.status === $3 ? 0 : 1), () => process.exit(1))"; }
deadline=$((SECONDS + 60))
until fetch_in "$PREFIX-core" /healthz/live 200 >/dev/null 2>&1 || ((SECONDS > deadline)); do sleep 1; done
check "/healthz/live is 200 under an arbitrary UID with a read-only root" fetch_in "$PREFIX-core" /healthz/live 200
check "/healthz/ready is 200 with its database as the core login (Keycloak not checked)" \
  fetch_in "$PREFIX-core" /healthz/ready 200
check "a request without a Bearer token is 401" fetch_in "$PREFIX-core" /api/v1/shared/me 401
check "logs are JSON lines (NODE_ENV=production, no pino-pretty)" bash -c \
  "$ENGINE logs $PREFIX-core 2>&1 | head -n 1 | node -e 'JSON.parse(require(\"fs\").readFileSync(0, \"utf8\"))'"

echo "portal-api sessions migration (initContainer)"
# migrate_sessions <app> <name> [run options]: runs `node dist/migrate.js` in the app's image once, like migrate above.
migrate_sessions() {
  local app="$1" name="$2"; shift 2
  local code=0
  "$ENGINE" run --rm --read-only "${OCP[@]}" "$@" "$(image "$app")" node dist/migrate.js >"$TMP/$name.log" 2>&1 \
    || code=$?
  echo "$code" >"$TMP/$name.code"
}
migrate_sessions portal-api sessions-no-url
check "exits 1 without DATABASE_URL" test "$(exit_code sessions-no-url)" = 1
migrate_sessions portal-api sessions-first -e "DATABASE_URL=$DATABASE_URL"
check "migrates the sessions as the portal login (exit 0)" test "$(exit_code sessions-first)" = 0
expected="$(grep -c '"tag"' packages/bff-core/migrations/meta/_journal.json)"
applied="$(psql_smoke 'select count(*) from portal.__drizzle_migrations' || echo 0)"
check "all $expected sessions migrations recorded in portal (found $applied)" test "$applied" = "$expected"
check "portal.sessions exists" test "$(psql_smoke "select count(*) from information_schema.tables \
  where table_schema = 'portal' and table_name = 'sessions'")" = 1
migrate_sessions portal-api sessions-again -e "DATABASE_URL=$DATABASE_URL"
check "re-running with nothing pending exits 0" test "$(exit_code sessions-again)" = 0

echo "portal-api"
"$ENGINE" run -d --name "$PREFIX-api" --read-only "${OCP[@]}" \
  -e "DATABASE_URL=$DATABASE_URL" -e "CORE_API_URL=http://$PREFIX-core:3000" \
  -e APP_URL=https://portal.example.gov.bc.ca -e TRUST_PROXY=true \
  -e "SESSION_SECRET=$(head -c 48 /dev/urandom | base64)" \
  -e KEYCLOAK_ISSUER_URL=https://keycloak.example.com/realms/portal \
  -e KEYCLOAK_CLIENT_ID=portal -e KEYCLOAK_CLIENT_SECRET=smoke \
  "$(image portal-api)" >/dev/null
live() { "$ENGINE" exec "$PREFIX-api" node -e \
  "fetch('http://localhost:3000/healthz/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; }
deadline=$((SECONDS + 60))
until live >/dev/null 2>&1 || ((SECONDS > deadline)); do sleep 1; done
check "/healthz/live is 200 under an arbitrary UID with a read-only root" live
check "/healthz/ready is 200 with its database as the portal login (Keycloak and core-api not checked)" \
  fetch_in "$PREFIX-api" /healthz/ready 200
check "a signed-out portal call is 401" fetch_in "$PREFIX-api" /api/v1/portal/anything 401
check "an admin route is 404 on portal-api (AE2)" fetch_in "$PREFIX-api" /api/v1/admin/anything 404
check "logs are JSON lines (NODE_ENV=production, no pino-pretty)" bash -c \
  "$ENGINE logs $PREFIX-api 2>&1 | head -n 1 | node -e 'JSON.parse(require(\"fs\").readFileSync(0, \"utf8\"))'"

echo "admin-api sessions migration (initContainer)"
migrate_sessions admin-api admin-sessions -e "DATABASE_URL=$ADMIN_DATABASE_URL"
check "migrates the sessions as the admin login (exit 0)" test "$(exit_code admin-sessions)" = 0
applied="$(psql_smoke 'select count(*) from admin.__drizzle_migrations' || echo 0)"
check "all $expected sessions migrations recorded in admin (found $applied)" test "$applied" = "$expected"
check "admin.sessions exists, apart from portal's" test "$(psql_smoke "select count(*) from information_schema.tables \
  where table_name = 'sessions' and table_schema in ('admin', 'portal')")" = 2
migrate_sessions admin-api admin-sessions-portal -e "DATABASE_URL=$DATABASE_URL"
check "admin-api's migration as the portal login fails (no admin schema access)" \
  test "$(exit_code admin-sessions-portal)" = 1

echo "admin-api"
"$ENGINE" run -d --name "$PREFIX-admin" --read-only "${OCP[@]}" \
  -e "DATABASE_URL=$ADMIN_DATABASE_URL" -e "CORE_API_URL=http://$PREFIX-core:3000" \
  -e APP_URL=https://admin.example.gov.bc.ca -e TRUST_PROXY=true \
  -e "SESSION_SECRET=$(head -c 48 /dev/urandom | base64)" \
  -e KEYCLOAK_ISSUER_URL=https://keycloak.example.com/realms/portal \
  -e KEYCLOAK_CLIENT_ID=admin -e KEYCLOAK_CLIENT_SECRET=smoke \
  "$(image admin-api)" >/dev/null
deadline=$((SECONDS + 60))
until fetch_in "$PREFIX-admin" /healthz/live 200 >/dev/null 2>&1 || ((SECONDS > deadline)); do sleep 1; done
check "/healthz/live is 200 under an arbitrary UID with a read-only root" fetch_in "$PREFIX-admin" /healthz/live 200
check "/healthz/ready is 200 with its database as the admin login" fetch_in "$PREFIX-admin" /healthz/ready 200
check "GET /api/auth/me without a session is 401" fetch_in "$PREFIX-admin" /api/auth/me 401
check "a signed-out admin call is 401" fetch_in "$PREFIX-admin" /api/v1/admin/service-clients 401
check "a portal route is 404 on admin-api (R4)" fetch_in "$PREFIX-admin" /api/v1/portal/anything 404
check "logs are JSON lines (NODE_ENV=production, no pino-pretty)" bash -c \
  "$ENGINE logs $PREFIX-admin 2>&1 | head -n 1 | node -e 'JSON.parse(require(\"fs\").readFileSync(0, \"utf8\"))'"

echo "gateway-api"
"$ENGINE" run -d --name "$PREFIX-gateway" --read-only "${OCP[@]}" \
  -e "CORE_API_URL=http://$PREFIX-core:3000" -e TRUST_PROXY=true \
  "$(image gateway-api)" >/dev/null
# fetch_as <container> <method> <path> <Authorization or ''> <expected status>
fetch_as() { "$ENGINE" exec "$1" node -e "const a = '$4'; fetch('http://localhost:3000$3', { method: '$2', \
  headers: a ? { authorization: a } : {} }).then((r) => process.exit(r.status === $5 ? 0 : 1), () => process.exit(1))"; }
deadline=$((SECONDS + 60))
until fetch_in "$PREFIX-gateway" /healthz/live 200 >/dev/null 2>&1 || ((SECONDS > deadline)); do sleep 1; done
check "/healthz/live is 200 under an arbitrary UID with a read-only root" fetch_in "$PREFIX-gateway" /healthz/live 200
check "/healthz/ready is 200 (no database; core-api not checked)" fetch_in "$PREFIX-gateway" /healthz/ready 200
check "a gateway call without a token is 401 (KTD12)" fetch_in "$PREFIX-gateway" /api/v1/gateway/me 401
check "a POST is 405 (R19, AE5)" fetch_as "$PREFIX-gateway" POST /api/v1/gateway/me 'Bearer smoke' 405
check "a portal route is 404 on gateway-api (R4)" fetch_as "$PREFIX-gateway" GET /api/v1/portal/anything 'Bearer smoke' 404
# A Bearer token that is not a JWT reaches core-api, which refuses it with 401 before fetching any keys.
check "a Bearer call is forwarded to core-api, whose 401 is relayed" \
  fetch_as "$PREFIX-gateway" GET /api/v1/gateway/me 'Bearer not-a-jwt' 401
check "core-api logged the forwarded gateway call" bash -c \
  "$ENGINE logs $PREFIX-core 2>&1 | grep -q '\"url\":\"/api/v1/gateway/me\"'"
check "logs are JSON lines (NODE_ENV=production, no pino-pretty)" bash -c \
  "$ENGINE logs $PREFIX-gateway 2>&1 | head -n 1 | node -e 'JSON.parse(require(\"fs\").readFileSync(0, \"utf8\"))'"

echo "portal-web, admin-web and edge"
"$ENGINE" run -d --name "$PREFIX-web" "${OCP[@]}" "$(image portal-web)" >/dev/null
"$ENGINE" run -d --name "$PREFIX-admin-web" "${OCP[@]}" "$(image admin-web)" >/dev/null
"$ENGINE" run -d --name "$PREFIX-edge" "${OCP[@]}" -p 127.0.0.1::3000 \
  -e "PORTAL_API_URL=http://$PREFIX-api:3000" -e "PORTAL_WEB_URL=http://$PREFIX-web:8080" \
  -e ADMIN_HOST=admin.smoke.test -e "ADMIN_API_URL=http://$PREFIX-admin:3000" \
  -e "ADMIN_WEB_URL=http://$PREFIX-admin-web:8080" \
  -e GATEWAY_HOST=gateway.smoke.test -e "GATEWAY_API_URL=http://$PREFIX-gateway:3000" \
  "$(image edge)" >/dev/null
EDGE="http://$("$ENGINE" port "$PREFIX-edge" 3000 | head -n 1)"
deadline=$((SECONDS + 30))
until curl -sf -o /dev/null "$EDGE/" || ((SECONDS > deadline)); do sleep 1; done
CURL=(curl -sS --max-time 15)
status() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@"; }
header() { grep -i "^$1:" "$2" | head -n 1 | cut -d: -f2- | tr -d '\r' | sed 's/^ //'; }

"${CURL[@]}" -D "$TMP/index.headers" -o "$TMP/index.html" "$EDGE/"
check "GET / serves the SPA shell through the edge" grep -q '<div id="root">' "$TMP/index.html"
check "index.html revalidates (Cache-Control: no-cache)" test "$(header Cache-Control "$TMP/index.headers")" = no-cache
check "GET /deep/link falls back to the SPA" bash -c \
  "test \"\$(curl -sS -o '$TMP/deep.html' -w '%{http_code}' '$EDGE/deep/link')\" = 200 && grep -q '<div id=\"root\">' '$TMP/deep.html'"
ASSET="$(grep -o '/assets/[^"]*\.js' "$TMP/index.html" | head -n 1)"
"${CURL[@]}" -D "$TMP/asset.headers" -o /dev/null "$EDGE$ASSET"
check "hashed asset $ASSET is cached immutably" \
  test "$(header Cache-Control "$TMP/asset.headers")" = "public, max-age=31536000, immutable"
check "hashed asset is served as JavaScript" grep -qi '^content-type: text/javascript' "$TMP/asset.headers"
check "a missing asset is 404, not the SPA shell" test "$(status "$EDGE/assets/missing-0000.js")" = 404
check "edge compresses responses" grep -qi '^content-encoding: \(zstd\|gzip\)' <("${CURL[@]}" -D - -o /dev/null -H 'Accept-Encoding: gzip' "$EDGE$ASSET")

echo "Edge security headers and routing"
check "Server header removed" bash -c "! grep -qi '^server:' '$TMP/index.headers'"
check "X-Frame-Options SAMEORIGIN" test "$(header X-Frame-Options "$TMP/index.headers")" = SAMEORIGIN
check "Strict-Transport-Security set" test "$(header Strict-Transport-Security "$TMP/index.headers")" = max-age=31536000
check "Production CSP has no unsafe-inline scripts" bash -c \
  "grep -i '^content-security-policy:' '$TMP/index.headers' | grep -q \"script-src 'self' https://\\*\\.gov\\.bc\\.ca ;\""
check "Production CSP has no unsafe-inline styles" bash -c \
  "grep -i '^content-security-policy:' '$TMP/index.headers' | grep -o 'style-src [^;]*' | grep -vq unsafe-inline"
check "TRACE is 405 at the edge (WAF rule 1009)" test "$(status -X TRACE "$EDGE/")" = 405
check "OPTIONS is 405 at the edge (WAF rule 1009)" test "$(status -X OPTIONS "$EDGE/api/auth/me")" = 405
check "GET /api/auth/me without a session is 401 from portal-api" \
  test "$("${CURL[@]}" -D "$TMP/api.headers" -o /dev/null -w '%{http_code}' "$EDGE/api/auth/me")" = 401
check "API responses default to Cache-Control: no-store" grep -qi '^cache-control: no-store' "$TMP/api.headers"
check "the admin host's /api/auth/me is 401 from admin-api" \
  test "$(status -H 'Host: admin.smoke.test' "$EDGE/api/auth/me")" = 401
check "the admin host's portal route is 404 from admin-api" \
  test "$(status -H 'Host: admin.smoke.test' "$EDGE/api/v1/portal/anything")" = 404
"${CURL[@]}" -D "$TMP/admin.headers" -o "$TMP/admin.html" -H 'Host: admin.smoke.test' "$EDGE/"
check "the admin host's / is 200 from admin-web, under an arbitrary UID" \
  test "$(status -H 'Host: admin.smoke.test' "$EDGE/")" = 200
check "the admin host's / is admin-web's SPA shell, not portal-web's" grep -q '<title>SDG Admin</title>' "$TMP/admin.html"
check "the admin host's client routes fall back to admin-web's SPA" \
  test "$(status -H 'Host: admin.smoke.test' "$EDGE/service-clients")" = 200
check "the admin host's production CSP has no unsafe-inline styles" bash -c \
  "grep -i '^content-security-policy:' '$TMP/admin.headers' | grep -o 'style-src [^;]*' | grep -vq unsafe-inline"
check "the gateway host's / is 404 (gateway-api serves /api only)" \
  test "$(status -H 'Host: gateway.smoke.test' "$EDGE/")" = 404
check "the gateway host's /api/v1/gateway/me without a token is 401 from gateway-api" \
  test "$(status -H 'Host: gateway.smoke.test' "$EDGE/api/v1/gateway/me")" = 401
check "/.env is blocked by the WAF" test "$(status "$EDGE/.env")" = 403

psql "drop database if exists $SMOKE_DB with (force)" >/dev/null || true
echo
echo "Passed: $PASSED  Failed: $FAILED"
((FAILED == 0))
