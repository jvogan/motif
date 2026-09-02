import type {
  MsaColumnViewSlot,
  MsaExpandedColumnRange,
} from './claude-science-msa';
import type { ClaudeScienceMsaColumnFilter } from './claude-science-msa-view-preferences';

type MsaColumnSegment =
  | {
    kind: 'columns';
    startColumn: number;
    endColumn: number;
    startSlot: number;
  }
  | {
    kind: 'elision';
    startColumn: number;
    endColumn: number;
    startSlot: number;
  };

type MsaElisionSlot = Extract<MsaColumnViewSlot, { kind: 'elision' }>;

/**
 * Column-space adapter for the virtualised matrix.
 *
 * Both an unfiltered view and an expanded difference range can contain a
 * million logical columns. They are continuous mappings, so retain them as
 * scalar segments rather than one slot object (or reverse-Map entry) per
 * column. `slotsInRange` is the sole materialisation boundary and callers use
 * it only for the rendered viewport or a bounded export window.
 */
export type MsaColumnView = {
  readonly slotCount: number;
  readonly isCompressed: boolean;
  /** Persistent descriptors, not transient viewport slots. */
  readonly materializedSlotCount: number;
  /** There is deliberately no per-column reverse index. */
  readonly indexedColumnCount: number;
  readonly shownColumnCount: number;
  slotAt(slotIndex: number): MsaColumnViewSlot | undefined;
  slotsInRange(startSlot: number, endSlot: number): MsaColumnViewSlot[];
  slotIndexForColumn(column: number): number | undefined;
  slotIndexForElision(slot: MsaElisionSlot): number | undefined;
  elisionForColumn(column: number): MsaElisionSlot | undefined;
};

function normalizedVisibleRanges({
  length,
  differingColumns,
  context,
  expandedRanges,
}: {
  length: number;
  differingColumns: readonly number[];
  context: number;
  expandedRanges: readonly MsaExpandedColumnRange[];
}): MsaExpandedColumnRange[] {
  const margin = Number.isFinite(context) ? Math.max(0, Math.floor(context)) : 3;
  // `differenceColumns` scans the alignment from left to right, so its output
  // is already ordered. Coalesce that ordered stream before creating range
  // descriptors. A dense million-column difference run is consequently one
  // range here, rather than a million short-lived objects to sort and merge.
  const ranges = normalizedDifferenceRanges(length, differingColumns, margin);
  // User-expanded ranges are few, independent interactions. Keep their
  // existing normalization and final merge with the difference-derived ranges.
  for (const range of expandedRanges) {
    const startColumn = Math.max(0, Math.min(length, Math.floor(range.startColumn)));
    const endColumn = Math.max(startColumn, Math.min(length, Math.ceil(range.endColumn)));
    if (endColumn > startColumn) ranges.push({ startColumn, endColumn });
  }
  ranges.sort((a, b) => a.startColumn - b.startColumn || a.endColumn - b.endColumn);
  const merged: MsaExpandedColumnRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (!previous || range.startColumn > previous.endColumn) merged.push({ ...range });
    else previous.endColumn = Math.max(previous.endColumn, range.endColumn);
  }
  return merged;
}

function normalizedDifferenceRanges(
  length: number,
  differingColumns: readonly number[],
  margin: number,
): MsaExpandedColumnRange[] {
  const ranges: MsaExpandedColumnRange[] = [];
  let activeStart = -1;
  let activeEnd = -1;

  for (const rawColumn of differingColumns) {
    if (!Number.isFinite(rawColumn)) continue;
    const column = Math.floor(rawColumn);
    if (column < 0 || column >= length) continue;
    const startColumn = Math.max(0, column - margin);
    const endColumn = Math.min(length, column + margin + 1);
    if (activeStart < 0) {
      activeStart = startColumn;
      activeEnd = endColumn;
    } else if (startColumn <= activeEnd) {
      activeEnd = Math.max(activeEnd, endColumn);
    } else {
      ranges.push({ startColumn: activeStart, endColumn: activeEnd });
      activeStart = startColumn;
      activeEnd = endColumn;
    }
  }
  if (activeStart >= 0) ranges.push({ startColumn: activeStart, endColumn: activeEnd });
  return ranges;
}

function segmentsForDifferenceView(
  length: number,
  differingColumns: readonly number[],
  context: number,
  expandedRanges: readonly MsaExpandedColumnRange[],
): MsaColumnSegment[] {
  if (length === 0) return [];
  const segments: MsaColumnSegment[] = [];
  let cursor = 0;
  let slotCount = 0;
  const appendElision = (startColumn: number, endColumn: number) => {
    if (endColumn <= startColumn) return;
    segments.push({ kind: 'elision', startColumn, endColumn, startSlot: slotCount });
    slotCount += 1;
  };
  const appendColumns = (startColumn: number, endColumn: number) => {
    if (endColumn <= startColumn) return;
    segments.push({ kind: 'columns', startColumn, endColumn, startSlot: slotCount });
    slotCount += endColumn - startColumn;
  };
  for (const range of normalizedVisibleRanges({ length, differingColumns, context, expandedRanges })) {
    appendElision(cursor, range.startColumn);
    appendColumns(range.startColumn, range.endColumn);
    cursor = range.endColumn;
  }
  appendElision(cursor, length);
  return segments;
}

function slotCountFor(segments: readonly MsaColumnSegment[]): number {
  const last = segments[segments.length - 1];
  if (!last) return 0;
  return last.startSlot + (last.kind === 'columns' ? last.endColumn - last.startColumn : 1);
}

function segmentForSlot(segments: readonly MsaColumnSegment[], slotIndex: number): MsaColumnSegment | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const segment = segments[middle]!;
    const endSlot = segment.startSlot + (segment.kind === 'columns' ? segment.endColumn - segment.startColumn : 1);
    if (slotIndex < segment.startSlot) high = middle - 1;
    else if (slotIndex >= endSlot) low = middle + 1;
    else return segment;
  }
  return undefined;
}

function segmentForColumn(segments: readonly MsaColumnSegment[], column: number): MsaColumnSegment | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const segment = segments[middle]!;
    if (column < segment.startColumn) high = middle - 1;
    else if (column >= segment.endColumn) low = middle + 1;
    else return segment;
  }
  return undefined;
}

function asElisionSlot(segment: Extract<MsaColumnSegment, { kind: 'elision' }>): MsaElisionSlot {
  return {
    kind: 'elision',
    startColumn: segment.startColumn,
    endColumn: segment.endColumn,
    hiddenCount: segment.endColumn - segment.startColumn,
  };
}

export function createMsaColumnView({
  alignmentLength,
  columnFilter,
  differingColumns,
  context,
  expandedRanges,
}: {
  alignmentLength: number;
  columnFilter: ClaudeScienceMsaColumnFilter;
  differingColumns: readonly number[];
  context: number;
  expandedRanges: readonly MsaExpandedColumnRange[];
}): MsaColumnView {
  const length = Math.max(0, Math.floor(alignmentLength));
  const segments = columnFilter === 'differences'
    ? segmentsForDifferenceView(length, differingColumns, context, expandedRanges)
    : null;
  const count = segments ? slotCountFor(segments) : length;
  const validColumn = (column: number) => Number.isInteger(column) && column >= 0 && column < length;
  const shownColumnCount = segments
    ? segments.reduce((count, segment) => count + (segment.kind === 'columns' ? segment.endColumn - segment.startColumn : 0), 0)
    : length;

  const slotAt = (slotIndex: number): MsaColumnViewSlot | undefined => {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= count) return undefined;
    if (!segments) return { kind: 'column', column: slotIndex };
    const segment = segmentForSlot(segments, slotIndex);
    if (!segment) return undefined;
    return segment.kind === 'columns'
      ? { kind: 'column', column: segment.startColumn + slotIndex - segment.startSlot }
      : asElisionSlot(segment);
  };

  return {
    slotCount: count,
    isCompressed: segments !== null,
    materializedSlotCount: segments?.length ?? 0,
    indexedColumnCount: 0,
    shownColumnCount,
    slotAt,
    slotsInRange(startSlot, endSlot) {
      const start = Math.max(0, Math.floor(startSlot));
      const end = Math.max(start, Math.min(count, Math.ceil(endSlot)));
      if (end <= start) return [];
      if (!segments) return Array.from(
        { length: end - start },
        (_, offset): MsaColumnViewSlot => ({ kind: 'column', column: start + offset }),
      );
      const result: MsaColumnViewSlot[] = [];
      let slot = start;
      while (slot < end) {
        const segment = segmentForSlot(segments, slot);
        if (!segment) break;
        if (segment.kind === 'elision') {
          result.push(asElisionSlot(segment));
          slot += 1;
          continue;
        }
        const segmentEndSlot = segment.startSlot + segment.endColumn - segment.startColumn;
        const stop = Math.min(end, segmentEndSlot);
        for (; slot < stop; slot += 1) {
          result.push({ kind: 'column', column: segment.startColumn + slot - segment.startSlot });
        }
      }
      return result;
    },
    slotIndexForColumn(column) {
      if (!validColumn(column)) return undefined;
      if (!segments) return column;
      const segment = segmentForColumn(segments, column);
      return segment?.kind === 'columns' ? segment.startSlot + column - segment.startColumn : undefined;
    },
    slotIndexForElision(slot) {
      if (!segments) return undefined;
      const segment = segmentForColumn(segments, slot.startColumn);
      return segment?.kind === 'elision'
        && segment.startColumn === slot.startColumn
        && segment.endColumn === slot.endColumn
        ? segment.startSlot
        : undefined;
    },
    elisionForColumn(column) {
      if (!segments || !validColumn(column)) return undefined;
      const segment = segmentForColumn(segments, column);
      return segment?.kind === 'elision' ? asElisionSlot(segment) : undefined;
    },
  };
}
