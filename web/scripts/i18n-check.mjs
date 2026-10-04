// Lists UI strings (t('...') calls and label maps) missing in the pl / ru dictionaries.
// Usage: node scripts/i18n-check.mjs [--json]
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../src');
const files = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f) && !p.includes(`${path.sep}i18n${path.sep}`)) files.push(p);
  }
};
walk(root);
const keys = new Set();
const unq = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"');
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(unq(m[1]));
  for (const m of src.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(unq(m[1]));
  // Values of *_LABEL(S) / *_STATUS maps and `label: '...'` entries are translated with t(map[x]).
  for (const block of src.matchAll(/const [A-Z_]*(?:LABELS?|STATUS|CATEGORIES|TYPES|REASONS|KINDS)\b[^=]*=\s*(\{[\s\S]*?\n\};|\[[\s\S]*?\n\];)/g)) {
    for (const m of block[1].matchAll(/(?::|title:|desc:|label:)\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(unq(m[1]));
  }
}
const load = (lang) => {
  const src = fs.readFileSync(path.join(root, 'i18n', `${lang}.ts`), 'utf8');
  const dict = new Set();
  for (const m of src.matchAll(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:/gm)) dict.add(unq(m[1] ?? m[2]));
  return dict;
};
// Values extracted from label maps that are not UI texts (colours, map keys, KB data).
const IGNORE = new Set(['', 'api', 'blue', 'green', 'orange', 'interval', 'limit', 'price', 'stock']);
for (const k of [...keys]) if (IGNORE.has(k) || /[\u0400-\u04FF]/.test(k) || /[ąćęłńóśźż]/i.test(k)) keys.delete(k);
const result = {};
for (const lang of ['pl', 'ru']) {
  const d = load(lang);
  result[lang] = [...keys].filter((k) => !d.has(k)).sort();
}
if (process.argv.includes('--json')) console.log(JSON.stringify({ all: [...keys].sort(), missing: result }, null, 1));
else {
  console.log(`UI strings: ${keys.size}`);
  for (const [l, miss] of Object.entries(result)) console.log(`${l}: ${miss.length} missing`);
}
