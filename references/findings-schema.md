# Agent findings schema

Every reviewer agent in `agents/` returns **only** a single JSON object with
these six arrays (use `[]` for sections you have nothing for). `id` must be a
short stable kebab-case string, unique within your own output.

```json
{
  "domains":        [{ "id": "calendar", "name": "Calendar", "status": "implemented|partial|planned|unknown", "dependsOn": ["bookings"], "sources": ["docs/x.md"] }],
  "architecture":   [{ "id": "arch-rls", "note": "one sentence", "sources": ["docs/arch.md"] }],
  "techDebt":       [{ "id": "td-1", "title": "one sentence", "category": "Architecture|Performance|Reliability|Security|Scalability|Testing|Infrastructure|Coding Standards|Documentation", "severity": "low|medium|high", "sources": ["..."] }],
  "infrastructure": [{ "id": "infra-ci", "note": "one sentence", "sources": ["..."] }],
  "security":       [{ "id": "sec-1", "note": "one sentence", "sources": ["..."] }],
  "risks":          [{ "id": "risk-1", "title": "one sentence", "kind": "contradiction|unknown|hotspot", "sources": ["..."] }]
}
```

Rules for every agent:
- **Do not trust a single document.** Cross-check claims against code and against
  other docs; when a doc and the code disagree, emit a `risk` with
  `kind: "contradiction"`.
- Always cite `sources` (file paths, optionally `#Lnn`).
- Stay in your lane (see your agent file), but you may add `risks` for anything
  that looks wrong.
- **Write all field text (names, notes, titles) in English**, regardless of the
  repository's language. Read any language; always write English.
- Return JSON only — no prose, no code fences.
