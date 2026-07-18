import { describe, expect, it } from 'vitest';
import { createDefensiveRuntimeSnapshot, normalizeRecord } from '../motif-artifact';
import { resolveArtifactTranslationCode } from '../claude-science-translation-code';

describe('artifact record genetic-code persistence', () => {
  it('normalizes and serializes an explicit nucleotide record code', () => {
    const record = normalizeRecord({
      id: 'mitochondrial-record',
      name: 'Mitochondrial record',
      molecule: 'dna',
      topology: 'linear',
      translationTableId: 2,
      seq: 'ATGATAAGATGATAG',
    }, 0);

    expect(record?.translationTableId).toBe(2);
    expect(createDefensiveRuntimeSnapshot([record!])[0].translationTableId).toBe(2);
  });

  it('keeps legacy omission portable while resolving it to the Standard code', () => {
    const record = normalizeRecord({
      id: 'legacy-record',
      name: 'Legacy record',
      molecule: 'dna',
      seq: 'ATGAAATAG',
    }, 0);

    expect(record?.translationTableId).toBeUndefined();
    expect(createDefensiveRuntimeSnapshot([record!])[0].translationTableId).toBeUndefined();
    expect(resolveArtifactTranslationCode(record?.translationTableId)).toMatchObject({
      supported: true,
      id: 1,
      source: 'default',
    });
  });

  it('rejects unsupported ids and nucleotide-only metadata on protein records', () => {
    expect(() => normalizeRecord({
      name: 'Unsupported code',
      molecule: 'dna',
      translationTableId: 27,
      seq: 'ATGAAATAG',
    }, 0)).toThrow(/supported NCBI genetic-code id/i);

    expect(() => normalizeRecord({
      name: 'Protein',
      molecule: 'protein',
      translationTableId: 2,
      seq: 'MKW',
    }, 0)).toThrow(/only valid on DNA and RNA/i);
  });
});
