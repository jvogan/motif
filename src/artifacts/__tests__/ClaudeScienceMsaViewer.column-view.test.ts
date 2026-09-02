import { describe, expect, it } from 'vitest';
import { createMsaColumnView } from '../claude-science-msa-column-view';

describe('createMsaColumnView', () => {
  it('uses arithmetic identity mapping for a million-column unfiltered alignment', () => {
    const view = createMsaColumnView({
      alignmentLength: 1_000_000,
      columnFilter: 'all',
      differingColumns: [],
      context: 3,
      expandedRanges: [],
    });

    // The virtual matrix may have a million logical columns, but the all-view
    // adapter must retain only the scalar length.  These counters make a
    // regression back to a million slot objects or a million-entry Map fail
    // without relying on wall-clock timing.
    expect(view.slotCount).toBe(1_000_000);
    expect(view.isCompressed).toBe(false);
    expect(view.materializedSlotCount).toBe(0);
    expect(view.indexedColumnCount).toBe(0);
    expect(view.allSlots()).toEqual([]);

    expect(view.slotAt(0)).toEqual({ kind: 'column', column: 0 });
    expect(view.slotAt(999_999)).toEqual({ kind: 'column', column: 999_999 });
    expect(view.slotIndexForColumn(712_345)).toBe(712_345);
    expect(view.elisionForColumn(712_345)).toBeUndefined();
    expect(view.slotsInRange(999_950, 1_000_050)).toEqual(
      Array.from({ length: 50 }, (_, offset) => ({ kind: 'column' as const, column: 999_950 + offset })),
    );
  });

  it('keeps compressed slots and absolute-column mapping for the differences view', () => {
    const view = createMsaColumnView({
      alignmentLength: 30,
      columnFilter: 'differences',
      differingColumns: [9, 24],
      context: 3,
      expandedRanges: [],
    });

    expect(view.isCompressed).toBe(true);
    expect(view.slotCount).toBe(17);
    expect(view.materializedSlotCount).toBe(17);
    expect(view.indexedColumnCount).toBe(14);
    expect(view.slotsInRange(0, 5)).toEqual([
      { kind: 'elision', startColumn: 0, endColumn: 6, hiddenCount: 6 },
      { kind: 'column', column: 6 },
      { kind: 'column', column: 7 },
      { kind: 'column', column: 8 },
      { kind: 'column', column: 9 },
    ]);
    expect(view.slotIndexForColumn(9)).toBe(4);
    expect(view.slotIndexForColumn(13)).toBeUndefined();
    expect(view.elisionForColumn(13)).toEqual({
      kind: 'elision', startColumn: 13, endColumn: 21, hiddenCount: 8,
    });
    expect(view.slotIndexForColumn(24)).toBe(12);
  });
});
