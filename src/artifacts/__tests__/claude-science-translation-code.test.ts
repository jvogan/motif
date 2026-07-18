import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_TRANSLATION_CODE_OPTIONS,
  DEFAULT_ARTIFACT_TRANSLATION_TABLE_ID,
  artifactFeatureTranslationTableValue,
  artifactTranslationCodeLabel,
  isSupportedArtifactTranslationTableId,
  normalizeArtifactTranslationTableId,
  resolveArtifactTranslationCode,
} from '../claude-science-translation-code';

const SUPPORTED_NCBI_TABLE_IDS = [
  1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 21, 22, 23, 24, 25, 26,
  29, 30, 32, 33,
];

describe('artifact translation-code resolution', () => {
  it('exposes a frozen, sorted set of supported portable options', () => {
    expect(ARTIFACT_TRANSLATION_CODE_OPTIONS.map(({ id }) => id)).toEqual(
      SUPPORTED_NCBI_TABLE_IDS,
    );
    expect(ARTIFACT_TRANSLATION_CODE_OPTIONS).toEqual(expect.arrayContaining([
      { id: 15, name: 'Blepharisma Macronuclear' },
      { id: 32, name: 'Balanophoraceae Plastid' },
    ]));
    expect(Object.isFrozen(ARTIFACT_TRANSLATION_CODE_OPTIONS)).toBe(true);
    expect(ARTIFACT_TRANSLATION_CODE_OPTIONS.every((option) => Object.isFrozen(option))).toBe(true);
  });

  it('uses NCBI table 1 only when neither record nor feature selects a table', () => {
    expect(DEFAULT_ARTIFACT_TRANSLATION_TABLE_ID).toBe(1);
    expect(resolveArtifactTranslationCode(undefined)).toMatchObject({
      supported: true,
      id: 1,
      name: 'Standard',
      source: 'default',
    });
    expect(resolveArtifactTranslationCode(null, {})).toMatchObject({
      supported: true,
      id: 1,
      source: 'default',
    });
  });

  it('gives an explicit feature qualifier precedence over the record table', () => {
    expect(resolveArtifactTranslationCode(11, { transl_table: ' 2 ' })).toMatchObject({
      supported: true,
      id: 2,
      name: 'Vertebrate Mitochondrial',
      source: 'feature',
    });
    expect(resolveArtifactTranslationCode(11, {})).toMatchObject({
      supported: true,
      id: 11,
      source: 'record',
    });
  });

  it('fails closed on explicit unsupported or malformed feature qualifiers', () => {
    expect(resolveArtifactTranslationCode(2, { transl_table: 27 })).toMatchObject({
      supported: false,
      id: null,
      requestedId: 27,
      source: 'feature',
    });
    expect(resolveArtifactTranslationCode(2, { transl_table: 'not-a-table' })).toMatchObject({
      supported: false,
      id: null,
      requestedId: null,
      source: 'feature',
    });
  });

  it('fails closed on an explicit unsupported or malformed record table', () => {
    expect(resolveArtifactTranslationCode(31)).toMatchObject({
      supported: false,
      requestedId: 31,
      source: 'record',
    });
    expect(resolveArtifactTranslationCode('not-a-table')).toMatchObject({
      supported: false,
      requestedId: null,
      source: 'record',
    });
  });

  it('normalizes supported ids without admitting context-dependent or custom ids', () => {
    expect(normalizeArtifactTranslationTableId(' 32 ')).toBe(32);
    expect(isSupportedArtifactTranslationTableId(15)).toBe(true);
    expect(normalizeArtifactTranslationTableId(27)).toBeNull();
    expect(normalizeArtifactTranslationTableId(1.5)).toBeNull();
    expect(normalizeArtifactTranslationTableId(1000)).toBeNull();
  });

  it('keeps inherit, unsupported, and malformed control values distinct', () => {
    expect(artifactFeatureTranslationTableValue(undefined)).toBe('');
    expect(artifactFeatureTranslationTableValue({})).toBe('');
    expect(artifactFeatureTranslationTableValue({ transl_table: ' 11 ' })).toBe('11');
    expect(artifactFeatureTranslationTableValue({ transl_table: 27 })).toBe('27');
    expect(artifactFeatureTranslationTableValue({ transl_table: 'invalid' })).toBe('__invalid__');
    expect(artifactFeatureTranslationTableValue({ transl_table: 1.5 })).toBe('__invalid__');
  });

  it('formats supported codes with their portable NCBI identity', () => {
    const resolution = resolveArtifactTranslationCode(15);
    expect(resolution.supported).toBe(true);
    if (!resolution.supported) throw new Error(resolution.message);
    expect(artifactTranslationCodeLabel(resolution)).toBe(
      'NCBI table 15 — Blepharisma Macronuclear',
    );
  });
});
