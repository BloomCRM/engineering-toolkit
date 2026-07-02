# Engineering Intelligence Platform (`eng`)

A Claude Code plugin that turns a repository's documentation and code into a
structured engineering backlog and synchronizes it to your issue tracker.

- **Source of truth:** git docs + code.
- **Brain:** `.eng/project-model.json` (the knowledge-store) — not Jira, not Markdown.
- **Trackers:** Jira (v1, sync-ready). Azure DevOps / GitHub Projects / Linear are stubs.

## Requirements

- Claude Code (`claude` CLI on PATH)
- Node.js ≥ 18

## Install

```bash
/plugin marketplace add BloomCRM/engineering-toolkit
/plugin install eng@engineering-intelligence
```

## Skills

| Skill | Purpose |
|---|---|
| `/eng:run` | Guided, approval-gated pipeline (setup -> analyze -> build -> sync) |
| `/eng:analyze-project` | Multi-agent analysis of the repo into the Knowledge Model |
| `/eng:build-project-model` | Knowledge Model -> Planning Model + backlog (epics/stories/tasks) |
| `/eng:refresh-model` | Re-apply deterministic layer (done-map/priority) to an existing model, no re-draft |
| `/eng:sync-tracker` | Push the backlog to Jira (dry-run default; confirm before write) |
| `/eng:detect-changes` | Diff since last analysis; report stale model entries |
| `/eng:reality-check` | Flag "done" domains that may actually be stubs/mocks |
| `/eng:setup-toolkit` | Choose a tracker, detect its MCP, verify the project, save config |
| `/eng:skills` | List every skill in the plugin with a short description |
| `/eng:knowledge-store` | Init / validate / inspect / migrate the project model |

> More skills (`setup-toolkit`, `analyze-project`, `build-project-model`,
> `sync-tracker`, `detect-changes`) land in later milestones — see
> `docs/specs/2026-06-30-engineering-toolkit-design.md`.

## License

MIT
