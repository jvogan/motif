#!/usr/bin/env node
/**
 * check-css-tokens.mjs
 *
 * Verifies that every `var(--token)` reference in `src/` has a corresponding
 * `--token:` definition somewhere in `src/index.css`. This catches the recurring
 * "token-bypass" regressions such as an undefined `--bg-panel` making
 * popovers transparent, an invisible high-contrast workbar, or a popover
 * `boxShadow` referencing a nonexistent `--shadow-popover`.
 *
 * Run via: npm run check:css-tokens
 * Direct: node scripts/check-css-tokens.mjs [--quiet]
 *
 * Exits with code 1 if any var(--foo) reference has no :root definition.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// Collect `--token:` definitions from every CSS file in src/. This includes
// standalone artifact stylesheets that do not import src/index.css.
const CSS_DEF_FILES = walkDir(SRC, /\.css$/);

const args = new Set(process.argv.slice(2));
const QUIET = args.has('--quiet');

// Tokens that no stylesheet defines because JavaScript writes them at runtime.
//
// An entry here switches off the only check that would catch a typo in that
// token's name, so each one has to earn its place. `assertAllowlistIsLive()`
// below fails the run when nothing in src/ actually writes the variable,
// because this list had drifted into the opposite of its purpose: it carried
// 23 entries whose comments cited `src/store/ui-store.ts`,
// `applySelectionHighlightVars()` and `setMonochrome` — a file and two
// functions this repository does not contain. Twenty-one of the 23 were
// referenced nowhere, defined nowhere, and written nowhere, so they suppressed
// nothing but future typos.
//
// The two that a stylesheet did reference each hid a defect the checker was
// built to find. `--text-on-accent` left a primary button's label inheriting
// whatever colour its ancestor happened to carry. `--accent-hover` made a
// primary button's fill transparent on hover, dropping its label to 1.06:1 in
// the light themes — the word vanished under the pointer.
const ALLOWLIST = new Set([
  // Set per feature block as an inline style in
  // src/artifacts/motif-artifact.tsx. There is no sensible :root default: the
  // value is the feature's own colour.
  '--feature-color',
]);

// Strip CSS comments (`/* ... */`) before scanning to avoid false positives
// from docstrings that reference token names without using them.
function stripCssComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

// True if the `var(` reference is built from a template literal interpolation
// like `var(--badge-${type}-bg)`. The regex captures the static prefix; we
// can't statically determine which suffix lands, so skip these.
function isTemplateLiteralReference(snippet, matchIndex) {
  // If we see ${ somewhere between var( and the matching ) it's a template
  const after = snippet.slice(matchIndex);
  return /var\(\s*--[a-zA-Z0-9_-]+\s*\)?[^)]*\$\{/.test(after);
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function walkDir(dir, pattern, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, pattern, out);
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

// 1. Collect every `--foo:` declaration across all src/ stylesheets
// `detail-mode.css` is a sibling of `index.css`, paired with the lazy
// `DetailSequenceDisplay` chunk.
const defs = new Set();
for (const cssFile of CSS_DEF_FILES) {
  const cssText = stripCssComments(readFileSafe(cssFile));
  for (const match of cssText.matchAll(/--([a-zA-Z0-9_-]+)\s*:/g)) {
    defs.add('--' + match[1]);
  }
}

// 2. Walk src/ and src/index.css for every `var(--foo)` reference. Track
//    file:line for each so we can report exactly where to find the offender.
const REFERENCE_FILES = walkDir(SRC, /\.(tsx?|css|mjs|cjs)$/);
const references = new Map(); // token -> [{ file, line, snippet }]
for (const file of REFERENCE_FILES) {
  const raw = readFileSafe(file);
  const text = file.endsWith('.css') ? stripCssComments(raw) : raw;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const match of line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
      const token = match[1];
      // Skip template-literal references like var(--badge-${type}-bg)
      if (isTemplateLiteralReference(line, match.index)) continue;
      if (!references.has(token)) references.set(token, []);
      references.get(token).push({
        file: path.relative(ROOT, file),
        line: i + 1,
        snippet: line.trim().slice(0, 100),
      });
    }
  }
}

// 3. Every allowlisted token must be one JavaScript actually writes.
//
// The allowlist's whole claim is "a stylesheet does not define this because
// code sets it at runtime". That claim is checkable, and for twenty-one
// entries it was false. A variable nothing writes and nothing defines resolves
// to nothing, so a rule that names one is dead CSS -- and an allowlist entry
// for it is indistinguishable from a typo, which is precisely the thing this
// script exists to catch.
//
// Two ways to write a custom property reach the DOM: `setProperty('--x', v)`
// and a style-object key, `{ '--x': v }` in JSX. Both are literal enough to
// find without running anything.
const RUNTIME_WRITE_FILES = walkDir(SRC, /\.(tsx?|mjs|cjs)$/);
function findRuntimeWrites() {
  const writes = new Map(); // token -> { file, line }
  for (const file of RUNTIME_WRITE_FILES) {
    const lines = readFileSafe(file).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const patterns = [
        /setProperty\(\s*['"`](--[a-zA-Z0-9_-]+)['"`]/g,
        /['"](--[a-zA-Z0-9_-]+)['"]\s*:/g,
      ];
      for (const pattern of patterns) {
        for (const match of lines[i].matchAll(pattern)) {
          if (!writes.has(match[1])) {
            writes.set(match[1], { file: path.relative(ROOT, file), line: i + 1 });
          }
        }
      }
    }
  }
  return writes;
}

const runtimeWrites = findRuntimeWrites();
const deadAllowlist = [...ALLOWLIST].filter((token) => !runtimeWrites.has(token));
if (deadAllowlist.length > 0) {
  console.error(`✗ check-css-tokens: ${deadAllowlist.length} allowlisted token(s) that nothing writes`);
  console.error('  Each is allowlisted as runtime-set, but no setProperty() call and no');
  console.error('  style-object key in src/ ever sets it:');
  console.error('');
  for (const token of deadAllowlist) console.error(`  ${token}`);
  console.error('');
  console.error('Fix: delete the entry. If the token is genuinely needed, define it in a');
  console.error('     stylesheet, or write it at runtime so the allowlist tells the truth.');
  process.exit(1);
}

// 4. Identify references with no definition + not in allowlist.
const undefinedRefs = [];
for (const [token, hits] of references) {
  if (defs.has(token)) continue;
  if (ALLOWLIST.has(token)) continue;
  // Allow tokens that have a fallback inside var() itself: `var(--foo, fallback)`
  // is intentional — the fallback is the contract. We can't easily detect this
  // per-occurrence without parsing CSS, so we accept all but flag tokens that
  // NEVER appear with a fallback. Quick heuristic: if every reference uses a
  // fallback, treat as resolved.
  const allHaveFallback = hits.every((h) => {
    const ref = h.snippet;
    const idx = ref.indexOf(`var(${token}`);
    if (idx < 0) return false;
    const tail = ref.slice(idx + 4 + token.length);
    return /^\s*,/.test(tail);
  });
  if (allHaveFallback) continue;
  undefinedRefs.push([token, hits]);
}

if (undefinedRefs.length === 0) {
  if (!QUIET) {
    console.log(`✓ check-css-tokens: ${references.size} unique var(--token) references, all resolved.`);
    console.log(`  (${defs.size} tokens defined in src/index.css and src/**/*.css, ${ALLOWLIST.size} allowlisted dynamic vars.)`);
  }
  process.exit(0);
}

console.error(`✗ check-css-tokens: ${undefinedRefs.length} undefined CSS variable(s)`);
console.error(`  These tokens are referenced via var() but never defined in any src/ stylesheet :`);
console.error('');
for (const [token, hits] of undefinedRefs) {
  console.error(`  ${token}`);
  for (const hit of hits.slice(0, 3)) {
    console.error(`    ${hit.file}:${hit.line}  ${hit.snippet}`);
  }
  if (hits.length > 3) console.error(`    ...and ${hits.length - 3} more references`);
}
console.error('');
console.error('Fix: either define the token in a src/ stylesheet :root (and theme overrides),');
console.error('     pass an explicit fallback (var(--foo, #default)),');
console.error('     or add to ALLOWLIST in scripts/check-css-tokens.mjs if dynamic.');
process.exit(1);
