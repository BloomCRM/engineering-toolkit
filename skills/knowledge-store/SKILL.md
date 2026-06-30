---
name: knowledge-store
description: |
  Guardian of the project knowledge model (.eng/project-model.json). Use to
  initialize, validate, inspect, or migrate the store. Other skills read and
  write the model through it; this skill never talks to a tracker.
when_to_use: |
  Trigger when the user says "init the project model", "validate the backlog
  model", "inspect the project model", "what's in the project model", or when
  another skill needs the store created or its integrity checked.
allowed-tools: Bash(node *)
---

# knowledge-store

The store is the single source of truth for the platform: `.eng/project-model.json`.
This skill is a thin, deterministic wrapper around a script — it does not parse
documents and does not know any tracker exists.

Resolve the script once:

`SCRIPT="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`

## Operations

- **init** — create an empty, valid model (refuses to overwrite unless the user
  confirms; pass `--force` only on explicit confirmation):
  `node "$SCRIPT" init`
- **validate** — check schema + invariants (no orphans, every story has
  acceptance criteria, every task has a Definition of Done, no duplicate ids).
  Exits non-zero and lists errors if invalid:
  `node "$SCRIPT" validate`
- **inspect** — print counts (epics/stories/tasks/subtasks, unsynced, by phase,
  by type) as JSON:
  `node "$SCRIPT" inspect`
- **migrate** — stamp the model to the current schema version:
  `node "$SCRIPT" migrate`

## Rules

- Never hand-edit `.eng/project-model.json` to "fix" a validation error without
  telling the user what was wrong — surface the `validate` output first.
- The store lives in the **target repository** (`${CLAUDE_PROJECT_DIR}/.eng/`),
  never in plugin data. One repo = one model.
- After any skill writes to the store, run `validate` before reporting success.
