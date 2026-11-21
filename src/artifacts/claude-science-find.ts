import { IUPAC_DNA_EXPANSIONS } from '../bio/nucleotide';
import { reverseComplement } from '../bio/reverse-complement';
import type { SequenceType, Topology } from '../bio/types';

/** More matches than this are counted as "10,000+" and not listed. */
export const FIND_MATCH_LIMIT = 10_000;

export type FindStrand = 1 | -1;

/** One match. `end` may pass the record length on a circular record (the match spans the origin). */
export type FindMatch = { start: number; end: number; strand: FindStrand };

export type FindResult = {
  /** The query as matched: upper case, without spaces or digits, T for U on nucleotides. */
  query: string;
  status: 'empty' | 'invalid' | 'ok';
  invalidCharacter: string | null;
  /** Sorted by start; one entry per start, so a palindromic site is one match. */
  matches: readonly FindMatch[];
  /** True when there were more than the limit. */
  capped: boolean;
  /** Whether the bottom strand was searched as well. */
  bothStrands: boolean;
};

export const NO_FIND_MATCHES: readonly FindMatch[] = [];

export const EMPTY_FIND_RESULT: FindResult = {
  query: '',
  status: 'empty',
  invalidCharacter: null,
  matches: [],
  capped: false,
  bothStrands: false,
};

export function findSearchesBothStrands(sequenceType: SequenceType): boolean {
  return sequenceType === 'dna' || sequenceType === 'rna';
}

const RECORD_NUCLEOTIDES = 'ACGTURYSWKMBDHVN';

/** A query code matches a record letter when every base the letter can be is one the code allows. */
const NUCLEOTIDE_CLASS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IUPAC_DNA_EXPANSIONS).map(([code, allowed]) => {
    const letters = [...RECORD_NUCLEOTIDES].filter((letter) => IUPAC_DNA_EXPANSIONS[letter].every((base) => allowed.includes(base)));
    const both = letters.join('') + letters.join('').toLowerCase();
    return [code, `[${both}]`];
  }),
);

const PROTEIN_CLASS: Readonly<Record<string, string>> = {
  X: '[A-Za-z]',
  B: '[BDNbdn]',
  Z: '[ZEQzeq]',
  J: '[JILjil]',
  '*': '\\*',
};

/**
 * Normalise what someone typed or pasted. Spaces, line breaks and digits are
 * ignored (a pasted block with line numbers still works); any other character
 * that is not a residue makes the query invalid rather than being dropped.
 */
export function cleanFindQuery(raw: string, sequenceType: SequenceType): { query: string; invalidCharacter: string | null } {
  const compact = raw.replace(/[\s\d]+/g, '').toUpperCase();
  if (findSearchesBothStrands(sequenceType)) {
    const query = compact.replace(/U/g, 'T');
    const invalid = [...query].find((character) => !IUPAC_DNA_EXPANSIONS[character]);
    return { query, invalidCharacter: invalid ?? null };
  }
  const invalid = [...compact].find((character) => !/[A-Z*]/.test(character));
  return { query: compact, invalidCharacter: invalid ?? null };
}

function patternFor(query: string, nucleotide: boolean): string {
  let pattern = '';
  for (const code of query) {
    pattern += nucleotide
      ? NUCLEOTIDE_CLASS[code]
      : PROTEIN_CLASS[code] ?? `[${code}${code.toLowerCase()}]`;
  }
  return pattern;
}

/**
 * Every place the query occurs, in position order. On DNA and RNA the reverse
 * complement is searched in the same pass, so a bottom-strand site is a match
 * with strand -1 and a site that reads the same on both strands is one match.
 * On a circular record a match may run across the origin.
 */
export function findSequenceMatches(
  sequence: string,
  rawQuery: string,
  sequenceType: SequenceType,
  topology: Topology = 'linear',
  limit = FIND_MATCH_LIMIT,
): FindResult {
  const bothStrands = findSearchesBothStrands(sequenceType);
  const { query, invalidCharacter } = cleanFindQuery(rawQuery, sequenceType);
  if (!query) return { ...EMPTY_FIND_RESULT, bothStrands };
  if (invalidCharacter) return { query, status: 'invalid', invalidCharacter, matches: [], capped: false, bothStrands };
  const length = query.length;
  const matches: FindMatch[] = [];
  if (length > sequence.length) return { query, status: 'ok', invalidCharacter: null, matches, capped: false, bothStrands };

  const forward = patternFor(query, bothStrands);
  const reverseQuery = bothStrands ? reverseComplement(query) : query;
  // The bottom strand is a capture so a hit says which strand it came from.
  // Forward is tried first, so a site matching both strands counts once.
  const pattern = reverseQuery === query
    ? `(?=${forward})`
    : `(?=${forward}|(${patternFor(reverseQuery, true)}))`;
  const circular = topology === 'circular' && bothStrands;
  const target = circular ? sequence + sequence.slice(0, Math.max(0, length - 1)) : sequence;
  const scanner = new RegExp(pattern, 'g');
  let capped = false;
  for (let hit = scanner.exec(target); hit !== null && hit.index < sequence.length; hit = scanner.exec(target)) {
    if (matches.length === limit) {
      capped = true;
      break;
    }
    matches.push({ start: hit.index, end: hit.index + length, strand: hit[1] === undefined ? 1 : -1 });
    scanner.lastIndex = hit.index + 1;
  }
  return { query, status: 'ok', invalidCharacter: null, matches, capped, bothStrands };
}

/** Index of the first match whose start is at or after `position`, or -1. */
export function firstMatchAtOrAfter(matches: readonly FindMatch[], position: number): number {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (matches[middle].start < position) low = middle + 1;
    else high = middle;
  }
  return low < matches.length ? low : -1;
}

export function indexOfMatchStart(matches: readonly FindMatch[], start: number): number {
  const index = firstMatchAtOrAfter(matches, start);
  return index >= 0 && matches[index].start === start ? index : -1;
}

/**
 * The next match in one direction. With no current match it starts from
 * `anchor` (where the search began). Wraps at either end and says so.
 */
export function stepFindMatch(
  matches: readonly FindMatch[],
  currentStart: number | null,
  anchor: number,
  direction: 1 | -1,
): { index: number; wrapped: boolean } | null {
  if (matches.length === 0) return null;
  if (direction === 1) {
    const from = currentStart === null ? anchor : currentStart + 1;
    const index = firstMatchAtOrAfter(matches, from);
    return index >= 0 ? { index, wrapped: false } : { index: 0, wrapped: true };
  }
  const from = currentStart === null ? anchor : currentStart;
  const index = firstMatchAtOrAfter(matches, from);
  const previous = (index < 0 ? matches.length : index) - 1;
  return previous >= 0 ? { index: previous, wrapped: false } : { index: matches.length - 1, wrapped: true };
}

export function formatFindTotal(result: FindResult): string {
  return `${result.matches.length.toLocaleString()}${result.capped ? '+' : ''}`;
}

/** The count line: "3 of 12", "12 matches", "No matches", or a short hint. */
export function findCountLabel(result: FindResult, currentIndex: number | null): string {
  if (result.status === 'empty') return result.bothStrands ? 'Both strands' : 'Type residues';
  if (result.status === 'invalid') return `Not ${result.bothStrands ? 'a base' : 'a residue'}: ${result.invalidCharacter}`;
  if (result.matches.length === 0) return 'No matches';
  const total = formatFindTotal(result);
  if (currentIndex === null) return `${total} ${result.matches.length === 1 && !result.capped ? 'match' : 'matches'}`;
  return `${(currentIndex + 1).toLocaleString()} of ${total}`;
}

const FIND_POSITION_NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;
const FIND_POSITION = new RegExp(`^\\s*${FIND_POSITION_NUMBER}\\s*(?:(?:\\.\\.|-|–|—)\\s*${FIND_POSITION_NUMBER})?\\s*$`);

/**
 * A base position or range typed into the find field: "1500", "1,500",
 * "1500..1600", "1500-1600" or "1500–1600", read as 1-based and inclusive.
 * Digits are not residues, so such a query would match nothing and say
 * nothing; it is read as a range instead. A reversed range is put in order and marked `reversed`: on a
 * circular record "2680..10" means the bases across the origin. Null for
 * anything else.
 */
export function parseFindPosition(query: string): { first: number; last: number; reversed?: true } | null {
  const match = FIND_POSITION.exec(query);
  if (!match) return null;
  const first = Number(match[1].replace(/,/g, ''));
  const last = match[2] === undefined ? first : Number(match[2].replace(/,/g, ''));
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  return first <= last ? { first, last } : { first: last, last: first, reversed: true };
}

/**
 * What the find bar says before Enter on a typed position: what Enter will
 * select, in the order it will select it. On a circular record a reversed range
 * runs across the origin, so it keeps the typed order. On a linear record Enter
 * selects it in order, so the preview shows the order Enter uses (1,500–1,600
 * for a typed "1,600–1,500") and says it was typed backwards.
 */
export function findPositionPreview(
  position: { first: number; last: number; reversed?: true },
  sequenceLength: number | undefined,
  circular: boolean,
): { label: string; detail: string } {
  const { first, last } = position;
  if (first < 1) return { label: 'No base 0', detail: 'Bases start at 1' };
  if (sequenceLength !== undefined && last > sequenceLength) {
    return { label: 'Past the end', detail: `Last base is ${sequenceLength.toLocaleString()}` };
  }
  if (first === last) return { label: `Base ${first.toLocaleString()}`, detail: 'Enter goes there' };
  if (position.reversed && circular) return { label: `${last.toLocaleString()}–${first.toLocaleString()}`, detail: 'Enter selects it' };
  return { label: `${first.toLocaleString()}–${last.toLocaleString()}`, detail: position.reversed ? 'Typed backwards' : 'Enter selects it' };
}

/** The box of the sequence row (a feature or site lane, a base line, an amino-acid row) that a horizontal edge at `top` cuts, if any. */
export function sequenceRowCutAt(scroller: HTMLElement, top: number): DOMRect | null {
  for (const block of scroller.querySelectorAll('.motif-cs-seq-block')) {
    const box = block.getBoundingClientRect();
    if (box.bottom <= top + 1) continue;
    if (box.top >= top - 1) return null;
    for (const row of block.querySelectorAll('.motif-cs-feature-track-lane, .motif-cs-restriction-track-lane, .motif-cs-seq-line, .motif-cs-seq-aa-row')) {
      const rowBox = row.getBoundingClientRect();
      if (rowBox.top < top - 1 && rowBox.bottom > top + 1) return rowBox;
    }
    return null;
  }
  return null;
}
