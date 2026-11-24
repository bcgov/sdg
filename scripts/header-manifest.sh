#!/usr/bin/env bash
# Header manifest helpers for the deploy, test and re-signing workflows (U6; KTD7, KTD10). Needs Node (type stripping)
# but no `pnpm install`: the verifier and keyset reader import only Node built-ins and each other.
#
#   verify <keyset> <manifest.json>  verify the envelope with packages/shared-ui/keys/<keyset>.json as the loader would
#                                    (signature, keyset, bundle path, expiry, the manifest's own floor) and print the
#                                    payload as JSON; exit 1 naming the reason when it is refused
#   record test|prod <dir>           download CI's newest signing record for that environment (the artifact
#                                    header-manifest-<env> that a deploy or re-sign uploaded) to <dir>/manifest.json.
#                                    Only artifacts from the workflows that sign with that environment's key count; the
#                                    caller still verifies the record (sign-manifest.ts resign does), since an artifact
#                                    name alone proves nothing. Needs GH_TOKEN (actions: read) and GITHUB_REPOSITORY.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

verify() {
  local keyset="$1" file="$2"
  shift 2
  node "${root}/packages/shared-ui/scripts/sign-manifest.ts" verify --keyset "$keyset" --manifest "$file" "$@"
}

record() {
  local target="$1" dir="$2" workflows name runs id run
  case "$target" in
    test) workflows='merge.yml header-resign.yml' ;;
    prod) workflows='release.yml header-resign.yml' ;;
    *) echo "record: environment must be test or prod, got '${target}'" >&2; exit 1 ;;
  esac
  name="header-manifest-${target}"
  # Newest first. An expired artifact can no longer be downloaded, so the chain of daily re-signs must not break for
  # longer than the artifact retention.
  runs="$(gh api "repos/${GITHUB_REPOSITORY}/actions/artifacts?name=${name}&per_page=50" \
    --jq '.artifacts | map(select(.expired | not)) | sort_by(.created_at) | reverse | .[].workflow_run.id')"
  for id in $runs; do
    # .path is the run's workflow file (e.g. .github/workflows/merge.yml); a pull_request run never signs test or prod
    run="$(gh api "repos/${GITHUB_REPOSITORY}/actions/runs/${id}" --jq '"\(.path | sub("@.*$"; "")) \(.event)"')"
    read -r path event <<< "$run"
    if [ "$event" != pull_request ] && [[ " ${workflows} " == *" ${path#.github/workflows/} "* ]]; then
      mkdir -p "$dir"
      gh run download "$id" -R "$GITHUB_REPOSITORY" -n "$name" -D "$dir"
      [ -s "${dir}/manifest.json" ] || { echo "Artifact ${name} of run ${id} has no manifest.json" >&2; exit 1; }
      echo "Record: ${name} from run ${id} (${path}, ${event})" >&2
      return 0
    fi
    echo "Skipping ${name} from run ${id} (${path}, ${event}): not a ${target} signing workflow" >&2
  done
  echo "No ${name} record from ${workflows// /, } found; a deploy to ${target} must run first" >&2
  exit 1
}

case "${1:-}" in
  verify)
    if [ $# -eq 3 ]; then verify "$2" "$3"
    elif [ $# -eq 4 ] && [ "$4" = --accept-expired ]; then verify "$2" "$3" --accept-expired
    else echo "Usage: $0 verify <keyset> <manifest.json> [--accept-expired]" >&2; exit 1; fi ;;
  record) [ $# -eq 3 ] || { echo "Usage: $0 record test|prod <dir>" >&2; exit 1; }; record "$2" "$3" ;;
  *) echo "Usage: $0 verify <keyset> <manifest.json> [--accept-expired] | record test|prod <dir>" >&2; exit 1 ;;
esac
