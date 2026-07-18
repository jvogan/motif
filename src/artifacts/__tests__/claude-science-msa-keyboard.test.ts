import { describe, expect, it } from 'vitest';
import { navigateMsaGridCell, type MsaGridNavigationOptions } from '../claude-science-msa';

const options: MsaGridNavigationOptions = {
  rowCount: 4,
  columnCount: 20,
  pageColumnCount: 6,
};

describe('navigateMsaGridCell', () => {
  it('moves one row or column with Arrow keys and clamps at grid edges', () => {
    expect(navigateMsaGridCell({ rowIndex: 2, column: 8 }, 'ArrowLeft', options)).toEqual({ rowIndex: 2, column: 7 });
    expect(navigateMsaGridCell({ rowIndex: 2, column: 8 }, 'ArrowRight', options)).toEqual({ rowIndex: 2, column: 9 });
    expect(navigateMsaGridCell({ rowIndex: 2, column: 8 }, 'ArrowUp', options)).toEqual({ rowIndex: 1, column: 8 });
    expect(navigateMsaGridCell({ rowIndex: 2, column: 8 }, 'ArrowDown', options)).toEqual({ rowIndex: 3, column: 8 });
    expect(navigateMsaGridCell({ rowIndex: 0, column: 0 }, 'ArrowUp', options)).toEqual({ rowIndex: 0, column: 0 });
    expect(navigateMsaGridCell({ rowIndex: 3, column: 19 }, 'ArrowRight', options)).toEqual({ rowIndex: 3, column: 19 });
  });

  it('moves Home and End within a row or across the whole grid', () => {
    expect(navigateMsaGridCell({ rowIndex: 2, column: 8 }, 'Home', options)).toEqual({ rowIndex: 2, column: 0 });
    expect(navigateMsaGridCell({ rowIndex: 2, column: 8 }, 'End', options)).toEqual({ rowIndex: 2, column: 19 });
    expect(navigateMsaGridCell({ rowIndex: 2, column: 8 }, 'Home', { ...options, toGridBoundary: true })).toEqual({ rowIndex: 0, column: 0 });
    expect(navigateMsaGridCell({ rowIndex: 2, column: 8 }, 'End', { ...options, toGridBoundary: true })).toEqual({ rowIndex: 3, column: 19 });
  });

  it('moves Page Up and Page Down by the configured visible-column count', () => {
    expect(navigateMsaGridCell({ rowIndex: 1, column: 9 }, 'PageUp', options)).toEqual({ rowIndex: 1, column: 3 });
    expect(navigateMsaGridCell({ rowIndex: 1, column: 9 }, 'PageDown', options)).toEqual({ rowIndex: 1, column: 15 });
    expect(navigateMsaGridCell({ rowIndex: 1, column: 3 }, 'PageUp', options)).toEqual({ rowIndex: 1, column: 0 });
    expect(navigateMsaGridCell({ rowIndex: 1, column: 18 }, 'PageDown', options)).toEqual({ rowIndex: 1, column: 19 });
  });

  it('ignores unrelated keys and grids without a navigable cell', () => {
    expect(navigateMsaGridCell({ rowIndex: 1, column: 2 }, 'Enter', options)).toBeNull();
    expect(navigateMsaGridCell({ rowIndex: 0, column: 0 }, 'ArrowRight', { ...options, rowCount: 0 })).toBeNull();
    expect(navigateMsaGridCell({ rowIndex: 0, column: 0 }, 'ArrowRight', { ...options, columnCount: 0 })).toBeNull();
  });
});
