import { describe, expect, it } from 'vitest';
import {
  computeAlignmentImageLayout,
  mixSrgb,
  resolveResidueCellColor,
  MSA_IMAGE_LETTER_MIN,
  MSA_IMAGE_MAX_WIDTH,
  MSA_IMAGE_MAX_HEIGHT,
  type AlignmentImageSource,
} from '../claude-science-msa';

const WHITE = '#ffffff';

function source(rowCount: number, alignmentLength: number, nameLength = 5): AlignmentImageSource {
  return {
    rows: Array.from({ length: rowCount }, (_, index) => ({
      name: `Row${String(index).padEnd(Math.max(1, nameLength - 3), 'x')}`,
      aligned: 'ACGT'.repeat(Math.ceil(alignmentLength / 4)).slice(0, alignmentLength),
    })),
    alignmentLength,
  };
}

describe('computeAlignmentImageLayout', () => {
  it('renders a visible-view window at the requested column range', () => {
    const layout = computeAlignmentImageLayout(source(5, 100), {
      scope: 'view', startColumn: 10, endColumn: 30, cellWidth: 12, cellHeight: 16, fontSize: 11,
    });
    expect(layout.scope).toBe('view');
    expect(layout.startColumn).toBe(10);
    expect(layout.columnCount).toBe(20);
    expect(layout.rowCount).toBe(5);
    expect(layout.cellWidth).toBe(12);
    expect(layout.clamped).toBe(false);
    // Not clamped, so total width is the ideal content width.
    expect(layout.width).toBe(Math.ceil(layout.labelWidth + layout.columnCount * layout.cellWidth));
    expect(layout.height).toBe(Math.ceil(layout.headerHeight + layout.rowCount * layout.cellHeight));
  });

  it('spans the whole alignment for the "all" scope', () => {
    const layout = computeAlignmentImageLayout(source(4, 250), { scope: 'all', cellWidth: 12, cellHeight: 16 });
    expect(layout.startColumn).toBe(0);
    expect(layout.columnCount).toBe(250);
  });

  it('clamps the view window to the alignment bounds', () => {
    const layout = computeAlignmentImageLayout(source(3, 100), { scope: 'view', startColumn: -5, endColumn: 1000 });
    expect(layout.startColumn).toBe(0);
    expect(layout.columnCount).toBe(100);
  });

  it('falls back to the whole alignment for a degenerate (empty) window', () => {
    const layout = computeAlignmentImageLayout(source(3, 80), { scope: 'view', startColumn: 40, endColumn: 40 });
    expect(layout.startColumn).toBe(0);
    expect(layout.columnCount).toBe(80);
  });

  it('draws letters exactly at the birdseye threshold and blocks below it', () => {
    const letters = computeAlignmentImageLayout(source(3, 100), { scope: 'all', cellWidth: MSA_IMAGE_LETTER_MIN, cellHeight: 16, fontSize: 11 });
    expect(letters.drawLetters).toBe(true);
    expect(letters.fontSize).toBeGreaterThan(0);
    const blocks = computeAlignmentImageLayout(source(3, 100), { scope: 'all', cellWidth: MSA_IMAGE_LETTER_MIN - 0.5, cellHeight: 16, fontSize: 11 });
    expect(blocks.drawLetters).toBe(false);
    expect(blocks.fontSize).toBe(0);
  });

  it('scales cells down to fit the pixel-width budget and reports clamped', () => {
    const wide: AlignmentImageSource = { rows: [{ name: 'A', aligned: '' }, { name: 'B', aligned: '' }], alignmentLength: 20_000 };
    const layout = computeAlignmentImageLayout(wide, {
      scope: 'all', cellWidth: 12, cellHeight: 16, fontSize: 11, maxWidth: MSA_IMAGE_MAX_WIDTH, maxCells: 10_000_000,
    });
    expect(layout.clamped).toBe(true);
    expect(layout.columnCount).toBe(20_000); // no cell-count cap here — pixel scaling only
    expect(layout.cellWidth).toBeLessThan(12);
    expect(layout.width).toBeLessThanOrEqual(MSA_IMAGE_MAX_WIDTH);
    expect(layout.drawLetters).toBe(false);
  });

  it('caps the drawn cell count for an oversized whole-alignment export', () => {
    const huge: AlignmentImageSource = {
      rows: Array.from({ length: 100 }, (_, index) => ({ name: `R${index}`, aligned: '' })),
      alignmentLength: 50_000,
    };
    const layout = computeAlignmentImageLayout(huge, { scope: 'all', cellWidth: 12, cellHeight: 16, maxCells: 400_000 });
    expect(layout.clamped).toBe(true);
    expect(layout.columnCount).toBe(4_000); // floor(400000 / 100 rows)
    expect(layout.width).toBeLessThanOrEqual(MSA_IMAGE_MAX_WIDTH);
    expect(layout.height).toBeLessThanOrEqual(MSA_IMAGE_MAX_HEIGHT);
  });

  it('keeps the label column within sane bounds regardless of name length', () => {
    const longNames: AlignmentImageSource = {
      rows: [{ name: 'z'.repeat(200), aligned: 'AC' }, { name: 'y', aligned: 'AC' }],
      alignmentLength: 2,
    };
    const layout = computeAlignmentImageLayout(longNames, { scope: 'all', fontSize: 11 });
    expect(layout.labelWidth).toBeLessThanOrEqual(320);
    expect(layout.labelWidth).toBeGreaterThanOrEqual(96);
  });
});

describe('mixSrgb', () => {
  it('linearly blends in gamma-encoded sRGB like color-mix(in srgb, ...)', () => {
    expect(mixSrgb('#ff0000', 50, '#ffffff')).toBe('#ff8080');
    expect(mixSrgb('#2ea043', 34, '#ffffff')).toBe('#b8dfbf');
  });

  it('returns the base at 100% and the background at 0%', () => {
    expect(mixSrgb('#123456', 100, '#ffffff')).toBe('#123456');
    expect(mixSrgb('#123456', 0, '#ffffff')).toBe('#ffffff');
  });

  it('expands three-digit hex inputs', () => {
    expect(mixSrgb('#abc', 100, '#000000')).toBe('#aabbcc');
  });
});

describe('resolveResidueCellColor', () => {
  it('matches the nucleotide scheme fills', () => {
    expect(resolveResidueCellColor('A', 'dna', 'nucleotide', WHITE)).toBe(mixSrgb('#2ea043', 34, WHITE));
    expect(resolveResidueCellColor('C', 'dna', 'nucleotide', WHITE)).toBe(mixSrgb('#4c8dff', 34, WHITE));
    expect(resolveResidueCellColor('G', 'dna', 'nucleotide', WHITE)).toBe(mixSrgb('#f0a020', 36, WHITE));
    expect(resolveResidueCellColor('T', 'dna', 'nucleotide', WHITE)).toBe(mixSrgb('#f0553f', 34, WHITE));
    expect(resolveResidueCellColor('U', 'rna', 'nucleotide', WHITE)).toBe(mixSrgb('#f0553f', 34, WHITE));
    expect(resolveResidueCellColor('N', 'dna', 'nucleotide', WHITE)).toBe(mixSrgb('#8b93a1', 30, WHITE));
  });

  it('matches the Clustal chemistry-group fills', () => {
    expect(resolveResidueCellColor('A', 'protein', 'clustal', WHITE)).toBe(mixSrgb('#5b8def', 34, WHITE));
    expect(resolveResidueCellColor('K', 'protein', 'clustal', WHITE)).toBe(mixSrgb('#e0533f', 34, WHITE));
    expect(resolveResidueCellColor('D', 'protein', 'clustal', WHITE)).toBe(mixSrgb('#b657c4', 34, WHITE));
    expect(resolveResidueCellColor('Z', 'protein', 'clustal', WHITE)).toBe(mixSrgb('#8b93a1', 26, WHITE));
  });

  it('matches the hydrophobicity scale fills', () => {
    expect(resolveResidueCellColor('R', 'protein', 'hydrophobicity', WHITE)).toBe(mixSrgb('#4c8dff', 34, WHITE));
    expect(resolveResidueCellColor('I', 'protein', 'hydrophobicity', WHITE)).toBe(mixSrgb('#f0553f', 36, WHITE));
  });

  it('matches the Taylor per-residue fills', () => {
    expect(resolveResidueCellColor('A', 'protein', 'taylor', WHITE)).toBe(mixSrgb('#ccff00', 40, WHITE));
    expect(resolveResidueCellColor('W', 'protein', 'taylor', WHITE)).toBe(mixSrgb('#00ccff', 36, WHITE));
    // A residue the Taylor wheel does not colour has no fill.
    expect(resolveResidueCellColor('B', 'protein', 'taylor', WHITE)).toBeNull();
  });

  it('anchors representative fills to concrete sRGB hex', () => {
    expect(resolveResidueCellColor('A', 'dna', 'nucleotide', WHITE)).toBe('#b8dfbf');
    expect(resolveResidueCellColor('A', 'protein', 'taylor', WHITE)).toBe('#ebff99');
  });

  it('resolves the auto scheme to the molecule default', () => {
    expect(resolveResidueCellColor('A', 'dna', 'auto', WHITE)).toBe(resolveResidueCellColor('A', 'dna', 'nucleotide', WHITE));
    expect(resolveResidueCellColor('A', 'protein', 'auto', WHITE)).toBe(resolveResidueCellColor('A', 'protein', 'clustal', WHITE));
  });

  it('returns null for residues with no fill (gaps, unknowns)', () => {
    expect(resolveResidueCellColor('-', 'dna', 'nucleotide', WHITE)).toBeNull();
    expect(resolveResidueCellColor('.', 'protein', 'taylor', WHITE)).toBeNull();
    expect(resolveResidueCellColor('?', 'dna', 'nucleotide', WHITE)).toBeNull();
  });

  it('honours a non-white export background', () => {
    const black = '#000000';
    expect(resolveResidueCellColor('A', 'dna', 'nucleotide', black)).toBe(mixSrgb('#2ea043', 34, black));
  });
});
