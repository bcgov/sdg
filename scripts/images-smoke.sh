#!/usr/bin/env bash
# Smoke test for the production images (DEVELOPER.md, Production Images).
# Builds portal-database, portal-api, portal-web, notification-database, notification-api and the edge, then runs
# them the way OpenShift's restricted SCC does (arbitrary UID in group 0, no capabilities, no privilege escalation)
# against the compose postgis.
#
# Usage: scripts/images-smoke.sh [--no-build]
#   --no-build  reuse images built by an earlier run
# ENGINE=docker uses Docker instead of Podman.
set -euo pipefail

ENGINE="${ENGINE:-podman}"
COMPOSE="${COMPOSE:-$ENGINE compose}"
NETWORK=portal_default
PREFIX=sdg-images-smoke
SMOKE_DB=portal_images_smoke
NOTIFY_DB=notification_images_smoke
NOTIFY_RACE_DB=notification_images_smoke_race
# Matches coraza.conf's notification host shape (<release>-notify.), as common.notifyHost renders it on OpenShift.
NOTIFY_HOST="$PREFIX-notify.apps.example"
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
POSTGIS=
cleanup() {
  "$ENGINE" rm -f "$PREFIX-api" "$PREFIX-notification-api" "$PREFIX-web" "$PREFIX-edge" >/dev/null 2>&1 || true
  if [ -n "$POSTGIS" ]; then
    for db in "$SMOKE_DB" "$NOTIFY_DB" "$NOTIFY_RACE_DB"; do psql "drop database if exists $db with (force)" >/dev/null 2>&1 || true; done
  fi
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
  "$ENGINE" build -q -t "$(image portal-database)" -f packages/portal-database/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image portal-api)" -f apps/portal-api/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image portal-web)" -f apps/portal-web/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image notification-database)" -f packages/notification-database/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image notification-api)" -f apps/notification-api/Dockerfile . >/dev/null
  "$ENGINE" build -q -t "$(image edge)" apps/portal-web/caddy >/dev/null
fi

echo "Image contents"
node_in() { "$ENGINE" run --rm "$(image "$1")" node -e "$2"; }
check "portal-api ships dist and no sources" node_in portal-api \
  "const fs = require('fs'); process.exit(fs.existsSync('dist/main.js') && !fs.existsSync('src') ? 0 : 1)"
check "portal-api ships no devDependencies (pino-pretty, typescript, @nestjs/cli)" node_in portal-api \
  "const fs = require('fs'); process.exit(['pino-pretty', 'typescript', '@nestjs/cli'].some((d) => fs.existsSync('node_modules/' + d)) ? 1 : 0)"
check "portal-database ships dist/migrate.js and the migrations" node_in portal-database \
  "const fs = require('fs'); process.exit(fs.existsSync('dist/migrate.js') && fs.existsSync('migrations/meta/_journal.json') ? 0 : 1)"
check "notification-api ships dist and no sources" node_in notification-api \
  "const fs = require('fs'); process.exit(fs.existsSync('dist/main.js') && !fs.existsSync('src') ? 0 : 1)"
check "notification-api ships no devDependencies (pino-pretty, typescript, @nestjs/cli, vitest, pglite)" \
  node_in notification-api "const fs = require('fs'); process.exit(['pino-pretty', 'typescript', '@nestjs/cli', \
  'vitest', '@electric-sql/pglite'].some((d) => fs.existsSync('node_modules/' + d)) ? 1 : 0)"
check "notification-database ships dist/migrate.js and the migrations" node_in notification-database \
  "const fs = require('fs'); process.exit(fs.existsSync('dist/migrate.js') && fs.existsSync('migrations/meta/_journal.json') && !fs.existsSync('src') ? 0 : 1)"
check "notification-database ships no devDependencies (drizzle-kit, typescript, vitest, pglite)" \
  node_in notification-database "const fs = require('fs'); process.exit(['drizzle-kit', 'typescript', 'vitest', \
  '@electric-sql/pglite'].some((d) => fs.existsSync('node_modules/' + d)) ? 1 : 0)"
check "no .env files in the Node images" bash -c "for i in portal-api portal-database notification-api notification-database; do \
  ! $ENGINE run --rm \"localhost/$PREFIX/\$i:latest\" find / -xdev -name '.env*' -not -name '.env.example' | grep -q . || exit 1; done"
check "no package manager in the final images" bash -c "for i in portal-api portal-database portal-web notification-api notification-database edge; do \
  ! $ENGINE run --rm \"localhost/$PREFIX/\$i:latest\" sh -c 'command -v apk || command -v npm || command -v pnpm' || exit 1; done"

echo "Waiting for compose postgis"
$COMPOSE up -d postgis >/dev/null
POSTGIS="$("$ENGINE" ps -q --filter label=com.docker.compose.project=portal --filter label=com.docker.compose.service=postgis)"
deadline=$((SECONDS + WAIT_SECONDS))
until [ "$("$ENGINE" inspect -f '{{.State.Health.Status}}' "$POSTGIS")" = healthy ]; do
  ((SECONDS > deadline)) && { fail "postgis healthy within ${WAIT_SECONDS}s"; exit 1; }
  sleep 2
done
psql() { "$ENGINE" exec "$POSTGIS" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"$1\""; }
psql_in() { "$ENGINE" exec "$POSTGIS" sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -tAc \"$2\""; }
for db in "$SMOKE_DB" "$NOTIFY_DB" "$NOTIFY_RACE_DB"; do
  psql "drop database if exists $db with (force)" >/dev/null 2>&1
  psql "create database $db" >/dev/null
done
DATABASE_URL="postgres://portal:portal@postgis:5432/$SMOKE_DB"
NOTIFY_DATABASE_URL="postgres://portal:portal@postgis:5432/$NOTIFY_DB"

echo "portal-database (initContainer)"
# Runs migrator image $1 once; its output goes to $TMP/<name>.log and its exit code to $TMP/<name>.code.
migrate() {
  local migrator="$1" name="$2"; shift 2
  local code=0
  "$ENGINE" run --rm --read-only "${OCP[@]}" "$@" "$(image "$migrator")" >"$TMP/$name.log" 2>&1 || code=$?
  echo "$code" >"$TMP/$name.code"
}
exit_code() { cat "$TMP/$1.code"; }
migrate portal-database no-url
check "exits 1 without DATABASE_URL" test "$(exit_code no-url)" = 1
check "explains the missing DATABASE_URL" grep -q 'DATABASE_URL is not set' "$TMP/no-url.log"
migrate portal-database first -e "DATABASE_URL=$DATABASE_URL"
check "migrates an empty database (exit 0)" test "$(exit_code first)" = 0
expected="$(grep -c '"tag"' packages/portal-database/migrations/meta/_journal.json)"
applied="$(psql_in "$SMOKE_DB" 'select count(*) from drizzle.__drizzle_migrations' || echo 0)"
check "all $expected journal migrations recorded (found $applied)" test "$applied" = "$expected"
check "principals, identities and sessions tables exist" test \
  "$(psql_in "$SMOKE_DB" "select count(*) from information_schema.tables where table_name in ('principals', 'identities', 'sessions')")" = 3
migrate portal-database again -e "DATABASE_URL=$DATABASE_URL"
check "re-running with nothing pending exits 0" test "$(exit_code again)" = 0
migrate portal-database bad-pw -e "DATABASE_URL=postgres://portal:smoke-s3cret@postgis:5432/$SMOKE_DB"
check "a wrong password exits 1" test "$(exit_code bad-pw)" = 1
check "the password never reaches the output" bash -c "! grep -q 'smoke-s3cret' '$TMP/bad-pw.log'"

echo "notification-database (initContainer)"
migrate notification-database n-no-url
check "exits 1 without DATABASE_URL" test "$(exit_code n-no-url)" = 1
check "explains the missing DATABASE_URL" grep -q 'DATABASE_URL is not set' "$TMP/n-no-url.log"
migrate notification-database n-bad-pw -e "DATABASE_URL=postgres://portal:smoke-s3cret@postgis:5432/$NOTIFY_DB"
check "a wrong password exits 1" test "$(exit_code n-bad-pw)" = 1
check "the password never reaches the output" bash -c "! grep -q 'smoke-s3cret' '$TMP/n-bad-pw.log'"
migrate notification-database n-first -e "DATABASE_URL=$NOTIFY_DATABASE_URL"
check "migrates an empty database (exit 0)" test "$(exit_code n-first)" = 0
expected="$(grep -c '"tag"' packages/notification-database/migrations/meta/_journal.json)"
applied="$(psql_in "$NOTIFY_DB" 'select count(*) from drizzle.__drizzle_migrations' || echo 0)"
check "all $expected journal migrations recorded (found $applied)" test "$applied" = "$expected"
migrate notification-database n-again -e "DATABASE_URL=$NOTIFY_DATABASE_URL"
check "re-running with nothing pending exits 0" test "$(exit_code n-again)" = 0
# AE4: two initContainers of a new release start together on an empty database; the migration lock serializes them.
migrate notification-database n-race-a -e "DATABASE_URL=postgres://portal:portal@postgis:5432/$NOTIFY_RACE_DB" &
migrate notification-database n-race-b -e "DATABASE_URL=postgres://portal:portal@postgis:5432/$NOTIFY_RACE_DB" &
wait
check "two migrators started together both exit 0" test "$(exit_code n-race-a)$(exit_code n-race-b)" = 00
applied="$(psql_in "$NOTIFY_RACE_DB" 'select count(*) from drizzle.__drizzle_migrations' || echo 0)"
check "the journal holds each of the $expected migrations once (found $applied)" test "$applied" = "$expected"

echo "portal-api"
"$ENGINE" run -d --name "$PREFIX-api" --read-only "${OCP[@]}" \
  -e "DATABASE_URL=$DATABASE_URL" \
  -e APP_URL=https://portal.example.gov.bc.ca -e TRUST_PROXY=true \
  -e "SESSION_SECRET=$(head -c 48 /dev/urandom | base64)" \
  -e KEYCLOAK_ISSUER_URL=https://keycloak.example.com/realms/portal \
  -e KEYCLOAK_CLIENT_ID=portal -e KEYCLOAK_CLIENT_SECRET=smoke \
  "$(image portal-api)" >/dev/null
live() { "$ENGINE" exec "$1" node -e \
  "fetch('http://localhost:3000/healthz/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; }
# Waits up to 60s for container $1's /healthz/live, then checks it and that its first log line is JSON.
check_api() {
  local deadline=$((SECONDS + 60))
  until live "$1" >/dev/null 2>&1 || ((SECONDS > deadline)); do sleep 1; done
  check "/healthz/live is 200 under an arbitrary UID with a read-only root" live "$1"
  check "logs are JSON lines (NODE_ENV=production, no pino-pretty)" bash -c \
    "$ENGINE logs $1 2>&1 | head -n 1 | node -e 'JSON.parse(require(\"fs\").readFileSync(0, \"utf8\"))'"
}
check_api "$PREFIX-api"

echo "notification-api"
"$ENGINE" run -d --name "$PREFIX-notification-api" --read-only "${OCP[@]}" \
  -e "DATABASE_URL=$NOTIFY_DATABASE_URL" -e NOTIFICATION_ROLE=api -e TRUST_PROXY=true \
  -e KEYCLOAK_ISSUER_URL=https://keycloak.example.com/realms/portal -e NOTIFICATION_CLIENT_ID=notification-api \
  -e CORS_ALLOWED_ORIGINS=http://localhost:5173 -e CONFIRM_EMAIL_URL=https://portal.example.gov.bc.ca/confirm-email \
  -e "NOTIFICATION_ENCRYPTION_KEY=$(head -c 48 /dev/urandom | base64)" \
  "$(image notification-api)" >/dev/null
check_api "$PREFIX-notification-api"

echo "portal-web and edge"
"$ENGINE" run -d --name "$PREFIX-web" "${OCP[@]}" "$(image portal-web)" >/dev/null
"$ENGINE" run -d --name "$PREFIX-edge" "${OCP[@]}" -p 127.0.0.1::3000 \
  -e "PORTAL_API_URL=http://$PREFIX-api:3000" -e "PORTAL_WEB_URL=http://$PREFIX-web:8080" \
  -e NOTIFY=on -e "NOTIFY_HOST=$NOTIFY_HOST" -e "NOTIFICATION_API_URL=http://$PREFIX-notification-api:3000" \
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
check "/.env is blocked by the WAF" test "$(status "$EDGE/.env")" = 403

echo "Edge notification host ($NOTIFY_HOST)"
NOTIFY=(-H "Host: $NOTIFY_HOST")
PREFLIGHT=(-X OPTIONS -H 'Origin: http://localhost:5173' -H 'Access-Control-Request-Method: GET')
"${CURL[@]}" -D "$TMP/preflight.headers" -o /dev/null "${NOTIFY[@]}" "${PREFLIGHT[@]}" "$EDGE/api/v1/me/inbox"
check "preflight on the notification host gets notification-api's CORS answer (AE1)" \
  test "$(header Access-Control-Allow-Origin "$TMP/preflight.headers")" = http://localhost:5173
check "the same preflight on the portal host is 405 (AE1)" test "$(status "${PREFLIGHT[@]}" "$EDGE/api/v1/me/inbox")" = 405
check "TRACE on the notification host is 405" test "$(status -X TRACE "${NOTIFY[@]}" "$EDGE/api/v1/me/inbox")" = 405
check "GET /metrics on the notification host is 404" test "$(status "${NOTIFY[@]}" "$EDGE/metrics")" = 404
check "GET /healthz/ready on the notification host is 404" test "$(status "${NOTIFY[@]}" "$EDGE/healthz/ready")" = 404
JWT=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzbW9rZSIsImF1ZCI6Im5vdGlmaWNhdGlvbi1hcGkifQ.c21va2Utc2lnbmF0dXJl
code="$("${CURL[@]}" -o "$TMP/bearer.json" -w '%{http_code}' "${NOTIFY[@]}" -H "Authorization: Bearer $JWT" "$EDGE/api/v1/me/inbox")"
# notification-api answers (Nest's JSON error; 401 or 503 with the unreachable placeholder issuer), not the WAF's 403.
check "a bearer token on the notification host passes the WAF to notification-api ($code)" \
  bash -c "test '$code' != 403 && grep -q '\"statusCode\"' '$TMP/bearer.json'"

# Audit trim (coraza.conf 1010): a request the WAF blocks and logs (1003, scanner User-Agent) carrying a bearer token
# and a JSON body, each holding marker $2. Leaves its status in $TMP/audit-$1.code and the edge log lines it adds,
# once they hold its audit entry, in $TMP/audit-$1.log.
audit_probe() {
  local name="$1" marker="$2"; shift 2
  local from deadline=$((SECONDS + 10))
  from="$("$ENGINE" logs "$PREFIX-edge" 2>&1 | wc -l)"
  status -X POST -A sqlmap/1.8 -H "Authorization: Bearer $marker" -H 'Content-Type: application/json' \
    --data "{\"secret\":\"$marker\"}" "$@" "$EDGE/api/v1/me/inbox" >"$TMP/audit-$name.code" || true
  until "$ENGINE" logs "$PREFIX-edge" 2>&1 | tail -n "+$((from + 1))" >"$TMP/audit-$name.log"
    grep -q '^\[client .*\[id "1003"\]' "$TMP/audit-$name.log" || ((SECONDS > deadline)); do sleep 1; done
}
audit_probe notify "notify-marker-$RANDOM$RANDOM" "${NOTIFY[@]}"
audit_probe portal "portal-marker-$RANDOM$RANDOM"
check "a scanner request on the notification host is blocked (WAF rule 1003)" test "$(cat "$TMP/audit-notify.code")" = 403
check "its audit entry is written" grep -q '^\[client .*\[id "1003"\]' "$TMP/audit-notify.log"
check "its audit entry has neither the bearer token nor the body" bash -c "! grep -q notify-marker- '$TMP/audit-notify.log'"
check "the same request on the portal host still logs its headers" bash -c \
  "test \"\$(cat '$TMP/audit-portal.code')\" = 403 && grep -q '^authorization: Bearer portal-marker-' '$TMP/audit-portal.log'"
echo
echo "Passed: $PASSED  Failed: $FAILED"
((FAILED == 0))
