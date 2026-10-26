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
caddy_validate() {
  $COMPOSE run --rm --no-deps -T \
    -e PORTAL_API_URL=http://portal-api:3000 -e PORTAL_WEB_URL=http://portal-web:5173 -e LOG_LEVEL=INFO \
    --entrypoint caddy caddy validate --adapter caddyfile --config "/etc/caddy/$1"
}

echo "Caddy config"
$COMPOSE build caddy >/dev/null
check "Caddyfile (production) validates" caddy_validate Caddyfile
check "Caddyfile.dev validates" caddy_validate Caddyfile.dev

if $UP; then
  echo "Starting stack (first run installs dependencies, this takes a while)"
  $COMPOSE up -d --build >/dev/null
fi

echo "Waiting for $SITE"
deadline=$((SECONDS + WAIT_SECONDS))
until curl -ksSf -o /dev/null "$SITE/"; do
  if ((SECONDS > deadline)); then
    fail "stack reachable at $SITE within ${WAIT_SECONDS}s"
    $COMPOSE ps || true
    echo "Passed: $PASSED  Failed: $FAILED"
    exit 1
  fi
  sleep 5
done

CADDY="$(container caddy)"
API="$(container portal-api)"
WEB="$(container portal-web)"
MIGRATE="$(container migrate)"
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

echo "API proxy"
check "GET /api/auth/me without a session is 401 from portal-api" \
  test "$("${CURL[@]}" -o "$TMP/me.json" -w '%{http_code} %{content_type}' "$SITE/api/auth/me")" \
  = "401 application/json; charset=utf-8"
check "portal-api is live inside the network" "$ENGINE" exec "$API" node -e \
  "fetch('http://localhost:3000/healthz/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

echo "WAF"
check "/.env is blocked (rule 1004)" test "$(status "$SITE/.env")" = 403
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

echo "Migrations"
# migrate touches /tmp/ready only after drizzle-kit succeeds; portal-api waits for that (service_healthy).
check "migrate completed (healthy)" test "$("$ENGINE" inspect -f '{{.State.Health.Status}}' "$MIGRATE")" = healthy
check "migrations completed before portal-api started" test \
  "$("$ENGINE" exec "$MIGRATE" stat -c %Y /tmp/ready)" -le "$("$ENGINE" inspect -f '{{.State.StartedAt.Unix}}' "$API")"
expected="$(grep -c '"tag"' packages/portal-database/migrations/meta/_journal.json)"
applied="$("$ENGINE" exec "$POSTGIS" sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from drizzle.__drizzle_migrations"' 2>/dev/null || echo 0)"
check "all $expected journal migrations applied (found $applied)" test "$applied" = "$expected"

echo
echo "Passed: $PASSED  Failed: $FAILED"
((FAILED == 0))
