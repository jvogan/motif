import { describe, expect, it } from 'vitest';
import {
  computeMsaColumnStats,
  msaShadeBucket,
  residueColorKey,
  sliceSelectionRows,
  selectionToFasta,
  selectionToUngappedFasta,
  selectionToColumnsText,
  summarizeSelectionColumns,
  moveRowId,
  translateAlignedRow,
  findMsaMotifMatches,
  normalizeArtifactAlignment,
  type ArtifactAlignment,
} from '../claude-science-msa';

function dnaAlignment(): ArtifactAlignment {
  return normalizeArtifactAlignment({
    id: 'aln',
    name: 'Demo',
    molecule: 'dna',
    rows: [
      { id: 'a', name: 'Alpha', aligned: 'ACGT' },
      { id: 'b', name: 'Beta', aligned: 'ACGA' },
      { id: 'c', name: 'Gamma', aligned: 'AC-T' },
    ],
  });
}

describe('computeMsaColumnStats', () => {
  const stats = computeMsaColumnStats(dnaAlignment().rows);

  it('reports fully conserved columns', () => {
    expect(stats[0]).toMatchObject({ occupancy: 1, consensusResidue: 'A', fullyConserved: true, conservation: 1, entropy: 0 });
    expect(stats[1].fullyConserved).toBe(true);
  });

  it('gates identity/conservation by occupancy when a row is gapped', () => {
    // col 2: G,G,- -> present rows agree but only 2/3 rows are occupied.
    expect(stats[2].occupancy).toBeCloseTo(2 / 3, 6);
    expect(stats[2].consensusFraction).toBe(1);
    expect(stats[2].identity).toBeCloseTo(2 / 3, 6);
    expect(stats[2].conservation).toBeCloseTo(2 / 3, 6);
    expect(stats[2].fullyConserved).toBe(false);
    expect(stats[2].entropy).toBe(0);
  });

  it('computes Shannon entropy for a variable column', () => {
    // col 3: T,A,T -> winner T (2/3), entropy = -(2/3 log2 2/3 + 1/3 log2 1/3).
    expect(stats[3].consensusResidue).toBe('T');
    expect(stats[3].identity).toBeCloseTo(2 / 3, 6);
    expect(stats[3].entropy).toBeCloseTo(0.9182958, 5);
    expect(stats[3].fullyConserved).toBe(false);
  });

  it('handles all-gap columns without dividing by zero', () => {
    const gapped = computeMsaColumnStats([{ aligned: 'A-' }, { aligned: 'A-' }]);
    expect(gapped[1]).toMatchObject({ occupancy: 0, consensusResidue: '-', conservation: 0, entropy: 0, fullyConserved: false });
  });

  it('scores conservation from entropy so it is distinct from identity in diverse columns', () => {
    // col 3: T,A,T — identity is winner/rows = 2/3, but conservation discounts the
    // T/A diversity via Shannon entropy (dna alphabet, max entropy log2 4 = 2), so
    // the two metrics must diverge. Previously conservation collapsed onto identity.
    expect(stats[3].identity).toBeCloseTo(2 / 3, 6);
    expect(stats[3].conservation).toBeCloseTo(1 - 0.9182958 / 2, 5);
    expect(Math.abs(stats[3].conservation - stats[3].identity)).toBeGreaterThan(0.1);
  });
});

describe('msaShadeBucket', () => {
  it('buckets a 0..1 score into 0..4', () => {
    expect(msaShadeBucket(1)).toBe(4);
    expect(msaShadeBucket(0.85)).toBe(3);
    expect(msaShadeBucket(0.7)).toBe(2);
    expect(msaShadeBucket(0.5)).toBe(1);
    expect(msaShadeBucket(0.3)).toBe(0);
    expect(msaShadeBucket(0)).toBe(0);
    expect(msaShadeBucket(-1)).toBe(0);
  });
});

describe('residueColorKey', () => {
  it('colours nucleotides for nucleotide and auto-DNA schemes', () => {
    expect(residueColorKey('A', 'dna', 'nucleotide')).toBe('nt-a');
    expect(residueColorKey('T', 'dna', 'auto')).toBe('nt-t');
    expect(residueColorKey('U', 'rna', 'nucleotide')).toBe('nt-t');
    expect(residueColorKey('N', 'dna', 'nucleotide')).toBe('nt-other');
  });

  it('returns no colour for gaps and unknowns', () => {
    expect(residueColorKey('-', 'dna', 'nucleotide')).toBe('');
    expect(residueColorKey('.', 'protein', 'clustal')).toBe('');
    expect(residueColorKey('?', 'protein', 'clustal')).toBe('');
  });

  it('groups amino acids by ClustalX chemistry (and for auto-protein)', () => {
    expect(residueColorKey('K', 'protein', 'clustal')).toBe('cl-positive');
    expect(residueColorKey('L', 'protein', 'clustal')).toBe('cl-hydrophobic');
    expect(residueColorKey('D', 'protein', 'clustal')).toBe('cl-negative');
    expect(residueColorKey('A', 'protein', 'auto')).toBe('cl-hydrophobic');
  });

  it('buckets hydrophobicity and passes taylor through', () => {
    expect(residueColorKey('L', 'protein', 'hydrophobicity')).toBe('hyd-4');
    expect(residueColorKey('R', 'protein', 'hydrophobicity')).toBe('hyd-0');
    expect(residueColorKey('W', 'protein', 'taylor')).toBe('taylor');
  });
});

describe('selection helpers', () => {
  const alignment = dnaAlignment();

  it('slices an inclusive column range across all rows', () => {
    expect(sliceSelectionRows(alignment, { columns: { start: 1, end: 2 } })).toEqual([
      { id: 'a', name: 'Alpha', aligned: 'CG' },
      { id: 'b', name: 'Beta', aligned: 'CG' },
      { id: 'c', name: 'Gamma', aligned: 'C-' },
    ]);
  });

  it('restricts to a row subset when rowIds are given', () => {
    expect(sliceSelectionRows(alignment, { columns: { start: 0, end: 0 }, rowIds: ['c'] })).toEqual([
      { id: 'c', name: 'Gamma', aligned: 'A' },
    ]);
  });

  it('formats gapped and ungapped FASTA plus a plain column block', () => {
    const selection = { columns: { start: 2, end: 3 } };
    expect(selectionToFasta(alignment, selection)).toBe('>Alpha\nGT\n>Beta\nGA\n>Gamma\n-T\n');
    expect(selectionToUngappedFasta(alignment, selection)).toBe('>Alpha\nGT\n>Beta\nGA\n>Gamma\nT\n');
    expect(selectionToColumnsText(alignment, selection)).toBe('GT\nGA\n-T');
  });

  it('normalizes reversed/overflowing ranges', () => {
    expect(sliceSelectionRows(alignment, { columns: { start: 9, end: -3 } }).map((row) => row.aligned)).toEqual(['ACGT', 'ACGA', 'AC-T']);
  });
});

describe('summarizeSelectionColumns', () => {
  it('aggregates conserved, variable, and gap columns over a range', () => {
    const stats = computeMsaColumnStats(dnaAlignment().rows);
    const summary = summarizeSelectionColumns(stats, { start: 0, end: 3 });
    expect(summary.columns).toBe(4);
    expect(summary.fullyConserved).toBe(2);
    expect(summary.variableColumns).toBe(1);
    expect(summary.gapColumns).toBe(0);
    expect(summary.meanIdentity).toBeCloseTo((1 + 1 + 2 / 3 + 2 / 3) / 4, 6);
  });

  it('counts an all-gap column as a gap only, not a variable column', () => {
    const aln = normalizeArtifactAlignment({
      id: 'g', name: 'g', molecule: 'dna',
      rows: [{ id: 'a', name: 'a', aligned: 'A-' }, { id: 'b', name: 'b', aligned: 'T-' }],
    });
    const summary = summarizeSelectionColumns(computeMsaColumnStats(aln.rows), { start: 1, end: 1 });
    expect(summary.gapColumns).toBe(1);
    expect(summary.variableColumns).toBe(0);
  });

  it('excludes all-gap columns from the mean identity, not just the variable count', () => {
    // Column 0 is perfectly identical (A/A); column 1 is all-gap. The mean must
    // reflect only the informative column (1.0), not be halved to 0.5 by the gap.
    const stats = computeMsaColumnStats([{ aligned: 'A-' }, { aligned: 'A-' }]);
    const summary = summarizeSelectionColumns(stats, { start: 0, end: 1 });
    expect(summary.columns).toBe(2);
    expect(summary.gapColumns).toBe(1);
    expect(summary.meanIdentity).toBeCloseTo(1, 6);
    expect(summary.meanConservation).toBeCloseTo(1, 6);
  });
});

describe('selection row order', () => {
  it('slices selected rows in the supplied (displayed) order, not alignment order', () => {
    const aln = dnaAlignment(); // rows a=Alpha, b=Beta, c=Gamma
    const rows = sliceSelectionRows(aln, { columns: { start: 0, end: 3 }, rowIds: ['c', 'a'] });
    expect(rows.map((row) => row.id)).toEqual(['c', 'a']);
    const fasta = selectionToColumnsText(aln, { columns: { start: 0, end: 1 }, rowIds: ['c', 'a'] });
    expect(fasta.split('\n')).toEqual(['AC', 'AC']); // Gamma then Alpha, both 'AC' at cols 0-1
  });
});

describe('moveRowId', () => {
  const base = ['a', 'b', 'c', 'd'];

  it('moves an item down to an explicit index without mutating the input', () => {
    const next = moveRowId(base, 'a', 2);
    expect(next).toEqual(['b', 'c', 'a', 'd']);
    expect(base).toEqual(['a', 'b', 'c', 'd']);
  });

  it('moves an item up toward the front', () => {
    expect(moveRowId(base, 'd', 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves an item to the very front and the very end', () => {
    expect(moveRowId(base, 'c', 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveRowId(base, 'b', 3)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('clamps out-of-range target indices to the array bounds', () => {
    expect(moveRowId(base, 'a', 99)).toEqual(['b', 'c', 'd', 'a']);
    expect(moveRowId(base, 'd', -5)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('returns an equivalent order when the id is unknown or already in place', () => {
    expect(moveRowId(base, 'z', 1)).toEqual(base);
    expect(moveRowId(base, 'z', 1)).not.toBe(base);
    // targetIndex equal to the current slot leaves the order unchanged.
    expect(moveRowId(base, 'b', 1)).toEqual(base);
  });
});

describe('translateAlignedRow', () => {
  it('translates an ungapped row into positioned amino-acid cells', () => {
    const codons = translateAlignedRow('ATGTGGTAA');
    expect(codons.map((c) => c.aminoAcid)).toEqual(['M', 'W', '*']);
    expect(codons.map((c) => c.position)).toEqual([1, 2, 3]);
    expect(codons[0]).toMatchObject({ startColumn: 0, endColumn: 2, codon: 'ATG', gapSpanning: false });
    expect(codons[2]).toMatchObject({ startColumn: 6, endColumn: 8 });
  });

  it('reads U as T so RNA rows translate', () => {
    expect(translateAlignedRow('AUGUGG').map((c) => c.aminoAcid)).toEqual(['M', 'W']);
  });

  it('honours the reading-frame offset without consuming gaps', () => {
    // frame 1 skips the leading A, then ATG=M, TGG=W.
    const codons = translateAlignedRow('AATGTGG', 1);
    expect(codons.map((c) => c.aminoAcid)).toEqual(['M', 'W']);
    expect(codons[0].startColumn).toBe(1);
  });

  it('spans alignment gaps within a codon and flags it', () => {
    const codons = translateAlignedRow('AT-GTGG');
    expect(codons[0]).toMatchObject({ aminoAcid: 'M', startColumn: 0, endColumn: 3, gapSpanning: true });
    expect(codons[1]).toMatchObject({ aminoAcid: 'W', gapSpanning: false });
  });

  it('drops a trailing 1-2 nucleotide remainder and marks unknown codons X', () => {
    expect(translateAlignedRow('ATGTG').map((c) => c.aminoAcid)).toEqual(['M']);
    expect(translateAlignedRow('ATGNNN').map((c) => c.aminoAcid)).toEqual(['M', 'X']);
  });
});

describe('findMsaMotifMatches', () => {
  const dnaRows = [
    { id: 'a', name: 'Alpha', aligned: 'ACGTACGT' },
    { id: 'b', name: 'Beta', aligned: 'AC-GTACG' },
  ];

  it('finds a motif and reports its alignment columns per row', () => {
    const { matches, truncated } = findMsaMotifMatches(dnaRows, 'CGT', { molecule: 'dna' });
    expect(truncated).toBe(false);
    // Row a: CGT at ungapped 1-3 → columns 1,2,3; and again at 5-7.
    const alpha = matches.filter((m) => m.rowId === 'a');
    expect(alpha.map((m) => [m.startColumn, m.endColumn])).toEqual([[1, 3], [5, 7]]);
    // Row b: C(col1) G(col3) T(col4) — the gap at col2 is skipped, not part of the motif.
    const beta = matches.find((m) => m.rowId === 'b');
    expect(beta).toMatchObject({ startColumn: 1, endColumn: 4, columns: [1, 3, 4] });
  });

  it('is case-insensitive and treats U as T', () => {
    const rows = [{ id: 'r', name: 'RNA', aligned: 'acguACGU' }];
    expect(findMsaMotifMatches(rows, 'cgt', { molecule: 'rna' }).matches).toHaveLength(2);
  });

  it('honours IUPAC ambiguity in the query', () => {
    const rows = [{ id: 'r', name: 'r', aligned: 'AAGAAT' }];
    // R = A or G, so "AAR" matches AAG (0-2) and AAT? no — AAT third is T not A/G. Only AAG.
    expect(findMsaMotifMatches(rows, 'AAR', { molecule: 'dna' }).matches.map((m) => m.startColumn)).toEqual([0]);
    // N matches anything.
    expect(findMsaMotifMatches(rows, 'NNN', { molecule: 'dna' }).matches.length).toBe(4);
  });

  it('returns overlapping matches and rejects gap or empty queries', () => {
    const rows = [{ id: 'r', name: 'r', aligned: 'AAAA' }];
    expect(findMsaMotifMatches(rows, 'AA', { molecule: 'dna' }).matches).toHaveLength(3);
    expect(findMsaMotifMatches(rows, 'A-C', { molecule: 'dna' }).matches).toHaveLength(0);
    expect(findMsaMotifMatches(rows, '   ', { molecule: 'dna' }).matches).toHaveLength(0);
  });

  it('caps matches and flags truncation', () => {
    const rows = [{ id: 'r', name: 'r', aligned: 'AAAAAAAAAA' }];
    const { matches, truncated } = findMsaMotifMatches(rows, 'A', { molecule: 'dna', maxMatches: 4 });
    expect(matches).toHaveLength(4);
    expect(truncated).toBe(true);
    // A zero/negative cap stores nothing (does not leak one match).
    expect(findMsaMotifMatches(rows, 'A', { molecule: 'dna', maxMatches: 0 }).matches).toHaveLength(0);
  });

  it('returns the globally-earliest columns when the cap truncates, regardless of row order', () => {
    // The row holding the earlier column is scanned LAST, yet must win the cap —
    // the previous implementation kept whichever hit it happened to reach first.
    const rows = [
      { id: 'late', name: 'Late', aligned: '--A' }, // A at column 2, scanned first
      { id: 'early', name: 'Early', aligned: 'A--' }, // A at column 0, scanned second
    ];
    const { matches, truncated } = findMsaMotifMatches(rows, 'A', { molecule: 'dna', maxMatches: 1 });
    expect(truncated).toBe(true);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ rowId: 'early', startColumn: 0 });
  });

  it('bounds total work and reports truncation for a long, absent query', () => {
    // 200 columns of A searched for a 150-long A…C motif never matches; without a
    // comparison budget this scans every start position. The cap stops it early.
    const rows = [{ id: 'r', name: 'r', aligned: 'A'.repeat(200) }];
    const query = `${'A'.repeat(149)}C`;
    const { matches, truncated } = findMsaMotifMatches(rows, query, { molecule: 'dna', maxComparisons: 500 });
    expect(matches).toHaveLength(0);
    expect(truncated).toBe(true);
  });
});
