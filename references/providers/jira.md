# Provider adapter: Jira (sync-ready)

The skill speaks only Epic / Story / Task / Subtask / Bug. This file maps that
vocabulary onto Jira and tells the skill how to drive whichever Jira MCP is
connected. **Do not hardcode a vendor** — detect the tools at runtime and bind
the real names from this table.

## 1. Detection

A Jira MCP is present if the session exposes any tool whose name matches
`/jira/i`. Use ToolSearch (query `"jira"`) or the tool list to find them.

Two common vendors:

| Vendor | Tool-name shape | Example |
|---|---|---|
| Atlassian official (Rovo / Remote MCP) | camelCase, `*Jira*` | `createJiraIssue`, `searchJiraIssuesUsingJql`, `getVisibleJiraProjects` |
| Community `mcp-atlassian` (sooperset) | snake_case, `jira_*` | `jira_create_issue`, `jira_search`, `jira_get_all_projects` |

The actual tools may carry an MCP server prefix (e.g. `mcp__atlassian__…`). Match
on the substring, record the **exact** discovered names into
`config.mcp.detectedTools`.

## 2. Hierarchy mapping (v1)

| Platform | Jira |
|---|---|
| Phase | **label** (default) or `fixVersion` — never a custom issue type |
| Epic | Epic |
| Story | Story |
| Task | Task |
| Subtask | Sub-task |
| Bug | Bug |

## 3. Field mapping

| Platform field | Jira field | Notes |
|---|---|---|
| title | `summary` | |
| description | `description` | Jira Cloud REST expects ADF; many MCPs accept markdown and convert. Confirm with the connected MCP (see Open Questions in the spec). |
| acceptanceCriteria | appended into `description` (G/W/T block) | No native AC field in core Jira |
| definitionOfDone | appended into `description` (checklist) | |
| priority | `priority` | |
| phase | `labels` (one label) or `fixVersions` | per `config.mappings.phaseField` |
| type | issue type | from §2 |
| trackerKey | issue key (e.g. `BLOOM-123`) | stored back into the model |

## 4. Operations (logical → example tool names)

Bind the actual tool at runtime; names below are examples per vendor.

| Operation | Atlassian official | Community `mcp-atlassian` |
|---|---|---|
| list projects | `getVisibleJiraProjects` | `jira_get_all_projects` |
| project issue-type metadata | `getJiraProjectIssueTypesMetadata` | (from project metadata / `jira_search`) |
| statuses | `getJiraIssueTypeStatuses` / transitions | `jira_get_transitions` |
| create issue | `createJiraIssue` | `jira_create_issue` |
| update issue | `editJiraIssue` | `jira_update_issue` |
| get issue | `getJiraIssue` | `jira_get_issue` |
| search (JQL) | `searchJiraIssuesUsingJql` | `jira_search` |
| link issues | `createJiraIssueLink` *(if available)* | `jira_create_issue_link` |

`searchByExternalRef`: find an already-synced issue by storing the platform
`id` in a label or in `description`, then querying with JQL
(`labels = "eng-id:<id>"`). Used by `sync-tracker` to decide create vs update.

## 5. Bootstrap (v1 = verify-only)

Do **not** create the project. Read-only checks:
1. list projects → confirm the user's `project.key` exists.
2. read issue types → confirm Epic / Story / Task / Sub-task / Bug exist (or the
   closest equivalents); record into `config.project.issueTypes`.
3. read statuses and components → record into config.
If the project is missing, instruct the user to create it manually in Jira, then
re-run setup.

## 6. Capabilities & limitations

- Standard Jira has no native level above Epic → `Phase` is a label/fixVersion.
- No native acceptance-criteria field → folded into the description.
- Subtasks require the parent to exist first (create order: Epic → Story → Task →
  Sub-task).
- Rate limits apply on Jira Cloud; batch conservatively.
- **Transitions resolve by status CATEGORY, not name.** A transition's target
  status carries a `statusCategory.key` of `new` / `indeterminate` / `done` —
  these three are universal across every Jira template, whereas status *names*
  are renamed/localized per project. `sync-tracker` uses
  `resolveTransitionForStatus` (in `sync-plan.mjs`) to pick the transition id by
  category, so the done-map works on any workflow. Transition ids are
  per-project — always resolve them at runtime from a live `getTransitions`.

## 6a. Recommended project template (advisory)

`setup-toolkit` only **verifies** and **warns** — it never edits a user's Jira
(no admin tools exist on the Rovo MCP). When its workflow-health check flags
problems, point the user at this template as the fix to apply by hand in the
Jira UI.

**Issue types:** `Epic` / `Story` / `Task` / `Sub-task` / `Bug`. Drop `Feature`
(unused; `Story`/`Task` cover it) and use the **English** canonical names —
locale-rendered type names have already caused "valid issue type" sync errors.

**Per-issue-type workflows.** Team-managed Jira allows a distinct workflow per
issue type. An Epic is a long-lived container whose real signal is child
completion %, so it stays coarse; a Story/Task/Bug has a genuine dev+QA
lifecycle:

| Issue type | Statuses (one column each) |
|---|---|
| **Epic** | To Do → In Progress → Done (coarse — 3) |
| **Story / Task / Bug** | To Do → In Progress → In Review → Done (4) |
| **Sub-task** | To Do → In Progress → Done (3) |

**Rules:**
- **1 status = 1 column** within each type's workflow.
- Every status sits in its **correct category** — `To Do` → `new`,
  `In Progress`/`In Review` → `indeterminate`, `Done` → `done`. Miscategorized
  statuses make category-based boards and reports lie.
- **No duplicate not-started statuses** — one `To Do`, not the
  Backlog + Idea + To Do triplication.

This template is safe for the toolkit to automate against **only because of the
category-based transition resolution** (see §6): the done-map is agnostic to
each type's exact status set, so it works whether an Epic has 3 statuses or a
Story has 4.

## 7. Connection (automated setup)

`setup-toolkit` runs these itself after the user picks an option in a popup.
Both require a **full Claude restart** afterwards so the MCP tools load.

### Option A — Atlassian official (Rovo Remote MCP) — recommended for Jira Cloud

No token; the user authorizes via OAuth in the browser on the next start.
Detected tools look like `getVisibleJiraProjects`, `createJiraIssue`,
`searchJiraIssuesUsingJql`.

```
claude mcp add --transport sse atlassian https://mcp.atlassian.com/v1/sse
```

Inputs needed: none. After adding, restart Claude and approve the Atlassian
OAuth consent.

### Option B — Community mcp-atlassian (sooperset) — token-based

Good for Jira Server/Data Center or an API-token preference. Detected tools look
like `jira_get_all_projects`, `jira_create_issue`, `jira_search`.

- **Prerequisite:** Docker (`docker --version`).
- **Inputs:** `JIRA_URL` (e.g. `https://your-domain.atlassian.net`),
  `JIRA_USERNAME` (account email), `JIRA_API_TOKEN`
  (from `https://id.atlassian.com/manage-profile/security/api-tokens`).

```
claude mcp add atlassian -- docker run -i --rm \
  -e JIRA_URL=<url> \
  -e JIRA_USERNAME=<email> \
  -e JIRA_API_TOKEN=<token> \
  ghcr.io/sooperset/mcp-atlassian:latest
```

The skill masks the token when echoing the command before running it.
