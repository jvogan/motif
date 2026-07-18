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

  it('preserves valid presentation, colour, and track choices', () => {
    expect(normalizeClaudeScienceMsaViewPreferences({
      displayMode: 'text',
      emphasis: 'letters',
      colorMode: 'residue',
      colorScheme: 'clustal',
      shadeMode: 'conservation',
      sortMode: 'mismatches',
      fontSize: 14,
      zoom: 1.5,
      translationFrame: 2,
      textFormat: 'json',
      showOverview: false,
      showAlignmentAxis: false,
      showTemplateAxis: true,
      showRowStats: false,
      showConservation: true,
      showConservationHistogram: false,
      showOccupancy: true,
      showConsensus: false,
      showTranslation: true,
      showAminoAcidIndices: false,
    })).toEqual({
      displayMode: 'text',
      emphasis: 'letters',
      colorMode: 'residue',
      colorScheme: 'clustal',
      shadeMode: 'conservation',
      sortMode: 'mismatches',
      fontSize: 14,
      zoom: 1.5,
      translationFrame: 2,
      textFormat: 'json',
      showOverview: false,
      showAlignmentAxis: false,
      showTemplateAxis: true,
      showRowStats: false,
      showConservation: true,
      showConservationHistogram: false,
      showOccupancy: true,
      showConsensus: false,
      showTranslation: true,
      showAminoAcidIndices: false,
    });
  });

  it('clamps font size and defaults invalid values without hiding default-on tracks', () => {
    const normalized = normalizeClaudeScienceMsaViewPreferences({
      displayMode: 'unknown',
      fontSize: 400,
      showOverview: 'false',
      showConsensus: 0,
      showConservationHistogram: 'nope',
    });
    expect(normalized.displayMode).toBe('viewer');
    expect(normalized.fontSize).toBe(16);
    expect(normalized.showOverview).toBe(true);
    expect(normalized.showConsensus).toBe(true);
    expect(normalized.showConservationHistogram).toBe(true);
  });

  it('defaults and clamps the column zoom preference', () => {
    expect(normalizeClaudeScienceMsaViewPreferences({}).zoom).toBe(1);
    expect(normalizeClaudeScienceMsaViewPreferences({ zoom: 'big' }).zoom).toBe(1);
    expect(normalizeClaudeScienceMsaViewPreferences({ zoom: 9 }).zoom).toBe(2);
    expect(normalizeClaudeScienceMsaViewPreferences({ zoom: 0 }).zoom).toBe(0.2);
    expect(normalizeClaudeScienceMsaViewPreferences({ zoom: 0.5 }).zoom).toBe(0.5);
  });

  it('keeps the translation track opt-in, indices default-on, and frame strict', () => {
    const defaults = normalizeClaudeScienceMsaViewPreferences({});
    expect(defaults.showTranslation).toBe(false);
    expect(defaults.showAminoAcidIndices).toBe(true);
    expect(defaults.translationFrame).toBe(0);
    expect(normalizeClaudeScienceMsaViewPreferences({ showTranslation: 'yes' }).showTranslation).toBe(false);
    expect(normalizeClaudeScienceMsaViewPreferences({ showTranslation: true }).showTranslation).toBe(true);
    expect(normalizeClaudeScienceMsaViewPreferences({ showAminoAcidIndices: false }).showAminoAcidIndices).toBe(false);
    expect(normalizeClaudeScienceMsaViewPreferences({ translationFrame: 2 }).translationFrame).toBe(2);
    expect(normalizeClaudeScienceMsaViewPreferences({ translationFrame: 5 }).translationFrame).toBe(0);
  });

  it('falls back to safe colour/shade defaults and keeps occupancy opt-in', () => {
    const normalized = normalizeClaudeScienceMsaViewPreferences({
      colorScheme: 'rainbow',
      shadeMode: 'sparkles',
      showOccupancy: 'yes',
    });
    expect(normalized.colorScheme).toBe('auto');
    expect(normalized.shadeMode).toBe('none');
    // showOccupancy only turns on for a literal true, so a truthy string stays off.
    expect(normalized.showOccupancy).toBe(false);
    expect(normalizeClaudeScienceMsaViewPreferences({ showOccupancy: true }).showOccupancy).toBe(true);
    expect(normalizeClaudeScienceMsaViewPreferences({ colorScheme: 'hydrophobicity' }).colorScheme).toBe('hydrophobicity');
    expect(normalizeClaudeScienceMsaViewPreferences({ shadeMode: 'mismatch' }).shadeMode).toBe('mismatch');
  });
});
