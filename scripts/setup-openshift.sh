#!/usr/bin/env bash
# Create the GitHub Actions deploy account in each OpenShift namespace:
# service account `github-actions`, `edit` role binding and a long-lived
# token Secret (`github-actions-token`), which setup-environments.sh reads.
# With --observability (ADR 0001), also the same deploy account in <plate>-tools,
# where the non-prod stack runs, and the read-only pod discovery its Alloy needs:
# Role and RoleBinding `observability-discovery` in dev, test and prod, bound to
# <plate>-tools' Alloy for dev and test and to <plate>-prod's own Alloy for prod.
#
# Uses your own `oc login`.  Without --apply it checks the setup and exits
# non-zero if anything is missing; --apply makes the changes.  Without --plate,
# the plate comes from the repo's OC_NAMESPACE variable.  Safe to re-run:
# existing objects are left alone.
#
# Usage: scripts/setup-openshift.sh [--plate abc123] [--observability] [--apply]
#   --plate          licence plate; namespaces are <plate>-dev, <plate>-test, <plate>-prod
#   --observability  also <plate>-tools and pod discovery for charts/observability
set -euo pipefail

APPLY=false
OBSERVABILITY=false
PLATE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=true ;;
    --plate) PLATE="${2:-}"; shift ;;
    --observability) OBSERVABILITY=true ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done
# No --plate: use the plate from this repo's OC_NAMESPACE variable (see setup-environments.sh)
if [ -z "$PLATE" ] && command -v gh >/dev/null; then
  PLATE="$(gh variable get OC_NAMESPACE 2>/dev/null || true)"
  PLATE="${PLATE%-dev}"
  [ -z "$PLATE" ] || echo "Licence plate: ${PLATE} (from the OC_NAMESPACE variable)"
fi
[ -n "$PLATE" ] || read -rp "Licence plate (e.g. abc123): " PLATE
[[ "$PLATE" =~ ^[a-z0-9]+$ ]] || { echo "Invalid licence plate: '${PLATE}'" >&2; exit 1; }
NAMESPACES=("${PLATE}-dev" "${PLATE}-test" "${PLATE}-prod")
[ "$OBSERVABILITY" = false ] || NAMESPACES+=("${PLATE}-tools")
SA=github-actions

# Checks first; nothing changes unless every namespace passes
if ! user="$(oc whoami 2>/dev/null)"; then
  echo "Not logged in to OpenShift.  Copy the login command from the console (your name > Copy login command) and run it." >&2
  exit 1
fi
echo "Logged in as ${user} on $(oc whoami --show-server)"
failed=false
for ns in "${NAMESPACES[@]}"; do
  missing=""
  oc get project "$ns" >/dev/null 2>&1 || missing+=" no access to the project;"
  checks=(serviceaccounts rolebindings secrets)
  [ "$OBSERVABILITY" = false ] || [ "$ns" = "${PLATE}-tools" ] || checks+=(roles)
  for what in "${checks[@]}"; do
    [ "$(oc auth can-i create "$what" -n "$ns" 2>/dev/null)" = yes ] || missing+=" can't create ${what};"
  done
  if [ -n "$missing" ]; then
    echo "  ${ns}:${missing%;}" >&2
    failed=true
  else
    echo "  ${ns}: access ok"
  fi
done
if [ "$failed" = true ]; then
  echo "Stopped before any change.  Namespaces come from Platform Services (https://registry.developer.gov.bc.ca); ask your product owner for access." >&2
  exit 1
fi

CHANGES=0
# status <item> <ok|change> [details]; counts each change
status() {
  if [ "$2" = ok ]; then echo "  $1: ok${3:+ ($3)}"; return; fi
  CHANGES=$((CHANGES + 1))
  if [ "$APPLY" = true ]; then echo "  $1: changed${3:+ ($3)}"
  else echo "  $1: would change${3:+ ($3)}"; fi
}
# Verdict; a preview exits 1 when anything needs changing, so it works as a check
summary() {
  if [ "$APPLY" = true ]; then echo "Done: ${CHANGES} changed."
  elif [ "$CHANGES" -eq 0 ]; then echo "All set: nothing to change."
  else echo "${CHANGES} to change; re-run with --apply to make these changes."; exit 1; fi
}

# report <namespace> <object> <exists: true|false> <command...>
report() {
  local ns="$1" obj="$2" exists="$3"; shift 3
  if [ "$exists" = true ]; then
    status "${ns} ${obj}" ok
  else
    [ "$APPLY" = false ] || "$@" >/dev/null
    status "${ns} ${obj}" change create
  fi
}

exists() { oc get "$@" >/dev/null 2>&1 && echo true || echo false; }

# Observability: Alloy in <plate>-tools collects from dev and test; prod has its own stack.
DISCOVERY=observability-discovery
stack_namespace() { [[ "$1" == *-prod ]] && echo "$1" || echo "${PLATE}-tools"; }

token_secret() {
  oc apply -n "$1" -f - <<YAML
apiVersion: v1
kind: Secret
metadata:
  name: ${SA}-token
  annotations:
    kubernetes.io/service-account.name: ${SA}
type: kubernetes.io/service-account-token
YAML
}

for ns in "${NAMESPACES[@]}"; do
  report "$ns" "serviceaccount/${SA}" "$(exists sa "$SA" -n "$ns")" oc create sa "$SA" -n "$ns"
  report "$ns" "rolebinding/${SA}-edit" "$(exists rolebinding "${SA}-edit" -n "$ns")" \
    oc create rolebinding "${SA}-edit" --clusterrole=edit --serviceaccount="${ns}:${SA}" -n "$ns"
  report "$ns" "secret/${SA}-token" "$(exists secret "${SA}-token" -n "$ns")" token_secret "$ns"
  if [ "$OBSERVABILITY" = true ] && [ "$ns" != "${PLATE}-tools" ]; then
    report "$ns" "role/${DISCOVERY}" "$(exists role "$DISCOVERY" -n "$ns")" \
      oc create role "$DISCOVERY" --verb=get,list,watch --resource=pods -n "$ns"
    report "$ns" "rolebinding/${DISCOVERY}" "$(exists rolebinding "$DISCOVERY" -n "$ns")" \
      oc create rolebinding "$DISCOVERY" --role="$DISCOVERY" --serviceaccount="$(stack_namespace "$ns"):observability-alloy" -n "$ns"
  fi
done
summary
