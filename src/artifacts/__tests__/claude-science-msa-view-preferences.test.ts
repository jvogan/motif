import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  normalizeClaudeScienceMsaViewPreferences,
} from '../claude-science-msa-view-preferences';

describe('Claude Science MSA view preferences', () => {
  it('restores complete defaults for missing or malformed state', () => {
    expect(normalizeClaudeScienceMsaViewPreferences(null)).toEqual(DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES);
    expect(normalizeClaudeScienceMsaViewPreferences('broken')).toEqual(DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES);
  });

  it('preserves valid presentation and track choices', () => {
    expect(normalizeClaudeScienceMsaViewPreferences({
      displayMode: 'text',
      emphasis: 'letters',
      colorMode: 'residue',
      sortMode: 'mismatches',
      fontSize: 14,
      textFormat: 'json',
      showOverview: false,
      showAlignmentAxis: false,
      showTemplateAxis: true,
      showRowStats: false,
      showConservation: true,
      showConsensus: false,
    })).toEqual({
      displayMode: 'text',
      emphasis: 'letters',
      colorMode: 'residue',
      sortMode: 'mismatches',
      fontSize: 14,
      textFormat: 'json',
      showOverview: false,
      showAlignmentAxis: false,
      showTemplateAxis: true,
      showRowStats: false,
      showConservation: true,
      showConsensus: false,
    });
  });

  it('clamps font size and defaults invalid values without hiding tracks', () => {
    const normalized = normalizeClaudeScienceMsaViewPreferences({
      displayMode: 'unknown',
      fontSize: 400,
      showOverview: 'false',
      showConsensus: 0,
    });
    expect(normalized.displayMode).toBe('viewer');
    expect(normalized.fontSize).toBe(16);
    expect(normalized.showOverview).toBe(true);
    expect(normalized.showConsensus).toBe(true);
  });
});
