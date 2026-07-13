import type { FastaRecord } from './types';

/**
 * Parse a FASTA-format string into records.
 * Handles multi-line sequences and multiple records.
 *
 * Phase 35 P-I (P2-A22): if the input contained `-` or `.` characters
 * (CLUSTAL / MAFFT alignment gaps), they are stripped from the sequence and
 * a `gapsRemoved` count is attached to the resulting record so callers can
 * surface a "aligned input was degapped" warning. Other non-letter chars
 * are stripped silently (whitespace / digits / punctuation noise).
 */
export function parseFasta(input: string): FastaRecord[] {
  const records: FastaRecord[] = [];
  const lines = input.split(/\r?\n/);
  let currentHeader = '';
  let currentDescription = '';
  let currentRawHeader = '';
  let currentSeq: string[] = [];
  let hasActiveHeader = false;
  let gapsInCurrent = 0;

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

  for (const line of lines) {
    const trimmed = line.trim();
    // VOG-1812: legacy NBRF/PIR FASTA convention — `;` at line start is a
    // comment. Skip these everywhere so they don't get treated as sequence
    // text and bleed AA-only letters into composition analysis downstream.
    if (trimmed.startsWith(';')) {
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
    } else if (trimmed.length > 0 && hasActiveHeader) {
      // Sequence line — keep only ASCII letters plus the protein-FASTA stop
      // glyph `*`. Phase 34 P-F P1-A7: prior regex stripped only whitespace
      // and digits, leaking arbitrary punctuation / control chars into the
      // sequence string. Downstream validateAndCleanSequence would catch
      // and flag them, surfacing spurious "invalid characters" warnings
      // for legitimate protein FASTA with terminal stop codons or DNA
      // FASTA with stray punctuation from copy-paste. By stripping at the
      // parser level we keep the IUPAC + protein alphabet intact (incl.
      // ambiguity codes and `*`) without letting garbage bytes through.
      //
      // Phase 35 P-I (P2-A22): aligned input (CLUSTAL/MAFFT MSA output) has
      // `-` or `.` gap characters which we silently strip below. We still
      // strip them so downstream consumers see ungapped sequences, but we
      // bump a counter and surface it as `_gapsRemoved` on the record so a
      // caller (intake validator, FASTA importer) can warn the user that
      // an aligned sequence was degapped.
      const beforeLen = trimmed.length;
      const cleaned = trimmed.replace(/[^A-Za-z*]/g, '');
      const removed = beforeLen - cleaned.length;
      if (removed > 0) {
        // We track gaps separately from arbitrary noise: gap characters are
        // a meaningful signal ("this was aligned"), other stripped chars
        // (spaces, digits, punctuation) are just FASTA noise. Count only
        // the gap-like chars to keep the warning specific.
        const gapMatches = trimmed.match(/[-.]/g);
        if (gapMatches && gapMatches.length > 0) {
          // Attach to the last record-in-progress; finalizeRecord folds it in.
          gapsInCurrent += gapMatches.length;
        }
      }
      currentSeq.push(cleaned);
    }
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
