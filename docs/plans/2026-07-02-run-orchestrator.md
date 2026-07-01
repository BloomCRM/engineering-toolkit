# run (orchestrator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/eng:run` — a guided, approval-driven orchestrator that walks the pipeline (setup → analyze → build → sync) one step at a time, computing where the project currently is, recommending the next step, and pausing for the user's approval between every stage. It never chains blindly and never writes to the tracker without an explicit second confirmation.

**Architecture:** The deterministic, testable core is `pipeline.mjs` — a pure state function that inspects the presence of config / Knowledge Model / backlog / synced issues and returns the current state plus the single recommended `nextStep`. The SKILL is thin orchestration prose: read state → tell the user where they are → ask approval → invoke exactly one underlying skill → recompute → repeat. Re-running `/eng:run` resumes from the current state.

**Tech Stack:** Claude Code plugin (skill), Node.js ≥18 (`node:test`), existing `store.mjs`; invokes the existing `setup-toolkit` / `analyze-project` / `build-project-model` / `sync-tracker` / `detect-changes` skills.

**Reference:** Design spec `docs/specs/2026-06-30-engineering-toolkit-design.md` — §3 pipeline, §8 (each skill's responsibility). This skill sequences them; it adds no new domain logic.

**Pattern to follow:** `skills/detect-changes/scripts/change-plan.mjs` for script/test style.

---

## File Structure

| File | Responsibility |
|---|---|
| `skills/run/scripts/pipeline.mjs` | `configReady`, `hasKnowledgeModel`, `hasBacklog`, `hasSyncedAny`, `pipelineState`, CLI `state` |
| `skills/run/SKILL.md` | Orchestration: state → approve → one step → recompute → repeat |
| `tests/pipeline.test.mjs` | `node:test` coverage of the state machine |

**Locked contract — `pipelineState(config, model)` returns:**
```json
{
  "hasConfig": true, "configReady": false,
  "hasKnowledgeModel": true, "hasBacklog": false, "hasSyncedAny": false,
  "nextStep": "build",
  "reason": "Knowledge Model exists but no backlog — build it."
}
```
`nextStep` is one of: `setup`, `analyze`, `build`, `sync`, `review-drift`.

**Step decision (presence-based, in order):**
1. no config → `setup`
2. config present, no Knowledge Model → `analyze`
3. Knowledge Model present, no backlog → `build`
4. backlog present, nothing synced → `sync`
5. backlog present, something synced → `review-drift`

`analyze`/`build` proceed even when the config is `incomplete` (offline). `sync` readiness (`configReady`) is enforced by `sync-tracker` itself, not here.

---

## Task 1: `pipeline.mjs` core — TDD

**Files:**
- Create: `tests/pipeline.test.mjs`
- Create: `skills/run/scripts/pipeline.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/pipeline.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pipelineState, configReady, hasSyncedAny } from '../skills/run/scripts/pipeline.mjs';

const readyConfig = { provider: 'jira', providerStatus: 'ready', mcp: { available: true }, project: { key: 'BLOOM' } };
const incompleteConfig = { provider: 'jira', providerStatus: 'incomplete', mcp: { available: false }, project: { key: null } };
const emptyKM = { knowledgeModel: { domains: [] }, backlog: { epics: [] } };
const withKM = { knowledgeModel: { domains: [{ id: 'calendar', name: 'Calendar' }] }, backlog: { epics: [] } };
function withBacklog(trackerKey = null) {
  return {
    knowledgeModel: { domains: [{ id: 'calendar', name: 'Calendar' }] },
    backlog: { epics: [{ id: 'epic-cal', type: 'feature', title: 'Calendar', trackerKey, stories: [{ id: 's1', trackerKey: null, tasks: [] }] }] }
  };
}

test('configReady: ready jira config is ready', () => {
  assert.equal(configReady(readyConfig), true);
  assert.equal(configReady(incompleteConfig), false);
  assert.equal(configReady(null), false);
});

test('nextStep: no config => setup', () => {
  assert.equal(pipelineState(null, emptyKM).nextStep, 'setup');
});

test('nextStep: config but empty Knowledge Model => analyze', () => {
  assert.equal(pipelineState(incompleteConfig, emptyKM).nextStep, 'analyze');
});

test('nextStep: Knowledge Model but no backlog => build', () => {
  assert.equal(pipelineState(incompleteConfig, withKM).nextStep, 'build');
});

test('nextStep: backlog but nothing synced => sync', () => {
  const s = pipelineState(readyConfig, withBacklog(null));
  assert.equal(s.nextStep, 'sync');
  assert.equal(s.hasSyncedAny, false);
});

test('nextStep: something synced => review-drift', () => {
  assert.equal(pipelineState(readyConfig, withBacklog('BLOOM-1')).nextStep, 'review-drift');
});

test('hasSyncedAny: detects a nested trackerKey on a story', () => {
  const model = { backlog: { epics: [{ id: 'e', trackerKey: null, stories: [{ id: 's', trackerKey: 'BLOOM-9', tasks: [] }] }] } };
  assert.equal(hasSyncedAny(model), true);
});

test('pipelineState: flags mirror the model', () => {
  const s = pipelineState(readyConfig, withBacklog(null));
  assert.deepEqual(
    { c: s.hasConfig, r: s.configReady, km: s.hasKnowledgeModel, b: s.hasBacklog },
    { c: true, r: true, km: true, b: true }
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/pipeline.test.mjs`
Expected: FAIL — `Cannot find module '.../pipeline.mjs'`.

- [ ] **Step 3: Implement `pipeline.mjs`**

Create `skills/run/scripts/pipeline.mjs`:

```js
// Zero-dependency pipeline state machine for the /eng:run orchestrator.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function configReady(config) {
  return !!config && config.provider === 'jira' && config.providerStatus === 'ready'
    && !!(config.mcp && config.mcp.available) && !!(config.project && config.project.key);
}

export function hasKnowledgeModel(model) {
  return Array.isArray(model?.knowledgeModel?.domains) && model.knowledgeModel.domains.length > 0;
}

export function hasBacklog(model) {
  return Array.isArray(model?.backlog?.epics) && model.backlog.epics.length > 0;
}

export function hasSyncedAny(model) {
  for (const epic of model?.backlog?.epics || []) {
    if (epic.trackerKey) return true;
    for (const story of epic.stories || []) {
      if (story.trackerKey) return true;
      for (const task of story.tasks || []) {
        if (task.trackerKey) return true;
        for (const sub of task.subtasks || []) if (sub.trackerKey) return true;
      }
    }
  }
  return false;
}

export function pipelineState(config, model) {
  const state = {
    hasConfig: !!config,
    configReady: configReady(config),
    hasKnowledgeModel: hasKnowledgeModel(model),
    hasBacklog: hasBacklog(model),
    hasSyncedAny: hasSyncedAny(model),
    nextStep: null,
    reason: ''
  };
  if (!state.hasConfig) {
    state.nextStep = 'setup';
    state.reason = 'No .eng/config.json — run setup-toolkit first.';
  } else if (!state.hasKnowledgeModel) {
    state.nextStep = 'analyze';
    state.reason = 'No Knowledge Model yet — analyze the project.';
  } else if (!state.hasBacklog) {
    state.nextStep = 'build';
    state.reason = 'Knowledge Model exists but no backlog — build it.';
  } else if (!state.hasSyncedAny) {
    state.nextStep = 'sync';
    state.reason = 'Backlog exists but nothing is synced — dry-run then sync (with approval).';
  } else {
    state.nextStep = 'review-drift';
    state.reason = 'Everything is synced — run detect-changes to see if anything is stale.';
  }
  return state;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, configFile, modelFile] = process.argv;
  try {
    if (cmd === 'state') {
      const config = configFile && existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : null;
      const model = modelFile && existsSync(modelFile) ? JSON.parse(readFileSync(modelFile, 'utf8')) : null;
      console.log(JSON.stringify(pipelineState(config, model), null, 2));
    } else {
      console.error('usage: pipeline.mjs state <config.json> <model.json>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/pipeline.test.mjs`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/run/scripts/pipeline.mjs tests/pipeline.test.mjs
git commit -m "feat(run): pipeline.mjs state machine (next-step logic) TDD"
```

---

## Task 2: `run` SKILL.md

**Files:**
- Create: `skills/run/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: run
description: |
  Guided, approval-driven orchestrator for the eng pipeline. Walks
  setup -> analyze -> build -> sync ONE step at a time, pausing for your approval
  between every stage. Resumes from wherever the project currently is.
when_to_use: |
  Trigger on "run the pipeline", "run eng", "start the backlog flow", "/eng:run",
  "do the whole thing", or when the user wants a guided first run without
  invoking each skill by hand.
allowed-tools: Bash(node *)
---

# run

A guided orchestrator. It runs the pipeline **one step per approval** — never a
blind chain, and never a tracker write without an explicit second confirmation.
Re-run it anytime; it resumes from the current state.

Resolve paths once:
- `PIPE="${CLAUDE_PLUGIN_ROOT}/skills/run/scripts/pipeline.mjs"`
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`

## The loop

Repeat until the user stops:

1. **Ensure the store exists.** If `.eng/project-model.json` is missing, run
   `node "$STORE" init`.

2. **Compute state.** Run
   `node "$PIPE" state .eng/config.json .eng/project-model.json`. It returns the
   presence flags and a single `nextStep` (`setup` / `analyze` / `build` / `sync`
   / `review-drift`) with a reason.

3. **Orient the user.** Say plainly where they are (config? model? backlog?
   synced?) and what the recommended `nextStep` is and why.

4. **Ask approval — one step only.** Offer: run this step · skip it · stop here.
   Do not proceed without a yes. If they stop, end cleanly (state is saved).

5. **Run exactly one step** (on approval), by invoking the matching skill:
   - `setup` → `/eng:setup-toolkit`
   - `analyze` → `/eng:analyze-project`, then summarize the Knowledge Model
     (domain count, top risks) so they can review before building.
   - `build` → `/eng:build-project-model`, then summarize the backlog
     (epics/stories/tasks, bugs, tech-debt) so they can review before syncing.
   - `sync` → **two gates.** First `/eng:sync-tracker` in **dry-run** and show the
     plan. Then ask a SEPARATE explicit question: "apply these changes to Jira?"
     Only on an explicit yes, run `/eng:sync-tracker sync`. If the config is not
     `ready`, say sync is blocked and point to finishing `/eng:setup-toolkit`
     (the offline steps are already done).
   - `review-drift` → `/eng:detect-changes`; if entries are stale, offer to re-run
     `analyze` (incrementally); if nothing is stale, report the project is in sync
     and stop.

6. **Recompute and propose the next step** (back to 2). Never batch several steps
   behind one approval.

## Rules

- One step per approval. Recompute state after every step.
- The tracker write (`sync`) always needs its own dry-run + a second explicit yes.
- The human running this approves every stage — that is the point; do not
  optimize the approvals away.
- Fully resumable: re-running `/eng:run` continues from the current state.
- This skill adds no domain logic — it only sequences the other skills.
```

- [ ] **Step 2: Verify the frontmatter**

Run:
```bash
node -e 'const t=require("fs").readFileSync("skills/run/SKILL.md","utf8"); const ok=t.startsWith("---")&&/\nname:\s*run/.test(t)&&/\ndescription:\s*\|/.test(t); console.log("frontmatter ok:",ok); process.exit(ok?0:1)'
```
Expected: `frontmatter ok: true`.

- [ ] **Step 3: End-to-end state smoke test**

Run:
```bash
D="$(mktemp -d)"; printf '%s' '{"provider":"jira","providerStatus":"incomplete","mcp":{"available":false},"project":{"key":null}}' > "$D/config.json"; printf '%s' '{"knowledgeModel":{"domains":[{"id":"calendar","name":"Calendar"}]},"backlog":{"epics":[]}}' > "$D/model.json"; node skills/run/scripts/pipeline.mjs state "$D/config.json" "$D/model.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const st=JSON.parse(s);console.log("nextStep:",st.nextStep,"| hasKM:",st.hasKnowledgeModel,"| hasBacklog:",st.hasBacklog)})'
```
Expected:
```
nextStep: build | hasKM: true | hasBacklog: false
```

- [ ] **Step 4: Commit**

```bash
git add skills/run/SKILL.md
git commit -m "feat: run orchestrator skill (approval-gated pipeline, resumable)"
```

---

## Task 3: Docs, version bump, validate, release

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Add `run` to the README skills table** (as the first row — it is the entry point):

```markdown
| `/eng:run` | Guided, approval-gated pipeline (setup -> analyze -> build -> sync) |
```
Insert directly under the header row, above `/eng:analyze-project`.

- [ ] **Step 2: Bump version** in `.claude-plugin/plugin.json` from `"0.8.0"` to `"0.9.0"`.

- [ ] **Step 3: Add CHANGELOG entry** directly under `## [Unreleased]`:

```markdown

## [0.9.0] - 2026-07-02

### Added
- `run` skill (`/eng:run`) — a guided, approval-driven orchestrator that walks
  the pipeline one step at a time, computing the next step from the project's
  current state and pausing for approval between every stage. The tracker write
  keeps its own dry-run + explicit confirmation. Resumable. Deterministic state
  machine in `pipeline.mjs`.
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test`
Expected: all tests PASS (pipeline suite added).

- [ ] **Step 5: Validate the plugin**

Run: `claude plugin validate . --strict`
Expected: passes.

- [ ] **Step 6: Commit and tag**

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "chore: release 0.9.0 (run orchestrator)"
git tag v0.9.0
```

---

## Self-Review (completed during planning)

- **Spec coverage:** sequences the existing §8 skills into the §3 pipeline. Adds
  no domain logic; the approval gates and the "first-run vs incremental"
  distinction (via `review-drift` → detect-changes) are the value. The tracker
  write keeps `sync-tracker`'s own dry-run + confirmation, so the safety model is
  preserved.
- **Placeholder scan:** no TBD/TODO in code; the state smoke test asserts exact output.
- **Type/name consistency:** `configReady`, `hasKnowledgeModel`, `hasBacklog`,
  `hasSyncedAny`, `pipelineState`, and the `nextStep` values
  (`setup/analyze/build/sync/review-drift`) are identical across script, tests,
  and SKILL. `hasSyncedAny` walks the same epic→story→task→subtask shape as
  `sync-plan.mjs`.
- **Out of scope:** auto-approving anything; parallelizing steps; a non-interactive
  "run everything" mode (deliberately excluded — approval is the point).
```
