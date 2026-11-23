#!/usr/bin/env bash
# Usage: scripts/e2e-probe.sh <log-file> <url>...
#
# Runs until killed: every 2s requests each URL once with curl and appends one line per request:
#   <UTC time> <url> rc=<curl exit code> <remote ip> <connect seconds> <http code> [curl error]
# Run it in the background while the E2E suites run against a PR environment to see whether refused connections
# (curl rc=7) hit one host or every Gold host from the runner, when they start and end, and whether the address changes.
set -u

log=$1
shift

while true; do
  for url in "$@"; do
    result=$(curl -sS -o /dev/null -m 5 -w '%{remote_ip} %{time_connect} %{http_code}' "$url" 2>&1)
    rc=$?
    echo "$(date -u +%FT%TZ) $url rc=$rc ${result//$'\n'/ }" >> "$log"
  done
  sleep 2
done
