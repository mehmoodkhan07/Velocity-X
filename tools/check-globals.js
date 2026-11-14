// Loads every classic script exactly like the page does, in <script> order, and reports any
// top-level declaration that collides with another one. Two scripts sharing a top-level `const`
// kills the whole file at parse time in Chrome, which is invisible to `node --check`.
// Usage: node tools/check-globals.js
const fs = require('fs'), path = require('path'), vm = require('vm'), { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'web', 'index.html'), 'utf8');
const files = [...html.matchAll(/<script src="(js\/[^"?]+)/g)].map(m => m[1]);
if (!files.length) { console.error('check-globals: no scripts found in index.html'); process.exit(1); }

const seen = new Map();          // identifier -> file that declared it first
let problems = 0;

for (const rel of files) {
  const file = path.join(root, 'web', rel);
  const src = fs.readFileSync(file, 'utf8');
  // top-level declarations only: column 0, not inside any block
  const re = /^(?:const|let|var|function\*?|class|async function)\s+([A-Za-z_$][\w$]*)/gm;

  // `const A = 1, B = 2` - collect the extra names too
  const lists = [...src.matchAll(/^(?:const|let|var)\s+(.+)$/gm)].map(m => m[1]);
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    if (seen.has(name)) { console.error('DUPLICATE global "' + name + '": ' + seen.get(name) + ' and ' + rel); problems++; }
    else seen.set(name, rel);
  }
  for (const decl of lists) {
    // split on commas that are not inside (), [], {} or a string
    let depth = 0, quote = 0, cur = '';
    for (const ch of decl) {
      if (quote) { if (ch === quote) quote = 0; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { addName(cur); cur = ''; } else cur += ch;
    }
    addName(cur);
    function addName(part) {
      const n = (part.match(/^\s*([A-Za-z_$][\w$]*)\s*=[^=]/) || [])[1];
      if (!n) return;
      if (seen.has(n) && seen.get(n) !== rel) { console.error('DUPLICATE global "' + n + '": ' + seen.get(n) + ' and ' + rel); problems++; }
      else if (!seen.has(n)) seen.set(n, rel);
    }
  }

  // syntax check the file as a classic script (catches the same redeclaration at parse time)
  try { new vm.Script(src, { filename: rel }); }
  catch (e) { console.error('SYNTAX ' + rel + ': ' + e.message); problems++; }
}

console.log('check-globals: ' + files.length + ' scripts, ' + seen.size + ' globals, ' + problems + ' problem(s)');
process.exit(problems ? 1 : 0);
