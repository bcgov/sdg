#!/usr/bin/env bash
# Runs the k6 load scripts against a deployment (DEVELOPER.md, Load tests).  Don't point it at PROD.
#
# Usage: BASE_URL=https://sdg-test.apps.gold.devops.gov.bc.ca [LOAD_PROFILE=smoke] pnpm test:load [portal-web|portal-api]...
#   BASE_URL      origin to load, e.g. https://sdg.localhost for the compose stack (required)
#   LOAD_PROFILE  ramp (default: 50 VUs over 5 min) or smoke (1 VU, 10s)
# Exits non-zero when a script fails or breaches its thresholds.  Needs k6 (brew install k6).
set -euo pipefail

cd "$(dirname "$0")"
command -v k6 >/dev/null || { echo "k6 is missing: brew install k6 (https://grafana.com/docs/k6/latest/set-up/install-k6/)" >&2; exit 1; }
[ -n "${BASE_URL:-}" ] || { echo "Set BASE_URL, e.g. BASE_URL=https://sdg.localhost pnpm test:load" >&2; exit 1; }

scripts=("$@")
[ ${#scripts[@]} -gt 0 ] || scripts=(portal-web portal-api)
for script in "${scripts[@]}"; do
  [ -f "${script}.ts" ] || { echo "Unknown load script: ${script} (portal-web or portal-api)" >&2; exit 1; }
done
# Run every script, then fail if any failed
failed=()
for script in "${scripts[@]}"; do
  echo "== ${script} (${LOAD_PROFILE:-ramp}) against ${BASE_URL}"
  k6 run -e BASE_URL="$BASE_URL" -e LOAD_PROFILE="${LOAD_PROFILE:-}" "${script}.ts" || failed+=("$script")
done
[ ${#failed[@]} -eq 0 ] || { echo "Failed: ${failed[*]}" >&2; exit 1; }
