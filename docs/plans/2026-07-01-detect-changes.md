# detect-changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/eng:detect-changes` — diff the repo since the commit the model was built from, map the changed files to the Knowledge Model entries that cite them, and report which entries are stale plus a targeted re-analysis recommendation (incremental, not a full re-run).

**Architecture:** The deterministic, testable core is `change-plan.mjs` — it parses `git diff --name-status` output, matches changed paths against each Knowledge Model entry's `sources[]`, and builds a stale-entry report. The `git diff` call itself lives in the SKILL prose (Bash), which feeds its output to the script.

**Tech Stack:** Claude Code plugin (skill), Node.js ≥18 (`node:test`), `git` (invoked from the SKILL), existing `store.mjs`.

**Reference:** Design spec `docs/specs/2026-06-30-engineering-toolkit-design.md` — §3.2 (`detect-changes` incremental path), §4.2 (`source.commit`, `knowledgeModel` entries carry `sources`), §8.6 (detect-changes), and `references/findings-schema.md` (every KM entry has `sources`).

**Pattern to follow:** `skills/sync-tracker/scripts/sync-plan.mjs` for script/test style.

---

## File Structure

| File | Responsibility |
|---|---|
| `skills/detect-changes/scripts/change-plan.mjs` | `parseDiff`, `pathsMatch`, `matchSources`, `buildChangeReport`, CLI `report` |
| `skills/detect-changes/SKILL.md` | Orchestration: read baseline commit → `git diff` → map → report + recommend |
| `tests/change-plan.test.mjs` | `node:test` coverage of diff parsing + source matching |

**Locked contracts:**
- Knowledge Model sections scanned: `domains`, `architecture`, `techDebt`, `infrastructure`, `security`, `risks` (each entry has an `id` and a `sources[]` of file paths, optionally suffixed `#Lnn`).
- A KM entry is **stale** if any of its `sources` matches any changed path (paths normalized: strip `#...`, backslashes → `/`; match on equality or a path-suffix on either side).
- `git diff --name-status <baseline>..HEAD` line shapes: `M\tpath`, `A\tpath`, `D\tpath`, `R100\told\tnew` (rename → take the last column as the current path; first char of col 0 is the status).

**Report shape:**
```json
{
  "baselineCommit": "abc123",
  "changedFiles": ["docs/x.md", "src/Calendar.cs"],
  "staleBySection": { "domains": ["calendar"], "architecture": [], "techDebt": [], "infrastructure": [], "security": [], "risks": [] },
  "staleCount": 1,
  "recommendation": "Re-run /eng:analyze-project ... then /eng:build-project-model."
}
```

---

## Task 1: `change-plan.mjs` core — TDD

**Files:**
- Create: `tests/change-plan.test.mjs`
- Create: `skills/detect-changes/scripts/change-plan.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/change-plan.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, pathsMatch, matchSources, buildChangeReport } from '../skills/detect-changes/scripts/change-plan.mjs';

function model() {
  return {
    source: { commit: 'base123' },
    knowledgeModel: {
      domains: [
        { id: 'calendar', name: 'Calendar', sources: ['docs/architecture/ER.md', 'src/Calendar.cs#L10'] },
        { id: 'bookings', name: 'Bookings', sources: ['docs/bookings.md'] }
      ],
      architecture: [], techDebt: [{ id: 'td1', title: 'x', sources: ['docs/code-reviews/a.md'] }],
      infrastructure: [], security: [], risks: []
    }
  };
}

test('parseDiff: parses name-status lines incl. rename', () => {
  const rows = parseDiff('M\tdocs/x.md\nA\tsrc/b.cs\nD\tdocs/c.md\nR100\tdocs/old.md\tdocs/new.md');
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { status: 'M', path: 'docs/x.md' });
  assert.equal(rows[3].status, 'R');
  assert.equal(rows[3].path, 'docs/new.md'); // current path = last column
});

test('parseDiff: ignores blank lines', () => {
  assert.equal(parseDiff('\n\nM\ta.md\n\n').length, 1);
});

test('pathsMatch: equality and path-suffix, ignoring #Lnn and backslashes', () => {
  assert.ok(pathsMatch('src/Calendar.cs#L10', 'src/Calendar.cs'));
  assert.ok(pathsMatch('docs\\x.md', 'docs/x.md'));
  assert.ok(!pathsMatch('docs/x.md', 'docs/y.md'));
});

test('matchSources: flags the domain whose source changed', () => {
  const stale = matchSources(['src/Calendar.cs'], model());
  assert.deepEqual(stale.domains, ['calendar']);
  assert.deepEqual(stale.techDebt, []);
});

test('matchSources: flags tech-debt entry by its source', () => {
  const stale = matchSources(['docs/code-reviews/a.md'], model());
  assert.deepEqual(stale.techDebt, ['td1']);
});

test('buildChangeReport: counts stale entries and recommends re-analysis', () => {
  const r = buildChangeReport(model(), ['docs/bookings.md', 'README.md']);
  assert.equal(r.baselineCommit, 'base123');
  assert.deepEqual(r.staleBySection.domains, ['bookings']);
  assert.equal(r.staleCount, 1);
  assert.match(r.recommendation, /analyze-project/);
});

test('buildChangeReport: no changes => zero stale, baseline message', () => {
  const r = buildChangeReport(model(), []);
  assert.equal(r.staleCount, 0);
  assert.match(r.recommendation, /No changes/i);
});

test('buildChangeReport: changed files with no source match => full re-analysis hint', () => {
  const r = buildChangeReport(model(), ['unrelated/file.txt']);
  assert.equal(r.staleCount, 0);
  assert.match(r.recommendation, /full .*analyze-project|do not map/i);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/change-plan.test.mjs`
Expected: FAIL — `Cannot find module '.../change-plan.mjs'`.

- [ ] **Step 3: Implement `change-plan.mjs`**

Create `skills/detect-changes/scripts/change-plan.mjs`:

```js
// Zero-dependency: map a git diff onto stale Knowledge Model entries.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SECTIONS = ['domains', 'architecture', 'techDebt', 'infrastructure', 'security', 'risks'];

const norm = (p) => String(p || '').replace(/#.*$/, '').replace(/\\/g, '/').trim();

export function parseDiff(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const status = cols[0].trim()[0]; // A/M/D/R/C
    const path = cols[cols.length - 1].trim(); // current path (last column handles renames)
    if (path) out.push({ status, path });
  }
  return out;
}

export function pathsMatch(source, changed) {
  const s = norm(source), c = norm(changed);
  if (!s || !c) return false;
  return s === c || s.endsWith('/' + c) || c.endsWith('/' + s) || s.endsWith(c) || c.endsWith(s);
}

// changedPaths: array of strings or {path} objects.
export function matchSources(changedPaths, model) {
  const changed = (changedPaths || []).map(x => (typeof x === 'string' ? x : x.path)).filter(Boolean);
  const km = model?.knowledgeModel || {};
  const stale = {};
  for (const section of SECTIONS) {
    stale[section] = [];
    for (const entry of km[section] || []) {
      const srcs = entry.sources || [];
      if (srcs.some(s => changed.some(c => pathsMatch(s, c)))) stale[section].push(entry.id);
    }
  }
  return stale;
}

export function buildChangeReport(model, changedPaths) {
  const changed = (changedPaths || []).map(x => (typeof x === 'string' ? x : x.path)).filter(Boolean);
  const staleBySection = matchSources(changed, model);
  const staleCount = Object.values(staleBySection).reduce((n, a) => n + a.length, 0);
  let recommendation;
  if (staleCount) {
    recommendation = `Re-run /eng:analyze-project (focus on the ${staleCount} stale entr${staleCount === 1 ? 'y' : 'ies'}), then /eng:build-project-model.`;
  } else if (changed.length) {
    recommendation = 'Changed files do not map to any known model sources — a full /eng:analyze-project may be warranted.';
  } else {
    recommendation = 'No changes since the model baseline.';
  }
  return { baselineCommit: model?.source?.commit || null, changedFiles: changed, staleBySection, staleCount, recommendation };
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, modelFile, diffFile] = process.argv;
  try {
    if (cmd === 'report') {
      const model = JSON.parse(readFileSync(modelFile, 'utf8'));
      const rows = parseDiff(readFileSync(diffFile, 'utf8'));
      console.log(JSON.stringify(buildChangeReport(model, rows), null, 2));
    } else {
      console.error('usage: change-plan.mjs report <model.json> <diff.txt>');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/change-plan.test.mjs`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/detect-changes/scripts/change-plan.mjs tests/change-plan.test.mjs
git commit -m "feat(detect): change-plan.mjs diff -> stale KM entries (TDD)"
```

---

## Task 2: `detect-changes` SKILL.md

**Files:**
- Create: `skills/detect-changes/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: detect-changes
description: |
  Diff the repo since the commit the model was built from and report which
  Knowledge Model entries are now stale, so you can re-analyze incrementally
  instead of re-running the whole project. Reads .eng/project-model.json.
when_to_use: |
  Trigger on "what changed", "detect changes", "is the model stale", "what needs
  re-analysis", "/eng:detect-changes", or before a re-sync when the repo has
  moved on since the last analysis.
allowed-tools: Bash(node *), Bash(git *)
---

# detect-changes

Find what moved in the repo since the Knowledge Model was built, and point at the
minimal re-analysis — not a full re-run.

Resolve paths once:
- `CHANGE="${CLAUDE_PLUGIN_ROOT}/skills/detect-changes/scripts/change-plan.mjs"`

## Steps

1. **Read the baseline.** Load `.eng/project-model.json` and read
   `source.commit`. If it is missing, stop and tell the user to run
   `/eng:analyze-project` first (there is no baseline to diff against).

2. **Diff since baseline.** Run:
   `git diff --name-status <source.commit>..HEAD > "$TMP/diff.txt"`
   (use a scratch temp file). Also note `git rev-parse HEAD` as the new head.
   If `<source.commit>` is unknown to git (history rewritten), say so and fall
   back to recommending a full `/eng:analyze-project`.

3. **Map to the model.** Run
   `node "$CHANGE" report .eng/project-model.json "$TMP/diff.txt"` to get the
   stale-entry report.

4. **Report.** Show: baseline commit → HEAD, the changed files, the stale entries
   per section (domains / architecture / tech-debt / infra / security / risks),
   and the recommendation. Make the incremental action concrete, e.g. "3 stale
   domains touch `docs/...`; re-run `/eng:analyze-project` then
   `/eng:build-project-model`".

## Rules

- This skill is read-only — it reports; it does not modify the model or the
  tracker.
- It maps changes via each entry's `sources`; a changed file that no entry cites
  means the model may be missing coverage — recommend a full re-analysis.
- Prefer the smallest re-run: only what is stale, not the whole repo.
```

- [ ] **Step 2: Verify the frontmatter**

Run:
```bash
node -e 'const t=require("fs").readFileSync("skills/detect-changes/SKILL.md","utf8"); const ok=t.startsWith("---")&&/\nname:\s*detect-changes/.test(t)&&/\ndescription:\s*\|/.test(t); console.log("frontmatter ok:",ok); process.exit(ok?0:1)'
```
Expected: `frontmatter ok: true`.

- [ ] **Step 3: End-to-end report smoke test**

Run:
```bash
D="$(mktemp -d)"; printf '%s' '{"source":{"commit":"base123"},"knowledgeModel":{"domains":[{"id":"calendar","name":"Calendar","sources":["src/Calendar.cs#L10"]},{"id":"bookings","name":"Bookings","sources":["docs/bookings.md"]}],"architecture":[],"techDebt":[],"infrastructure":[],"security":[],"risks":[]}}' > "$D/m.json"; printf 'M\tsrc/Calendar.cs\nA\tREADME.md\n' > "$D/diff.txt"; node skills/detect-changes/scripts/change-plan.mjs report "$D/m.json" "$D/diff.txt" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);console.log("stale domains:",r.staleBySection.domains.join(","));console.log("staleCount:",r.staleCount);console.log("changed:",r.changedFiles.length)})'
```
Expected:
```
stale domains: calendar
staleCount: 1
changed: 2
```

- [ ] **Step 4: Commit**

```bash
git add skills/detect-changes/SKILL.md
git commit -m "feat: detect-changes skill (git diff -> stale entries -> incremental hint)"
```

---

## Task 3: Docs, version bump, validate, release

**Files:**
- Modify: `README.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json`

- [ ] **Step 1: Add `detect-changes` to the README skills table** (directly under the `sync-tracker` row):

```markdown
| `/eng:detect-changes` | Diff since last analysis; report stale model entries |
```

- [ ] **Step 2: Bump version** in `.claude-plugin/plugin.json` from `"0.7.0"` to `"0.8.0"`.

- [ ] **Step 3: Add CHANGELOG entry** directly under `## [Unreleased]`:

```markdown

## [0.8.0] - 2026-07-01

### Added
- `detect-changes` skill (`/eng:detect-changes`) — diffs the repo since the
  model's `source.commit`, maps changed files onto Knowledge Model entries via
  their `sources`, and reports the stale entries with an incremental re-analysis
  recommendation. Deterministic core in `change-plan.mjs`.

### Notes
- Completes the v1 skill set: setup-toolkit, analyze-project, build-project-model,
  sync-tracker, detect-changes, knowledge-store, skills.
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test`
Expected: all tests PASS (change-plan suite added).

- [ ] **Step 5: Validate the plugin**

Run: `claude plugin validate . --strict`
Expected: passes.

- [ ] **Step 6: Commit and tag**

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "chore: release 0.8.0 (detect-changes) — v1 skill set complete"
git tag v0.8.0
```

---

## Self-Review (completed during planning)

- **Spec coverage:** implements §3.2 and §8.6 (git diff since `source.commit` →
  which docs/entries are stale → incremental recommendation, not a full re-run),
  using §4.2's `source.commit` and the `sources` arrays on every KM entry.
- **Placeholder scan:** no TBD/TODO in code; the report smoke test asserts exact
  output.
- **Type/name consistency:** `parseDiff`, `pathsMatch`, `matchSources`,
  `buildChangeReport`, `SECTIONS`, and the report shape are identical across
  script, tests, and SKILL. Section names match `findings-schema.md` and
  `knowledge-model.mjs`.
- **Out of scope (later):** auto-executing the scoped re-analysis (this skill
  recommends; the user re-runs analyze/build); mapping stale domains to individual
  backlog epics (the domain→epic link is not stored explicitly).
```
