# analyze-project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/eng:analyze-project` — a multi-agent pass that reads a repo's docs and code, has a panel of stack-agnostic reviewer agents emit structured findings, deterministically merges them into the `knowledgeModel` section of `.eng/project-model.json`, then runs an adversarial final review.

**Architecture:** The deterministic, testable core is `knowledge-model.mjs` (merge agent findings → a `knowledgeModel`, dedup by id, validate). The reasoning is done by 8 subagent definitions in `agents/` (each a distinct lens) that the `analyze-project` SKILL.md dispatches in parallel and which return **JSON findings**; the skill merges them with the script and writes them through the existing `knowledge-store`. Agents inherit the session's tools/MCP (plugin agents cannot bundle their own).

**Tech Stack:** Claude Code plugin (skills + `agents/`), Node.js ≥18 (`node:test`), the existing `store.mjs` for persistence.

**Reference:** Design spec `docs/specs/2026-06-30-engineering-toolkit-design.md` — §3.1 pipeline, §4.2 `knowledgeModel` shape, §7 multi-agent architecture, §8.3 analyze-project.

**Pattern to follow:** mirror `skills/setup-toolkit/scripts/config.mjs` (+ its tests) for the script style; mirror `skills/knowledge-store/SKILL.md` for the thin-skill style.

---

## File Structure

| File | Responsibility |
|---|---|
| `skills/analyze-project/scripts/knowledge-model.mjs` | `emptyKnowledgeModel`, `mergeFindings`, `validateKnowledgeModel`, CLI `merge`/`validate` |
| `skills/analyze-project/SKILL.md` | Orchestration: discover docs → dispatch agent panel → merge → write store → final review |
| `agents/product-owner.md` … `agents/final-reviewer.md` | 8 reviewer subagent definitions |
| `references/findings-schema.md` | The JSON shape every agent must return |
| `tests/knowledge-model.test.mjs` | `node:test` coverage of merge + validation |

**Findings shape (every agent returns exactly this JSON; sections it has nothing for are `[]`):**

```json
{
  "domains":        [{ "id": "calendar", "name": "Calendar", "status": "partial", "dependsOn": ["bookings"], "sources": ["docs/x.md"] }],
  "architecture":   [{ "id": "arch-rls", "note": "RLS not yet enforced", "sources": ["docs/arch.md"] }],
  "techDebt":       [{ "id": "td-1", "title": "No integration tests for sync", "category": "Testing", "severity": "high", "sources": ["docs/code-reviews/x.md"] }],
  "infrastructure": [{ "id": "infra-ci", "note": "GitHub Actions deploy", "sources": ["docs/ops.md"] }],
  "security":       [{ "id": "sec-1", "note": "Secrets via env", "sources": ["docs/ops.md"] }],
  "risks":          [{ "id": "risk-1", "title": "Roadmap contradicts code on X", "kind": "contradiction", "sources": ["a.md", "b.cs"] }]
}
```

**`knowledgeModel` shape (merge output, written into the store):** the six arrays above as top-level keys (`domains`, `architecture`, `techDebt`, `infrastructure`, `security`, `risks`).

**Merge rules (locked):** concatenate the same section across all agents; dedup by `id` (first occurrence wins); when ids collide, **union** the `dependsOn` and `sources` arrays into the kept entry. `risk.kind` ∈ `contradiction | unknown | hotspot`.

---

## Task 1: `knowledge-model.mjs` core — TDD

**Files:**
- Create: `tests/knowledge-model.test.mjs`
- Create: `skills/analyze-project/scripts/knowledge-model.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/knowledge-model.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyKnowledgeModel, mergeFindings, validateKnowledgeModel } from '../skills/analyze-project/scripts/knowledge-model.mjs';

const SECTIONS = ['domains', 'architecture', 'techDebt', 'infrastructure', 'security', 'risks'];

test('emptyKnowledgeModel: all six sections present and empty', () => {
  const km = emptyKnowledgeModel();
  for (const s of SECTIONS) assert.deepEqual(km[s], [], `${s} empty`);
});

test('mergeFindings: concatenates distinct entries across agents', () => {
  const a = { domains: [{ id: 'calendar', name: 'Calendar', dependsOn: [], sources: ['a.md'] }] };
  const b = { domains: [{ id: 'bookings', name: 'Bookings', dependsOn: [], sources: ['b.md'] }] };
  const km = mergeFindings([a, b]);
  assert.deepEqual(km.domains.map(d => d.id), ['bookings', 'calendar']); // sorted by id
});

test('mergeFindings: dedups by id and unions dependsOn + sources', () => {
  const a = { domains: [{ id: 'calendar', name: 'Calendar', dependsOn: ['bookings'], sources: ['a.md'] }] };
  const b = { domains: [{ id: 'calendar', name: 'Calendar', dependsOn: ['masters'], sources: ['b.md'] }] };
  const km = mergeFindings([a, b]);
  assert.equal(km.domains.length, 1);
  assert.deepEqual([...km.domains[0].dependsOn].sort(), ['bookings', 'masters']);
  assert.deepEqual([...km.domains[0].sources].sort(), ['a.md', 'b.md']);
});

test('mergeFindings: tolerates missing sections and nullish agents', () => {
  const km = mergeFindings([null, { risks: [{ id: 'r1', title: 'x', kind: 'unknown', sources: [] }] }, undefined]);
  assert.equal(km.risks.length, 1);
  assert.deepEqual(km.domains, []);
});

test('validateKnowledgeModel: clean model has no errors', () => {
  assert.deepEqual(validateKnowledgeModel(emptyKnowledgeModel()), []);
});

test('validateKnowledgeModel: domain without id is an error', () => {
  const km = emptyKnowledgeModel();
  km.domains.push({ name: 'X' });
  assert.ok(validateKnowledgeModel(km).some(e => e.includes('domain')));
});

test('validateKnowledgeModel: risk with invalid kind is an error', () => {
  const km = emptyKnowledgeModel();
  km.risks.push({ id: 'r', title: 't', kind: 'nonsense', sources: [] });
  assert.ok(validateKnowledgeModel(km).some(e => e.includes('kind')));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/knowledge-model.test.mjs`
Expected: FAIL — `Cannot find module '.../knowledge-model.mjs'`.

- [ ] **Step 3: Implement `knowledge-model.mjs`**

Create `skills/analyze-project/scripts/knowledge-model.mjs`:

```js
// Zero-dependency merge/validation for the knowledgeModel section of project-model.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SECTIONS = ['domains', 'architecture', 'techDebt', 'infrastructure', 'security', 'risks'];
export const RISK_KINDS = ['contradiction', 'unknown', 'hotspot'];

export function emptyKnowledgeModel() {
  return { domains: [], architecture: [], techDebt: [], infrastructure: [], security: [], risks: [] };
}

const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];

export function mergeFindings(agentFindings) {
  const km = emptyKnowledgeModel();
  for (const section of SECTIONS) {
    const byId = new Map();
    for (const finding of agentFindings || []) {
      if (!finding || !Array.isArray(finding[section])) continue;
      for (const entry of finding[section]) {
        if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
        if (!byId.has(entry.id)) {
          byId.set(entry.id, { ...entry, dependsOn: uniq(entry.dependsOn), sources: uniq(entry.sources) });
        } else {
          const kept = byId.get(entry.id);
          kept.dependsOn = uniq([...(kept.dependsOn || []), ...(entry.dependsOn || [])]);
          kept.sources = uniq([...(kept.sources || []), ...(entry.sources || [])]);
        }
      }
    }
    km[section] = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return km;
}

export function validateKnowledgeModel(km) {
  const errors = [];
  if (!km || typeof km !== 'object') return ['knowledgeModel is not an object'];
  for (const section of SECTIONS) {
    if (!Array.isArray(km[section])) { errors.push(`${section} must be an array`); continue; }
    for (const entry of km[section]) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) errors.push(`${section}: entry missing id`);
    }
  }
  for (const d of km.domains || []) if (d && !d.name) errors.push(`domain ${d.id}: missing name`);
  for (const r of km.risks || []) if (r && !RISK_KINDS.includes(r.kind)) errors.push(`risk ${r.id}: invalid kind "${r.kind}"`);
  return errors;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, file] = process.argv;
  try {
    if (cmd === 'merge') {
      const findings = JSON.parse(readFileSync(file, 'utf8')); // array of agent findings
      console.log(JSON.stringify(mergeFindings(findings), null, 2));
    } else if (cmd === 'validate') {
      const km = JSON.parse(readFileSync(file, 'utf8'));
      const errors = validateKnowledgeModel(km);
      if (errors.length) { console.error('INVALID:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log('VALID');
    } else {
      console.error('usage: knowledge-model.mjs <merge <findings.json>|validate <km.json>>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/knowledge-model.test.mjs`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/analyze-project/scripts/knowledge-model.mjs tests/knowledge-model.test.mjs
git commit -m "feat(analyze): knowledge-model.mjs merge + validate (TDD)"
```

---

## Task 2: Findings schema doc

**Files:**
- Create: `references/findings-schema.md`

- [ ] **Step 1: Write the doc**

```markdown
# Agent findings schema

Every reviewer agent in `agents/` returns **only** a single JSON object with
these six arrays (use `[]` for sections you have nothing for). `id` must be a
short stable kebab-case string, unique within your own output.

```json
{
  "domains":        [{ "id": "calendar", "name": "Calendar", "status": "implemented|partial|planned|unknown", "dependsOn": ["bookings"], "sources": ["docs/x.md"] }],
  "architecture":   [{ "id": "arch-rls", "note": "one sentence", "sources": ["docs/arch.md"] }],
  "techDebt":       [{ "id": "td-1", "title": "one sentence", "category": "Architecture|Performance|Reliability|Security|Scalability|Testing|Infrastructure|Coding Standards|Documentation", "severity": "low|medium|high", "sources": ["..."] }],
  "infrastructure": [{ "id": "infra-ci", "note": "one sentence", "sources": ["..."] }],
  "security":       [{ "id": "sec-1", "note": "one sentence", "sources": ["..."] }],
  "risks":          [{ "id": "risk-1", "title": "one sentence", "kind": "contradiction|unknown|hotspot", "sources": ["..."] }]
}
```

Rules for every agent:
- **Do not trust a single document.** Cross-check claims against code and against
  other docs; when a doc and the code disagree, emit a `risk` with
  `kind: "contradiction"`.
- Always cite `sources` (file paths, optionally `#Lnn`).
- Stay in your lane (see your agent file), but you may add `risks` for anything
  that looks wrong.
- Return JSON only — no prose, no code fences.
```

- [ ] **Step 2: Verify it exists and mentions the six sections**

Run: `node -e "const t=require('fs').readFileSync('references/findings-schema.md','utf8'); if(['domains','architecture','techDebt','infrastructure','security','risks'].some(s=>!t.includes(s))) throw new Error('missing section'); console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add references/findings-schema.md
git commit -m "docs: agent findings schema"
```

---

## Task 3: The 8 reviewer agents

**Files:**
- Create: `agents/product-owner.md`, `agents/solution-architect.md`, `agents/senior-engineer.md`, `agents/data-engineer.md`, `agents/qa-lead.md`, `agents/devops-engineer.md`, `agents/technical-writer.md`, `agents/final-reviewer.md`

Each agent shares the same frontmatter tool set and the same "return findings JSON" contract; only the lens differs. Use this exact frontmatter for the seven analysis agents (vary `name`, `description`, and the lens paragraph):

- [ ] **Step 1: Write `agents/product-owner.md`**

```markdown
---
name: product-owner
description: Reviews a repository from a Product Owner lens — business value, MVP boundary, feature completeness, priorities. Returns findings JSON.
tools: Read, Grep, Glob, Bash
---

You are a Product Owner reviewing this repository. Read the docs (roadmap, specs,
README, CLAUDE.md) and cross-check against the code.

Your lens: business value, what is MVP vs later, which features are implemented /
partial / planned, and priority signals. Populate `domains` (with `status`) and
`risks` (e.g. roadmap says done but code missing → `contradiction`).

Return ONLY the findings JSON described in `references/findings-schema.md`. Do not
trust any single document; cite sources. JSON only — no prose.
```

- [ ] **Step 2: Write `agents/solution-architect.md`** (same frontmatter shape; name `solution-architect`)

```markdown
---
name: solution-architect
description: Reviews a repository from a Solution Architect lens — boundaries, dependencies, architectural risk. Returns findings JSON.
tools: Read, Grep, Glob, Bash
---

You are a Solution Architect reviewing this repository. Read architecture docs,
ADRs, and the code structure.

Your lens: module boundaries, dependencies between domains, layering, and
technical risk. Populate `domains.dependsOn`, `architecture`, and `risks`.

Return ONLY the findings JSON described in `references/findings-schema.md`. Do not
trust any single document; cite sources. JSON only — no prose.
```

- [ ] **Step 3: Write `agents/senior-engineer.md`** (name `senior-engineer`)

```markdown
---
name: senior-engineer
description: Reviews a repository from a senior engineer lens — implementation state, refactoring needs, testing. Stack-agnostic (detect the stack). Returns findings JSON.
tools: Read, Grep, Glob, Bash
---

You are a senior engineer reviewing this repository. **Detect the stack from the
repo** (do not assume a language/framework). Read the code and the engineering
docs.

Your lens: what is actually implemented vs stubbed, refactoring needs, and test
coverage gaps. Populate `domains.status`, `techDebt` (category `Testing`,
`Coding Standards`, `Architecture`...), and `risks`.

Return ONLY the findings JSON described in `references/findings-schema.md`. Do not
trust any single document; cite sources. JSON only — no prose.
```

- [ ] **Step 4: Write `agents/data-engineer.md`** (name `data-engineer`)

```markdown
---
name: data-engineer
description: Reviews a repository from a data/database lens — schema, indexes, constraints, migrations, data performance. Returns findings JSON.
tools: Read, Grep, Glob, Bash
---

You are a data engineer reviewing this repository. Find the data model
(migrations, schema, ER docs) and read it.

Your lens: schema correctness, indexes, constraints, migration hygiene, and data
performance. Populate `techDebt` (category `Performance`, `Scalability`,
`Reliability`) and `risks`.

Return ONLY the findings JSON described in `references/findings-schema.md`. Do not
trust any single document; cite sources. JSON only — no prose.
```

- [ ] **Step 5: Write `agents/qa-lead.md`** (name `qa-lead`)

```markdown
---
name: qa-lead
description: Reviews a repository from a QA Lead lens — testability, acceptance criteria, regression risk. Returns findings JSON.
tools: Read, Grep, Glob, Bash
---

You are a QA Lead reviewing this repository. Read specs and tests.

Your lens: are features testable, where are acceptance criteria missing, what are
the regression-prone areas. Populate `techDebt` (category `Testing`) and `risks`
(`hotspot` for fragile areas, `unknown` for untested behavior).

Return ONLY the findings JSON described in `references/findings-schema.md`. Do not
trust any single document; cite sources. JSON only — no prose.
```

- [ ] **Step 6: Write `agents/devops-engineer.md`** (name `devops-engineer`)

```markdown
---
name: devops-engineer
description: Reviews a repository from a DevOps lens — CI/CD, monitoring, infrastructure, deployment, security posture. Returns findings JSON.
tools: Read, Grep, Glob, Bash
---

You are a DevOps engineer reviewing this repository. Read CI config, ops docs,
Dockerfiles, and deployment scripts.

Your lens: CI/CD, monitoring/observability, infrastructure, deployment safety,
and security posture. Populate `infrastructure`, `security`, `techDebt`
(category `Infrastructure`, `Reliability`, `Security`), and `risks`.

Return ONLY the findings JSON described in `references/findings-schema.md`. Do not
trust any single document; cite sources. JSON only — no prose.
```

- [ ] **Step 7: Write `agents/technical-writer.md`** (name `technical-writer`)

```markdown
---
name: technical-writer
description: Reviews a repository's documentation for consistency, duplication, and contradictions. Returns findings JSON.
tools: Read, Grep, Glob, Bash
---

You are a Technical Writer reviewing this repository's documentation.

Your lens: documentation consistency, duplication, and contradictions between
documents (or between a document and the code). Populate `risks` (mostly
`contradiction` and `unknown`) and `techDebt` (category `Documentation`).

Return ONLY the findings JSON described in `references/findings-schema.md`. Do not
trust any single document; cite sources. JSON only — no prose.
```

- [ ] **Step 8: Write `agents/final-reviewer.md`** (different role — reconciler)

```markdown
---
name: final-reviewer
description: Reconciles a merged knowledgeModel — resolves conflicts, finds gaps, validates the hierarchy is coherent before backlog generation. Returns findings JSON (risks only).
tools: Read, Grep, Glob, Bash
---

You are the Final Reviewer. You are given an already-merged `knowledgeModel`
(domains, architecture, techDebt, infrastructure, security, risks).

Your job is adversarial: do NOT assume it is correct. Look for:
- contradictions between entries,
- domains referenced in `dependsOn` that do not exist,
- obvious gaps (a documented area with no domain/techDebt entry),
- duplicates that the id-merge missed (same thing, different ids).

Return ONLY findings JSON with new/clarifying `risks` (kind `contradiction`,
`unknown`, or `hotspot`) and, if needed, corrected `domains`. JSON only — no
prose. These will be merged back into the model.
```

- [ ] **Step 9: Verify all eight agents parse (frontmatter present)**

Run:
```bash
for a in product-owner solution-architect senior-engineer data-engineer qa-lead devops-engineer technical-writer final-reviewer; do \
  node -e "const t=require('fs').readFileSync('agents/$a.md','utf8'); if(!t.startsWith('---')||!new RegExp('name: '+'$a').test(t)) throw new Error('$a frontmatter'); console.log('$a OK')"; \
done
```
Expected: eight `… OK` lines.

- [ ] **Step 10: Commit**

```bash
git add agents/
git commit -m "feat(agents): 8 stack-agnostic reviewer agents (findings JSON contract)"
```

---

## Task 4: `analyze-project` SKILL.md

**Files:**
- Create: `skills/analyze-project/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: analyze-project
description: |
  Analyze this repository with a panel of reviewer agents and build the
  Knowledge Model (domains, architecture, tech-debt, infra, security, risks)
  into .eng/project-model.json. Run after setup; before build-project-model.
when_to_use: |
  Trigger on "analyze the project", "build the knowledge model", "understand
  this repo", "/eng:analyze-project", or when build-project-model reports the
  knowledge model is missing.
allowed-tools: Bash(node *)
---

# analyze-project

Turn the repository into a Knowledge Model — the factual layer of
`.eng/project-model.json`. This skill does not touch a tracker.

Resolve paths once:
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`
- `KM="${CLAUDE_PLUGIN_ROOT}/skills/analyze-project/scripts/knowledge-model.mjs"`
- findings schema: `${CLAUDE_PLUGIN_ROOT}/references/findings-schema.md`

## Steps

1. **Ensure the store exists.** If `.eng/project-model.json` is missing, create it:
   `node "$STORE" init`.

2. **Discover inputs.** Collect the docs to review: `CLAUDE.md`, `README.md`,
   the roadmap, a bugs doc, `docs/`, `docs/architecture/`, `adr/`/ADR files,
   `docs/code-reviews/`, `specs/`. Note the current git commit (for `source`).

3. **Dispatch the agent panel — in parallel.** Spawn these eight subagents using
   the Task tool with the matching agent type, giving each the discovered inputs
   and the findings schema: `product-owner`, `solution-architect`,
   `senior-engineer`, `data-engineer`, `qa-lead`, `devops-engineer`,
   `technical-writer`. (Hold `final-reviewer` for step 5.) Each returns findings
   JSON. If a run is too large, scope agents to a subset of docs, but record what
   was skipped — never silently drop inputs.

4. **Merge deterministically.** Collect the seven JSON outputs into a JSON array,
   write it to a temp file, and run `node "$KM" merge <array.json>` to get the
   merged `knowledgeModel`. Write that object into `.eng/project-model.json`
   under `knowledgeModel`, and set `source.commit`/`branch`/`generatedAt`.

5. **Adversarial final review.** Spawn the `final-reviewer` subagent with the
   merged `knowledgeModel`. Merge its returned findings back in the same way
   (`node "$KM" merge` over `[currentKnowledgeModel, reviewerFindings]`).

6. **Validate and report.** Run `node "$STORE" validate`; it must print `VALID`.
   Summarize: domain count, dependency edges, tech-debt by category, and the top
   risks (contradictions first).

## Rules

- Agents must not trust a single document — contradictions become `risks`.
- The merge is deterministic (the script), not the model's opinion — always go
  through `knowledge-model.mjs`.
- This skill only writes `knowledgeModel` (+ `source`); it never writes the
  backlog (that is `build-project-model`).
```

- [ ] **Step 2: Verify the frontmatter**

Run:
```bash
node -e 'const t=require("fs").readFileSync("skills/analyze-project/SKILL.md","utf8"); const ok=t.startsWith("---")&&/\nname:\s*analyze-project/.test(t)&&/\ndescription:\s*\|/.test(t); console.log("frontmatter ok:",ok); process.exit(ok?0:1)'
```
Expected: `frontmatter ok: true`.

- [ ] **Step 3: End-to-end merge smoke test (no agents, fixture findings)**

Run:
```bash
TMP="$(mktemp -d)"; printf '%s' '[{"domains":[{"id":"calendar","name":"Calendar","status":"partial","dependsOn":["bookings"],"sources":["a.md"]}]},{"domains":[{"id":"calendar","name":"Calendar","dependsOn":["masters"],"sources":["b.md"]}],"risks":[{"id":"r1","title":"x","kind":"contradiction","sources":["a.md"]}]}]' > "$TMP/f.json"; node skills/analyze-project/scripts/knowledge-model.mjs merge "$TMP/f.json"
```
Expected: JSON with one `calendar` domain whose `dependsOn` is `["bookings","masters"]` and one risk `r1`.

- [ ] **Step 4: Commit**

```bash
git add skills/analyze-project/SKILL.md
git commit -m "feat: analyze-project skill (agent panel -> merged Knowledge Model)"
```

---

## Task 5: Docs, version bump, validate, release

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Add `analyze-project` to the README skills table** (top of the list)

```markdown
| `/eng:analyze-project` | Multi-agent analysis of the repo into the Knowledge Model |
```
Insert this row directly under the header row, above `/eng:setup-toolkit`.

- [ ] **Step 2: Bump version** in `.claude-plugin/plugin.json` from `"0.3.0"` to `"0.4.0"`.

- [ ] **Step 3: Add CHANGELOG entry** directly under `## [Unreleased]`:

```markdown

## [0.4.0] - 2026-06-30

### Added
- `analyze-project` skill (`/eng:analyze-project`) and an 8-agent reviewer panel
  in `agents/`, with a deterministic `knowledge-model.mjs` merge into the
  Knowledge Model and an adversarial final review.
- `references/findings-schema.md` — the JSON contract every agent returns.
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test`
Expected: all tests PASS (knowledge-model suite added to the rest).

- [ ] **Step 5: Validate the plugin**

Run: `claude plugin validate . --strict`
Expected: passes (note: 8 agents now appear in the inventory).

- [ ] **Step 6: Commit and tag**

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "chore: release 0.4.0 (analyze-project + reviewer agents)"
git tag v0.4.0
```

---

## Self-Review (completed during planning)

- **Spec coverage:** implements §3.1 (analyze step of the pipeline), §4.2
  (`knowledgeModel` sections), §7 (the eight named agents, stack-agnostic, "do
  not trust the docs", final-reviewer is adversarial and runs last), §8.3
  (discover inputs → panel → merge → write store, only writes `knowledgeModel`).
- **Placeholder scan:** no TBD/TODO in code; every code step has complete content
  and an exact verification command.
- **Type/name consistency:** `emptyKnowledgeModel`, `mergeFindings`,
  `validateKnowledgeModel`, `SECTIONS`, `RISK_KINDS`, the six section names, and
  the findings shape are identical across the script, tests, schema doc, agents,
  and SKILL.md. Persistence reuses the existing `store.mjs` (`init`/`validate`).
- **Out of scope (later plans):** `build-project-model` (Planning Model +
  backlog), `sync-tracker`, `detect-changes`. The actual multi-agent run is
  exercised by the user against a real repo; this plan unit-tests the
  deterministic merge core and ships the agent definitions + orchestration.
```
