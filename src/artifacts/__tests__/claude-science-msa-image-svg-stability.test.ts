import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SequenceType } from '../../bio/types';
import {
  computeAlignmentImageLayout,
  DEFAULT_ALIGNMENT_IMAGE_PALETTE,
  type AlignmentImageLayoutOptions,
  type AlignmentImagePalette,
  type AlignmentImageSource,
  type MsaColorScheme,
} from '../claude-science-msa';
import { renderAlignmentImageSvg, type ImageExportRow } from '../claude-science-msa-image';

// Byte-level fixtures for the SVG exporter. The digests were recorded from the
// straightforward per-cell implementation, so any refactor of the render loop
// must keep producing exactly the same document.

const DARK_PALETTE: AlignmentImagePalette = {
  ...DEFAULT_ALIGNMENT_IMAGE_PALETTE,
  background: '#14181f',
  labelBackground: '#1d232c',
  text: '#e8ecf2',
  muted: '#9aa4b2',
};

const DNA_ROWS: ImageExportRow[] = [
  { name: 'Template <ref> & "primary"', aligned: 'ACGTRYNacgt-..ACGTUKMSWBDHV?ACGT-ACGTN', isTemplate: true },
  { name: "Read 1 'forward'", aligned: 'ACGAAYNacct-..ACGTUKMSWBDHV?ACG--ACGTA', isTemplate: false },
  { name: 'A very long sample identifier that will need to be truncated in the label column', aligned: '--GTRYNacgtA..ACGTTKMSWBDHV?ACGTTACG--', isTemplate: false },
  { name: 'short', aligned: 'ACGT', isTemplate: false },
];

const PROTEIN_ROWS: ImageExportRow[] = [
  { name: 'Template', aligned: 'MKTAYIAKQRQISFVKSHFSRQ-LEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWUOJBXZ*?', isTemplate: true },
  { name: 'Homolog_b', aligned: 'MKTAYIAKQRQISFVKSHFSRQ-LEERLGLIEVQAPILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPFLPDQIHFVHSQELLSRYPDLDAKGRERAIAKDLGAVFLVGIGGKLSDGHRHDVRAPDYDDWUOJBXZ*?'.toLowerCase(), isTemplate: false },
  { name: 'Homolog_c', aligned: 'MKTAY--KQRQISFVKSHFSRQXLEERLGLIEVQ.PILSRVGDGTQDNLSGAEKAVQVKVKALPDAQFEVVHSLAKWKRQTLGQHDFSAGEGLYTHMKALRPDEDRLSPLHSVYVDQWDWERVMGDGERQFSTLKSTVEAIWAGIKATEAAVSEEFGLAPF', isTemplate: false },
];

function sourceFor(rows: readonly ImageExportRow[]): AlignmentImageSource {
  return {
    rows: rows.map(({ name, aligned }) => ({ name, aligned })),
    alignmentLength: Math.max(...rows.map((row) => row.aligned.length)),
  };
}

function svgDigest(
  rows: readonly ImageExportRow[],
  molecule: SequenceType,
  scheme: MsaColorScheme | null,
  options: AlignmentImageLayoutOptions,
  palette: AlignmentImagePalette = DEFAULT_ALIGNMENT_IMAGE_PALETTE,
): string {
  const layout = computeAlignmentImageLayout(sourceFor(rows), options);
  const svg = renderAlignmentImageSvg(rows, molecule, scheme, layout, 'Fixture <alignment> & "export"', palette);
  return createHash('sha256').update(svg).digest('hex');
}

const FIXTURES: Array<{
  name: string;
  digest: () => string;
}> = [
  {
    name: 'dna nucleotide view with letters, elision and escaping',
    digest: () => svgDigest(DNA_ROWS, 'dna', 'nucleotide', {
      scope: 'view',
      columns: [
        ...Array.from({ length: 12 }, (_, column) => ({ kind: 'column' as const, column })),
        { kind: 'elision' as const, startColumn: 12, endColumn: 20, hiddenCount: 8 },
        ...Array.from({ length: 18 }, (_, offset) => ({ kind: 'column' as const, column: 20 + offset })),
      ],
      cellWidth: 12.3,
      cellHeight: 16.7,
      fontSize: 11,
    }),
  },
  {
    name: 'dna auto scheme whole alignment on a dark palette',
    digest: () => svgDigest(DNA_ROWS, 'dna', 'auto', { scope: 'all', cellWidth: 14, cellHeight: 18, fontSize: 12 }, DARK_PALETTE),
  },
  {
    name: 'rna nucleotide whole alignment without letters',
    digest: () => svgDigest(DNA_ROWS, 'rna', 'nucleotide', { scope: 'all', cellWidth: 3.7, cellHeight: 5.3 }),
  },
  {
    name: 'dna without a colour scheme',
    digest: () => svgDigest(DNA_ROWS, 'dna', null, { scope: 'view', startColumn: 3, endColumn: 30, cellWidth: 12, cellHeight: 16, fontSize: 11 }),
  },
  ...(['clustal', 'hydrophobicity', 'taylor', 'auto'] as const).map((scheme) => ({
    name: `protein ${scheme} whole alignment`,
    digest: () => svgDigest(PROTEIN_ROWS, 'protein', scheme, { scope: 'all', cellWidth: 9.5, cellHeight: 14.25, fontSize: 10 }),
  })),
  {
    name: 'protein taylor fitted birdseye',
    digest: () => svgDigest(PROTEIN_ROWS, 'protein', 'taylor', { scope: 'all', maxWidth: 640 }, DARK_PALETTE),
  },
];

const EXPECTED_DIGESTS: Record<string, string> = {
  'dna nucleotide view with letters, elision and escaping': '9ed88498855a86396f8c12396039a9095b9047c91a782cda68ebd6817d9c4513',
  'dna auto scheme whole alignment on a dark palette': 'b258ebeecf709e3a662b2e0b93df584bddba20f2b848089180d77473493394a3',
  'rna nucleotide whole alignment without letters': '72f4fdf8e99ffd2c58e656fd229e0ddbf46598c8ad54206c2d47d162190aa355',
  'dna without a colour scheme': 'ca4dbbb6eefc58d6ddd6f2a6577b62dd09a5a06a7213b022f6cc182a95217de1',
  'protein clustal whole alignment': '97dd5a9499b070dd5d02b0ea86c3ee4395cbff094c97e0cffebf7bb5553bf26e',
  'protein hydrophobicity whole alignment': '8561bec32f8392f0215514cd6d685682daf2ab764d5a5071b8d77214725066f4',
  'protein taylor whole alignment': '6a2f39a7d4955fcc9507315e69d646da47577a5322ff691a4375a1da458b289b',
  'protein auto whole alignment': '97dd5a9499b070dd5d02b0ea86c3ee4395cbff094c97e0cffebf7bb5553bf26e',
  'protein taylor fitted birdseye': 'ea4280e3fb67705fc863b335126003749057462f0ce66e9415a9ec0a3a39cd88',
};

describe('alignment SVG export stability', () => {
  it('covers every fixture with a recorded digest', () => {
    expect(FIXTURES.map((fixture) => fixture.name).sort()).toEqual(Object.keys(EXPECTED_DIGESTS).sort());
  });

  for (const fixture of FIXTURES) {
    it(`renders a byte-identical document: ${fixture.name}`, () => {
      expect(fixture.digest()).toBe(EXPECTED_DIGESTS[fixture.name]);
    });
  }

  it('exercises painted cells, residue letters and elisions', () => {
    const layout = computeAlignmentImageLayout(sourceFor(DNA_ROWS), {
      scope: 'view',
      columns: [
        { kind: 'column', column: 0 },
        { kind: 'elision', startColumn: 1, endColumn: 7, hiddenCount: 6 },
        { kind: 'column', column: 7 },
        { kind: 'column', column: 12 },
      ],
      cellWidth: 12,
      cellHeight: 16,
      fontSize: 11,
    });
    expect(layout.drawLetters).toBe(true);
    const svg = renderAlignmentImageSvg(DNA_ROWS, 'dna', 'nucleotide', layout, 'Fixture', DEFAULT_ALIGNMENT_IMAGE_PALETTE);
    expect(svg).toContain('>⋯6⋯</text>');
    expect(svg).toContain('>a</text>');
    expect(svg).not.toContain('>.</text>');
    expect(svg).toContain('Template &lt;ref&gt; &amp; &quot;primary&quot;');
    expect(svg.match(/<rect x="[0-9.]+" y="[0-9.]+" width="[0-9.]+" height="[0-9.]+" fill="#/g)?.length ?? 0).toBeGreaterThan(4);
  });
});
