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
allowed-tools: Bash(node *), Bash(claude plugin *)
---

# setup-toolkit

Make the platform usable in this repo. The result is `.eng/config.json` in the
**target repository** (one repo = one config). This skill is the only one that
deals with connecting a tracker; every other skill just reads the config.

Resolve the script and adapters once:

- `CONFIG="${CLAUDE_PLUGIN_ROOT}/skills/setup-toolkit/scripts/config.mjs"`
- adapters live in `${CLAUDE_PLUGIN_ROOT}/references/providers/<provider>.md`

This skill is **idempotent** — safe to re-run. It is also non-blocking: a missing
MCP no longer stops setup; the user can skip it and wire the tracker later.

1. **(Optional) Update the plugin first.** Offer to refresh the install:
   `claude plugin update eng`. If it reports an update was applied, tell the user
   that the new skills/agents only load after a **Claude restart** — but config
   setup below still works right now. Ask before running it; if the user declines,
   skip straight to step 2.

2. **Choose provider.** Ask the user: `jira` (sync-ready) · `azure-devops` ·
   `github-projects` · `linear`. State clearly that everything except `jira` is
   a **stub** (selectable, but `sync-tracker` will refuse until implemented).

3. **Load the adapter** `references/providers/<provider>.md` and read its
   Detection section.

4. **Detect the MCP — then let the user choose.** Search the session's available
   tools for the adapter's signatures (use ToolSearch, e.g. query `"jira"`).
   - **If found:** show which tools were detected and offer three choices:
     1. **Use these** (default) — record the exact tool names for step 6.
     2. **Re-detect** — e.g. after connecting a different MCP; search again.
     3. **Skip for now** — leave `mcp.available = false`; status will be
        `incomplete` (analyze/build still work offline; sync stays blocked).
   - **If none found:** offer two choices:
     1. **Connect now** — print the adapter's connection instructions and tell the
        user to configure the MCP and **restart Claude**, then re-run setup.
     2. **Skip for now** — proceed offline; status `incomplete`.

5. **Verify-only (Jira)** — only if an MCP is in use (not skipped). Using the
   detected tools:
   - list projects; ask the user for the `project.key` and confirm it exists.
     If it does not exist, instruct manual creation in Jira and stop — **never
     auto-create the project**.
   - read issue types, statuses, components; keep them for the config.

6. **Persist config.**
   - Scaffold: `node "$CONFIG" init <provider>` (add `--force` only if the user
     confirms overwriting an existing config).
   - Edit `.eng/config.json` to fill in: `mcp.available`, `mcp.detectedTools`
     (the exact names from step 4 — empty if skipped), `mcp.checkedAt` (an ISO
     timestamp), `project.key` and the read `issueTypes` / `statuses` /
     `components`, and `mappings.phaseField` (`label` by default, `fixVersion` if
     the user prefers).
   - Set `providerStatus`: `stub` for non-Jira; for Jira use `ready` only when
     MCP is available AND `project.key` is set, otherwise `incomplete`.
   - Validate: `node "$CONFIG" validate` — must print `VALID` before you report
     success. If it prints errors, fix the fields and re-validate.

7. **Report.** Show the final provider, status, project key, and the detected
   tools. If status is `incomplete` or `stub`, tell the user exactly what is
   missing and what unblocks it (e.g. "connect a Jira MCP and re-run setup").

## Rules

- Never auto-create a Jira project (v1 is verify-only).
- Non-Jira providers are always `stub` in this version.
- The config lives in the target repo (`${CLAUDE_PROJECT_DIR}/.eng/`), never in
  plugin data.
- Do not proceed to sync if `validate` fails.
