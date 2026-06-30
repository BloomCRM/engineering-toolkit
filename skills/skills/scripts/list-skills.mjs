// Zero-dependency lister: reads the frontmatter of every skill in a plugin's
// skills/ directory and prints "/eng:<name> — <short description>".
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Minimal YAML-frontmatter reader: supports inline values and block scalars
// (`key: |` / `key: >`). Stops a block at the next column-0 key.
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const lines = text.slice(3, end).replace(/^\r?\n/, '').split(/\r?\n/);
  const map = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z][\w-]*):\s?(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val === '' || val === '|' || val === '>' || val === '|-' || val === '>-') {
      const collected = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
        collected.push(lines[++i].trim());
      }
      val = collected.join(' ');
    }
    map[key] = collapse(val);
  }
  return map;
}

export function listSkills(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  const out = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(file)) continue;
    const fm = parseFrontmatter(readFileSync(file, 'utf8'));
    out.push({ name: (fm.name || entry.name).trim(), description: collapse(fm.description) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function shortDesc(description, max = 100) {
  const d = collapse(description);
  return d.length <= max ? d : d.slice(0, max - 1).trimEnd() + '…';
}

export function formatSkills(skills) {
  if (!skills.length) return 'No skills found.';
  return skills.map((s) => `• /eng:${s.name} — ${shortDesc(s.description)}`).join('\n');
}

function isMain() {
  return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMain()) {
  const dir = process.argv[2] || join(process.cwd(), 'skills');
  console.log(formatSkills(listSkills(dir)));
}
