# shellcheck shell=bash
# Sourced by setup-environments.sh, not run on its own: the shared-ui header signing setup (R6; KTD8, KTD9;
# docs/runbooks/shared-ui-header-signing.md).  Uses that script's REPO, PLATE, SERVER, APPLY and MISSING and its
# status, get_var, has_secret and secret functions.

# Exactly these refs may deploy to each environment, and so reach its signing key; any other rule is removed.
# prod keeps main for route-tls.yml and observability.yml (both dispatched from main, behind prod's reviewers).
wanted_refs() { # <env>
  case "$1" in
    prod) echo '[{"type": "branch", "name": "main"}, {"type": "tag", "name": "v*"}]' ;;
    *) echo '[{"type": "branch", "name": "main"}]' ;;
  esac
}

# restrict_refs <env> <environment JSON>: "Selected branches and tags", keeping reviewers and wait timer
restrict_refs() {
  jq -c '{deployment_branch_policy: {protected_branches: false, custom_branch_policies: true},
    reviewers: ([.protection_rules[]? | select(.type == "required_reviewers") | .reviewers[]
      | {type, id: .reviewer.id}] | if length > 0 then . else null end),
    wait_timer: ([.protection_rules[]? | select(.type == "wait_timer") | .wait_timer][0] // 0)}' <<< "$2" \
    | gh api -X PUT "repos/${REPO}/environments/$1" --input - >/dev/null
}

# env_refs <env>: compare and, with --apply, set the environment's deployment branch and tag rules
env_refs() {
  local env="$1" want label current custom have='[]' add remove
  want="$(wanted_refs "$env")"
  label="$(jq -r 'map("\(.type) \(.name)") | join(", ")' <<< "$want")"
  if ! current="$(gh api "repos/${REPO}/environments/${env}" 2>/dev/null)"; then
    status "environment ${env} deployment refs" change "${label} only"
    return
  fi
  custom="$(jq -r '.deployment_branch_policy.custom_branch_policies // false' <<< "$current")"
  [ "$custom" != true ] || have="$(gh api "repos/${REPO}/environments/${env}/deployment-branch-policies" \
    --jq '[.branch_policies[] | {id, type, name}]')"
  add="$(jq -c --argjson h "$have" '[.[] | select(. as $w | any($h[]; {type, name} == $w) | not)]' <<< "$want")"
  remove="$(jq -c --argjson w "$want" '[.[] | select({type, name} as $p | any($w[]; . == $p) | not)]' <<< "$have")"
  if [ "$custom" = true ] && [ "$add" = '[]' ] && [ "$remove" = '[]' ]; then
    status "environment ${env} deployment refs" ok "$label"
    return
  fi
  status "environment ${env} deployment refs" change "$(jq -rn --argjson a "$add" --argjson r "$remove" --arg c "$custom" \
    '[(if $c == "true" then empty else "restrict to selected refs" end), ($a[] | "add \(.type) \(.name)"),
      ($r[] | "remove \(.type) \(.name)")] | join(", ")')"
  [ "$APPLY" = true ] || return 0
  [ "$custom" = true ] || restrict_refs "$env" "$current"
  jq -c '.[]' <<< "$add" | while read -r rule; do
    gh api -X POST "repos/${REPO}/environments/${env}/deployment-branch-policies" --input - <<< "$rule" >/dev/null
  done
  jq -r '.[].id' <<< "$remove" | while read -r id; do
    gh api -X DELETE "repos/${REPO}/environments/${env}/deployment-branch-policies/${id}" >/dev/null
  done
}

deployment_refs() {
  local env
  for env in test prod prod-resign; do env_refs "$env"; done
}

# fix <message>: something only a person can put right; counted, so the run exits non-zero
fix() { MISSING=$((MISSING + 1)); echo "  $1"; }

# prod-resign (KTD9): the PROD namespace, and a token that can only get and patch the manifest ConfigMap
prod_resign() {
  local have
  have="$(get_var prod-resign OC_NAMESPACE)"
  if [ "$have" = "${PLATE}-prod" ]; then
    status "OC_NAMESPACE variable for prod-resign" ok "${PLATE}-prod"
  else
    status "OC_NAMESPACE variable for prod-resign" change "${have:-unset} -> ${PLATE}-prod"
    [ "$APPLY" = false ] || gh variable set OC_NAMESPACE -R "$REPO" --env prod-resign --body "${PLATE}-prod" >/dev/null
  fi
  secret prod-resign OC_TOKEN_HEADER "${PLATE}-prod" header-resign-token
  if has_secret prod-resign OC_TOKEN; then
    fix "OC_TOKEN secret for prod-resign: found; it can do far more than OC_TOKEN_HEADER, delete it: gh secret delete OC_TOKEN -R ${REPO} --env prod-resign"
  fi
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The keyset's committed primary key id (packages/shared-ui/keys/<keyset>.json), or a placeholder before keys exist
primary_id() { # <keyset>
  jq -r '.keys | keys[] | select(test("-primary-"))' "${ROOT}/packages/shared-ui/keys/$1.json" 2>/dev/null \
    | head -n1 | grep . || echo "<$1-primary-id>"
}

# signing <scope> <keyset> <secret name> <variable name>: checks only; keys are generated offline and stored by a person
signing() {
  local scope="$1" keyset="$2" env=""
  [ "$scope" = repo ] || env=" --env ${scope}"
  if has_secret "$scope" "$3"; then
    echo "  $3 secret for ${scope}: ok (already set)"
  else
    fix "$3 secret for ${scope}: missing; gh secret set $3 -R ${REPO}${env} < <offline dir>/$(primary_id "$keyset").private.jwk.json"
  fi
  if [ -n "$(get_var "$scope" "$4")" ]; then
    echo "  $4 variable for ${scope}: ok"
  else
    fix "$4 variable for ${scope}: missing; gh variable set $4 -R ${REPO}${env} --body $(primary_id "$keyset")"
  fi
}

header_signing() {
  local name have target url
  signing repo pr HEADER_SIGNING_KEY_PR HEADER_SIGNING_KEY_ID_PR
  signing test test HEADER_SIGNING_KEY HEADER_SIGNING_KEY_ID
  signing prod prod HEADER_SIGNING_KEY HEADER_SIGNING_KEY_ID
  signing prod-resign prod HEADER_SIGNING_KEY HEADER_SIGNING_KEY_ID
  # A repository secret reaches pull request workflows, which must never hold a TEST- or PROD-trusted key (R6)
  if has_secret repo HEADER_SIGNING_KEY; then
    fix "HEADER_SIGNING_KEY secret for repo: found; pull requests can read it, delete it: gh secret delete HEADER_SIGNING_KEY -R ${REPO}"
  fi
  # Floors (KTD8) start at 0 and are never changed here: a person raises one only to withdraw a release
  for name in HEADER_FLOOR_TEST HEADER_FLOOR_PROD; do
    have="$(get_var repo "$name")"
    if [ -n "$have" ]; then
      status "${name} variable for repo" ok "$have"
    else
      status "${name} variable for repo" change "unset -> 0"
      [ "$APPLY" = false ] || gh variable set "$name" -R "$REPO" --body 0 >/dev/null
    fi
  done
  # Optional: the Tests workflow checks the live manifests' expiry only when these are set
  for target in test prod; do
    name="$(tr '[:lower:]' '[:upper:]' <<< "$target")_URL"
    if [ -n "$(get_var repo "$name")" ]; then echo "  ${name} variable for repo: ok"; continue; fi
    url="$(TARGET="$target" ENVIRONMENT="$target" REPOSITORY="$REPO" OC_SERVER="$SERVER" \
      "${ROOT}/scripts/deploy-values.sh" outputs | sed -n 's/^url=//p')"
    echo "  ${name} variable for repo: not set (optional; the live manifest expiry check skips ${target}): gh variable set ${name} -R ${REPO} --body ${url}"
  done
}
