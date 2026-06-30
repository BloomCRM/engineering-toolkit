# build-project-model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/eng:build-project-model` — turn the Knowledge Model into a Planning Model + backlog (Phase → Epic → Story → Task → Subtask, with acceptance criteria and Definition of Done, dedicated Tech-Debt and Bug epics), enforcing structural invariants deterministically.

**Architecture:** Reuse the existing reviewer agents (no new agent files) to draft the backlog and classify items; the deterministic, testable core is `planning-model.mjs`, which post-processes whatever the agents produce so the result always satisfies the platform's invariants — it guarantees the two dedicated epics exist, applies the default Definition of Done, and builds `planningModel.items` from the Knowledge Model. Persistence and final validation reuse the existing `store.mjs`.

**Tech Stack:** Claude Code plugin (skill), Node.js ≥18 (`node:test`), existing `store.mjs` (imports `DEFAULT_DOD` and `validateModel` from it — DRY, no drift).

**Reference:** Design spec `docs/specs/2026-06-30-engineering-toolkit-design.md` — §3.1 (build step), §4.2 (`planningModel` + `backlog` shapes), §4.3 task categories, §4.4 DoD, §5 hierarchy/phases/dedicated epics, §8.4 build-project-model.

**Pattern to follow:** `skills/analyze-project/scripts/knowledge-model.mjs` + its tests for script/test style; `skills/analyze-project/SKILL.md` for orchestration style.

---

## File Structure

| File | Responsibility |
|---|---|
| `skills/build-project-model/scripts/planning-model.mjs` | `PHASES`, `ensureDedicatedEpics`, `applyDefaultDoD`, `buildPlanningItems`, `normalizeModel`, CLI `normalize` |
| `skills/build-project-model/SKILL.md` | Orchestration: read Knowledge Model → agents draft backlog + classification → normalize → write store → validate |
| `tests/planning-model.test.mjs` | `node:test` coverage incl. an end-to-end "normalized model passes store validation" check |

**Constants locked for this plan:**
- `PHASES = ['MVP', 'Production Ready', 'Public Release', 'Scaling', 'Enterprise', 'AI']`
- `TECH_DEBT_EPIC_ID = 'epic-tech-debt'` (type `techdebt`, title `Technical Debt`)
- `BUG_EPIC_ID = 'epic-bugs'` (type `bug`, title `Bug Fixes`)
- Default Definition of Done is **imported** from `store.mjs` (`DEFAULT_DOD`), not redefined.

**`normalizeModel(model, { decisions })` guarantees (the testable contract):**
1. `backlog.epics` contains a dedicated `techdebt` epic and a dedicated `bug` epic (created empty if absent; never duplicated).
2. Every story has a non-empty `definitionOfDone` (default applied when missing).
3. `planningModel = { phases: PHASES, items }`, where `items` is derived from the Knowledge Model (one per domain + one per tech-debt entry), honoring per-domain `decisions` (`phase`, `priority`) when provided.
4. The returned model passes `store.mjs` `validateModel` (given the agent-drafted stories already carry valid acceptance criteria and task categories).

---

## Task 1: `planning-model.mjs` core — TDD

**Files:**
- Create: `tests/planning-model.test.mjs`
- Create: `skills/build-project-model/scripts/planning-model.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/planning-model.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, ensureDedicatedEpics, applyDefaultDoD, buildPlanningItems, normalizeModel,
  TECH_DEBT_EPIC_ID, BUG_EPIC_ID
} from '../skills/build-project-model/scripts/planning-model.mjs';
import { validateModel, DEFAULT_DOD } from '../skills/knowledge-store/scripts/store.mjs';

function featureEpic() {
  return {
    id: 'epic-calendar', trackerKey: null, phase: 'MVP', type: 'feature', title: 'Calendar',
    stories: [{
      id: 'story-day', trackerKey: null, title: 'Day view',
      acceptanceCriteria: [{ given: 'g', when: 'w', then: 't' }],
      definitionOfDone: [],
      tasks: [{ id: 'task-be', trackerKey: null, category: 'backend', subtasks: [] }]
    }]
  };
}

test('ensureDedicatedEpics: adds tech-debt and bug epics when missing', () => {
  const epics = ensureDedicatedEpics([featureEpic()]);
  assert.ok(epics.some(e => e.id === TECH_DEBT_EPIC_ID && e.type === 'techdebt'));
  assert.ok(epics.some(e => e.id === BUG_EPIC_ID && e.type === 'bug'));
  assert.equal(epics.length, 3);
});

test('ensureDedicatedEpics: does not duplicate existing dedicated epics', () => {
  const td = { id: 'x', phase: 'MVP', type: 'techdebt', title: 'Debt', stories: [] };
  const bug = { id: 'y', phase: 'MVP', type: 'bug', title: 'Bugs', stories: [] };
  const epics = ensureDedicatedEpics([td, bug]);
  assert.equal(epics.filter(e => e.type === 'techdebt').length, 1);
  assert.equal(epics.filter(e => e.type === 'bug').length, 1);
});

test('applyDefaultDoD: fills empty Definition of Done', () => {
  const epics = applyDefaultDoD([featureEpic()]);
  assert.deepEqual(epics[0].stories[0].definitionOfDone, DEFAULT_DOD);
});

test('applyDefaultDoD: leaves a non-empty Definition of Done untouched', () => {
  const e = featureEpic(); e.stories[0].definitionOfDone = ['code'];
  applyDefaultDoD([e]);
  assert.deepEqual(e.stories[0].definitionOfDone, ['code']);
});

test('buildPlanningItems: one item per domain honoring decisions', () => {
  const km = { domains: [{ id: 'calendar', name: 'Calendar', status: 'partial' }], techDebt: [] };
  const items = buildPlanningItems(km, { calendar: { phase: 'Scaling', priority: 'high' } });
  assert.equal(items.length, 1);
  assert.equal(items[0].ref, 'calendar');
  assert.equal(items[0].phase, 'Scaling');
  assert.equal(items[0].priority, 'high');
  assert.equal(items[0].roadmapStatus, 'partial');
});

test('buildPlanningItems: defaults unknown phase to MVP and adds tech-debt items', () => {
  const km = { domains: [{ id: 'd', name: 'D', status: 'planned' }], techDebt: [{ id: 'td1', severity: 'high' }] };
  const items = buildPlanningItems(km, { d: { phase: 'Nonsense' } });
  assert.equal(items.find(i => i.ref === 'd').phase, 'MVP');
  assert.ok(items.some(i => i.ref === 'td1' && i.type === 'techdebt'));
});

test('normalizeModel: produces a model that passes store validation', () => {
  const model = {
    schemaVersion: '1.0',
    knowledgeModel: { domains: [{ id: 'calendar', name: 'Calendar', status: 'partial' }], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] },
    planningModel: { phases: [], items: [] },
    backlog: { epics: [featureEpic()] }
  };
  const n = normalizeModel(model);
  assert.deepEqual(validateModel(n), []);
  assert.deepEqual(n.planningModel.phases, PHASES);
  assert.ok(n.backlog.epics.some(e => e.type === 'techdebt'));
  assert.ok(n.backlog.epics.some(e => e.type === 'bug'));
  assert.deepEqual(n.backlog.epics.find(e => e.id === 'epic-calendar').stories[0].definitionOfDone, DEFAULT_DOD);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/planning-model.test.mjs`
Expected: FAIL — `Cannot find module '.../planning-model.mjs'`.

- [ ] **Step 3: Implement `planning-model.mjs`**

Create `skills/build-project-model/scripts/planning-model.mjs`:

```js
// Zero-dependency planning-model + backlog normalization for project-model.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_DOD, validateModel } from '../../knowledge-store/scripts/store.mjs';

export const PHASES = ['MVP', 'Production Ready', 'Public Release', 'Scaling', 'Enterprise', 'AI'];
export const TECH_DEBT_EPIC_ID = 'epic-tech-debt';
export const BUG_EPIC_ID = 'epic-bugs';

export function ensureDedicatedEpics(epics) {
  const out = Array.isArray(epics) ? [...epics] : [];
  if (!out.some(e => e && e.type === 'techdebt')) {
    out.push({ id: TECH_DEBT_EPIC_ID, trackerKey: null, phase: 'MVP', type: 'techdebt', title: 'Technical Debt', stories: [] });
  }
  if (!out.some(e => e && e.type === 'bug')) {
    out.push({ id: BUG_EPIC_ID, trackerKey: null, phase: 'MVP', type: 'bug', title: 'Bug Fixes', stories: [] });
  }
  return out;
}

export function applyDefaultDoD(epics) {
  for (const epic of epics || []) {
    for (const story of epic.stories || []) {
      if (!Array.isArray(story.definitionOfDone) || story.definitionOfDone.length === 0) {
        story.definitionOfDone = [...DEFAULT_DOD];
      }
    }
  }
  return epics;
}

export function buildPlanningItems(knowledgeModel, decisions = {}) {
  const items = [];
  for (const d of knowledgeModel?.domains || []) {
    const dec = decisions[d.id] || {};
    items.push({
      ref: d.id,
      phase: PHASES.includes(dec.phase) ? dec.phase : 'MVP',
      type: 'feature',
      roadmapStatus: d.status || 'unknown',
      priority: dec.priority || 'medium'
    });
  }
  for (const td of knowledgeModel?.techDebt || []) {
    items.push({ ref: td.id, phase: 'MVP', type: 'techdebt', roadmapStatus: 'planned', priority: td.severity || 'medium' });
  }
  return items;
}

export function normalizeModel(model, { decisions = {} } = {}) {
  const m = { ...model };
  m.backlog = m.backlog && Array.isArray(m.backlog.epics) ? m.backlog : { epics: [] };
  m.backlog.epics = applyDefaultDoD(ensureDedicatedEpics(m.backlog.epics));
  m.planningModel = { phases: PHASES, items: buildPlanningItems(m.knowledgeModel || {}, decisions) };
  return m;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, file] = process.argv;
  try {
    if (cmd === 'normalize') {
      const model = JSON.parse(readFileSync(file, 'utf8'));
      const n = normalizeModel(model);
      const errors = validateModel(n);
      if (errors.length) { console.error('INVALID after normalize:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log(JSON.stringify(n, null, 2));
    } else {
      console.error('usage: planning-model.mjs normalize <model.json>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/planning-model.test.mjs`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/build-project-model/scripts/planning-model.mjs tests/planning-model.test.mjs
git commit -m "feat(build): planning-model.mjs normalize + dedicated epics + DoD (TDD)"
```

---

## Task 2: `build-project-model` SKILL.md

**Files:**
- Create: `skills/build-project-model/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
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

6. **Validate and report.** Run `node "$STORE" validate` (must print `VALID`),
   then `node "$STORE" inspect`. Report epics/stories/tasks counts, items per
   phase, and how many bugs / tech-debt items were captured.

## Rules

- Bugs and tech-debt live in their dedicated epics, never inside feature epics.
- Every story has acceptance criteria (Given/When/Then) and a Definition of Done.
- Never generate giant tasks — split by category.
- Always finish by going through `planning-model.mjs normalize` then
  `store.mjs validate`; do not hand-assemble the final model.
```

- [ ] **Step 2: Verify the frontmatter**

Run:
```bash
node -e 'const t=require("fs").readFileSync("skills/build-project-model/SKILL.md","utf8"); const ok=t.startsWith("---")&&/\nname:\s*build-project-model/.test(t)&&/\ndescription:\s*\|/.test(t); console.log("frontmatter ok:",ok); process.exit(ok?0:1)'
```
Expected: `frontmatter ok: true`.

- [ ] **Step 3: End-to-end normalize smoke test**

Run:
```bash
TMP="$(mktemp -d)/m.json"; printf '%s' '{"schemaVersion":"1.0","knowledgeModel":{"domains":[{"id":"calendar","name":"Calendar","status":"partial"}],"architecture":[],"techDebt":[],"infrastructure":[],"security":[],"risks":[]},"planningModel":{"phases":[],"items":[]},"backlog":{"epics":[{"id":"epic-calendar","trackerKey":null,"phase":"MVP","type":"feature","title":"Calendar","stories":[{"id":"s1","trackerKey":null,"title":"Day view","acceptanceCriteria":[{"given":"g","when":"w","then":"t"}],"definitionOfDone":[],"tasks":[{"id":"t1","trackerKey":null,"category":"backend","subtasks":[]}]}]}]}}' > "$TMP"; node skills/build-project-model/scripts/planning-model.mjs normalize "$TMP" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);console.log("epics:",m.backlog.epics.map(e=>e.type).sort().join(","));console.log("dod:",m.backlog.epics.find(e=>e.id==="epic-calendar").stories[0].definitionOfDone.join(","));console.log("items:",m.planningModel.items.map(i=>i.ref).join(","))})'
```
Expected:
```
epics: bug,feature,techdebt
dod: code,unit,integration,docs,review,ci
items: calendar
```

- [ ] **Step 4: Commit**

```bash
git add skills/build-project-model/SKILL.md
git commit -m "feat: build-project-model skill (classify + draft + normalize backlog)"
```

---

## Task 3: Docs, version bump, validate, release

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Add `build-project-model` to the README skills table** (directly under the `analyze-project` row):

```markdown
| `/eng:build-project-model` | Knowledge Model -> Planning Model + backlog (epics/stories/tasks) |
```

- [ ] **Step 2: Bump version** in `.claude-plugin/plugin.json` from `"0.4.1"` to `"0.5.0"`.

- [ ] **Step 3: Add CHANGELOG entry** directly under `## [Unreleased]`:

```markdown

## [0.5.0] - 2026-07-01

### Added
- `build-project-model` skill (`/eng:build-project-model`) — classifies and
  drafts the backlog with the reviewer agents, then deterministically normalizes
  it via `planning-model.mjs` (guaranteed Tech-Debt and Bug epics, default
  Definition of Done, planning items derived from the Knowledge Model).
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test`
Expected: all tests PASS (planning-model suite added).

- [ ] **Step 5: Validate the plugin**

Run: `claude plugin validate . --strict`
Expected: passes.

- [ ] **Step 6: Commit and tag**

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "chore: release 0.5.0 (build-project-model)"
git tag v0.5.0
```

---

## Self-Review (completed during planning)

- **Spec coverage:** implements §3.1 (build step), §4.2 (`planningModel` +
  `backlog`), §4.3 task categories and §4.4 DoD (default imported from
  `store.mjs`), §5 (Phase→…→Subtask, default phases, dedicated Tech-Debt and Bug
  epics, roadmap-status gating in the SKILL prose), §8.4 (classify → draft →
  normalize → validate; no giant tasks; bugs/debt separated).
- **Placeholder scan:** no TBD/TODO in code; the normalize smoke test asserts
  exact expected output.
- **Type/name consistency:** `PHASES`, `ensureDedicatedEpics`, `applyDefaultDoD`,
  `buildPlanningItems`, `normalizeModel`, `TECH_DEBT_EPIC_ID`, `BUG_EPIC_ID` are
  identical across script, tests, and SKILL. `DEFAULT_DOD` and `validateModel`
  are imported from `store.mjs` (single source of truth — no drift).
- **Out of scope (later plans):** `sync-tracker` (push to Jira), `detect-changes`.
  The generative drafting is agent-driven and exercised live; this plan
  unit-tests the deterministic normalization and the store-validation guarantee.
```
