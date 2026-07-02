---
name: analyze-project
description: |
  Analyze this repository with a panel of reviewer agents and build the
  Knowledge Model (domains, architecture, tech-debt, infra, security, risks)
  into .eng/project-model.json. Run after setup; before build-project-model.
when_to_use: |
  Trigger on "analyze the project", "build the knowledge model", "understand
  this repo", "/eng:analyze-project", or when build-project-model reports the
  knowledge model is missing.
allowed-tools: Bash(node *)
---

# analyze-project

Turn the repository into a Knowledge Model — the factual layer of
`.eng/project-model.json`. This skill does not touch a tracker.

Resolve paths once:
- `STORE="${CLAUDE_PLUGIN_ROOT}/skills/knowledge-store/scripts/store.mjs"`
- `KM="${CLAUDE_PLUGIN_ROOT}/skills/analyze-project/scripts/knowledge-model.mjs"`
- findings schema: `${CLAUDE_PLUGIN_ROOT}/references/findings-schema.md`

## Steps

1. **Ensure the store exists.** If `.eng/project-model.json` is missing, create it:
   `node "$STORE" init`.

2. **Discover inputs.** Collect the docs to review: `CLAUDE.md`, `README.md`,
   the roadmap, a bugs doc, `docs/`, `docs/architecture/`, `adr/`/ADR files,
   `docs/code-reviews/`, `specs/`. Note the current git commit (for `source`).

3. **Dispatch the agent panel — in parallel.** Spawn these eight subagents using
   the Task tool with the matching agent type, giving each the discovered inputs
   and the findings schema: `product-owner`, `solution-architect`,
   `senior-engineer`, `data-engineer`, `qa-lead`, `devops-engineer`,
   `technical-writer`. (Hold `final-reviewer` for step 5.) Each returns findings
   JSON. If a run is too large, scope agents to a subset of docs, but record what
   was skipped — never silently drop inputs.

4. **Merge deterministically.** Collect the seven JSON outputs into a JSON array,
   write it to a temp file, and run `node "$KM" merge <array.json>` to get the
   merged `knowledgeModel`. Write that object into `.eng/project-model.json`
   under `knowledgeModel`, and set `source.commit`/`branch`/`generatedAt`.

5. **Completeness critic (documented-but-un-modelled plans).** The panel is
   code-biased and under-extracts *planned* work that lives only in docs. So after
   the merge, run a critic pass over the **forward-planning docs** — the roadmap,
   `docs/next-session.md`, `specs/`, `docs/architecture/*`, any admin/product
   feedback doc: list every documented planned feature/roadmap item/TODO-feature.
   For each, judge whether an **existing merged domain already covers it**, and tag
   it `coveredBy: <domainId>` or `coveredBy: null`. Write the list as
   `[{ name, coveredBy, sources }]` to a temp file and run
   `node "$KM" gaps <km.json> <plans.json>` → `risks` of kind `unknown` for the
   real misses (no coverage, or coverage pointing at a non-existent domain). Merge
   those risks back (`node "$KM" merge` over `[currentKnowledgeModel, gapsOutput]`),
   and add a `planned`-status **domain** for any genuine feature that deserves its
   own backlog line. (This is what would have caught Bloom's missing
   *multi-service booking*.) Judge coverage semantically — a shared word like
   "booking" does **not** mean a distinct feature is covered.

6. **Adversarial final review.** Spawn the `final-reviewer` subagent with the
   merged `knowledgeModel`. Merge its returned findings back in the same way
   (`node "$KM" merge` over `[currentKnowledgeModel, reviewerFindings]`).

7. **Validate and report.** Run `node "$STORE" validate`; it must print `VALID`.
   Summarize: domain count, dependency edges, tech-debt by category, and the top
   risks (contradictions first).

## Rules

- **All output is English** — titles, notes, descriptions. Agents read any
  language (the repo may be non-English) but always write English.
- Agents must not trust a single document — contradictions become `risks`.
- The merge is deterministic (the script), not the model's opinion — always go
  through `knowledge-model.mjs`.
- This skill only writes `knowledgeModel` (+ `source`); it never writes the
  backlog (that is `build-project-model`).
