---
name: sync-tracker
description: |
  Push the backlog in .eng/project-model.json to the configured tracker (Jira in
  v1) through its adapter. Modes: report, dry-run (default), sync, validate.
  Never writes without showing a diff and getting confirmation.
when_to_use: |
  Trigger on "sync to jira", "push the backlog", "sync the tracker",
  "/eng:sync-tracker", or when the user wants to see what would change in the
  tracker. Default to dry-run.
argument-hint: "[report|dry-run|sync|validate]"
allowed-tools: Bash(node *)
---

# sync-tracker

Project the backlog into the tracker. Deterministic planning is done by the
script; the tracker calls go through the active provider adapter. **Default mode
is dry-run. Nothing is written without an explicit confirmation.**

Resolve paths once:
- `PLAN="${CLAUDE_PLUGIN_ROOT}/skills/sync-tracker/scripts/sync-plan.mjs"`
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`
- adapter: `${CLAUDE_PLUGIN_ROOT}/references/providers/<config.provider>.md`

## Modes

- **report** — read-only summary of the plan (creates/updates by kind). No MCP needed.
- **dry-run** (default) — show the full create/update diff that *would* run. No writes.
- **validate** — run `node "$STORE" validate`; confirm the backlog is sync-ready
  (no orphans, AC + DoD present). No MCP needed.
- **sync** — perform the writes, but only after showing the diff and getting an
  explicit **confirmation**. Add **`--force-descriptions`** to overwrite
  descriptions even when the conservative marker check would skip them — use it
  only for a known-safe backfill (e.g. the first re-sync before anyone has
  hand-edited the issues).

## Steps

1. **Load** `.eng/config.json` and `.eng/project-model.json`. If the backlog is
   empty, stop and point to `/eng:build-project-model`.

2. **Guard (sync only).** For `sync`, the config must pass the readiness check —
   provider `jira`, status `ready`, `mcp.available`, and a `project.key`. If not,
   print the blockers and stop; suggest `dry-run` instead. (`report`/`dry-run`/
   `validate` do not require a live MCP.)

3. **Build the reconciliation index (when MCP is live).** For each backlog node,
   the model's `trackerKey` marks it as already synced. To also catch issues made
   in earlier runs, use the adapter's `searchByExternalRef`: JQL
   `labels = "eng-id:<engId>"` → map found `engId → issueKey`. Pass that map to
   the planner as the existing index. (Skip this in `report`/`dry-run` without a
   live MCP — plan from the model's `trackerKey`s only, and say so.)

4. **Plan.** Run `node "$PLAN" plan .eng/project-model.json` (or pass the index in
   code) to get the ordered `create`/`update` operations and summary.

5. **Preview.** Show the diff: counts and a per-operation list (op · kind · title ·
   trackerKey or "new"). For `report`/`dry-run`, **stop here**.

6. **Confirm (sync only).** Ask the user to confirm explicitly before any write.
   If they decline, stop — no changes.

7. **Write (sync only), parent-first.** Execute the operations in order via the
   adapter's tools:
   - **create**: map `type`/`kind` to the Jira issue type (Epic/Story/Task/
     Sub-task/Bug per the adapter). Build the `summary` as **`[TAG] <title>`**,
     where TAG maps `task.category`: backend→BE, frontend→FE, database→DB,
     validation→VAL, tests→QA, documentation→DOC, logging→LOG, monitoring→MON,
     migration→MIG, admin→ADM, design→DESIGN. (Epics/stories keep a plain title.)
     Fold acceptance criteria and Definition of Done into the description. Set the
     parent link from the parent's freshly created `trackerKey`. Set the Jira
     **priority** from the node's `priority` field (already derived from phase).
     Add labels: the `phase` label (per `config.mappings.phaseField`), the
     `eng-id:<engId>` label, the `eng-hash:` marker (`engHashLabel(description)`
     from `sync-plan.mjs`) so later re-syncs can tell eng's text from a human's
     (item G), `disc:<category>` for tasks, and — if the node's `needsDecision`
     is true — `needs-decision` (and prefix the title with `[?]`). Record the new
     issue key.
   - **update**: push the toolkit-owned fields to the existing `trackerKey`.
     **Conservative rule (item G):** always refresh labels / tag-prefix /
     priority / epic status (safe, additive). For the **description**, decide per
     issue: read the issue's current description and its `eng-hash:<h>` label,
     then call `decideDescriptionUpdate({ current, lastHash, force })` from
     `sync-plan.mjs` — it returns `overwrite` (empty, or the current text still
     hashes to the stored marker = eng owns it) or `skip` (no marker on non-empty
     text, or the hash differs = a human edited it → warn, leave it). When you do
     overwrite, **re-stamp** the `eng-hash:` label with `engHashLabel(newText)`
     so the next re-sync can tell eng's text from a human's. `force` comes from
     `--force-descriptions` (see Modes) — used for the known-safe first backfill.
     **Translation override:** after `/eng:translate`, the model's titles /
     descriptions / acceptance criteria have been rewritten to English. Those must
     be pushed (summary + description) — this is the toolkit rewriting its **own**
     content, not clobbering a human's. Still skip an issue a human has visibly
     edited since the last eng-sync.
   - **epic status (the done-map):** after creating/finding an epic, if
     `epic.status` is `done` or `in-progress`, **transition it**. Jira sets the
     initial status on create, so this is create-then-transition: call the
     adapter's `getTransitions`, then resolve the transition **by target status
     CATEGORY, not by name** — pass the transitions list to the planner's
     `resolveTransitionForStatus(transitions, epic.status)` (maps `done`→category
     `done`, `in-progress`→`indeterminate`, `todo`→`new`) and apply the returned
     id via `transitionJiraIssue`. Category keys are universal across Jira
     templates, so this survives renamed/localized statuses (status *names* vary
     — we already hit that with issue-type names); ids are still per-project, so
     always resolve at runtime from the live `getTransitions`. If the helper
     returns null (no transition into that category — already there, or the
     project lacks it), skip silently. `todo` epics need no transition. This is
     what surfaces "what's already built" as green Done epics instead of a
     to-do-only tracker.
   - **timeline (item F):** if a done epic carries `startDate` / `dueDate` (real
     git dates from build), set Jira start/due on it. **Future epics get no
     dates** — their `sequence` is the ordering signal, not a deadline; do not
     fabricate due dates. Jira start/due are next-gen date fields; if the
     connected MCP cannot write them, warn once and skip dates (everything else
     still syncs) — see the adapter's date-field note.
   Collect an `engId → issueKey` result map.

8. **Record + validate.** Write the result keys back into the model (the planner's
   `applyResults` shape), save the store, then run `node "$STORE" validate`.

9. **Final report.** created / updated / skipped, plus any conflicts, and the
   project key. If something failed mid-run, report exactly which nodes did and
   did not get keys.

## Rules

- `dry-run` is the default; `sync` NEVER writes before a shown diff + confirmation.
- Create parent-first (Epic before Story before Task before Sub-task).
- Every created issue carries an `eng-id:<engId>` label so re-syncs reconcile
  instead of duplicating, and an `eng-hash:<h>` label marking the description eng
  wrote, so a conservative re-sync (item G) never clobbers a human's edit.
- Jira-only in v1; a non-Jira/stub/incomplete config blocks `sync` (but not
  dry-run/report).
