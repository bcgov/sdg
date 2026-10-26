#!/usr/bin/env bash
# Tests scripts/deploy-values.sh (DEVELOPER.md, Workflows): derived values per environment and input validation.
#
# Usage: scripts/deploy-values.test.sh
set -uo pipefail

SCRIPT="$(dirname "$0")/deploy-values.sh"
FAILED=0

# PR defaults; each case overrides what it tests
base_env() {
  export TARGET=12 TAG=0123abc REPOSITORY=Acme/sdg ENVIRONMENT='' VAULT_SECRET_PATH=''
  export OC_NAMESPACE=d62e77-dev OC_SERVER=https://api.gold.devops.gov.bc.ca:6443
  export KEYCLOAK_ISSUER_URL=https://dev.loginproxy.gov.bc.ca/auth/realms/standard KEYCLOAK_CLIENT_ID=sdg-1234
}

# expect <name> <haystack> <needle>
expect() {
  if grep -qxF -- "$3" <<< "$2"; then echo "PASS: $1"
  else echo "FAIL: $1: no line '$3' in:"; echo "    ${2//$'\n'/$'\n'    }"; FAILED=1; fi
}

# rejects <name> <var> <value>: the script must exit non-zero and name the variable
rejects() {
  local out
  base_env
  export "$2=$3"
  if out="$("$SCRIPT" values 2>&1)"; then echo "FAIL: $1: accepted $2='$3'"; FAILED=1
  elif grep -q "$2" <<< "$out"; then echo "PASS: $1"
  else echo "FAIL: $1: error does not name $2: $out"; FAILED=1; fi
}

base_env
values="$("$SCRIPT" values)" || { echo "FAIL: PR values exited non-zero"; FAILED=1; }
expect "registry is lowercased ghcr.io/<repository>" "$values" "    registry: \"ghcr.io/acme/sdg\""
expect "tag is TAG" "$values" "    tag: \"0123abc\""
expect "host is <repo>-<target> on the cluster's apps domain" "$values" "  host: \"sdg-12.apps.gold.devops.gov.bc.ca\""
expect "Keycloak issuer passes through" "$values" "    issuerUrl: \"https://dev.loginproxy.gov.bc.ca/auth/realms/standard\""
expect "Keycloak client id passes through" "$values" "    clientId: \"sdg-1234\""
expect "Vault auth path follows the cluster" "$values" "    authPath: \"auth/k8s-gold\""
expect "PR Vault role is <plate>-nonprod" "$values" "    role: \"d62e77-nonprod\""
expect "Vault service account is <plate>-vault" "$values" "    serviceAccountName: \"d62e77-vault\""
expect "PR Vault secret path defaults to <role>/portal-api" "$values" "    secretPath: \"d62e77-nonprod/portal-api\""

outputs="$("$SCRIPT" outputs)" || { echo "FAIL: PR outputs exited non-zero"; FAILED=1; }
expect "PR release is <repo>-<pr>" "$outputs" "release=sdg-12"
expect "PR url is https://<host>" "$outputs" "url=https://sdg-12.apps.gold.devops.gov.bc.ca"
expect "PR values file is values-pr.yaml" "$outputs" "values_file=charts/sdg/values-pr.yaml"

base_env
export TARGET=test ENVIRONMENT=test OC_NAMESPACE=d62e77-test
values="$("$SCRIPT" values)"; outputs="$("$SCRIPT" outputs)"
expect "test Vault role is <plate>-nonprod" "$values" "    role: \"d62e77-nonprod\""
expect "test release is <repo>-test" "$outputs" "release=sdg-test"
expect "test values file is values-test.yaml" "$outputs" "values_file=charts/sdg/values-test.yaml"

base_env
export TARGET=prod ENVIRONMENT=prod OC_NAMESPACE=d62e77-prod OC_SERVER=https://api.silver.devops.gov.bc.ca:6443
values="$("$SCRIPT" values)"; outputs="$("$SCRIPT" outputs)"
expect "prod Vault role is <plate>-prod" "$values" "    role: \"d62e77-prod\""
expect "prod Vault secret path is <plate>-prod/portal-api" "$values" "    secretPath: \"d62e77-prod/portal-api\""
expect "Silver server gives the Silver auth path" "$values" "    authPath: \"auth/k8s-silver\""
expect "prod url is on the Silver apps domain" "$outputs" "url=https://sdg-prod.apps.silver.devops.gov.bc.ca"
expect "prod values file is values-prod.yaml" "$outputs" "values_file=charts/sdg/values-prod.yaml"

base_env
export VAULT_SECRET_PATH=d62e77-nonprod/sdg/portal-api
expect "VAULT_SECRET_PATH overrides the default" "$("$SCRIPT" values)" "    secretPath: \"d62e77-nonprod/sdg/portal-api\""

base_env
unset TAG KEYCLOAK_ISSUER_URL KEYCLOAK_CLIENT_ID OC_NAMESPACE
expect "outputs need no image, Keycloak or namespace settings" "$("$SCRIPT" outputs 2>&1)" "url=https://sdg-12.apps.gold.devops.gov.bc.ca"

rejects "missing Keycloak issuer" KEYCLOAK_ISSUER_URL ''
rejects "non-https Keycloak issuer" KEYCLOAK_ISSUER_URL 'http://keycloak.example.com'
rejects "quote in Keycloak issuer" KEYCLOAK_ISSUER_URL 'https://x.example.com/"a'
rejects "missing Keycloak client id" KEYCLOAK_CLIENT_ID ''
rejects "target that is not a PR number, test or prod" TARGET 'feature/x'
rejects "unknown environment" ENVIRONMENT 'staging'
rejects "namespace without a plate suffix" OC_NAMESPACE 'default'
rejects "server not shaped like https://api.<cluster>.<domain>:6443" OC_SERVER 'https://openshift.example.com'
rejects "tag with YAML metacharacters" TAG 'x: y'
rejects "Vault path with a quote" VAULT_SECRET_PATH "a'b"

if "$SCRIPT" bogus >/dev/null 2>&1; then echo "FAIL: unknown command accepted"; FAILED=1
else echo "PASS: unknown command rejected"; fi

exit "$FAILED"
