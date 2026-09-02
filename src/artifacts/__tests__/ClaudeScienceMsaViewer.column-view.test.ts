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
    // Five segment descriptors replace the previous 17 slot objects and 14
    // reverse-index entries. The viewport still observes the same slots.
    expect(view.materializedSlotCount).toBe(5);
    expect(view.indexedColumnCount).toBe(0);
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

  it('keeps a near-million expanded difference range segmented', () => {
    const view = createMsaColumnView({
      alignmentLength: 1_000_000,
      columnFilter: 'differences',
      differingColumns: [10],
      context: 0,
      expandedRanges: [{ startColumn: 100, endColumn: 999_900 }],
    });

    // The expanded run has 999,800 displayed columns, but it is one segment.
    // These stable counters protect the click/Go-to expansion path from quietly
    // regressing to a slot object or a Map entry for every displayed column.
    expect(view.slotCount).toBe(999_804);
    expect(view.shownColumnCount).toBe(999_801);
    expect(view.materializedSlotCount).toBe(5);
    expect(view.indexedColumnCount).toBe(0);

    expect(view.slotIndexForColumn(10)).toBe(1);
    expect(view.slotIndexForColumn(100)).toBe(3);
    expect(view.slotIndexForColumn(500_000)).toBe(499_903);
    expect(view.slotAt(499_903)).toEqual({ kind: 'column', column: 500_000 });
    expect(view.slotsInRange(499_902, 499_905)).toEqual([
      { kind: 'column', column: 499_999 },
      { kind: 'column', column: 500_000 },
      { kind: 'column', column: 500_001 },
    ]);

    const leadingElision = view.elisionForColumn(5);
    expect(leadingElision).toEqual({ kind: 'elision', startColumn: 0, endColumn: 10, hiddenCount: 10 });
    expect(leadingElision && view.slotIndexForElision(leadingElision)).toBe(0);
    expect(view.elisionForColumn(999_950)).toEqual({
      kind: 'elision', startColumn: 999_900, endColumn: 1_000_000, hiddenCount: 100,
    });
  });

  it('coalesces a near-million dense difference run before making descriptors', () => {
    const alignmentLength = 1_000_000;
    const originalSort = Array.prototype.sort;
    let largestSortedArray = 0;
    const observedSort = (function observedSort(
      this: unknown[],
      ...args: Parameters<typeof originalSort>
    ) {
      largestSortedArray = Math.max(largestSortedArray, this.length);
      return Reflect.apply(originalSort, this, args);
    }) as typeof Array.prototype.sort;
    let view: ReturnType<typeof createMsaColumnView>;
    Array.prototype.sort = observedSort;
    try {
      view = createMsaColumnView({
        alignmentLength,
        columnFilter: 'differences',
        // differenceColumns scans left to right. This is its ordered output
        // shape for a dense two-row alignment; the adapter must not make one
        // range descriptor per named column.
        differingColumns: Array.from({ length: alignmentLength }, (_, column) => column),
        context: 0,
        expandedRanges: [],
      });
    } finally {
      Array.prototype.sort = originalSort;
    }

    expect(view.slotCount).toBe(alignmentLength);
    expect(view.shownColumnCount).toBe(alignmentLength);
    expect(view.materializedSlotCount).toBe(1);
    expect(view.indexedColumnCount).toBe(0);
    expect(view.slotIndexForColumn(500_000)).toBe(500_000);
    expect(view.slotAt(999_999)).toEqual({ kind: 'column', column: 999_999 });
    expect(view.elisionForColumn(500_000)).toBeUndefined();
    expect(view.slotsInRange(499_999, 500_002)).toEqual([
      { kind: 'column', column: 499_999 },
      { kind: 'column', column: 500_000 },
      { kind: 'column', column: 500_001 },
    ]);
    // The pre-coalescing implementation sorted one tiny range per differing
    // column. The final descriptor count alone would not catch that transient
    // million-object allocation, so observe the sort input directly.
    expect(largestSortedArray).toBeLessThanOrEqual(1);
  });
});
