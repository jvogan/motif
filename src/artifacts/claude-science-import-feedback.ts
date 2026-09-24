/**
 * What an import tells the person who started it: which files or records were
 * skipped and why, and what the Add entry preflight line says about a paste.
 *
 * The strict normaliser (`normalizeSequenceStrict`) already knows the offending
 * character and its offset when it rejects a sequence. The UI used to discard that
 * and print one fixed sentence for every failure, whether the input was a PNG, a
 * CLUSTAL alignment, or a sequence with a single stray digit. These helpers turn
 * the normaliser's answer into a sentence the person can act on. None of them
 * changes what is accepted: every rejection here is a rejection the normaliser
 * already made.
 */
import { InvalidSequenceCharacterError, normalizeSequenceStrict } from '../bio/sequence-normalization';
import type { SequenceType } from '../bio/types';

/** One record an import parsed but could not use. `record` is unset for a bare sequence. */
export interface ImportSkip {
  record?: string;
  reason: string;
}

/** One file, or one record inside a file, left out of a multi-file import. */
export interface SkippedImport {
  source: string;
  reason: string;
}

export interface ImportOutcome {
  message: string;
  tone: 'status' | 'error';
  /**
   * Every skipped entry by name and reason, with no count standing in for the
   * rest. The Add entry panel keeps this on screen after the notice closes.
   */
  detail?: string;
}

const NUCLEOTIDE_LETTERS = /^[ACGTUNRYSWKMBDHV]*$/iu;
const RESIDUE_CHARACTER = /^[A-Za-z*]$/u;
const FORMATTING_WHITESPACE = new Set([' ', '\t', '\r', '\n']);
const CLUSTAL_HEADER = /^\s*CLUSTAL\b/u;

/** The first `n` skipped entries named in a message; the rest are counted. */
const MAX_LISTED_SKIPS = 3;

export const CLUSTAL_IMPORT_REASON = 'a CLUSTAL alignment. Load it from Alignment → Open alignment workspace → Aligned file';

function withArticle(label: 'DNA' | 'RNA' | 'protein'): string {
  return label === 'RNA' ? 'an RNA' : `a ${label}`;
}

function describeCharacter(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  const hex = `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
  if (character === '\u00a0') return `A non-breaking space (${hex})`;
  if (/\s/u.test(character)) return `A whitespace character (${hex})`;
  if (code < 0x20 || code === 0x7f) return `A control character (${hex})`;
  return `“${character}”`;
}

/** 1-based position of `offset`, as line and column when the text spans lines. */
function positionOf(text: string, offset: number): string {
  if (!/[\r\n]/u.test(text)) return `position ${(offset + 1).toLocaleString()}`;
  const before = text.slice(0, offset).split(/\r\n|\r|\n/u);
  const line = before.length;
  const column = before[before.length - 1].length + 1;
  return `line ${line.toLocaleString()}, column ${column.toLocaleString()}`;
}

function likelyLabel(text: string): 'DNA' | 'RNA' | 'protein' {
  const letters = text.replace(/[^A-Za-z]/gu, '');
  if (!NUCLEOTIDE_LETTERS.test(letters)) return 'protein';
  return /u/iu.test(letters) && !/t/iu.test(letters) ? 'RNA' : 'DNA';
}

function labelForHint(typeHint: SequenceType | 'auto' | undefined): 'DNA' | 'RNA' | 'protein' | null {
  if (typeHint === 'dna') return 'DNA';
  if (typeHint === 'rna') return 'RNA';
  if (typeHint === 'protein') return 'protein';
  return null;
}

/**
 * Why `normalizeSequenceStrict(text, typeHint)` rejects `text`, as one sentence,
 * or `null` when it accepts it.
 *
 * With an explicit molecule the answer is the normaliser's own: the character, its
 * position, and the alphabet it is not in. In Auto mode the normaliser has no
 * alphabet to test characters against while it reads, so the first character that
 * is not a residue in any alphabet is reported instead, against the molecule the
 * rest of the text looks like. Text made only of letters that is still rejected
 * is neither nucleotide nor sequence-like protein (prose, or spaced lower-case
 * peptide); naming Protein is the one choice that changes the answer.
 */
export function describeSequenceRejection(text: string, typeHint: SequenceType | 'auto' | undefined): string | null {
  const hint = typeHint === 'auto' ? undefined : typeHint;
  const label = labelForHint(hint);
  try {
    normalizeSequenceStrict(text, hint);
    return null;
  } catch (error) {
    if (error instanceof InvalidSequenceCharacterError) {
      const shownLabel = label ?? likelyLabel(text);
      return `${describeCharacter(error.character)} at ${positionOf(text, error.offset)} is not ${withArticle(shownLabel)} residue.`;
    }
  }
  if (!text.trim()) return 'No residues found.';
  if (label) return `No ${label} residues found.`;

  let offset = 0;
  for (const character of text) {
    if (!FORMATTING_WHITESPACE.has(character) && !RESIDUE_CHARACTER.test(character)) {
      return `${describeCharacter(character)} at ${positionOf(text, offset)} is not ${withArticle(likelyLabel(text))} residue.`;
    }
    offset += character.length;
  }
  offset = 0;
  for (const character of text) {
    if (!FORMATTING_WHITESPACE.has(character) && !NUCLEOTIDE_LETTERS.test(character)) {
      return `${describeCharacter(character)} at ${positionOf(text, offset)} is not a nucleotide. If this is a protein sequence, set Molecule to Protein.`;
    }
    offset += character.length;
  }
  return 'This text is not a DNA, RNA, or protein sequence.';
}

/** True when `text` starts with a CLUSTAL alignment header. */
export function isClustalAlignment(text: string): boolean {
  return CLUSTAL_HEADER.test(text);
}

/**
 * True when decoded file text is binary rather than text: a NUL, or the U+FFFD a
 * UTF-8 decoder substitutes for bytes it cannot read (every PNG has one in its
 * first byte). Only the first 4 KB is examined.
 */
export function looksLikeBinaryText(text: string): boolean {
  const head = text.slice(0, 4096);
  return head.includes('\u0000') || head.includes('\ufffd');
}

/**
 * Why a pasted text produced no record. `skipped` is what `parseImportedRecords`
 * reported while parsing it.
 */
export function explainUnimportedPaste(text: string, skipped: readonly ImportSkip[]): string {
  if (isClustalAlignment(text)) return `This is ${CLUSTAL_IMPORT_REASON}.`;
  const unsupported = unsupportedFormatReason({}, text);
  if (unsupported) return `${unsupported.charAt(0).toUpperCase()}${unsupported.slice(1)}.`;
  const first = skipped[0];
  if (first) {
    const others = skipped.length - 1;
    const tail = others > 0 ? ` ${others.toLocaleString()} more record${others === 1 ? ' was' : 's were'} skipped.` : '';
    return `${first.record ? `${first.record}: ` : ''}${first.reason}${tail}`;
  }
  return 'No sequence found.';
}

/**
 * Why a file cannot be parsed at all, before any parser sees it: it is empty, it is
 * in a format with no reader here (`unsupportedFormatReason`), or
 * it is binary. A PNG decoded as text can contain a `>` at the start of a line,
 * and the FASTA parser would then report a control character at some line and
 * column of the image, which tells the person nothing. `null` for readable text.
 */
export function unreadableFileReason(file: { type?: string; name?: string }, text: string): string | null {
  if (!text.trim()) return 'the file is empty';
  const unsupported = unsupportedFormatReason(file, text);
  if (unsupported) return unsupported;
  if (looksLikeBinaryText(text) || /^(?:image|audio|video)\//u.test(file.type ?? '')) return 'not a sequence file';
  return null;
}

/**
 * Formats that hold a real sequence but have no reader here yet. A valid 2,686 bp
 * EMBL flat file used to report "no sequence found", and a SnapGene file "not a
 * sequence file", which both read as a broken file rather than a missing reader.
 * EMBL starts with an `ID   ` line; a SnapGene file carries "SnapGene" in its first
 * bytes and uses the `.dna` extension. `null` for anything else.
 */
export function unsupportedFormatReason(file: { name?: string }, text: string): string | null {
  const retry = 'is not supported yet. Export it as GenBank or FASTA and retry';
  if (/^\s*ID {3}\S/u.test(text)) return `the EMBL format ${retry}`;
  if (text.slice(0, 64).includes('SnapGene') || /\.dna$/iu.test(file.name ?? '')) return `the SnapGene .dna format ${retry}`;
  return null;
}

/**
 * Why a chosen or dropped file produced no record, as a lower-case clause that
 * follows "<file name>: ".
 */
export function explainUnimportedFile(file: { type?: string; name?: string }, text: string, skipped: readonly ImportSkip[]): string {
  const unreadable = unreadableFileReason(file, text);
  if (unreadable) return unreadable;
  if (isClustalAlignment(text)) return CLUSTAL_IMPORT_REASON;
  if (/^\s*[[{]/u.test(text)) return 'not a Record JSON or Database JSON export';
  const recordSkip = skipped.find((skip) => skip.record);
  if (recordSkip) return `${recordSkip.record}: ${withoutFinalPeriod(recordSkip.reason)}`;
  return 'no sequence found';
}

/** The fields that make an imported record the same as one already open. */
export interface ImportIdentity {
  name?: string;
  seq?: string;
  sequence?: string;
  topology?: string;
}

function identityKey(record: ImportIdentity): string {
  const residues = String(record.seq ?? record.sequence ?? '').replace(/\s+/gu, '').toUpperCase();
  return `${(record.name ?? '').trim()}\u0000${record.topology ?? 'linear'}\u0000${residues}`;
}

/**
 * The name of the open record an import would repeat exactly (same name, same
 * topology, same residues ignoring case and whitespace), or `null`. Choosing the
 * same file twice used to add a second, indistinguishable row each time.
 * A record that differs in any of the three is a new record, not a repeat.
 */
export function duplicateOfOpenRecord(record: ImportIdentity, open: readonly ImportIdentity[]): string | null {
  const key = identityKey(record);
  const match = open.find((candidate) => identityKey(candidate) === key);
  return match ? (match.name ?? '').trim() || 'an open record' : null;
}

/** A full stop, then a space and a capital: the reason holds a second sentence. */
const SENTENCE_BREAK = /[.!?]["”)]?\s+[A-Z]/u;

/**
 * A reason as it ends in the notice, after "<file name>: " and before any " · ". A
 * one-sentence clause drops its full stop there ("image.png: not a sequence file").
 * A reason of two sentences ends with one: the notice used to strip it too, so the
 * NCBI contig message read "…has no sequence. Download it with its sequence (NCBI
 * format "GenBank (full)"), then retry" with its second sentence left unfinished.
 */
function withoutFinalPeriod(reason: string): string {
  const clause = reason.trim().replace(/\.$/u, '');
  return SENTENCE_BREAK.test(clause) ? `${clause}.` : clause;
}

function recordCount(count: number): string {
  return `${count.toLocaleString()} record${count === 1 ? '' : 's'}`;
}

/**
 * The one message a multi-file import ends with. Every skipped file or record is
 * accounted for: the first few by name and reason, the rest by count. `detail`
 * names every one, for the panel status that stays after the notice closes. A batch
 * with anything skipped is an error, even when other files were imported,
 * because something the person chose is missing from the inventory.
 */
export function describeFileImportOutcome(added: number, skipped: readonly SkippedImport[]): ImportOutcome {
  if (skipped.length === 0) {
    return added > 0
      ? { message: `Imported ${recordCount(added)}`, tone: 'status' }
      : { message: 'No records found in the chosen files', tone: 'error' };
  }
  const named = skipped.map((skip) => (
    `${added > 0 ? 'skipped ' : ''}${skip.source}: ${withoutFinalPeriod(skip.reason)}`
  ));
  const listed = named.slice(0, MAX_LISTED_SKIPS);
  const unlisted = skipped.length - listed.length;
  const imported = added > 0 ? [`Imported ${recordCount(added)}`] : [];
  const parts = [
    ...imported,
    ...listed,
    ...(unlisted > 0 ? [`${unlisted.toLocaleString()} more skipped`] : []),
  ];
  return {
    message: parts.join(' · '),
    tone: 'error',
    ...(unlisted > 0 ? { detail: [...imported, ...named].join(' · ') } : {}),
  };
}

function lengthRange(lengths: readonly number[], unit: string): string {
  const min = Math.min(...lengths);
  const max = Math.max(...lengths);
  return min === max
    ? `${min.toLocaleString()} ${unit}`
    : `${min.toLocaleString()}–${max.toLocaleString()} ${unit}`;
}

function unitFor(type: SequenceType): 'aa' | 'nt' | 'bp' {
  if (type === 'protein') return 'aa';
  if (type === 'rna') return 'nt';
  return 'bp';
}

/**
 * The Add entry preflight line: record count, molecule types, and lengths in each
 * type's own unit. A DNA + protein paste used to report every length in the first
 * record's unit ("· 16 bp" for 16 bp of DNA and 16 aa of protein).
 */
export function describeImportPreflight(
  entries: ReadonlyArray<{ type: SequenceType; length: number }>,
  notes: readonly string[] = [],
): string {
  const types = Array.from(new Set(entries.map((entry) => entry.type)));
  const lengthsByUnit = new Map<string, number[]>();
  for (const entry of entries) {
    const unit = unitFor(entry.type);
    const lengths = lengthsByUnit.get(unit) ?? [];
    lengths.push(entry.length);
    lengthsByUnit.set(unit, lengths);
  }
  const ranges = Array.from(lengthsByUnit, ([unit, lengths]) => lengthRange(lengths, unit)).join(' + ');
  return [
    `${entries.length.toLocaleString()} record${entries.length === 1 ? '' : 's'} detected`,
    types.map((type) => type.toUpperCase()).join(' + '),
    ...(ranges ? [ranges] : []),
    ...notes,
  ].join(' · ');
}
