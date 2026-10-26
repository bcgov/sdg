#!/usr/bin/env bash
# Tests the k6 load scripts without sending traffic (DEVELOPER.md, Load tests): `k6 inspect` evaluates each
# script's init code and prints its options, so profiles, thresholds and input validation can be asserted.
#
# Usage: tests/load/load.test.sh   (needs k6 and jq)
set -uo pipefail

cd "$(dirname "$0")" || exit 1
command -v k6 >/dev/null || { echo "k6 is missing: brew install k6 (https://grafana.com/docs/k6/latest/set-up/install-k6/)" >&2; exit 1; }
FAILED=0
URL=https://sdg-test.apps.gold.devops.gov.bc.ca

# expect <name> <actual> <expected>  (k6 inspect prints durations in Go form: 1m0s)
expect() {
  if [ "$2" = "$3" ]; then echo "PASS: $1"
  else echo "FAIL: $1: got '$2', want '$3'"; FAILED=1; fi
}

# rejects <name> <script> <k6 -e flags...>: inspect must fail, with the variable named in the error
rejects() {
  local name="$1" script="$2" var out
  shift 2
  var="${*: -1}"; var="${var%%=*}"
  if out="$(k6 inspect "$@" "$script" 2>&1)"; then echo "FAIL: ${name}: accepted"; FAILED=1
  elif grep -q "$var" <<< "$out"; then echo "PASS: ${name}"
  else echo "FAIL: ${name}: error does not name ${var}: ${out}"; FAILED=1; fi
}

for script in portal-web.ts portal-api.ts; do
  ramp="$(k6 inspect -e BASE_URL="$URL" "$script")" || { echo "FAIL: ${script}: inspect failed"; FAILED=1; continue; }
  expect "${script} ramp profile is 1m→50, 3m@50, 1m→0 by default" \
    "$(jq -c '[.stages[] | [.duration, .target]]' <<< "$ramp")" '[["1m0s",50],["3m0s",50],["1m0s",0]]'
  expect "${script} fails on more than 1% unexpected responses" \
    "$(jq -c '.thresholds.http_req_failed' <<< "$ramp")" '["rate<0.01"]'
  expect "${script} fails when p95 latency reaches 500ms" \
    "$(jq -c '.thresholds.http_req_duration' <<< "$ramp")" '["p(95)<500"]'
  expect "${script} fails when more than 1% of checks fail" \
    "$(jq -c '.thresholds.checks' <<< "$ramp")" '["rate>0.99"]'

  smoke="$(k6 inspect -e BASE_URL="$URL" -e LOAD_PROFILE=smoke "$script")"
  expect "${script} smoke profile is 1 VU for 10s" \
    "$(jq -c '[.stages[] | [.duration, .target]]' <<< "$smoke")" '[["10s",1]]'
  expect "${script} smoke profile keeps the thresholds" \
    "$(jq -c '.thresholds | keys' <<< "$smoke")" '["checks","http_req_duration","http_req_failed"]'

  rejects "${script} requires BASE_URL" "$script" -e BASE_URL=
  rejects "${script} rejects a BASE_URL with a path" "$script" -e BASE_URL="${URL}/api"
  rejects "${script} rejects a BASE_URL with a trailing slash" "$script" -e BASE_URL="${URL}/"
  rejects "${script} rejects a non-http BASE_URL" "$script" -e BASE_URL=ftp://example.com
  rejects "${script} rejects an unknown LOAD_PROFILE" "$script" -e BASE_URL="$URL" -e LOAD_PROFILE=soak
done

exit "$FAILED"
