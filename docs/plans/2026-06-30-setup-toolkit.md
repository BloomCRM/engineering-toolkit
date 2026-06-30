# setup-toolkit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/eng:setup-toolkit` — pick a tracker provider, detect its MCP at runtime, verify (verify-only) a Jira project, and persist `.eng/config.json`; backed by a zero-dependency, unit-tested `config.mjs` and provider-adapter docs.

**Architecture:** Same pattern as `knowledge-store` — the deterministic core (`config.mjs`: config schema, status derivation, validation, read/write) is unit-tested with `node:test`; the SKILL.md is thin prose that orchestrates provider choice → adapter load → MCP detection → verify-only project read → config persistence. Providers are **adapter docs** under `references/providers/`; `jira.md` is fleshed out (sync-ready), the others are stubs. The skill **never hardcodes a specific Jira MCP** — it discovers whichever jira tools the session exposes and records them in config, so it works with both the Atlassian official (Rovo/Remote) MCP and the community `mcp-atlassian`.

**Tech Stack:** Claude Code plugin, Markdown skills + reference docs, Node.js ≥18 (ESM, `node:test`).

**Reference:** Design spec `docs/specs/2026-06-30-engineering-toolkit-design.md` — §4.1 config file, §6 provider-adapter contract, §8.1 setup-toolkit, §10 MCP detection, plus the v1 scope decisions (Jira-only sync-ready; verify-only, no project auto-create; `Phase`→label/fixVersion).

**Pattern to follow:** mirror the existing `skills/knowledge-store/scripts/store.mjs` + `tests/store.test.mjs` style exactly (zero-dep ESM, exported pure functions + an `isMain()` CLI dispatcher, `ET_*` env override for the file path).

---

## File Structure

| File | Responsibility |
|---|---|
| `skills/setup-toolkit/scripts/config.mjs` | Config schema: `initConfig`, `deriveStatus`, `validateConfig`, `readConfig`, `writeConfig`, CLI |
| `skills/setup-toolkit/SKILL.md` | Orchestration: provider choice → adapter → MCP detect → verify-only → persist |
| `references/providers/jira.md` | Jira adapter (sync-ready): detection, operations, field mapping, Phase→label |
| `references/providers/azure-devops.md` | Stub adapter |
| `references/providers/github-projects.md` | Stub adapter |
| `references/providers/linear.md` | Stub adapter |
| `tests/config.test.mjs` | `node:test` coverage of the config core |

**Constants locked for this plan (use these exact names/values):**
- `CONFIG_VERSION = '1.0'`
- `PROVIDERS = ['jira', 'azure-devops', 'github-projects', 'linear']`
- `SYNC_READY = ['jira']`
- `PHASE_FIELDS = ['label', 'fixVersion']`
- `STATUSES = ['stub', 'incomplete', 'ready']`
- Config path env override: `ET_CONFIG_PATH` (default `<cwd>/.eng/config.json`)
- CLI subcommands: `init <provider>`, `validate`, `show`

**Status semantics:**
- `stub` — provider is not sync-ready in this version (everything except Jira).
- `incomplete` — Jira chosen but MCP missing or project not verified.
- `ready` — Jira + MCP available + verified `project.key`.

---

## Task 1: `config.mjs` core — TDD

**Files:**
- Create: `tests/config.test.mjs`
- Create: `skills/setup-toolkit/scripts/config.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import {
  initConfig, validateConfig, deriveStatus, readConfig, writeConfig, CONFIG_VERSION
} from '../skills/setup-toolkit/scripts/config.mjs';

test('initConfig(jira): incomplete and valid', () => {
  const c = initConfig('jira');
  assert.equal(c.provider, 'jira');
  assert.equal(c.providerStatus, 'incomplete');
  assert.deepEqual(validateConfig(c), []);
});

test('initConfig(linear): stub and valid', () => {
  const c = initConfig('linear');
  assert.equal(c.providerStatus, 'stub');
  assert.deepEqual(validateConfig(c), []);
});

test('deriveStatus: jira + mcp + project key => ready', () => {
  const c = initConfig('jira');
  c.mcp.available = true; c.project.key = 'BLOOM';
  assert.equal(deriveStatus(c), 'ready');
});

test('deriveStatus: jira without mcp => incomplete', () => {
  assert.equal(deriveStatus(initConfig('jira')), 'incomplete');
});

test('deriveStatus: non-sync-ready provider => stub', () => {
  assert.equal(deriveStatus(initConfig('azure-devops')), 'stub');
});

test('validateConfig: unknown provider is an error', () => {
  const c = initConfig('jira'); c.provider = 'trello';
  assert.ok(validateConfig(c).some(e => e.includes('invalid provider')));
});

test('validateConfig: invalid phaseField is an error', () => {
  const c = initConfig('jira'); c.mappings.phaseField = 'epicLink';
  assert.ok(validateConfig(c).some(e => e.includes('phaseField')));
});

test('validateConfig: non-jira with non-stub status is an error', () => {
  const c = initConfig('github-projects'); c.providerStatus = 'ready';
  assert.ok(validateConfig(c).some(e => e.includes('must be "stub"')));
});

test('validateConfig: ready status requires mcp.available and project.key', () => {
  const c = initConfig('jira'); c.providerStatus = 'ready';
  const errs = validateConfig(c);
  assert.ok(errs.some(e => e.includes('mcp.available')));
  assert.ok(errs.some(e => e.includes('project.key')));
});

test('writeConfig/readConfig round-trips and guards overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eng-cfg-'));
  const path = join(dir, '.eng', 'config.json');
  try {
    writeConfig(path, initConfig('jira'));
    assert.ok(existsSync(path));
    assert.equal(readConfig(path).configVersion, CONFIG_VERSION);
    assert.throws(() => writeConfig(path, initConfig('jira'), { force: false }), /exists/);
    writeConfig(path, initConfig('jira'), { force: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test`
Expected: FAIL — `Cannot find module '.../config.mjs'`.

- [ ] **Step 3: Implement `config.mjs`**

Create `skills/setup-toolkit/scripts/config.mjs`:

```js
// Zero-dependency tracker config for the eng toolkit (.eng/config.json).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_VERSION = '1.0';
export const PROVIDERS = ['jira', 'azure-devops', 'github-projects', 'linear'];
export const SYNC_READY = ['jira'];
export const PHASE_FIELDS = ['label', 'fixVersion'];
export const STATUSES = ['stub', 'incomplete', 'ready'];

export function configPath() {
  return process.env.ET_CONFIG_PATH || join(process.cwd(), '.eng', 'config.json');
}

export function deriveStatus(c) {
  if (!SYNC_READY.includes(c.provider)) return 'stub';
  if (c.mcp && c.mcp.available && c.project && c.project.key) return 'ready';
  return 'incomplete';
}

export function initConfig(provider) {
  const c = {
    configVersion: CONFIG_VERSION,
    provider,
    providerStatus: 'incomplete',
    mcp: { available: false, detectedTools: [], checkedAt: null },
    project: { key: null, issueTypes: [], statuses: [], components: [], fields: {} },
    mappings: { phaseField: 'label' }
  };
  c.providerStatus = deriveStatus(c);
  return c;
}

export function validateConfig(c) {
  const errors = [];
  if (!c || typeof c !== 'object') return ['config is not an object'];
  if (typeof c.configVersion !== 'string') errors.push('missing configVersion');
  if (!PROVIDERS.includes(c.provider)) errors.push(`invalid provider: ${c.provider}`);
  if (!c.mappings || !PHASE_FIELDS.includes(c.mappings.phaseField)) {
    errors.push('mappings.phaseField must be one of: ' + PHASE_FIELDS.join(', '));
  }
  if (!STATUSES.includes(c.providerStatus)) errors.push(`invalid providerStatus: ${c.providerStatus}`);
  if (!c.mcp || typeof c.mcp !== 'object' || !Array.isArray(c.mcp.detectedTools)) {
    errors.push('mcp.detectedTools must be an array');
  }
  if (!SYNC_READY.includes(c.provider) && c.providerStatus !== 'stub') {
    errors.push(`provider ${c.provider} is not sync-ready in this version; providerStatus must be "stub"`);
  }
  if (c.providerStatus === 'ready') {
    if (!c.mcp || !c.mcp.available) errors.push('providerStatus "ready" requires mcp.available = true');
    if (!c.project || !c.project.key) errors.push('providerStatus "ready" requires project.key');
  }
  return errors;
}

export function readConfig(path = configPath()) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeConfig(path = configPath(), config, { force = false } = {}) {
  if (existsSync(path) && !force) throw new Error(`config already exists at ${path} (use force to overwrite)`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return path;
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const [, , cmd, arg] = process.argv;
  const force = process.argv.includes('--force');
  const path = configPath();
  try {
    if (cmd === 'init') {
      if (!PROVIDERS.includes(arg)) {
        console.error('usage: config.mjs init <' + PROVIDERS.join('|') + '> [--force]');
        process.exit(2);
      }
      writeConfig(path, initConfig(arg), { force });
      console.log(`initialized ${arg} config at ${path}`);
    } else if (cmd === 'validate') {
      const errors = validateConfig(readConfig(path));
      if (errors.length) { console.error('INVALID:\n' + errors.map(e => ' - ' + e).join('\n')); process.exit(1); }
      console.log('VALID');
    } else if (cmd === 'show') {
      console.log(JSON.stringify(readConfig(path), null, 2));
    } else {
      console.error('usage: config.mjs <init <provider>|validate|show> [--force]');
      process.exit(2);
    }
  } catch (err) {
    console.error('ERROR: ' + err.message);
    process.exit(1);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all tests PASS (10 new `config` tests plus the existing suites).

- [ ] **Step 5: Commit**

```bash
git add skills/setup-toolkit/scripts/config.mjs tests/config.test.mjs
git commit -m "feat(setup): config.mjs core (init/validate/deriveStatus/read/write) TDD"
```

---

## Task 2: `config.mjs` CLI smoke test

**Files:** none (verification only)

- [ ] **Step 1: Smoke-test the CLI in a temp dir**

Run:
```bash
ET_CONFIG_PATH="$(mktemp -d)/config.json" sh -c '
  node skills/setup-toolkit/scripts/config.mjs init jira &&
  node skills/setup-toolkit/scripts/config.mjs validate &&
  node skills/setup-toolkit/scripts/config.mjs show'
```
Expected: `initialized jira config at …`, then `VALID`, then a JSON block with `"provider": "jira"` and `"providerStatus": "incomplete"`.

- [ ] **Step 2: Smoke-test a stub provider**

Run:
```bash
ET_CONFIG_PATH="$(mktemp -d)/config.json" sh -c '
  node skills/setup-toolkit/scripts/config.mjs init linear &&
  node skills/setup-toolkit/scripts/config.mjs show | grep providerStatus'
```
Expected: prints `"providerStatus": "stub"`.

---

## Task 3: Jira provider adapter (`references/providers/jira.md`)

**Files:**
- Create: `references/providers/jira.md`

- [ ] **Step 1: Write the adapter doc**

```markdown
# Provider adapter: Jira (sync-ready)

The skill speaks only Epic / Story / Task / Subtask / Bug. This file maps that
vocabulary onto Jira and tells the skill how to drive whichever Jira MCP is
connected. **Do not hardcode a vendor** — detect the tools at runtime and bind
the real names from this table.

## 1. Detection

A Jira MCP is present if the session exposes any tool whose name matches
`/jira/i`. Use ToolSearch (query `"jira"`) or the tool list to find them.

Two common vendors:

| Vendor | Tool-name shape | Example |
|---|---|---|
| Atlassian official (Rovo / Remote MCP) | camelCase, `*Jira*` | `createJiraIssue`, `searchJiraIssuesUsingJql`, `getVisibleJiraProjects` |
| Community `mcp-atlassian` (sooperset) | snake_case, `jira_*` | `jira_create_issue`, `jira_search`, `jira_get_all_projects` |

The actual tools may carry an MCP server prefix (e.g. `mcp__atlassian__…`). Match
on the substring, record the **exact** discovered names into
`config.mcp.detectedTools`.

## 2. Hierarchy mapping (v1)

| Platform | Jira |
|---|---|
| Phase | **label** (default) or `fixVersion` — never a custom issue type |
| Epic | Epic |
| Story | Story |
| Task | Task |
| Subtask | Sub-task |
| Bug | Bug |

## 3. Field mapping

| Platform field | Jira field | Notes |
|---|---|---|
| title | `summary` | |
| description | `description` | Jira Cloud REST expects ADF; many MCPs accept markdown and convert. Confirm with the connected MCP (see Open Questions in the spec). |
| acceptanceCriteria | appended into `description` (G/W/T block) | No native AC field in core Jira |
| definitionOfDone | appended into `description` (checklist) | |
| priority | `priority` | |
| phase | `labels` (one label) or `fixVersions` | per `config.mappings.phaseField` |
| type | issue type | from §2 |
| trackerKey | issue key (e.g. `BLOOM-123`) | stored back into the model |

## 4. Operations (logical → example tool names)

Bind the actual tool at runtime; names below are examples per vendor.

| Operation | Atlassian official | Community `mcp-atlassian` |
|---|---|---|
| list projects | `getVisibleJiraProjects` | `jira_get_all_projects` |
| project issue-type metadata | `getJiraProjectIssueTypesMetadata` | (from project metadata / `jira_search`) |
| statuses | `getJiraIssueTypeStatuses` / transitions | `jira_get_transitions` |
| create issue | `createJiraIssue` | `jira_create_issue` |
| update issue | `editJiraIssue` | `jira_update_issue` |
| get issue | `getJiraIssue` | `jira_get_issue` |
| search (JQL) | `searchJiraIssuesUsingJql` | `jira_search` |
| link issues | `createJiraIssueLink` *(if available)* | `jira_create_issue_link` |

`searchByExternalRef`: find an already-synced issue by storing the platform
`id` in a label or in `description`, then querying with JQL
(`labels = "eng-id:<id>"`). Used by `sync-tracker` to decide create vs update.

## 5. Bootstrap (v1 = verify-only)

Do **not** create the project. Read-only checks:
1. list projects → confirm the user's `project.key` exists.
2. read issue types → confirm Epic / Story / Task / Sub-task / Bug exist (or the
   closest equivalents); record into `config.project.issueTypes`.
3. read statuses and components → record into config.
If the project is missing, instruct the user to create it manually in Jira, then
re-run setup.

## 6. Capabilities & limitations

- Standard Jira has no native level above Epic → `Phase` is a label/fixVersion.
- No native acceptance-criteria field → folded into the description.
- Subtasks require the parent to exist first (create order: Epic → Story → Task →
  Sub-task).
- Rate limits apply on Jira Cloud; batch conservatively.
```

- [ ] **Step 2: Verify it is non-empty and well-formed Markdown**

Run: `node -e "const t=require('fs').readFileSync('references/providers/jira.md','utf8'); if(!/Detection/.test(t)||t.length<800) throw new Error('jira.md incomplete'); console.log('OK')"`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add references/providers/jira.md
git commit -m "feat(providers): Jira adapter (detection, mapping, ops, verify-only)"
```

---

## Task 4: Stub provider adapters

**Files:**
- Create: `references/providers/azure-devops.md`
- Create: `references/providers/github-projects.md`
- Create: `references/providers/linear.md`

- [ ] **Step 1: Write `references/providers/azure-devops.md`**

```markdown
# Provider adapter: Azure DevOps (STUB — not sync-ready in v1)

> TODO: not implemented. `setup-toolkit` may select this provider but will mark
> the config `providerStatus: "stub"` and `sync-tracker` will refuse to run.

## Hierarchy mapping (planned)

| Platform | Azure DevOps |
|---|---|
| Phase | Epic (parent) / area path |
| Epic | Feature |
| Story | User Story |
| Task | Task |
| Subtask | Task (child) |
| Bug | Bug |

## Detection (planned)

Tools matching `/azure|devops|workitem/i` (e.g. the Microsoft Azure DevOps MCP).

## Implementation checklist (v2)

- [ ] Detection signatures for the Azure DevOps MCP
- [ ] Operation mapping (create/update/query work items)
- [ ] Field mapping (AC, DoD, area/iteration path)
- [ ] Verify-only project/area read
```

- [ ] **Step 2: Write `references/providers/github-projects.md`**

```markdown
# Provider adapter: GitHub Projects (STUB — not sync-ready in v1)

> TODO: not implemented. `setup-toolkit` may select this provider but will mark
> the config `providerStatus: "stub"` and `sync-tracker` will refuse to run.

## Hierarchy mapping (planned)

| Platform | GitHub |
|---|---|
| Phase | Project field (single-select) |
| Epic | Issue + label `epic` |
| Story | Issue |
| Task | Sub-issue |
| Subtask | Task-list item / sub-issue |
| Bug | Issue + label `bug` |

## Detection (planned)

Tools matching `/github/i` exposing issues/projects (e.g. the GitHub MCP).

## Implementation checklist (v2)

- [ ] Detection signatures for the GitHub MCP
- [ ] Operation mapping (create issue, add to project, set field)
- [ ] Field mapping (AC/DoD in body, labels, project fields)
- [ ] Verify-only repo/project read
```

- [ ] **Step 3: Write `references/providers/linear.md`**

```markdown
# Provider adapter: Linear (STUB — not sync-ready in v1)

> TODO: not implemented. `setup-toolkit` may select this provider but will mark
> the config `providerStatus: "stub"` and `sync-tracker` will refuse to run.

## Hierarchy mapping (planned)

| Platform | Linear |
|---|---|
| Phase | Project / Milestone |
| Epic | Project or parent Issue |
| Story | Issue |
| Task | Sub-issue |
| Subtask | Sub-issue |
| Bug | Issue + label `bug` |

## Detection (planned)

Tools matching `/linear/i` (the official Linear MCP).

## Implementation checklist (v2)

- [ ] Detection signatures for the Linear MCP
- [ ] Operation mapping (create/update issue, set project)
- [ ] Field mapping (AC/DoD in description, labels)
- [ ] Verify-only team/project read
```

- [ ] **Step 4: Verify all three exist and are marked as stubs**

Run:
```bash
for f in azure-devops github-projects linear; do \
  grep -q "STUB" "references/providers/$f.md" && echo "$f OK" || echo "$f MISSING"; \
done
```
Expected: `azure-devops OK`, `github-projects OK`, `linear OK`.

- [ ] **Step 5: Commit**

```bash
git add references/providers/azure-devops.md references/providers/github-projects.md references/providers/linear.md
git commit -m "feat(providers): stub adapters for azure-devops, github-projects, linear"
```

---

## Task 5: `setup-toolkit` SKILL.md

**Files:**
- Create: `skills/setup-toolkit/SKILL.md`

- [ ] **Step 1: Write the skill**

```markdown
---
name: setup-toolkit
description: |
  Configure the eng toolkit for this repository: choose a tracker provider,
  detect its MCP, verify the project, and save .eng/config.json. Run this first,
  before analyze/build/sync.
when_to_use: |
  Trigger on "setup eng", "configure the toolkit", "connect Jira", "set up the
  tracker", "/eng:setup-toolkit", or when another skill reports the config is
  missing.
allowed-tools: Bash(node *)
---

# setup-toolkit

Make the platform usable in this repo. The result is `.eng/config.json` in the
**target repository** (one repo = one config). This skill is the only one that
deals with connecting a tracker; every other skill just reads the config.

Resolve the script and adapters once:

- `CONFIG="${CLAUDE_PLUGIN_ROOT}/skills/setup-toolkit/scripts/config.mjs"`
- adapters live in `${CLAUDE_PLUGIN_ROOT}/references/providers/<provider>.md`

## Steps

1. **Choose provider.** Ask the user: `jira` (sync-ready) · `azure-devops` ·
   `github-projects` · `linear`. State clearly that everything except `jira` is
   a **stub** (selectable, but `sync-tracker` will refuse until implemented).

2. **Load the adapter** `references/providers/<provider>.md` and read its
   Detection section.

3. **Detect the MCP.** Search the session's available tools for the adapter's
   signatures (use ToolSearch, e.g. query `"jira"`). 
   - **If none found → STOP.** Do not write a `ready` config. Print the adapter's
     connection instructions and tell the user to configure the MCP and
     **restart Claude**, then re-run `/eng:setup-toolkit`.
   - **If found:** record the exact discovered tool names for step 5.

4. **Verify-only (Jira).** Using the detected tools:
   - list projects; ask the user for the `project.key` and confirm it exists.
     If it does not exist, instruct manual creation in Jira and stop — **never
     auto-create the project**.
   - read issue types, statuses, components; keep them for the config.

5. **Persist config.**
   - Scaffold: `node "$CONFIG" init <provider>` (add `--force` only if the user
     confirms overwriting an existing config).
   - Edit `.eng/config.json` to fill in: `mcp.available`, `mcp.detectedTools`
     (the exact names from step 3), `mcp.checkedAt` (an ISO timestamp),
     `project.key` and the read `issueTypes` / `statuses` / `components`, and
     `mappings.phaseField` (`label` by default, `fixVersion` if the user prefers).
   - Set `providerStatus`: `stub` for non-Jira; for Jira use `ready` only when
     MCP is available AND `project.key` is set, otherwise `incomplete`.
   - Validate: `node "$CONFIG" validate` — must print `VALID` before you report
     success. If it prints errors, fix the fields and re-validate.

6. **Report.** Show the final provider, status, project key, and the detected
   tools. If status is `incomplete` or `stub`, tell the user exactly what is
   missing and what unblocks it.

## Rules

- Never auto-create a Jira project (v1 is verify-only).
- Non-Jira providers are always `stub` in this version.
- The config lives in the target repo (`${CLAUDE_PROJECT_DIR}/.eng/`), never in
  plugin data.
- Do not proceed to sync if `validate` fails.
```

- [ ] **Step 2: Verify the frontmatter**

Run:
```bash
node -e 'const t=require("fs").readFileSync("skills/setup-toolkit/SKILL.md","utf8"); const ok=t.startsWith("---")&&/\nname:\s*setup-toolkit/.test(t)&&/\ndescription:\s*\|/.test(t); console.log("frontmatter ok:",ok); process.exit(ok?0:1)'
```
Expected: `frontmatter ok: true`.

- [ ] **Step 3: Commit**

```bash
git add skills/setup-toolkit/SKILL.md
git commit -m "feat: setup-toolkit skill (provider choice, MCP detect, verify-only, persist)"
```

---

## Task 6: Docs, version bump, validate, release

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Add `setup-toolkit` to the README skills table**

In `README.md`, change the skills table so it reads (keep the existing two rows):

```markdown
| Skill | Purpose |
|---|---|
| `/eng:setup-toolkit` | Choose a tracker, detect its MCP, verify the project, save config |
| `/eng:skills` | List every skill in the plugin with a short description |
| `/eng:knowledge-store` | Init / validate / inspect / migrate the project model |
```

- [ ] **Step 2: Bump the version**

In `.claude-plugin/plugin.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 3: Add a CHANGELOG entry**

In `CHANGELOG.md`, insert directly under the `## [Unreleased]` line:

```markdown

## [0.3.0] - 2026-06-30

### Added
- `setup-toolkit` skill (`/eng:setup-toolkit`) — provider selection, runtime MCP
  detection, verify-only Jira project check, and `.eng/config.json` persistence,
  backed by a zero-dependency, unit-tested `config.mjs`.
- Provider adapters: `jira.md` (sync-ready) plus stubs for `azure-devops`,
  `github-projects`, `linear`.
```

- [ ] **Step 4: Run the full test suite**

Run: `node --test`
Expected: all tests PASS (config suite + store suite + list-skills suite).

- [ ] **Step 5: Validate the plugin**

Run: `claude plugin validate . --strict`
Expected: passes with no errors.

- [ ] **Step 6: Commit and tag**

```bash
git add README.md CHANGELOG.md .claude-plugin/plugin.json
git commit -m "chore: release 0.3.0 (setup-toolkit + provider adapters)"
git tag v0.3.0
```

---

## Self-Review (completed during planning)

- **Spec coverage:** implements §4.1 config file (`.eng/config.json` shape +
  `ET_CONFIG_PATH`), §6 provider-adapter contract (`jira.md` covers detection /
  hierarchy / field mapping / operations / bootstrap / limitations; stubs follow
  the same skeleton), §8.1 setup-toolkit (provider choice → detect → verify-only
  → persist; STOP on missing MCP; non-Jira = stub; no project auto-create), §10
  MCP detection (runtime tool discovery, vendor-agnostic), and the v1 decisions
  (Jira-only sync-ready, `Phase`→label/fixVersion).
- **Placeholder scan:** the only "TODO" strings are intentional stub markers
  inside the stub adapter docs (asserted to exist in Task 4 Step 4); no
  placeholders in code or in the testable core.
- **Type/name consistency:** `initConfig`, `deriveStatus`, `validateConfig`,
  `readConfig`, `writeConfig`, `CONFIG_VERSION`, `PROVIDERS`, `SYNC_READY`,
  `PHASE_FIELDS`, `STATUSES`, `ET_CONFIG_PATH`, statuses
  `stub/incomplete/ready`, CLI `init/validate/show` — identical across tasks and
  matching `config.test.mjs`.
- **Out of scope (later plans):** actual MCP calls in `sync-tracker`, the
  analyze/build skills, and making any stub provider sync-ready.
```
