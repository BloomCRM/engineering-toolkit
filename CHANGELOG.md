# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-07-03

First stable release. Completes the **v2.1 "faithful backlog" quality roadmap**
(items P, Q, M, L, I, F, H, G — the last eight before 1.0). Shipped incrementally
as 0.16.0–0.23.0; summarized here.

### Added
- **P — transitions by status category** (0.16.0): `sync-plan.mjs`
  `resolveTransitionByCategory` / `resolveTransitionForStatus` +
  `STATUS_CATEGORY_BY_INTENT`. The done-map resolves the Done/In-Progress
  transition by universal `statusCategory.key` (`new`/`indeterminate`/`done`),
  not by a localizable status name — robust on any Jira template.
- **Q — workflow-health check + recommended template** (0.17.0): `config.mjs`
  `checkWorkflowHealth(statuses)` + `STATUS_CATEGORIES` + `health` CLI. Verify-only
  WARNs on miscategorized statuses, >1 not-started status, or an empty category.
  `jira.md` §6a documents the recommended per-issue-type template (Epic 3-coarse /
  Story·Task·Bug 4 with In Review / Sub-task 3; drop `Feature`, English names).
- **M — completeness critic** (0.18.0): `knowledge-model.mjs`
  `findCoverageGaps(km, plans)` + `gapsToRisks` + `gaps` CLI. The critic tags each
  documented plan `coveredBy:<domainId|null>`; the script flags no-coverage and
  broken-coverage as `unknown` risks — surfaces documented-but-un-modelled work
  (caught the missed multi-service booking). `product-owner` now extracts
  planned-but-not-coded features as `status:planned` domains.
- **L — semantic domain dedup** (0.19.0): `knowledge-model.mjs`
  `suggestDomainMerges(domains)` (string-similar pre-pass) +
  `applyDomainMerges(km, merges)` (deterministic collapse: folds duplicates,
  remaps `dependsOn`, drops self-deps — closes the gap that `mergeFindings` is
  additive-by-id and cannot collapse) + `dedup`/`apply-merges` CLI.
  `final-reviewer` confirms string-similar and hunts meaning-similar duplicates.
- **I — ux-reviewer + security-engineer agents + configurable panel** (0.20.0):
  two clean-lane, grounded agents (absence → `risk: unknown`); `devops-engineer`
  drops the generic security bullet. `config.mjs` `KNOWN_AGENTS` (9) + `PANELS`
  (core 4 / standard 7 / deep 9) + `resolveAnalysisPanel` + `panel` CLI. ux+security
  run only on the deep tier, so default cost is unchanged.
- **F — timeline** (0.21.0): `planning-model.mjs` `parseGitDates(log)` (real
  commit-range dates for done work, timezone-aware) + `sequenceFutureEpics(epics)`
  (Kahn ordering by phase + `dependsOn`, stamps `sequence`; no fabricated dates
  for future work) + `git-dates` CLI. `normalizeModel` auto-stamps `sequence`.
- **G — conservative-update marker** (0.23.0): `sync-plan.mjs` `engHash` +
  `engHashLabel` + `readEngHash` + `decideDescriptionUpdate`. Each issue carries
  an `eng-hash:` label of the description eng wrote; re-sync overwrites only when
  the current text still hashes to that marker (eng owns it), else skips to
  protect a human edit. `--force-descriptions` for the known-safe first backfill.

### Changed
- **H — subtask granularity** (0.22.0): `planning-model.mjs` `countBacklog` +
  `checkGranularity` (`high-subtask-share` / `singleton-subtask` / `dense-story`)
  + `granularity` CLI. `build-project-model` guidance tightened — a sub-task must
  be independently meaningful; a one-subtask task *is* the task.
- `devops-engineer` scope narrowed to infra/CI/CD (app security moved to
  `security-engineer`).

### Notes
- 163 `node:test` cases green; `claude plugin validate --strict` green.
- 10 reviewer agents (added `ux-reviewer`, `security-engineer`).

## [0.15.0] - 2026-07-02

### Added (v2.1 item O — English on existing issues)
- `translate` skill (`/eng:translate`) — rewrites an existing model's text
  (titles, descriptions, acceptance criteria) to English **in place**, keeping
  every id/trackerKey and the structure, so the next sync *updates* the same
  issues (no duplicates). Distinct from a full re-run (which re-drafts → dupes).
  `translate.mjs` (`hasCyrillic`/`collectTranslatable`/`applyTranslations`) only
  targets non-English nodes; `sync-tracker` gets a **translation override** to
  push the rewritten text.

## [0.14.0] - 2026-07-02

### Added
- **Freshness-aware `/eng:run`** — in the synced (`review-drift`) state, a re-run
  now decides what to do instead of blindly re-analyzing: `recommendRerunMode`
  branches on (a) a git diff since `source.commit` and (b) whether a deterministic
  refresh would change anything. Three outcomes: **reanalyze** (repo moved),
  **refresh** (repo unchanged but the deterministic layer is stale — e.g. after a
  toolkit upgrade that added the done-map; runs `refresh-model` → sync, no
  agents), or **in-sync** (nothing to do). Backed by `normalizeWouldChange` +
  `planning-model.mjs would-change`.

## [0.13.0] - 2026-07-02

### Added
- `refresh-model` skill (`/eng:refresh-model`) — re-applies the deterministic
  planning layer (Done epic-status map, dedicated Tech-Debt/Bug epics, default
  DoD, priority, epic status) to an **existing** model **without re-analyzing or
  re-drafting**, preserving every id/trackerKey. Makes "add what's already done
  to the current backlog, no diff, no duplicates" a first-class toolkit
  operation instead of an out-of-toolkit manual step.
- `planning-model.mjs normalize --write` — write the normalized model back in
  place (reports the epic-count delta).

## [0.12.0] - 2026-07-02

### Added (v2.1 item A — done epic-status map)
- The backlog now shows **what's already built**: `normalize` generates a
  lightweight **Done** epic (`epic-done-<id>`, no stories) per `implemented`
  domain, and stamps `status` (`done`/`in-progress`/`todo`) on every epic.
- `sync-tracker` **transitions** epics to their status — create-then-transition,
  resolving the transition id by name at runtime (`Done` / `In Progress`).
  De-risked against BLM (Rovo exposes the transitions).
- `build-project-model` no longer drafts stories for implemented domains (they
  become deterministic Done epics), so the tracker is no longer to-do-only.

## [0.11.0] - 2026-07-02

### Added (v2.1 item K — done-detection depth)
- `reality-check` skill (`/eng:reality-check`) — greps production code for
  stub/mock/TODO/NotImplemented markers and flags `done` domains whose sources
  look fake, so the done-map never syncs a mock as `Done`. Deterministic
  `reality-scan.mjs` (`flagSuspects`/`buildRealityReport`); read-only report.
- `senior-engineer` agent sharpened: **"renders ≠ done"** — hunts stub-vs-real;
  a component with mock data or missing expected features is `partial`, not
  `implemented`.

## [0.10.0] - 2026-07-02

### Changed (v2.1 batch 1 — faithful-backlog rendering)
- **Priority** derived deterministically from `phase` (MVP→High … Enterprise→Lowest)
  and stamped on epics/stories; `sync-tracker` now sets the Jira priority (was
  all-Medium default).
- **Discipline tags** — task summaries rendered as `[BE]/[FE]/[DB]/…` from
  `task.category`, plus a `disc:<category>` label.
- **Category taxonomy** extended with `admin` and `design`; new orthogonal
  `needsDecision` flag on stories → `needs-decision` label + `[?]` prefix.
- **English output** — agents and build write all titles/descriptions/AC in
  English regardless of the repository's language.
- `sync-tracker` update path is now **conservative** — refreshes labels/tag/
  priority but won't clobber human-edited descriptions.

## [0.9.0] - 2026-07-02

### Added
- `run` skill (`/eng:run`) — a guided, approval-driven orchestrator that walks
  the pipeline one step at a time, computing the next step from the project's
  current state and pausing for approval between every stage. The tracker write
  keeps its own dry-run + explicit confirmation. Resumable. Deterministic state
  machine in `pipeline.mjs`.

## [0.8.0] - 2026-07-01

### Added
- `detect-changes` skill (`/eng:detect-changes`) — diffs the repo since the
  model's `source.commit`, maps changed files onto Knowledge Model entries via
  their `sources`, and reports the stale entries with an incremental re-analysis
  recommendation. Deterministic core in `change-plan.mjs`.

### Notes
- Completes the v1 skill set: setup-toolkit, analyze-project, build-project-model,
  sync-tracker, detect-changes, knowledge-store, skills.

## [0.7.0] - 2026-07-01

### Added
- `sync-tracker` skill (`/eng:sync-tracker`) — projects the backlog to Jira via
  the adapter with a deterministic `sync-plan.mjs` reconciliation planner
  (parent-first create/update, `eng-id:<id>` labels for idempotent re-sync).
  Modes: report, dry-run (default), sync, validate. `sync` always previews the
  diff and requires confirmation before writing.

## [0.6.0] - 2026-07-01

### Changed
- `setup-toolkit` now **connects the Jira MCP for you**: when none is detected it
  shows a popup choice (Atlassian Rovo OAuth / community mcp-atlassian token /
  skip), collects the token if needed, and runs `claude mcp add` itself instead
  of printing copy-paste instructions. Exact connection commands live in
  `references/providers/jira.md`. (A single Claude restart is still required for
  the new MCP tools to load.)

## [0.5.0] - 2026-07-01

### Added
- `build-project-model` skill (`/eng:build-project-model`) — classifies and
  drafts the backlog with the reviewer agents, then deterministically normalizes
  it via `planning-model.mjs` (guaranteed Tech-Debt and Bug epics, default
  Definition of Done, planning items derived from the Knowledge Model).

## [0.4.1] - 2026-07-01

### Changed
- `setup-toolkit` is now idempotent and non-blocking: an optional
  `claude plugin update eng` step, and an MCP step that — even when tools are
  detected — lets the user use them, re-detect, or **skip** (status stays
  `incomplete`, analyze/build keep working offline, sync stays blocked).

## [0.4.0] - 2026-07-01

### Added
- `analyze-project` skill (`/eng:analyze-project`) and an 8-agent reviewer panel
  in `agents/`, with a deterministic `knowledge-model.mjs` merge into the
  Knowledge Model and an adversarial final review.
- `references/findings-schema.md` — the JSON contract every agent returns.

## [0.3.0] - 2026-06-30

### Added
- `setup-toolkit` skill (`/eng:setup-toolkit`) — provider selection, runtime MCP
  detection, verify-only Jira project check, and `.eng/config.json` persistence,
  backed by a zero-dependency, unit-tested `config.mjs`.
- Provider adapters: `jira.md` (sync-ready) plus stubs for `azure-devops`,
  `github-projects`, `linear`.

## [0.2.0] - 2026-06-30

### Added
- `skills` skill (`/eng:skills`) — self-documenting list of every skill in the
  plugin with a short description, backed by a zero-dependency lister.

## [0.1.0] - 2026-06-30

### Added
- Plugin scaffold (`eng`) and `engineering-intelligence` marketplace.
- `knowledge-store` skill with `init / validate / inspect / migrate` over
  `project-model.json`.
- JSON Schema contract for the project model.
