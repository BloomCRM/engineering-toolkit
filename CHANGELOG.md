# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
