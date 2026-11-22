import { describe, expect, it, vi } from 'vitest';
import type { Feature } from '../../bio/types';
import { MOTIF_MAX_IMPORT_FILE_BYTES, readArtifactImportText, readArtifactUtf8Text, stageArtifactFileImport } from '../claude-science-file-import';
import { FOREIGN_ZIP_REASON, legacyEncodingNote, unreadableFileReason } from '../claude-science-import-feedback';
import { normalizeRecord, parseImportedRecords, toFasta, toGff3Lite } from '../motif-artifact';
import { MAX_ARTIFACT_RECORDS, parseArtifactImportJson } from '../claude-science-session';

function file(name: string, size: number, text = ''): File {
  return { name, size, type: '', text: vi.fn(async () => text) } as unknown as File;
}

describe('file intake staging', () => {
  it.each(['file', 'paste'] as const)('round-trips a single FASTA identifier and description from %s', (source) => {
    const input = '>sp|P42212|GFP_AEQVI Green fluorescent protein\nMVSKGEEL';
    const [record] = parseImportedRecords(input, source === 'file' ? 'prot' : '', 'auto', 'linear', [], source);
    expect(record).toMatchObject({
      name: 'sp|P42212|GFP_AEQVI', description: 'Green fluorescent protein', seq: 'MVSKGEEL',
    });
    const normalized = normalizeRecord(record, 0)!;
    const exported = toFasta(normalized.name, normalized.sequence, normalized.description);
    expect(exported).toBe(input);
    expect(parseImportedRecords(exported, 'download', 'auto', 'linear', [], 'file')[0])
      .toMatchObject({ name: record.name, description: record.description, seq: record.seq });
  });

  it('reimports embedded GFF3 sequence and annotations', () => {
    const record = normalizeRecord({
      name: 'example',
      seq: 'ACGTACGT',
      annotations: [
        { id: 'p', name: 'original; name', type: 'promoter', start: 0, end: 2, strand: 0 },
        {
          id: 'c', name: 'joined CDS', type: 'cds', start: 2, end: 8, strand: -1,
          subRanges: [{ start: 6, end: 8, strand: -1 }, { start: 2, end: 4, strand: -1 }],
          metadata: { motifSubRangeOrder: 'biological', codon_start: '2', transl_table: '11' },
        },
      ],
    }, 0)!;
    const [imported] = parseImportedRecords(toGff3Lite(record), 'download', 'auto', 'linear', [], 'file');
    expect(imported).toMatchObject({
      name: 'example', seq: record.sequence,
      annotations: [
        { id: 'p', name: 'original; name', type: 'promoter', start: 0, end: 2, strand: 0 },
        {
          id: 'c', name: 'joined CDS', type: 'cds', start: 2, end: 8, strand: -1,
          subRanges: record.features[1].subRanges,
          metadata: { motifSubRangeOrder: 'biological', codon_start: '2', transl_table: '11' },
        },
      ],
    });
  });

  it.each(['circular', 'linear'] as const)('round-trips a %s GFF3 record with its name, coordinates and qualifiers', (topology) => {
    const sequence = 'ACGTACGTACGT';
    const name = topology === 'circular' ? 'pUC19' : 'Linear β; record';
    const annotations: Partial<Feature>[] = [
      { id: 'p', name: 'Forward; promoter', type: 'promoter', start: 0, end: 3, strand: 1, metadata: { note: '45% activity; verified' } },
      { id: 'c', name: 'Reverse CDS', type: 'cds', start: 4, end: 10, strand: -1, metadata: { codon_start: '2', transl_table: '11' } },
    ];
    if (topology === 'circular') {
      annotations.push({
        id: 'o', name: 'Across the origin', type: 'cds', start: 0, end: 12, strand: -1,
        subRanges: [{ start: 0, end: 2, strand: -1 }, { start: 9, end: 12, strand: -1 }],
        metadata: { motifSubRangeOrder: 'biological', codon_start: '3', transl_table: '11', note: 'origin, both ends' },
      });
    }
    const record = normalizeRecord({ name, topology, seq: sequence, annotations }, 0)!;
    const exported = toGff3Lite(record);
    const [imported] = parseImportedRecords(exported, 'download', 'auto', 'linear', [], 'file');
    expect.soft(imported).toMatchObject({ name, topology, seq: sequence });
    expect.soft(imported.seq).toHaveLength(sequence.length);
    expect.soft(imported.annotations).toMatchObject(annotations);
    if (topology === 'circular') {
      expect(exported).toMatch(/^puc19\tMotif\tregion\t1\t12\t[^\n]*\bIs_circular=true(?:;|$)/m);
    }
  });

  it('imports a GFF3 without Is_circular with the import topology, linear by default, and keeps an ordinary region annotation', () => {
    const input = [
      '##gff-version 3', '##sequence-region legacy 1 4',
      'legacy\tMotif\tregion\t1\t4\t.\t.\t.\tID=r;Name=Whole%20record',
      '##FASTA', '>legacy', 'ACGT',
    ].join('\n');
    for (const topology of ['linear', 'circular'] as const) {
      expect(parseImportedRecords(input, 'download', 'auto', topology, [], 'file')).toMatchObject([
        { name: 'legacy', topology, annotations: [{ id: 'r', name: 'Whole record', start: 0, end: 4 }] },
      ]);
    }
  });

  it('reads Is_circular from the landmark feature of another tool’s GFF3, whatever its type or line', () => {
    const gff3 = (rows: string[]) => ['##gff-version 3.1.26', '##sequence-region J02448 1 8', ...rows, '##FASTA', '>J02448', 'ACGTACGT'].join('\n');
    const gene = 'J02448\tGenBank\tgene\t2\t5\t.\t-\t.\tID=g;Name=II;';
    // The specification's example: strand +, an ID, and a trailing semicolon.
    expect(parseImportedRecords(gff3([gene, 'J02448\tGenBank\tregion\t1\t8\t.\t+\t.\tID=J02448;Name=J02448;Is_circular=true;']), 'f1', 'auto', 'linear', [], 'file'))
      .toMatchObject([{ name: 'J02448', topology: 'circular', annotations: [{ name: 'II', start: 1, end: 5, strand: -1 }] }]);
    const [chromosome] = parseImportedRecords(gff3(['J02448\tOther\tchromosome\t1\t8\t.\t.\t.\tID=J02448;Name=chrF;Is_circular=true', gene]), 'f1', 'auto', 'linear', [], 'file');
    expect(chromosome).toMatchObject({ name: 'J02448', topology: 'circular' });
    expect(chromosome.annotations?.map((feature) => feature.name)).toEqual(['chrF', 'II']);
    // On a feature that does not span the sequence, the attribute says nothing about the record.
    expect(parseImportedRecords(gff3(['J02448\tOther\tgene\t2\t5\t.\t-\t.\tID=g;Is_circular=true']), 'f1', 'auto', 'linear', [], 'file'))
      .toMatchObject([{ topology: 'linear' }]);
  });

  it('refuses a GFF3 whose sequence is shorter than its region and reports features with no sequence', () => {
    const gff3 = (fasta: string) => [
      '##gff-version 3.1.26', '##sequence-region chr1 1 8',
      'chr1\tx\tgene\t1\t8\t.\t+\t.\tID=g1', 'chr2\tx\tgene\t1\t2\t.\t+\t.\tID=g2', 'chr2\tx\tgene\t3\t4\t.\t-\t.\tID=g3',
      '##FASTA', '>chr1', fasta,
    ].join('\r\n');
    expect(() => parseImportedRecords(gff3('ACGTAC'), 'x', 'auto', 'linear', [], 'file'))
      .toThrow('The ##FASTA sequence chr1 holds 6 residues, but its ##sequence-region declares 8. Import the complete file and retry.');
    const skipped: { record?: string; reason: string }[] = [];
    const [record] = parseImportedRecords(gff3('ACGTACGT'), 'x', 'auto', 'linear', skipped, 'file');
    expect(record).toMatchObject({ name: 'chr1', seq: 'ACGTACGT', annotations: [{ id: 'g1', start: 0, end: 8, strand: 1 }] });
    expect(skipped).toEqual([{ record: 'chr2', reason: '2 GFF3 features name this sequence ID, which has no ##FASTA entry, so they were left out.' }]);
    expect(() => parseImportedRecords('##gff-version 3\nchr1\tx\tgene\t1\t8\t.\t+\t.\tID=g1', '', 'auto', 'linear', [], 'paste'))
      .toThrow('This GFF3 has features but no sequence, so import a GenBank or FASTA file, or a GFF3 with a ##FASTA section.');
  });

  it('explains how to import a GFF3 that only contains annotations', () => {
    const input = ['##gff-version 3', 'example\tMotif\tgene\t1\t4\t.\t+\t.\tID=g'].join('\n');
    expect(unreadableFileReason({ name: 'example.gff3' }, input))
      .toBe('this GFF3 has features but no sequence, so import a GenBank or FASTA file, or a GFF3 with a ##FASTA section');
  });

  it('directs a workspace ZIP to inventory.json', async () => {
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(26, 'inventory.json'.length, true);
    const archive = new Blob([header, 'inventory.json']);
    await expect(readArtifactImportText(archive))
      .rejects.toThrow('this is a Motif workspace ZIP, so extract inventory.json and import it');
  });

  it('imports lowercase protein residues from FASTA in Auto', () => {
    expect(parseImportedRecords('>peptide\r\nmk\r\n\r\nel', 'download', 'auto', 'linear', [], 'file'))
      .toMatchObject([{ name: 'peptide', molecule: 'protein', seq: 'MKEL' }]);
    expect(parseImportedRecords('>transcript\nacgu\nacgu', '', 'auto', 'linear', [], 'paste'))
      .toMatchObject([{ name: 'transcript', molecule: 'rna', seq: 'ACGUACGU' }]);
  });

  it('still refuses prose under a FASTA header in Auto', () => {
    for (const source of ['paste', 'file'] as const) {
      const skipped: { record?: string; reason: string }[] = [];
      expect(parseImportedRecords('> Thanks for the plasmid\nsee you tomorrow', 'x', 'auto', 'linear', skipped, source)).toEqual([]);
      expect(skipped).toMatchObject([{ reason: expect.stringContaining('set Molecule to Protein') }]);
    }
  });

  it('uses the fallback for a blank FASTA identifier and preserves a terminal protein stop', () => {
    const [record] = parseImportedRecords('>\r\nmk\r\n\r\nel*', 'peptide', 'auto', 'linear', [], 'file');
    expect(record).toMatchObject({ name: 'peptide', description: '', molecule: 'protein', seq: 'MKEL*' });
    const skipped: { record?: string; reason: string }[] = [];
    const records = parseImportedRecords(
      '>pipe|id\r\nac\r\n\r\ngt\r\n>tabbed\tdescription\r\ntt\r\n>empty', 'download', 'auto', 'linear', skipped, 'file',
    );
    expect(records).toMatchObject([
      { name: 'pipe|id', description: '', seq: 'ACGT' },
      { name: 'tabbed', description: 'description', seq: 'TT' },
    ]);
    expect(skipped).toMatchObject([{ record: 'empty', reason: expect.stringContaining('has no residues') }]);
  });

  it('respects an amino-acid LOCUS even when every letter is also a base', () => {
    const record = ['LOCUS       peptide 4 aa linear', 'ORIGIN', '        1 acgt', '//'].join('\n');
    expect(parseImportedRecords(record, '', 'auto', 'linear', [], 'file'))
      .toMatchObject([{ name: 'peptide', molecule: 'protein', seq: 'acgt' }]);
  });

  it('rejects invalid UTF-8 after the first 4 KiB and preserves valid Unicode', async () => {
    const invalid = new Blob([' '.repeat(4_097), new Uint8Array([0xc3, 0x28])]);
    await expect(Promise.resolve().then(() => readArtifactUtf8Text(invalid))).rejects.toThrow(/UTF-8/);
    const valid = new Blob(['\uFEFF>valid \uFFFD\rAC\r\nGT\n']);
    const text = await readArtifactUtf8Text(valid);
    expect(text).toBe('>valid \uFFFD\nAC\r\nGT\n');
    expect(unreadableFileReason({ type: 'text/plain' }, text)).toBeNull();
  });

  it('still names images, archives and SnapGene files as such when their bytes are not UTF-8', async () => {
    const ascii = (value: string) => Array.from(new TextEncoder().encode(value));
    const cases: Array<[string, string, number[], string]> = [
      ['image.png', 'image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00], 'not a sequence file'],
      // No NUL here: the other control bytes alone mark the archive as binary.
      ['notes.docx', '', [0x50, 0x4b, 0x03, 0x04, 0x14, 0x06, 0xc8, 0xff], 'not a sequence file'],
      // A ZIP that is not a workspace export says what to do with it.
      ['sequences.zip', 'application/zip', [0x50, 0x4b, 0x03, 0x04, 0x14, 0x06, 0xc8, 0xff], FOREIGN_ZIP_REASON],
      ['plasmid.dna', '', [0x09, 0x00, 0x00, 0x00, 0x0e, ...ascii('SnapGene'), 0xff, 0xfe],
        'the SnapGene .dna format is not supported yet. Export it as GenBank or FASTA and retry'],
      // Legacy-encoded text with no control characters other than line breaks is not binary.
      ['legacy.gb', '', [...ascii('LOCUS x\r\n  AUTHORS Z'), 0xfc, 0x76, 0x0a, 0x1a], ''],
    ];
    for (const [name, type, bytes, reason] of cases) {
      const { text, encoding } = await readArtifactImportText(new Blob([new Uint8Array(bytes)]));
      expect(encoding, name).toBe('windows-1252');
      expect(unreadableFileReason({ name, type }, text, encoding) ?? '', name).toBe(reason);
    }
  });

  it('reads a GenBank file saved as Windows-1252 with its symbols intact and says so', async () => {
    const lines = [
      'LOCUS       sample                 12 bp    DNA     linear',
      '  AUTHORS   Zülvak,A. and Torína,B.',
      'FEATURES             Location/Qualifiers',
      '     promoter        1..6',
      '                     /note="37°C, 5 µg; 5’ end – “strong”"',
      'ORIGIN',
      '        1 atgcatgcat gc',
      '//',
    ];
    const cp1252: Record<string, number> = { 'ü': 0xfc, 'í': 0xed, '°': 0xb0, 'µ': 0xb5, '’': 0x92, '–': 0x96, '“': 0x93, '”': 0x94 };
    const bytes = Uint8Array.from(Array.from(lines.join('\r\n')), (character) => cp1252[character] ?? character.charCodeAt(0));
    const { text, encoding } = await readArtifactImportText(new Blob([bytes]));
    expect(encoding).toBe('windows-1252');
    expect(unreadableFileReason({ name: 'sample.gb', type: '' }, text, encoding)).toBeNull();
    const [record] = parseImportedRecords(text, 'sample', 'auto', 'linear', [], 'file');
    expect(record).toMatchObject({ seq: 'atgcatgcatgc' });
    expect(JSON.stringify(record)).toContain('37°C, 5 µg; 5’ end – “strong”');
    expect(legacyEncodingNote(['sample.gb'])).toBe('sample.gb is not UTF-8; read as Windows-1252, so check accented letters and symbols');
    expect(legacyEncodingNote(['a.gb', 'b.fa'])).toMatch(/^2 files are not UTF-8/);
    expect(legacyEncodingNote([])).toBeNull();
  });

  it('rejects aggregate bytes and file count before invoking a reader', async () => {
    const stage = vi.fn(async (input: File) => { await input.text(); return undefined; });
    const half = Math.floor(MOTIF_MAX_IMPORT_FILE_BYTES / 2);
    const oversized = [file('first.fa', half), file('second.fa', half + 1)];
    expect(await stageArtifactFileImport(oversized, stage)).toMatchObject({ kind: 'rejected' });
    expect(await stageArtifactFileImport(Array(MAX_ARTIFACT_RECORDS + 1).fill(oversized[0]), stage))
      .toMatchObject({ kind: 'rejected' });
    expect(stage).not.toHaveBeenCalled();
    expect(oversized[0].text).not.toHaveBeenCalled();
    expect(oversized[1].text).not.toHaveBeenCalled();
  });

  it('discards staged records when a checkpoint is mixed in and leaves later files unread', async () => {
    const first = file('first.fa', 12);
    const checkpoint = file('backup.json', 14, '{"records":[]}');
    const last = file('last.fa', 12);
    const stagedRecords: string[] = [];
    const priorWorkspace = ['open-record'];
    const result = await stageArtifactFileImport([first, checkpoint, last], async (input) => {
      const json = parseArtifactImportJson(await input.text());
      if (json.kind === 'database') return { kind: 'database', value: { file: input, database: json.value } };
      stagedRecords.push(input.name);
    });
    if (result.kind === 'records') priorWorkspace.push(...stagedRecords);
    expect(result).toMatchObject({ kind: 'rejected', message: expect.stringContaining('one Workspace JSON file') });
    expect(priorWorkspace).toEqual(['open-record']);
    expect(first.text).toHaveBeenCalledOnce();
    expect(checkpoint.text).toHaveBeenCalledOnce();
    expect(last.text).not.toHaveBeenCalled();
  });
});
