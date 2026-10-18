import { describe, expect, it } from 'vitest';
import { normalizeRecord, parseImportedRecords, toGenBankLite } from '../motif-artifact';

// Basic GenBank export keeps every line within the GenBank line width, so strict
// readers accept the file, and the wrapped text reads back as it was written. A
// single token longer than a line is never split, since a reader rejoins free
// text with a space; it sits on a line of its own instead.

const protein = `M${'ASTKLVQEGRNDHPYW'.repeat(9)}`;
const coding = `ATG${'GCT'.repeat(protein.length - 1)}TAA`;
const sequence = `${coding}${'GATC'.repeat(30)}`;
const longNote = 'This coding sequence was codon optimized for expression in a bacterial host and carries a silent change near its start that removes an internal restriction site.';
const definition = 'Synthetic expression construct carrying a codon optimized coding sequence under an inducible promoter with a long descriptive definition line.';
const keywords = 'synthetic construct; expression vector; codon optimized; inducible promoter; selectable marker';
const organismName = 'Escherichia coli';
const lineage = 'Bacteria; Pseudomonadota; Gammaproteobacteria; Enterobacterales; Enterobacteriaceae; Escherichia.';
const organism = `${organismName} ${lineage}`;
const longLabel = 'Codon_optimized_coding_sequence_with_an_extended_identifier_0123456789';
const xref = 'https://example.org/records/registry/parts/collections/2026/entries/BBa_K0000001_long_identifier';
const probe = 'ACGTTGCAAGCTTGGATCCGAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCACTGGCCGTCGTTTTAC';
const probeNote = `hybridization probe ${probe} binds here`;
const urlDefinition = `Construct described at https://example.org/constructs/registry/entries/2026/expression/vector/0001/long-path-segment and in the notes.`;

function originLines(bases: string): string {
  const lines: string[] = [];
  for (let index = 0; index < bases.length; index += 60) {
    const chunk = bases.slice(index, index + 60).toLowerCase().match(/.{1,10}/g)!.join(' ');
    lines.push(`${String(index + 1).padStart(9, ' ')} ${chunk}`);
  }
  return lines.join('\n');
}

// The source file is written the long way, one value per line, as some tools do.
const source = [
  `LOCUS       wrapped             ${String(sequence.length).padStart(11, ' ')} bp    DNA     linear   SYN 01-JAN-2026`,
  `DEFINITION  ${definition}`,
  'ACCESSION   wrapped',
  `KEYWORDS    ${keywords}.`,
  'SOURCE      synthetic DNA construct',
  `  ORGANISM  ${organismName}`,
  `            ${lineage}`,
  'FEATURES             Location/Qualifiers',
  `     CDS             1..${coding.length}`,
  '                     /label="Coding"',
  `                     /note="${longNote}"`,
  `                     /translation="${protein}"`,
  `     misc_feature    ${coding.length + 1}..${coding.length + 40}`,
  `                     /label="${longLabel}"`,
  `                     /db_xref="${xref}"`,
  `                     /note="${probeNote}"`,
  'ORIGIN',
  originLines(sequence),
  '//',
].join('\n');

// A line over the width is allowed only when it holds one unbreakable token
// after its indent and any qualifier or header label.
function overlongLines(lines: readonly string[]): string[] {
  return lines.filter((line) => line.length > 79).filter((line) => {
    const value = line.replace(/^ *(?:[A-Z]+ +|\/[A-Za-z_]+=)?"?/, '').replace(/"$/, '');
    return /\s/.test(value);
  });
}

function importOne(text: string) {
  const [input] = parseImportedRecords(text, '', 'auto', 'linear');
  return normalizeRecord(input, 0)!;
}

describe('Basic GenBank line width', () => {
  it('wraps header fields and qualifier values and reads them back intact', () => {
    const imported = importOne(source);
    const exported = toGenBankLite(imported, 'linear');
    const lines = exported.split('\n');
    expect(overlongLines(lines)).toEqual([]);
    // The three unbreakable values are the only lines over the width.
    expect(lines.filter((line) => line.length > 79).map((line) => line.trim())).toEqual([
      `/label="${longLabel}"`,
      `/db_xref="${xref}"`,
      probe,
    ]);

    // Header continuations sit under the value column, qualifier ones under the
    // qualifier column.
    const definitionAt = lines.findIndex((line) => line.startsWith('DEFINITION  '));
    expect(lines[definitionAt + 1]).toMatch(/^ {12}\S/);
    expect(lines).toContain(`KEYWORDS    ${keywords.slice(0, keywords.lastIndexOf(' ', 67))}`);
    // The name alone on the ORGANISM line, the lineage indented under it.
    const organismAt = lines.indexOf(`  ORGANISM  ${organismName}`);
    expect(organismAt).toBeGreaterThan(0);
    expect(lines[organismAt + 1]).toMatch(/^ {12}Bacteria; Pseudomonadota;/);
    const translationAt = lines.findIndex((line) => line.startsWith('                     /translation="'));
    expect(lines[translationAt + 1]).toMatch(/^ {21}[A-Z]/);

    const again = importOne(exported);
    const cds = again.features.find((feature) => feature.name === 'Coding')!;
    expect(cds.metadata.translation).toBe(protein);
    expect(cds.metadata.note).toBe(longNote);
    expect(again.description).toBe(definition);
    const misc = again.features.find((feature) => feature.type !== 'cds')!;
    expect(misc.name).toBe(longLabel);
    const xrefs = (misc.metadata.motifQualifiers as Array<{ key: string; value: string }>)
      .filter((qualifier) => qualifier.key === 'db_xref').map((qualifier) => qualifier.value);
    expect(xrefs).toEqual([xref]);
    expect(misc.metadata.note).toBe(probeNote);
    expect(again.organism).toBe(organism);
    expect(again.provenance?.genbankKeywords).toBe(keywords);
    expect(again.sequence).toBe(sequence);
    // A second pass writes the same file.
    expect(toGenBankLite(again, 'linear')).toBe(exported);
  });

  it('writes an empty keyword list and no organism line when the record has neither', () => {
    const plain = normalizeRecord({ id: 'plain', name: 'plain', molecule: 'dna', topology: 'linear', seq: 'ACGT'.repeat(20) }, 0)!;
    const lines = toGenBankLite(plain, 'linear').split('\n');
    expect(lines).toContain('KEYWORDS    .');
    expect(lines.some((line) => line.includes('ORGANISM'))).toBe(false);
    expect(lines.filter((line) => line.length > 79)).toEqual([]);
  });

  it('keeps an organism name whole when its lineage starts with a rank that has no semicolon', () => {
    // The first lineage rank of a synthetic construct is "other sequences",
    // so a split at the first `;` would move "other" onto the name line.
    const synthetic = source
      .replace(`  ORGANISM  ${organismName}`, '  ORGANISM  synthetic construct')
      .replace(`            ${lineage}`, '            other sequences; artificial sequences.');
    const imported = importOne(synthetic);
    expect(imported.organism).toBe('synthetic construct other sequences; artificial sequences.');
    const lines = toGenBankLite(imported, 'linear').split('\n');
    const organismAt = lines.indexOf('  ORGANISM  synthetic construct');
    expect(organismAt).toBeGreaterThan(0);
    expect(lines[organismAt + 1]).toBe('            other sequences; artificial sequences.');
    expect(importOne(lines.join('\n')).organism).toBe(imported.organism);
  });

  it('keeps a long URL in DEFINITION whole', () => {
    const imported = importOne(source.replace(`DEFINITION  ${definition}`, `DEFINITION  ${urlDefinition}`));
    const exported = toGenBankLite(imported, 'linear');
    expect(overlongLines(exported.split('\n'))).toEqual([]);
    expect(importOne(exported).description).toBe(urlDefinition);
  });
});
