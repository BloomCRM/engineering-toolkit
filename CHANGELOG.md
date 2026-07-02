# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
