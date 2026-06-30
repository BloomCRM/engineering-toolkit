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
