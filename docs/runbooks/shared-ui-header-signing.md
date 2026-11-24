# Shared UI header signing

Operator runbook for the signed header manifest: first-time setup, rollback, withdrawing a release, re-signing by hand,
monitoring and key rotation. Background: [`packages/shared-ui/README.md`](../../packages/shared-ui/README.md) (Trust)
and [DEVELOPER.md](../../DEVELOPER.md#header-signing-keys).

Embedding sites load an SRI-pinned loader (`/shared-ui/header/v1/loader.js`). The loader fetches
`/shared-ui/header/v1/manifest.json`, accepts it only when it is signed by one of its keyset's two keys, unexpired and
not below the floor, then loads the bundle the manifest names with the manifest's hash as its `integrity`. CI signs
every manifest:

| Signer                                     | Keyset | Key from                                  | Floor from          |
| ------------------------------------------ | ------ | ----------------------------------------- | ------------------- |
| `pr-open.yml` deploys                      | `pr`   | repository secret `HEADER_SIGNING_KEY_PR` | always `0`          |
| `merge.yml` deploys, Header Re-sign (TEST) | `test` | `test` environment                        | `HEADER_FLOOR_TEST` |
| `release.yml` deploys and rollbacks        | `prod` | `prod` environment (reviewers)            | `HEADER_FLOOR_PROD` |
| Header Re-sign (PROD)                      | `prod` | `prod-resign` environment (no reviewers)  | `HEADER_FLOOR_PROD` |

A manifest expires 90 days after it is signed. The Header Re-sign workflow (`header-resign.yml`) re-signs TEST and PROD
daily from CI's own record of the current release (the newest `header-manifest-<env>` artifact), never from what the
edge serves.

Everything below that changes a setting is done by a person with admin rights on the repository. Automated agents only
edit the setup scripts and run them without `--apply`.

## Rules

- **Never run `helm rollback` by hand.** A Helm rollback restores the old release's chart values, including its old
  manifest, which may be expired or carry a lower floor. Roll back with `release.yml` (below). The deploy workflow's
  own automatic Helm rollbacks (a stuck `pending-*` release, `--rollback-on-failure`) re-sign the restored release from
  the previous signing record before the job ends, so they need nothing from you.
- **Never store a `test` or `prod` private key as a repository secret.** Pull request workflows can read repository
  secrets. `scripts/setup-environments.sh` reports a repository-level `HEADER_SIGNING_KEY`.
- **Backup private keys never go into GitHub or the cluster.** They are used only to rotate.
- **Raise a floor only to withdraw a release**, and never above the sequence of the release currently deployed: the
  signer refuses that (KTD8), so the next deploy and re-sign would fail.

## First-time setup

Order matters: the deployment-ref rules, the `prod-resign` environment and the `main` ruleset must be in place before
any `test` or `prod` private key is stored, so no pull request or unreviewed branch can ever reach one.

1. **Preview** with your own `gh` and `oc` logins (nothing changes):

   ```bash
   scripts/setup.sh --plate abc123
   ```

   Expect, among the other lines:
   - `ruleset: would change (change pull_request)` (approval of the last push, stale approvals dismissed)
   - `abc123-prod serviceaccount/header-resign`, `role/header-resign`, `rolebinding/header-resign` and
     `secret/header-resign-token`: `would change (create)`
   - `environment prod-resign: would change (create)` and the `deployment refs` lines for `test` (branch `main`),
     `prod` (branch `main`, tag `v*`) and `prod-resign` (branch `main`)
   - `OC_NAMESPACE variable for prod-resign`, `OC_TOKEN_HEADER for prod-resign`, `HEADER_FLOOR_TEST` and
     `HEADER_FLOOR_PROD` (`unset -> 0`)
   - the signing keys and key ids as `missing` (stored in step 5)

2. **Apply the policies first**:

   ```bash
   scripts/setup-github.sh --apply
   scripts/setup-openshift.sh --plate abc123 --apply
   scripts/setup-environments.sh --plate abc123 --apply   # exits 1 while keys are missing; that's expected here
   ```

   Re-run `scripts/setup-environments.sh` without `--apply` and confirm every `deployment refs` line and the
   `prod-resign` lines say `ok`, and that `scripts/setup-github.sh` says `ruleset: ok`. Only the signing keys may still be
   missing. Don't go on until they do.

3. **Generate the keysets** on a trusted workstation, writing private keys outside the repository (the script refuses a
   directory inside it and never prints a private key):

   ```bash
   for keyset in pr test prod; do
     pnpm --filter @repo/shared-ui generate-keys "$keyset" --out ~/sdg-header-keys/"$keyset"
   done
   pnpm --filter @repo/shared-ui build:loaders
   ```

   Each keyset gets `<keyset>-primary-<date>` and `<keyset>-backup-<date>`: the public keys in
   `packages/shared-ui/keys/<keyset>.json`, the private JWKs as `<key id>.private.jwk.json` (mode 0600) in the `--out`
   directory. `build:loaders` regenerates `packages/shared-ui/loaders/<keyset>/loader.js` and `loaders.lock.json`.

4. **Commit** `packages/shared-ui/keys/*.json` (never a `*.private.jwk.json`), `packages/shared-ui/loaders/` and
   `packages/shared-ui/loaders.lock.json`, and put each keyset's `integrity` from `loaders.lock.json` in the loader table
   of `packages/shared-ui/README.md`. Open a pull request; don't let it deploy before step 5 stores the `pr` key.

5. **Store the primary keys** (secret values go on stdin, never on the command line):

   ```bash
   gh secret set HEADER_SIGNING_KEY_PR < ~/sdg-header-keys/pr/pr-primary-<date>.private.jwk.json
   gh variable set HEADER_SIGNING_KEY_ID_PR --body pr-primary-<date>
   gh secret set HEADER_SIGNING_KEY --env test < ~/sdg-header-keys/test/test-primary-<date>.private.jwk.json
   gh variable set HEADER_SIGNING_KEY_ID --env test --body test-primary-<date>
   for env in prod prod-resign; do
     gh secret set HEADER_SIGNING_KEY --env "$env" < ~/sdg-header-keys/prod/prod-primary-<date>.private.jwk.json
     gh variable set HEADER_SIGNING_KEY_ID --env "$env" --body prod-primary-<date>
   done
   ```

6. **Floors**: step 2 set `HEADER_FLOOR_TEST` and `HEADER_FLOOR_PROD` to `0`. Leave them there.

7. **Optional**: set `TEST_URL` and `PROD_URL` (repository variables, the portal URLs; `scripts/setup-environments.sh`
   prints the commands). The Tests workflow then fails when a live manifest has 30 days or less left.

8. **Custody**: move each `*-backup-*.private.jwk.json` to offline storage or a second custodian, then delete the whole
   `~/sdg-header-keys` working directory.

9. **Check**: `scripts/setup-environments.sh` ends with `All set: nothing to change.` After the pull request merges and
   TEST deploys, run `gh workflow run header-resign.yml` and confirm the TEST job succeeds. Set up the uptime check
   (below).

## Rolling back PROD

Dispatch the release workflow on an earlier release's tag:

```bash
gh workflow run release.yml --ref v1.4.2
```

It runs in the `prod` environment (reviewers approve it as for a release), redeploys that release's images and signs
the target build with a new expiry and the current `HEADER_FLOOR_PROD`, never the manifest built with that release.
Visitors get it on their next page load. Limits:

- The signer refuses a target whose build sequence is below `HEADER_FLOOR_PROD`: withdrawn code can't come back.
- Releases cut before the signed header (their `shared-ui` image has no `/release/release.json`) can't be rolled back
  to.
- A rollback withdraws nothing: anyone replaying the newer release's manifest still gets it until it expires. To take a
  release out of circulation, withdraw it.

TEST has no rollback workflow: merge a revert.

## Withdrawing a release

Use this after a security fix, when visitors must no longer run a release. Withdrawing is a roll-forward: the floor can
only rise to a release that is deployed, so the good code has to come back as a newer build.

1. **Roll forward.** Merge a pull request that reverts or fixes the bad change. The merge builds new images, so the new
   build's sequence (its build time in milliseconds) is above the bad one's. Re-tagging an older commit does not work:
   its build keeps its old, lower sequence. For PROD, publish a release (`v*` tag) from that merge and let it deploy.
2. **Read the new build's sequence** from what is now live, verified against the keyset:

   ```bash
   curl -fsS https://<prod portal host>/shared-ui/header/v1/manifest.json -o manifest.json
   scripts/header-manifest.sh verify prod manifest.json | jq '{version, sequence, floor}'
   ```

   The deploy's Sign step log prints the same `version`, `sequence` and `floor`, and the run's
   `header-manifest-prod` artifact holds the signed record. The `version` must be the roll-forward release.

3. **Raise the floor** to exactly that sequence:

   ```bash
   gh variable set HEADER_FLOOR_PROD --body <sequence>   # HEADER_FLOOR_TEST for TEST
   ```

4. **Re-sign** so the live manifest carries the new floor: `gh workflow run header-resign.yml`, then check that its
   `Re-sign (prod)` job passed and that step 2's command now shows the new `floor`.

From then on every signer refuses builds below the floor, and each visitor's browser remembers the new floor on each
site after its next page load. Visitors with no remembered floor (first visits, private browsing, cleared storage) can
still be served the withdrawn release's old manifest by a compromised host until that manifest expires, up to 90 days
after it was last signed.

## Re-signing by hand

```bash
gh workflow run header-resign.yml
gh run watch "$(gh run list --workflow header-resign.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
```

It re-signs both TEST and PROD and waits up to 3 minutes for the edge to serve each new signature.

- **Skipped because a deploy was active**: the `Merge group idle?` job skips the re-sign with a notice while a Merge,
  Release or Route TLS run is running or queued (including one waiting for approval). Nothing is lost: that deploy signs
  its own manifest, and the next daily run re-signs. Dispatch it again later if you need it sooner.
- **Failed**: the workflow opens an issue for CODEOWNERS. Common causes: a missing or wrong `HEADER_SIGNING_KEY` /
  `HEADER_SIGNING_KEY_ID`; a floor above the current release (lower it back, or roll forward first); the live
  manifest's sequence differs from CI's record (someone changed the release outside the workflows, for example a manual
  `helm rollback`: redeploy through the workflows); or an expired `OC_TOKEN_HEADER` (below).
- **No record found**: the re-signer needs the newest `header-manifest-<env>` artifact, which expires with the
  repository's artifact retention. If re-signing has been broken for longer than that, redeploy to recreate it: for
  PROD, `gh workflow run release.yml --ref <current release tag>`; for TEST, merge a pull request.
- There's no hurry while the live manifest has more than 30 days left. Check it with step 2 of _Withdrawing a release_
  and `jq '.expires / 1000 | todate'`.

## Watching PROD from outside GitHub Actions

The re-signer and the Tests expiry check both run in GitHub Actions, so an Actions outage, a disabled workflow or a
scheduled workflow paused by GitHub after a long quiet period would stop both at once. Add an uptime check outside
GitHub, for example in the team's existing uptime monitor:

- URL: `https://<prod portal host>/shared-ui/header/v1/manifest.json`, every 5 to 15 minutes
- Alert when it doesn't answer `200` with a JSON body, so the header is never silently missing
- If the monitor can run a script, also alert when the manifest's `expires` is less than 30 days away
  (`scripts/header-manifest.sh verify prod manifest.json` prints it, in milliseconds)

## Rotating the re-signer's OpenShift token

`OC_TOKEN_HEADER` is the long-lived token of the `header-resign` service account in `<plate>-prod`, which can only get
and patch the ConfigMap `<repo>-prod-shared-ui-manifest`. To replace it:

```bash
oc delete secret header-resign-token -n <plate>-prod
gh secret delete OC_TOKEN_HEADER --env prod-resign
scripts/setup-openshift.sh --plate <plate> --apply
scripts/setup-environments.sh --plate <plate> --apply
```

## Key rotation and compromise

Each loader trusts exactly the two public keys built into it (primary and backup) for the life of the major, and
embedding sites pin the loader's bytes with `integrity`. So:

- **Lost primary, not leaked** (the secret was deleted, or its only copy is gone): switch to the backup. No loader
  change and nothing for embedding sites to do.

  ```bash
  gh secret set HEADER_SIGNING_KEY --env prod < <backup>.private.jwk.json        # and --env prod-resign for prod
  gh variable set HEADER_SIGNING_KEY_ID --env prod --body prod-backup-<date>      # same environments
  gh workflow run header-resign.yml
  ```

  The keyset now has no spare, so plan a new keyset (below) soon.

- **A compromised key, primary or backup, or both keys lost**: the old loader keeps trusting a leaked key, so recovery
  needs a new keyset and a new loader, and every embedding site must change its loader tag. It is a breaking change:
  1. Generate the keyset again (`generate-keys <keyset> --out ...`), run `build:loaders`, update the README's integrity
     values and plan the release as a breaking change (`packages/shared-ui/README.md`, Versions).
  2. Store the new primary as in setup step 5 (both `prod` and `prod-resign` for PROD) and move the new backup to
     offline custody.
  3. Release it, then tell every embedding site the new `integrity` value. Until a site changes its tag, its visitors'
     browsers either refuse the new loader (no header) or, if a compromised host keeps serving the old loader, accept
     manifests signed with the leaked key.
  4. Replace the leaked secret everywhere it was stored, and look for runs that used it unexpectedly
     (`gh run list --workflow ...`, the environment's deployment history).

- **The `pr` keyset** is trusted only by PR preview loaders; rotate it the same way, with no embedding sites to notify
  beyond your own test sites.
