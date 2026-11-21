import { describe, expect, it } from 'vitest';
import { motifRangeOverlayInputs, variantRangeOverlayInput } from '../../plasmid-map/range-overlays';
import { NCBI_TRANSLATION_TABLES } from '../codon-tables';
import { gcContent, gcContentWindow } from '../gc-content';
import { migrationDistance, renderGelASCII, simulateGel } from '../gel-simulation';
import { findORFs } from '../orf-detection';
import { proposeDefaultAnnotations } from '../proposed-annotations';
import { findPrositeMatches, prositeMaxMatchLength, prositeMinMatchLength } from '../prosite';
import { reverseComplement } from '../reverse-complement';
import { sequenceDiff } from '../sequence-diff';
import { buildSequenceStyleHitMap, emptySequenceFormatting, findDegenerateMotifMatches, makeSequenceMotifRule } from '../sequence-formatting';

describe('analysis arithmetic', () => {
  it('omits the GC window for an empty sequence', () => {
    expect(gcContent('')).toBe(0);
    expect(gcContentWindow('', 3)).toEqual([]);
  });

  it('counts S as GC and divides by A, C, G, T, U and IUPAC bases except N and gaps', () => {
    expect(gcContent('ATSS')).toBe(0.5);
    expect(gcContent('gcAsnU')).toBe(3 / 5);
    expect(gcContent('aCgTuSwRyKmBdHvN-.')).toBe(3 / 15);
    expect(gcContent('WW')).toBe(0);
    expect(gcContent('N-.')).toBe(0);
  });

  it('uses the same called-base denominator in GC windows, including IUPAC bases and excluding N and gaps', () => {
    const input = 'sWrN-.uGc';
    const expected = [1 / 3, 0, 2 / 3];
    expect(gcContentWindow(input, 3, 3)).toEqual(expected.map((gc, index) => ({ position: index * 3, gc })));
    expect(gcContentWindow(input, 20)).toEqual([{ position: 0, gc: 0.5 }]);
  });

  it('reports pairwise differences against the stored origins', () => {
    const sequence = 'ACGT';
    const differences = (other: string) => sequenceDiff(sequence, other).segments
      .filter(({ op }) => op !== 'match')
      .map(({ op, seq1Start, seq2Start, seq1Text, seq2Text }) => [op, seq1Start, seq2Start, seq1Text, seq2Text]);
    expect(differences('gACGTa')).toEqual([['insertion', 0, 0, '-', 'G'], ['insertion', 4, 5, '-', 'A']]);
    expect(differences('CG')).toEqual([['deletion', 0, 0, 'A', '-'], ['deletion', 3, 2, 'T', '-']]);
    expect(differences('CCGA')).toEqual([['mismatch', 0, 0, 'A', 'C'], ['mismatch', 3, 3, 'T', 'A']]);
    expect(differences('acgt')).toEqual([]);
    expect(sequenceDiff(sequence, 'RCGY')).toMatchObject({ identity: 100, ambiguousMatches: 2 });
    expect(sequenceDiff('ATGC', reverseComplement('ATGC'))).toMatchObject({ aligned1: 'ATGC', aligned2: 'GCAT', mismatches: 4 });
  });

  it('labels an insertion at the terminal boundary', () => {
    expect(variantRangeOverlayInput({ id: 'ins', kind: 'insertion', start: 4, alternate: 'G' }, 4))
      .toMatchObject({ label: 'Insertion G after 4', ranges: [{ start: 3, end: 4 }] });
    expect(variantRangeOverlayInput({ id: 'ins', kind: 'insertion', start: 0, alternate: 'G' }, 4))
      .toMatchObject({ label: 'Insertion G before 1', ranges: [{ start: 0, end: 1 }] });
  });

  it('labels variant starts and projects full deletion and substitution spans', () => {
    expect(variantRangeOverlayInput({ id: 'del', kind: 'deletion', start: 1, end: 3, reference: 'CG' }, 4))
      .toMatchObject({ label: 'Deletion CG at 2', ranges: [{ start: 1, end: 3 }] });
    expect(variantRangeOverlayInput({ id: 'sub', kind: 'substitution', start: 2, end: 4, reference: 'GT', alternate: 'CA' }, 4))
      .toMatchObject({ label: 'GT>CA at 3', ranges: [{ start: 2, end: 4 }] });
  });

  it('keeps repeated and nested proposals with their own strand and coordinates', () => {
    const orf = `ATGATG${'AAA'.repeat(49)}TAA`;
    const propose = (sequence: string, topology: 'linear' | 'circular' = 'linear') => (
      proposeDefaultAnnotations({ sequence, topology, type: 'dna', features: [] }).features
    );
    const features = propose(`${orf}${reverseComplement(orf)}`);
    expect(features.map(({ start, end, strand }) => [start, end, strand])).toEqual([
      [0, 156, 1], [156, 312, -1], [3, 156, 1], [156, 309, -1],
    ]);
    expect(new Set(features.map(({ id }) => id)).size).toBe(4);
    expect(propose(orf.slice(0, -3))).toEqual([]);
    expect(propose(orf.slice(-3) + orf.slice(0, -3), 'circular')).toEqual([]);
  });

  it('accepts the PROSITE terminator in all pattern readers', () => {
    const pattern = '<[AC]-x(2)-{P}>.';
    const rule = makeSequenceMotifRule(pattern, { bold: true }, 'protein', 'Example');
    expect(findPrositeMatches('AGSA', pattern)).toEqual([{ start: 0, end: 4, text: 'AGSA' }]);
    expect(findDegenerateMotifMatches('AGSA', rule, 'protein')).toMatchObject([{ start: 0, end: 4 }]);
    expect(prositeMinMatchLength(pattern)).toBe(4);
    expect(prositeMaxMatchLength(pattern)).toBe(4);
    expect(findDegenerateMotifMatches('ACA', { ...rule, pattern: 'A.' }, 'protein')).toHaveLength(2);
    expect(findPrositeMatches('AGSA', '<[AC]-x(2)-{P}>..')).toEqual([]);
    expect(motifRangeOverlayInputs({
      sequence: 'AAAAAC', sequenceType: 'dna', topology: 'circular', rules: [{ ...rule, alphabet: 'dna', pattern: 'A-C>.' }],
    })).toMatchObject([{ ranges: [{ start: 4, end: 6 }] }]);
  });

  it('anchors motif highlights to the sequence termini', () => {
    const highlight = (pattern: string, sequence: string, lineStart: number, lineEnd: number) => {
      const formatting = emptySequenceFormatting();
      formatting.motifRules = [makeSequenceMotifRule(pattern, { bold: true }, 'protein', 'Example')];
      return [...buildSequenceStyleHitMap({ formatting, sequence, sequenceType: 'protein', lineStart, lineEnd }).keys()];
    };
    expect(highlight('<A-x', 'CCAGCCCC', 3, 5)).toEqual([]);
    expect(highlight('x-A>', 'CCGACCCC', 1, 3)).toEqual([]);
    expect(highlight('<A-x', 'AGCC', 1, 2)).toEqual([1]);
    expect(highlight('x-A>', 'CCGA', 2, 3)).toEqual([2]);
  });

  it('matches overlapping repeated motifs and excludes non-residues', () => {
    expect(findPrositeMatches('AAAAAA', '[AC]-x(2,4)-A')).toEqual([
      { start: 0, end: 6, text: 'AAAAAA' }, { start: 1, end: 6, text: 'AAAAA' }, { start: 2, end: 6, text: 'AAAA' },
    ]);
    expect(findPrositeMatches('AP*-Q', '{P}(2)')).toEqual([]);
    expect(findPrositeMatches('AQPA', '{P}(2)')).toEqual([{ start: 0, end: 2, text: 'AQ' }]);
    // Lower case, the unknown residue X and ambiguity letters are still residues.
    expect(findPrositeMatches('qXbp', '{P}(3)')).toEqual([{ start: 0, end: 3, text: 'qXb' }]);
  });

  it('reports exact gel band sizes', () => {
    const gel = simulateGel([{ name: 'Sample', fragments: [1000, 1049, 1049] }], { ladder: [1000, 1049], height: 1 });
    expect(gel.bands.map(({ size, label, intensity }) => [size, label, intensity])).toEqual([
      [1049, '1.049kb', 1], [1000, '1kb', 0.8],
    ]);
    const sizes = simulateGel([{ name: 'Sample', fragments: [100_000, 10_000, 1001, 999] }]);
    expect(sizes.bands.map(({ label }) => label)).toEqual(['100kb', '10kb', '1.001kb', '999']);
  });

  it('resolves ladder collisions by size', () => {
    const gel = simulateGel([], { ladder: [1049, 1000], height: 1 });
    expect(renderGelASCII({
      ...gel,
      ladderBands: [{ ...gel.ladderBands[0], label: 'Large' }, { ...gel.ladderBands[1], label: 'Small' }],
    }, { height: 1 })).toContain('  Small');
  });

  it('places ladder and sample bands on the same monotonic gel scale', () => {
    const fragments = [250_000, 10_000, 1000, 100, 1];
    const gel = simulateGel([{ name: 'Sample', fragments }], { ladder: [10_000, 1000, 100] });
    expect(gel.bands.map(({ size }) => size)).toEqual(fragments);
    const positions = gel.bands.map(({ migrationDistance }) => migrationDistance);
    expect(positions).toEqual([0, expect.closeTo(0.1), expect.closeTo(0.35), expect.closeTo(0.6), 1]);
    expect(gel.ladderBands.map(({ migrationDistance }) => migrationDistance)).toEqual(positions.slice(1, -1));
    expect(migrationDistance(100, 2) - migrationDistance(10_000, 2)).toBeCloseTo(0.64);
    expect(migrationDistance(100, 0.8) - migrationDistance(10_000, 0.8)).toBeCloseTo(0.44);
  });

  it('uses each configured genetic code and measures ORFs without counting the stop as an amino acid', () => {
    const codons = [...'ACGT'].flatMap((first) => [...'ACGT'].flatMap((second) => [...'ACGT'].map((third) => first + second + third)));
    for (const table of Object.values(NCBI_TRANSLATION_TABLES)) {
      const found = codons.filter((codon) => findORFs(`${codon}AAA`, 1, table).some(({ start, strand }) => start === 0 && strand === 1));
      expect(found, table.name).toEqual([...table.starts].sort());
    }
    expect(findORFs('ATGAAATAA', 2)).toMatchObject([{ start: 0, end: 9, length: 9, aminoAcids: 2, status: 'complete' }]);
    expect(findORFs('ATGAAATAA', 3)).toEqual([]);
    expect(findORFs('ATGAAAC', 2)).toMatchObject([{ start: 0, end: 6, length: 6, aminoAcids: 2, status: 'partial' }]);
    expect(findORFs('TAAATGAAA', 2, undefined, { topology: 'circular' })).toContainEqual(expect.objectContaining({
      start: 3, end: 12, length: 9, strand: 1, aminoAcids: 2, status: 'complete',
    }));
  });
});
