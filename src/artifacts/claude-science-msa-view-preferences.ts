export type ClaudeScienceMsaTextFormat = 'fasta' | 'clustal' | 'consensus' | 'json';
export type ClaudeScienceMsaDisplayMode = 'viewer' | 'trace' | 'text';
export type ClaudeScienceMsaEmphasisMode = 'differences' | 'letters';
export type ClaudeScienceMsaColorMode = 'mono' | 'residue';
export type ClaudeScienceMsaRowSortMode = 'original' | 'name' | 'identity' | 'mismatches';

export type ClaudeScienceMsaViewPreferences = {
  displayMode: ClaudeScienceMsaDisplayMode;
  emphasis: ClaudeScienceMsaEmphasisMode;
  colorMode: ClaudeScienceMsaColorMode;
  sortMode: ClaudeScienceMsaRowSortMode;
  fontSize: number;
  textFormat: ClaudeScienceMsaTextFormat;
  showOverview: boolean;
  showAlignmentAxis: boolean;
  showTemplateAxis: boolean;
  showRowStats: boolean;
  showConservation: boolean;
  showConsensus: boolean;
};

export const DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES: ClaudeScienceMsaViewPreferences = {
  displayMode: 'viewer',
  emphasis: 'differences',
  colorMode: 'mono',
  sortMode: 'original',
  fontSize: 11,
  textFormat: 'fasta',
  showOverview: true,
  showAlignmentAxis: true,
  showTemplateAxis: true,
  showRowStats: true,
  showConservation: true,
  showConsensus: true,
};

export function normalizeClaudeScienceMsaViewPreferences(value: unknown): ClaudeScienceMsaViewPreferences {
  const source = value && typeof value === 'object'
    ? value as Partial<Record<keyof ClaudeScienceMsaViewPreferences, unknown>>
    : {};
  const visible = (key: keyof Pick<ClaudeScienceMsaViewPreferences,
    'showOverview' | 'showAlignmentAxis' | 'showTemplateAxis' | 'showRowStats' | 'showConservation' | 'showConsensus'>) => (
    typeof source[key] === 'boolean' ? source[key] : true
  );
  return {
    displayMode: source.displayMode === 'trace' || source.displayMode === 'text' ? source.displayMode : 'viewer',
    emphasis: source.emphasis === 'letters' ? 'letters' : 'differences',
    colorMode: source.colorMode === 'residue' ? 'residue' : 'mono',
    sortMode: source.sortMode === 'name' || source.sortMode === 'identity' || source.sortMode === 'mismatches'
      ? source.sortMode
      : 'original',
    fontSize: Number.isFinite(source.fontSize)
      ? Math.max(9, Math.min(16, Math.round(source.fontSize as number)))
      : DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES.fontSize,
    textFormat: source.textFormat === 'clustal' || source.textFormat === 'consensus' || source.textFormat === 'json'
      ? source.textFormat
      : 'fasta',
    showOverview: visible('showOverview'),
    showAlignmentAxis: visible('showAlignmentAxis'),
    showTemplateAxis: visible('showTemplateAxis'),
    showRowStats: visible('showRowStats'),
    showConservation: visible('showConservation'),
    showConsensus: visible('showConsensus'),
  };
}
