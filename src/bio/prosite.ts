/**
 * PROSITE-style pattern syntax for advanced motif search (the "user-defined
 * pattern as an anchor" used by PHI-BLAST). This is the protein-world standard
 * for describing functional motifs, and it works for nucleotides too.
 *
 * Supported grammar (the PROSITE pattern subset):
 *   - elements are separated by `-`           e.g.  C-x-H-x-[LIVMFY]
 *   - `x`            any single residue
 *   - `[ALT]`        one of A, L, or T
 *   - `{ALT}`        any residue EXCEPT A, L, T
 *   - a bare letter  that exact residue        e.g.  G
 *   - `e(n)`         exactly n of element e     e.g.  x(3)  or  [AG](2)
 *   - `e(n,m)`       n to m of element e        e.g.  x(2,4)
 *   - `<`            anchor to the sequence start (N-terminus)
 *   - `>`            anchor to the sequence end   (C-terminus)
 *
 * Example — the canonical N-glycosylation site:  N-{P}-[ST]-{P}
 * Example — a C2H2 zinc finger core:  C-x(2,4)-C-x(3)-[LIVMFYWC]-x(8)-H-x(3,5)-H
 *
 * This module ONLY translates a PROSITE pattern to a regex SOURCE string; the
 * actual matching (overlap handling, match limits, windowing) is done by the
 * existing motif engine in `sequence-formatting.ts`, so PROSITE patterns flow
 * through the live preview, the highlight hit-map, and the saved-rule traversal
 * with no extra wiring.
 */

export type PrositeAlphabet = 'dna' | 'rna' | 'protein';

// Any of these characters means the user is writing a PROSITE pattern rather
// than a plain IUPAC string (ATGN). Lowercase `x` is the PROSITE "any residue"
// token — detection runs on the RAW pattern (before upper-casing) so it survives.
const PROSITE_SYNTAX = /[-[\]{}()<>]|x/;

/** True when `pattern` uses PROSITE syntax (and should be parsed as such). */
export function isPrositePattern(pattern: string): boolean {
  return PROSITE_SYNTAX.test(pattern.replace(/\s+/g, ''));
}

const REPEAT_LIMIT = 5000; // guard against `x(999999)` blowing up the regex

/**
 * Translate a PROSITE pattern to a regex source string (no flags, no wrapping
 * group). Returns null for an empty or syntactically invalid pattern — callers
 * surface that as "invalid pattern" rather than "0 matches".
 *
 * `[set]`/`{set}` keep their explicit residues; `x` and `{set}` use `[A-Z]` /
 * `[^set]`, which is correct for clean letter-only sequences regardless of
 * alphabet. `alphabet` is accepted for symmetry with the IUPAC path and future
 * use but is not needed for the explicit-set PROSITE semantics.
 */
export function prositeToRegexSource(pattern: string, _alphabet: PrositeAlphabet = 'protein'): string | null {
  const raw = pattern.replace(/\s+/g, '');
  if (!raw) return null;

  let i = 0;
  let source = '';
  let anchorStart = false;
  let anchorEnd = false;
  let elements = 0;

  if (raw[i] === '<') { anchorStart = true; i += 1; }

  while (i < raw.length) {
    const ch = raw[i];

    if (ch === '>') {
      if (i !== raw.length - 1) return null; // `>` only legal at the very end
      anchorEnd = true;
      i += 1;
      break;
    }
    if (ch === '-') { i += 1; continue; } // element separator (optional but standard)

    let cls: string;
    if (ch === '[' || ch === '{') {
      const closer = ch === '[' ? ']' : '}';
      const close = raw.indexOf(closer, i);
      if (close === -1) return null;
      const set = raw.slice(i + 1, close).toUpperCase();
      if (!/^[A-Z]+$/.test(set)) return null;
      cls = ch === '[' ? `[${set}]` : `[^${set}]`;
      i = close + 1;
    } else if (ch === 'x' || ch === 'X') {
      cls = '[A-Z]';
      i += 1;
    } else if (/[A-Za-z]/.test(ch)) {
      cls = ch.toUpperCase();
      i += 1;
    } else {
      return null; // stray `(` `)` `]` `}` or other junk
    }

    // optional repetition: (n) or (n,m)
    if (raw[i] === '(') {
      const close = raw.indexOf(')', i);
      if (close === -1) return null;
      const rep = /^(\d+)(?:,(\d+))?$/.exec(raw.slice(i + 1, close));
      if (!rep) return null;
      const lo = parseInt(rep[1], 10);
      const hi = rep[2] != null ? parseInt(rep[2], 10) : null;
      if (lo < 0 || lo > REPEAT_LIMIT) return null;
      if (hi != null && (hi < lo || hi > REPEAT_LIMIT)) return null;
      // PROSITE uses x(0,m) as an OPTIONAL gap ("0 to m of anything") — a valid,
      // common form (e.g. the C2H2 zinc finger's variable spacers). Only the
      // degenerate "match exactly zero" forms x(0) and x(0,0), which would match
      // the empty string, are rejected.
      if (lo === 0 && (hi == null || hi < 1)) return null;
      cls += hi != null ? `{${lo},${hi}}` : `{${lo}}`;
      i = close + 1;
    }

    source += cls;
    elements += 1;
  }

  if (elements === 0) return null;
  if (anchorStart) source = `^${source}`;
  if (anchorEnd) source = `${source}$`;
  return source;
}

/**
 * The residue alphabets PROSITE classes are intersected against when a pattern
 * is turned into per-position allowed-sets for CONSTRAINED generation (below).
 * `[ST]` keeps S,T; `{P}` becomes "every alphabet residue except P"; `x` is the
 * free wildcard (null set). The regex path above doesn't need these — `[^P]`
 * etc. are alphabet-agnostic there — but the generator must emit a concrete
 * residue, so it needs the explicit allowed set per position.
 */
export const PROSITE_ALPHABETS: Record<PrositeAlphabet, string> = {
  dna: 'ACGT',
  rna: 'ACGU',
  protein: 'ACDEFGHIKLMNPQRSTVWY',
};

export interface PrositeElement {
  /** Residues allowed at each position this element spans; `null` = any residue
   *  (the `x` wildcard or a `{}` that excludes nothing) — a FREE position the
   *  model fills on its own. An empty set means "unsatisfiable in this alphabet"
   *  (e.g. `[ST]` against DNA): the generator leaves it free and the regex
   *  verifier reports the candidate as a non-match. */
  allowed: Set<string> | null;
  /** Repetition bounds — `e(n)` ⇒ min=max=n; `e(n,m)` ⇒ min=n,max=m; bare ⇒ 1,1. */
  min: number;
  max: number;
}

export interface ParsedPrositePattern {
  elements: PrositeElement[];
  anchorStart: boolean;
  anchorEnd: boolean;
}

/**
 * Parse a PROSITE pattern into its STRUCTURAL elements (length-independent),
 * for constrained generation. This mirrors `prositeToRegexSource`'s tokenizer
 * exactly — same grammar, same validity rules — but instead of a regex string
 * it yields, per element, the set of residues that satisfy it plus its
 * repetition bounds. Returns null on the same malformed inputs the regex path
 * rejects, so the two stay in lockstep (asserted in the tests).
 */
export function parsePrositePattern(
  pattern: string,
  alphabet: PrositeAlphabet = 'protein',
): ParsedPrositePattern | null {
  const raw = pattern.replace(/\s+/g, '');
  if (!raw) return null;
  const ALPHA = [...PROSITE_ALPHABETS[alphabet]];

  let i = 0;
  const elements: PrositeElement[] = [];
  let anchorStart = false;
  let anchorEnd = false;

  if (raw[i] === '<') { anchorStart = true; i += 1; }

  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '>') {
      if (i !== raw.length - 1) return null;
      anchorEnd = true;
      i += 1;
      break;
    }
    if (ch === '-') { i += 1; continue; }

    let allowed: Set<string> | null;
    if (ch === '[' || ch === '{') {
      const closer = ch === '[' ? ']' : '}';
      const close = raw.indexOf(closer, i);
      if (close === -1) return null;
      const set = raw.slice(i + 1, close).toUpperCase();
      if (!/^[A-Z]+$/.test(set)) return null;
      const listed = new Set([...set]);
      // `[set]` ⇒ listed ∩ alphabet; `{set}` ⇒ alphabet − listed.
      allowed = ch === '['
        ? new Set(ALPHA.filter((c) => listed.has(c)))
        : new Set(ALPHA.filter((c) => !listed.has(c)));
      i = close + 1;
    } else if (ch === 'x' || ch === 'X') {
      allowed = null; // free wildcard
      i += 1;
    } else if (/[A-Za-z]/.test(ch)) {
      allowed = new Set([ch.toUpperCase()]);
      i += 1;
    } else {
      return null;
    }

    let min = 1;
    let max = 1;
    if (raw[i] === '(') {
      const close = raw.indexOf(')', i);
      if (close === -1) return null;
      const rep = /^(\d+)(?:,(\d+))?$/.exec(raw.slice(i + 1, close));
      if (!rep) return null;
      const lo = parseInt(rep[1], 10);
      const hi = rep[2] != null ? parseInt(rep[2], 10) : lo;
      if (lo < 0 || lo > REPEAT_LIMIT) return null;
      if (hi < lo || hi > REPEAT_LIMIT) return null;
      if (lo === 0 && hi < 1) return null; // x(0) / x(0,0) — match nothing
      min = lo;
      max = hi;
      i = close + 1;
    }
    elements.push({ allowed, min, max });
  }

  if (elements.length === 0) return null;
  return { elements, anchorStart, anchorEnd };
}

/**
 * Realize a parsed pattern into a CONCRETE per-position list of allowed-sets
 * (each entry `null` = a free position the model fills). Variable-length
 * elements — `x(2,4)`, the classic spacer "NNNN" between conserved residues —
 * pick a length with `rng`, so different candidates exercise different spacings
 * while every result still satisfies the pattern. The window is capped at
 * `maxLen` (the generated/inserted length) and the choice for each element
 * reserves room for every later element's minimum, so the realization always
 * fits. Returns null when even the minimum window can't fit `maxLen`, or when
 * the pattern is wholly optional (nothing to enforce).
 */
export function realizePrositeWindow(
  parsed: ParsedPrositePattern,
  maxLen: number,
  rng: () => number,
): Array<Set<string> | null> | null {
  const minLen = parsed.elements.reduce((s, e) => s + e.min, 0);
  if (minLen <= 0 || minLen > maxLen) return null;

  const positions: Array<Set<string> | null> = [];
  let budget = maxLen;
  let remainingMin = minLen;
  for (const el of parsed.elements) {
    remainingMin -= el.min; // minimum the LATER elements still require
    const ceil = Math.min(el.max, budget - remainingMin);
    const count = ceil <= el.min ? el.min : el.min + Math.floor(rng() * (ceil - el.min + 1));
    for (let k = 0; k < count; k++) positions.push(el.allowed);
    budget -= count;
  }
  return positions.length ? positions : null;
}

/** Lower bound on a PROSITE pattern's match length (sum of each element's MIN
 *  repetition) — the shortest sequence that can possibly contain it. The
 *  generate/insert UI uses this to warn when a (valid) motif can't fit the
 *  requested length. Returns 0 for an invalid pattern. */
export function prositeMinMatchLength(pattern: string, alphabet: PrositeAlphabet = 'protein'): number {
  const parsed = parsePrositePattern(pattern, alphabet);
  if (!parsed) return 0;
  return parsed.elements.reduce((sum, e) => sum + e.min, 0);
}

export interface PrositeMatch { start: number; end: number; text: string; }

/**
 * Every (overlapping) match of a PROSITE pattern in `seq`, using the SAME
 * overlapping-lookahead compile the motif engine and the highlight hit-map use,
 * so "does this generated candidate contain the motif" is answered by the exact
 * matcher the rest of the app trusts. Returns [] for an invalid/empty pattern.
 */
export function findPrositeMatches(
  seq: string,
  pattern: string,
  alphabet: PrositeAlphabet = 'protein',
): PrositeMatch[] {
  const source = prositeToRegexSource(pattern, alphabet);
  if (!source || !seq) return [];
  let re: RegExp;
  try {
    re = new RegExp(`(?=(${source}))`, 'gi');
  } catch {
    return [];
  }
  const up = seq.toUpperCase();
  const out: PrositeMatch[] = [];
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(up)) !== null && guard++ <= up.length) {
    const hit = m[1] ?? '';
    if (hit.length === 0) { re.lastIndex += 1; continue; }
    out.push({ start: m.index, end: m.index + hit.length, text: seq.slice(m.index, m.index + hit.length) });
    re.lastIndex = m.index + 1;
  }
  return out;
}

/**
 * Upper bound on a PROSITE pattern's match length (sum of each element's max
 * repetition). The motif hit-map searches line windows with an overlap equal to
 * the pattern's match length so matches that straddle a line boundary aren't
 * dropped; for PROSITE the textual pattern length is much larger than the match
 * length, so we compute the real max here.
 */
export function prositeMaxMatchLength(pattern: string): number {
  const raw = pattern.replace(/\s+/g, '');
  let i = 0;
  let total = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '<' || ch === '>' || ch === '-') { i += 1; continue; }
    if (ch === '[' || ch === '{') {
      const close = raw.indexOf(ch === '[' ? ']' : '}', i);
      i = close === -1 ? i + 1 : close + 1;
    } else {
      i += 1;
    }
    let count = 1;
    if (raw[i] === '(') {
      const close = raw.indexOf(')', i);
      if (close !== -1) {
        const rep = /^(\d+)(?:,(\d+))?$/.exec(raw.slice(i + 1, close));
        if (rep) count = rep[2] != null ? parseInt(rep[2], 10) : parseInt(rep[1], 10);
        i = close + 1;
      }
    }
    total += count;
  }
  return Math.max(1, total);
}
