import type { ORF, CodonTable, Topology } from './types';
import { STANDARD_CODE } from './codon-tables';
import { expandIupacCodon, isDefiniteInitiatorCodon, normalizeTranslationInput, resolveIupacCodon } from './translate';
import { reverseComplement } from './reverse-complement';

/**
 * Options for [`findORFs`]. Circular scans may cross the origin, but never
 * inspect more than one complete revolution for a single candidate.
 */
export interface FindORFsOptions {
  /** Minimum ORF length in amino acids (default 30 = 90bp). */
  minAminoAcids?: number;
  /** Codon table (defaults to standard). */
  table?: CodonTable;
  /** Sequence topology. Defaults to `'linear'`. */
  topology?: Topology;
}

function isDefiniteCodonMember(codon: string, accepted: ReadonlySet<string>): boolean {
  const first = codon[0];
  const second = codon[1];
  const third = codon[2];
  if (
    (first === 'A' || first === 'C' || first === 'G' || first === 'T')
    && (second === 'A' || second === 'C' || second === 'G' || second === 'T')
    && (third === 'A' || third === 'C' || third === 'G' || third === 'T')
  ) {
    return accepted.has(codon);
  }
  const expansions = expandIupacCodon(codon);
  return expansions.length > 0 && expansions.every((concreteCodon) => accepted.has(concreteCodon));
}

function addWarning(warnings: string[], warning: string): void {
  if (!warnings.includes(warning)) warnings.push(warning);
}

function ambiguityWarnings(
  seq: string,
  start: number,
  end: number,
  table: CodonTable,
  hasAmbiguity: boolean,
): string[] {
  const warnings: string[] = [];
  if (!hasAmbiguity) return warnings;
  for (let position = start; position + 2 < end; position += 3) {
    const codon = seq.slice(position, position + 3);
    const resolution = resolveIupacCodon(codon, table);
    if (!resolution.ambiguous) continue;
    if (resolution.residue !== null) {
      addWarning(warnings, `Ambiguous codon ${codon} resolves deterministically to ${resolution.residue}`);
    } else {
      const possibilities = resolution.residues.length > 0 ? resolution.residues.join('/') : 'an unknown residue';
      addWarning(warnings, `Ambiguous codon ${codon} is indeterminate (${possibilities})`);
    }
  }
  return warnings;
}

function boundaryWarning(topology: Topology): string {
  return topology === 'circular'
    ? 'No in-frame stop codon within one complete circular revolution'
    : 'No in-frame stop codon before the sequence boundary';
}

/**
 * Find all ORFs in a DNA sequence across all 3 reading frames on both strands.
 * Valid IUPAC DNA ambiguity symbols are accepted. Each result explicitly
 * reports whether a table-recognized stop completed it or whether it is a
 * partial boundary-limited candidate; ambiguity warnings explain any codons
 * whose concrete expansions do not agree.
 */
export function findORFs(
  seq: string,
  minAminoAcids = 30,
  table: CodonTable = STANDARD_CODE,
  options?: FindORFsOptions,
): ORF[] {
  let upper: string;
  try {
    upper = normalizeTranslationInput(seq);
  } catch {
    // Protein sequences, gaps, and punctuation are not nucleotide input. Keep
    // the historical empty-result contract while translate() fails loudly.
    return [];
  }

  const effectiveMinAa = options?.minAminoAcids ?? minAminoAcids;
  const effectiveTable = options?.table ?? table;
  const topology: Topology = options?.topology ?? 'linear';
  const seqLen = upper.length;
  if (seqLen < 3) return [];

  const circular = topology === 'circular';
  const forwardScanBuffer = circular ? upper + upper : upper;
  const reverseSequence = reverseComplement(upper);
  const reverseScanBuffer = circular ? reverseSequence + reverseSequence : reverseSequence;
  const orfs: ORF[] = [];

  for (let frame = 0; frame < 3; frame += 1) {
    const found = findORFsInFrame(
      forwardScanBuffer,
      frame,
      1,
      effectiveTable,
      effectiveMinAa,
      seqLen,
      topology,
    );
    orfs.push(...(circular ? found.filter((orf) => orf.start < seqLen) : found));
  }

  for (let frame = 0; frame < 3; frame += 1) {
    const found = findORFsInFrame(
      reverseScanBuffer,
      frame,
      -1,
      effectiveTable,
      effectiveMinAa,
      seqLen,
      topology,
    );
    for (const orf of found) {
      if (circular) {
        const origStart = 2 * seqLen - orf.end;
        const origEnd = 2 * seqLen - orf.start;
        orf.start = origStart;
        orf.end = origEnd;
        if (orf.start >= 0 && orf.start < seqLen) orfs.push(orf);
      } else {
        const origStart = seqLen - orf.end;
        const origEnd = seqLen - orf.start;
        orf.start = origStart;
        orf.end = origEnd;
        orfs.push(orf);
      }
    }
  }

  orfs.sort((a, b) => b.length - a.length);
  return orfs;
}

function findORFsInFrame(
  seq: string,
  frameOffset: number,
  strand: 1 | -1,
  table: CodonTable,
  minAminoAcids: number,
  originalLength: number,
  topology: Topology,
): ORF[] {
  const orfs: ORF[] = [];
  const stops = new Set(table.stops);
  const startPositions: number[] = [];
  const stopPositions: number[] = [];
  const hasAmbiguity = /[RYSWKMBDHVN]/.test(seq);

  for (let position = frameOffset; position + 2 < seq.length; position += 3) {
    const codon = seq.slice(position, position + 3);
    if (isDefiniteInitiatorCodon(codon, table)) startPositions.push(position);
    if (isDefiniteCodonMember(codon, stops)) stopPositions.push(position);
  }

  let nextStopIndex = 0;
  for (const startPos of startPositions) {
    while (nextStopIndex < stopPositions.length && stopPositions[nextStopIndex] <= startPos) {
      nextStopIndex += 1;
    }

    const stopPos = stopPositions[nextStopIndex];
    const revolutionEnd = startPos + originalLength;
    if (stopPos !== undefined && (!topology || stopPos + 3 <= (topology === 'circular' ? revolutionEnd : seq.length))) {
      const bpLength = stopPos + 3 - startPos;
      const aaLength = Math.floor(bpLength / 3) - 1;
      if (aaLength >= minAminoAcids) {
        const warnings = ambiguityWarnings(seq, startPos, stopPos + 3, table, hasAmbiguity);
        orfs.push({
          start: startPos,
          end: stopPos + 3,
          frame: ((frameOffset % 3) + 1) as 1 | 2 | 3,
          strand,
          length: bpLength,
          aminoAcids: aaLength,
          startCodon: seq.slice(startPos, startPos + 3),
          stopCodon: seq.slice(stopPos, stopPos + 3),
          status: 'complete',
          warnings,
        });
        continue;
      }
      continue;
    }

    // A partial ORF is bounded by the sequence end in a linear record and by
    // one complete revolution in a circular record. No synthetic stop codon is
    // claimed at that boundary.
    const boundary = topology === 'circular' ? revolutionEnd : seq.length;
    const implicitEnd = startPos + Math.floor(Math.max(0, boundary - startPos) / 3) * 3;
    const bpLength = implicitEnd - startPos;
    const aaLength = bpLength / 3;
    if (aaLength >= minAminoAcids) {
      const warnings = ambiguityWarnings(seq, startPos, implicitEnd, table, hasAmbiguity);
      addWarning(warnings, boundaryWarning(topology));
      orfs.push({
        start: startPos,
        end: implicitEnd,
        frame: ((frameOffset % 3) + 1) as 1 | 2 | 3,
        strand,
        length: bpLength,
        aminoAcids: aaLength,
        startCodon: seq.slice(startPos, startPos + 3),
        stopCodon: '',
        status: 'partial',
        warnings,
      });
    }
  }

  return orfs;
}

/** Find the longest ORF in a sequence. */
export function findLongestORF(
  seq: string,
  table: CodonTable = STANDARD_CODE,
): ORF | null {
  const orfs = findORFs(seq, 1, table);
  return orfs.length > 0 ? orfs[0] : null;
}
