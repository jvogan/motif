import type { FastaRecord } from './types';

/**
 * Parse a FASTA-format string into records.
 * Handles multi-line sequences and multiple records.
 *
 * If the input contained `-` or `.` characters (CLUSTAL / MAFFT alignment
 * gaps), they are stripped from the sequence and a `gapsRemoved` count is
 * attached to the resulting record so callers can surface an "aligned input
 * was degapped" warning. Formatting whitespace is also ignored. Every other
 * non-residue character is rejected with its original line, column, and
 * input offset; silently deleting digits or punctuation can shift feature
 * coordinates and change the biological sequence.
 */
export class FastaParseError extends Error {
  readonly code = 'invalid_sequence_character';
  readonly line: number;
  readonly column: number;
  readonly offset: number;
  readonly character: string;

  constructor(line: number, column: number, offset: number, character: string) {
    super(
      `FASTA sequence contains invalid character ${JSON.stringify(character)} at `
      + `line ${line}, column ${column} (input offset ${offset}). `
      + 'Only residue characters, alignment gaps (- or .), and formatting whitespace are allowed.',
    );
    this.name = 'FastaParseError';
    this.line = line;
    this.column = column;
    this.offset = offset;
    this.character = character;
  }
}

export function parseFasta(input: string): FastaRecord[] {
  const records: FastaRecord[] = [];
  const lines = input.split(/\r?\n/);
  let currentHeader = '';
  let currentDescription = '';
  let currentRawHeader = '';
  let currentSeq: string[] = [];
  let hasActiveHeader = false;
  let gapsInCurrent = 0;
  let inputOffset = 0;

  const advanceInputOffset = (line: string) => {
    inputOffset += line.length;
    if (inputOffset < input.length) {
      if (input[inputOffset] === '\r' && input[inputOffset + 1] === '\n') inputOffset += 2;
      else inputOffset += 1;
    }
  };

  const finalizeRecord = () => {
    const sequence = currentSeq.join('');
    if (sequence.length === 0) {
      gapsInCurrent = 0;
      return;
    }

    const record: FastaRecord = {
      header: currentHeader,
      description: currentDescription,
      sequence,
      rawHeader: currentRawHeader,
    };
    if (gapsInCurrent > 0) {
      record.gapsRemoved = gapsInCurrent;
    }
    records.push(record);
    gapsInCurrent = 0;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const lineStartOffset = inputOffset;
    const trimmed = line.trim();
    // VOG-1812: legacy NBRF/PIR FASTA convention — `;` at line start is a
    // comment. Skip these everywhere so they don't get treated as sequence
    // text and bleed AA-only letters into composition analysis downstream.
    if (trimmed.startsWith(';')) {
      advanceInputOffset(line);
      continue;
    }
    if (trimmed.startsWith('>')) {
      // Save the previous record before starting a new header.
      if (hasActiveHeader) {
        finalizeRecord();
      }

      // Parse new header
      const headerLine = trimmed.slice(1).trim();
      currentRawHeader = headerLine;
      const spaceMatch = headerLine.match(/\s/);
      if (!spaceMatch || spaceMatch.index == null) {
        currentHeader = headerLine;
        currentDescription = '';
      } else {
        currentHeader = headerLine.slice(0, spaceMatch.index);
        currentDescription = headerLine.slice(spaceMatch.index + 1).trim();
      }
      currentSeq = [];
      hasActiveHeader = true;
    } else if (line.length > 0 && hasActiveHeader) {
      // Sequence lines accept ASCII formatting whitespace and the historical
      // alignment-gap convention (`-` / `.`). All other characters are
      // retained as residues only when they are ASCII letters or `*`; an
      // invalid byte is rejected before it can change the sequence length.
      let cleaned = '';
      for (let columnIndex = 0; columnIndex < line.length; columnIndex += 1) {
        const character = line[columnIndex];
        if (character === ' ' || character === '\t' || character === '\r') continue;
        if (character === '-' || character === '.') {
          gapsInCurrent += 1;
          continue;
        }
        if (/^[A-Za-z*]$/.test(character)) {
          cleaned += character;
          continue;
        }
        throw new FastaParseError(
          lineIndex + 1,
          columnIndex + 1,
          lineStartOffset + columnIndex,
          character,
        );
      }
      currentSeq.push(cleaned);
    }

    advanceInputOffset(line);
  }

  // Save last record
  if (hasActiveHeader) {
    finalizeRecord();
  }

  return records;
}

function looksLikeEmbeddedFastaSequenceLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('>')) return false;
  if (/^[A-Z][a-z]+[.!?]?$/.test(trimmed)) return false;
  if (/[.!?]$/.test(trimmed) && /[a-z]/.test(trimmed)) return false;
  const hasUnsupportedPunctuation = /[^A-Za-z*.\-\s\d]/.test(trimmed);
  if (hasUnsupportedPunctuation) {
    const letters = trimmed.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (letters.length === 0) return false;
    let nucleotideLike = 0;
    for (const char of letters) {
      if ('ACGTUNRYSWKMBDHV'.includes(char)) nucleotideLike += 1;
    }
    if (nucleotideLike / letters.length < 0.8) return false;
  }
  if (!hasUnsupportedPunctuation && !/^[A-Za-z*.\-\s\d]+$/.test(trimmed)) return false;
  const letterRuns = trimmed.match(/[A-Za-z*.-]+/g) ?? [];
  if (letterRuns.length === 0) return false;
  const cleanedLength = letterRuns.join('').replace(/[.-]/g, '').length;
  if (cleanedLength === 0) return false;
  // Prompt prose usually appears as short words. Allow grouped sequence rows
  // ("ATGC ATGC") but reject sentence-like rows ("Here is the sequence").
  return letterRuns.length === 1
    || (cleanedLength >= 10 && letterRuns.every((run) => run.length >= 3));
}

function looksLikeLeadingRawSequenceLine(line: string): boolean {
  if (!looksLikeEmbeddedFastaSequenceLine(line)) return false;
  const rawLetters = line.replace(/[^A-Za-z*]/g, '');
  const letters = rawLetters.toUpperCase();
  if (letters.length < 10) return false;

  let nucleotideLike = 0;
  let proteinSignal = 0;
  let uppercase = 0;
  for (const char of letters) {
    if ('ACGTUNRYSWKMBDHV'.includes(char)) nucleotideLike += 1;
    if ('EFILPQZX*'.includes(char)) proteinSignal += 1;
  }
  for (const char of rawLetters) {
    if (char === char.toUpperCase() && char !== char.toLowerCase()) uppercase += 1;
  }

  return nucleotideLike / letters.length >= 0.8
    || (proteinSignal / letters.length >= 0.05 && uppercase / letters.length >= 0.8);
}

/**
 * Extract FASTA records embedded in a larger prompt-style paste.
 *
 * This is deliberately conservative: it ignores prose before the first `>`
 * header, preserves raw sequence lines that precede FASTA records as a
 * synthetic "Pasted sequence" record, and stops a record when sentence-like
 * text appears after sequence rows. The normal parser still handles clean FASTA
 * directly.
 */
export function extractEmbeddedFastaContent(input: string): string | null {
  const output: string[] = [];
  const leadingSequenceLines: string[] = [];
  let inRecord = false;
  let currentHasSequence = false;
  let sawHeader = false;
  let leadingSequenceFlushed = false;

  const flushLeadingSequence = () => {
    if (leadingSequenceFlushed || leadingSequenceLines.length === 0) return;
    output.push('>Pasted sequence');
    output.push(...leadingSequenceLines);
    leadingSequenceFlushed = true;
  };

  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('>')) {
      flushLeadingSequence();
      output.push(trimmed);
      inRecord = true;
      currentHasSequence = false;
      sawHeader = true;
      continue;
    }

    if (!inRecord) {
      if (looksLikeLeadingRawSequenceLine(trimmed)) {
        leadingSequenceLines.push(trimmed);
      }
      continue;
    }
    if (!trimmed || trimmed.startsWith(';')) {
      output.push(line);
      continue;
    }

    if (looksLikeEmbeddedFastaSequenceLine(trimmed)) {
      output.push(trimmed);
      currentHasSequence = true;
      continue;
    }

    if (currentHasSequence) {
      inRecord = false;
      currentHasSequence = false;
    }
  }

  if (!sawHeader) return null;
  const extracted = output.join('\n').trim();
  return parseFasta(extracted).length > 0 ? extracted : null;
}

/**
 * VOG-1983: FASTA headers are single-line records — the spec uses an
 * unescaped newline as the boundary between one record and the next.
 * If a block name (`r.header`) or description contains a literal `\n`
 * or `\r`, emitting it verbatim into the header silently splits the
 * record into multiple FASTA entries at export, and re-parsing those
 * entries loses the original name (and may drop sequence rows that
 * happen to start with `>`-resembling characters).
 *
 * We sanitize header and description at the export boundary by
 * collapsing every CR/LF (and the joint CRLF) into a single space.
 * This preserves the visual content while making the export
 * round-trip safe. The parser side strips noise inside sequence rows
 * already, so newlines in `r.sequence` can pass through unchanged.
 */
function sanitizeFastaHeaderField(value: string): string {
  return value.replace(/\r\n|[\r\n]+/g, ' ');
}

/**
 * Convert records back to FASTA format string.
 */
export function toFasta(records: FastaRecord[], lineWidth = 80): string {
  if (!Number.isInteger(lineWidth) || lineWidth <= 0) {
    throw new Error('lineWidth must be a positive integer.');
  }
  return records
    .map(r => {
      // VOG-1983: collapse newlines so a multi-line block name does not
      // silently fragment the export into multiple FASTA records.
      const safeHeader = sanitizeFastaHeaderField(r.header);
      const safeDescription = r.description ? sanitizeFastaHeaderField(r.description) : '';
      const header = safeDescription ? `>${safeHeader} ${safeDescription}` : `>${safeHeader}`;
      const lines: string[] = [header];
      for (let i = 0; i < r.sequence.length; i += lineWidth) {
        lines.push(r.sequence.slice(i, i + lineWidth));
      }
      return lines.join('\n');
    })
    .join('\n');
}
