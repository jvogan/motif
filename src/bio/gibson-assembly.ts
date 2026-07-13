import type { Feature } from './types';
import { meltingTemperature } from './gc-content';

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

export interface GibsonResult {
  sequence: string;
  features: Feature[];
  overlaps: Overlap[];
  topology: 'linear' | 'circular';
  success: boolean;
  errors: string[];
  warnings: string[];
}

const DEFAULT_MIN_OVERLAP = 15;
const DEFAULT_MAX_OVERLAP = 60;
const IDEAL_OVERLAP_TM = 50; // °C minimum recommended Tm

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
  const upper1 = seq1.toUpperCase();
  const upper2 = seq2.toUpperCase();

  const effectiveMax = Math.min(maxOverlap, upper1.length, upper2.length);

  for (let len = effectiveMax; len >= minOverlap; len--) {
    const tail = upper1.slice(upper1.length - len);
    const head = upper2.slice(0, len);
    if (tail === head) {
      const tm = meltingTemperature(tail) ?? 0;
      return {
        sequence: tail,
        length: len,
        tm,
        position1: upper1.length - len,
        position2: len,
      };
    }
  }

  return null;
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

  if (fragments.length < 2) {
    return {
      sequence: '',
      features: [],
      overlaps: [],
      topology,
      success: false,
      errors: ['Gibson Assembly requires at least 2 fragments'],
      warnings: [],
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
    const ov = findOverlap(a.sequence, b.sequence, minOverlap, maxOverlap);
    if (ov === null) {
      errors.push(
        `No overlap found between fragment "${a.name}" and "${b.name}" (need ${minOverlap}–${maxOverlap} bp exact match)`,
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
    closingOverlap = findOverlap(last.sequence, first.sequence, minOverlap, maxOverlap);
    if (closingOverlap === null) {
      errors.push(
        `No closing overlap found between fragment "${last.name}" and "${first.name}" — required for circular assembly (need ${minOverlap}–${maxOverlap} bp exact match)`,
      );
      warnings.push(
        `No closing overlap for circular assembly ("${last.name}" → "${first.name}"). Add ${minOverlap}–${maxOverlap} bp homology between the last and first fragments, or assemble as linear.`,
      );
    } else {
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
    return { sequence: '', features: [], overlaps, topology, success: false, errors, warnings };
  }

  // Assemble: start with first fragment, for each subsequent fragment
  // trim the overlap from its beginning before appending
  let sequence = fragments[0].sequence.toUpperCase();
  const features: Feature[] = [];
  let offset = 0;

  // Carry features from fragment 0
  for (const feat of fragments[0].features ?? []) {
    features.push({
      ...feat,
      id: crypto.randomUUID(),
      start: feat.start + offset,
      end: feat.end + offset,
      subRanges: feat.subRanges?.map((sr) => ({
        ...sr,
        start: sr.start + offset,
        end: sr.end + offset,
      })),
    });
  }

  for (let i = 1; i < fragments.length; i++) {
    const overlap = overlaps[i - 1];
    const frag = fragments[i];
    // The overlap region is already present at the end of the accumulated sequence;
    // skip it from the start of the next fragment
    const trimmed = frag.sequence.slice(overlap.length).toUpperCase();

    // Junction feature: the overlap region as it sits at the end of the current
    // accumulated sequence (before we append the trimmed portion).
    const junctionStart = sequence.length - overlap.length;
    const junctionEnd = sequence.length;
    features.push({
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

    offset = sequence.length;
    sequence += trimmed;

    // Shift features: coordinates in frag are relative to frag.sequence[0].
    // Features entirely within the overlap belong to the previous fragment
    // and are skipped. Features spanning the overlap boundary are truncated.
    const overlapLength = overlap.length;
    for (const feat of frag.features ?? []) {
      // Skip features entirely within the overlap (they belong to the previous fragment)
      if (feat.end <= overlapLength) continue;

      // Truncate features that span the overlap boundary
      const newStart = Math.max(feat.start - overlapLength, 0);
      const newEnd = feat.end - overlapLength;

      if (newEnd > newStart) {
        features.push({
          ...feat,
          id: crypto.randomUUID(),
          start: newStart + offset,
          end: newEnd + offset,
          subRanges: feat.subRanges
            ?.map((sr) => ({
              ...sr,
              start: Math.max(sr.start - overlapLength, 0) + offset,
              end: sr.end - overlapLength + offset,
            }))
            .filter((sr) => sr.end > sr.start),
        });
      }
    }
  }

  // Close the circle: the closing overlap currently sits at BOTH the start
  // (head of fragment 0) and the end (tail of the last fragment) of the linear
  // accumulator. Trim the trailing copy so the overlap appears exactly once,
  // and annotate the seam (which physically sits at [0, len) on the product).
  if (topology === 'circular' && closingOverlap && closingOverlap.length > 0) {
    sequence = sequence.slice(0, sequence.length - closingOverlap.length);
    features.push({
      id: crypto.randomUUID(),
      name: `Junction: ${fragments[fragments.length - 1].name}×${fragments[0].name} (${closingOverlap.length} bp, closing)`,
      type: 'misc_feature',
      start: 0,
      end: closingOverlap.length,
      strand: 1,
      color: '#8F4842',
      metadata: {
        source: 'gibson_assembly',
        overlapLength: closingOverlap.length,
        overlapTm: closingOverlap.tm,
        overlapSequence: closingOverlap.sequence,
        closing: true,
      },
    });
  }

  return { sequence, features, overlaps, topology, success: true, errors: [], warnings };
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
    const overlap = findOverlap(a.sequence, b.sequence, minOverlap, maxOverlap);
    const issues: string[] = [];

    if (overlap === null) {
      issues.push(`No overlap found (need ${minOverlap}–${maxOverlap} bp exact match)`);
    } else {
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
