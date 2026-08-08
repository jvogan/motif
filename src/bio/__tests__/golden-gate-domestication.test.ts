import { describe, expect, it } from 'vitest';
import { reverseComplement } from '../reverse-complement';
import {
  domesticate,
  domesticateGoldenGateFeature,
  domesticateLegacyProjection,
  GOLDEN_GATE_LEGACY_PROJECTION_WARNING,
  GoldenGateLegacyDomesticationError,
} from '../golden-gate';

const CDS_WITH_BSAI_SITE = 'ATGGGTCTCGAATAA';

describe('feature-aware Golden Gate domestication', () => {
  it('fails closed when the deprecated wrapper lacks authoritative frame/table context', () => {
    expect(() => domesticate(CDS_WITH_BSAI_SITE, 'BsaI')).toThrow(GoldenGateLegacyDomesticationError);
    const explicit = domesticate(CDS_WITH_BSAI_SITE, 'BsaI', {
      feature: { start: 0, end: CDS_WITH_BSAI_SITE.length, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 1,
    });
    expect(explicit).toMatchObject({
      sequence: expect.any(String),
      complete: expect.any(Boolean),
      failures: expect.any(Array),
      remainingSites: expect.any(Array),
      introducedSites: expect.any(Array),
      sourceProtein: expect.any(String),
      productProtein: expect.any(String),
      proteinIdentity: expect.any(Boolean),
    });
  });

  it('exposes the old narrow payload only through a named deprecated projection with a warning', () => {
    const projection = domesticateLegacyProjection(CDS_WITH_BSAI_SITE, 'BsaI', {
      feature: { start: 0, end: CDS_WITH_BSAI_SITE.length, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 1,
    });

    expect(projection).toMatchObject({
      sequence: expect.any(String),
      mutations: expect.any(Array),
      warning: GOLDEN_GATE_LEGACY_PROJECTION_WARNING,
      deprecated: true,
    });
    expect(projection).not.toHaveProperty('complete');
  });

  it('removes a forbidden site while preserving a mapped CDS protein and structural flanks', () => {
    const sequence = `TTTT${CDS_WITH_BSAI_SITE}AAAA`;
    const result = domesticateGoldenGateFeature({
      sequence,
      feature: { start: 4, end: 4 + CDS_WITH_BSAI_SITE.length, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(true);
    expect(result.remainingSites).toEqual([]);
    expect(result.introducedSites).toEqual([]);
    expect(result.proteinIdentity).toBe(true);
    expect(result.sequence.slice(0, 4)).toBe('TTTT');
    expect(result.sequence.slice(-4)).toBe('AAAA');
    expect(result.mutations.every((mutation) => mutation.position >= 4 && mutation.position < 4 + CDS_WITH_BSAI_SITE.length)).toBe(true);
  });

  it('uses transl_except identity semantics while choosing synonymous domestication changes', () => {
    const result = domesticateGoldenGateFeature({
      sequence: CDS_WITH_BSAI_SITE,
      feature: {
        start: 0,
        end: CDS_WITH_BSAI_SITE.length,
        strand: 1,
        type: 'cds',
        metadata: { transl_except: '(pos:4..6,aa:Sec)' },
      },
      codonStart: 1,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(true);
    expect(result.remainingSites).toEqual([]);
    expect(result.proteinIdentity).toBe(true);
    expect(result.sourceProtein).toBe('MULE*');
    expect(result.productProtein).toBe('MULE*');
    expect(result.translationReceipt).toMatchObject({
      rawQualifier: '(pos:4..6,aa:Sec)',
      codonStart: 1,
    });
  });

  it('surfaces malformed transl_except entries as typed domestication diagnostics', () => {
    const result = domesticateGoldenGateFeature({
      sequence: CDS_WITH_BSAI_SITE,
      feature: {
        start: 0,
        end: CDS_WITH_BSAI_SITE.length,
        strand: 1,
        type: 'cds',
        metadata: { transl_except: '(pos:4..5,aa:Sec)' },
      },
      codonStart: 1,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(false);
    expect(result.failures).toContainEqual(expect.objectContaining({
      code: 'invalid_translation_exception',
      diagnostics: [expect.objectContaining({ code: 'not_codon' })],
    }));
  });

  it('maps reverse-strand CDS mutations back to source coordinates', () => {
    const sequence = reverseComplement(CDS_WITH_BSAI_SITE);
    const result = domesticateGoldenGateFeature({
      sequence,
      feature: { start: 0, end: sequence.length, strand: -1, type: 'cds' },
      codonStart: 1,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(true);
    expect(result.proteinIdentity).toBe(true);
    expect(result.mutations.every((mutation) => mutation.position >= 0 && mutation.position < sequence.length)).toBe(true);
  });

  it('concatenates authoritative multipart subRanges in biological order', () => {
    const split = 6;
    const result = domesticateGoldenGateFeature({
      sequence: `${CDS_WITH_BSAI_SITE.slice(0, split)}NNNN${CDS_WITH_BSAI_SITE.slice(split)}`,
      feature: {
        start: 0,
        end: CDS_WITH_BSAI_SITE.length + 4,
        strand: 1,
        type: 'cds',
        subRanges: [
          { start: 0, end: split, strand: 1 },
          { start: split + 4, end: split + 4 + CDS_WITH_BSAI_SITE.length - split, strand: 1 },
        ],
      },
      codonStart: 1,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(true);
    expect(result.proteinIdentity).toBe(true);
    expect(result.sequence.slice(split, split + 4)).toBe('NNNN');
  });

  it('honors codon_start and the selected nonstandard translation table', () => {
    const frameShifted = `A${CDS_WITH_BSAI_SITE}`;
    const frameResult = domesticateGoldenGateFeature({
      sequence: frameShifted,
      feature: { start: 0, end: frameShifted.length, strand: 1, type: 'cds' },
      codonStart: 2,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });
    expect(frameResult.complete).toBe(true);
    expect(frameResult.proteinIdentity).toBe(true);

    const mitochondrial = domesticateGoldenGateFeature({
      sequence: 'ATGTGAGGT',
      feature: { start: 0, end: 9, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 2,
    });
    expect(mitochondrial.complete).toBe(true);
    expect(mitochondrial.sourceProtein).toBe('MWG');
    expect(mitochondrial.productProtein).toBe('MWG');
  });

  it('does not hide a forbidden site in the codon_start-excluded leading base', () => {
    const result = domesticateGoldenGateFeature({
      sequence: 'GGTCTCCCGG',
      feature: { start: 0, end: 10, strand: 1, type: 'cds' },
      codonStart: 2,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(false);
    expect(result.remainingSites).toEqual(expect.arrayContaining([
      expect.objectContaining({ enzyme: 'BsaI', position: 0 }),
    ]));
    expect(result.failures.map((failure) => failure.code)).toContain('remaining_forbidden_site');
    expect(result.failures.map((failure) => failure.code)).toContain('unmodifiable_authoritative_site');
    expect(result.authoritativeScope).toBe('feature');
    expect(result.authoritativeBaseCount).toBe(10);
    expect(result.translatedBaseRange).toEqual({ start: 1, end: 10 });
  });

  it('keeps reverse-strand codon_start-excluded sites in source coordinates', () => {
    const oriented = 'GGTCTCCCGG';
    const sequence = reverseComplement(oriented);
    const result = domesticateGoldenGateFeature({
      sequence,
      feature: { start: 0, end: sequence.length, strand: -1, type: 'cds' },
      codonStart: 2,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(false);
    expect(result.remainingSites).toEqual(expect.arrayContaining([
      expect.objectContaining({ featurePosition: 0, position: 4, enzyme: 'BsaI' }),
    ]));
    expect(result.proteinIdentity).toBe(true);
  });

  it('does not invent a restriction site across a multipart genomic gap', () => {
    const left = 'ATGAAA';
    const gap = 'GGTCTC';
    const right = 'GGGCCC';
    const sequence = `${left}${gap}${right}`;
    const result = domesticateGoldenGateFeature({
      sequence,
      feature: {
        start: 0,
        end: sequence.length,
        strand: 1,
        type: 'cds',
        subRanges: [
          { start: 0, end: left.length, strand: 1 },
          { start: left.length + gap.length, end: sequence.length, strand: 1 },
        ],
      },
      codonStart: 1,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(true);
    expect(result.remainingSites).toEqual([]);
    expect(result.sequence.slice(left.length, left.length + gap.length)).toBe(gap);
    expect(result.translatedBaseRange).toEqual({ start: 0, end: left.length + right.length });
  });

  it('keeps a forbidden site at the trailing authoritative feature boundary', () => {
    const result = domesticateGoldenGateFeature({
      sequence: 'ATGAAAATG',
      feature: { start: 0, end: 9, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 1,
      forbiddenSites: ['ATG'],
    });

    expect(result.complete).toBe(false);
    expect(result.remainingSites.map((site) => site.position)).toEqual([0, 6]);
    expect(result.failures.filter((failure) => failure.code === 'remaining_forbidden_site')).toHaveLength(2);
  });

  it('ignores forbidden sites outside the feature scope while preserving structural flanks', () => {
    const prefix = 'GGTCTC';
    const insert = CDS_WITH_BSAI_SITE;
    const suffix = 'GGTCTC';
    const sequence = `${prefix}${insert}${suffix}`;
    const result = domesticateGoldenGateFeature({
      sequence,
      feature: { start: prefix.length, end: prefix.length + insert.length, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 1,
      forbiddenEnzymes: ['BsaI'],
    });

    expect(result.complete).toBe(true);
    expect(result.sequence.slice(0, prefix.length)).toBe(prefix);
    expect(result.sequence.slice(-suffix.length)).toBe(suffix);
    expect(result.remainingSites).toEqual([]);
    expect(result.authoritativeBaseCount).toBe(insert.length);
  });

  it('reports a newly introduced forbidden site separately from the original site', () => {
    const result = domesticateGoldenGateFeature({
      sequence: 'AAGGTTTCA',
      feature: { start: 0, end: 9, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 1,
      forbiddenSites: ['GGTCTC', 'AAA'],
    });

    expect(result.complete).toBe(false);
    expect(result.introducedSites).toEqual(expect.arrayContaining([
      expect.objectContaining({ motif: 'AAA', position: 0 }),
    ]));
    expect(result.failures.map((failure) => failure.code)).toContain('introduced_forbidden_site');
    expect(result.failures.map((failure) => failure.code)).toContain('remaining_forbidden_site');
  });

  it('returns typed failures for an unchangeable forbidden site and unsupported table', () => {
    const result = domesticateGoldenGateFeature({
      sequence: 'ATGGGTCTCGAATAA',
      feature: { start: 0, end: 15, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 999,
      forbiddenSites: ['ATG'],
    });
    expect(result.complete).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain('unsupported_translation_table');

    const unchangeable = domesticateGoldenGateFeature({
      sequence: 'ATG',
      feature: { start: 0, end: 3, strand: 1, type: 'cds' },
      codonStart: 1,
      translationTableId: 1,
      forbiddenSites: ['ATG'],
    });
    expect(unchangeable.failures.map((failure) => failure.code)).toContain('no_synonymous_change');
    expect(unchangeable.failures.map((failure) => failure.code)).toContain('remaining_forbidden_site');
  });
});
