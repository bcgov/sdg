#!/usr/bin/env bash
# Trusts the local compose stack's Caddy root CA on this machine, so https://sdg.localhost loads without warnings.
# The CA lives in the caddy-data volume; rerun after deleting that volume (a new CA is generated).
# Needs the caddy service to have started once. ENGINE=docker uses Docker instead of Podman.
set -euo pipefail

ENGINE="${ENGINE:-podman}"
NAME=sdg-caddy-local-root

CADDY="$("$ENGINE" ps -aq \
  --filter label=com.docker.compose.project=portal \
  --filter label=com.docker.compose.service=caddy | head -n 1)"
if [ -z "$CADDY" ]; then
  echo "No caddy container found. Start the stack first: $ENGINE compose up -d" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
CERT="$TMP/$NAME.crt"
"$ENGINE" cp "$CADDY:/data/caddy/pki/authorities/local/root.crt" "$CERT"
FINGERPRINT="$(openssl x509 -in "$CERT" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)"
echo "Caddy root: $(openssl x509 -in "$CERT" -noout -subject | sed 's/^subject= *//') (SHA-1 $FINGERPRINT)"

case "$(uname -s)" in
  Darwin)
    KEYCHAIN=/Library/Keychains/System.keychain
    if security find-certificate -a -Z -c "Caddy Local Authority" "$KEYCHAIN" 2>/dev/null | grep -q "$FINGERPRINT"; then
      echo "Already trusted in the System keychain."
      exit 0
    fi
    echo "Adding to the System keychain (sudo)..."
    sudo security add-trusted-cert -d -r trustRoot -k "$KEYCHAIN" "$CERT"
    ;;
  Linux)
    if command -v update-ca-certificates >/dev/null; then
      sudo install -m 0644 "$CERT" "/usr/local/share/ca-certificates/$NAME.crt"
      sudo update-ca-certificates
    elif command -v trust >/dev/null; then
      sudo trust anchor --store "$CERT"
    else
      echo "Unsupported Linux trust store: install $CERT manually." >&2
      exit 1
    fi
    ;;
  *)
    echo "Unsupported OS $(uname -s): trust the root manually (DEVELOPER.md, Local Stack)." >&2
    exit 1
    ;;
esac

echo "Trusted. Firefox uses its own store: import the certificate there or set security.enterprise_roots.enabled."
