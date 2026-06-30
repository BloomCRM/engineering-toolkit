# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
