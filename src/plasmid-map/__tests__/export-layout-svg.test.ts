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
import {
  circularSelectionEdgePath,
  linearSelectionColumnPath,
  linearSelectionEdgePaths,
  selectionOverlayPaths,
} from '../selection-overlay';
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

  it('materializes semantic feature colors for standalone SVG consumers', () => {
    const themedFeature = {
      ...feature('themed-feature', 100, 260, 'Themed feature'),
      color: 'var(--accent, #7E9BBF)',
    };
    const layout = computeMapLayout({
      mode: 'circular',
      name: 'Portable colors',
      length: 1200,
      topology: 'circular',
      sequenceType: 'dna',
      features: [themedFeature],
      restrictionSites: [],
      width: 420,
      height: 420,
    });

    const svg = exportMapLayoutSvg(layout);

    expect(svg).toContain('fill="#7E9BBF"');
    expect(svg).not.toContain('var(--');
    expect(svg).not.toContain('color-mix(');
  });

  it('materializes the complete approved semantic mix against the export background', () => {
    const mixedFeature = {
      ...feature('mixed-feature', 100, 260, 'Mixed feature'),
      color: 'color-mix(in srgb, var(--green, #7FA98F) 80%, var(--bg-primary))',
    };
    const layout = computeMapLayout({
      mode: 'circular',
      name: 'Portable mixed colors',
      length: 1200,
      topology: 'circular',
      sequenceType: 'dna',
      features: [mixedFeature],
      restrictionSites: [],
      width: 420,
      height: 420,
    });

    const lightSvg = exportMapLayoutSvg(layout);
    const darkSvg = exportMapLayoutSvg(layout, { theme: { background: '#101820' } });

    expect(lightSvg).toContain('fill="#99baa5"');
    expect(darkSvg).toContain('fill="#698c79"');
    expect(lightSvg).not.toContain('fill="#7FA98F"');
    expect(darkSvg).not.toContain('fill="#7FA98F"');
    expect(lightSvg).not.toContain('var(--');
    expect(lightSvg).not.toContain('color-mix(');
    expect(darkSvg).not.toContain('var(--');
    expect(darkSvg).not.toContain('color-mix(');
  });

  it('draws no text below 12px, the length line included', () => {
    const layout = computeMapLayout({
      mode: 'circular',
      name: 'pExport',
      length: 1200,
      topology: 'circular',
      sequenceType: 'dna',
      features: [feature('feat-a', 100, 260, 'AmpR')],
      restrictionSites: [site('EcoRI', 40), site('BamHI', 600)],
      width: 420,
      height: 420,
    });
    const svg = exportMapLayoutSvg(layout, { selectionPaths: selectionOverlayPaths(layout, [{ start: 100, end: 260 }]) });
    const sizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((match) => Number(match[1]));
    expect(sizes.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    const lengthLine = svg.match(/<text[^>]*font-size="([\d.]+)"[^>]*>1200 bp<\/text>/);
    expect(Number(lengthLine?.[1])).toBeGreaterThanOrEqual(12);
    // The selected range is a light wash with no outline, at the live map's 0.06.
    expect(svg).toMatch(/fill-opacity="0\.06"\/>/);
    expect(svg).not.toMatch(/stroke-width="1\.5"/);
    // Its boundary lines, when given, draw 1.5 wide in the label colour, and the
    // wash itself still carries no stroke.
    const edged = exportMapLayoutSvg(layout, {
      selectionPaths: selectionOverlayPaths(layout, [{ start: 100, end: 260 }]),
      selectionEdgePaths: [circularSelectionEdgePath(layout, 100), circularSelectionEdgePath(layout, 260)],
    });
    expect(edged.match(/<path [^>]*fill-opacity="0\.06"\/>/g)).toHaveLength(1);
    expect(edged.match(/<path [^>]*fill-opacity="0\.06"\/>/)?.[0]).not.toContain('stroke');
    // Stroked along a radial fade in the label colour, filled solid (the marker).
    const strokes = [...edged.matchAll(/<path [^>]*fill="#0f172a" stroke="url\(#([\w-]+-edge)\)" stroke-width="1\.5"[^>]*\/>/g)];
    expect(strokes).toHaveLength(2);
    expect(edged).toMatch(new RegExp(`<radialGradient id="${strokes[0][1]}" gradientUnits="userSpaceOnUse"[^>]*><stop [^>]*stop-color="#0f172a" stop-opacity="0\\.15"/><stop [^>]*stop-color="#0f172a" stop-opacity="1"/></radialGradient>`));
  });

  it('gives each exported selection fade its own gradient ids', () => {
    const at = (length: number, start: number) => {
      const layout = computeMapLayout({ mode: 'circular', name: 'Fade', length, topology: 'circular', sequenceType: 'dna', features: [], restrictionSites: [], width: 420, height: 420 });
      return exportMapLayoutSvg(layout, {
        selectionPaths: selectionOverlayPaths(layout, [{ start, end: start + 100 }]),
        selectionEdgePaths: [circularSelectionEdgePath(layout, start), circularSelectionEdgePath(layout, start + 100)],
      });
    };
    const ids = (svg: string) => [...svg.matchAll(/ id="(motif-export-selection-[\w-]+)"/g)].map((m) => m[1]);
    expect(ids(at(1200, 100))).toHaveLength(2);
    expect(ids(at(1200, 100))).toEqual(ids(at(1200, 100)));
    expect(ids(at(1200, 400)).some((id) => ids(at(1200, 100)).includes(id))).toBe(false);
    expect(ids(at(1500, 100)).some((id) => ids(at(1200, 100)).includes(id))).toBe(false);
    expect(ids(at(1200, 100)).every((id) => !id.startsWith('motif-map-selection-'))).toBe(true);
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

  it('draws a Line view selection as the live map does: wash, two lines, two backbone triangles', () => {
    const layout = computeMapLayout({
      mode: 'linear',
      name: 'Line selection',
      length: 1800,
      topology: 'linear',
      sequenceType: 'dna',
      features: [feature('lin-feature', 120, 360, 'lin feature')],
      restrictionSites: [site('BamHI', 500)],
      width: 720,
      height: 320,
    });
    // The live map's wash is one column over the lines' extent.
    const selectionPaths = selectionOverlayPaths(layout, [{ start: 300, end: 900 }])
      .map((d) => linearSelectionColumnPath(layout, d));
    const selectionEdgePaths = selectionPaths.flatMap((d) => linearSelectionEdgePaths(layout, d));
    expect(selectionEdgePaths).toHaveLength(2);
    const svg = exportMapLayoutSvg(layout, { selectionPaths, selectionEdgePaths });
    const washes = [...svg.matchAll(/<path d="([^"]*)"[^>]*fill-opacity="0\.06"\/>/g)].map((m) => m[1]);
    expect(washes).toHaveLength(1);
    const yRange = (d: string, pairs = Infinity) => {
      const ys = (d.match(/-?[\d.]+/g) ?? []).map(Number).filter((_, i) => i % 2 === 1).slice(0, pairs);
      return [Math.min(...ys), Math.max(...ys)];
    };
    const lineRange = yRange(selectionEdgePaths[0], 2);
    expect(yRange(washes[0])).toEqual(lineRange);
    expect(lineRange[1] - lineRange[0]).toBeGreaterThan(18);
    const edges = svg.match(/<path d="([^"]*)" fill="#0f172a" stroke="url\(#[\w-]+-edge\)" stroke-width="1\.5"[^>]*\/>/g) ?? [];
    expect(edges).toHaveLength(2);
    // Solid from the backbone through the marker, then fading to 0.15 at the far end.
    expect(svg).toMatch(new RegExp(`<linearGradient id="[\\w-]+-edge" gradientUnits="userSpaceOnUse" x1="0" y1="${Math.round(layout.center.y * 1000) / 1000}" x2="0" y2="[\\d.]+"><stop offset="0" stop-color="#0f172a" stop-opacity="1"/><stop offset="[\\d.]+" stop-color="#0f172a" stop-opacity="1"/><stop offset="1" stop-color="#0f172a" stop-opacity="0\\.15"/></linearGradient>`));
    // Each is a line and a closed triangle whose tip is on the backbone.
    for (const edge of edges) {
      expect(edge.match(/ M /g)).toHaveLength(1);
      expect(edge).toContain(` M `);
      expect(edge).toMatch(new RegExp(` M -?[\\d.]+ ${Math.round(layout.center.y * 1000) / 1000} L `));
      expect(edge).toMatch(/ Z"/);
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
    // Responsive label culling may omit the feature text, but all overlay kinds
    // above remain serialized exactly once and in their requested order.
    expect(svg).not.toContain('class=');
    expect(svg).not.toContain('var(--');
    expect(svg).not.toContain('color-mix(');
  });
});
