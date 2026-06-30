---
name: skills
description: |
  List every skill in the eng plugin with a one-line description. Use when the
  user asks "what skills are in eng", "list eng skills", "/eng:skills", "what
  can this toolkit do", or wants an overview of the platform's capabilities.
when_to_use: |
  Trigger on "list skills", "eng skills", "what skills do we have",
  "what can eng do", or any request to enumerate the plugin's commands.
allowed-tools: Bash(node *)
---

# eng:skills

Print every skill bundled in this plugin, each with a short description, so the
toolkit is self-documenting as it grows.

Run:

`node "${CLAUDE_PLUGIN_ROOT}/skills/skills/scripts/list-skills.mjs" "${CLAUDE_PLUGIN_ROOT}/skills"`

Show the output as-is — a bulleted list of `/eng:<name> — description`. Do not
editorialize or reorder; the script already sorts by name. Newly added skills
appear automatically, with no change to this skill.
