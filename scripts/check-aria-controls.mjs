#!/usr/bin/env node
/**
 * check-aria-controls.mjs
 *
 * Verifies that every `aria-controls={X}` reference in a TSX/TS file resolves
 * to an `id={X}` attribute somewhere in the same file (or — for static
 * strings — anywhere in the repo). Catches the recurring "aria-controls
 * points to a panel that was renamed / removed / never mounted" archetype.
 *
 * Run via: npm run check:aria-controls
 * Direct: node scripts/check-aria-controls.mjs [--quiet]
 *
 * Exits 1 if any aria-controls reference has no matching id=.
 *
 * Patterns supported:
 *   - Static string:           aria-controls="theme-config-panel"
 *     Matches id="theme-config-panel" anywhere in src/.
 *   - JSX variable:            aria-controls={listId}
 *     Matches id={listId} in the same file.
 *   - JSX template literal:    aria-controls={`${tab.id}-popover`}
 *     Matches id={`${X}-popover`} in the same file, allowing the
 *     interpolated variable to differ (shape-equivalent match).
 *
 * Why this matters: ARIA references that point at non-existent IDs are
 * invisible to screen readers + assistive tech. They pass eslint, pass
 * compile, pass visual review — they only surface in accessibility audits
 * after they've already shipped to users.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const args = new Set(process.argv.slice(2));
const QUIET = args.has('--quiet');

// Tokens deliberately allowed even when the id is not co-located in src/
// (e.g., dynamically composed IDs that walk feature data). Add only when
// genuinely unconstrained.
const ALLOWLIST = new Set([]);

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// Strip JS/TS block + line comments before scanning so JSDoc/inline docs
// don't trigger false-positive matches.
function stripJsComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/.*$/gm, (_, prefix) => prefix);
}

function walkDir(dir, pattern, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, pattern, out);
    else if (pattern.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Find every `attrName={...}` JSX attribute occurrence in `text` and return
 * the captured expression (without the outer braces). Walks braces and
 * backticks so template-literal interpolations like `${tab.id}` don't
 * prematurely terminate the brace block.
 */
function collectJsxBraceAttrs(text, attrName) {
  const out = [];
  // Match `attrName=` followed by optional whitespace then `{`. Use a global
  // search that lets us pick up each occurrence's start, then walk forward
  // manually to find the matching closing `}`.
  const opener = new RegExp(`\\b${attrName}\\s*=\\s*\\{`, 'g');
  let m;
  while ((m = opener.exec(text)) !== null) {
    const start = m.index + m[0].length;
    let depth = 1;
    let inBacktick = false;
    let i = start;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (inBacktick) {
        if (ch === '`') {
          inBacktick = false;
        } else if (ch === '$' && text[i + 1] === '{') {
          depth++;
          i++; // skip `$`
        } else if (ch === '}') {
          // closing of `${...}` inside the template literal
          depth--;
        }
      } else {
        if (ch === '`') inBacktick = true;
        else if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
      i++;
    }
    if (depth === 0) {
      out.push({
        expr: text.slice(start, i - 1).trim(),
        index: m.index,
      });
    }
  }
  return out;
}

function indexToLine(text, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// Normalize a template literal by replacing every `${...}` interpolation with
// the placeholder `${EXPR}`. This lets us match shape-equivalent templates
// where the interpolated variables have different names (a button might write
// `${tab.id}` while the panel writes `${inspectorTab}` — both produce the
// same runtime string when tab.id === inspectorTab).
function normalizeTemplate(tmpl) {
  return tmpl.replace(/\$\{[^}]+\}/g, '${EXPR}');
}

// 1. Collect every `aria-controls=` reference from every tsx file.
const FILES = walkDir(SRC, /\.(tsx?|jsx?)$/);

const STATIC_STRING_RE = /aria-controls\s*=\s*"([^"]+)"/g;

// Refs to check. Each entry: { file, line, kind, value, raw }
const refs = [];

for (const file of FILES) {
  const rawText = readFileSafe(file);
  if (!rawText) continue;
  const text = stripJsComments(rawText);

  // Static-string aria-controls
  for (const match of text.matchAll(STATIC_STRING_RE)) {
    refs.push({
      file,
      line: indexToLine(text, match.index),
      kind: 'static',
      value: match[1],
      raw: text.slice(match.index, match.index + 80).split('\n')[0],
    });
  }
  // Brace-attribute aria-controls={...}
  const braceRefs = collectJsxBraceAttrs(text, 'aria-controls');
  for (const ref of braceRefs) {
    const expr = ref.expr;
    if (expr === 'undefined' || expr === 'null' || expr === 'false') continue;
    refs.push({
      file,
      line: indexToLine(text, ref.index),
      kind: expr.startsWith('`') ? 'template' : 'expression',
      value: expr,
      raw: text.slice(ref.index, ref.index + 80).split('\n')[0],
    });
  }
}

// 2. Build per-file index of id= occurrences, plus a global static-id set.
const fileIdIndex = new Map();
const globalStaticIds = new Set();

const ID_STATIC_RE = /\bid\s*=\s*"([^"]+)"/g;

for (const file of FILES) {
  const rawText = readFileSafe(file);
  if (!rawText) continue;
  const text = stripJsComments(rawText);
  const entry = { staticIds: new Set(), expressionIds: new Set(), templateIds: new Set() };
  for (const match of text.matchAll(ID_STATIC_RE)) {
    entry.staticIds.add(match[1]);
    globalStaticIds.add(match[1]);
  }
  const idAttrs = collectJsxBraceAttrs(text, 'id');
  for (const idAttr of idAttrs) {
    const expr = idAttr.expr;
    if (expr.startsWith('`')) entry.templateIds.add(expr);
    else entry.expressionIds.add(expr);
  }
  fileIdIndex.set(file, entry);
}

// 3. Match each aria-controls reference against the same file's ids.
const unresolved = [];

for (const ref of refs) {
  if (ALLOWLIST.has(ref.value)) continue;
  const sameFile = fileIdIndex.get(ref.file);
  if (!sameFile) continue;

  let resolved = false;
  if (ref.kind === 'static') {
    if (sameFile.staticIds.has(ref.value)) resolved = true;
    else if (globalStaticIds.has(ref.value)) resolved = true;
  } else if (ref.kind === 'expression') {
    if (sameFile.expressionIds.has(ref.value)) resolved = true;
  } else if (ref.kind === 'template') {
    if (sameFile.templateIds.has(ref.value)) {
      resolved = true;
    } else {
      const refShape = normalizeTemplate(ref.value);
      for (const idTemplate of sameFile.templateIds) {
        if (normalizeTemplate(idTemplate) === refShape) {
          resolved = true;
          break;
        }
      }
    }
  }

  if (!resolved) unresolved.push(ref);
}

if (unresolved.length === 0) {
  if (!QUIET) {
    console.log(`✓ check-aria-controls: ${refs.length} aria-controls references, all resolve to a matching id=.`);
    console.log(`  (${globalStaticIds.size} static id= attributes across ${FILES.length} files, ${ALLOWLIST.size} allowlisted refs.)`);
  }
  process.exit(0);
}

console.error(`✗ check-aria-controls: ${unresolved.length} aria-controls reference(s) with no matching id=`);
console.error('');
for (const ref of unresolved) {
  const rel = path.relative(ROOT, ref.file);
  console.error(`  ${rel}:${ref.line}  aria-controls=${ref.kind === 'static' ? `"${ref.value}"` : `{${ref.value}}`}`);
  console.error(`    ${ref.raw.trim()}`);
}
console.error('');
console.error('Fix: either rename the aria-controls value to point at an existing id,');
console.error('     add the missing id= attribute to the panel/region the trigger controls,');
console.error('     or add to ALLOWLIST in scripts/check-aria-controls.mjs if dynamically composed.');
process.exit(1);
