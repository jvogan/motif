import { describe, expect, it } from 'vitest';
import vectors from '../../../public/data/vectors.json';
import { findRestrictionSites } from '../../bio/restriction-sites';
import { resolveEnzymeUnion } from '../../bio/restriction-presets';
import type { Feature } from '../../bio/types';
import { computeMapLayout } from '../layout';
import { approxTextWidth, CIRCULAR_LABEL_BOX_HEIGHT_PX, type LabelFontMode } from '../geometry/labels';
import { restrictionDensitySourcesForMap, restrictionSitesForInteractiveMap } from '../restriction-display';
import type { MapLabelRender, MapLayout } from '../types';

type Box = { x0: number; y0: number; x1: number; y1: number };

function compactMapName(name: string): string {
  const compact = name
    .replace(/\bforward\b/gi, 'fwd')
    .replace(/\breverse\b/gi, 'rev')
    .replace(/\bpromoter\b/gi, 'prom.')
    .replace(/\bprimer\b/gi, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compact.length > 14 ? `${compact.slice(0, 13).trimEnd()}…` : compact;
}

function box(label: MapLabelRender, mode: LabelFontMode): Box {
  const width = approxTextWidth(label.text, undefined, mode);
  const x0 = label.anchor === 'start' ? 0 : label.anchor === 'end' ? -width : -width / 2;
  const x1 = label.anchor === 'start' ? width : label.anchor === 'end' ? 0 : width / 2;
  const y0 = label.baseline === 'middle' ? -CIRCULAR_LABEL_BOX_HEIGHT_PX / 2 : -CIRCULAR_LABEL_BOX_HEIGHT_PX * 0.8;
  const y1 = label.baseline === 'middle' ? CIRCULAR_LABEL_BOX_HEIGHT_PX / 2 : CIRCULAR_LABEL_BOX_HEIGHT_PX * 0.3;
  const radians = (label.rotate ?? 0) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => ({
    x: label.x + x * cos - y * sin,
    y: label.y + x * sin + y * cos,
  }));
  return {
    x0: Math.min(...points.map((point) => point.x)),
    y0: Math.min(...points.map((point) => point.y)),
    x1: Math.max(...points.map((point) => point.x)),
    y1: Math.max(...points.map((point) => point.y)),
  };
}

function visibleOverlapPairs(layout: MapLayout): string[] {
  const labels = [
    ...layout.features.filter((item) => item.label).map((item) => ({ family: 'feature', text: item.label!.text, box: box(item.label!, 'proportional') })),
    ...layout.restrictions.filter((item) => item.label).map((item) => ({ family: 'restriction', text: item.label!.text, box: box(item.label!, 'monospace') })),
    ...layout.coordinates.filter((item) => item.label).map((item) => ({ family: 'coord', text: item.label!.text, box: box({ ...item.label!, leader: [], inside: true }, 'proportional') })),
  ];
  const pairs: string[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const x = Math.min(labels[i].box.x1, labels[j].box.x1) - Math.max(labels[i].box.x0, labels[j].box.x0);
      const y = Math.min(labels[i].box.y1, labels[j].box.y1) - Math.max(labels[i].box.y0, labels[j].box.y0);
      if (x > 0.5 && y > 0.5) pairs.push(`${labels[i].family}:${labels[i].text} × ${labels[j].family}:${labels[j].text}`);
    }
  }
  return pairs;
}

/**
 * Sites whose enzyme no visible label states, read off the drawn text.
 *
 * A tick id is `<enzyme>@<position>` and a cluster label is `Name, Name +N`, so
 * this reconstructs what a reader can actually name without consulting anything
 * the chip's own code computes. An ellipsised name ("Hind…") counts as naming its
 * enzyme: the map has committed the label to it, and the chip credits it too.
 */
function unnamedSitesFromDrawnLabels(layout: MapLayout): number {
  return layout.restrictions.reduce((count, restriction) => {
    const enzymes = restriction.tickIds.map((id) => id.slice(0, id.lastIndexOf('@')));
    if (!restriction.label) return count + enzymes.length;
    const shown = restriction.label.text.replace(/ \+\d+$/, '').split(', ').map((name) => name.trim());
    const exact = new Set(shown.filter((name) => !name.includes('…')));
    const stems = shown.filter((name) => name.includes('…')).map((name) => name.replace(/…$/, ''));
    return count + enzymes.filter(
      (enzyme) => !exact.has(enzyme) && !stems.some((stem) => enzyme.startsWith(stem)),
    ).length;
  }, 0);
}

describe('live pUC19 responsive map labels', () => {
  it.each([
    { viewport: '1600×1000', width: 721, height: 840, complete: true },
    { viewport: '900×680', width: 832, height: 246, complete: false },
    { viewport: '610×720', width: 542, height: 458, complete: false },
  ])('keeps the artifact pUC19 map collision-free at $viewport', ({ width, height, complete }) => {
    const record = vectors.find((candidate) => candidate.name === 'pUC19')!;
    const sites = findRestrictionSites(record.sequence, resolveEnzymeUnion(['common', 'golden-gate-type-iis']), { topology: 'circular' });
    const interactiveSites = restrictionSitesForInteractiveMap(sites);
    const densitySources = restrictionDensitySourcesForMap(sites, record.sequence.length);
    const features = record.features.map((feature) => ({
      ...feature,
      name: compactMapName(feature.name),
      metadata: feature.metadata ?? {},
    })) as Feature[];
    const layout = computeMapLayout({
      mode: 'circular',
      name: record.name,
      length: record.sequence.length,
      topology: 'circular',
      sequenceType: 'dna',
      features,
      restrictionSites: interactiveSites,
      restrictionDensitySources: densitySources,
      width,
      height,
      display: {
        labelDensity: 'high',
        labelFontMode: 'proportional',
        circularOutsideGutterScale: 0.28,
        maxFeatureLabels: 18,
        maxRestrictionLabels: 24,
        showFeatureLabels: true,
        showRestrictionLabels: true,
      },
    });

    expect(visibleOverlapPairs(layout)).toEqual([]);
    expect(layout.restrictions).toHaveLength(22);
    if (complete) {
      expect(layout.restrictions.filter((item) => !item.label).map((item) => item.title)).toEqual([]);
    } else {
      expect(layout.restrictions.filter((item) => item.label).length).toBeGreaterThanOrEqual(19);
    }
    // Recounted from the DRAWN label strings rather than from the layout's own
    // bookkeeping, so this disagrees whenever the chip and the ring stop matching.
    // A fully labelled map still owes the reader this number: `complete` above says
    // every cluster carries a label, and the labels still name only some of the
    // sites under them.
    // "N unnamed sites", or "N unnamed" where the full sentence would reach a
    // neighbouring name. Only the noun is ever spent; the count is in both.
    expect(layout.overflows?.find((item) => item.kind === 'restriction-labels')?.text ?? '0 unnamed')
      .toMatch(new RegExp(`^${unnamedSitesFromDrawnLabels(layout)} unnamed( sites?)?$`));
  });

  it('keeps the dense pET-28a(+) cloning landmarks alongside bounded enzyme names', () => {
    const record = vectors.find((candidate) => candidate.name === 'pET-28a(+)')!;
    const sites = findRestrictionSites(record.sequence, resolveEnzymeUnion(['common', 'golden-gate-type-iis']), { topology: 'circular' });
    const interactiveSites = restrictionSitesForInteractiveMap(sites);
    const densitySources = restrictionDensitySourcesForMap(sites, record.sequence.length);
    const features = record.features.map((feature) => ({
      ...feature,
      name: compactMapName(feature.name),
      metadata: feature.metadata ?? {},
    })) as Feature[];
    const layout = computeMapLayout({
      mode: 'circular',
      name: record.name,
      length: record.sequence.length,
      topology: 'circular',
      sequenceType: 'dna',
      features,
      restrictionSites: interactiveSites,
      restrictionDensitySources: densitySources,
      // Exact ResizeObserver content box at the artifact's 1600×1000 gate.
      width: 721,
      height: 840,
      display: {
        labelDensity: 'high',
        labelFontMode: 'proportional',
        circularOutsideGutterScale: 0.28,
        maxFeatureLabels: 18,
        maxRestrictionLabels: 24,
        showFeatureLabels: true,
        showRestrictionLabels: true,
      },
    });
    const featureOnlyLayout = computeMapLayout({
      mode: 'circular', name: record.name, length: record.sequence.length,
      topology: 'circular', sequenceType: 'dna', features, restrictionSites: [],
      width: 721, height: 840,
      display: { labelDensity: 'high', labelFontMode: 'proportional', circularOutsideGutterScale: 0.28, maxFeatureLabels: 18, maxRestrictionLabels: 24, showFeatureLabels: true, showRestrictionLabels: true },
    });

    const featureLabels = layout.features.flatMap((feature) => feature.label?.text ?? []);
    expect(featureOnlyLayout.features.flatMap((feature) => feature.label?.text ?? [])).toHaveLength(6);
    expect(featureLabels).toHaveLength(6);
    expect(featureLabels).toContain('RBS');
    for (const requiredPrefix of ['T7 pro', '6xHis', 'T7 ter']) {
      expect(featureLabels.some((label) => label.startsWith(requiredPrefix))).toBe(true);
    }
    expect(layout.restrictions.filter((restriction) => restriction.label).length).toBeGreaterThanOrEqual(20);
    expect(layout.overflows?.find((overflow) => overflow.kind === 'feature-labels')?.text).toBe('+1 more');
    expect(visibleOverlapPairs(layout)).toEqual([]);
  });
});
