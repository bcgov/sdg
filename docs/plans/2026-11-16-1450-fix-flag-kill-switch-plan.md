---
title: Feature Flag Kill Switch - Plan
type: fix
date: 2026-11-16
topic: feature-flags
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Feature Flag Kill Switch - Plan

## Goal Capsule

- **Objective:** When a console admin turns a feature flag off, nobody gets that feature, so admins can use the switch to keep people away from a feature whose backing service isn't running.
- **Means:** core-api's one evaluation function checks the switch before a person's override (KTD1). The console's explanations, confirmation and notices follow the new order.
- **Product authority:** This plan's Product Contract. It amends `docs/plans/2026-11-13-1522-feat-feature-flags-plan.md` where that plan describes override precedence (U3).
- **Stop conditions:** Stop and ask if any code path other than `isEnabled` can give a signed-in person a flag that is off, or if the change turns out to need a migration, an API response change, or a chart or workflow change.
- **Execution profile:** U1, then U2, then U3. Each unit leaves `pnpm typecheck`, `pnpm lint` and its package's tests green.
- **Finishing:** One PR to `main`. The rollout step under Risks happens around the merge and is done by a person with console access, not by the implementer.
- **Open blockers:** None.

## Product Contract

### Summary

Make a flag's on/off switch a kill switch. When a flag is off it is off for everyone, overrides included. While it is on, an override decides for its person ahead of the rollout percentage. Overrides are kept while a flag is off and apply again when it's turned back on. The console explains the new order everywhere it currently explains the old one.

### Problem Frame

Today an override beats the switch, as the original plan decided (`docs/plans/2026-11-13-1522-feat-feature-flags-plan.md`, Key Decisions). Turning a flag off hides it from everyone except people with an "on" override. A flag's switch may gate something at the infrastructure level, such as a service that is scaled down or not deployed. When that service is off, people with an "on" override still see the feature and can try to use something that isn't running. Admins have no single control that withdraws a feature from everyone. They have to remember to remove each "on" override as well.

### Key Decisions

- **Off is a kill switch.** (session-settled: user-directed — chosen over an override beating the switch: a flag can gate an infrastructure-level feature, and an "on" override would let people use it while it isn't running.) Governs R1, R2.
- **Overrides are kept while a flag is off.** (session-settled: user-approved — chosen over deleting or migrating overrides when a flag is turned off: turning the flag back on restores the same people without re-entering them.) Governs R3.
- **Admins can still add, change and remove overrides on an off flag.** (session-settled: user-approved — chosen over blocking override edits while a flag is off: admins can line up testers before switching a flag on.) Governs R3, R5.
- **This plan amends the original feature-flags plan instead of leaving it to describe the old rule.** (session-settled: user-approved — chosen over writing only this plan: the original plan is where readers look for how flags are evaluated.) Governs R7.

### Requirements

**Evaluation**

- R1. A flag that is off is off for every signed-in person in both apps, whatever their override says.
- R2. While a flag is on, an "on" override gives the person the flag at any rollout percentage, an "off" override withholds it at any rollout percentage, and a person without an override gets it when their stable bucket is under the rollout percentage.
- R3. Turning a flag off keeps its overrides, which apply again unchanged when the flag is turned back on.

**Console**

- R4. The turn-off confirmation says that everyone stops getting the flag. When the flag has "on" overrides, it also says that those people stop getting it too and that their overrides apply again when the flag is turned back on.
- R5. While a flag is off and has overrides, the flag's Overrides tab says that they have no effect until the flag is turned on.
- R6. Every console text that explains how a person gets a flag gives the order as the switch, then an override, then the rollout.

**Documentation**

- R7. The original feature-flags plan states the kill-switch rule and links to this plan.

### Acceptance Examples

- AE1. **Covers R1.** Given `hello_world` is off and resident X has an "on" override, X's flag list doesn't include `hello_world` and X's call to the hello-world endpoint answers 404.
- AE2. **Covers R2.** Given `hello_world` is on at 0% and resident X has an "on" override, X gets `hello_world` and resident Y doesn't.
- AE3. **Covers R2.** Given `hello_world` is on at 100% and resident X has an "off" override, X doesn't get `hello_world` and resident Y does.
- AE4. **Covers R1, R3.** Given resident X has an "on" override and `hello_world` is on at 0%, X gets it. When the flag is turned off, X doesn't get it. When it's turned back on, X gets it again with no override change.

### Scope Boundaries

- Signed-out evaluation is unchanged. It already gives only flags that are on at 100%, so overrides never reach it.
- Audience filtering, override storage, history events and the people search are unchanged.
- No database migration and no change to any API response shape. The PATCH response keeps `overrideCounts`.
- The override counts in the flag header, list column and Overrides tab badge keep counting stored overrides, because the overrides still exist (R3).
- Considered and not built: automatically turning off flags with "on" overrides back on at 0% during the release. That would switch features on without an admin and defeat R1. A person does this by hand where needed (Risks).
- Considered and not built: a confirmation or notice when turning a flag on with "on" overrides. Turning a flag on gives those people the feature, which is the point of the overrides. Admins being surprised by who gets a flag after switching it on would change this call.
- Considered and not built: marking each override row as inactive. The state belongs to the flag, not to individual rows, so R5's single note covers it.

## Planning Contract

### Key Technical Decisions

- KTD1. **`isEnabled` checks the switch first, then the override, then the rollout bucket. A missing flag stays off even with an "on" override.** Every signed-in evaluation, including the hello-world endpoint, goes through `isEnabled` in `FlagEvaluationService.enabledKeys`, so one change covers both apps and both endpoints. Inherits the "off is a kill switch" Key Decision. Governs R1, R2.
- KTD2. **Remove the post-save off notice instead of rewording it.** The notice ("`<key>` is off, but N people still get it", with its "Review the overrides" link) warned that a feature was still reaching people. That can no longer happen. The turn-off confirmation (R4) and the Overrides tab note (R5) cover what remains to say. Governs R4, R5.
- KTD3. **R5's note is one informational inline alert above the overrides table, shown only when the flag is off and has at least one override.** Follow the existing `InlineAlert` use in `flag-detail.tsx`. Governs R5.

## Implementation Units

### U1. Kill-switch evaluation in core-api

- **Goal:** A flag that is off is off for everyone, and overrides decide only while it's on.
- **Requirements:** R1, R2, R3, KTD1. AE1–AE4.
- **Dependencies:** None.
- **Files:**
  - Modify: `apps/core-api/src/feature-flags/is-enabled.ts`
  - Modify: `packages/database/src/schema/feature-flags.ts` (doc comment only)
  - Test: `apps/core-api/src/feature-flags/is-enabled.test.ts`
  - Test: `apps/core-api/src/feature-flags/feature-flags.shared.controller.test.ts`
- **Approach:**
  1. In `isEnabled`, return false for a missing or disabled flag before reading the override, then apply the override, then the bucket (KTD1).
  2. Update `isEnabled`'s comment, if it states the order, and the doc comment on `FlagEvaluationService` (`flag-evaluation.service.ts`) only if it describes override precedence.
  3. Reword the doc comment on `featureFlagOverrides` in the database schema, which says an override applies "whatever the flag's switch and rollout say", to say it decides for its person only while the flag is on.
- **Patterns to follow:** The existing table-driven bucket cases and fixed-bucket ids in `is-enabled.test.ts`. The `helloWorld`, `override`, `seed` and `clearFlagCache` helpers in `feature-flags.shared.controller.test.ts`.
- **Test scenarios:**
  - Replace "Should return an override's value even for a disabled or missing flag" with: a disabled flag with an "on" override returns false, a missing flag with an "on" override returns false, and a disabled flag with an "off" override returns false.
  - An enabled flag at 0% with an "on" override returns true for an id in any bucket.
  - An enabled flag at 100% with an "off" override returns false.
  - The existing bucket cases, the disabled-without-override case and the monotonic case (AE4 of the original plan) still pass unchanged.
  - Covers AE1. Replace the shared-controller test "Should give an off flag to the resident with an 'on' override…" with: `hello_world` off plus X's "on" override gives X an empty flag list and a 404 from hello-world.
  - Covers AE2. `hello_world` on at 0% plus X's "on" override gives X `{ hello_world: true }` and a 200, and gives Y an empty list and a 404.
  - Covers AE3. `hello_world` on at 100% plus X's "off" override gives X an empty list and Y `{ hello_world: true }`.
  - Covers AE4. With X's "on" override and the flag on at 0%, X gets it. After the flag is set off and the cache cleared, X doesn't. After the flag is set back on and the cache cleared, X gets it again.
- **Verification:** core-api's tests pass, and no test still expects an override to give someone a flag that is off.

### U2. Console explains the kill switch

- **Goal:** Admins see the new order wherever the console explains it, get an accurate turn-off confirmation, and see that overrides on an off flag are paused.
- **Requirements:** R4, R5, R6, KTD2, KTD3.
- **Dependencies:** U1, so the console never describes a rule that core-api doesn't apply.
- **Files:**
  - Modify: `apps/console-web/src/components/feature-flags/switch-off-dialog.tsx`
  - Modify: `apps/console-web/src/components/feature-flags/flag-overview.tsx`
  - Modify: `apps/console-web/src/components/feature-flags/flag-fields.tsx`
  - Modify: `apps/console-web/src/components/feature-flags/flag-detail.tsx`
  - Modify: `apps/console-web/src/components/feature-flags/flag-tabs.tsx`
  - Modify: `apps/console-web/src/components/feature-flags/use-detail-actions.ts`
  - Modify: `apps/console-web/src/components/feature-flags/overrides-panel.tsx`
  - Test: `apps/console-web/src/components/feature-flags/flag-detail.test.tsx`
  - Test: `apps/console-web/src/components/feature-flags/overrides-panel.test.tsx`
  - Test: `apps/console-web/e2e/feature-flags.spec.ts`
- **Approach:**
  1. Turn-off confirmation (R4): "Everyone stops getting `<key>`." When the flag has "on" overrides, add a sentence saying that includes the N people with an "on" override and that their overrides apply again when the flag is turned back on.
  2. Switch card note (R6): while on, say that turning it off stops it for everyone, overrides included. While off, say that no one gets it and overrides wait until it's on.
  3. "How a person gets `<key>`" (R6): reorder the list to the switch, then overrides, then the rollout. Reword each item for the new order, and update the component's doc comment that states core-api's order.
  4. Rollout field description in `flag-fields.tsx` (R6): drop "overrides come first" and say that overrides come before the rollout.
  5. Remove `OffNotice`, the `offNotice` state and `dismissOffNotice` from `use-detail-actions.ts` and `flag-detail.tsx` (KTD2). The notice's link is the only reason the page moves focus to the Overrides tab, so also remove `reviewOverrides` and its `focusOverrides` effect from `useFlagTab`, the `overridesRef` passed through `FlagBody` and `FlagTabs`, and `OverridesPanel`'s `sectionRef` prop and the section's `tabIndex={-1}`.
  6. Add the R5 note to `OverridesPanel` (KTD3).
  7. Setting an override confirms "`<key>` is now on for `<person>`." (`useOverrideChanges` in `use-detail-actions.ts`). On an off flag that is false (R1). When the flag is off, say instead that the person's override is saved and applies once `<key>` is turned on. Keep the current text while the flag is on.
- **Patterns to follow:** The `people()` helper in `labels` for counts. `InlineAlert` as `OffNotice` uses it today. The existing "names how many people still get a flag turned off" test in `flag-detail.test.tsx` for driving the switch and dialog.
- **Test scenarios:**
  - Turning off a flag with 3 "on" overrides shows a dialog that names the 3 people and says their overrides apply again when the flag is turned back on.
  - Turning off a flag with no "on" overrides shows only the sentence that everyone stops getting it.
  - After confirming turn-off on a flag with "on" overrides, the updates region says only "Saved `<key>`." and contains no notice or "Review the overrides" link. This replaces the R21 notice tests, including the dismiss and turn-back-on cases.
  - On an enabled flag, the "How a person gets" list reads in order: the switch, then overrides, then the rollout. On a disabled flag, its switch item says no one gets the flag.
  - The Switch card note reads correctly for an on flag and for an off flag.
  - The Overrides tab of an off flag with overrides shows the R5 note. An on flag with overrides doesn't. An off flag with no overrides doesn't.
  - Setting an "on" override on an off flag confirms that it applies once the flag is turned on. Setting one on an on flag keeps "`<key>` is now on for `<person>`."
  - The e2e turn-off journey asserts the new dialog text and that no off notice appears. Drop its navigation through "Review the overrides" and its focus assertion. Opening the Overrides tab shows the R5 note.
- **Verification:** console-web's unit tests and e2e suite pass. A search of `apps/console-web/src` finds no remaining "still get" or "come first" wording about overrides.

### U3. Amend the original feature-flags plan

- **Goal:** The original plan no longer says that an override beats the switch.
- **Requirements:** R7.
- **Dependencies:** U1, U2.
- **Files:**
  - Modify: `docs/plans/2026-11-13-1522-feat-feature-flags-plan.md`
- **Approach:**
  1. Rewrite the Key Decision "An override beats the flag's on/off switch" as the kill-switch rule. Give it the label `(session-settled: user-directed — chosen over an override beating the switch: …)` and link to this plan.
  2. Update R3's order to switch, override, rollout.
  3. Rewrite R21: the console shows each flag's override count, and the turn-off confirmation says that people with "on" overrides lose the flag too.
  4. Update F3's outcome to "whatever the percentage says, while the switch is on".
  5. Rewrite AE5 to "on at 0% plus an 'on' override".
  6. Update the `isEnabled` test bullets in the core-api unit. Drop "for the R21 notice" from KTD8.
  7. In the original plan's console unit, remove the R21 notice from its Goal, from its layout step (the notice in the status region and its focus-moving link), from its R21 test scenario and from its mocked e2e line. Describe the turn-off confirmation and the Overrides tab note instead (this plan's R4 and R5).
  8. Add the change to the Product Contract preservation line, naming this plan.
- **Test expectation:** none, documentation only.
- **Verification:** Nothing in the original plan says or implies that an override gives someone a flag that is off, and nothing describes the removed off notice.

## Risks

- **People lose a feature when this is deployed.** Anyone who gets an off flag through an "on" override today loses it once this ships. Before merging, someone with console access checks each environment's flag list (DEV, TEST, PROD) for off flags with "on" overrides. Where those people should keep the feature, they turn the flag on at 0%. They do this from Edit settings, setting the rollout to 0% and the switch on in one save. The overview switch alone would turn the flag on at its stored rollout and briefly release it to that share of everyone. Doing this before deploying is safe, because a flag on at 0% reaches exactly the people with "on" overrides under both the old and the new rule.
- **Cache lag after a switch change.** core-api caches flags for up to 30 seconds per pod (original plan KTD10). The console clears the cache on every edit, so a kill-switch change made in the console takes effect at once on core-api's single replica. A change made directly in the database can lag by up to the cache lifetime.

## Verification Contract

| Check                  | Command                              | Proves              |
| ---------------------- | ------------------------------------ | ------------------- |
| core-api tests         | `pnpm --filter core-api test`        | U1, AE1–AE4         |
| console-web unit tests | `pnpm --filter console-web test`     | U2                  |
| console-web e2e        | `pnpm --filter console-web test:e2e` | U2 turn-off journey |
| Types                  | `pnpm typecheck`                     | All units           |
| Lint and format        | `pnpm lint`, `pnpm format:check`     | All units           |

## Definition of Done

- Every scenario in U1 and U2 has a passing test, and no test asserts the old override-beats-switch behavior.
- The console has no remaining text that describes an override beating the switch, and the off notice and its code are gone (KTD2).
- The original feature-flags plan states the kill-switch rule (U3).
- The PR description names the rollout step under Risks so a person runs it around the merge.
- No leftover code from abandoned approaches remains in the diff.
