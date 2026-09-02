import { describe, expect, it } from 'vitest';
import {
  AlignmentImageExportError,
  alignmentImageCanvasPlan,
  alignmentImageCanvasScale,
  alignmentImageCellGeometry,
  computeAlignmentImageLayout,
  mixSrgb,
  resolveAlignmentImagePalette,
  resolveResidueCellColor,
  DEFAULT_ALIGNMENT_IMAGE_PALETTE,
  MSA_IMAGE_LETTER_MIN,
  MSA_IMAGE_MAX_CANVAS_PIXELS,
  MSA_IMAGE_MAX_CELLS,
  MSA_IMAGE_MAX_WIDTH,
  type AlignmentImageSource,
} from '../claude-science-msa';
import { renderAlignmentImageSvg } from '../claude-science-msa-image';

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

  it('preserves absolute filtered columns and elisions in visible-view geometry', () => {
    const columns = [
      { kind: 'column' as const, column: 9 },
      { kind: 'column' as const, column: 10 },
      { kind: 'elision' as const, startColumn: 11, endColumn: 40, hiddenCount: 29 },
      { kind: 'column' as const, column: 40 },
    ];
    const layout = computeAlignmentImageLayout(source(3, 100), {
      scope: 'view', columns, cellWidth: 12, cellHeight: 16,
    });
    expect(layout.startColumn).toBe(9);
    expect(layout.columnCount).toBe(4);
    expect(layout.columns).toEqual(columns);
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

  it('fits every column of a 2 by 100,000 whole export without a subpixel floor', () => {
    const layout = computeAlignmentImageLayout(source(2, 100_000), {
      scope: 'all', cellWidth: 12, cellHeight: 16,
    });
    const last = alignmentImageCellGeometry(layout, 99_999);
    const canvas = alignmentImageCanvasPlan(layout.width, layout.height, 2);

    expect(layout.columns).toHaveLength(100_000);
    expect(layout.columns.at(-1)).toEqual({ kind: 'column', column: 99_999 });
    expect(layout.cellWidth).toBeGreaterThan(0);
    expect(layout.cellWidth).toBeLessThan(0.2);
    expect(layout.contentWidth).toBe(layout.width);
    expect(last.width).toBeGreaterThan(0);
    expect(last.x + last.width).toBeCloseTo(layout.contentWidth, 9);
    expect(last.x + last.width).toBeLessThanOrEqual(layout.width);
    expect((last.x + last.width) * canvas.scaleX).toBeCloseTo(canvas.width, 9);
    expect(canvas.width).toBeLessThanOrEqual(MSA_IMAGE_MAX_WIDTH);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(MSA_IMAGE_MAX_CANVAS_PIXELS);
  });

  it('keeps fitted row geometry positive and complete for tall accepted exports', () => {
    const layout = computeAlignmentImageLayout(source(10_000, 2), {
      scope: 'all', maxHeight: 200, fontSize: 100_000,
    });
    expect(layout.cellHeight).toBeGreaterThan(0);
    expect(layout.cellHeight).toBeLessThan(1);
    expect(layout.contentHeight).toBe(layout.height);
    expect(layout.contentHeight).toBeLessThanOrEqual(200);
  });

  it('preserves every column exactly at the row-cell limit', () => {
    const layout = computeAlignmentImageLayout(source(100, 4_000), {
      scope: 'all', cellWidth: 12, cellHeight: 16, maxCells: MSA_IMAGE_MAX_CELLS,
    });
    expect(layout.columnCount).toBe(4_000);
    expect(layout.columns).toHaveLength(4_000);
    expect(layout.columns[0]).toEqual({ kind: 'column', column: 0 });
    expect(layout.columns.at(-1)).toEqual({ kind: 'column', column: 3_999 });
  });

  it('rejects an oversized whole-alignment image instead of returning a leading slice', () => {
    expect(() => computeAlignmentImageLayout(source(100, 4_001), {
      scope: 'all', cellWidth: 12, cellHeight: 16, maxCells: MSA_IMAGE_MAX_CELLS,
    })).toThrow(AlignmentImageExportError);
    try {
      computeAlignmentImageLayout(source(100, 4_001), { scope: 'all' });
      throw new Error('expected the image layout to reject');
    } catch (caught) {
      expect(caught).toMatchObject({
        code: 'cell_limit',
        scope: 'all',
        requiredCells: 400_100,
        maxCells: 400_000,
        rowCount: 100,
        columnCount: 4_001,
      });
    }
  });

  it('rejects a high-column whole image while allowing a late visible window', () => {
    const huge = source(9, 50_000);
    expect(() => computeAlignmentImageLayout(huge, { scope: 'all' })).toThrow(AlignmentImageExportError);
    const visible = computeAlignmentImageLayout(huge, {
      scope: 'view', startColumn: 49_980, endColumn: 50_000,
    });
    expect(visible.columnCount).toBe(20);
    expect(visible.columns[0]).toEqual({ kind: 'column', column: 49_980 });
    expect(visible.columns.at(-1)).toEqual({ kind: 'column', column: 49_999 });
  });

  it('builds only a bounded visible window inside an alignment too long to materialize', () => {
    const alignmentLength = 5_000_000_000;
    const huge: AlignmentImageSource = {
      rows: [{ name: 'Template', aligned: '' }, { name: 'Read', aligned: '' }],
      alignmentLength,
    };
    const visible = computeAlignmentImageLayout(huge, {
      scope: 'view', startColumn: alignmentLength - 8, endColumn: alignmentLength,
    });
    expect(visible.startColumn).toBe(alignmentLength - 8);
    expect(visible.columnCount).toBe(8);
    expect(visible.columns).toEqual(Array.from(
      { length: 8 },
      (_, offset) => ({ kind: 'column', column: alignmentLength - 8 + offset }),
    ));
  });

  it('does not let non-finite or oversized maxCells values bypass the hard cap', () => {
    const huge = source(100, 4_001);
    for (const maxCells of [Number.NaN, Number.POSITIVE_INFINITY, MSA_IMAGE_MAX_CELLS + 1]) {
      expect(() => computeAlignmentImageLayout(huge, { scope: 'all', maxCells })).toThrow(AlignmentImageExportError);
    }
    expect(() => computeAlignmentImageLayout(source(2, 51), { scope: 'all', maxCells: 100 }))
      .toThrow(AlignmentImageExportError);
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

describe('whole-alignment SVG geometry', () => {
  it('paints the exact trailing column and spaces subpixel axis ticks legibly', () => {
    const alignmentLength = 100_000;
    const aligned = `${'-'.repeat(alignmentLength - 1)}A`;
    const wide: AlignmentImageSource = {
      rows: [{ name: 'Template', aligned }, { name: 'Read', aligned }],
      alignmentLength,
    };
    const layout = computeAlignmentImageLayout(wide, { scope: 'all' });
    const svg = renderAlignmentImageSvg(
      wide.rows.map((row, index) => ({ ...row, isTemplate: index === 0 })),
      'dna',
      'nucleotide',
      layout,
      'Wide alignment',
      DEFAULT_ALIGNMENT_IMAGE_PALETTE,
    );

    const fill = resolveResidueCellColor('A', 'dna', 'nucleotide', WHITE);
    const painted = [...svg.matchAll(new RegExp(`<rect x="([0-9.]+)"[^>]+width="([0-9.]+)"[^>]+fill="${fill}"`, 'g'))];
    expect(painted).toHaveLength(2);
    const lastX = Number(painted.at(-1)?.[1]);
    const lastWidth = Number(painted.at(-1)?.[2]);
    expect(lastWidth).toBeGreaterThan(0);
    expect(lastX + lastWidth).toBeCloseTo(layout.contentWidth, 4);
    expect(svg).toContain('>100000</text>');
    const centeredTextCount = svg.match(/text-anchor="middle"/g)?.length ?? 0;
    expect(centeredTextCount).toBeGreaterThan(50);
    expect(centeredTextCount).toBeLessThan(200);
  });
});

describe('alignment image palette', () => {
  it('uses deterministic fallbacks when no theme tokens are available', () => {
    expect(resolveAlignmentImagePalette()).toEqual(DEFAULT_ALIGNMENT_IMAGE_PALETTE);
  });

  it('maps and canonicalizes active light or dark theme tokens', () => {
    const tokens: Record<string, string> = {
      '--bg-primary': '#232323',
      '--bg-secondary': 'rgb(43, 43, 43)',
      '--text-primary': '#f5f5f4',
      '--text-muted': '#a7a3a0',
    };
    expect(resolveAlignmentImagePalette((name) => tokens[name] ?? '')).toEqual({
      background: '#232323',
      labelBackground: '#2b2b2b',
      text: '#f5f5f4',
      muted: '#a7a3a0',
    });
  });

  it('falls back per field for malformed or transparent values', () => {
    const palette = resolveAlignmentImagePalette((name) => ({
      '--bg-primary': 'transparent',
      '--bg-secondary': '#abc',
      '--text-primary': 'rgb(999, 0, 0)',
      '--text-muted': '#70665f',
    })[name] ?? '');
    expect(palette).toEqual({
      background: DEFAULT_ALIGNMENT_IMAGE_PALETTE.background,
      labelBackground: '#aabbcc',
      text: DEFAULT_ALIGNMENT_IMAGE_PALETTE.text,
      muted: '#70665f',
    });
  });
});

describe('alignment image canvas scale', () => {
  it('keeps the physical backing store within its pixel budget', () => {
    const ratio = alignmentImageCanvasScale(12_000, 8_000, 2);
    expect(ratio).toBeLessThan(1);
    expect(Math.ceil(12_000 * ratio) * Math.ceil(8_000 * ratio))
      .toBeLessThanOrEqual(MSA_IMAGE_MAX_CANVAS_PIXELS + 20_000);
    expect(alignmentImageCanvasScale(1_000, 500, 2)).toBe(2);
  });

  it('caps physical backing dimensions as well as total pixels', () => {
    expect(alignmentImageCanvasPlan(12_000, 80, 2)).toMatchObject({
      width: 12_000,
      height: 80,
      scaleX: 1,
      scaleY: 1,
    });
    const tall = alignmentImageCanvasPlan(200, 8_000, 2);
    expect(tall.width).toBe(200);
    expect(tall.height).toBe(8_000);
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

  it('accepts rgb() backgrounds resolved from theme tokens', () => {
    expect(resolveResidueCellColor('A', 'dna', 'nucleotide', 'rgb(255, 255, 255)'))
      .toBe(mixSrgb('#2ea043', 34, '#ffffff'));
  });
});
