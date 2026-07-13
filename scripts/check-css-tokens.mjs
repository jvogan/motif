#!/usr/bin/env node
/**
 * check-css-tokens.mjs
 *
 * Verifies that every `var(--token)` reference in `src/` has a corresponding
 * `--token:` definition somewhere in `src/index.css`. This catches the recurring
 * "token-bypass" archetype that hit Phase 24 (`--bg-panel` undefined → transparent
 * popovers), Phase 28.5 (HC workbar invisible), and Phase 32 Pass-Tokens P0-3
 * (popover boxShadow referencing nonexistent `--shadow-popover`).
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

// Tokens whose definition is deliberately external or runtime (theme color
// palettes that get inlined as accent overrides via JS, browser-internal vars).
// Add here only when a token is genuinely unconstrained.
const ALLOWLIST = new Set([
  // CSS-wide root vars set dynamically in JS theme code
  '--accent', '--accent-rgb',
  '--accent-bg-soft', '--accent-bg-medium', '--accent-bg-strong',
  '--accent-border', '--accent-border-active',
  '--accent-hover', '--accent-dim',
  '--text-on-accent',
  // Selection highlight palette (4 user-pickable variants)
  '--selection-highlight', '--selection-highlight-rgb',
  // VOG-2161 follow-up: `--selection-fg-override` is INLINE-SET by
  // `applySelectionHighlightVars()` in `src/store/ui-store.ts` only for
  // palettes that demand a deliberate base-fg swap (charcoal +
  // monochrome). Default blue/amber/green/pink palettes leave it
  // unset on purpose — that's how the line-class CSS rule
  // (`[data-line-has-selection][data-sequence-bases] span`) gates
  // itself to NOT regress coloring-mode visuals on default palettes.
  // Defining a `:root` default would defeat that gate, so the variable
  // is intentionally runtime-only.
  '--selection-fg-override',
  // Monochrome theme — applied via ui-store setMonochrome at runtime
  '--mono', '--mono-softer', '--mono-border', '--mono-medium', '--mono-swatch',
  '--mono-feature-bg',
  // Phase 35 P-Q (Fix #1+2): mono 3-stop ladder + feature foreground are also
  // applied dynamically at runtime through `MONOCHROME_INLINE_VARS`. They're
  // never defined in :root because they don't have a non-mono semantic — they
  // exist only as inline overrides.
  '--mono-base', '--mono-base-strong', '--mono-base-muted',
  '--mono-feature-fg',
  // Claude Science artifact feature ribbons — set inline per feature block
  // in src/artifacts/motif-artifact.tsx.
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
// (Phase 41 W2: detail-mode.css is a sibling of index.css, paired with
// the lazy DetailSequenceDisplay chunk).
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

// 3. Identify references with no definition + not in allowlist.
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
