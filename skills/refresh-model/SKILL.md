---
name: refresh-model
description: |
  Re-apply the deterministic planning layer to the EXISTING project model
  without re-analyzing or re-drafting: adds the Done epic-status map, dedicated
  Tech-Debt/Bug epics, default DoD, priority (from phase) and epic status. Keeps
  every existing id and trackerKey — safe to re-sync with no duplicates.
when_to_use: |
  Trigger on "refresh the model", "normalize the model", "add the done map",
  "apply priority/done without re-running", "/eng:refresh-model", or after a
  toolkit upgrade that added deterministic structure you want in an existing
  backlog — WITHOUT re-running the agents.
allowed-tools: Bash(node *)
---

# refresh-model

Apply the toolkit's **deterministic** planning layer to the current
`.eng/project-model.json` — **no agents, no re-analysis, no re-drafting.** Use
this when the repo has not changed (no diff) but you want the derived structure
(done-map, priority, tags-ready categories, dedicated epics, DoD) brought into an
existing backlog.

**Why this is separate from `build-project-model`:** `build` re-drafts stories
with the agents, which regenerates ids and would duplicate issues on a re-sync.
`refresh-model` only runs the pure `normalize` transform, so **every existing
`id` and `trackerKey` is preserved** — a later `sync-tracker` *updates* the same
issues and only *creates* the new deterministic epics (Done map, Tech-Debt, Bug).

Resolve paths once:
- `PLAN="${CLAUDE_PLUGIN_ROOT}/skills/build-project-model/scripts/planning-model.mjs"`
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`

## Steps

1. **Require a model with a Knowledge Model.** Read `.eng/project-model.json`.
   If `knowledgeModel.domains` is empty, stop and point to `/eng:analyze-project`
   (there is nothing to derive from). If there is no backlog yet, this still
   works but you probably want `/eng:build-project-model` first.

2. **Normalize in place.** Run
   `node "$PLAN" normalize .eng/project-model.json --write`.
   It adds a **Done** epic (`epic-done-<domain>`, no stories) per `implemented`
   domain, ensures the dedicated Tech-Debt and Bug epics, fills default DoD, and
   stamps `priority` (from phase) and epic `status` — while preserving all
   existing ids and trackerKeys. It prints the epic count delta.

3. **Validate and report.** Run `node "$STORE" validate` (must print `VALID`),
   then `node "$STORE" inspect`. Tell the user exactly what changed: how many
   Done epics were added, that priority/status were stamped, and that existing
   ids/trackerKeys were preserved (so the next sync is update-only + the new
   epics — no duplicates).

4. **Point to the next step.** Recommend `/eng:sync-tracker` (dry-run first) to
   push the refreshed model — the new Done epics get created, existing issues get
   priority + discipline tags on update.

## Rules

- Deterministic only — this skill never runs the reviewer agents and never
  changes any agent-drafted text (so it can't translate to English; that is a
  separate concern).
- Preserves ids/trackerKeys — that is the whole point; do not regenerate them.
- Read-then-write the model only; it does not touch the tracker.
