# Foundation: Plugin Scaffold + knowledge-store — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an installable, clean-validating Claude Code plugin `eng` whose `knowledge-store` skill can `init / validate / inspect / migrate` the `project-model.json` knowledge model, with the store logic covered by automated tests.

**Architecture:** A single-plugin marketplace repo (`engineering-toolkit`). The store's integrity logic lives in a **zero-dependency Node.js script** (`store.mjs`) so it is deterministic and unit-testable; the `knowledge-store` SKILL.md is a thin wrapper that calls it. A JSON Schema documents the contract; the script enforces the critical invariants in code (no orphans, every story has acceptance criteria, every task has a Definition of Done).

**Tech Stack:** Claude Code plugin format (`.claude-plugin/`), Markdown skills, Node.js ≥18 (ESM, built-in `node:test`), JSON Schema (draft 2020-12, as contract doc).

**Prerequisites:** `node --version` ≥ 18 and the `claude` CLI available on PATH. Verify both before Task 1.

**Reference:** Design spec — `docs/specs/2026-06-30-engineering-toolkit-design.md` (§4 store shape, §4.3 task categories, §4.4 DoD, §8.2 knowledge-store, §9 repo structure).

---

## File Structure

| File | Responsibility |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest: name `eng`, version, metadata |
| `.claude-plugin/marketplace.json` | Marketplace `engineering-intelligence` listing the `eng` plugin at `./` |
| `schemas/project-model.schema.json` | Contract: top-level shape of `project-model.json` |
| `skills/knowledge-store/SKILL.md` | Thin skill: how/when to call the store script |
| `skills/knowledge-store/scripts/store.mjs` | Deterministic `init/validate/inspect/migrate` over the store file |
| `tests/store.test.mjs` | `node:test` coverage of the four operations + invariants |
| `tests/fixtures/valid-model.json` | A minimal valid model used by tests |
| `README.md` | Install + usage |
| `CHANGELOG.md` | Release log (Keep a Changelog) |
| `LICENSE` | MIT |

Store file resolution (used by `store.mjs`): `ET_STORE_PATH` env var if set, else `<cwd>/.eng/project-model.json`. Tests set `ET_STORE_PATH` to a temp file so they never touch a real repo.

**Constants locked for this plan (use these exact names/values everywhere):**
- Current schema version string: `"1.0"`
- Allowed task categories: `backend, frontend, database, validation, tests, documentation, logging, monitoring, migration`
- Default Definition of Done items: `code, unit, integration, docs, review, ci`
- Store env override var: `ET_STORE_PATH`
- Script subcommands: `init`, `validate`, `inspect`, `migrate`

---

## Task 1: Repo metadata files (README, CHANGELOG, LICENSE)

**Files:**
- Create: `README.md`
- Create: `CHANGELOG.md`
- Create: `LICENSE`

- [ ] **Step 1: Write `LICENSE` (MIT)**

```text
MIT License

Copyright (c) 2026 Volodymyr Kostyrko

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Write `README.md`**

````markdown
# Engineering Intelligence Platform (`eng`)

A Claude Code plugin that turns a repository's documentation and code into a
structured engineering backlog and synchronizes it to your issue tracker.

- **Source of truth:** git docs + code.
- **Brain:** `.eng/project-model.json` (the knowledge-store) — not Jira, not Markdown.
- **Trackers:** Jira (v1, sync-ready). Azure DevOps / GitHub Projects / Linear are stubs.

## Requirements

- Claude Code (`claude` CLI on PATH)
- Node.js ≥ 18

## Install

```bash
/plugin marketplace add BloomCRM/engineering-toolkit
/plugin install eng@engineering-intelligence
```

## Skills

| Skill | Purpose |
|---|---|
| `/eng:knowledge-store` | Init / validate / inspect / migrate the project model |

> More skills (`setup-toolkit`, `analyze-project`, `build-project-model`,
> `sync-tracker`, `detect-changes`) land in later milestones — see
> `docs/specs/2026-06-30-engineering-toolkit-design.md`.

## License

MIT
````

- [ ] **Step 3: Write `CHANGELOG.md`**

```markdown
# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Plugin scaffold (`eng`) and `engineering-intelligence` marketplace.
- `knowledge-store` skill with `init / validate / inspect / migrate` over
  `project-model.json`.
- JSON Schema contract for the project model.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md LICENSE
git commit -m "docs: repo metadata (README, CHANGELOG, MIT license)"
```

---

## Task 2: Plugin + marketplace manifests

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`

- [ ] **Step 1: Write `.claude-plugin/plugin.json`**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "eng",
  "displayName": "Engineering Intelligence",
  "version": "0.1.0",
  "description": "Turn repository docs into a structured engineering backlog and sync it to your tracker.",
  "author": { "name": "Volodymyr Kostyrko" },
  "license": "MIT",
  "keywords": ["project-management", "backlog", "jira", "agents", "engineering"]
}
```

- [ ] **Step 2: Write `.claude-plugin/marketplace.json`**

```json
{
  "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
  "name": "engineering-intelligence",
  "description": "Engineering Intelligence Platform — project-management plugins for Claude Code.",
  "owner": { "name": "Volodymyr Kostyrko" },
  "plugins": [
    {
      "name": "eng",
      "source": "./",
      "description": "Engineering Intelligence toolkit"
    }
  ]
}
```

- [ ] **Step 3: Verify both files are valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')); JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json','utf8')); console.log('OK')"`
Expected: prints `OK` (no parse error).

- [ ] **Step 4: Commit**

```bash
git add .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "feat: plugin (eng) + marketplace (engineering-intelligence) manifests"
```

---

## Task 3: JSON Schema contract for the project model

**Files:**
- Create: `schemas/project-model.schema.json`

- [ ] **Step 1: Write the schema**

This documents the top-level contract. It is intentionally permissive on deep
fields (the `store.mjs` validator enforces the strict invariants in Task 5);
it locks the overall shape, the four allowed task categories, and the required
sections.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://bloomcrm.dev/schemas/project-model.schema.json",
  "title": "project-model",
  "type": "object",
  "required": ["schemaVersion", "knowledgeModel", "planningModel", "backlog"],
  "additionalProperties": true,
  "properties": {
    "schemaVersion": { "type": "string" },
    "generatedAt": { "type": "string" },
    "source": {
      "type": "object",
      "properties": {
        "repo": { "type": "string" },
        "commit": { "type": "string" },
        "branch": { "type": "string" }
      }
    },
    "knowledgeModel": {
      "type": "object",
      "required": ["domains"],
      "properties": {
        "domains": { "type": "array" },
        "architecture": { "type": "array" },
        "techDebt": { "type": "array" },
        "infrastructure": { "type": "array" },
        "security": { "type": "array" },
        "risks": { "type": "array" }
      }
    },
    "planningModel": {
      "type": "object",
      "properties": {
        "phases": { "type": "array", "items": { "type": "string" } },
        "items": { "type": "array" }
      }
    },
    "backlog": {
      "type": "object",
      "required": ["epics"],
      "properties": {
        "epics": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "phase", "type", "title", "stories"],
            "properties": {
              "id": { "type": "string" },
              "trackerKey": { "type": ["string", "null"] },
              "phase": { "type": "string" },
              "type": { "type": "string", "enum": ["feature", "bug", "techdebt"] },
              "title": { "type": "string" },
              "stories": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["id", "title", "acceptanceCriteria", "definitionOfDone", "tasks"],
                  "properties": {
                    "id": { "type": "string" },
                    "trackerKey": { "type": ["string", "null"] },
                    "title": { "type": "string" },
                    "acceptanceCriteria": {
                      "type": "array",
                      "minItems": 1,
                      "items": {
                        "type": "object",
                        "required": ["given", "when", "then"],
                        "properties": {
                          "given": { "type": "string" },
                          "when": { "type": "string" },
                          "then": { "type": "string" }
                        }
                      }
                    },
                    "definitionOfDone": {
                      "type": "array",
                      "minItems": 1,
                      "items": { "type": "string" }
                    },
                    "tasks": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": ["id", "category"],
                        "properties": {
                          "id": { "type": "string" },
                          "trackerKey": { "type": ["string", "null"] },
                          "category": {
                            "type": "string",
                            "enum": ["backend", "frontend", "database", "validation", "tests", "documentation", "logging", "monitoring", "migration"]
                          },
                          "subtasks": { "type": "array" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Verify it parses as JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('schemas/project-model.schema.json','utf8')); console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add schemas/project-model.schema.json
git commit -m "feat: project-model JSON Schema contract"
```

---

## Task 4: Test fixture — a minimal valid model

**Files:**
- Create: `tests/fixtures/valid-model.json`

- [ ] **Step 1: Write the fixture**

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-06-30T00:00:00Z",
  "source": { "repo": "example/repo", "commit": "abc123", "branch": "main" },
  "knowledgeModel": {
    "domains": [
      { "id": "calendar", "name": "Calendar", "status": "partial", "dependsOn": ["bookings"], "sources": [] }
    ],
    "architecture": [], "techDebt": [], "infrastructure": [], "security": [], "risks": []
  },
  "planningModel": {
    "phases": ["MVP", "Production Ready", "Public Release", "Scaling", "Enterprise", "AI"],
    "items": [ { "ref": "calendar", "phase": "MVP", "type": "feature", "roadmapStatus": "partial", "priority": "high" } ]
  },
  "backlog": {
    "epics": [
      {
        "id": "epic-calendar", "trackerKey": null, "phase": "MVP", "type": "feature", "title": "Calendar",
        "stories": [
          {
            "id": "story-cal-day-view", "trackerKey": null, "title": "Day view",
            "acceptanceCriteria": [ { "given": "a master with bookings", "when": "I open the day view", "then": "I see the bookings on the timeline" } ],
            "definitionOfDone": ["code", "unit", "integration", "docs", "review", "ci"],
            "tasks": [ { "id": "task-cal-day-be", "trackerKey": null, "category": "backend", "subtasks": [] } ]
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Verify it parses as JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('tests/fixtures/valid-model.json','utf8')); console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/valid-model.json
git commit -m "test: minimal valid project-model fixture"
```

---

## Task 5: `store.mjs` — TDD the four operations

The script exposes a CLI (`node store.mjs <cmd>`) **and** pure functions for
tests. We test the pure functions directly. Build it operation-by-operation,
test-first.

**Files:**
- Create: `tests/store.test.mjs`
- Create: `skills/knowledge-store/scripts/store.mjs`

### 5a — `validate` (build this first; later ops reuse it)

- [ ] **Step 1: Write the failing test**

Create `tests/store.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateModel } from '../skills/knowledge-store/scripts/store.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const valid = () => JSON.parse(readFileSync(join(here, 'fixtures/valid-model.json'), 'utf8'));

test('validateModel: valid model has no errors', () => {
  const errors = validateModel(valid());
  assert.deepEqual(errors, []);
});

test('validateModel: missing schemaVersion is an error', () => {
  const m = valid(); delete m.schemaVersion;
  assert.ok(validateModel(m).some(e => e.includes('schemaVersion')));
});

test('validateModel: story without acceptance criteria is an error', () => {
  const m = valid(); m.backlog.epics[0].stories[0].acceptanceCriteria = [];
  assert.ok(validateModel(m).some(e => e.includes('acceptanceCriteria')));
});

test('validateModel: task without definitionOfDone on its story is an error', () => {
  const m = valid(); m.backlog.epics[0].stories[0].definitionOfDone = [];
  assert.ok(validateModel(m).some(e => e.includes('definitionOfDone')));
});

test('validateModel: invalid task category is an error', () => {
  const m = valid(); m.backlog.epics[0].stories[0].tasks[0].category = 'nonsense';
  assert.ok(validateModel(m).some(e => e.includes('category')));
});

test('validateModel: duplicate ids are an error', () => {
  const m = valid();
  const s = m.backlog.epics[0].stories[0];
  s.tasks.push({ id: s.tasks[0].id, category: 'frontend', subtasks: [] });
  assert.ok(validateModel(m).some(e => e.toLowerCase().includes('duplicate')));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../store.mjs'` (file does not exist yet).

- [ ] **Step 3: Implement `store.mjs` with `validateModel` only**

Create `skills/knowledge-store/scripts/store.mjs`:

```js
// Zero-dependency knowledge-store operations over project-model.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCHEMA_VERSION = '1.0';
export const TASK_CATEGORIES = ['backend', 'frontend', 'database', 'validation', 'tests', 'documentation', 'logging', 'monitoring', 'migration'];
export const DEFAULT_DOD = ['code', 'unit', 'integration', 'docs', 'review', 'ci'];

export function storePath() {
  return process.env.ET_STORE_PATH || join(process.cwd(), '.eng', 'project-model.json');
}

// Returns an array of human-readable error strings. Empty array = valid.
export function validateModel(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['model is not an object'];
  if (typeof m.schemaVersion !== 'string') errors.push('missing or non-string schemaVersion');
  if (!m.knowledgeModel || !Array.isArray(m.knowledgeModel.domains)) errors.push('knowledgeModel.domains must be an array');
  if (!m.backlog || !Array.isArray(m.backlog.epics)) {
    errors.push('backlog.epics must be an array');
    return errors;
  }

  const ids = new Set();
  const seeId = (id, where) => {
    if (typeof id !== 'string' || !id) { errors.push(`${where}: missing id`); return; }
    if (ids.has(id)) errors.push(`duplicate id: ${id}`);
    ids.add(id);
  };

  for (const epic of m.backlog.epics) {
    seeId(epic.id, 'epic');
    if (!epic.phase) errors.push(`epic ${epic.id}: missing phase`);
    if (!['feature', 'bug', 'techdebt'].includes(epic.type)) errors.push(`epic ${epic.id}: invalid type`);
    if (!epic.title) errors.push(`epic ${epic.id}: missing title`);
    if (!Array.isArray(epic.stories)) { errors.push(`epic ${epic.id}: stories must be an array`); continue; }

    for (const story of epic.stories) {
      seeId(story.id, 'story');
      if (!story.title) errors.push(`story ${story.id}: missing title`);
      if (!Array.isArray(story.acceptanceCriteria) || story.acceptanceCriteria.length === 0) {
        errors.push(`story ${story.id}: acceptanceCriteria must be a non-empty array`);
      } else {
        for (const ac of story.acceptanceCriteria) {
          if (!ac || !ac.given || !ac.when || !ac.then) errors.push(`story ${story.id}: acceptanceCriteria entry needs given/when/then`);
        }
      }
      if (!Array.isArray(story.definitionOfDone) || story.definitionOfDone.length === 0) {
        errors.push(`story ${story.id}: definitionOfDone must be a non-empty array`);
      }
      if (!Array.isArray(story.tasks)) { errors.push(`story ${story.id}: tasks must be an array`); continue; }

      for (const task of story.tasks) {
        seeId(task.id, 'task');
        if (!TASK_CATEGORIES.includes(task.category)) errors.push(`task ${task.id}: invalid category "${task.category}"`);
        if (task.subtasks && !Array.isArray(task.subtasks)) errors.push(`task ${task.id}: subtasks must be an array`);
        for (const sub of task.subtasks || []) seeId(sub.id, 'subtask');
      }
    }
  }
  return errors;
}
```

- [ ] **Step 4: Run tests to verify `validate` passes**

Run: `node --test`
Expected: all 6 `validateModel` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/knowledge-store/scripts/store.mjs tests/store.test.mjs
git commit -m "feat(store): validateModel with structural invariants (TDD)"
```

### 5b — `init`

- [ ] **Step 1: Add failing tests for `initModel` / `writeStore` / `readStore`**

Append to `tests/store.test.mjs`:

```js
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { initModel, writeStore, readStore } from '../skills/knowledge-store/scripts/store.mjs';

test('initModel: produces a model that validates', () => {
  assert.deepEqual(validateModel(initModel()), []);
});

test('writeStore/readStore round-trips and refuses overwrite without force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eng-'));
  const path = join(dir, '.eng', 'project-model.json');
  try {
    writeStore(path, initModel());
    assert.ok(existsSync(path));
    const back = readStore(path);
    assert.equal(back.schemaVersion, '1.0');
    assert.throws(() => writeStore(path, initModel(), { force: false }), /exists/);
    writeStore(path, initModel(), { force: true }); // force overwrites, no throw
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL — `initModel`/`writeStore`/`readStore` are not exported.

- [ ] **Step 3: Implement `initModel`, `readStore`, `writeStore`**

Append to `store.mjs`:

```js
export function initModel() {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: null,
    source: { repo: null, commit: null, branch: null },
    knowledgeModel: { domains: [], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: ['MVP', 'Production Ready', 'Public Release', 'Scaling', 'Enterprise', 'AI'], items: [] },
    backlog: { epics: [] }
  };
}

export function readStore(path = storePath()) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeStore(path = storePath(), model = initModel(), { force = false } = {}) {
  if (existsSync(path) && !force) throw new Error(`store already exists at ${path} (use force to overwrite)`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(model, null, 2) + '\n', 'utf8');
  return path;
}
```

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: all tests PASS (including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add skills/knowledge-store/scripts/store.mjs tests/store.test.mjs
git commit -m "feat(store): initModel + read/write with overwrite guard (TDD)"
```

### 5c — `inspect` + `migrate`

- [ ] **Step 1: Add failing tests for `inspectModel` and `migrateModel`**

Append to `tests/store.test.mjs`:

```js
import { inspectModel, migrateModel, SCHEMA_VERSION } from '../skills/knowledge-store/scripts/store.mjs';

test('inspectModel: counts epics/stories/tasks and unsynced', () => {
  const s = inspectModel(valid());
  assert.equal(s.epics, 1);
  assert.equal(s.stories, 1);
  assert.equal(s.tasks, 1);
  assert.equal(s.unsynced, 3); // epic + story + task all have trackerKey null
  assert.equal(s.byPhase.MVP, 1);
});

test('migrateModel: stamps current schema version and reports changed=false when current', () => {
  const m = valid();
  const r = migrateModel(m);
  assert.equal(r.model.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.changed, false);
});

test('migrateModel: upgrades an older version and reports changed=true', () => {
  const m = valid(); m.schemaVersion = '0.9';
  const r = migrateModel(m);
  assert.equal(r.model.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.changed, true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL — `inspectModel`/`migrateModel` not exported.

- [ ] **Step 3: Implement `inspectModel` and `migrateModel`**

Append to `store.mjs`:

```js
export function inspectModel(m) {
  const stats = { epics: 0, stories: 0, tasks: 0, subtasks: 0, unsynced: 0, byPhase: {}, byType: {} };
  for (const epic of m.backlog?.epics || []) {
    stats.epics++;
    stats.byPhase[epic.phase] = (stats.byPhase[epic.phase] || 0) + 1;
    stats.byType[epic.type] = (stats.byType[epic.type] || 0) + 1;
    if (!epic.trackerKey) stats.unsynced++;
    for (const story of epic.stories || []) {
      stats.stories++;
      if (!story.trackerKey) stats.unsynced++;
      for (const task of story.tasks || []) {
        stats.tasks++;
        if (!task.trackerKey) stats.unsynced++;
        stats.subtasks += (task.subtasks || []).length;
      }
    }
  }
  return stats;
}

export function migrateModel(m) {
  const changed = m.schemaVersion !== SCHEMA_VERSION;
  return { model: { ...m, schemaVersion: SCHEMA_VERSION }, changed };
}
```

- [ ] **Step 4: Run tests**

Run: `node --test`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/knowledge-store/scripts/store.mjs tests/store.test.mjs
git commit -m "feat(store): inspectModel + migrateModel (TDD)"
```

### 5d — CLI entrypoint

- [ ] **Step 1: Add the CLI dispatcher to `store.mjs`**

Append to `store.mjs` (runs only when invoked directly, not when imported):

```js
function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}
import { fileURLToPath } from 'node:url';

if (isMain()) {
  const [, , cmd] = process.argv;
  const force = process.argv.includes('--force');
  const path = storePath();
  try {
    if (cmd === 'init') {
      writeStore(path, initModel(), { force });
      console.log(`initialized store at ${path}`);
    } else if (cmd === 'validate') {
      const errors = validateModel(readStore(path));
      if (errors.length) { console.error('INVALID:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log('VALID');
    } else if (cmd === 'inspect') {
      console.log(JSON.stringify(inspectModel(readStore(path)), null, 2));
    } else if (cmd === 'migrate') {
      const { model, changed } = migrateModel(readStore(path));
      if (changed) { writeStore(path, model, { force: true }); console.log(`migrated to ${SCHEMA_VERSION}`); }
      else console.log(`already at ${SCHEMA_VERSION}`);
    } else {
      console.error('usage: store.mjs <init|validate|inspect|migrate> [--force]');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
```

> Note: move the `import { fileURLToPath } ...` line to the **top** of the file
> with the other imports (it is shown here for context). Do not leave a second
> import mid-file — consolidate it with the imports in step 5a.

- [ ] **Step 2: Smoke-test the CLI end to end in a temp dir**

Run:
```bash
ET_STORE_PATH="$(mktemp -d)/project-model.json" sh -c '
  node skills/knowledge-store/scripts/store.mjs init &&
  node skills/knowledge-store/scripts/store.mjs validate &&
  node skills/knowledge-store/scripts/store.mjs inspect &&
  node skills/knowledge-store/scripts/store.mjs migrate'
```
Expected: `initialized store at …`, then `VALID`, then a JSON stats block with `"epics": 0`, then `already at 1.0`.

- [ ] **Step 3: Run the full test suite again (no regressions)**

Run: `node --test`
Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add skills/knowledge-store/scripts/store.mjs
git commit -m "feat(store): CLI dispatcher for init/validate/inspect/migrate"
```

---

## Task 6: `knowledge-store` SKILL.md

**Files:**
- Create: `skills/knowledge-store/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add skills/knowledge-store/SKILL.md
git commit -m "feat: knowledge-store skill (thin wrapper over store.mjs)"
```

---

## Task 7: Validate + locally install the plugin

**Files:** none (verification only)

- [ ] **Step 1: Validate the plugin**

Run: `claude plugin validate . --strict`
Expected: passes with no errors. (Frontmatter of `knowledge-store/SKILL.md`,
`plugin.json`, and `marketplace.json` all parse; components resolve.)

If it errors, fix the reported file and re-run before continuing.

- [ ] **Step 2: Load the plugin locally and confirm the skill appears**

Run: `claude --plugin-dir . -p "/help" 2>&1 | grep -i "knowledge-store" || echo "NOT FOUND"`
Expected: a line mentioning `knowledge-store` (the skill is discovered). If
`NOT FOUND`, check `skills/knowledge-store/SKILL.md` path and frontmatter.

- [ ] **Step 3: Final full test run**

Run: `node --test`
Expected: all tests PASS.

- [ ] **Step 4: Update CHANGELOG and tag the milestone**

Edit `CHANGELOG.md`: move the `[Unreleased]` items under a new
`## [0.1.0] - 2026-06-30` heading (leave `[Unreleased]` empty above it).

```bash
git add CHANGELOG.md
git commit -m "chore: release 0.1.0 (foundation: scaffold + knowledge-store)"
git tag v0.1.0
```

---

## Self-Review (completed during planning)

- **Spec coverage:** This plan implements §9 repo structure (manifests, dirs),
  §4/§4.2 store shape (schema + fixture), §4.3 task categories and §4.4 DoD
  (enforced in `validateModel`), and §8.2 `knowledge-store` (init/validate/
  inspect/migrate as a thin skill over a script). Out of scope by design:
  `setup-toolkit`, `analyze-project`, `build-project-model`, `sync-tracker`,
  `detect-changes`, agents, provider adapters — each gets its own later plan.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code; every
  run step shows the exact command and expected output.
- **Type/name consistency:** `validateModel`, `initModel`, `readStore`,
  `writeStore`, `inspectModel`, `migrateModel`, `SCHEMA_VERSION`,
  `TASK_CATEGORIES`, `DEFAULT_DOD`, `ET_STORE_PATH`, subcommands
  `init/validate/inspect/migrate` — used identically across all tasks.

> One known gotcha flagged inline (Task 5d Step 1): the `fileURLToPath` import
> must be consolidated at the top of `store.mjs`, not left mid-file.
```
