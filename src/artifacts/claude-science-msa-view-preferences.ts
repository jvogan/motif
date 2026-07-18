import {
  MSA_COLOR_SCHEMES,
  MSA_SHADE_MODES,
  type MsaColorScheme,
  type MsaShadeMode,
} from './claude-science-msa';

export type ClaudeScienceMsaTextFormat = 'fasta' | 'clustal' | 'consensus' | 'json';
export type ClaudeScienceMsaDisplayMode = 'viewer' | 'trace' | 'text';
export type ClaudeScienceMsaEmphasisMode = 'differences' | 'letters';
export type ClaudeScienceMsaColorMode = 'mono' | 'residue';
export type ClaudeScienceMsaRowSortMode = 'original' | 'name' | 'identity' | 'mismatches' | 'length';
export type ClaudeScienceMsaColorScheme = MsaColorScheme;
export type ClaudeScienceMsaShadeMode = MsaShadeMode;

/** Column-density zoom bounds. 1 = the font-derived cell width; below ~0.65 the
 * viewer drops letters for a birdseye "blocks" rendering. Decoupled from font
 * size so users can compress wide alignments without shrinking readable text. */
export const MSA_ZOOM_MIN = 0.2;
export const MSA_ZOOM_MAX = 2;

export type MsaFitZoomInput = {
  baseCellWidth: number;
  columnCount: number;
  viewportWidth: number;
  minimumCellWidth: number;
  maximumCellWidth: number;
};

/**
 * Select the greatest persisted (0.01-step) zoom whose final, tenth-pixel
 * rounded cell width fits the available sequence viewport. Keeping the same
 * quantization as the renderer prevents a nominal "Fit" from leaving a small
 * overflow lane at rounding boundaries.
 */
export function resolveMsaFitZoom({
  baseCellWidth,
  columnCount,
  viewportWidth,
  minimumCellWidth,
  maximumCellWidth,
}: MsaFitZoomInput): { zoom: number; fits: boolean } {
  const valid = [baseCellWidth, columnCount, viewportWidth, minimumCellWidth, maximumCellWidth]
    .every((value) => Number.isFinite(value) && value >= 0);
  if (!valid || baseCellWidth === 0 || maximumCellWidth < minimumCellWidth) {
    return { zoom: MSA_ZOOM_MIN, fits: false };
  }

  const renderedWidth = (zoom: number) => {
    const boundedCellWidth = Math.max(minimumCellWidth, Math.min(maximumCellWidth, baseCellWidth * zoom));
    return (Math.round(boundedCellWidth * 10) / 10) * columnCount;
  };
  const fitsAt = (zoom: number) => renderedWidth(zoom) <= viewportWidth;
  if (!fitsAt(MSA_ZOOM_MIN)) return { zoom: MSA_ZOOM_MIN, fits: false };

  const minimumStep = Math.ceil(MSA_ZOOM_MIN * 100);
  const maximumStep = Math.floor(MSA_ZOOM_MAX * 100);
  for (let step = maximumStep; step >= minimumStep; step -= 1) {
    const zoom = step / 100;
    if (fitsAt(zoom)) return { zoom, fits: true };
  }
  return { zoom: MSA_ZOOM_MIN, fits: true };
}

export type ClaudeScienceMsaViewPreferences = {
  displayMode: ClaudeScienceMsaDisplayMode;
  emphasis: ClaudeScienceMsaEmphasisMode;
  colorMode: ClaudeScienceMsaColorMode;
  colorScheme: ClaudeScienceMsaColorScheme;
  shadeMode: ClaudeScienceMsaShadeMode;
  sortMode: ClaudeScienceMsaRowSortMode;
  fontSize: number;
  zoom: number;
  translationFrame: 0 | 1 | 2;
  textFormat: ClaudeScienceMsaTextFormat;
  showOverview: boolean;
  showAlignmentAxis: boolean;
  showTemplateAxis: boolean;
  showRowStats: boolean;
  showConservation: boolean;
  showConservationHistogram: boolean;
  showOccupancy: boolean;
  showConsensus: boolean;
  showSequenceLogo: boolean;
  showTranslation: boolean;
  showAminoAcidIndices: boolean;
};

export const DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES: ClaudeScienceMsaViewPreferences = {
  displayMode: 'viewer',
  emphasis: 'differences',
  colorMode: 'mono',
  colorScheme: 'auto',
  shadeMode: 'none',
  sortMode: 'original',
  fontSize: 11,
  zoom: 1,
  translationFrame: 0,
  textFormat: 'fasta',
  showOverview: true,
  showAlignmentAxis: true,
  showTemplateAxis: true,
  showRowStats: true,
  showConservation: true,
  showConservationHistogram: true,
  showOccupancy: false,
  showConsensus: true,
  showSequenceLogo: false,
  showTranslation: false,
  showAminoAcidIndices: true,
};

export function normalizeClaudeScienceMsaViewPreferences(value: unknown): ClaudeScienceMsaViewPreferences {
  const source = value && typeof value === 'object'
    ? value as Partial<Record<keyof ClaudeScienceMsaViewPreferences, unknown>>
    : {};
  // Track toggles that default to visible: a malformed value keeps the track on
  // rather than silently hiding evidence.
  const visible = (key: keyof Pick<ClaudeScienceMsaViewPreferences,
    'showOverview' | 'showAlignmentAxis' | 'showTemplateAxis' | 'showRowStats'
    | 'showConservation' | 'showConservationHistogram' | 'showConsensus' | 'showAminoAcidIndices'>) => (
    typeof source[key] === 'boolean' ? source[key] as boolean : true
  );
  // Toggles that default to off unless explicitly enabled.
  const optional = (key: keyof Pick<ClaudeScienceMsaViewPreferences, 'showOccupancy' | 'showSequenceLogo' | 'showTranslation'>) => (
    source[key] === true
  );
  return {
    displayMode: source.displayMode === 'trace' || source.displayMode === 'text' ? source.displayMode : 'viewer',
    emphasis: source.emphasis === 'letters' ? 'letters' : 'differences',
    colorMode: source.colorMode === 'residue' ? 'residue' : 'mono',
    colorScheme: MSA_COLOR_SCHEMES.includes(source.colorScheme as MsaColorScheme)
      ? source.colorScheme as MsaColorScheme
      : 'auto',
    shadeMode: MSA_SHADE_MODES.includes(source.shadeMode as MsaShadeMode)
      ? source.shadeMode as MsaShadeMode
      : 'none',
    sortMode: source.sortMode === 'name' || source.sortMode === 'identity' || source.sortMode === 'mismatches' || source.sortMode === 'length'
      ? source.sortMode
      : 'original',
    fontSize: Number.isFinite(source.fontSize)
      ? Math.max(9, Math.min(16, Math.round(source.fontSize as number)))
      : DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES.fontSize,
    zoom: Number.isFinite(source.zoom)
      ? Math.max(MSA_ZOOM_MIN, Math.min(MSA_ZOOM_MAX, Math.round((source.zoom as number) * 100) / 100))
      : DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES.zoom,
    translationFrame: source.translationFrame === 1 || source.translationFrame === 2 ? source.translationFrame : 0,
    textFormat: source.textFormat === 'clustal' || source.textFormat === 'consensus' || source.textFormat === 'json'
      ? source.textFormat
      : 'fasta',
    showOverview: visible('showOverview'),
    showAlignmentAxis: visible('showAlignmentAxis'),
    showTemplateAxis: visible('showTemplateAxis'),
    showRowStats: visible('showRowStats'),
    showConservation: visible('showConservation'),
    showConservationHistogram: visible('showConservationHistogram'),
    showOccupancy: optional('showOccupancy'),
    showConsensus: visible('showConsensus'),
    showSequenceLogo: optional('showSequenceLogo'),
    showTranslation: optional('showTranslation'),
    showAminoAcidIndices: visible('showAminoAcidIndices'),
  };
}
