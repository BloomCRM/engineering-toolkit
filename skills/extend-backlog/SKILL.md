---
name: extend-backlog
description: |
  Draft and append ONLY newly-discovered work (planned features found by the
  completeness critic, ux/security findings) to an existing backlog — without
  re-drafting existing issues. The non-destructive incremental path: a full
  build re-drafts everything and duplicates on re-sync; this appends the delta.
when_to_use: |
  Trigger on "extend the backlog", "add the multi-service booking epic",
  "materialize the ux/security findings", "draft the new planned features
  without duplicating", "/eng:extend-backlog", or after `refresh-model` when
  analyze/critic surfaced planned work that has no epic yet.
allowed-tools: Bash(node *)
---

# extend-backlog

Add new work to a backlog that is already synced, **without touching existing
issues**. A full `/eng:build-project-model` re-drafts every epic with the agents,
which regenerates ids and **duplicates** issues on re-sync. This skill drafts
only the *delta* and appends it with fresh, collision-checked ids, so
`sync-tracker` **creates** just the new items and leaves everything else alone.

Resolve paths once:
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`
- `PLAN="${CLAUDE_PLUGIN_ROOT}/skills/build-project-model/scripts/planning-model.mjs"`
- `KM="${CLAUDE_PLUGIN_ROOT}/skills/analyze-project/scripts/knowledge-model.mjs"`
- `CONFIG="${CLAUDE_PLUGIN_ROOT}/skills/setup-toolkit/scripts/config.mjs"`

## Steps

1. **Require a model with a backlog.** Read `.eng/project-model.json`. If there is
   no backlog yet, stop and point to `/eng:build-project-model` (the first build
   is not this skill's job — it is for *extending* an existing one).

2. **Discover new work — two sources (run one or both):**
   - **Completeness critic (item M).** Scan the forward-planning docs (roadmap,
     `docs/next-session.md`, `specs/`, `docs/architecture/*`, admin/product
     feedback). List every documented planned feature; for each, judge whether an
     existing domain/epic already covers it and tag `coveredBy:<domainId|null>`.
     Write `[{ name, coveredBy, sources }]` and run
     `node "$KM" gaps <km.json> <plans.json>` → gap `risks`; merge them back
     (`node "$KM" merge`) and add a `status: "planned"` **domain** to
     `knowledgeModel.domains` for each genuine miss (e.g. `multi-service-booking`).
   - **UX / security intake (item I).** Only if the config panel is `deep`
     (`node "$CONFIG" panel`) — run `ux-reviewer` and `security-engineer`. Merge
     their findings additively (`node "$KM" merge`). Turn a *feature-poor* screen
     into a `status: "partial"` domain; turn a concrete security/UX defect into a
     **tech-debt story** to append under the existing `epic-tech-debt` in step 5.

3. **Plan the new epics.** Collect the domain ids from step 2 (the new `planned`
   / `partial` domains). Run
   `node "$PLAN" plan-new .eng/project-model.json <id,id,...>` — it returns only
   the domains that have **no epic yet** (skips any already covered by
   `epic-<id>`, `epic-done-<id>`, or an epic `domainRef`). These are the ones to
   draft. If the list is empty, there is nothing new — stop and say so.

4. **Draft ONLY the new work (agents).** For each undrafted domain, dispatch
   `product-owner` (stories/value), `senior-engineer` (tasks by category), and
   `qa-lead` (Given/When/Then acceptance criteria) **scoped to that one domain**.
   Build epics with `id: epic-<domainId>`, `domainRef: <domainId>`, a `phase`, and
   `stories[]` — English, every story with acceptance criteria. Do **not** touch
   or re-draft any existing epic.

5. **Append.**
   - New epics: write them to a temp `epics.json` and run
     `node "$PLAN" append-epics .eng/project-model.json epics.json` (collision-
     guarded — a colliding id is skipped, never clobbered).
   - Tech-debt / security stories: write them to `stories.json` and run
     `node "$PLAN" append-stories .eng/project-model.json epic-tech-debt stories.json`.

6. **Normalize + validate.** Run `node "$PLAN" normalize .eng/project-model.json
   --write` (fills DoD, stamps priority/status/sequence, keeps every existing id/
   trackerKey), then `node "$STORE" validate` (must print `VALID`).

7. **Report + next step.** Say exactly what was appended (new epics, new
   tech-debt stories) and what was skipped as already-covered. Recommend
   `/eng:sync-tracker` **dry-run first** — the diff must be **creates only** for
   the new items plus harmless updates; if it shows unexpected creates for
   existing work, stop (something regenerated ids) rather than duplicating.

## Rules

- **Never re-draft existing issues.** This skill only appends; existing ids and
  trackerKeys are immutable here. That is the whole point (non-destructive on a
  live tracker).
- Every appended id is collision-checked; a clash is skipped and reported, never
  overwritten.
- New epics carry `domainRef` so a later run knows the domain is already covered.
- Finish through `normalize` → `store validate`; do not hand-assemble the model.
- Draft only in English; every new story has acceptance criteria + a DoD.
