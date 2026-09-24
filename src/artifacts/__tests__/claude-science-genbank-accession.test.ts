import { describe, expect, it } from 'vitest';
import { parseGenBank } from '../../bio/genbank-parser';
import { normalizeRecord, parseImportedRecords, toGenBankLite } from '../motif-artifact';

const bases = 'atggctagcaaaggagaagaacttttcactggagttgtcccaattcttgttgaattagat';
const file = (header: string[]) => [
  'LOCUS       NM_TEST                   60 bp    mRNA    linear   PRI 23-MAR-2024',
  'DEFINITION  test transcript.',
  ...header,
  'FEATURES             Location/Qualifiers',
  '     CDS             1..60',
  '                     /product="test protein"',
  'ORIGIN',
  `        1 ${bases.match(/.{1,10}/g)!.join(' ')}`,
  '//',
].join('\n');
const imported = (text: string) => {
  const records = parseImportedRecords(text, '', 'auto', 'linear');
  expect(records).toHaveLength(1);
  // The workbench stores an import under a slug id, as it does for NM_005410 ("nm-005410").
  return { ...normalizeRecord(records[0], 0)!, id: 'nm-test' };
};
const header = (text: string) => text.split('\n').filter((line) => /^(ACCESSION|VERSION)/.test(line));

describe('Basic GenBank ACCESSION and VERSION', () => {
  it('writes an imported record\'s ACCESSION and VERSION back, not its record id', () => {
    const record = imported(file(['ACCESSION   NM_TEST', 'VERSION     NM_TEST.3']));
    const exported = toGenBankLite(record, 'linear');
    expect(header(exported)).toEqual(['ACCESSION   NM_TEST', 'VERSION     NM_TEST.3']);
    const [again] = parseGenBank(exported);
    expect([again.accession, again.version, again.name]).toEqual(['NM_TEST', 'NM_TEST.3', 'NM_TEST']);
    // The re-imported copy writes the same two lines.
    expect(header(toGenBankLite(imported(exported), 'linear'))).toEqual(header(exported));
  });

  it('keeps secondary accessions and writes no VERSION the file did not have', () => {
    expect(header(toGenBankLite(imported(file(['ACCESSION   U49845 U12345'])), 'linear'))).toEqual(['ACCESSION   U49845 U12345']);
  });

  it('drops the VERSION once the bases change, and writes it again when they come back', () => {
    const record = imported(file(['ACCESSION   NM_TEST', 'VERSION     NM_TEST.3']));
    const edited = { ...record, sequence: `C${record.sequence.slice(1)}` };
    expect(header(toGenBankLite(edited, 'linear'))).toEqual(['ACCESSION   NM_TEST']);
    expect(header(toGenBankLite({ ...record, sequence: `${record.sequence}A` }, 'linear'))).toEqual(['ACCESSION   NM_TEST']);
    expect(header(toGenBankLite({ ...edited, sequence: record.sequence }, 'linear'))).toEqual(['ACCESSION   NM_TEST', 'VERSION     NM_TEST.3']);
  });

  it('writes the record id for a record with no imported accession, as one token', () => {
    const plain = imported(file([]));
    expect(header(toGenBankLite(plain, 'linear'))).toEqual([`ACCESSION   ${plain.id}`]);
    // A derived record starts with its own provenance, so it writes its own id.
    const fragment = { ...plain, id: 'digest-1-fragment-2', provenance: { parentRecordId: 'nm-test', operation: 'restriction_digest' } };
    expect(header(toGenBankLite(fragment, 'linear'))).toEqual(['ACCESSION   digest-1-fragment-2']);
    // An id with a space used to read back as two accessions.
    expect(header(toGenBankLite({ ...plain, id: 'pBluescript SK(+)' }, 'linear'))).toEqual(['ACCESSION   pBluescript_SK(+)']);
  });

  it('ignores a kept accession or version that cannot sit on its line', () => {
    const record = imported(file(['ACCESSION   NM_TEST', 'VERSION     NM_TEST.3']));
    const withProvenance = (provenance: Record<string, unknown>) => header(toGenBankLite({ ...record, provenance: { ...record.provenance, ...provenance } }, 'linear'));
    expect(withProvenance({ genbankAccession: 'NM_TEST\nORIGIN' })).toEqual(['ACCESSION   nm-test']);
    expect(withProvenance({ genbankAccession: 7 })).toEqual(['ACCESSION   nm-test']);
    expect(withProvenance({ genbankVersion: 'NM_TEST .3' })).toEqual(['ACCESSION   NM_TEST']);
  });
});
