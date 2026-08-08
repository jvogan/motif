import type { Feature } from './types';
import { meltingTemperature } from './gc-content';
import {
  aliasRemovedProductCoordinates,
  emptySourceToProductMap,
  mapFeatureThroughSourceCoordinates,
  type SourceToProductCoordinateMap,
} from './assembly-feature-mapping';
import { IUPAC_BASE_EXPANSIONS } from './translate';

export interface GibsonFragment {
  name: string;
  sequence: string;
  features?: Feature[];
}

export interface Overlap {
  sequence: string;
  length: number;
  tm: number;
  /** Position within seq1 where the overlap starts (= seq1.length - overlap.length) */
  position1: number;
  /** Position within seq2 where the overlap ends (= overlap.length) */
  position2: number;
}

export type OverlapSearchReason = 'none' | 'exact' | 'multiple_exact' | 'ambiguous_symbols';

/** Complete overlap evidence, including alternatives that the legacy helper hid. */
export interface OverlapSearchResult {
  candidates: Overlap[];
  maximalCandidates: Overlap[];
  selected: Overlap | null;
  /** True only when one maximal exact overlap is supported by the inputs. */
  unique: boolean;
  /** True when IUPAC ambiguity or multiple exact lengths require review. */
  ambiguous: boolean;
  reason: OverlapSearchReason;
}

export interface GibsonResult {
  sequence: string;
  features: Feature[];
  overlaps: Overlap[];
  topology: 'linear' | 'circular';
  success: boolean;
  errors: string[];
  warnings: string[];
  /** One entry per tested junction, including the circular closing seam. */
  overlapSearches?: OverlapSearchResult[];
}

const DEFAULT_MIN_OVERLAP = 15;
const DEFAULT_MAX_OVERLAP = 60;
const IDEAL_OVERLAP_TM = 50; // °C minimum recommended Tm

function fillFirstFragmentMap(map: SourceToProductCoordinateMap): void {
  for (let source = 0; source < map.sourceLength; source++) map.sourceToProduct[source] = source;
}

function fillNextFragmentMap(
  map: SourceToProductCoordinateMap,
  productOffset: number,
  overlapLength: number,
): void {
  for (let source = 0; source < map.sourceLength; source++) {
    map.sourceToProduct[source] = source < overlapLength
      ? productOffset - overlapLength + source
      : productOffset + source - overlapLength;
  }
}

function productCoordinateMap(
  length: number,
  closingOverlapLength: number,
): SourceToProductCoordinateMap {
  const productLength = length - closingOverlapLength;
  const sourceToProduct = Array.from({ length }, (_, source) => (
    source < productLength ? source : source - productLength
  ));
  return { sourceLength: length, productLength, sourceToProduct };
}

function closingJunctionFeature(
  leftName: string,
  rightName: string,
  overlap: Overlap,
  productLength: number,
): Feature | null {
  if (overlap.length <= 0 || productLength <= 0) return null;
  const seamLength = Math.min(overlap.length, productLength);
  return {
    id: crypto.randomUUID(),
    name: `Junction: ${leftName}×${rightName} (${overlap.length} bp, closing)`,
    type: 'misc_feature',
    start: 0,
    end: productLength,
    strand: 1,
    color: '#8F4842',
    metadata: {
      source: 'gibson_assembly',
      overlapLength: overlap.length,
      overlapTm: overlap.tm,
      overlapSequence: overlap.sequence,
      closing: true,
    },
    subRanges: [
      { start: productLength - seamLength, end: productLength, strand: 1 },
      { start: 0, end: seamLength, strand: 1 },
    ],
  };
}

/**
 * Find overlap between the 3' end of seq1 and the 5' end of seq2.
 * Scans from maxOverlap down to minOverlap for an exact match.
 */
export function findOverlap(
  seq1: string,
  seq2: string,
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
): Overlap | null {
  return analyzeOverlap(seq1, seq2, minOverlap, maxOverlap).selected;
}

function isUnambiguousDna(value: string): boolean {
  return /^[ACGT]+$/.test(value);
}

function iupacCompatible(left: string, right: string): boolean {
  const leftBases = IUPAC_BASE_EXPANSIONS[left];
  const rightBases = IUPAC_BASE_EXPANSIONS[right];
  if (!leftBases || !rightBases) return false;
  return leftBases.some((base) => rightBases.includes(base));
}

function makeOverlap(sequence: string, seq1Length: number): Overlap {
  return {
    sequence,
    length: sequence.length,
    tm: meltingTemperature(sequence) ?? 0,
    position1: seq1Length - sequence.length,
    position2: sequence.length,
  };
}

/**
 * Enumerate every exact tail/head length in the requested range. Ambiguous
 * IUPAC symbols are reported as a separate state and never treated as exact
 * homology; callers can choose to enumerate concrete expansions explicitly.
 */
export function analyzeOverlap(
  seq1: string,
  seq2: string,
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
): OverlapSearchResult {
  const upper1 = seq1.toUpperCase();
  const upper2 = seq2.toUpperCase();
  const effectiveMax = Math.min(maxOverlap, upper1.length, upper2.length);
  const candidates: Overlap[] = [];
  let plausibleAmbiguous = false;
  for (let length = effectiveMax; length >= minOverlap; length -= 1) {
    const tail = upper1.slice(upper1.length - length);
    const head = upper2.slice(0, length);
    if (tail === head && isUnambiguousDna(tail)) {
      candidates.push(makeOverlap(tail, upper1.length));
      continue;
    }
    if (tail.length === head.length && tail.length > 0 && [...tail].every((base, index) => {
      return iupacCompatible(base, head[index]);
    }) && (!isUnambiguousDna(tail) || !isUnambiguousDna(head))) {
      plausibleAmbiguous = true;
    }
  }
  const maxLength = candidates[0]?.length ?? 0;
  const maximalCandidates = candidates.filter((candidate) => candidate.length === maxLength);
  const selected = maximalCandidates[0] ?? null;
  if (candidates.length > 0) {
    return {
      candidates,
      maximalCandidates,
      selected,
      unique: maximalCandidates.length === 1 && candidates.length === 1,
      ambiguous: maximalCandidates.length !== 1 || candidates.length !== 1,
      reason: candidates.length === 1 ? 'exact' : 'multiple_exact',
    };
  }
  return {
    candidates: [],
    maximalCandidates: [],
    selected: null,
    unique: false,
    ambiguous: plausibleAmbiguous,
    reason: plausibleAmbiguous ? 'ambiguous_symbols' : 'none',
  };
}

/**
 * Simulate Gibson Assembly — join fragments via their overlapping homology regions.
 * For circular assembly the last fragment's 3' end must overlap the first fragment's 5' end.
 */
export function gibsonAssemble(
  fragments: GibsonFragment[],
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
  topology: 'linear' | 'circular' = 'linear',
): GibsonResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const overlaps: Overlap[] = [];
  const overlapSearches: OverlapSearchResult[] = [];

  if (fragments.length < 2) {
    return {
      sequence: '',
      features: [],
      overlaps: [],
      topology,
      success: false,
      errors: ['Gibson Assembly requires at least 2 fragments'],
      warnings: [],
      overlapSearches,
    };
  }

  const sequenceCounts = new Map<string, number>();
  for (const fragment of fragments) {
    const normalized = fragment.sequence.toUpperCase();
    sequenceCounts.set(normalized, (sequenceCounts.get(normalized) ?? 0) + 1);
  }
  for (const count of sequenceCounts.values()) {
    if (count > 1) {
      warnings.push(`${count} Gibson fragments have identical sequences — duplicate fragments can assemble ambiguously.`);
      break;
    }
  }

  // Find overlaps between each consecutive pair (linear assembly)
  for (let i = 0; i < fragments.length - 1; i++) {
    const a = fragments[i];
    const b = fragments[i + 1];
    const search = analyzeOverlap(a.sequence, b.sequence, minOverlap, maxOverlap);
    overlapSearches.push(search);
    const ov = search.selected;
    if (ov === null) {
      errors.push(
        search.reason === 'ambiguous_symbols'
          ? `Overlap between fragment "${a.name}" and "${b.name}" contains IUPAC ambiguity symbols; exact homology cannot be certified.`
          : `No overlap found between fragment "${a.name}" and "${b.name}" (need ${minOverlap}–${maxOverlap} bp exact match)`,
      );
      warnings.push(`No overlap detected for "${a.name}" → "${b.name}". Add ${minOverlap}–${maxOverlap} bp homology arms before assembly.`);
      overlaps.push({
        sequence: '',
        length: 0,
        tm: 0,
        position1: a.sequence.length,
        position2: 0,
      });
    } else {
      if (!search.unique) {
        warnings.push(`Overlap "${a.name}" → "${b.name}" has alternate exact lengths (${search.candidates.map((candidate) => candidate.length).join(', ')} bp); the longest is selected.`);
      }
      if (ov.tm < IDEAL_OVERLAP_TM) {
        warnings.push(
          `Overlap "${a.name}" → "${b.name}" has low Tm (${ov.tm.toFixed(1)} °C; recommended ≥ ${IDEAL_OVERLAP_TM} °C).`,
        );
      }
      overlaps.push(ov);
    }
  }

  // Circular: the last fragment's 3' end must overlap the first fragment's 5'
  // end. Detect that closing seam now — before the duplicate/low-Tm checks, so
  // they evaluate it too — and make a MISSING seam a hard error rather than a
  // silently-linear product with the closing overlap duplicated at both ends.
  // (R10 #3: previously `topology` was a pure label; the assembly loop only ran
  // i < length-1, so the seam was never tested and a cyclic fragment set yielded
  // a linear product carrying the closing overlap twice.)
  let closingOverlap: Overlap | null = null;
  if (topology === 'circular' && fragments.length >= 2) {
    const last = fragments[fragments.length - 1];
    const first = fragments[0];
    const closingSearch = analyzeOverlap(last.sequence, first.sequence, minOverlap, maxOverlap);
    overlapSearches.push(closingSearch);
    closingOverlap = closingSearch.selected;
    if (closingOverlap === null) {
      errors.push(
        closingSearch.reason === 'ambiguous_symbols'
          ? `Closing overlap between fragment "${last.name}" and "${first.name}" contains IUPAC ambiguity symbols; exact homology cannot be certified.`
          : `No closing overlap found between fragment "${last.name}" and "${first.name}" — required for circular assembly (need ${minOverlap}–${maxOverlap} bp exact match)`,
      );
      warnings.push(
        `No closing overlap for circular assembly ("${last.name}" → "${first.name}"). Add ${minOverlap}–${maxOverlap} bp homology between the last and first fragments, or assemble as linear.`,
      );
    } else {
      if (!closingSearch.unique) {
        warnings.push(`Closing overlap "${last.name}" → "${first.name}" has alternate exact lengths (${closingSearch.candidates.map((candidate) => candidate.length).join(', ')} bp); the longest is selected.`);
      }
      if (closingOverlap.tm < IDEAL_OVERLAP_TM) {
        warnings.push(
          `Closing overlap "${last.name}" → "${first.name}" has low Tm (${closingOverlap.tm.toFixed(1)} °C; recommended ≥ ${IDEAL_OVERLAP_TM} °C).`,
        );
      }
      overlaps.push(closingOverlap);
    }
  }

  const overlapCounts = new Map<string, number>();
  for (const overlap of overlaps) {
    if (overlap.sequence.length === 0) continue;
    overlapCounts.set(overlap.sequence, (overlapCounts.get(overlap.sequence) ?? 0) + 1);
  }
  for (const [sequence, count] of overlapCounts) {
    if (count > 1) {
      warnings.push(
        `Overlap ${sequence.slice(0, 20)}${sequence.length > 20 ? '...' : ''} is reused at ${count} junctions — duplicate overlaps can misassemble.`,
      );
    }
  }

  if (errors.length > 0) {
    return { sequence: '', features: [], overlaps, topology, success: false, errors, warnings, overlapSearches };
  }

  // Assemble: start with the first fragment, then append each fragment after
  // its already-present overlap. The per-fragment maps explicitly alias every
  // deduplicated overlap to the retained product copy.
  let sequence = fragments[0].sequence.toUpperCase();
  const sourceMaps = fragments.map((fragment) => emptySourceToProductMap(fragment.sequence.length, 0));
  fillFirstFragmentMap(sourceMaps[0]);
  const junctions: Feature[] = [];

  for (let i = 1; i < fragments.length; i++) {
    const overlap = overlaps[i - 1];
    const frag = fragments[i];
    // The overlap region is already present at the end of the accumulated sequence;
    // skip it from the start of the next fragment
    const trimmed = frag.sequence.slice(overlap.length).toUpperCase();

    const offset = sequence.length;
    fillNextFragmentMap(sourceMaps[i], offset, overlap.length);

    // Junction feature: the overlap region as it sits at the end of the
    // current accumulated sequence (before we append the trimmed portion).
    const junctionStart = sequence.length - overlap.length;
    const junctionEnd = sequence.length;
    junctions.push({
      id: crypto.randomUUID(),
      name: `Junction: ${fragments[i - 1].name}×${frag.name} (${overlap.length} bp)`,
      type: 'misc_feature',
      start: junctionStart,
      end: junctionEnd,
      strand: 1,
      color: '#8F4842', // de-color sweep: muted clay junction hue (distinct from gray misc_feature)
      metadata: {
        source: 'gibson_assembly',
        overlapLength: overlap.length,
        overlapTm: overlap.tm,
        overlapSequence: overlap.sequence,
      },
    });

    sequence += trimmed;
  }

  // Close the circle: the closing overlap currently sits at BOTH the start
  // (head of fragment 0) and the end (tail of the last fragment) of the linear
  // accumulator. Trim the trailing copy so the overlap appears exactly once,
  // and annotate the seam (which physically sits at [0, len) on the product).
  const preClosureLength = sequence.length;
  let productLength = preClosureLength;
  if (topology === 'circular' && closingOverlap && closingOverlap.length > 0) {
    productLength = Math.max(0, sequence.length - closingOverlap.length);
    if (productLength === 0) {
      return {
        sequence: '',
        features: [],
        overlaps,
        topology,
        success: false,
        errors: ['Circular Gibson assembly closing overlap consumes the entire assembled product; at least one non-overlap base is required.'],
        warnings,
        overlapSearches,
      };
    }
    sequence = sequence.slice(0, productLength);
  }

  aliasRemovedProductCoordinates(sourceMaps, productLength, preClosureLength);
  const finalProductMap = productCoordinateMap(preClosureLength, preClosureLength - productLength);
  const sourceFeatures = fragments.flatMap((fragment, index) => (fragment.features ?? []).flatMap((feature) => {
    const mapped = mapFeatureThroughSourceCoordinates(feature, sourceMaps[index]);
    return mapped ? [mapped] : [];
  }));
  const productFeatures = junctions.flatMap((junction) => {
    const mapped = mapFeatureThroughSourceCoordinates(junction, finalProductMap);
    return mapped ? [mapped] : [];
  });
  const closingJunction = topology === 'circular' && closingOverlap
    ? closingJunctionFeature(
      fragments[fragments.length - 1].name,
      fragments[0].name,
      closingOverlap,
      productLength,
    )
    : null;
  if (closingJunction) productFeatures.push(closingJunction);

  return {
    sequence,
    features: [...sourceFeatures, ...productFeatures],
    overlaps,
    topology,
    success: true,
    errors: [],
    warnings,
    overlapSearches,
  };
}

/**
 * Validate all overlaps in a set of fragments.
 * Checks Tm, length, and uniqueness between consecutive pairs. The
 * minOverlap/maxOverlap thresholds default to the Gibson defaults but are
 * forwarded by callers (e.g. the CLI's --min-overlap/--max-overlap) so that
 * validation matches the assembly the user actually requested (R10 #2).
 */
export function validateOverlaps(
  fragments: GibsonFragment[],
  minOverlap = DEFAULT_MIN_OVERLAP,
  maxOverlap = DEFAULT_MAX_OVERLAP,
): Array<{ pair: string; overlap: Overlap | null; valid: boolean; issues: string[] }> {
  const results: Array<{ pair: string; overlap: Overlap | null; valid: boolean; issues: string[] }> = [];

  for (let i = 0; i < fragments.length - 1; i++) {
    const a = fragments[i];
    const b = fragments[i + 1];
    const search = analyzeOverlap(a.sequence, b.sequence, minOverlap, maxOverlap);
    const overlap = search.selected;
    const issues: string[] = [];

    if (overlap === null) {
      issues.push(search.reason === 'ambiguous_symbols'
        ? 'Overlap contains IUPAC ambiguity symbols and is not certified as exact homology.'
        : `No overlap found (need ${minOverlap}–${maxOverlap} bp exact match)`);
    } else {
      if (!search.unique) issues.push(`Alternate exact overlaps found: ${search.candidates.map((candidate) => `${candidate.length} bp`).join(', ')}.`);
      if (overlap.length < minOverlap) {
        issues.push(`Overlap too short: ${overlap.length} bp (minimum ${minOverlap} bp)`);
      }
      if (overlap.tm < IDEAL_OVERLAP_TM) {
        issues.push(`Overlap Tm too low: ${overlap.tm.toFixed(1)} °C (recommended ≥ ${IDEAL_OVERLAP_TM} °C)`);
      }
    }

    results.push({
      pair: `${a.name} → ${b.name}`,
      overlap,
      valid: issues.length === 0,
      issues,
    });
  }

  return results;
}
