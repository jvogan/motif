/**
 * Pure helpers that keep one selection shared by every view: what a record had
 * selected when the reader left it, what a double- or triple-click in the
 * sequence selects, which digest fragments a gel band stands for, and where a
 * primer's binding site is drawn on one sequence line.
 *
 * Everything here is view state. None of it is saved in the workspace or sent
 * to the host, so none of it can make a record count as changed.
 */
import type { Feature, Topology } from '../bio/types';
import { featureSpans, normalizeSpan } from '../plasmid-map/geometry/ranges';

/** A selected object in the open record. A selected range lives beside it, per record. */
export type RecordObjectSelection =
  | { kind: 'feature'; id: string }
  | { kind: 'restriction'; clusterId: string; tickIds: readonly string[]; enzyme?: string };

/** What one record had selected when the reader switched to another record. */
export type RememberedRecordSelection<T> = {
  /** The record's sequence when it was left. A changed sequence drops every position. */
  sequence: string;
  selection: RecordObjectSelection | null;
  caret: number | null;
  lockedTranslateTarget: T | null;
};

export type RestoredRecordSelection<T> = {
  selection: RecordObjectSelection | null;
  caret: number | null;
  lockedTranslateTarget: T | null;
};

const NOTHING_SELECTED = { selection: null, caret: null, lockedTranslateTarget: null } as const;

/**
 * What to select when the reader comes back to a record. A feature comes back
 * while the record still has it. A restriction site, the caret and a locked
 * translation target are positions, so they come back only when the sequence
 * is the one the reader left.
 */
export function restoreRecordSelection<T extends { start: number; end: number }>(
  remembered: RememberedRecordSelection<T> | undefined,
  record: { sequence: string; features: readonly Pick<Feature, 'id'>[] } | null | undefined,
): RestoredRecordSelection<T> {
  if (!remembered || !record) return NOTHING_SELECTED;
  const { selection } = remembered;
  const featureStillThere = selection?.kind === 'feature'
    && record.features.some((feature) => feature.id === selection.id);
  if (record.sequence !== remembered.sequence) {
    return featureStillThere ? { ...NOTHING_SELECTED, selection } : NOTHING_SELECTED;
  }
  const length = record.sequence.length;
  const caret = remembered.caret !== null && Number.isInteger(remembered.caret)
    && remembered.caret >= 0 && remembered.caret <= length
    ? remembered.caret
    : null;
  const target = remembered.lockedTranslateTarget;
  return {
    selection: selection?.kind === 'feature' ? (featureStillThere ? selection : null) : selection,
    caret,
    lockedTranslateTarget: target && target.start >= 0 && target.end > target.start ? target : null,
  };
}

export type BaseRange = { start: number; end: number };

/** The 10-base group (1-10, 11-20, ...) that holds base `index`, cut at the sequence end. */
export function decadeRangeAt(index: number, sequenceLength: number): BaseRange | null {
  if (!Number.isInteger(index) || index < 0 || index >= sequenceLength) return null;
  const start = index - (index % 10);
  return { start, end: Math.min(sequenceLength, start + 10) };
}

/** The displayed line that holds base `index`. */
export function lineRangeAt(index: number, basesPerLine: number, sequenceLength: number): BaseRange | null {
  if (!Number.isInteger(index) || index < 0 || index >= sequenceLength || !(basesPerLine > 0)) return null;
  const start = index - (index % basesPerLine);
  return { start, end: Math.min(sequenceLength, start + basesPerLine) };
}

/**
 * The feature a double-click on base `index` selects: of the features with a
 * span over that base, the one covering the fewest bases. A joined feature
 * covers only its spans, so a base in an intron does not select it. Ties go to
 * the feature that starts first, then to list order.
 */
export function smallestFeatureAt<F extends Pick<Feature, 'start' | 'end' | 'strand' | 'subRanges'>>(
  features: readonly F[],
  index: number,
  sequenceLength: number,
  topology: Topology,
): F | null {
  let best: { feature: F; covered: number; start: number } | null = null;
  for (const feature of features) {
    const spans = featureSpans(feature, sequenceLength, topology);
    if (!spans.some((span) => index >= span.start && index < span.end)) continue;
    const covered = spans.reduce((total, span) => total + (span.end - span.start), 0);
    const start = Math.min(...spans.map((span) => span.start));
    if (!best || covered < best.covered || (covered === best.covered && start < best.start)) {
      best = { feature, covered, start };
    }
  }
  return best?.feature ?? null;
}

/**
 * Which fragments each gel band stands for, as fragment numbers (0-based, in
 * the saved digest's order). A band lists one size per fragment, duplicates
 * included, so equal sizes are matched to fragments in order.
 */
export function gelBandFragmentIndexes(
  fragmentLengthsBp: readonly number[],
  bands: readonly { bandIndex: number; fragmentSizesBp: readonly number[] }[],
): Map<number, number[]> {
  const unused = new Map<number, number[]>();
  fragmentLengthsBp.forEach((length, index) => {
    const indexes = unused.get(length);
    if (indexes) indexes.push(index);
    else unused.set(length, [index]);
  });
  const byBand = new Map<number, number[]>();
  for (const band of bands) {
    const indexes: number[] = [];
    for (const size of band.fragmentSizesBp) {
      const next = unused.get(size)?.shift();
      if (next !== undefined) indexes.push(next);
    }
    byBand.set(band.bandIndex, indexes.sort((a, b) => a - b));
  }
  return byBand;
}

/** The position in `indexes` of the fragment that is the current selection, or -1. */
export function selectedGelBandFragment(
  indexes: readonly number[],
  fragmentRanges: readonly BaseRange[],
  selected: BaseRange | null,
): number {
  if (!selected) return -1;
  return indexes.findIndex((index) => {
    const range = fragmentRanges[index];
    return !!range && range.start === selected.start && range.end === selected.end;
  });
}

/**
 * The fragment a band selects when it is activated: the first fragment, or the
 * one after the fragment it already selects, wrapping to the first.
 */
export function nextGelBandFragment(
  indexes: readonly number[],
  fragmentRanges: readonly BaseRange[],
  selected: BaseRange | null,
): number | null {
  if (indexes.length === 0) return null;
  const current = selectedGelBandFragment(indexes, fragmentRanges, selected);
  return indexes[(current + 1) % indexes.length];
}

/** A primer's binding site on the record: forward primers read 5′→3′ left to right. */
export type PrimerMark = { strand: 1 | -1; start: number; end: number };

/** One drawn piece of a primer mark on one line, in bases from the line start. */
export type PrimerMarkSegment = {
  strand: 1 | -1;
  left: number;
  width: number;
  /** This piece holds the primer's 3′ end, so it carries the arrowhead. */
  head: boolean;
};

/**
 * The pieces of each primer mark that fall on the line [lineStart, lineEnd).
 * A site that crosses a line break or the origin is drawn in pieces; only the
 * piece holding the 3′ end (the right end of a forward primer, the left end of
 * a reverse one) gets the arrowhead.
 */
export function primerMarkSegmentsForLine(
  marks: readonly PrimerMark[],
  lineStart: number,
  lineEnd: number,
  sequenceLength: number,
  topology: Topology,
): PrimerMarkSegment[] {
  const segments: PrimerMarkSegment[] = [];
  for (const mark of marks) {
    const spans = normalizeSpan(mark.start, mark.end, sequenceLength, topology);
    spans.forEach((span, spanIndex) => {
      const start = Math.max(span.start, lineStart);
      const end = Math.min(span.end, lineEnd);
      if (end <= start) return;
      const head = mark.strand === 1
        ? spanIndex === spans.length - 1 && end === span.end
        : spanIndex === 0 && start === span.start;
      segments.push({ strand: mark.strand, left: start - lineStart, width: end - start, head });
    });
  }
  return segments;
}

/**
 * The range that selects a primer's binding site in the open record, in the
 * selection's own form: a site across the origin of a circular record ends
 * past the record's length. A site written with its end before its start
 * crosses the origin too. Null for an empty site or one the record cannot hold.
 */
export function primerSiteRange(site: BaseRange, sequenceLength: number, topology: Topology): BaseRange | null {
  const { start, end } = site;
  if (!Number.isInteger(start) || !Number.isInteger(end) || sequenceLength <= 0 || start === end) return null;
  if (topology !== 'circular') {
    return start >= 0 && end > start && end <= sequenceLength ? { start, end } : null;
  }
  const length = end > start ? end - start : end - start + sequenceLength;
  if (length <= 0 || length > sequenceLength) return null;
  const first = ((start % sequenceLength) + sequenceLength) % sequenceLength;
  return { start: first, end: first + length };
}
