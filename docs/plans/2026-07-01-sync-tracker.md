# sync-tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/eng:sync-tracker` — project the backlog in `.eng/project-model.json` into the configured tracker (Jira in v1) through the provider adapter, with a deterministic reconciliation planner, `dry-run` by default, and a mandatory confirmation before any write.

**Architecture:** The deterministic, testable core is `sync-plan.mjs` — it flattens the backlog into a parent-first list of nodes, reconciles each against known tracker keys (from the model or a supplied external-ref index) into an ordered `create`/`update` plan, stamps a stable `eng-id:<id>` label for re-discovery, and writes tracker keys back into the model. The actual MCP tool calls (search / create / update issue) live in the SKILL prose, driven by `references/providers/jira.md`. `report`/`dry-run`/`validate` need no live MCP; `sync` requires a `ready` config and previews the diff + asks for confirmation before writing.

**Tech Stack:** Claude Code plugin (skill), Node.js ≥18 (`node:test`), existing `config.mjs` (imports `validateConfig` semantics) and `store.mjs`.

**Reference:** Design spec `docs/specs/2026-06-30-engineering-toolkit-design.md` — §3.3 (sync step), §4.2 (`backlog` shape, `trackerKey`), §6 (Jira adapter: operations, `searchByExternalRef`), §8.5 (sync-tracker modes + safety), plus the v1 decisions (Jira only; `sync` always previews + confirms).

**Pattern to follow:** `skills/build-project-model/scripts/planning-model.mjs` for script/test style and cross-skill imports.

---

## File Structure

| File | Responsibility |
|---|---|
| `skills/sync-tracker/scripts/sync-plan.mjs` | `flattenBacklog`, `engLabel`, `buildSyncPlan`, `applyResults`, `validateReadyForSync`, CLI `plan` |
| `skills/sync-tracker/SKILL.md` | Orchestration: guard → search existing → plan → preview → confirm → write → record → validate |
| `tests/sync-plan.test.mjs` | `node:test` coverage of flatten / reconcile / apply / guard |

**Locked contracts:**
- Node kinds and order: `epic` → `story` → `task` → `subtask` (parent-first; a parent must be created before its children).
- External-ref label: `engLabel(engId)` returns `eng-id:<engId>`. Stamped on every created issue; used by the SKILL's `searchByExternalRef` (JQL `labels = "eng-id:<id>"`) to reconcile across model resets.
- An operation is `update` when the node already has a `trackerKey` (in the model) or its `engId` is present in the supplied `existingIndex`; otherwise `create`.
- `sync` mode requires `config.provider === 'jira'` AND `config.providerStatus === 'ready'` AND `config.mcp.available` AND `config.project.key`.

**Sync-plan shape:**
```json
{
  "operations": [
    { "op": "create", "kind": "epic", "engId": "epic-calendar", "parentEngId": null, "trackerKey": null, "title": "Calendar" },
    { "op": "update", "kind": "story", "engId": "story-day", "parentEngId": "epic-calendar", "trackerKey": "BLOOM-12", "title": "Day view" }
  ],
  "summary": { "creates": 1, "updates": 1, "byKind": { "epic": 1, "story": 1 } }
}
```

---

## Task 1: `sync-plan.mjs` core — TDD

**Files:**
- Create: `tests/sync-plan.test.mjs`
- Create: `skills/sync-tracker/scripts/sync-plan.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/sync-plan.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flattenBacklog, engLabel, buildSyncPlan, applyResults, validateReadyForSync
} from '../skills/sync-tracker/scripts/sync-plan.mjs';

function backlog() {
  return {
    epics: [{
      id: 'epic-calendar', trackerKey: null, phase: 'MVP', type: 'feature', title: 'Calendar',
      stories: [{
        id: 'story-day', trackerKey: null, title: 'Day view',
        acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
        definitionOfDone: ['code'],
        tasks: [{ id: 'task-be', trackerKey: null, category: 'backend', subtasks: [{ id: 'sub-1', title: 'wire endpoint' }] }]
      }]
    }]
  };
}

test('engLabel: stable eng-id label', () => {
  assert.equal(engLabel('epic-calendar'), 'eng-id:epic-calendar');
});

test('flattenBacklog: parent-first order epic->story->task->subtask', () => {
  const nodes = flattenBacklog(backlog());
  assert.deepEqual(nodes.map(n => n.kind), ['epic', 'story', 'task', 'subtask']);
  assert.equal(nodes[1].parentEngId, 'epic-calendar');
  assert.equal(nodes[2].parentEngId, 'story-day');
  assert.equal(nodes[3].parentEngId, 'task-be');
});

test('buildSyncPlan: fresh backlog is all creates, parent-first', () => {
  const plan = buildSyncPlan(backlog());
  assert.ok(plan.operations.every(o => o.op === 'create'));
  assert.equal(plan.operations[0].kind, 'epic');
  assert.equal(plan.summary.creates, 4);
  assert.equal(plan.summary.updates, 0);
});

test('buildSyncPlan: trackerKey in model => update', () => {
  const b = backlog(); b.epics[0].trackerKey = 'BLOOM-1';
  const plan = buildSyncPlan(b);
  const epicOp = plan.operations.find(o => o.engId === 'epic-calendar');
  assert.equal(epicOp.op, 'update');
  assert.equal(epicOp.trackerKey, 'BLOOM-1');
});

test('buildSyncPlan: engId in existingIndex => update with that key', () => {
  const plan = buildSyncPlan(backlog(), { 'story-day': 'BLOOM-9' });
  const storyOp = plan.operations.find(o => o.engId === 'story-day');
  assert.equal(storyOp.op, 'update');
  assert.equal(storyOp.trackerKey, 'BLOOM-9');
});

test('applyResults: writes trackerKey back into nested model', () => {
  const b = backlog();
  applyResults(b, { 'epic-calendar': 'BLOOM-1', 'task-be': 'BLOOM-3', 'sub-1': 'BLOOM-4' });
  assert.equal(b.epics[0].trackerKey, 'BLOOM-1');
  assert.equal(b.epics[0].stories[0].tasks[0].trackerKey, 'BLOOM-3');
  assert.equal(b.epics[0].stories[0].tasks[0].subtasks[0].trackerKey, 'BLOOM-4');
});

test('validateReadyForSync: jira + ready + mcp + key => no errors', () => {
  const cfg = { provider: 'jira', providerStatus: 'ready', mcp: { available: true }, project: { key: 'BLOOM' } };
  assert.deepEqual(validateReadyForSync(cfg), []);
});

test('validateReadyForSync: incomplete config is blocked', () => {
  const cfg = { provider: 'jira', providerStatus: 'incomplete', mcp: { available: false }, project: { key: null } };
  const errs = validateReadyForSync(cfg);
  assert.ok(errs.length >= 1);
  assert.ok(errs.some(e => /ready|mcp|project/i.test(e)));
});

test('validateReadyForSync: non-jira provider is blocked', () => {
  const cfg = { provider: 'linear', providerStatus: 'stub', mcp: { available: false }, project: { key: null } };
  assert.ok(validateReadyForSync(cfg).some(e => /jira|sync-ready/i.test(e)));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/sync-plan.test.mjs`
Expected: FAIL — `Cannot find module '.../sync-plan.mjs'`.

- [ ] **Step 3: Implement `sync-plan.mjs`**

Create `skills/sync-tracker/scripts/sync-plan.mjs`:

```js
// Zero-dependency reconciliation planner for pushing the backlog to a tracker.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function engLabel(engId) {
  return `eng-id:${engId}`;
}

// Flatten backlog into a parent-first list of nodes.
export function flattenBacklog(backlog) {
  const nodes = [];
  for (const epic of backlog?.epics || []) {
    nodes.push({ kind: 'epic', engId: epic.id, parentEngId: null, trackerKey: epic.trackerKey || null, title: epic.title, type: epic.type, phase: epic.phase });
    for (const story of epic.stories || []) {
      nodes.push({ kind: 'story', engId: story.id, parentEngId: epic.id, trackerKey: story.trackerKey || null, title: story.title });
      for (const task of story.tasks || []) {
        nodes.push({ kind: 'task', engId: task.id, parentEngId: story.id, trackerKey: task.trackerKey || null, title: task.title || task.category, category: task.category });
        for (const sub of task.subtasks || []) {
          nodes.push({ kind: 'subtask', engId: sub.id, parentEngId: task.id, trackerKey: sub.trackerKey || null, title: sub.title });
        }
      }
    }
  }
  return nodes;
}

// existingIndex: { engId: trackerKey } discovered via searchByExternalRef.
export function buildSyncPlan(backlog, existingIndex = {}) {
  const operations = [];
  const summary = { creates: 0, updates: 0, byKind: {} };
  for (const node of flattenBacklog(backlog)) {
    const trackerKey = node.trackerKey || existingIndex[node.engId] || null;
    const op = trackerKey ? 'update' : 'create';
    operations.push({ op, kind: node.kind, engId: node.engId, parentEngId: node.parentEngId, trackerKey, title: node.title });
    summary[op === 'create' ? 'creates' : 'updates']++;
    summary.byKind[node.kind] = (summary.byKind[node.kind] || 0) + 1;
  }
  return { operations, summary };
}

// resultMap: { engId: trackerKey } from create/update calls. Mutates + returns the backlog.
export function applyResults(backlog, resultMap) {
  for (const epic of backlog?.epics || []) {
    if (resultMap[epic.id]) epic.trackerKey = resultMap[epic.id];
    for (const story of epic.stories || []) {
      if (resultMap[story.id]) story.trackerKey = resultMap[story.id];
      for (const task of story.tasks || []) {
        if (resultMap[task.id]) task.trackerKey = resultMap[task.id];
        for (const sub of task.subtasks || []) {
          if (resultMap[sub.id]) sub.trackerKey = resultMap[sub.id];
        }
      }
    }
  }
  return backlog;
}

export function validateReadyForSync(config) {
  const errors = [];
  if (!config || config.provider !== 'jira') {
    errors.push('sync-tracker is Jira-only in this version (config.provider must be "jira"; other providers are not sync-ready)');
    return errors;
  }
  if (config.providerStatus !== 'ready') errors.push(`config.providerStatus must be "ready" (currently "${config.providerStatus}") — run /eng:setup-toolkit`);
  if (!config.mcp || !config.mcp.available) errors.push('Jira mcp.available must be true — connect the MCP and restart, then re-run setup');
  if (!config.project || !config.project.key) errors.push('config.project.key must be set — verify the project in setup');
  return errors;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, file] = process.argv;
  try {
    if (cmd === 'plan') {
      const model = JSON.parse(readFileSync(file, 'utf8'));
      console.log(JSON.stringify(buildSyncPlan(model.backlog || { epics: [] }), null, 2));
    } else {
      console.error('usage: sync-plan.mjs plan <model.json>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sync-plan.test.mjs`
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/sync-tracker/scripts/sync-plan.mjs tests/sync-plan.test.mjs
git commit -m "feat(sync): sync-plan.mjs reconciliation planner (TDD)"
```

---

## Task 2: `sync-tracker` SKILL.md

**Files:**
- Create: `skills/sync-tracker/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
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
- **sync** — perform the writes, but only after showing the diff and getting a
  typed/explicit **confirmation**.

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
     Sub-task/Bug per the adapter), set `summary`=title, fold acceptance criteria
     and Definition of Done into the description, set the parent link using the
     parent's freshly created `trackerKey`, add the `phase` label (per
     `config.mappings.phaseField`) and the `eng-id:<engId>` label. Record the new
     issue key.
   - **update**: push the same fields to the existing `trackerKey`.
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
```

- [ ] **Step 2: Verify the frontmatter**

Run:
```bash
node -e 'const t=require("fs").readFileSync("skills/sync-tracker/SKILL.md","utf8"); const ok=t.startsWith("---")&&/\nname:\s*sync-tracker/.test(t)&&/\ndescription:\s*\|/.test(t); console.log("frontmatter ok:",ok); process.exit(ok?0:1)'
```
Expected: `frontmatter ok: true`.

- [ ] **Step 3: End-to-end plan smoke test**

Run:
```bash
TMP="$(mktemp -d)/m.json"; printf '%s' '{"schemaVersion":"1.0","knowledgeModel":{"domains":[]},"planningModel":{"phases":[],"items":[]},"backlog":{"epics":[{"id":"epic-calendar","trackerKey":null,"phase":"MVP","type":"feature","title":"Calendar","stories":[{"id":"story-day","trackerKey":"BLOOM-9","title":"Day view","acceptanceCriteria":[{"given":"g","when":"w","then":"t"}],"definitionOfDone":["code"],"tasks":[{"id":"task-be","trackerKey":null,"category":"backend","subtasks":[]}]}]}]}}' > "$TMP"; node skills/sync-tracker/scripts/sync-plan.mjs plan "$TMP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log("ops:",p.operations.map(o=>o.op+":"+o.kind+":"+(o.trackerKey||"new")).join(" | "));console.log("summary:",JSON.stringify(p.summary))})'
```
Expected:
```
ops: create:epic:new | update:story:BLOOM-9 | create:task:new
summary: {"creates":2,"updates":1,"byKind":{"epic":1,"story":1,"task":1}}
```

- [ ] **Step 4: Commit**

```bash
git add skills/sync-tracker/SKILL.md
git commit -m "feat: sync-tracker skill (plan -> preview -> confirm -> write, dry-run default)"
```

---

## Task 3: Docs, version bump, validate, release

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Add `sync-tracker` to the README skills table** (directly under the `build-project-model` row):

```markdown
| `/eng:sync-tracker` | Push the backlog to Jira (dry-run default; confirm before write) |
```

- [ ] **Step 2: Bump version** in `.claude-plugin/plugin.json` from `"0.6.0"` to `"0.7.0"`.

- [ ] **Step 3: Add CHANGELOG entry** directly under `## [Unreleased]`:

```markdown

## [0.7.0] - 2026-07-01

### Added
- `sync-tracker` skill (`/eng:sync-tracker`) — projects the backlog to Jira via
  the adapter with a deterministic `sync-plan.mjs` reconciliation planner
  (parent-first create/update, `eng-id:<id>` labels for idempotent re-sync).
  Modes: report, dry-run (default), sync, validate. `sync` always previews the
  diff and requires confirmation before writing.
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test`
Expected: all tests PASS (sync-plan suite added).

- [ ] **Step 5: Validate the plugin**

Run: `claude plugin validate . --strict`
Expected: passes.

- [ ] **Step 6: Commit and tag**

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "chore: release 0.7.0 (sync-tracker)"
git tag v0.7.0
```

---

## Self-Review (completed during planning)

- **Spec coverage:** implements §3.3 (sync step), §4.2 (`trackerKey` create-vs-update),
  §6 (`searchByExternalRef` via `eng-id` label; parent-first create; field/label
  mapping in prose), §8.5 (modes report/dry-run/sync/validate; **always preview +
  confirm before write**; Jira-only guard). Reconciliation is idempotent via the
  `eng-id:<id>` label.
- **Placeholder scan:** no TBD/TODO in code; the plan smoke test asserts exact output.
- **Type/name consistency:** `flattenBacklog`, `engLabel`, `buildSyncPlan`,
  `applyResults`, `validateReadyForSync`, operation shape `{op,kind,engId,parentEngId,trackerKey,title}`,
  and node kinds `epic/story/task/subtask` are identical across script, tests, and SKILL.
- **Out of scope (later):** deep per-field diffing of existing issues (v1 treats a
  keyed node as an update that re-pushes fields); scoped sub-modes
  (roadmap/bugs/architecture/codereview); non-Jira adapters. `detect-changes` is the
  next plan.
```
