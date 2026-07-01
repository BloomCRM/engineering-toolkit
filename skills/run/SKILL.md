---
name: run
description: |
  Guided, approval-driven orchestrator for the eng pipeline. Walks
  setup -> analyze -> build -> sync ONE step at a time, pausing for your approval
  between every stage. Resumes from wherever the project currently is.
when_to_use: |
  Trigger on "run the pipeline", "run eng", "start the backlog flow", "/eng:run",
  "do the whole thing", or when the user wants a guided first run without
  invoking each skill by hand.
allowed-tools: Bash(node *)
---

# run

A guided orchestrator. It runs the pipeline **one step per approval** — never a
blind chain, and never a tracker write without an explicit second confirmation.
Re-run it anytime; it resumes from the current state.

Resolve paths once:
- `PIPE="${CLAUDE_PLUGIN_ROOT}/skills/run/scripts/pipeline.mjs"`
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`

## The loop

Repeat until the user stops:

1. **Ensure the store exists.** If `.eng/project-model.json` is missing, run
   `node "$STORE" init`.

2. **Compute state.** Run
   `node "$PIPE" state .eng/config.json .eng/project-model.json`. It returns the
   presence flags and a single `nextStep` (`setup` / `analyze` / `build` / `sync`
   / `review-drift`) with a reason.

3. **Orient the user.** Say plainly where they are (config? model? backlog?
   synced?) and what the recommended `nextStep` is and why.

4. **Ask approval — one step only.** Offer: run this step · skip it · stop here.
   Do not proceed without a yes. If they stop, end cleanly (state is saved).

5. **Run exactly one step** (on approval), by invoking the matching skill:
   - `setup` → `/eng:setup-toolkit`
   - `analyze` → `/eng:analyze-project`, then summarize the Knowledge Model
     (domain count, top risks) so they can review before building.
   - `build` → `/eng:build-project-model`, then summarize the backlog
     (epics/stories/tasks, bugs, tech-debt) so they can review before syncing.
   - `sync` → **two gates.** First `/eng:sync-tracker` in **dry-run** and show the
     plan. Then ask a SEPARATE explicit question: "apply these changes to Jira?"
     Only on an explicit yes, run `/eng:sync-tracker sync`. If the config is not
     `ready`, say sync is blocked and point to finishing `/eng:setup-toolkit`
     (the offline steps are already done).
   - `review-drift` → `/eng:detect-changes`; if entries are stale, offer to re-run
     `analyze` (incrementally); if nothing is stale, report the project is in sync
     and stop.

6. **Recompute and propose the next step** (back to 2). Never batch several steps
   behind one approval.

## Rules

- One step per approval. Recompute state after every step.
- The tracker write (`sync`) always needs its own dry-run + a second explicit yes.
- The human running this approves every stage — that is the point; do not
  optimize the approvals away.
- Fully resumable: re-running `/eng:run` continues from the current state.
- This skill adds no domain logic — it only sequences the other skills.
