import { describe, expect, it } from 'vitest';
import { normalizeArtifactAlignment, type ArtifactAlignment } from '../claude-science-msa';
import {
  computeMsaVariants,
  countMsaVariants,
  groupMsaVariantRuns,
  summarizeMsaVariants,
} from '../claude-science-msa-variants';

function proteinAlignment(
  rows: Array<{ id: string; name: string; aligned: string }>,
  referenceNumbering?: { rowId: string; firstResiduePosition: number },
): ArtifactAlignment {
  return normalizeArtifactAlignment({
    id: 'variants',
    name: 'Variant examples',
    molecule: 'protein',
    referenceRowId: 'template',
    ...(referenceNumbering ? { referenceNumbering } : {}),
    rows,
  });
}

function dnaAlignment(rows: Array<{ id: string; name: string; aligned: string }>): ArtifactAlignment {
  return normalizeArtifactAlignment({
    id: 'dna-variants',
    name: 'DNA variant examples',
    molecule: 'dna',
    referenceRowId: 'template',
    rows,
  });
}

describe('computeMsaVariants', () => {
  it('reports a known substitution with an absolute alignment column', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'KRAS template', aligned: 'MTEYKLVVVGAGGVGKS' },
      { id: 'g12d', name: 'KRAS G12D', aligned: 'MTEYKLVVVGADGVGKS' },
    ]);

    expect(computeMsaVariants(alignment)).toEqual({
      variants: [{
        rowId: 'g12d',
        rowName: 'KRAS G12D',
        column: 11,
        templateResidue: 'G',
        residue: 'D',
        kind: 'substitution',
        templatePosition: 12,
        label: 'G12D',
      }],
      truncated: false,
    });
  });

  it('classifies a residue opposite a template gap as an insertion', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'AC-G' },
      { id: 'insertion', name: 'Insertion', aligned: 'ACTG' },
    ]);

    expect(computeMsaVariants(alignment).variants).toEqual([{
      rowId: 'insertion',
      rowName: 'Insertion',
      column: 2,
      templateResidue: '-',
      residue: 'T',
      kind: 'insertion',
      templatePosition: null,
      label: '-3T',
    }]);
  });

  it('classifies a row gap opposite a template residue as a deletion', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'ACKT' },
      { id: 'deletion', name: 'Deletion', aligned: 'AC.T' },
    ]);

    expect(computeMsaVariants(alignment).variants).toEqual([{
      rowId: 'deletion',
      rowName: 'Deletion',
      column: 2,
      templateResidue: 'K',
      residue: '-',
      kind: 'deletion',
      templatePosition: 3,
      label: 'K3-',
    }]);
  });

  it('treats leading and trailing row gaps as not covered, not as deletions', () => {
    // A copy cut short, or a read that starts inside the template, does not
    // reach the ends. The row badge counts 0 differences for it, so the list
    // and the counts must too. Columns outside the template's own residues
    // are skipped the same way.
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: '-ACGTACGT-' },
      { id: 'short', name: 'Short', aligned: '---GTA-G--' },
      { id: 'long', name: 'Long', aligned: 'TACGTACGTT' },
    ]);

    expect(computeMsaVariants(alignment).variants.map((variant) => `${variant.rowId}:${variant.label}`))
      .toEqual(['short:C6-']);
    expect(countMsaVariants(alignment)).toEqual({ total: 1, substitutions: 0, insertions: 0, deletions: 1 });
  });

  it('emits nothing for an identical row or case-only residue differences', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'ACGT' },
      { id: 'identical', name: 'Identical', aligned: 'acgt' },
    ]);

    expect(computeMsaVariants(alignment)).toEqual({ variants: [], truncated: false });
  });

  it('emits nothing when both rows use either gap symbol in an all-gap column', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'A-C' },
      { id: 'all-gap', name: 'All gap', aligned: 'A.C' },
    ]);

    expect(computeMsaVariants(alignment)).toEqual({ variants: [], truncated: false });
  });

  it('excludes uncovered padding gaps and ambiguity-compatible DNA calls by default', () => {
    const alignment = dnaAlignment([
      { id: 'template', name: 'Template', aligned: 'CATG' },
      { id: 'partial', name: 'Partial read', aligned: '--TG' },
      { id: 'compatible', name: 'Compatible ambiguity', aligned: 'CRTG' },
    ]);

    expect(computeMsaVariants(alignment)).toEqual({ variants: [], truncated: false });
    expect(computeMsaVariants(alignment, { maxVariants: 0 })).toEqual({ variants: [], truncated: false });
    expect(computeMsaVariants(alignment, { strictDifferences: true }).variants).toEqual([
      expect.objectContaining({
        rowId: 'compatible',
        column: 1,
        templateResidue: 'A',
        residue: 'R',
        kind: 'substitution',
        label: 'A2R',
      }),
    ]);
  });

  it('excludes residues outside the template coverage window', () => {
    const alignment = dnaAlignment([
      { id: 'template', name: 'Template', aligned: '-AC-' },
      { id: 'extended', name: 'Extended row', aligned: 'TACG' },
    ]);

    expect(computeMsaVariants(alignment)).toEqual({ variants: [], truncated: false });
  });

  it('uses protein ambiguity compatibility unless strict differences are enabled', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'ABD' },
      { id: 'compatible', name: 'Compatible ambiguity', aligned: 'ADD' },
      { id: 'mismatch', name: 'Mismatch', aligned: 'AQD' },
    ]);

    expect(computeMsaVariants(alignment).variants.map((variant) => variant.label)).toEqual(['B2Q']);
    expect(computeMsaVariants(alignment, { strictDifferences: true }).variants.map((variant) => variant.label))
      .toEqual(['B2D', 'B2Q']);
  });

  it('keeps a covered internal row gap as a deletion', () => {
    const alignment = dnaAlignment([
      { id: 'template', name: 'Template', aligned: 'CATG' },
      { id: 'deletion', name: 'Deletion', aligned: 'C--G' },
    ]);

    expect(computeMsaVariants(alignment).variants.map((variant) => variant.label)).toEqual(['A2-', 'T3-']);
  });

  it('uses plain ungapped template positions without configured reference numbering', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: '-ACD' },
      { id: 'variant', name: 'Variant', aligned: '-ATD' },
    ]);

    expect(computeMsaVariants(alignment).variants[0]).toMatchObject({
      column: 2,
      templatePosition: 2,
      label: 'C2T',
    });
  });

  it('mirrors configured reference positions and insertion codes from the viewer axis', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'AC-G' },
      { id: 'variant', name: 'Variant', aligned: 'ATQG' },
    ], { rowId: 'template', firstResiduePosition: 100 });

    expect(computeMsaVariants(alignment).variants).toEqual([
      {
        rowId: 'variant',
        rowName: 'Variant',
        column: 1,
        templateResidue: 'C',
        residue: 'T',
        kind: 'substitution',
        templatePosition: 101,
        label: 'C101T',
      },
      {
        rowId: 'variant',
        rowName: 'Variant',
        column: 2,
        templateResidue: '-',
        residue: 'Q',
        kind: 'insertion',
        templatePosition: null,
        label: '-101AQ',
      },
    ]);
  });

  it('derives configured coordinates from referenceNumbering.rowId', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'A-CG' },
      { id: 'numbering', name: 'Numbering reference', aligned: 'AB-G' },
      { id: 'variant', name: 'Variant', aligned: 'AQTG' },
    ], { rowId: 'numbering', firstResiduePosition: 50 });

    expect(computeMsaVariants(alignment).variants.filter((variant) => variant.rowId === 'variant'))
      .toEqual([
        expect.objectContaining({
          column: 1,
          templatePosition: null,
          label: '-51Q',
        }),
        expect.objectContaining({
          column: 2,
          templatePosition: 51,
          label: 'C51AT',
        }),
      ]);
  });

  it('caps retained variants and explicitly reports incomplete results', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'AAAA' },
      { id: 'variant', name: 'Variant', aligned: 'TTTT' },
    ]);

    expect(computeMsaVariants(alignment, { maxVariants: 2 })).toEqual({
      variants: [
        expect.objectContaining({ column: 0, label: 'A1T' }),
        expect.objectContaining({ column: 1, label: 'A2T' }),
      ],
      truncated: true,
    });
    expect(computeMsaVariants(alignment, { maxVariants: 0 })).toEqual({
      variants: [],
      truncated: true,
    });
  });
});

describe('summarizeMsaVariants', () => {
  it('rolls variants up by row, absolute column, and kind', () => {
    const alignment = proteinAlignment([
      { id: 'template', name: 'Template', aligned: 'AC-G' },
      { id: 'alpha', name: 'Alpha', aligned: 'ATQG' },
      { id: 'beta', name: 'Beta', aligned: 'A--G' },
    ]);
    const { variants } = computeMsaVariants(alignment);

    expect(summarizeMsaVariants(variants)).toEqual({
      total: 3,
      substitutions: 1,
      insertions: 1,
      deletions: 1,
      rows: [
        {
          rowId: 'alpha', rowName: 'Alpha', total: 2,
          substitutions: 1, insertions: 1, deletions: 0,
        },
        {
          rowId: 'beta', rowName: 'Beta', total: 1,
          substitutions: 0, insertions: 0, deletions: 1,
        },
      ],
      columns: [
        { column: 1, total: 2, substitutions: 1, insertions: 0, deletions: 1 },
        { column: 2, total: 1, substitutions: 0, insertions: 1, deletions: 0 },
      ],
    });
  });
});

describe('groupMsaVariantRuns', () => {
  it('keeps a deletion whole across a column that only another row inserts into', () => {
    // Row "del" loses template bases 3-5 (G, T, T). Column 5 is row "ins"'s
    // insertion, a gap in both the template and "del", so it must not split
    // the deletion into 3-4 and 5.
    const alignment = normalizeArtifactAlignment({
      id: 'runs',
      name: 'runs',
      molecule: 'dna',
      referenceRowId: 'template',
      rows: [
        { id: 'template', name: 'template', aligned: 'ACGT-TTCA' },
        { id: 'del', name: 'del', aligned: 'AC----TCA' },
        { id: 'ins', name: 'ins', aligned: 'ACGTGTTCA' },
      ],
    });
    const runs = groupMsaVariantRuns(computeMsaVariants(alignment).variants, alignment);
    expect(runs.map(({ label, length, templateResidues, residues, first, last }) => (
      [label, length, templateResidues, residues, first.column + 1, last.column + 1]
    ))).toEqual([
      ['3–5del', 3, 'GTT', '---', 3, 6],
      ['4^5ins', 1, '-', 'G', 5, 5],
    ]);
  });
});

describe('ambiguity codes in the differences list', () => {
  // A read's N at template 3 (G) is compatible with G; the grid marks it as
  // compatible, not as a difference, unless strict comparison is on. The A at
  // template 8 (T) is a substitution either way.
  const alignment = normalizeArtifactAlignment({
    id: 'n-call',
    name: 'N call',
    molecule: 'dna',
    referenceRowId: 'template',
    rows: [
      { id: 'template', name: 'template', aligned: 'ACGTACGTAC' },
      { id: 'read', name: 'read', aligned: 'ACNTACGAAC' },
    ],
  });

  it('leaves a compatible ambiguity call out unless strict comparison is on', () => {
    expect(computeMsaVariants(alignment).variants.map((variant) => variant.label)).toEqual(['T8A']);
    expect(countMsaVariants(alignment)).toEqual({ total: 1, substitutions: 1, insertions: 0, deletions: 0 });
    expect(computeMsaVariants(alignment, { strictDifferences: true }).variants.map((variant) => variant.label))
      .toEqual(['G3N', 'T8A']);
    expect(countMsaVariants(alignment, { strictDifferences: true }))
      .toEqual({ total: 2, substitutions: 2, insertions: 0, deletions: 0 });
  });

  it('keeps an incompatible ambiguity call: R (A or G) against T', () => {
    const hard = normalizeArtifactAlignment({
      id: 'r-call',
      name: 'R call',
      molecule: 'dna',
      referenceRowId: 'template',
      rows: [
        { id: 'template', name: 'template', aligned: 'ACGTACGTAC' },
        { id: 'read', name: 'read', aligned: 'ACGRACGTAC' },
      ],
    });
    expect(computeMsaVariants(hard).variants.map((variant) => variant.label)).toEqual(['T4R']);
    expect(countMsaVariants(hard).total).toBe(1);
  });
});
