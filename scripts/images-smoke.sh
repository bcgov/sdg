#!/usr/bin/env bash
# Smoke test for the production images (DEVELOPER.md, Production Images).
# Builds portal-database, portal-api, portal-web and the edge, then runs them the way OpenShift's restricted SCC
# does (arbitrary UID in group 0, no capabilities, no privilege escalation) against the compose postgis/valkey.
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
  "$ENGINE" rm -f "$PREFIX-api" "$PREFIX-web" "$PREFIX-edge" >/dev/null 2>&1 || true
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
check "no .env files in the Node images" bash -c "! { $ENGINE run --rm $(image portal-api) find / -xdev -name '.env*' -not -name '.env.example'; \
  $ENGINE run --rm $(image portal-database) find / -xdev -name '.env*' -not -name '.env.example'; } | grep -q ."
check "no package manager in the final images" bash -c "for i in portal-api portal-database portal-web edge; do \
  ! $ENGINE run --rm \"localhost/$PREFIX/\$i:latest\" sh -c 'command -v apk || command -v npm || command -v pnpm' || exit 1; done"

echo "Waiting for compose postgis and valkey"
$COMPOSE up -d postgis valkey >/dev/null
POSTGIS="$("$ENGINE" ps -q --filter label=com.docker.compose.project=portal --filter label=com.docker.compose.service=postgis)"
deadline=$((SECONDS + WAIT_SECONDS))
until [ "$("$ENGINE" inspect -f '{{.State.Health.Status}}' "$POSTGIS")" = healthy ]; do
  ((SECONDS > deadline)) && { fail "postgis healthy within ${WAIT_SECONDS}s"; exit 1; }
  sleep 2
done
psql() { "$ENGINE" exec "$POSTGIS" sh -c "psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" -tAc \"$1\""; }
psql_smoke() { "$ENGINE" exec "$POSTGIS" sh -c "psql -U \"\$POSTGRES_USER\" -d $SMOKE_DB -tAc \"$1\""; }
psql "drop database if exists $SMOKE_DB with (force)" >/dev/null 2>&1
psql "create database $SMOKE_DB" >/dev/null
DATABASE_URL="postgres://portal:portal@postgis:5432/$SMOKE_DB"

echo "portal-database (initContainer)"
# Runs the migrator once; its output goes to $TMP/<name>.log and its exit code to $TMP/<name>.code.
migrate() {
  local name="$1"; shift
  local code=0
  "$ENGINE" run --rm --read-only "${OCP[@]}" "$@" "$(image portal-database)" >"$TMP/$name.log" 2>&1 || code=$?
  echo "$code" >"$TMP/$name.code"
}
exit_code() { cat "$TMP/$1.code"; }
migrate no-url
check "exits 1 without DATABASE_URL" test "$(exit_code no-url)" = 1
check "explains the missing DATABASE_URL" grep -q 'DATABASE_URL is not set' "$TMP/no-url.log"
migrate first -e "DATABASE_URL=$DATABASE_URL"
check "migrates an empty database (exit 0)" test "$(exit_code first)" = 0
expected="$(grep -c '"tag"' packages/portal-database/migrations/meta/_journal.json)"
applied="$(psql_smoke 'select count(*) from drizzle.__drizzle_migrations' || echo 0)"
check "all $expected journal migrations recorded (found $applied)" test "$applied" = "$expected"
check "principals and identities tables exist" test \
  "$(psql_smoke "select count(*) from information_schema.tables where table_name in ('principals', 'identities')")" = 2
migrate again -e "DATABASE_URL=$DATABASE_URL"
check "re-running with nothing pending exits 0" test "$(exit_code again)" = 0
migrate bad-pw -e "DATABASE_URL=postgres://portal:smoke-s3cret@postgis:5432/$SMOKE_DB"
check "a wrong password exits 1" test "$(exit_code bad-pw)" = 1
check "the password never reaches the output" bash -c "! grep -q 'smoke-s3cret' '$TMP/bad-pw.log'"

echo "portal-api"
"$ENGINE" run -d --name "$PREFIX-api" --read-only "${OCP[@]}" \
  -e "DATABASE_URL=$DATABASE_URL" -e VALKEY_URL=redis://valkey:6379 \
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
check "logs are JSON lines (NODE_ENV=production, no pino-pretty)" bash -c \
  "$ENGINE logs $PREFIX-api 2>&1 | head -n 1 | node -e 'JSON.parse(require(\"fs\").readFileSync(0, \"utf8\"))'"

echo "portal-web and edge"
"$ENGINE" run -d --name "$PREFIX-web" "${OCP[@]}" "$(image portal-web)" >/dev/null
"$ENGINE" run -d --name "$PREFIX-edge" "${OCP[@]}" -p 127.0.0.1::3000 \
  -e "PORTAL_API_URL=http://$PREFIX-api:3000" -e "PORTAL_WEB_URL=http://$PREFIX-web:8080" \
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
check "GET /api/auth/me without a session is 401 from portal-api" \
  test "$("${CURL[@]}" -D "$TMP/api.headers" -o /dev/null -w '%{http_code}' "$EDGE/api/auth/me")" = 401
check "API responses default to Cache-Control: no-store" grep -qi '^cache-control: no-store' "$TMP/api.headers"
check "/.env is blocked by the WAF" test "$(status "$EDGE/.env")" = 403

psql "drop database if exists $SMOKE_DB with (force)" >/dev/null || true
echo
echo "Passed: $PASSED  Failed: $FAILED"
((FAILED == 0))
