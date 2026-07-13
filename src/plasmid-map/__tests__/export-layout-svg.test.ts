import { describe, expect, it } from 'vitest';

import { exportMapLayoutSvg } from '../export-layout-svg';
import { computeMapLayout } from '../layout';
import {
  commentRangeOverlayInput,
  motifRangeOverlayInputs,
  orfRangeOverlayInput,
  projectRangeOverlays,
  scarRangeOverlayInput,
  variantRangeOverlayInput,
} from '../range-overlays';
import { selectionOverlayPaths } from '../selection-overlay';
import { makeSequenceMotifRule } from '../../bio/sequence-formatting';
import type { Feature, RestrictionSite } from '../../bio/types';

const feature = (id: string, start: number, end: number, name = id): Feature => ({
  id,
  name,
  type: 'cds',
  start,
  end,
  strand: 1,
  color: '#2f9e44',
  metadata: {},
});

const site = (enzyme: string, position: number): RestrictionSite => ({
  enzyme,
  position,
  cutPosition: position + 1,
  recognitionSequence: 'GAATTC',
  overhang: 'blunt',
});

describe('exportMapLayoutSvg', () => {
  it('serializes a deterministic standalone SVG from layout geometry', () => {
    const layout = computeMapLayout({
      mode: 'circular',
      name: 'pExport',
      length: 1200,
      topology: 'circular',
      sequenceType: 'dna',
      features: [feature('feat-a', 100, 260, 'AmpR')],
      restrictionSites: [site('EcoRI', 40)],
      width: 420,
      height: 420,
    });
    const selectionPaths = selectionOverlayPaths(layout, [{ start: 100, end: 260 }]);

    const first = exportMapLayoutSvg(layout, { title: 'A&B <map>', selectionPaths });
    const second = exportMapLayoutSvg(layout, { title: 'A&B <map>', selectionPaths });

    expect(first).toBe(second);
    expect(first).toContain('<?xml version="1.0"');
    expect(first).toContain('data-motif-map-export="layout"');
    expect(first).toContain(`viewBox="${layout.viewBox}"`);
    expect(first).toContain('<title>A&amp;B &lt;map&gt;</title>');
    expect(first).toContain('pExport');
    expect(first).toContain('1200 bp');
    expect(first).toContain('<rect');
    expect(first).toContain('<path');
    expect(first).toContain('AmpR');
    expect(first).toContain('EcoRI');
    expect(first).not.toContain('class=');
    expect(first).not.toContain('var(--');
    expect(first).not.toContain('color-mix(');
    expect(first).not.toContain('[object Object]');
  });

  it('serializes linear protein maps without restriction clutter', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'Protein Map',
      length: 180,
      topology: 'linear',
      sequenceType: 'protein',
      features: [feature('domain-a', 10, 90, 'N-terminal domain')],
      restrictionSites: [],
      width: 640,
      height: 300,
    });

    const svg = exportMapLayoutSvg(layout);

    expect(svg).toContain('Protein Map map');
    expect(svg).toContain('N-terminal domain');
    expect(svg).not.toContain('EcoRI');
  });

  it('serializes linear DNA and RNA maps from layout geometry', () => {
    for (const sequenceType of ['dna', 'rna'] as const) {
      const layout = computeMapLayout({
        mode: 'linear',
        name: `${sequenceType.toUpperCase()} Map`,
        length: 1800,
        topology: 'linear',
        sequenceType,
        features: [feature(`${sequenceType}-feature`, 120, 360, `${sequenceType} feature`)],
        restrictionSites: sequenceType === 'dna' ? [site('BamHI', 500)] : [],
        width: 720,
        height: 320,
      });

      const svg = exportMapLayoutSvg(layout);

      expect(svg).toContain('data-motif-map-export="layout"');
      expect(svg).toContain(`${sequenceType} feature`);
      expect(svg).not.toContain('class=');
      expect(svg).not.toContain('var(--');
      expect(svg).not.toContain('color-mix(');
      if (sequenceType === 'dna') expect(svg).toContain('BamHI');
      else expect(svg).not.toContain('BamHI');
    }
  });

  it('serializes projected range overlays without DOM classes or CSS variables', () => {
    const layout = computeMapLayout({
      mode: 'circular',
      name: 'Highlight Export',
      length: 1000,
      topology: 'circular',
      sequenceType: 'dna',
      features: [feature('feature-a', 100, 220, 'Feature A')],
      restrictionSites: [],
      width: 420,
      height: 420,
    });
    const commentInput = commentRangeOverlayInput({
      id: 'comment-a',
      start: 260,
      end: 260,
      text: 'Check <junction>',
    }, layout.length);
    const deletionInput = scarRangeOverlayInput({
      id: 'scar-del',
      position: 500,
      type: 'deletion',
      original: 'ATG',
      createdAt: 1,
    }, layout.length, 'A'.repeat(layout.length));
    const orfInput = orfRangeOverlayInput({
      start: 100,
      end: 250,
      frame: 1,
      strand: 1,
      length: 150,
      aminoAcids: 49,
      startCodon: 'ATG',
      stopCodon: 'TGA',
    }, 0, layout.length);
    const motifInputs = motifRangeOverlayInputs({
      sequence: `ATG${'A'.repeat(layout.length - 3)}`,
      sequenceType: 'dna',
      topology: 'circular',
      rules: [{
        ...makeSequenceMotifRule('ATG', { backgroundColor: '#22d3ee' }, 'dna', 'Start motif'),
        id: 'motif-atg',
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    const variantInput = variantRangeOverlayInput({
      id: 'variant-a',
      start: 420,
      end: 421,
      kind: 'substitution',
      reference: 'A',
      alternate: 'G',
    }, layout.length);
    const rangeOverlays = projectRangeOverlays(layout, [
      ...(orfInput ? [orfInput] : []),
      ...(motifInputs[0] ? [motifInputs[0]] : []),
      ...(variantInput ? [variantInput] : []),
      {
        id: 'hl-a',
        kind: 'highlight',
        label: 'Region <A>',
        color: '#60a5fa',
        ranges: [{ start: 900, end: 1100 }],
      },
      ...(commentInput ? [commentInput] : []),
      ...(deletionInput ? [deletionInput] : []),
    ]);

    const svg = exportMapLayoutSvg(layout, { rangeOverlays });

    expect(svg).toContain('data-overlay-kind="highlight"');
    expect(svg).toContain('data-overlay-kind="orf" data-overlay-variant="forward"');
    expect(svg).toContain('data-overlay-kind="motif" data-overlay-variant="dna"');
    expect(svg).toContain('data-overlay-kind="variant" data-overlay-variant="substitution"');
    expect(svg).toContain('data-overlay-kind="comment"');
    expect(svg).toContain('data-overlay-kind="scar" data-overlay-variant="deletion"');
    expect(svg).toContain('ORF +1 49 aa (orf)');
    expect(svg).toContain('Motif Start motif (motif)');
    expect(svg).toContain('A&gt;G at 421 (variant)');
    expect(svg).toContain('Region &lt;A&gt; (highlight)');
    expect(svg).toContain('Check &lt;junction&gt; (comment)');
    expect(svg).toContain('Deletion ATG at 501 (scar)');
    expect(svg).toContain('fill="#60a5fa"');
    expect(svg).toContain('fill="#0f766e"');
    expect(svg).toContain('fill="#22d3ee"');
    expect(svg).toContain('fill="#be185d"');
    expect(svg).toContain('fill="#2563eb"');
    expect(svg).toContain('fill="#dc2626"');
    expect(svg).toContain('stroke="#60a5fa"');
    expect(svg).toContain('stroke-dasharray="1.5 4"');
    expect(svg).toContain('stroke-dasharray="4 2 1.2 2"');
    expect(svg).toContain('fill-opacity="0.18"');
    expect(svg.match(/data-overlay-kind="highlight"/g)).toHaveLength(1);
    expect(svg.match(/data-overlay-kind="orf"/g)).toHaveLength(1);
    expect(svg.match(/data-overlay-kind="motif"/g)).toHaveLength(1);
    expect(svg.match(/data-overlay-kind="variant"/g)).toHaveLength(1);
    expect(svg.match(/data-overlay-kind="comment"/g)).toHaveLength(1);
    expect(svg.match(/data-overlay-kind="scar"/g)).toHaveLength(1);
    expect(svg.match(/stroke="#60a5fa"/g)).toHaveLength(2);
    expect(svg.indexOf('data-overlay-kind="orf"')).toBeLessThan(svg.indexOf('data-overlay-kind="highlight"'));
    expect(svg.indexOf('data-overlay-kind="motif"')).toBeLessThan(svg.indexOf('data-overlay-kind="highlight"'));
    expect(svg.indexOf('data-overlay-kind="variant"')).toBeLessThan(svg.indexOf('data-overlay-kind="highlight"'));
    expect(svg.indexOf('data-overlay-kind="highlight"')).toBeLessThan(svg.indexOf('Feature A'));
    expect(svg).not.toContain('class=');
    expect(svg).not.toContain('var(--');
    expect(svg).not.toContain('color-mix(');
  });
});
