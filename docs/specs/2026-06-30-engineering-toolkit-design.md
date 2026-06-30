# Engineering Intelligence Platform — Design (v1.0)

> Status: **Draft for review** · Date: 2026-06-30 · Owner: Volodymyr Kostyrko
> Distributed as a Claude Code **plugin** (`eng`) inside a single-plugin **marketplace** repo (`engineering-toolkit`).

---

## 1. Vision

A Claude Code plugin that turns a software repository's **documentation and code into a living, structured engineering backlog** inside whatever issue tracker the team uses (Jira, Azure DevOps, GitHub Projects, Linear).

The plugin does not "parse markdown." It builds an internal **knowledge model** of the project, reasons about it like a senior engineering team (Product Owner, Architect, Engineering, QA, DevOps), produces a **planning model**, projects that into a **backlog**, and synchronizes it to a tracker through a thin **provider adapter** layer.

**Source of truth split:**

- **Git documentation + code** = source of truth for *what the project is and should be*.
- **Tracker (Jira/ADO/…)** = reflection of *implementation state*.
- **`project-model.json`** (the knowledge-store) = the platform's own brain, the single artifact every skill reads and writes. Not Jira. Not Markdown.

### 1.1 Bloom is the first user, not part of the platform

The platform is **vendor-neutral by construction**. No domain term, skill name, agent, or file says "Bloom." Bloom CRM is simply the first repository this platform is pointed at.

Concretely:

- Repo is created in the **BloomCRM** GitHub org now (simplest correct start).
- All names/structure/docs are neutral (`engineering-toolkit`, `tracker-adapters`, `project-model`, `knowledge-store`).
- In the future a single GitHub **Transfer Repository** moves it to its own org with zero renames.

---

## 2. Goals / Non-Goals

### Goals (v1.0)

- One installable plugin, marketplace-hosted, validates clean (`claude plugin validate`).
- **One end-to-end happy path** working against **Jira only**:
  `setup-toolkit → knowledge-store init → analyze-project → build-project-model → sync-tracker (dry-run)`.
- Tracker-agnostic core: adding a tracker = adding one `references/providers/<tracker>.md`, no skill changes.
- Multi-agent analysis that **challenges the documentation** rather than trusting it.
- Safe sync: `dry-run` is default; and even an explicit `sync` **shows the diff and asks for confirmation before mutating** the tracker.

### v1 scope decisions (locked)

- **Jira is the only sync-ready provider.** `azure-devops` / `github-projects` / `linear` ship as **stubs only**: a `providers/<tracker>.md` with the mapping skeleton + a clear `TODO` marking them not-yet-implemented. `setup-toolkit` offers them but states they are stubs.
- **No automatic Jira project creation in v1.** Bare-Jira handling is **verify-only**: confirm the project exists and read its issue types, statuses, fields, components. If the project is missing, instruct the user to create it manually. (Auto-bootstrap is a v2 concern.)
- **`Phase` maps to a Jira `label` (or `fixVersion`)** — no custom issue type, no Initiative hierarchy in v1.
- **No mutation without confirmation.** `sync` mode always renders the create/update diff and waits for an explicit user "yes" before calling any write tool.

### Non-Goals (explicit, YAGNI)

- No bundled tracker MCP server (credentials belong to the user; the plugin *detects and instructs*, it does not ship Jira).
- No `finish-day` migration in v1 (deferred; foundation first).
- No CI runner, no hosted service, no web UI. Everything runs inside Claude Code.
- No real-time sync / webhooks. Sync is an explicit, user-invoked operation.

---

## 3. Architecture

### 3.1 Data-flow layers

```
 Repository (docs/, code, git history)
        │  analyze-project        (multi-agent reasoning)
        ▼
 KNOWLEDGE MODEL ──── facts: domains, dependencies, architecture,
        │              done / incomplete / future, tech-debt, infra,
        │              security, performance, risks
        │  build-project-model    (decisions)
        ▼
 PLANNING MODEL ───── judgments: phase (MVP…Enterprise), feature vs
        │              bug vs tech-debt, roadmap status, priority
        │  (projection)
        ▼
 BACKLOG ──────────── Phase → Epic → Story → Task → Subtask
        │              + Acceptance Criteria (Given/When/Then) + DoD
        │  sync-tracker  →  tracker-adapters/<jira|ado|github|linear>
        ▼
 Tracker (Issue Types / Status / Fields / Components)
```

`detect-changes` is the incremental path: `git diff` since the last model → invalidate only affected docs/Epics/Stories → re-run the relevant slice instead of re-analyzing everything.

### 3.2 The knowledge-store is the heart

Every skill communicates **only** through `project-model.json` (+ `config.json`). No skill talks to another skill's internals; no skill except a provider adapter knows a tracker exists.

```
        ┌──────────────┐
        │ setup-toolkit│ writes config.json
        └──────┬───────┘
               │
   ┌───────────┼───────────────┬───────────────┐
   ▼           ▼               ▼               ▼
analyze   build-project-   detect-changes   sync-tracker
-project     model
   │           │               │               │
   └─────► project-model.json ◄┘               │
                  ▲                            (reads backlog)
                  └─────────────────────────────┘
```

### 3.3 Provider abstraction

The skill layer speaks one vocabulary — **Epic / Story / Task / Subtask / Bug** — and never speaks "Issue Type / Status / Custom Field." Each tracker's dialect lives in exactly one file:

```
references/providers/
  jira.md            ← v1 sync-ready
  azure-devops.md    ← adapter stub (mapping + connect instructions)
  github-projects.md ← adapter stub
  linear.md          ← adapter stub
```

A provider adapter file is a **contract document** (see §6) that defines: MCP detection, hierarchy mapping, field mapping, the create/update/query tool calls, and bootstrap steps.

---

## 4. The knowledge-store (`project-model.json`)

### 4.1 Files (in the **target** repo, not the plugin)

| Path | Purpose |
|---|---|
| `.eng/config.json` | chosen provider, project key, verified MCP status, field/hierarchy overrides |
| `.eng/project-model.json` | the model: knowledge + planning + backlog |
| `.eng/.lock` (optional) | guards against concurrent writes |

Location is resolved via `${CLAUDE_PROJECT_DIR}` (per-repo; each repo has its own tracker/project). `${CLAUDE_PLUGIN_DATA}` is **not** used for this — it is global and would leak one repo's model into another.

### 4.2 Shape (illustrative; authoritative schema in `schemas/project-model.schema.json`)

```jsonc
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-06-30T12:00:00Z",
  "source": { "repo": "BloomCRM/Bloom", "commit": "d83e765", "branch": "main" },

  "knowledgeModel": {
    "domains": [
      { "id": "calendar", "name": "Calendar", "status": "partial",
        "dependsOn": ["bookings", "masters"], "sources": ["docs/...md#L12"] }
    ],
    "architecture": [ /* boundaries, layers, ADR refs */ ],
    "techDebt":     [ /* from code-reviews/, categorized */ ],
    "infrastructure":[ /* CI/CD, hosting, monitoring */ ],
    "security":     [ /* RLS, auth, secrets */ ],
    "risks":        [ /* contradictions, unknowns, hotspots */ ]
  },

  "planningModel": {
    "phases": ["MVP", "Production Ready", "Public Release", "Scaling", "Enterprise", "AI"],
    "items": [
      { "ref": "calendar", "phase": "MVP", "type": "feature",
        "roadmapStatus": "partial", "priority": "high" }
    ]
  },

  "backlog": {
    "epics": [
      {
        "id": "epic-calendar", "trackerKey": null, "phase": "MVP",
        "type": "feature", "title": "Calendar", "description": "…",
        "stories": [
          {
            "id": "story-cal-day-view", "trackerKey": null, "title": "…",
            "description": "…",
            "acceptanceCriteria": [
              { "given": "…", "when": "…", "then": "…" }
            ],
            "definitionOfDone": ["code", "unit", "integration", "docs", "review", "ci"],
            "tasks": [
              { "id": "task-…", "category": "backend",
                "subtasks": [ { "id": "sub-…", "title": "…" } ] }
            ]
          }
        ]
      }
    ]
  }
}
```

`trackerKey` is `null` until `sync-tracker` creates the issue; afterwards it stores the tracker's id (e.g. `BLOOM-123`). This is how reconciliation distinguishes **create** from **update**.

### 4.3 Task categories (never giant tasks)

`backend · frontend · database · validation · tests · documentation · logging · monitoring · migration`

### 4.4 Definition of Done (default checklist on every Task)

`code · unit tests · integration tests · docs updated · reviewed · CI passed · no TODO · no analyzer warnings`

---

## 5. Project hierarchy & phases

### 5.1 Levels (never skip a level)

`Phase → Epic → Story → Task → Subtask`

### 5.2 Default phases

`MVP · Production Ready · Public Release · Scaling · Enterprise · AI` — every Epic belongs to exactly one phase.

### 5.3 Dedicated epics (never mixed into feature epics)

- **Technical Debt epic** — everything from code-review docs that is not a bug. Categories: Architecture / Performance / Reliability / Security / Scalability / Testing / Infrastructure / Coding Standards / Documentation.
- **Bug Fixes epic** — bugs are never folded into feature epics; they are **linked** instead.

### 5.4 Roadmap item statuses

`Implemented · Partially Implemented · Planned · Blocked · Deferred · Cancelled`
Only **Planned** and **Partially Implemented** generate new backlog items.

---

## 6. Provider adapter contract

Every `references/providers/<tracker>.md` MUST define these sections so a skill can drive it without provider-specific code:

1. **Identity & detection** — how to recognize this tracker's MCP at runtime (the tool-name signatures, e.g. presence of `*createJiraIssue*` / `*searchJiraIssuesUsingJql*`). Used by `setup-toolkit` and a runtime guard in `sync-tracker`.
2. **Hierarchy mapping** — table mapping platform vocabulary → tracker native types:

   | Platform | Jira (v1) | Azure DevOps (stub) | GitHub Projects (stub) | Linear (stub) |
   |---|---|---|---|---|
   | Phase | **label / fixVersion** | Epic (parent) | Project field | Project/Milestone |
   | Epic | Epic | Feature | Issue + label | Project/Epic |
   | Story | Story | User Story | Issue | Issue |
   | Task | Task / Sub-task | Task | Sub-issue | Sub-issue |
   | Subtask | Sub-task | Task (child) | checklist/Sub-issue | Sub-issue |
   | Bug | Bug | Bug | Issue + label | Issue + label |

   For Jira v1, `Phase` is a **label** (or `fixVersion`) — deliberately **not** a custom issue type or Initiative. Where any native level is missing, the adapter declares its fallback in this file.
3. **Field mapping** — title, description (format: ADF / markdown / plain), acceptance criteria, DoD, priority, labels, components, status, links.
4. **Operations** — the exact MCP tool names + minimal argument shapes for: `getProjects`, `getIssueTypes`, `getStatuses`, `getComponents`, `createIssue`, `updateIssue`, `linkIssue`, `searchByExternalRef`.
5. **Bootstrap** — for a bare tracker: how to create the project / ensure issue types / schemes (used when state = "instance exists, project does not").
6. **Capabilities & limitations** — hierarchy depth limits, subtask support, required fields, rate notes.

Adding Azure DevOps later = write `azure-devops.md` against this contract. No skill changes.

---

## 7. Multi-agent architecture

Analysis and planning are performed by a panel of **stack-agnostic** subagents shipped in `agents/`. They are generic roles; the engineer agent **detects the stack from the repo** rather than assuming .NET.

| Agent | Responsibility |
|---|---|
| `product-owner` | business value, MVP boundary, priorities, phase assignment |
| `solution-architect` | architecture, boundaries, dependencies, technical risk |
| `senior-engineer` | engineering decomposition, refactoring, testing (stack auto-detected) |
| `data-engineer` | schema, indexes, constraints, migrations, data performance |
| `qa-lead` | acceptance criteria, regression risk, test planning |
| `devops-engineer` | CI/CD, monitoring, infra, deployment, security posture |
| `technical-writer` | doc consistency, duplicate detection, contradiction surfacing |
| `final-reviewer` | conflict resolution, hierarchy validation, blocks invalid sync |

**Rules:**

- Agents run **in parallel** and produce independent findings; they must **not assume the documentation is correct** (cross-check against code and against each other).
- `final-reviewer` is adversarial: it resolves disagreements, validates that the hierarchy has no skipped levels / orphans, and can **veto** a sync.
- Plugin-shipped agents cannot bundle their own MCP/hooks (Claude Code security rule). They **inherit the session MCP** configured by `setup-toolkit` — which is exactly what we want.

These agents are invoked primarily by `analyze-project` (full panel → Knowledge Model) and a subset by `build-project-model` (PO + architect + QA + final-reviewer → Planning Model + backlog).

---

## 8. Skills (v1)

All skills live in `skills/<name>/SKILL.md`. Invocation namespace: `/eng:<skill>`.

### 8.1 `setup-toolkit` (flagship)

- **Purpose:** make the platform usable in this repo. Choose provider; verify everything; persist `config.json`.
- **Flow:** pick provider → load `providers/<tracker>.md` → **detect MCP** → if absent: **STOP**, print exact MCP config + "restart Claude," do nothing else → if present: **verify-only** — confirm the project exists and read its statuses, issue types, fields, components → write `.eng/config.json`.
- **v1 limit:** if the project does not exist, instruct the user to create it manually. No automatic project/scheme creation (v2). Non-Jira providers are offered but flagged as **stubs** (not sync-ready).
- **Hard gate (tracker-touching only):** `sync-tracker` and any bare-tracker bootstrap refuse to run if `config.json` is missing or marks MCP unavailable. `analyze-project` / `build-project-model` / `knowledge-store` run **offline** (no tracker needed) and are not gated — they only require the store.

### 8.2 `knowledge-store`

- **Purpose:** guardian of `project-model.json` integrity. Not a parser.
- **Operations:** `init` (create empty model against schema), `validate` (schema + referential integrity: no orphan story/task, every story has AC, every task has DoD), `inspect` (human-readable summary), `migrate` (bump `schemaVersion`).
- Owns `schemas/project-model.schema.json` as the contract all skills validate against.

### 8.3 `analyze-project`

- **Purpose:** repo + docs → **Knowledge Model**.
- **Inputs:** `CLAUDE.md`, `README.md`, roadmap, bugs doc, architecture/, ADR, code-reviews/, `docs/`, `specs/`, plus code/git for cross-checking.
- **Process:** dispatch the full agent panel; merge duplicates; detect contradictions; never trust a single document. Writes `knowledgeModel` into the store.

### 8.4 `build-project-model`

- **Purpose:** Knowledge Model → **Planning Model** + **Backlog**.
- **Produces:** phase assignment, feature/bug/tech-debt classification, roadmap status, dedicated Tech-Debt and Bug epics, full `Phase→Epic→Story→Task→Subtask` with AC (G/W/T) and DoD. Writes `planningModel` + `backlog`. Never generates giant tasks.

### 8.5 `sync-tracker`

- **Purpose:** project the backlog into the tracker via the active adapter.
- **Modes:** `report` · `dry-run` (**default**) · `sync` · `validate`. Plus scoped runs: `roadmap` / `bugs` / `architecture` / `codereview`.
- **Safety:** never mutates the tracker before showing a diff. **Even in `sync` mode**, the skill renders the full create/update diff and **waits for an explicit user confirmation** before issuing any write call — `sync` is not "apply silently," it is "preview then ask." Runtime re-checks MCP availability and aborts gracefully if gone.
- **Reconciliation:** uses `trackerKey` + `searchByExternalRef` to decide create vs update; no duplicate epics/stories.
- **Final report:** created / updated / duplicates merged / conflicts / critical bugs / tech-debt / progress / coverage / recommended next sprint / risk analysis.

### 8.6 `detect-changes`

- **Purpose:** incremental updates. `git diff` since `source.commit` → which docs changed → which Knowledge/Planning/backlog nodes are now stale → re-run only that slice. Patches the store; avoids re-analyzing the whole repo each time.

### 8.7 Pre-sync validation (enforced by `knowledge-store validate` + `final-reviewer`)

No duplicate Epics/Stories · no orphan Tasks/Subtasks · AC present · DoD present · dependencies linked · priority/status/labels/components assigned.

---

## 9. Repository structure

```
engineering-toolkit/                    # repo (BloomCRM org), neutral name
├── .claude-plugin/
│   ├── marketplace.json                # marketplace "engineering-intelligence"
│   └── plugin.json                     # plugin "eng", semver, explicit version
├── skills/
│   ├── setup-toolkit/SKILL.md
│   ├── knowledge-store/SKILL.md
│   ├── analyze-project/SKILL.md
│   ├── build-project-model/SKILL.md
│   ├── sync-tracker/SKILL.md
│   └── detect-changes/SKILL.md
├── agents/
│   ├── product-owner.md
│   ├── solution-architect.md
│   ├── senior-engineer.md
│   ├── data-engineer.md
│   ├── qa-lead.md
│   ├── devops-engineer.md
│   ├── technical-writer.md
│   └── final-reviewer.md
├── references/
│   ├── providers/
│   │   ├── jira.md
│   │   ├── azure-devops.md
│   │   ├── github-projects.md
│   │   └── linear.md
│   ├── hierarchy.md                    # Phase→…→Subtask rules, AC & DoD templates
│   └── agents/                         # shared agent briefs / analysis protocol
├── schemas/
│   └── project-model.schema.json
├── docs/
│   └── specs/2026-06-30-engineering-toolkit-design.md   # this file
├── README.md
├── CHANGELOG.md
└── LICENSE
```

**Spec-grounded rules applied:** only `plugin.json`/`marketplace.json` go inside `.claude-plugin/`; every component dir is at repo root; multi-skill ⇒ `skills/<name>/SKILL.md` (no flat files); reference bundled files via `${CLAUDE_PLUGIN_ROOT}`; the repo is simultaneously a marketplace and the plugin it ships.

### 9.1 `plugin.json` (shape)

```json
{
  "$schema": "https://json.schemastore.org/claude-code-plugin-manifest.json",
  "name": "eng",
  "displayName": "Engineering Intelligence",
  "version": "0.1.0",
  "description": "Turn repository docs into a structured engineering backlog and sync it to any tracker.",
  "author": { "name": "Volodymyr Kostyrko" },
  "license": "MIT",
  "keywords": ["project-management", "backlog", "jira", "azure-devops", "agents"]
}
```

### 9.2 `marketplace.json` (shape)

```json
{
  "$schema": "https://json.schemastore.org/claude-code-marketplace.json",
  "name": "engineering-intelligence",
  "description": "Engineering Intelligence Platform — project-management plugins for Claude Code.",
  "owner": { "name": "Volodymyr Kostyrko" },
  "plugins": [
    { "name": "eng", "source": "./", "description": "Engineering Intelligence toolkit" }
  ]
}
```

### 9.3 Install UX

```
/plugin marketplace add BloomCRM/engineering-toolkit
/plugin install eng@engineering-intelligence
/eng:setup-toolkit
```

---

## 10. MCP detection strategy

- The plugin **does not bundle** a tracker MCP. `setup-toolkit` checks whether the session exposes the chosen tracker's tools (via the adapter's detection signatures).
- **Absent ⇒ STOP**: print the exact `.mcp.json` / connection config for that provider and instruct a Claude restart. No partial operation.
- `sync-tracker` re-verifies at the moment of sync and aborts gracefully if the MCP disappeared mid-session.

---

## 11. Versioning, testing, distribution

- **Versioning:** explicit semver in `plugin.json`, bumped every release; `CHANGELOG.md` per release.
- **Validation:** `claude plugin validate . --strict` must pass.
- **Local test:** `claude --plugin-dir ./engineering-toolkit` then `/eng:setup-toolkit`.
- **Smoke tests:** each skill exercised against a throwaway repo + a sandbox tracker project before tagging a release.

---

## 12. Build sequencing (for the implementation plan)

**v1 goal = one Jira-only happy path, end to end.** Re-ordered for hard dependencies (the store contract must exist before anything writes to it):

1. **Repo + plugin scaffold** — `marketplace.json`, `plugin.json`, README/LICENSE/CHANGELOG, validates clean, installs locally.
2. **`knowledge-store`** — schema + `init/validate/inspect/migrate`. (Foundation; everything writes through it.)
3. **`setup-toolkit`** + **`providers/jira.md`** — provider selection, MCP detection, **verify-only** Jira check (project/types/statuses/fields/components), config persistence. No project auto-creation.
4. **`analyze-project`** + agent panel — Knowledge Model.
5. **`build-project-model`** — Planning Model + backlog (`Phase`→label/fixVersion).
6. **`sync-tracker`** — `report` + `dry-run` first; then `sync` **with mandatory confirm**. Reconciliation + final report. **This closes the v1 happy path.**
7. **`detect-changes`** — incremental path.
8. **Adapter stubs** — `azure-devops.md`, `github-projects.md`, `linear.md`: mapping skeleton + `TODO: not sync-ready`. Offered by `setup-toolkit`, flagged as stubs.

> Note vs. the original numbering: `knowledge-store` is pulled **before** `analyze-project` because `analyze-project` writes into the store and must validate against its schema.
> Milestone definition of "v1 done": steps 1–6 run start-to-finish against a real Jira project and produce a confirmed (or previewed) backlog. Steps 7–8 are v1 follow-ups, not blockers for the first demo.

### 12.1 Future

- **v2:** make non-Jira adapters sync-ready (Azure DevOps first); automatic Jira project/scheme bootstrap; migrate existing skills **`product-audit`** and **`code-review`** into the plugin.
- **Later:** `project-health` · `sprint-planner` · `release-manager` · `adr-generator` · migrate `finish-day`.

---

## 13. Open questions

- **Description format for the Jira MCP** — Jira Cloud's REST API expects ADF; many Jira MCP servers accept markdown/plain and convert internally. The exact MCP in use (decided during `setup-toolkit`) determines whether `providers/jira.md` must emit ADF or can pass markdown. Resolve when the MCP is connected.
- **`fixVersion` vs `label` for `Phase`** — both are viable; `label` is zero-setup, `fixVersion` gives release-style grouping but must pre-exist. Default to `label` in v1; allow an override in `.eng/config.json`.

### Resolved

- Names: repo `engineering-toolkit` · marketplace `engineering-intelligence` · plugin `eng` (invocation `/eng:*`).
- Trackers: Jira sync-ready in v1; ADO/GitHub/Linear are stubs.
- No Jira project auto-creation in v1 (verify-only).
- `sync` always previews + confirms before mutating.
```
