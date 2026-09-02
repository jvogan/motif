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
/**
 * A six-frame scan is expensive and its answer depends on nothing but the four
 * arguments below, so it is worth remembering.
 *
 * Two callers asked the same question over and over. Dragging a range selection
 * re-ran the whole scan on every pointermove, because the effect that keeps the
 * artifact's snapshot current lists the selection in its dependencies and the
 * snapshot names the longest ORF — measured at 4.9ms of scan per move on
 * pUC19 and 10.6ms on a 6,788 bp record, where one move already costs more than
 * a whole frame. A selection cannot change a record's ORFs, so all of it was
 * waste. Switching back to a record you have already opened paid the same scan
 * again, 17.7ms of a 53ms switch.
 *
 * The table is the WeakMap key so a genetic code the app has dropped takes its
 * results with it. The inner map is bounded because sequences are not: it holds
 * the last ORF_CACHE_LIMIT distinct (topology, minimum, sequence) triples and
 * evicts in insertion order.
 *
 * That limit was 12 while the shipped inventory holds 13 records, which is the
 * worst possible pairing: walking the tab strip evicts the entry you are about
 * to ask for, so a lap missed every single time and the round-robin switch only
 * improved from 48.5ms to 42.5ms while a two-record alternation went to 27.0ms
 * with no long tasks at all. The count is 32 now, and additional bounds cap the
 * total sequence and ORF objects held, so long or ORF-dense records cannot turn
 * a cache into a leak. Oversized result sets are returned but not cached. The
 * entry just inserted is never the one evicted.
 *
 * Hits return a copy. The scan mutates its own ORF objects while unwinding the
 * reverse strand, and a caller that sorted or spliced the array it was handed
 * would otherwise rewrite the cached answer for everyone after it.
 */
const ORF_CACHE_LIMIT = 32;
const ORF_CACHE_MAX_CHARS = 4_000_000;
const ORF_CACHE_MAX_RESULTS = 50_000;
const ORF_CACHE_MAX_RESULTS_PER_ENTRY = 25_000;

type ORFCacheEntry = {
  orfs: ORF[];
  sequenceChars: number;
};

const orfCache = new WeakMap<CodonTable, Map<string, ORFCacheEntry>>();

type CodonTableSnapshot = {
  starts: string[];
  stops: string[];
  codonKeys: string[];
  codonValues: string[];
  version: number;
};

const codonTableSnapshots = new WeakMap<CodonTable, CodonTableSnapshot>();

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function codonTableVersion(table: CodonTable): number {
  const previous = codonTableSnapshots.get(table);
  const codonKeys = Object.keys(table.codons);
  const unchanged = previous
    && sameStrings(previous.starts, table.starts)
    && sameStrings(previous.stops, table.stops)
    && sameStrings(previous.codonKeys, codonKeys)
    && previous.codonValues.every((value, index) => value === table.codons[codonKeys[index]]);
  if (unchanged) return previous.version;

  const next: CodonTableSnapshot = {
    starts: [...table.starts],
    stops: [...table.stops],
    codonKeys,
    codonValues: codonKeys.map((key) => table.codons[key]),
    version: (previous?.version ?? 0) + 1,
  };
  codonTableSnapshots.set(table, next);
  return next.version;
}

function cloneORFs(orfs: readonly ORF[]): ORF[] {
  return orfs.map((orf) => ({
    ...orf,
    ...(orf.warnings ? { warnings: [...orf.warnings] } : {}),
  }));
}

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

  const cacheKey = `${codonTableVersion(effectiveTable)}|${topology}|${effectiveMinAa}|${upper}`;
  const cacheableSequence = upper.length <= ORF_CACHE_MAX_CHARS;
  let tableCache = orfCache.get(effectiveTable);
  const cached = cacheableSequence ? tableCache?.get(cacheKey) : undefined;
  if (cached) return cloneORFs(cached.orfs);

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
    // Appended one at a time, not spread. `push(...found)` passes every ORF as
    // an argument, and a record long enough to yield tens of thousands of them
    // in one frame overflows the argument list: a 2.4 Mb sequence threw
    // `RangeError: Maximum call stack size exceeded` here, so the scan crashed
    // on exactly the records it takes longest to run.
    for (const orf of found) {
      if (!circular || orf.start < seqLen) orfs.push(orf);
    }
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

  // A short, start-dense record can produce far more retained objects than its
  // sequence key suggests. Return the complete answer, but do not make that
  // transient result a long-lived cache entry.
  if (!cacheableSequence || orfs.length > ORF_CACHE_MAX_RESULTS_PER_ENTRY) return orfs;

  if (!tableCache) {
    tableCache = new Map<string, ORFCacheEntry>();
    orfCache.set(effectiveTable, tableCache);
  }
  tableCache.set(cacheKey, { orfs, sequenceChars: upper.length });
  let cachedChars = 0;
  let cachedResults = 0;
  for (const value of tableCache.values()) {
    cachedChars += value.sequenceChars;
    cachedResults += value.orfs.length;
  }
  while (tableCache.size > 0 && (
    tableCache.size > ORF_CACHE_LIMIT
    || cachedChars > ORF_CACHE_MAX_CHARS
    || cachedResults > ORF_CACHE_MAX_RESULTS
  )) {
    const oldest = tableCache.keys().next();
    if (oldest.done) break;
    const evicted = tableCache.get(oldest.value);
    cachedChars -= evicted?.sequenceChars ?? 0;
    cachedResults -= evicted?.orfs.length ?? 0;
    tableCache.delete(oldest.value);
  }
  return cloneORFs(orfs);
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
