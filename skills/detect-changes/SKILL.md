---
name: detect-changes
description: |
  Diff the repo since the commit the model was built from and report which
  Knowledge Model entries are now stale, so you can re-analyze incrementally
  instead of re-running the whole project. Reads .eng/project-model.json.
when_to_use: |
  Trigger on "what changed", "detect changes", "is the model stale", "what needs
  re-analysis", "/eng:detect-changes", or before a re-sync when the repo has
  moved on since the last analysis.
allowed-tools: Bash(node *), Bash(git *)
---

# detect-changes

Find what moved in the repo since the Knowledge Model was built, and point at the
minimal re-analysis — not a full re-run.

Resolve paths once:
- `CHANGE="${CLAUDE_PLUGIN_ROOT}/skills/detect-changes/scripts/change-plan.mjs"`

## Steps

1. **Read the baseline.** Load `.eng/project-model.json` and read
   `source.commit`. If it is missing, stop and tell the user to run
   `/eng:analyze-project` first (there is no baseline to diff against).

2. **Diff since baseline.** Run:
   `git diff --name-status <source.commit>..HEAD > "$TMP/diff.txt"`
   (use a scratch temp file). Also note `git rev-parse HEAD` as the new head.
   If `<source.commit>` is unknown to git (history rewritten), say so and fall
   back to recommending a full `/eng:analyze-project`.

3. **Map to the model.** Run
   `node "$CHANGE" report .eng/project-model.json "$TMP/diff.txt"` to get the
   stale-entry report.

4. **Report.** Show: baseline commit → HEAD, the changed files, the stale entries
   per section (domains / architecture / tech-debt / infra / security / risks),
   and the recommendation. Make the incremental action concrete, e.g. "3 stale
   domains touch `docs/...`; re-run `/eng:analyze-project` then
   `/eng:build-project-model`".

## Rules

- This skill is read-only — it reports; it does not modify the model or the
  tracker.
- It maps changes via each entry's `sources`; a changed file that no entry cites
  means the model may be missing coverage — recommend a full re-analysis.
- Prefer the smallest re-run: only what is stale, not the whole repo.
