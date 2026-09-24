import { describe, expect, it } from 'vitest';
import { cdsCodonOverrides, inlineTrackResidues } from '../motif-artifact';
import { materializeTranslationExceptions } from '../../bio/transl-except';
import { reverseComplement } from '../../bio/reverse-complement';
import type { Feature } from '../../bio/types';

type Track = Parameters<typeof inlineTrackResidues>[2];

// C | ATG GCC TGA AAA GGG TAA | CCCCCC — a CDS at 1..19 whose TGA at bases 7..9
// (INSDC 8..10) is a Sec codon.
const SEQUENCE = 'CATGGCCTGAAAAGGGTAACCCCCC';

function feature(id: string, type: Feature['type'], start: number, end: number, strand: 1 | -1, metadata: Record<string, unknown> = {}): Feature {
  return { id, name: id, type, start, end, strand, color: '#000000', metadata };
}

function materialize(sequence: string) {
  return (candidate: Feature) => materializeTranslationExceptions({
    sequence,
    feature: candidate,
    qualifier: candidate.metadata.transl_except,
    translationTableId: 1,
  });
}

function track(source: Feature, overrides: ReturnType<typeof cdsCodonOverrides>): Track {
  return {
    id: `feat:${source.id}`,
    label: source.name,
    start: source.start,
    end: source.end,
    strand: source.strand === -1 ? -1 : 1,
    frame: 0,
    translationTableId: 1,
    source: 'feature',
    codonOverrides: overrides,
  };
}

function residueAt(sequence: string, source: Feature, overrides: ReturnType<typeof cdsCodonOverrides>, start: number) {
  return inlineTrackResidues(sequence, 'dna', track(source, overrides), 'linear').find((residue) => residue.start === start);
}

describe('a CDS /transl_except on the other coding tracks over its codon', () => {
  const cds = feature('cds', 'cds', 1, 19, 1, { transl_except: '(pos:8..10,aa:Sec)' });
  const overrides = cdsCodonOverrides([cds], materialize(SEQUENCE));

  it('shows U where an exon reads the Sec codon in the CDS frame, and "*" without the CDS', () => {
    const exon = feature('exon', 'exon', 4, 16, 1);
    expect(residueAt(SEQUENCE, exon, overrides, 7)).toEqual({ aa: 'U', start: 7, end: 10 });
    expect(residueAt(SEQUENCE, exon, new Map(), 7)).toEqual({ aa: '*', start: 7, end: 10 });
    expect(inlineTrackResidues(SEQUENCE, 'dna', track(exon, overrides), 'linear').map((residue) => residue.aa).join('')).toBe('AUKG');
  });

  it('leaves a gene read in another frame as it reads, with no residue on the Sec codon', () => {
    const gene = feature('gene', 'gene', 0, 25, 1);
    const residues = inlineTrackResidues(SEQUENCE, 'dna', track(gene, overrides), 'linear');
    expect(residues.map((residue) => residue.aa).join('')).toBe('HGLKRVTP');
    expect(residues.some((residue) => residue.aa === 'U' || residue.start === 7)).toBe(false);
  });

  it('keeps the plain read of a track on the other strand over the same three bases', () => {
    const antisense = feature('antisense', 'exon', 4, 16, -1);
    // The minus-strand track reads the complement TCA of the plus-strand TGA at 7..9.
    expect(residueAt(SEQUENCE, antisense, overrides, 7)).toEqual({ aa: 'S', start: 7, end: 10 });
  });

  it('shows U on a reverse-strand exon under a reverse-strand CDS', () => {
    const flipped = reverseComplement(SEQUENCE);
    // The Sec codon's bases 7..9 land at 15..17 (INSDC complement(16..18)).
    const reverseCds = feature('cds', 'cds', 6, 24, -1, { transl_except: '(pos:complement(16..18),aa:Sec)' });
    const reverseOverrides = cdsCodonOverrides([reverseCds], materialize(flipped));
    expect([...reverseOverrides]).toEqual([['-1:15', { end: 18, residue: 'U' }]]);
    const exon = feature('exon', 'exon', 9, 21, -1);
    expect(residueAt(flipped, exon, reverseOverrides, 15)).toEqual({ aa: 'U', start: 15, end: 18 });
  });

  it('takes no override from a CDS whose /transl_except does not materialize, or from two CDSs that disagree', () => {
    const unaligned = feature('bad', 'cds', 1, 19, 1, { transl_except: '(pos:9..11,aa:Sec)' });
    expect(cdsCodonOverrides([unaligned], materialize(SEQUENCE)).size).toBe(0);
    const pyl = feature('pyl', 'cds', 1, 19, 1, { transl_except: '(pos:8..10,aa:Pyl)' });
    expect(cdsCodonOverrides([cds, pyl], materialize(SEQUENCE)).size).toBe(0);
    expect(cdsCodonOverrides([cds, { ...cds, id: 'copy' }], materialize(SEQUENCE))).toEqual(new Map([['1:7', { end: 10, residue: 'U' }]]));
    // An exon or gene never lends its own qualifier to the other tracks.
    const exonWithQualifier = feature('exon', 'exon', 1, 19, 1, { transl_except: '(pos:8..10,aa:Sec)' });
    expect(cdsCodonOverrides([exonWithQualifier], materialize(SEQUENCE)).size).toBe(0);
  });
});
