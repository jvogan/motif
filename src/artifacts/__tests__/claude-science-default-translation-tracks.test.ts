import { describe, expect, it } from 'vitest';
import { drawsDefaultTranslationTrack } from '../motif-artifact';
import { MOLD_PROTOZOAN_MITO_CODE, STANDARD_CODE } from '../../bio/codon-tables';
import { reverseComplement } from '../../bio/reverse-complement';
import type { Feature } from '../../bio/types';

function feature(type: Feature['type'], start: number, end: number, strand: 1 | -1 = 1, metadata: Record<string, unknown> = {}): Feature {
  return { id: type, name: type, type, start, end, strand, color: '#000000', metadata };
}

function draws(sequence: string, candidate: Feature, table = STANDARD_CODE) {
  return drawsDefaultTranslationTrack(candidate, sequence, 'dna', 'linear', table);
}

// CC | GTG AAA CCC GGG TGA | CC — a rop-like gene: GTG start, one stop, last.
const CLEAN = 'CCGTGAAACCCGGGTGACC';

describe('which features draw a default translation track', () => {
  it('keeps a gene that reads as one open frame ending on its only stop', () => {
    expect(draws(CLEAN, feature('gene', 2, 17))).toBe(true);
    expect(draws(reverseComplement(CLEAN), feature('gene', 2, 17, -1))).toBe(true);
    expect(draws(CLEAN, feature('gene', 1, 17, 1, { codon_start: 2 }))).toBe(true);
  });

  it('drops an exon that starts in the UTR and reads a stop before its last codon', () => {
    // CCC ATG TAA AGC ATG AAA TGA: whole codons and a stop last, but TAA at codon 3.
    expect(draws('CCCATGTAAAGCATGAAATGA', feature('exon', 0, 21))).toBe(false);
  });

  it('drops a noncoding gene whose frame reads no stop at all', () => {
    // GGC AGC AAA GGC CTG: an RMRP-like RNA gene, open in frame 0 but never stopped.
    expect(draws('GGCAGCAAAGGCCTG', feature('gene', 0, 15))).toBe(false);
  });

  it('drops a gene with a partial end, or that is not whole codons', () => {
    expect(draws(CLEAN, feature('gene', 2, 17, 1, { motifOriginalLocation: '<3..17' }))).toBe(false);
    expect(draws(CLEAN, feature('gene', 2, 17, 1, { motifOriginalLocation: '3..>17' }))).toBe(false);
    expect(draws(CLEAN, feature('gene', 2, 17, 1, { partial: true }))).toBe(false);
    expect(draws(CLEAN, feature('gene', 1, 17))).toBe(false);
  });

  it("reads the stop in the record's code", () => {
    // TGA is tryptophan in the mold mitochondrial code, so the frame never stops.
    expect(draws(CLEAN, feature('gene', 2, 17), MOLD_PROTOZOAN_MITO_CODE)).toBe(false);
  });

  it('always keeps a CDS, ORF, marker or peptide, and never a noncoding type', () => {
    const readsStops = 'TAATAGTGATAA';
    for (const type of ['cds', 'orf', 'resistance', 'sig_peptide', 'mat_peptide', 'transit_peptide'] as const) {
      expect(draws(readsStops, feature(type, 0, 12))).toBe(true);
    }
    for (const type of ['ncRNA', 'mRNA', 'promoter', 'misc_feature'] as const) {
      expect(draws(CLEAN, feature(type, 2, 17))).toBe(false);
    }
  });

  it('draws nothing for a feature with no strand', () => {
    expect(draws(CLEAN, { ...feature('cds', 2, 17), strand: 0 })).toBe(false);
    expect(draws(CLEAN, { ...feature('gene', 2, 17), strand: 0 })).toBe(false);
  });
});
