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
