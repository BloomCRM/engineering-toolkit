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
