---
name: reality-check
description: |
  Scan the repo for stub/mock/TODO/NotImplemented markers and flag "done"
  domains (implemented/partial) whose source files look fake — so the done-map
  never syncs a mock as Done. Reads .eng/project-model.json; read-only report.
when_to_use: |
  Trigger on "reality check", "which done features are actually fake", "verify
  done", "/eng:reality-check", or before building/syncing the done-status map.
allowed-tools: Bash(node *), Bash(rg *), Bash(grep *)
---

# reality-check

Catch **fake-done** — a domain marked `implemented`/`partial` whose code is
actually a stub/mock/placeholder. This gates the done-map: a mock synced as
`Done` in the tracker is worse than leaving it unmapped.

Resolve paths once:
- `SCAN="${CLAUDE_PLUGIN_ROOT}/skills/reality-check/scripts/reality-scan.mjs"`

## Steps

1. **Require a Knowledge Model.** Read `.eng/project-model.json`. If
   `knowledgeModel.domains` is empty, stop and point to `/eng:analyze-project`.

2. **Grep production code for stub markers (exclude tests).** A mock in a test
   file is normal; a mock in production code is a smell. Produce a
   files-with-matches list to a scratch file, e.g.:
   ```
   rg -l -i -e 'TODO' -e 'FIXME' -e 'NotImplemented' -e 'throw new NotSupported' \
     -e 'Mock' -e 'Noop' -e 'Stub' -e 'placeholder' -e 'hardcoded' -e 'mock data' \
     --glob '!**/*[Tt]est*' --glob '!**/*.md' > "$TMP/hits.txt" || true
   ```
   (The marker list is `MARKERS` in the script. Fall back to `grep -rl` if `rg`
   is unavailable.)

3. **Map to domains.** Run `node "$SCAN" .eng/project-model.json "$TMP/hits.txt"`
   → suspects: `done` domains whose `sources` overlap the stub-hit files.

4. **Report (read-only).** List each suspect (id · status · matched sources) and
   the recommendation. **Do not silently change the model** — surface the
   suspects so a human or `/eng:analyze-project` can verify and downgrade
   `implemented → partial/planned` where the feature is genuinely a mock/stub.

## Rules

- Read-only — this skill reports; it does not edit the model or the tracker.
- Test files are excluded (mock-in-test is expected, not a smell).
- A suspect is **"verify this"**, not "confirmed fake" — hard signals point at
  likely stubs; a human/agent confirms.
- Feature-poverty (a real table with no sort/filter/search) is **not** caught
  here — that is a semantic gap for the `ux-reviewer`, not a greppable marker.
