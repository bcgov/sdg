#!/usr/bin/env bash
# Tests scripts/header-manifest.sh: manifest verification and CI record lookup filtering.
#
# Usage: scripts/header-manifest.test.sh
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/header-manifest.sh"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FAILED=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; FAILED=1; }

# --- 1. verify subcommand ---
DEV_KEY_ID="$(node -p "Object.keys(require('${ROOT}/packages/shared-ui/keys/dev.private.json').keys).find((id) => id.startsWith('dev-primary-'))")"
DEV_KEY="$(node -p "const f = require('${ROOT}/packages/shared-ui/keys/dev.private.json'); JSON.stringify(Object.entries(f.keys).find(([id]) => id.startsWith('dev-primary-'))[1])")"

cat > "$TMP/release.json" <<EOF
{
  "schema": 1,
  "sequence": 1795000000000,
  "bundle": {
    "path": "/shared-ui/header/v1/bundles/sdg-header-test1234.js",
    "integrity": "sha384-$(printf 'A%.0s' {1..64})"
  }
}
EOF

HEADER_SIGNING_KEY="$DEV_KEY" HEADER_SIGNING_KEY_ID="$DEV_KEY_ID" HEADER_KEYSET=dev HEADER_FLOOR=0 \
  node "${ROOT}/packages/shared-ui/scripts/sign-manifest.ts" release \
    --release "$TMP/release.json" --version test-1 --out "$TMP/valid.json" >/dev/null

if out="$("$SCRIPT" verify dev "$TMP/valid.json" 2>&1)" && [ "$(jq -r .sequence <<< "$out")" = "1795000000000" ]; then
  pass "verify accepts a valid dev manifest and prints payload JSON"
else
  fail "verify rejected a valid dev manifest: $out"
fi

# Tampered manifest
jq '.sig = "AAAA"' "$TMP/valid.json" > "$TMP/tampered.json"
if "$SCRIPT" verify dev "$TMP/tampered.json" >/dev/null 2>&1; then
  fail "verify accepted a tampered manifest"
else
  pass "verify rejects a tampered manifest"
fi

# Expired manifest
node --input-type=module - "$ROOT" "$TMP/expired.json" <<'EOF'
import { createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [root, out] = process.argv.slice(2);
const { signManifest } = await import(pathToFileURL(`${root}/packages/shared-ui/src/signing/sign.ts`).href);
const devPrivate = JSON.parse(readFileSync(`${root}/packages/shared-ui/keys/dev.private.json`, 'utf8'));
const [keyId, jwk] = Object.entries(devPrivate.keys).find(([id]) => id.startsWith('dev-primary-'));
const env = signManifest(
  {
    schema: 1,
    keyset: 'dev',
    version: 'expired-1',
    sequence: 1795000000000,
    floor: 0,
    issuedAt: 1000,
    expires: 2000,
    bundle: { path: '/shared-ui/header/v1/bundles/sdg-header-test1234.js', integrity: `sha384-${'A'.repeat(64)}` },
  },
  { keyId, privateKey: createPrivateKey({ key: jwk, format: 'jwk' }) },
);
writeFileSync(out, JSON.stringify(env));
EOF

if "$SCRIPT" verify dev "$TMP/expired.json" >/dev/null 2>&1; then
  fail "verify accepted an expired manifest without --accept-expired"
else
  pass "verify rejects an expired manifest without --accept-expired"
fi

if out="$("$SCRIPT" verify dev "$TMP/expired.json" --accept-expired 2>&1)" && [ "$(jq -r .version <<< "$out")" = "expired-1" ]; then
  pass "verify accepts an expired manifest with --accept-expired"
else
  fail "verify --accept-expired rejected an expired manifest: $out"
fi

# --- 2. record subcommand with stub gh ---
STUB_BIN="$TMP/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/gh" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = api ]; then
  case "$2" in
    *"/actions/artifacts"*)
      # Run 300 is newest (pull_request -> skip), 200 is non-signing workflow (pr-open.yml -> skip),
      # 100 is valid merge.yml push run -> download.
      printf '300\n200\n100\n'
      ;;
    *"/actions/runs/300")
      printf '.github/workflows/merge.yml pull_request\n'
      ;;
    *"/actions/runs/200")
      printf '.github/workflows/pr-open.yml workflow_dispatch\n'
      ;;
    *"/actions/runs/100")
      printf '.github/workflows/merge.yml push\n'
      ;;
    *)
      exit 1
      ;;
  esac
elif [ "$1" = run ] && [ "$2" = download ]; then
  run_id="$3"
  dir=""
  while [ $# -gt 0 ]; do
    if [ "$1" = -D ]; then dir="$2"; shift; fi
    shift
  done
  printf '{"downloaded_from":%s}\n' "$run_id" > "${dir}/manifest.json"
else
  exit 1
fi
STUB
chmod +x "$STUB_BIN/gh"

if out="$(PATH="$STUB_BIN:$PATH" GITHUB_REPOSITORY="acme/sdg" "$SCRIPT" record test "$TMP/dl" 2>&1)" \
  && [ "$(jq -r .downloaded_from "$TMP/dl/manifest.json")" = "100" ]; then
  pass "record skips pull_request and non-signing workflows and downloads from merge.yml"
else
  fail "record did not select run 100: $out"
fi

if PATH="$STUB_BIN:$PATH" GITHUB_REPOSITORY="acme/sdg" "$SCRIPT" record prod "$TMP/dl-prod" >/dev/null 2>&1; then
  fail "record prod accepted merge.yml artifact"
else
  pass "record prod refuses merge.yml artifact when no release.yml/header-resign.yml run matches"
fi

exit "$FAILED"
