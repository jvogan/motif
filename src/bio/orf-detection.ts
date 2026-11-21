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
  /**
   * Initiator codons that may open an ORF. Defaults to every initiator the
   * codon table lists, which for Table 1 includes the alternative TTG and CTG
   * starts. Pass `['ATG']` to consider only the canonical initiator.
   */
  startCodons?: readonly string[];
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

type AmbiguousCodon = { warning: string; positions: number[] };

function firstPositionAtOrAfter(positions: readonly number[], start: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (positions[mid] < start) low = mid + 1;
    else high = mid;
  }
  return positions[low] ?? Infinity;
}

function ambiguityWarning(codon: string, table: CodonTable): string {
  const resolution = resolveIupacCodon(codon, table);
  if (resolution.residue !== null) {
    return `Ambiguous codon ${codon} resolves deterministically to ${resolution.residue}`;
  }
  const possibilities = resolution.residues.length > 0 ? resolution.residues.join('/') : 'an unknown residue';
  return `Ambiguous codon ${codon} is indeterminate (${possibilities})`;
}

function boundaryWarning(topology: Topology): string {
  return topology === 'circular'
    ? 'No in-frame stop codon within one complete circular revolution'
    : 'No in-frame stop codon before the sequence boundary';
}

// The weak key ties cached scans to the lifetime of the codon table. Each
// table's cache is bounded by entry count, key characters, and result count.
const ORF_CACHE_LIMIT = 32;
const ORF_CACHE_MAX_CHARS = 4_000_000;
const ORF_CACHE_MAX_RESULTS = 50_000;
const ORF_CACHE_MAX_RESULTS_PER_ENTRY = 25_000;

const orfCache = new WeakMap<CodonTable, Map<string, ORF[]>>();

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

/**
 * Scan all six reading frames, including partial ORFs at sequence boundaries.
 * Ambiguity warnings identify codons whose concrete expansions disagree.
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
  const startCodons = options?.startCodons === undefined
    ? null
    : new Set(options.startCodons.map((codon) => codon.toUpperCase().replaceAll('U', 'T')));
  const seqLen = upper.length;
  if (seqLen < 3) return [];

  const startKey = startCodons === null ? '*' : [...startCodons].sort().join(',');
  const cacheKey = `${codonTableVersion(effectiveTable)}|${topology}|${effectiveMinAa}|${startKey}|${upper}`;
  const cacheableSequence = cacheKey.length <= ORF_CACHE_MAX_CHARS;
  let tableCache = orfCache.get(effectiveTable);
  const cached = cacheableSequence ? tableCache?.get(cacheKey) : undefined;
  if (cached) return cloneORFs(cached);

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
      startCodons,
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
      startCodons,
    );
    for (const orf of found) {
      if (circular && orf.start >= seqLen) continue;
      const origStart = seqLen - orf.end;
      const origEnd = seqLen - orf.start;
      const wrap = origStart < 0 ? seqLen : 0;
      orf.start = origStart + wrap;
      orf.end = origEnd + wrap;
      orfs.push(orf);
    }
  }

  orfs.sort((a, b) => b.length - a.length);

  // A short, start-dense record can produce far more retained objects than its
  // sequence key suggests. Return the complete answer, but do not make that
  // transient result a long-lived cache entry.
  if (!cacheableSequence || orfs.length > ORF_CACHE_MAX_RESULTS_PER_ENTRY) return orfs;

  if (!tableCache) {
    tableCache = new Map<string, ORF[]>();
    orfCache.set(effectiveTable, tableCache);
  }
  rememberOrfScan(tableCache, cacheKey, orfs);
  return cloneORFs(orfs);
}

/** Store one scan and evict the oldest entries first, retaining the newest. */
export function rememberOrfScan(
  cache: Map<string, ORF[]>,
  key: string,
  orfs: ORF[],
  maxChars = ORF_CACHE_MAX_CHARS,
): void {
  cache.set(key, orfs);
  let cachedChars = 0;
  let cachedResults = 0;
  for (const [cachedKey, result] of cache) {
    cachedChars += cachedKey.length;
    cachedResults += result.length;
  }
  while (cache.size > 1 && (
    cache.size > ORF_CACHE_LIMIT
    || cachedChars > maxChars
    || cachedResults > ORF_CACHE_MAX_RESULTS
  )) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cachedChars -= oldest.value.length;
    cachedResults -= cache.get(oldest.value)?.length ?? 0;
    cache.delete(oldest.value);
  }
}

/**
 * Frame of an ORF start on its own strand. A circular scan reads a doubled
 * buffer and may keep an ORF from the second copy, so the start is reduced
 * modulo the record length before taking the codon phase; otherwise the
 * label would depend on the buffer copy whenever the length is not a
 * multiple of three.
 */
function frameForStart(startPos: number, originalLength: number): 1 | 2 | 3 {
  return (((startPos % originalLength) % 3) + 1) as 1 | 2 | 3;
}

function findORFsInFrame(
  seq: string,
  frameOffset: number,
  strand: 1 | -1,
  table: CodonTable,
  minAminoAcids: number,
  originalLength: number,
  topology: Topology,
  startCodons: ReadonlySet<string> | null,
): ORF[] {
  const orfs: ORF[] = [];
  const stops = new Set(table.stops);
  const startPositions: number[] = [];
  const stopPositions: number[] = [];
  const hasAmbiguity = /[RYSWKMBDHVN]/.test(seq);
  const ambiguousCodons = new Map<string, AmbiguousCodon>();

  for (let position = frameOffset; position + 2 < seq.length; position += 3) {
    const codon = seq.slice(position, position + 3);
    const initiator = startCodons === null
      ? isDefiniteInitiatorCodon(codon, table)
      : isDefiniteCodonMember(codon, startCodons);
    if (initiator) startPositions.push(position);
    if (isDefiniteCodonMember(codon, stops)) stopPositions.push(position);
    if (hasAmbiguity && /[RYSWKMBDHVN]/.test(codon)) {
      let evidence = ambiguousCodons.get(codon);
      if (!evidence) {
        evidence = { warning: ambiguityWarning(codon, table), positions: [] };
        ambiguousCodons.set(codon, evidence);
      }
      evidence.positions.push(position);
    }
  }

  // Most overlapping candidates are only counted. Materialize their evidence
  // on read, using the first occurrence of each codon in the interval.
  const withWarnings = (orf: ORF): ORF => {
    const { start, end, status } = orf;
    if (ambiguousCodons.size === 0) {
      orf.warnings = status === 'partial' ? [boundaryWarning(topology)] : [];
      return orf;
    }
    const setWarnings = (warnings: string[] | undefined) => {
      Object.defineProperty(orf, 'warnings', { value: warnings, enumerable: true, writable: true, configurable: true });
    };
    return Object.defineProperty(orf, 'warnings', {
      enumerable: true,
      configurable: true,
      get() {
        const evidence: Array<{ position: number; warning: string }> = [];
        for (const { warning, positions } of ambiguousCodons.values()) {
          const position = firstPositionAtOrAfter(positions, start);
          if (position + 2 < end) evidence.push({ position, warning });
        }
        evidence.sort((left, right) => left.position - right.position);
        const warnings = evidence.map(({ warning }) => warning);
        if (status === 'partial') warnings.push(boundaryWarning(topology));
        setWarnings(warnings);
        return warnings;
      },
      set: setWarnings,
    });
  };

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
        orfs.push(withWarnings({
          start: startPos,
          end: stopPos + 3,
          frame: frameForStart(startPos, originalLength),
          strand,
          length: bpLength,
          aminoAcids: aaLength,
          startCodon: seq.slice(startPos, startPos + 3),
          stopCodon: seq.slice(stopPos, stopPos + 3),
          status: 'complete',
        }));
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
      orfs.push(withWarnings({
        start: startPos,
        end: implicitEnd,
        frame: frameForStart(startPos, originalLength),
        strand,
        length: bpLength,
        aminoAcids: aaLength,
        startCodon: seq.slice(startPos, startPos + 3),
        stopCodon: '',
        status: 'partial',
      }));
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
