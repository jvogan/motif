import {
  buildMsaDifferenceColumnSlots,
  type MsaColumnViewSlot,
  type MsaExpandedColumnRange,
} from './claude-science-msa';
import type { ClaudeScienceMsaColumnFilter } from './claude-science-msa-view-preferences';

/**
 * Column-space adapter for the virtualised matrix.
 *
 * The ordinary, unfiltered view is an identity mapping: visual slot 412 is
 * absolute alignment column 412. Represent that mapping with arithmetic, not
 * one object and one Map entry per alignment column. The difference-focused
 * view alone needs materialised slots because its elisions change visual space.
 */
export type MsaColumnView = {
  readonly slotCount: number;
  readonly isCompressed: boolean;
  /** Diagnostics that make accidental all-view O(N) allocation testable. */
  readonly materializedSlotCount: number;
  readonly indexedColumnCount: number;
  slotAt(slotIndex: number): MsaColumnViewSlot | undefined;
  slotsInRange(startSlot: number, endSlot: number): MsaColumnViewSlot[];
  slotIndexForColumn(column: number): number | undefined;
  elisionForColumn(column: number): Extract<MsaColumnViewSlot, { kind: 'elision' }> | undefined;
  allSlots(): readonly MsaColumnViewSlot[];
};

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
  const slots = columnFilter === 'differences'
    ? buildMsaDifferenceColumnSlots(length, differingColumns, context, expandedRanges)
    : null;
  // A Map has the same allocation problem as the all-view slot objects. Only
  // compressed visual space needs one because absolute and visual indices vary.
  const index = slots ? new Map<number, number>() : null;
  if (slots && index) {
    slots.forEach((slot, slotIndex) => {
      if (slot.kind === 'column') index.set(slot.column, slotIndex);
    });
  }
  const validColumn = (column: number) => Number.isInteger(column) && column >= 0 && column < length;
  const slotAt = (slotIndex: number): MsaColumnViewSlot | undefined => {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= (slots?.length ?? length)) return undefined;
    return slots?.[slotIndex] ?? { kind: 'column', column: slotIndex };
  };
  const slotIndexForColumn = (column: number): number | undefined => {
    if (!validColumn(column)) return undefined;
    return index?.get(column) ?? (slots ? undefined : column);
  };

  return {
    slotCount: slots?.length ?? length,
    isCompressed: slots !== null,
    materializedSlotCount: slots?.length ?? 0,
    indexedColumnCount: index?.size ?? 0,
    slotAt,
    slotsInRange(startSlot, endSlot) {
      const start = Math.max(0, Math.floor(startSlot));
      const end = Math.max(start, Math.min(slots?.length ?? length, Math.ceil(endSlot)));
      if (slots) return slots.slice(start, end);
      return Array.from({ length: end - start }, (_, offset): MsaColumnViewSlot => ({ kind: 'column', column: start + offset }));
    },
    slotIndexForColumn,
    elisionForColumn(column) {
      if (!slots || !validColumn(column)) return undefined;
      return slots.find((slot): slot is Extract<MsaColumnViewSlot, { kind: 'elision' }> => (
        slot.kind === 'elision' && column >= slot.startColumn && column < slot.endColumn
      ));
    },
    allSlots() { return slots ?? []; },
  };
}
