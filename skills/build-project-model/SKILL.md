---
name: build-project-model
description: |
  Turn the Knowledge Model into a Planning Model and backlog
  (Phase -> Epic -> Story -> Task -> Subtask, with acceptance criteria and a
  Definition of Done) in .eng/project-model.json. Run after analyze-project.
when_to_use: |
  Trigger on "build the backlog", "build the project model", "plan the work",
  "/eng:build-project-model", or when sync-tracker reports there is no backlog.
allowed-tools: Bash(node *)
---

# build-project-model

Turn the factual Knowledge Model into a plan: classify the work, then draft the
backlog hierarchy, then enforce invariants deterministically. This skill does
not touch a tracker.

Resolve paths once:
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`
- `PLAN="${CLAUDE_PLUGIN_ROOT}/skills/build-project-model/scripts/planning-model.mjs"`

## Steps

1. **Require a Knowledge Model.** Read `.eng/project-model.json`. If
   `knowledgeModel.domains` is empty, stop and tell the user to run
   `/eng:analyze-project` first.

2. **Classify (agents).** Use the `product-owner`, `solution-architect`, and
   `qa-lead` agents to decide, per domain: `phase` (one of MVP / Production Ready
   / Public Release / Scaling / Enterprise / AI) and `priority`. Only **Planned**
   and **Partially Implemented** roadmap items become new backlog work; record
   the rest but do not expand them.

3. **Draft the backlog (agents).** Use `product-owner` (stories/value),
   `senior-engineer` (task breakdown by category: backend / frontend / database /
   validation / tests / documentation / logging / monitoring / migration), and
   `qa-lead` (acceptance criteria as Given/When/Then) to draft
   `Phase -> Epic -> Story -> Task -> Subtask`. Every story needs >= 1 acceptance
   criterion. Put bugs into the dedicated **Bug Fixes** epic and tech-debt into
   the dedicated **Technical Debt** epic — never mix them into feature epics.
   Keep tasks small; never generate giant tasks.

4. **Write the draft** into `.eng/project-model.json` under `backlog`.

5. **Normalize deterministically.** Run
   `node "$PLAN" normalize .eng/project-model.json > .eng/project-model.next.json`
   then replace the store file with the result. This guarantees the dedicated
   Tech-Debt and Bug epics exist, fills any missing Definition of Done with the
   default, and rebuilds `planningModel` from the Knowledge Model. The command
   exits non-zero if the normalized model fails validation.

6. **Timeline (item F).** Two honest sources, never fabricated dates:
   - **Done epics → real git dates.** For each `epic-done-<id>`, take the
     matching domain's `sources[]` from the Knowledge Model and run
     `git log --format=%cI -- <sources>`; pipe the output through
     `node "$PLAN" git-dates <logfile>` to get `{ start, end }` and stamp them on
     the epic as `startDate` / `dueDate`. This is history (repo/feature commit
     range), not fiction. Skip an epic whose sources yield no commits.
   - **Future epics → sequence only.** `normalize` already stamped a `sequence`
     (phase + dependsOn order) on every not-done epic. Do **not** invent calendar
     deadlines for future work — order is the signal, not dates.

7. **Validate and report.** Run `node "$STORE" validate` (must print `VALID`),
   then `node "$STORE" inspect`. Report epics/stories/tasks counts, items per
   phase, and how many bugs / tech-debt items were captured.

## Rules

- **Write all epic/story/task titles, descriptions and acceptance criteria in
  English**, regardless of the repository's language.
- **Do not draft stories for `implemented` domains** — the `normalize` step adds
  them deterministically as lightweight **Done** epics (`epic-done-<id>`, no
  stories) so the tracker shows what's already built. Draft work only for
  `partial` / `planned` domains.
- Bugs and tech-debt live in their dedicated epics, never inside feature epics.
- Every story has acceptance criteria (Given/When/Then) and a Definition of Done.
- Never generate giant tasks — split by category.
- Always finish by going through `planning-model.mjs normalize` then
  `store.mjs validate`; do not hand-assemble the final model.
