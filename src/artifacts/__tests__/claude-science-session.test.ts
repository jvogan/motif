import { describe, expect, it } from 'vitest';
import {
  MOTIF_INVENTORY_SCHEMA,
  MOTIF_INVENTORY_SCHEMA_V1,
  MAX_ARTIFACT_DATABASE_JSON_CHARACTERS,
  MAX_CUSTOM_ENZYMES,
  MAX_CUSTOM_ENZYME_NAME_LENGTH,
  MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH,
  MAX_HIDDEN_ENZYMES_PER_RECORD,
  MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD,
  MAX_MOTIF_LENGTH,
  MAX_TRANSLATION_LAYER_TEXT_LENGTH,
  MAX_TRANSLATION_LAYERS_PER_RECORD,
  assertArtifactJsonCharacterCount,
  normalizeArtifactDurableState,
  parseArtifactDatabaseJson,
  parseArtifactRecordJson,
} from '../claude-science-session';

describe('Claude Science durable session validation', () => {
  const recordLengths = new Map([['record-a', 120]]);

  it('recognizes exported database JSON without treating ordinary sequence text as JSON', () => {
    expect(parseArtifactDatabaseJson('GAATTC')).toBeNull();
    expect(parseArtifactDatabaseJson('{"schema":"motif.test","records":[]}')).toMatchObject({
      schema: 'motif.test',
      records: [],
    });
    expect(() => parseArtifactDatabaseJson('{"records":')).toThrow(/could not be parsed/i);
    expect(() => assertArtifactJsonCharacterCount(MAX_ARTIFACT_DATABASE_JSON_CHARACTERS + 1))
      .toThrow(/maximum of 128 MiB/i);
  });

  it('keeps the Database JSON ceiling large enough for bounded pretty-printed AB1 workspaces', () => {
    expect(MAX_ARTIFACT_DATABASE_JSON_CHARACTERS).toBe(128 * 1024 * 1024);
    expect(() => assertArtifactJsonCharacterCount(MAX_ARTIFACT_DATABASE_JSON_CHARACTERS)).not.toThrow();
    expect(() => assertArtifactJsonCharacterCount(-1)).toThrow(/non-negative safe integer/i);
  });

  it('recognizes a bare Record JSON export without treating it as a workspace restore', () => {
    const recordJson = JSON.stringify({
      id: 'trace-01',
      name: 'Trace 01',
      molecule: 'dna',
      topology: 'linear',
      seq: 'ACGT',
      annotations: [],
    });

    expect(parseArtifactDatabaseJson(recordJson)).toBeNull();
    expect(parseArtifactRecordJson(recordJson)).toMatchObject({
      id: 'trace-01',
      molecule: 'dna',
      seq: 'ACGT',
    });
    expect(parseArtifactRecordJson('{"name":"metadata only"}')).toBeNull();
    expect(parseArtifactRecordJson('{"records":[]}')).toBeNull();
    expect(parseArtifactRecordJson('>record\nACGT')).toBeNull();
  });

  it('accepts inventory.v1/v2 and legacy envelopes while rejecting malformed or unsupported known schemas', () => {
    expect(parseArtifactDatabaseJson(JSON.stringify({
      schema: MOTIF_INVENTORY_SCHEMA,
      records: [],
    }))).toMatchObject({ schema: MOTIF_INVENTORY_SCHEMA, records: [] });
    expect(parseArtifactDatabaseJson('{"records":[]}')).toEqual({ records: [] });
    expect(parseArtifactDatabaseJson(JSON.stringify({
      schema: MOTIF_INVENTORY_SCHEMA_V1,
      records: [],
    }))).toMatchObject({ schema: MOTIF_INVENTORY_SCHEMA_V1, records: [] });
    expect(() => parseArtifactDatabaseJson('{"schema":42,"records":[]}')).toThrow(/schema must be a non-empty string/i);
    expect(() => parseArtifactDatabaseJson(JSON.stringify({
      schema: 'motif.claude-science.inventory.v3',
      records: [],
    }))).toThrow(/unsupported Motif inventory schema/i);
    expect(() => parseArtifactDatabaseJson(JSON.stringify({
      schema: MOTIF_INVENTORY_SCHEMA,
    }))).toThrow(/must contain a records array/i);
    expect(() => parseArtifactDatabaseJson('{"records":{}}')).toThrow(/must contain a records array/i);
  });

  it('restores validated custom enzymes and translation layers', () => {
    expect(normalizeArtifactDurableState({
      customEnzymes: [{
        name: 'MyI',
        recognitionSequence: 'GGTCTC',
        cutOffset: 7,
        complementCutOffset: 11,
        overhang: '5prime',
      }],
      translationLayersByRecord: {
        'record-a': [{
          id: 'translation',
          label: 'Selected CDS',
          start: 3,
          end: 90,
          strand: 1,
          frame: 0,
          translationTableId: 2,
          completeCds: true,
          featureId: 'cds-1',
          source: 'layer',
          color: '#3399cc',
        }],
      },
      enzymeSourcesByRecord: { 'record-a': ['common', 'golden-gate-type-iis'] },
      hiddenEnzymesByRecord: { 'record-a': ['EcoRI'] },
      hiddenFeatureTranslationsByRecord: { 'record-a': ['feat:hidden'] },
      restrictionLabelsByRecord: { 'record-a': true },
      motifsByRecord: { 'record-a': 'GAATTC' },
    }, recordLengths)).toEqual({
      customEnzymes: [{
        name: 'MyI',
        recognitionSequence: 'GGTCTC',
        cutOffset: 7,
        complementCutOffset: 11,
        overhang: '5prime',
      }],
      translationLayersByRecord: {
        'record-a': [{
          id: 'translation',
          label: 'Selected CDS',
          start: 3,
          end: 90,
          strand: 1,
          frame: 0,
          translationTableId: 2,
          completeCds: true,
          featureId: 'cds-1',
          source: 'layer',
          color: '#3399cc',
        }],
      },
      enzymeSourcesByRecord: { 'record-a': ['common', 'golden-gate-type-iis'] },
      hiddenEnzymesByRecord: { 'record-a': ['EcoRI'] },
      hiddenFeatureTranslationsByRecord: { 'record-a': ['feat:hidden'] },
      restrictionLabelsByRecord: { 'record-a': true },
      motifsByRecord: { 'record-a': 'GAATTC' },
    });
  });

  it('rejects malformed nested session state instead of letting it reach React', () => {
    expect(() => normalizeArtifactDurableState({ customEnzymes: {} }, recordLengths)).toThrow(/must be an array/i);
    expect(() => normalizeArtifactDurableState({
      translationLayersByRecord: {
        'record-a': [{ id: 'bad', label: 'bad', start: 5, end: 500, strand: 1, frame: 0 }],
      },
    }, recordLengths)).toThrow(/valid 0-based/i);
    expect(() => normalizeArtifactDurableState({
      translationLayersByRecord: {
        'record-a': [{ id: 'bad-code', label: 'bad code', start: 5, end: 50, strand: 1, frame: 0, translationTableId: 27 }],
      },
    }, recordLengths)).toThrow(/supported NCBI genetic-code id/i);
    expect(() => normalizeArtifactDurableState({
      enzymeSourcesByRecord: { 'record-a': ['not-a-source'] },
    }, recordLengths)).toThrow(/unknown source/i);
  });

  it('deduplicates restored layer ids deterministically', () => {
    const state = normalizeArtifactDurableState({
      translationLayersByRecord: {
        'record-a': [
          { id: 'track', label: 'A', start: 0, end: 3, strand: 1, frame: 0 },
          { id: 'track', label: 'B', start: 3, end: 6, strand: 1, frame: 0 },
        ],
      },
    }, recordLengths);
    expect(state.translationLayersByRecord['record-a'].map((track) => track.id)).toEqual(['track', 'track-2']);
    expect(state.translationLayersByRecord['record-a'].map((track) => track.translationTableId)).toEqual([1, 1]);
  });

  it('canonicalizes legacy layer codes once while preserving explicit codes', () => {
    const value = {
      translationLayersByRecord: {
        'record-a': [
          { id: 'legacy', label: 'Legacy Standard track', start: 0, end: 3, strand: 1, frame: 0 },
          { id: 'mitochondrial', label: 'Mitochondrial track', start: 3, end: 6, strand: 1, frame: 0, translationTableId: 2 },
        ],
      },
    };

    const first = normalizeArtifactDurableState(value, recordLengths);
    const second = normalizeArtifactDurableState(JSON.parse(JSON.stringify(first)), recordLengths);

    expect(first.translationLayersByRecord['record-a'].map((track) => track.translationTableId)).toEqual([1, 2]);
    expect(second).toEqual(first);
  });

  it('round-trips the scientific-review flag on remapped translation layers', () => {
    const state = normalizeArtifactDurableState({
      translationLayersByRecord: {
        'record-a': [{
          id: 'track',
          label: 'Review me',
          start: 3,
          end: 30,
          strand: 1,
          frame: 0,
          needsReview: true,
        }],
      },
    }, recordLengths);

    expect(state.translationLayersByRecord['record-a'][0].needsReview).toBe(true);
    expect(() => normalizeArtifactDurableState({
      translationLayersByRecord: {
        'record-a': [{ id: 'track', label: 'Bad', start: 3, end: 30, strand: 1, frame: 0, needsReview: 'yes' }],
      },
    }, recordLengths)).toThrow(/needsReview must be a boolean/i);
  });

  it('keeps exact-boundary duplicate layer ids unique and stable across serialized normalization', () => {
    const exactBoundaryId = 't'.repeat(MAX_TRANSLATION_LAYER_TEXT_LENGTH);
    const value = {
      translationLayersByRecord: {
        'record-a': [
          { id: exactBoundaryId, label: 'A', start: 0, end: 3, strand: 1, frame: 0 },
          { id: exactBoundaryId, label: 'B', start: 3, end: 6, strand: 1, frame: 0 },
        ],
      },
    };

    const first = normalizeArtifactDurableState(value, recordLengths);
    const firstIds = first.translationLayersByRecord['record-a'].map((track) => track.id);
    const serialized = JSON.parse(JSON.stringify(first)) as unknown;
    const second = normalizeArtifactDurableState(serialized, recordLengths);
    const secondIds = second.translationLayersByRecord['record-a'].map((track) => track.id);

    expect(firstIds).toEqual([
      exactBoundaryId,
      `${'t'.repeat(MAX_TRANSLATION_LAYER_TEXT_LENGTH - 2)}-2`,
    ]);
    expect(new Set(firstIds)).toHaveLength(2);
    expect(firstIds.every((id) => id.length <= MAX_TRANSLATION_LAYER_TEXT_LENGTH)).toBe(true);
    expect(secondIds).toEqual(firstIds);
  });

  it('accepts the custom-enzyme count boundary and rejects one entry over it', () => {
    const customEnzyme = (index: number) => ({
      name: `Enzyme-${index}`,
      recognitionSequence: 'GAATTC',
      cutOffset: 1,
      complementCutOffset: 5,
      overhang: '5prime',
    });
    const exactBoundary = Array.from({ length: MAX_CUSTOM_ENZYMES }, (_, index) => customEnzyme(index));

    expect(normalizeArtifactDurableState({ customEnzymes: exactBoundary }, recordLengths).customEnzymes)
      .toHaveLength(MAX_CUSTOM_ENZYMES);
    expect(() => normalizeArtifactDurableState({
      customEnzymes: [...exactBoundary, customEnzyme(MAX_CUSTOM_ENZYMES)],
    }, recordLengths)).toThrow(new RegExp(`more than ${MAX_CUSTOM_ENZYMES} entries`, 'i'));
  });

  it('accepts exact custom-enzyme string boundaries and rejects overlong values', () => {
    const exactName = 'N'.repeat(MAX_CUSTOM_ENZYME_NAME_LENGTH);
    const exactRecognition = 'A'.repeat(MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH);
    const base = {
      name: exactName,
      recognitionSequence: exactRecognition,
      cutOffset: 1,
      complementCutOffset: 1,
      overhang: 'blunt',
    };

    expect(normalizeArtifactDurableState({ customEnzymes: [base] }, recordLengths).customEnzymes[0])
      .toMatchObject({ name: exactName, recognitionSequence: exactRecognition });
    expect(() => normalizeArtifactDurableState({
      customEnzymes: [{ ...base, name: `${exactName}N` }],
    }, recordLengths)).toThrow(new RegExp(`no longer than ${MAX_CUSTOM_ENZYME_NAME_LENGTH} characters`, 'i'));
    expect(() => normalizeArtifactDurableState({
      customEnzymes: [{ ...base, recognitionSequence: `${exactRecognition}A` }],
    }, recordLengths)).toThrow(new RegExp(`no longer than ${MAX_CUSTOM_ENZYME_RECOGNITION_LENGTH} characters`, 'i'));
  });

  it('accepts the translation-layer boundary and rejects one layer over it', () => {
    const translationLayer = (index: number) => ({
      id: `translation-${index}`,
      label: `Translation ${index}`,
      start: 0,
      end: 3,
      strand: 1,
      frame: 0,
    });
    const exactBoundary = Array.from(
      { length: MAX_TRANSLATION_LAYERS_PER_RECORD },
      (_, index) => translationLayer(index),
    );

    expect(normalizeArtifactDurableState({
      translationLayersByRecord: { 'record-a': exactBoundary },
    }, recordLengths).translationLayersByRecord['record-a']).toHaveLength(MAX_TRANSLATION_LAYERS_PER_RECORD);
    expect(() => normalizeArtifactDurableState({
      translationLayersByRecord: {
        'record-a': [...exactBoundary, translationLayer(MAX_TRANSLATION_LAYERS_PER_RECORD)],
      },
    }, recordLengths)).toThrow(new RegExp(`more than ${MAX_TRANSLATION_LAYERS_PER_RECORD} translation layers`, 'i'));
  });

  it('round-trips the hidden-feature boundary without truncation and rejects one id over it', () => {
    expect(MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD).toBe(2_000);
    const exactBoundary = Array.from(
      { length: MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD },
      (_, index) => `feature-${index}`,
    );

    expect(normalizeArtifactDurableState({
      hiddenFeatureTranslationsByRecord: { 'record-a': exactBoundary },
    }, recordLengths).hiddenFeatureTranslationsByRecord['record-a']).toEqual(exactBoundary);
    expect(() => normalizeArtifactDurableState({
      hiddenFeatureTranslationsByRecord: {
        'record-a': [...exactBoundary, `feature-${MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD}`],
      },
    }, recordLengths)).toThrow(
      new RegExp(`more than ${MAX_HIDDEN_FEATURE_TRANSLATIONS_PER_RECORD} entries`, 'i'),
    );
  });

  it('round-trips hidden restriction-enzyme visibility without truncation', () => {
    const exactBoundary = Array.from(
      { length: MAX_HIDDEN_ENZYMES_PER_RECORD },
      (_, index) => `Enzyme-${index}`,
    );

    expect(normalizeArtifactDurableState({
      hiddenEnzymesByRecord: { 'record-a': exactBoundary },
    }, recordLengths).hiddenEnzymesByRecord['record-a']).toEqual(exactBoundary);
    expect(() => normalizeArtifactDurableState({
      hiddenEnzymesByRecord: {
        'record-a': [...exactBoundary, 'OneTooManyI'],
      },
    }, recordLengths)).toThrow(new RegExp(`more than ${MAX_HIDDEN_ENZYMES_PER_RECORD} entries`, 'i'));
  });

  it('continues to trim, drop blank, and deduplicate hidden feature ids', () => {
    const state = normalizeArtifactDurableState({
      hiddenFeatureTranslationsByRecord: {
        'record-a': [' feature-a ', 'feature-a', '', '   ', ' feature-b '],
      },
    }, recordLengths);

    expect(state.hiddenFeatureTranslationsByRecord['record-a']).toEqual(['feature-a', 'feature-b']);
  });

  it('accepts the motif-length boundary and rejects one character over it', () => {
    const exactBoundary = 'A'.repeat(MAX_MOTIF_LENGTH);

    expect(normalizeArtifactDurableState({
      motifsByRecord: { 'record-a': exactBoundary },
    }, recordLengths).motifsByRecord['record-a']).toBe(exactBoundary);
    expect(() => normalizeArtifactDurableState({
      motifsByRecord: { 'record-a': `${exactBoundary}A` },
    }, recordLengths)).toThrow(new RegExp(`no longer than ${MAX_MOTIF_LENGTH} characters`, 'i'));
  });
});
