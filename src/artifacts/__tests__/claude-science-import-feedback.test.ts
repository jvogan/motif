import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLUSTAL_IMPORT_REASON,
  describeFileImportOutcome,
  duplicateOfOpenRecord,
  describeImportPreflight,
  describeSequenceRejection,
  explainUnimportedFile,
  explainUnimportedPaste,
  looksLikeBinaryText,
  unreadableFileReason,
  type ImportSkip,
} from '../claude-science-import-feedback';
import { stripOriginPositionNumbers } from '../claude-science-paste-sequence';
import { parseImportedRecords } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start);
  expect(end, `missing end marker after ${startNeedle}: ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

// The first two ORIGIN rows of the public demo construct, copied the way most
// sequence sources copy them: with the position counter at the start of each row.
const ORIGIN_ROWS = [
  '        1 atggctagca aaggagaaga acttttcact ggagttgtcc caattcttgt tgaattagat',
  '       61 ggtgatgtta atgggcacaa',
].join('\n');
const ORIGIN_SEQUENCE = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATGGTGATGTTAATGGGCACAA';

describe('describeSequenceRejection', () => {
  it("reports the normaliser's character and position instead of a fixed sentence", () => {
    // The measured case: "ATGCATGC1" with Molecule set to Auto, then to DNA, was
    // "No usable sequence found. Choose the molecule type explicitly…", and
    // choosing DNA as advised failed identically.
    expect(describeSequenceRejection('ATGCATGC1', 'auto')).toBe('“1” at position 9 is not a DNA residue.');
    expect(describeSequenceRejection('ATGCATGC1', 'dna')).toBe('“1” at position 9 is not a DNA residue.');
    expect(describeSequenceRejection('ATGC-ATGC', 'auto')).toBe('“-” at position 5 is not a DNA residue.');
    expect(describeSequenceRejection('ACGU1', 'auto')).toBe('“1” at position 5 is not an RNA residue.');
    expect(describeSequenceRejection('MKTAYIAKQR1', 'protein')).toBe('“1” at position 11 is not a protein residue.');
  });

  it('gives line and column for a multi-line paste, counted in the pasted text', () => {
    expect(describeSequenceRejection('ATGCATGC\nAT1GC', 'dna')).toBe('“1” at line 2, column 3 is not a DNA residue.');
  });

  it('names characters that print as nothing', () => {
    expect(describeSequenceRejection('ATGC\u00a0ATGC', 'dna'))
      .toBe('A non-breaking space (U+00A0) at position 5 is not a DNA residue.');
  });

  it('names Protein as the one choice that changes an Auto rejection of plain letters', () => {
    const reason = describeSequenceRejection('The quick brown fox jumps over the lazy dog', 'auto');
    expect(reason).toBe('“e” at position 3 is not a nucleotide. If this is a protein sequence, set Molecule to Protein.');
    // …and the advice works: the same letters are accepted once Protein is chosen.
    expect(describeSequenceRejection('The quick brown fox jumps over the lazy dog', 'protein')).toBeNull();
  });

  it('returns null for text the normaliser accepts', () => {
    expect(describeSequenceRejection('atgc atgc\natgc', 'auto')).toBeNull();
    expect(describeSequenceRejection('MKTAYIAKQRQISFVK', 'auto')).toBeNull();
  });
});

describe('parseImportedRecords skip reporting', () => {
  it('reports why a bare sequence produced no record', () => {
    const skipped: ImportSkip[] = [];
    expect(parseImportedRecords('ATGCATGC1', '', 'dna', 'linear', skipped)).toEqual([]);
    expect(skipped).toEqual([{ reason: '“1” at position 9 is not a DNA residue.' }]);
    expect(explainUnimportedPaste('ATGCATGC1', skipped)).toBe('“1” at position 9 is not a DNA residue.');
  });

  it('names a FASTA record that an explicit molecule type filtered out', () => {
    // With Molecule = DNA the protein record used to vanish, and the panel said
    // "1 record added" for a two-record paste.
    const skipped: ImportSkip[] = [];
    const records = parseImportedRecords('>seqA first\nATGCATGCATGCATGC\n>seqB second\nMKTAYIAKQRQISFVK', '', 'dna', 'linear', skipped);
    expect(records.map((record) => record.name)).toEqual(['seqA']);
    expect(skipped).toEqual([{ record: 'seqB', reason: '“I” at position 6 is not a DNA residue.' }]);
  });

  it('names each record of a multi-record FASTA by its ID and keeps the rest of the header as its description', () => {
    const records = parseImportedRecords('>seqA first one\nATGCATGC\n>seqB\nGGGGCCCC', 'pair', 'auto', 'linear');
    expect(records.map((record) => [record.name, record.id, record.description])).toEqual([
      ['seqA', 'seqa', 'first one'],
      ['seqB', 'seqb', ''],
    ]);
    // One record keeps the file's name, or its whole header when pasted.
    expect(parseImportedRecords('>QAVAR variant\nATGCATGC', 'qavar', 'auto', 'linear')[0].name).toBe('qavar');
    expect(parseImportedRecords('>Wave3 Enzyme Probe\nATGCATGC', '', 'auto', 'linear')[0].name).toBe('Wave3 Enzyme Probe');
  });

  it('says a FASTA header has no sequence rather than reporting its ">"', () => {
    const skipped: ImportSkip[] = [];
    expect(parseImportedRecords('>just a header', '', 'auto', 'linear', skipped)).toEqual([]);
    expect(explainUnimportedPaste('>just a header', skipped)).toBe('The FASTA header has no sequence under it.');
  });

  it('keeps the old two-argument contract: no collector, same records', () => {
    expect(parseImportedRecords('ATGCATGC1', '', 'auto', 'linear')).toEqual([]);
    expect(parseImportedRecords('ATGCATGC', '', 'auto', 'linear')[0]).toMatchObject({ seq: 'ATGCATGC', molecule: 'dna' });
  });
});

describe('numbered paste through the import parser', () => {
  it('imports a GenBank ORIGIN block pasted with its position numbers', () => {
    const prepared = stripOriginPositionNumbers(ORIGIN_ROWS);
    expect(prepared.numberedLines).toBe(2);
    for (const hint of ['auto', 'dna'] as const) {
      const [record] = parseImportedRecords(prepared.text, '', hint, 'linear');
      expect(record).toMatchObject({ seq: ORIGIN_SEQUENCE, molecule: 'dna' });
    }
  });

  it('still rejects a stray character inside a numbered row, at its pasted position', () => {
    const rows = `${ORIGIN_ROWS}\n       81 ggtgxtgtta`;
    const prepared = stripOriginPositionNumbers(rows);
    expect(prepared.numberedLines).toBe(3);
    const skipped: ImportSkip[] = [];
    expect(parseImportedRecords(prepared.text, '', 'dna', 'linear', skipped)).toEqual([]);
    const column = '       81 ggtgxtgtta'.indexOf('x') + 1;
    expect(skipped[0].reason).toBe(`“x” at line 3, column ${column} is not a DNA residue.`);
  });

  it('keeps the number on a row that has other non-sequence characters, and reports it', () => {
    // A trailing count (EMBL-style) is not an ORIGIN row. The digit is reported
    // where it sits in the pasted text rather than silently dropped.
    const prepared = stripOriginPositionNumbers('ATGCATGC 8');
    expect(prepared).toEqual({ text: 'ATGCATGC 8', numberedLines: 0 });
    expect(describeSequenceRejection(prepared.text, 'dna')).toBe('“8” at position 10 is not a DNA residue.');
  });
});

describe('CLUSTAL detection', () => {
  const clustal = 'CLUSTAL W multiple sequence alignment\n\nseqA  ACDEFGHIKL\nseqB  ACDEYGHIKL\n';

  it('points a pasted CLUSTAL alignment at the Alignment tool', () => {
    const skipped: ImportSkip[] = [];
    expect(parseImportedRecords(clustal, '', 'auto', 'linear', skipped)).toEqual([]);
    expect(explainUnimportedPaste(clustal, skipped))
      .toBe('This is a CLUSTAL alignment. Load it from Alignment → Open alignment workspace → Aligned file.');
  });

  it('points a chosen CLUSTAL file at the Alignment tool', () => {
    expect(explainUnimportedFile({ type: 'text/plain' }, clustal, [])).toBe(CLUSTAL_IMPORT_REASON);
  });
});

describe('file reasons', () => {
  it('distinguishes an empty file, a binary file, JSON, and text with no sequence', () => {
    const pngAsText = new TextDecoder().decode(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x3e, 0x00]));
    expect(looksLikeBinaryText(pngAsText)).toBe(true);
    expect(unreadableFileReason({ type: 'image/png' }, pngAsText)).toBe('not a sequence file');
    expect(unreadableFileReason({ type: '' }, '')).toBe('the file is empty');
    expect(unreadableFileReason({ type: 'text/plain' }, '>ok\nACGT')).toBeNull();
    expect(explainUnimportedFile({ type: 'application/json' }, '{"hello": 1}', [])).toBe('not a Record JSON or Database JSON export');
    expect(explainUnimportedFile({ type: 'text/plain' }, 'Meeting notes: reply by Friday.', [{ reason: 'ignored for files' }]))
      .toBe('no sequence found');
    expect(explainUnimportedFile({ type: 'text/plain' }, '>p\nMKTAYI', [{ record: 'p', reason: '“I” at position 6 is not a DNA residue.' }]))
      .toBe('p: “I” at position 6 is not a DNA residue');
  });

  it('names an EMBL or SnapGene file as an unsupported format instead of an empty or broken one', () => {
    const embl = 'ID   PUCEMBL; SV 1; circular; genomic DNA; STD; SYN; 12 BP.\nXX\nSQ   Sequence 12 BP;\n     tcgcgcgttt cg 12\n//\n';
    const emblReason = 'the EMBL format is not supported yet. Export it as GenBank or FASTA and retry';
    expect(explainUnimportedFile({ type: '', name: 'pUC-embl.embl' }, embl, [])).toBe(emblReason);
    expect(explainUnimportedPaste(embl, [{ reason: 'ignored' }]))
      .toBe('The EMBL format is not supported yet. Export it as GenBank or FASTA and retry.');
    const snapGene = new TextDecoder().decode(new Uint8Array([0x09, 0, 0, 0, 0x0e, ...new TextEncoder().encode('SnapGene'), 0x07, 0x07, 0]));
    const snapReason = 'the SnapGene .dna format is not supported yet. Export it as GenBank or FASTA and retry';
    expect(unreadableFileReason({ type: '', name: 'vector.dna' }, snapGene)).toBe(snapReason);
    expect(unreadableFileReason({ type: '', name: 'renamed.bin' }, snapGene)).toBe(snapReason);
    // An empty .dna file is still empty, and FASTA or GenBank text is still read.
    expect(unreadableFileReason({ type: '', name: 'vector.dna' }, '')).toBe('the file is empty');
    expect(unreadableFileReason({ type: '', name: 'a.fasta' }, '>ID   x\nACGT')).toBeNull();
    expect(unreadableFileReason({ type: '', name: 'a.gb' }, 'LOCUS       x 4 bp DNA linear\nORIGIN\n        1 acgt\n//')).toBeNull();
  });
});

describe('describeFileImportOutcome', () => {
  it('reports a clean import as a status', () => {
    expect(describeFileImportOutcome(1, [])).toEqual({ message: 'Imported 1 record', tone: 'status' });
    expect(describeFileImportOutcome(3, [])).toEqual({ message: 'Imported 3 records', tone: 'status' });
  });

  it('names every skipped file in a mixed batch', () => {
    // Measured before: motif-demo.gb + image.png reported only "Imported 1 record".
    expect(describeFileImportOutcome(1, [{ source: 'image.png', reason: 'not a sequence file' }])).toEqual({
      message: 'Imported 1 record · skipped image.png: not a sequence file',
      tone: 'error',
    });
  });

  it('names the file, not only the record, when nothing imports', () => {
    expect(describeFileImportOutcome(0, [{ source: 'image.png', reason: 'not a sequence file' }])).toEqual({
      message: 'image.png: not a sequence file',
      tone: 'error',
    });
  });

  it('lists three skips by name and counts the rest', () => {
    const skipped = ['a.png', 'b.txt', 'c.fasta', 'd.gb', 'e.gb'].map((source) => ({ source, reason: 'no sequence found.' }));
    expect(describeFileImportOutcome(2, skipped).message).toBe(
      'Imported 2 records · skipped a.png: no sequence found · skipped b.txt: no sequence found · skipped c.fasta: no sequence found · 2 more skipped',
    );
  });

  it('names every skip in the detail the Add entry panel keeps on screen', () => {
    // Measured before: 16 records plus 5 bad files left "· 2 more skipped" in both
    // the notice and the panel, so fake.dna and notes.txt never showed a reason.
    const skipped = ['a.png', 'b.txt', 'c.fasta', 'd.gb', 'e.dna'].map((source) => ({ source, reason: 'no sequence found.' }));
    expect(describeFileImportOutcome(2, skipped).detail).toBe(
      'Imported 2 records · skipped a.png: no sequence found · skipped b.txt: no sequence found · skipped c.fasta: no sequence found · skipped d.gb: no sequence found · skipped e.dna: no sequence found',
    );
    // Three or fewer skips: the message already names each one.
    expect(describeFileImportOutcome(0, skipped.slice(3)).detail).toBeUndefined();
  });

  it('ends a reason of two sentences with a full stop and a one-clause reason without one', () => {
    // Measured before: the NCBI contig notice read "…(NCBI format "GenBank (full)"),
    // then retry" on screen although its source sentence ends with a full stop.
    const contig = 'This is an NCBI contig (CON) record: it lists its pieces on a CONTIG line and has no sequence. Download it with its sequence (NCBI format "GenBank (full)"), then retry.';
    expect(describeFileImportOutcome(0, [{ source: 'NG_001152_con.gb', reason: contig }]).message)
      .toBe(`NG_001152_con.gb: ${contig}`);
    // A two-sentence reason written without its full stop gains one, mid-list too.
    const noOrigin = 'the GenBank record has no ORIGIN sequence. Export the complete record and retry';
    expect(describeFileImportOutcome(1, [
      { source: 'broken.gb', reason: noOrigin },
      { source: 'image.png', reason: 'not a sequence file' },
    ]).message).toBe(`Imported 1 record · skipped broken.gb: ${noOrigin}. · skipped image.png: not a sequence file`);
    const embl = 'ID   PUCEMBL; SV 1; circular; genomic DNA; STD; SYN; 12 BP.\nXX\nSQ   Sequence 12 BP;\n     tcgcgcgttt cg 12\n//\n';
    expect(describeFileImportOutcome(0, [{ source: 'pUC.embl', reason: explainUnimportedFile({ type: '', name: 'pUC.embl' }, embl, []) }]).message)
      .toBe('pUC.embl: the EMBL format is not supported yet. Export it as GenBank or FASTA and retry.');
    // A record's own two-sentence reason keeps its full stop behind the record name.
    expect(explainUnimportedFile({ type: 'text/plain' }, '>p\nACGT1', [{ record: 'p', reason: '“1” at position 5 is not a nucleotide. If this is a protein sequence, set Molecule to Protein.' }]))
      .toBe('p: “1” at position 5 is not a nucleotide. If this is a protein sequence, set Molecule to Protein.');
    // One sentence still drops it, as the three-skip list above shows.
    expect(describeFileImportOutcome(0, [{ source: 'a.fasta', reason: '“I” at position 6 is not a DNA residue.' }]).message)
      .toBe('a.fasta: “I” at position 6 is not a DNA residue');
  });
});

describe('duplicateOfOpenRecord', () => {
  const open = [
    { name: 'pUC19', seq: 'ACGT', topology: 'circular' },
    { name: 'SYNPUC19V', seq: 'TTGACAGG', topology: 'circular' },
  ];

  it('names the open record an import repeats exactly', () => {
    // Measured before: choosing M77789.gb four times left five identical
    // "SYNPUC19V · 2,686 bp" rows and said only "Imported 1 record".
    expect(duplicateOfOpenRecord({ name: 'SYNPUC19V', seq: 'ttgacagg', topology: 'circular' }, open)).toBe('SYNPUC19V');
    expect(duplicateOfOpenRecord({ name: ' SYNPUC19V', sequence: 'TTGA CAGG\n', topology: 'circular' }, open)).toBe('SYNPUC19V');
  });

  it('treats a different name, topology or sequence as a new record', () => {
    expect(duplicateOfOpenRecord({ name: 'SYNPUC19V copy', seq: 'TTGACAGG', topology: 'circular' }, open)).toBeNull();
    expect(duplicateOfOpenRecord({ name: 'SYNPUC19V', seq: 'TTGACAGG', topology: 'linear' }, open)).toBeNull();
    expect(duplicateOfOpenRecord({ name: 'SYNPUC19V', seq: 'TTGACAGC', topology: 'circular' }, open)).toBeNull();
    expect(duplicateOfOpenRecord({ name: 'pUC19', seq: 'ACGT' }, open)).toBeNull();
  });
});

describe('describeImportPreflight', () => {
  it('gives each molecule type its own unit', () => {
    // Measured before: "2 records detected · DNA + PROTEIN · 16 bp" for 16 bp of
    // DNA and 16 aa of protein.
    expect(describeImportPreflight([{ type: 'dna', length: 16 }, { type: 'protein', length: 16 }]))
      .toBe('2 records detected · DNA + PROTEIN · 16 bp + 16 aa');
    expect(describeImportPreflight([{ type: 'dna', length: 12 }, { type: 'dna', length: 1_200 }]))
      .toBe('2 records detected · DNA · 12–1,200 bp');
    expect(describeImportPreflight([{ type: 'rna', length: 30 }])).toBe('1 record detected · RNA · 30 nt');
  });

  it('appends notes such as removed line numbers', () => {
    expect(describeImportPreflight([{ type: 'dna', length: 80 }], ['line numbers removed']))
      .toBe('1 record detected · DNA · 80 bp · line numbers removed');
  });
});

describe('import outcome wiring', () => {
  const importFiles = sliceBetween(artifactSource, 'const importFiles = useCallback(', 'const dragHasFiles =');
  const handleDrop = sliceBetween(artifactSource, 'const handleDrop = useCallback(', 'const importMsaRecords =');
  const importPanel = sliceBetween(artifactSource, 'function ImportSequencePanel({', 'function FeatureList({');

  it('sends file-import outcomes to the workbench notice, never the drag-prompt card', () => {
    expect(importFiles).toContain('showWorkbenchNotice(importMessage, tone)');
    expect(importFiles).toContain('describeFileImportOutcome(added, skipped)');
    expect(importFiles).toContain('explainUnimportedFile(file, text, fileSkips)');
    expect(importFiles).not.toContain('setDropState');
    expect(handleDrop).toContain("setDropState({ active: false, message: '' });");
  });

  it('strips ORIGIN numbers on the paste path only', () => {
    expect(importPanel.match(/stripOriginPositionNumbers\(/g)).toHaveLength(2);
    expect(importFiles).not.toContain('stripOriginPositionNumbers');
    expect(importPanel).toContain("prepared.numberedLines > 0 ? ['line numbers removed'] : []");
  });

  it('skips a chosen record that repeats one already open, and says so', () => {
    expect(importFiles).toContain('const repeats = duplicateOfOpenRecord(record, [...payloadRef.current.records, ...importable]);');
    expect(importFiles).toContain('skipped.push({ source, reason: `${repeats} is already in the inventory` });');
  });

  it('mirrors a chosen file import into the Add entry status line', () => {
    expect(importPanel).toContain('onImportFiles: (files: FileList | File[]) => Promise<ArtifactFileImportResult>;');
    expect(importPanel).toContain('setMirroredNotice(result.detail ?? result.message);');
    expect(importPanel).toContain('setStatus(result.detail ?? result.message);');
  });

  it('moves focus into the paste box whenever the panel opens', () => {
    expect(importPanel).toContain('window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));\n    return () => window.cancelAnimationFrame(frame);\n  }, [open]);');
  });
});
