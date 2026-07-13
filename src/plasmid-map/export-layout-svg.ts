/**
 * Pure SVG export from MapLayout.
 *
 * This is the layout-object export path that can eventually replace live DOM
 * cloning. It has no DOM/window dependency and only serializes geometry already
 * produced by computeMapLayout.
 */
import type { MapLabelRender, MapLayout, Pt } from './types';
import type { MapRangeOverlayRender } from './range-overlays';

export interface MapLayoutSvgTheme {
  background: string;
  backbone: string;
  coordinate: string;
  featureStroke: string;
  label: string;
  restriction: string;
  restrictionTypeIIS: string;
  density: string;
  overflow: string;
  highlight: string;
  selection: string;
}

export interface ExportMapLayoutSvgOptions {
  theme?: Partial<MapLayoutSvgTheme>;
  rangeOverlays?: readonly MapRangeOverlayRender[];
  selectionPaths?: readonly string[];
  title?: string;
}

const DEFAULT_THEME: MapLayoutSvgTheme = {
  background: '#ffffff',
  backbone: '#64748b',
  coordinate: '#94a3b8',
  featureStroke: '#0f172a',
  label: '#0f172a',
  restriction: '#475569',
  restrictionTypeIIS: '#b45309',
  density: '#94a3b8',
  overflow: '#334155',
  highlight: '#e0b83c',
  selection: '#0ea5e9',
};

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;');
}

function line(attrs: { x1: number; y1: number; x2: number; y2: number; stroke: string; width?: number; opacity?: number }): string {
  const opacity = attrs.opacity === undefined ? '' : ` opacity="${attrs.opacity}"`;
  return `<line x1="${attrs.x1}" y1="${attrs.y1}" x2="${attrs.x2}" y2="${attrs.y2}" stroke="${attrs.stroke}" stroke-width="${attrs.width ?? 1}" stroke-linecap="round"${opacity}/>`;
}

function polyline(points: readonly Pt[], stroke: string): string {
  if (points.length < 2) return '';
  return `<polyline points="${points.map((point) => `${point.x},${point.y}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.75"/>`;
}

function labelSvg(label: MapLabelRender, theme: MapLayoutSvgTheme): string {
  const rotate = Number.isFinite(label.rotate ?? NaN)
    ? ` transform="rotate(${label.rotate} ${label.x} ${label.y})"`
    : '';
  const baseline = label.baseline ? ` dominant-baseline="${label.baseline}"` : '';
  return `${polyline(label.leader, theme.coordinate)}<text x="${label.x}" y="${label.y}" text-anchor="${label.anchor}"${baseline}${rotate} fill="${theme.label}" font-family="Arial, sans-serif" font-size="10">${escapeText(label.text)}</text>`;
}

function mapUnit(layout: MapLayout): 'aa' | 'bp' {
  return layout.sequenceType === 'protein' ? 'aa' : 'bp';
}

export function exportMapLayoutSvg(layout: MapLayout, options: ExportMapLayoutSvgOptions = {}): string {
  const theme: MapLayoutSvgTheme = { ...DEFAULT_THEME, ...(options.theme ?? {}) };
  const title = options.title ?? `${layout.name || 'Sequence'} map`;
  const chunks: string[] = [
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(layout.bg.width)}" height="${Math.round(layout.bg.height)}" viewBox="${escapeAttr(layout.viewBox)}" role="img" aria-label="${escapeAttr(title)}" data-motif-map-export="layout">`,
    `<title>${escapeText(title)}</title>`,
    `<rect x="${layout.bg.x}" y="${layout.bg.y}" width="${layout.bg.width}" height="${layout.bg.height}" fill="${theme.background}"/>`,
    `<path d="${escapeAttr(layout.backbonePath)}" fill="none" stroke="${theme.backbone}" stroke-width="${layout.mode === 'circular' ? 2 : 1.5}" stroke-linecap="round"/>`,
  ];

  for (const overlay of options.rangeOverlays ?? []) {
    const color = escapeAttr(overlay.color || theme.highlight);
    const isLinear = layout.mode === 'linear';
    const isComment = overlay.kind === 'comment';
    const isOrf = overlay.kind === 'orf';
    const isMotif = overlay.kind === 'motif';
    const isVariant = overlay.kind === 'variant';
    const isDigest = overlay.kind === 'digest';
    const isDesign = overlay.kind === 'design';
    const isCompare = overlay.kind === 'compare';
    const isScar = overlay.kind === 'scar';
    const strokeWidth = isLinear
      ? isScar ? 1.1 : isDesign ? 1.05 : isVariant ? 1.05 : isDigest ? 1 : isCompare ? 1 : isMotif ? 1 : isOrf ? 1 : isComment ? 1 : 0.8
      : isScar ? 2.8 : isDesign ? 2.5 : isVariant ? 2.6 : isDigest ? 2.4 : isCompare ? 2.4 : isMotif ? 2.4 : isOrf ? 2.1 : isComment ? 2.4 : 3.5;
    const fillOpacity = isLinear
      ? isScar ? 0.16 : isCompare ? 0.22 : isVariant ? 0.2 : isDesign ? 0.18 : isDigest ? 0.16 : isMotif ? 0.12 : isOrf ? 0.12 : isComment ? 0.18 : 0.24
      : isScar ? 0.1 : isCompare ? 0.16 : isVariant ? 0.14 : isDesign ? 0.12 : isDigest ? 0.1 : isMotif ? 0.08 : isOrf ? 0 : isComment ? 0.12 : 0.18;
    const strokeOpacity = isLinear
      ? isScar ? 0.6 : isCompare ? 0.64 : isDesign ? 0.62 : isVariant ? 0.68 : isMotif ? 0.62 : isDigest ? 0.58 : isOrf ? 0.58 : isComment ? 0.52 : 0.42
      : isScar ? 0.72 : isDesign ? 0.72 : isVariant ? 0.76 : isMotif ? 0.72 : isCompare ? 0.7 : isDigest ? 0.66 : isOrf ? 0.68 : isComment ? 0.62 : 0.58;
    let dash = '';
    if (isComment) dash = ` stroke-dasharray="5 3"`;
    else if (isMotif) dash = ` stroke-dasharray="1.5 4"`;
    else if (isVariant) dash = overlay.variant === 'deletion'
      ? ` stroke-dasharray="2.5 2"`
      : ` stroke-dasharray="4 2 1.2 2"`;
    else if (isDigest) dash = ` stroke-dasharray="8 3"`;
    else if (isCompare) dash = ` stroke-dasharray="2 2"`;
    else if (isDesign && overlay.variant === 'amplicon') dash = ` stroke-dasharray="5 2"`;
    else if (overlay.variant === 'deletion') dash = ` stroke-dasharray="2.5 2"`;
    else if (isOrf && overlay.variant === 'reverse') dash = ` stroke-dasharray="7 3"`;
    const variant = overlay.variant ? ` data-overlay-variant="${escapeAttr(overlay.variant)}"` : '';
    chunks.push(`<g data-overlay-kind="${escapeAttr(overlay.kind)}"${variant} aria-label="${escapeAttr(overlay.title)}">`);
    chunks.push(`<title>${escapeText(overlay.title)}</title>`);
    for (const d of overlay.paths) {
      chunks.push(`<path d="${escapeAttr(d)}" fill="${color}" fill-opacity="${fillOpacity}" stroke="${color}" stroke-width="${strokeWidth}" stroke-opacity="${strokeOpacity}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`);
    }
    chunks.push(`</g>`);
  }

  for (const coordinate of layout.coordinates) {
    if (coordinate.grid) chunks.push(line({ ...coordinate.grid, stroke: theme.coordinate, width: 0.6, opacity: 0.25 }));
    chunks.push(line({ ...coordinate.tick, stroke: theme.coordinate, width: coordinate.major ? 1.2 : 0.7, opacity: coordinate.major ? 0.85 : 0.45 }));
    if (coordinate.label) {
      const rotate = Number.isFinite(coordinate.label.rotate ?? NaN)
        ? ` transform="rotate(${coordinate.label.rotate} ${coordinate.label.x} ${coordinate.label.y})"`
        : '';
      chunks.push(`<text x="${coordinate.label.x}" y="${coordinate.label.y}" text-anchor="${coordinate.label.anchor}"${rotate} fill="${theme.coordinate}" font-family="Arial, sans-serif" font-size="9">${escapeText(coordinate.label.text)}</text>`);
    }
  }

  for (const densityTick of layout.restrictionDensityTicks) {
    chunks.push(line({ ...densityTick.tick, stroke: theme.density, width: 0.7, opacity: 0.4 }));
  }

  for (const feature of layout.features) {
    for (const d of feature.segmentPaths) {
      chunks.push(`<path d="${escapeAttr(d)}" fill="${escapeAttr(feature.color)}" stroke="${theme.featureStroke}" stroke-width="0.8" stroke-linejoin="round" opacity="0.92"/>`);
    }
    if (feature.label) chunks.push(labelSvg(feature.label, theme));
  }

  for (const restriction of layout.restrictions) {
    chunks.push(line({
      ...restriction.tick,
      stroke: restriction.hasTypeIIS ? theme.restrictionTypeIIS : theme.restriction,
      width: 1,
      opacity: 0.85,
    }));
    if (restriction.label) {
      chunks.push(labelSvg(restriction.label, {
        ...theme,
        label: restriction.hasTypeIIS ? theme.restrictionTypeIIS : theme.restriction,
      }));
    }
  }

  for (const overflow of layout.overflows ?? []) {
    chunks.push(`<text x="${overflow.x}" y="${overflow.y}" text-anchor="${overflow.anchor}" fill="${theme.overflow}" font-family="Arial, sans-serif" font-size="10">${escapeText(overflow.text)}</text>`);
  }

  if (layout.mode === 'circular') {
    const centerTitle = layout.centerTitle ?? {
      lines: [{ text: layout.name, fontSize: 15, baselineY: layout.center.y - 2 }],
      lenBaselineY: layout.center.y + 16,
    };
    for (const line of centerTitle.lines) {
      chunks.push(`<text x="${layout.center.x}" y="${line.baselineY}" text-anchor="middle" fill="${theme.label}" font-family="Arial, sans-serif" font-size="${line.fontSize}" font-weight="650">${escapeText(line.text)}</text>`);
    }
    chunks.push(`<text x="${layout.center.x}" y="${centerTitle.lenBaselineY}" text-anchor="middle" fill="${theme.coordinate}" font-family="Arial, sans-serif" font-size="10">${layout.length} ${mapUnit(layout)}</text>`);
  }

  for (const d of options.selectionPaths ?? []) {
    chunks.push(`<path d="${escapeAttr(d)}" fill="${theme.selection}" opacity="0.18" stroke="${theme.selection}" stroke-width="1.5"/>`);
  }

  chunks.push(`</svg>`);
  return chunks.join('\n');
}
