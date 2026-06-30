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
