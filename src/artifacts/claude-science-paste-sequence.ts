/**
 * Paste into the sequence editor: decide which of the pasted lines are sequence
 * before deciding which characters are bases.
 *
 * The editor used to do only the second half — filter the whole clipboard string
 * against the record's alphabet — which is wrong for every format anyone actually
 * copies sequence out of. `>gi|12345|ref|NM_001` survives that filter as `GRNM`,
 * because G, R, N and M are all legal IUPAC ambiguity codes, so a FASTA header
 * silently became four bases at the head of the insert and rendered as ordinary
 * uppercase letters. Structure has to be stripped by LINE; dropping the `>`
 * character alone is what produced the bug.
 *
 * Two formats are recognised, and only where they cannot be confused with residues:
 *
 * - FASTA. A line starting with `>` is a record header; a line starting with `;`
 *   is a comment. Neither character is a residue in any alphabet, so stripping
 *   those lines is unambiguous. Only `>` increments the record count: comments do
 *   not turn a single record into a multi-record paste.
 * - GenBank. The sequence of a GenBank record is exactly the ORIGIN block, so when
 *   the text contains an `ORIGIN` line the block between it and the closing `//` is
 *   the sequence and everything else is metadata. This is deliberately a
 *   DOCUMENT-level test rather than a keyword-per-line one: `TITLE`, `SOURCE` and
 *   `ORGANISM` are all spellable in protein, so a per-line keyword rule would eat
 *   real residues out of a pasted peptide.
 *
 * Nothing else is guessed at. A line that is neither is treated as sequence, and
 * whatever the alphabet rejects is counted and reported rather than dropped in
 * silence.
 */

export type PastedSequenceFormat = 'plain' | 'fasta' | 'genbank';

interface PastedSequenceDetails {
  /** Structure detected before residue filtering. */
  format: PastedSequenceFormat;
  /** Actual `>` FASTA headers. Comments and GenBank metadata do not count. */
  fastaRecordCount: number;
  /** GenBank records inferred from document-level LOCUS and ORIGIN markers. */
  genbankRecordCount: number;
  /** Whole lines recognised as structure and removed: FASTA and GenBank metadata. */
  droppedLines: number;
  /**
   * Characters removed from the lines that were KEPT, excluding whitespace and the
   * digits of a wrapped-line position counter — neither is ever a residue, so
   * counting them would make every ordinary multi-line paste look lossy. What
   * remains is the count worth telling someone about: letters that were not bases.
   */
  droppedCharacters: number;
}

export interface AcceptedPastedSequence extends PastedSequenceDetails {
  ok: true;
  /** Residues to insert, filtered to the record's alphabet and upper-cased. */
  sequence: string;
  error: null;
}

export interface RejectedPastedSequence extends PastedSequenceDetails {
  ok: false;
  /** No partial sequence is exposed: rejecting a multi-record paste is atomic. */
  sequence: '';
  error: 'multiple-fasta-records' | 'multiple-genbank-records';
}

export type PastedSequence = AcceptedPastedSequence | RejectedPastedSequence;

export interface PastedSequenceLines {
  lines: string[];
  droppedLines: number;
  format: PastedSequenceFormat;
  fastaRecordCount: number;
  genbankRecordCount: number;
}

const FASTA_HEADER = /^\s*>/;
const FASTA_COMMENT = /^\s*;/;
// GenBank structural keywords normally begin in column 1. Allow a small common
// document indent, but not the 12-space continuation column used by fields such
// as DEFINITION and COMMENT; continuation prose can legitimately begin with
// words such as "LOCUS" or "ORIGIN" without starting another record.
const GENBANK_LOCUS = /^[ \t]{0,4}LOCUS\b/i;
const GENBANK_ORIGIN = /^[ \t]{0,4}ORIGIN\b/i;
const GENBANK_TERMINATOR = /^\s*\/\/\s*$/;
/** The position counter that starts each ORIGIN line, and that many viewers emit. */
const LEADING_POSITION = /^\s*\d+\s*/;

function genbankRecordCount(lines: readonly string[]): number {
  let records = 0;
  let locusMarkers = 0;
  let originMarkers = 0;
  const finishBlock = () => {
    records += Math.max(locusMarkers, originMarkers);
    locusMarkers = 0;
    originMarkers = 0;
  };
  for (const line of lines) {
    if (GENBANK_TERMINATOR.test(line)) {
      finishBlock();
      continue;
    }
    if (GENBANK_LOCUS.test(line)) locusMarkers += 1;
    if (GENBANK_ORIGIN.test(line)) originMarkers += 1;
  }
  finishBlock();
  return records;
}

/**
 * The lines of `value` that carry sequence, with FASTA and GenBank structure
 * removed. Exported for tests; `parsePastedSequence` is what callers want.
 */
export function sequenceLinesFromPaste(value: string): PastedSequenceLines {
  const all = value.split(/\r\n|\r|\n/);
  const originAt = all.findIndex((line) => GENBANK_ORIGIN.test(line));
  const isGenBank = originAt >= 0;
  const inferredGenBankRecordCount = isGenBank
    ? Math.max(1, genbankRecordCount(all))
    : 0;
  // Once an ORIGIN block identifies a GenBank document, angle brackets in its
  // metadata are not FASTA headers. Only non-GenBank documents are counted.
  const fastaRecordCount = isGenBank
    ? 0
    : all.filter((line) => FASTA_HEADER.test(line)).length;

  // A GenBank record: keep the ORIGIN block and nothing else.
  const scoped = isGenBank
    ? all.slice(originAt + 1, (() => {
      const end = all.findIndex((line, index) => index > originAt && GENBANK_TERMINATOR.test(line));
      return end >= 0 ? end : all.length;
    })())
    : all;

  const lines = scoped.filter((line) => !FASTA_HEADER.test(line) && !FASTA_COMMENT.test(line));
  // Blank lines are not structure and are not sequence; they should not count as
  // something removed, or a normal wrapped FASTA paste would report a loss.
  const meaningful = (line: string) => line.trim().length > 0;
  const droppedLines = all.filter(meaningful).length - lines.filter(meaningful).length;
  return {
    lines,
    droppedLines,
    format: isGenBank ? 'genbank' : fastaRecordCount > 0 ? 'fasta' : 'plain',
    fastaRecordCount,
    genbankRecordCount: inferredGenBankRecordCount,
  };
}

/**
 * Residues from a clipboard string, plus what it cost to get them. `alphabet` is
 * the record's own accepted set, so a protein record keeps letters a DNA record
 * discards.
 */
export function parsePastedSequence(value: string, alphabet: string): PastedSequence {
  const allowed = new Set(alphabet.toUpperCase().split(''));
  const {
    lines,
    droppedLines,
    format,
    fastaRecordCount,
    genbankRecordCount,
  } = sequenceLinesFromPaste(value);

  if (fastaRecordCount > 1) {
    return {
      ok: false,
      sequence: '',
      error: 'multiple-fasta-records',
      format,
      fastaRecordCount,
      genbankRecordCount,
      droppedLines,
      droppedCharacters: 0,
    };
  }

  if (genbankRecordCount > 1) {
    return {
      ok: false,
      sequence: '',
      error: 'multiple-genbank-records',
      format,
      fastaRecordCount,
      genbankRecordCount,
      droppedLines,
      droppedCharacters: 0,
    };
  }

  let sequence = '';
  let droppedCharacters = 0;
  for (const line of lines) {
    for (const char of line.replace(LEADING_POSITION, '').toUpperCase()) {
      if (allowed.has(char)) sequence += char;
      else if (!/\s|\d/.test(char)) droppedCharacters += 1;
    }
  }
  return {
    ok: true,
    sequence,
    error: null,
    format,
    fastaRecordCount,
    genbankRecordCount,
    droppedLines,
    droppedCharacters,
  };
}
