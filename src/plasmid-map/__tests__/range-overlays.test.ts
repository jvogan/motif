import { describe, expect, it } from 'vitest';

import { computeMapLayout } from '../layout';
import {
  commentRangeOverlayInput,
  MAP_MOTIF_OVERLAY_MAX_MATCHES_PER_RULE,
  motifRangeOverlayInputs,
  orfRangeOverlayInput,
  projectRangeOverlays,
  scarRangeOverlayInput,
  variantRangeOverlayInput,
  type MapRangeOverlayInput,
} from '../range-overlays';
import { makeSequenceMotifRule } from '../../bio/sequence-formatting';

function circularLayout() {
  return computeMapLayout({
    mode: 'circular',
    name: 'pHighlights',
    length: 1000,
    topology: 'circular',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [],
    width: 420,
    height: 420,
  });
}

function linearLayout() {
  return computeMapLayout({
    mode: 'linear',
    name: 'Linear highlights',
    length: 1000,
    topology: 'linear',
    sequenceType: 'dna',
    features: [],
    restrictionSites: [],
    width: 620,
    height: 260,
  });
}

function overlay(ranges: MapRangeOverlayInput['ranges'], color = '#60a5fa'): MapRangeOverlayInput {
  return {
    id: 'hl-a',
    kind: 'highlight',
    label: 'Region A',
    color,
    ranges,
  };
}

describe('projectRangeOverlays', () => {
  it('projects saved highlights to circular arc paths', () => {
    const overlays = projectRangeOverlays(circularLayout(), [overlay([{ start: 100, end: 260 }])]);

    expect(overlays).toHaveLength(1);
    expect(overlays[0].kind).toBe('highlight');
    expect(overlays[0].color).toBe('#60a5fa');
    expect(overlays[0].paths).toHaveLength(1);
    expect(overlays[0].primaryRange).toEqual({ start: 100, end: 260 });
    expect(overlays[0].focusedRanges).toBeNull();
    expect(overlays[0].paths[0]).toContain('A');
    expect(overlays[0].paths[0]).not.toMatch(/NaN|Infinity/);
  });

  it('splits circular origin-wrapping highlights into drawable spans', () => {
    const overlays = projectRangeOverlays(circularLayout(), [overlay([{ start: 900, end: 1100 }])]);

    expect(overlays).toHaveLength(1);
    expect(overlays[0].paths).toHaveLength(2);
    expect(overlays[0].primaryRange).toEqual({ start: 900, end: 1000 });
    expect(overlays[0].focusedRanges).toEqual([
      { start: 900, end: 1000 },
      { start: 0, end: 100 },
    ]);
    expect(overlays[0].paths.join(' ')).not.toMatch(/NaN|Infinity/);
  });

  it('projects linear highlights to closed axis bands', () => {
    const overlays = projectRangeOverlays(linearLayout(), [overlay([{ start: 100, end: 260 }])]);

    expect(overlays).toHaveLength(1);
    expect(overlays[0].paths).toHaveLength(1);
    expect(overlays[0].primaryRange).toEqual({ start: 100, end: 260 });
    expect(overlays[0].focusedRanges).toBeNull();
    expect(overlays[0].paths[0]).toMatch(/^M /);
    expect(overlays[0].paths[0]).toContain(' Z');
    expect(overlays[0].paths[0]).not.toMatch(/NaN|Infinity/);
  });

  it('drops invalid or empty highlight ranges without emitting overlays', () => {
    const overlays = projectRangeOverlays(linearLayout(), [
      overlay([
        { start: 100, end: 100 },
        { start: Number.NaN, end: 200 },
        { start: 260, end: 100 },
      ], ''),
    ]);

    expect(overlays).toHaveLength(0);
  });

  it('normalizes collapsed comments to a visible one-unit anchor', () => {
    const layout = linearLayout();
    const input = commentRangeOverlayInput({
      id: 'comment-a',
      start: 400,
      end: 400,
      text: 'Review this junction',
    }, layout.length);

    expect(input).toMatchObject({
      id: 'comment:comment-a',
      objectId: 'comment-a',
      kind: 'comment',
      label: 'Review this junction',
      ranges: [{ start: 400, end: 401 }],
    });

    const overlays = projectRangeOverlays(layout, input ? [input] : []);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].objectId).toBe('comment-a');
    expect(overlays[0].primaryRange).toEqual({ start: 400, end: 401 });
    expect(overlays[0].focusedRanges).toBeNull();
    expect(overlays[0].paths[0]).toContain(' Z');
    expect(overlays[0].paths[0]).not.toMatch(/NaN|Infinity/);
  });

  it('projects scar overlays with subtype variants and concrete colors', () => {
    const layout = circularLayout();
    const deletion = scarRangeOverlayInput({
      id: 'scar-del',
      position: 999,
      type: 'deletion',
      original: 'ATG',
      createdAt: 1,
    }, layout.length, 'A'.repeat(layout.length));

    expect(deletion).toMatchObject({
      id: 'scar:scar-del',
      objectId: 'scar-del',
      kind: 'scar',
      variant: 'deletion',
      color: '#dc2626',
      ranges: [{ start: 999, end: 1000 }],
    });

    const overlays = projectRangeOverlays(layout, deletion ? [deletion] : []);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].objectId).toBe('scar-del');
    expect(overlays[0].variant).toBe('deletion');
    expect(overlays[0].primaryRange).toEqual({ start: 999, end: 1000 });
    expect(overlays[0].focusedRanges).toBeNull();
    expect(overlays[0].paths[0]).toContain('A');
    expect(overlays[0].paths[0]).not.toMatch(/NaN|Infinity/);
  });

  it('projects called variant overlays as durable object ranges', () => {
    const layout = circularLayout();
    const input = variantRangeOverlayInput({
      id: 'variant-wrap',
      start: 980,
      end: 1020,
      kind: 'substitution',
      reference: 'A',
      alternate: 'G',
      source: 'VCF',
    }, layout.length);

    expect(input).toMatchObject({
      id: 'variant:variant-wrap',
      objectId: 'variant-wrap',
      kind: 'variant',
      variant: 'substitution',
      label: 'A>G at 981',
      color: '#be185d',
      ranges: [{ start: 980, end: 1020 }],
    });

    const overlays = projectRangeOverlays(layout, input ? [input] : []);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].objectId).toBe('variant-wrap');
    expect(overlays[0].kind).toBe('variant');
    expect(overlays[0].paths).toHaveLength(2);
    expect(overlays[0].primaryRange).toEqual({ start: 980, end: 1000 });
    expect(overlays[0].focusedRanges).toEqual([
      { start: 980, end: 1000 },
      { start: 0, end: 20 },
    ]);
    expect(overlays[0].title).toBe('A>G at 981 (variant)');
    expect(overlays[0].paths.join(' ')).not.toMatch(/NaN|Infinity/);
  });

  it('projects circular origin-spanning ORFs as strand-specific passive overlays', () => {
    const layout = circularLayout();
    const input = orfRangeOverlayInput({
      start: 940,
      end: 1090,
      frame: 2,
      strand: -1,
      length: 150,
      aminoAcids: 49,
      startCodon: 'ATG',
      stopCodon: 'TAA',
    }, 0, layout.length);

    expect(input).toMatchObject({
      id: 'orf:-2:940:1090:0',
      objectId: 'orf:-2:940:1090:0',
      kind: 'orf',
      variant: 'reverse',
      label: 'ORF -2 49 aa',
      color: '#6d5bd0',
      ranges: [
        { start: 940, end: 1000 },
        { start: 0, end: 90 },
      ],
    });

    const overlays = projectRangeOverlays(layout, input ? [input] : []);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].objectId).toBe('orf:-2:940:1090:0');
    expect(overlays[0].paths).toHaveLength(2);
    expect(overlays[0].primaryRange).toEqual({ start: 940, end: 1000 });
    expect(overlays[0].focusedRanges).toEqual([
      { start: 940, end: 1000 },
      { start: 0, end: 90 },
    ]);
    expect(overlays[0].title).toBe('ORF -2 49 aa (orf)');
    expect(overlays[0].paths.join(' ')).not.toMatch(/NaN|Infinity/);
  });

  it('builds saved motif overlays with circular origin-wrapping match ranges', () => {
    const layout = circularLayout();
    const rule = {
      ...makeSequenceMotifRule('TTA', { backgroundColor: '#22d3ee' }, 'dna', 'Origin motif'),
      id: 'motif-origin',
      createdAt: 1,
      updatedAt: 1,
    };

    const inputs = motifRangeOverlayInputs({
      sequence: `${'A'.repeat(998)}TT`,
      sequenceType: 'dna',
      topology: 'circular',
      rules: [rule],
    });

    expect(inputs).toMatchObject([{
      id: 'motif:motif-origin',
      objectId: 'motif-origin',
      kind: 'motif',
      variant: 'dna',
      label: 'Motif Origin motif',
      color: '#22d3ee',
      ranges: [
        { start: 998, end: 1000 },
        { start: 0, end: 1 },
      ],
    }]);

    const overlays = projectRangeOverlays(layout, inputs);
    expect(overlays).toHaveLength(1);
    expect(overlays[0].kind).toBe('motif');
    expect(overlays[0].primaryRange).toEqual({ start: 998, end: 1000 });
    expect(overlays[0].focusedRanges).toEqual([
      { start: 998, end: 1000 },
      { start: 0, end: 1 },
    ]);
    expect(overlays[0].paths).toHaveLength(2);
    expect(overlays[0].paths.join(' ')).not.toMatch(/NaN|Infinity/);
  });

  it('caps dense motif overlays before projection', () => {
    const rule = {
      ...makeSequenceMotifRule('A', { backgroundColor: '#22d3ee' }, 'dna'),
      id: 'motif-a',
      createdAt: 1,
      updatedAt: 1,
    };

    const inputs = motifRangeOverlayInputs({
      sequence: 'A'.repeat(MAP_MOTIF_OVERLAY_MAX_MATCHES_PER_RULE + 20),
      sequenceType: 'dna',
      topology: 'linear',
      rules: [rule],
    });

    expect(inputs).toHaveLength(1);
    expect(inputs[0].ranges).toHaveLength(MAP_MOTIF_OVERLAY_MAX_MATCHES_PER_RULE);
  });
});
