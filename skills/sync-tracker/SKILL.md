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
  explicit **confirmation**.

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
     `eng-id:<engId>` label, `disc:<category>` for tasks, and — if the node's
     `needsDecision` is true — `needs-decision` (and prefix the title with `[?]`).
     Record the new issue key.
   - **update**: push the same fields (summary+tag, description, priority, labels)
     to the existing `trackerKey`. **Conservative rule:** always refresh labels /
     tag-prefix / priority (safe, additive); overwrite a description only if it is
     empty or unchanged since the last eng-sync — otherwise warn and skip, to
     avoid clobbering human edits in Jira.
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
  instead of duplicating.
- Jira-only in v1; a non-Jira/stub/incomplete config blocks `sync` (but not
  dry-run/report).
