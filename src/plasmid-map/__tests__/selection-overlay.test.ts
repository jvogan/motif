import { describe, it, expect } from 'vitest';
import { computeMapLayout } from '../layout';
import { selectionOverlayPaths } from '../selection-overlay';
import type { MapInput } from '../types';

function circular(): MapInput {
  return {
    mode: 'circular',
    name: 'p',
    length: 3000,
    topology: 'circular',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [],
    width: 600,
    height: 600,
  };
}

function linear(): MapInput {
  return { ...circular(), mode: 'linear', topology: 'linear', width: 800, height: 300 };
}

describe('selectionOverlayPaths', () => {
  it('returns nothing with no ranges', () => {
    expect(selectionOverlayPaths(computeMapLayout(circular()), [])).toEqual([]);
  });

  it('projects a circular range to one center-origin sector path', () => {
    const layout = computeMapLayout(circular());
    const paths = selectionOverlayPaths(layout, [{ start: 500, end: 900 }]);
    expect(paths).toHaveLength(1);
    expect(paths[0].startsWith(`M ${layout.center.x} ${layout.center.y} L `)).toBe(true);
    expect(paths[0]).toContain('A '); // outer arc
    expect(paths[0].endsWith('Z')).toBe(true);
  });

  it('splits an origin-wrapping circular selection into two sectors', () => {
    const paths = selectionOverlayPaths(computeMapLayout(circular()), [{ start: 2900, end: 200 }]);
    expect(paths).toHaveLength(2);
    for (const d of paths) {
      expect(d).toContain('A ');
      expect(d.endsWith('Z')).toBe(true);
    }
  });

  it('projects a linear range to one closed rect band', () => {
    const paths = selectionOverlayPaths(computeMapLayout(linear()), [{ start: 100, end: 400 }]);
    expect(paths).toHaveLength(1);
    expect(paths[0].startsWith('M ')).toBe(true);
    expect(paths[0].endsWith('Z')).toBe(true);
    expect(paths[0]).not.toContain('A '); // no arc in linear
  });

  it('emits a path per focused range (multi-span selection)', () => {
    const paths = selectionOverlayPaths(computeMapLayout(circular()), [
      { start: 100, end: 200 },
      { start: 1000, end: 1100 },
    ]);
    expect(paths).toHaveLength(2);
  });

  it('drops degenerate ranges without throwing', () => {
    const layout = computeMapLayout(circular());
    expect(selectionOverlayPaths(layout, [{ start: 500, end: 500 }])).toEqual([]);
    expect(selectionOverlayPaths(layout, [{ start: NaN, end: 100 }])).toEqual([]);
  });
});
