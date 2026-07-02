---
name: translate
description: |
  Rewrite an existing model's text (epic/story/task titles, descriptions, and
  acceptance criteria) to English IN PLACE — keeping every id, trackerKey and the
  structure. For a backlog first generated from a non-English repo. Safe: no
  re-draft, so no duplicate issues on the next sync.
when_to_use: |
  Trigger on "translate to english", "existing tasks aren't English", "make the
  Jira issues English", "/eng:translate", or when a backlog was generated in a
  non-English repo and the tracker text is mixed-language.
allowed-tools: Bash(node *)
---

# translate

Turn an existing backlog's mixed-language text into English **without
re-drafting** — so ids/trackerKeys stay and the next sync *updates* the same
issues (no duplicates). This is distinct from a full re-run (which regenerates
ids and would duplicate).

Resolve paths once:
- `TR="${CLAUDE_PLUGIN_ROOT}/skills/translate/scripts/translate.mjs"`
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`

## Steps

1. **Collect the worklist.** Run `node "$TR" collect .eng/project-model.json` —
   it returns only the nodes whose title / description / acceptance criteria still
   contain non-English (Cyrillic) text. Already-English nodes are skipped (cheaper).

2. **Translate (you).** For each listed id, read its current text from the model
   and produce faithful **English** for `title`, `description`, and each
   acceptance criterion (`given`/`when`/`then`). Build a map
   `{ "<id>": { "title": "...", "description": "...", "acceptanceCriteria": [{given,when,then}] } }`.
   **Translate meaning only — do not restructure, renumber, or change ids.**

3. **Apply in place.** Write the map to a scratch file and run
   `node "$TR" apply .eng/project-model.json <map.json> --write`. It writes each
   translation back by id and preserves everything else (ids, trackerKeys, tasks,
   status, priority).

4. **Validate.** Run `node "$STORE" validate` — must print `VALID`.

5. **Point to sync.** Recommend `/eng:sync-tracker` — the changed titles /
   descriptions / AC now need to reach the existing issues (a **translation
   override**; see that skill's update rule).

## Rules

- **Never re-draft.** Only translate existing text; keep ids/trackerKeys/structure
  so the sync updates the same issues — no duplicates.
- Translate faithfully; do not add, drop, or reorder work.
- Skip nodes that are already English (the `collect` step does this for you).
- This skill edits the model only; it does not touch the tracker.
