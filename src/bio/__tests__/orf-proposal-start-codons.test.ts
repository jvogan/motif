import { describe, expect, it } from 'vitest';
import { findORFs } from '../orf-detection';
import { getTranslationTable } from '../codon-tables';
import {
  PROPOSED_ANNOTATION_CAPS,
  proposeDefaultAnnotations,
  proposedAnnotationStartCodons,
} from '../proposed-annotations';
import type { Feature } from '../types';

// An in-frame upstream CTG (an alternative Table 1 initiator that usually
// reads as Leu) followed by a canonical ATG ORF. GCC repeats carry no start or
// stop codon in any frame on either strand.
const UPSTREAM = `CTG${'GCC'.repeat(5)}`;
const ORF_BODY = `ATG${'GCC'.repeat(PROPOSED_ANNOTATION_CAPS.minOrfAminoAcids + 10)}TAA`;
const SEQUENCE = `${UPSTREAM}${ORF_BODY}${'GCC'.repeat(3)}`;

function record(sequence: string, translationTableId?: number) {
  return {
    sequence,
    type: 'dna' as const,
    topology: 'linear' as const,
    features: [] as Feature[],
    ...(translationTableId === undefined ? {} : { translationTableId }),
  };
}

describe('ORF proposal start codons', () => {
  it('keeps alternative table initiators available to the general ORF finder', () => {
    const starts = findORFs(SEQUENCE, 30).filter((orf) => orf.strand === 1).map((orf) => orf.startCodon);
    expect(starts).toEqual(['CTG', 'ATG']);
  });

  it('restricts the general ORF finder to explicitly requested initiators', () => {
    const orfs = findORFs(SEQUENCE, 30, undefined, { startCodons: ['ATG'] });
    expect(orfs.map((orf) => [orf.startCodon, orf.start])).toEqual([['ATG', UPSTREAM.length]]);
  });

  it('proposes annotations only from ATG starts by default', () => {
    const result = proposeDefaultAnnotations(record(SEQUENCE));
    expect(result.status).toBe('proposed');
    expect(result.features).toHaveLength(1);
    expect(result.features[0]).toMatchObject({ start: UPSTREAM.length, end: UPSTREAM.length + ORF_BODY.length, strand: 1 });
    expect(result.features[0].metadata.motifProposal).toMatchObject({ evidence: { startCodon: 'ATG' } });
  });

  it('does not propose an ORF that only a TTG or CTG start would open', () => {
    const leucineOnly = `TTG${'GCC'.repeat(PROPOSED_ANNOTATION_CAPS.minOrfAminoAcids + 10)}TAA`;
    const result = proposeDefaultAnnotations(record(leucineOnly));
    expect(result.features).toEqual([]);
  });

  it('derives the proposal initiators from the record genetic code', () => {
    expect(proposedAnnotationStartCodons(getTranslationTable(1))).toEqual(['ATG']);
    expect(proposedAnnotationStartCodons(getTranslationTable(11))).toEqual(['ATG', 'GTG']);
    for (const id of [1, 2, 4, 11, 12]) {
      const starts = proposedAnnotationStartCodons(getTranslationTable(id));
      expect(starts, String(id)).not.toContain('TTG');
      expect(starts, String(id)).not.toContain('CTG');
    }
  });

  it('proposes a table-11 gene from its GTG start rather than a downstream ATG', () => {
    // GTG at 0 opens the real CDS; an in-frame ATG sits 18 bases downstream.
    const gene = `GTG${'GCC'.repeat(5)}ATG${'GCC'.repeat(PROPOSED_ANNOTATION_CAPS.minOrfAminoAcids + 10)}TAA`;
    const sequence = `${gene}${'GCC'.repeat(3)}`;

    const bacterial = proposeDefaultAnnotations(record(sequence, 11));
    expect(bacterial.features[0]).toMatchObject({ start: 0, end: gene.length, strand: 1 });
    expect(bacterial.features[0].metadata.motifProposal).toMatchObject({
      evidence: { startCodon: 'GTG', translationTableId: 11 },
    });

    // The standard code does not list GTG, so its proposal still opens at ATG.
    const standard = proposeDefaultAnnotations(record(sequence, 1));
    expect(standard.features.map((feature) => feature.start)).toEqual([18]);
  });

  it('still ignores TTG starts under table 11', () => {
    const leucineOnly = `TTG${'GCC'.repeat(PROPOSED_ANNOTATION_CAPS.minOrfAminoAcids + 10)}TAA`;
    expect(proposeDefaultAnnotations(record(leucineOnly, 11)).features).toEqual([]);
  });
});
