import { describe, expect, it } from 'vitest';
import { parseGenBank } from '../../bio/genbank-parser';
import { parseArtifactDatabaseJson } from '../claude-science-session';
import {
  genBankRelabelNote,
  normalizeRecord,
  parseImportedRecords,
  toGenBankLite,
  validateRuntimeRecordInputs,
} from '../motif-artifact';

// INSDC writes every molecule in DNA letters: an NCBI mRNA record has t, never u.
const bases = 'atggctagcaaaggagaagaacttttcactggagttgtcccaattcttgttgaattagat';
function locusFile(name: string, molecule: string, origin = bases): string {
  return [
    `LOCUS       ${name.padEnd(16, ' ')} ${String(origin.length).padStart(11, ' ')} bp ${molecule.includes('-') ? molecule.slice(0, 3) : '   '}${(molecule.includes('-') ? molecule.slice(3) : molecule).padEnd(6, ' ')}  linear   PRI 23-MAR-2024`,
    `DEFINITION  ${name} test transcript.`,
    `ACCESSION   ${name}`,
    'FEATURES             Location/Qualifiers',
    '     CDS             1..60',
    '                     /product="test protein"',
    'ORIGIN',
    `        1 ${origin.match(/.{1,10}/g)!.join(' ')}`,
    '//',
  ].join('\n');
}
const importOne = (text: string) => {
  const records = parseImportedRecords(text, '', 'auto', 'linear');
  expect(records).toHaveLength(1);
  return records[0];
};
const locusColumns = (line: string) => ({ strand: line.slice(44, 47), molecule: line.slice(47, 53).trim(), topology: line.slice(55, 63).trim() });

describe('GenBank records whose LOCUS names an RNA', () => {
  it('imports an mRNA written in DNA letters as DNA with the bases unchanged', () => {
    const record = importOne(locusFile('NM_TEST', 'mRNA'));
    expect(record).toMatchObject({ molecule: 'dna', seq: bases, provenance: { genbankMolecule: 'mRNA' } });
    // The runtime validator used to refuse it: "its sequence is not valid DNA, RNA, or protein".
    expect(() => validateRuntimeRecordInputs([record], 'motifAddRecords', true)).not.toThrow();
    expect(normalizeRecord(record, 0)).toMatchObject({ type: 'dna', sequence: bases.toUpperCase() });
  });

  it('reads RNA, rRNA, tRNA and ss-RNA the same way and keeps each token', () => {
    for (const molecule of ['RNA', 'rRNA', 'tRNA', 'ss-RNA']) {
      expect(importOne(locusFile('NR_TEST', molecule))).toMatchObject({ molecule: 'dna', provenance: { genbankMolecule: molecule } });
    }
    // A strandedness prefix keeps INSDC's spelling of mRNA rather than upper-casing it.
    const [parsed] = parseGenBank(locusFile('NM_TEST', 'ss-mRNA'));
    expect([parsed.strandedness, parsed.moleculeType]).toEqual(['ss', 'mRNA']);
  });

  it('keeps an RNA LOCUS whose ORIGIN uses u as RNA, exactly as before', () => {
    const rnaBases = bases.replace(/t/g, 'u');
    const record = importOne(locusFile('RNA_U', 'RNA', rnaBases));
    expect(record.molecule).toBe('rna');
    expect(record.seq).toBe(rnaBases);
    expect(normalizeRecord(record, 0)).toMatchObject({ type: 'rna', sequence: rnaBases.toUpperCase() });
    expect(record.provenance?.genbankMolecule).toBeUndefined();
    expect(genBankRelabelNote([record])).toBeNull();
    expect(locusColumns(toGenBankLite(normalizeRecord(record, 0)!, 'linear').split('\n')[0]).molecule).toBe('RNA');
  });

  it('names the record in one notice line, and counts several', () => {
    const mrna = importOne(locusFile('NM_TEST', 'mRNA'));
    const ncrna = importOne(locusFile('NR_TEST', 'ss-RNA'));
    const dna = importOne(locusFile('NC_TEST', 'DNA'));
    expect(genBankRelabelNote([dna, mrna])).toBe('NM_TEST is mRNA written in DNA letters; imported as DNA');
    expect(genBankRelabelNote([ncrna])).toBe('NR_TEST is ss-RNA written in DNA letters; imported as DNA');
    expect(genBankRelabelNote([mrna, dna, ncrna])).toBe('2 records are RNA written in DNA letters; imported as DNA');
    expect(genBankRelabelNote([dna])).toBeNull();
  });

  it('writes the LOCUS token back in its NCBI columns and round-trips unchanged', () => {
    for (const molecule of ['mRNA', 'ss-RNA']) {
      const vector = normalizeRecord(importOne(locusFile('NM_TEST', molecule)), 0)!;
      const first = toGenBankLite(vector, 'linear');
      const locus = first.split('\n')[0];
      expect(locusColumns(locus)).toEqual({ strand: molecule === 'ss-RNA' ? 'ss-' : '   ', molecule: molecule.replace('ss-', ''), topology: 'linear' });
      expect(locus).toHaveLength(79);
      expect(first).toContain(`        1 ${bases.match(/.{1,10}/g)!.join(' ')}`);
      const again = normalizeRecord(importOne(first), 0)!;
      expect([again.type, again.sequence, again.provenance?.genbankMolecule]).toEqual(['dna', vector.sequence, molecule]);
      expect(toGenBankLite(again, 'linear')).toBe(first);
    }
  });

  it('writes the plain token once the record is no longer the DNA it was imported as, or the token is not an INSDC value', () => {
    const vector = normalizeRecord(importOne(locusFile('NM_TEST', 'mRNA')), 0)!;
    const molecule = (patch: Partial<typeof vector>) => locusColumns(toGenBankLite({ ...vector, ...patch }, 'linear').split('\n')[0]).molecule;
    expect(molecule({ type: 'rna', sequence: vector.sequence.replace(/T/g, 'U') })).toBe('RNA');
    expect(molecule({ type: 'protein', sequence: 'MASKGEELFTGVVPILVELD' })).toBe('');
    expect(molecule({ provenance: { genbankMolecule: 'ncRNA' } })).toBe('DNA');
    expect(molecule({ provenance: { genbankMolecule: 'mRNA\nORIGIN' } })).toBe('DNA');
    expect(molecule({ provenance: { genbankMolecule: 7 } })).toBe('DNA');
    expect(molecule({ provenance: undefined })).toBe('DNA');
  });

  it('keeps the token through a Database JSON checkpoint the validators accept', () => {
    const record = importOne(locusFile('NM_TEST', 'mRNA'));
    const database = parseArtifactDatabaseJson(JSON.stringify({ schema: 'motif.claude-science.inventory.v2', records: [record] }));
    const [restored] = database!.records as typeof record[];
    expect(() => validateRuntimeRecordInputs([restored], 'motifRenderInventory', true)).not.toThrow();
    expect(normalizeRecord(restored, 0)?.provenance).toEqual({ genbankMolecule: 'mRNA', genbankAccession: 'NM_TEST' });
  });
});
