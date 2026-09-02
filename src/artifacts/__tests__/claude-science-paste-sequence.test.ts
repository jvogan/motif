import { describe, it, expect } from 'vitest';
import { parsePastedSequence, sequenceLinesFromPaste } from '../claude-science-paste-sequence';

const DNA = 'ACGTRYSWKMBDHVN';
const PROTEIN = 'ACDEFGHIKLMNPQRSTVWYOUJBXZ*';

describe('parsePastedSequence', () => {
  it('keeps a bare sequence exactly as pasted', () => {
    const parsed = parsePastedSequence('ATGCATGC', DNA);
    expect(parsed).toEqual({
      ok: true,
      sequence: 'ATGCATGC',
      error: null,
      format: 'plain',
      fastaRecordCount: 0,
      genbankRecordCount: 0,
      droppedLines: 0,
      droppedCharacters: 0,
    });
  });

  it('drops a FASTA header instead of filtering it into bases', () => {
    // The reported bug: `>gi|12345|ref|NM_001` survives a character filter as
    // GRNM, because every one of those four is a legal IUPAC ambiguity code, and
    // renders in the canvas as ordinary sequence.
    const bare = 'ATGCATGC'.split('').filter((c) => DNA.includes(c)).join('');
    const naive = '>gi|12345|ref|NM_001\nATGCATGC'
      .toUpperCase().split('').filter((c) => DNA.includes(c)).join('');
    expect(naive).toBe(`GRNM${bare}`);

    const parsed = parsePastedSequence('>gi|12345|ref|NM_001\nATGCATGC', DNA);
    expect(parsed.sequence).toBe('ATGCATGC');
    expect(parsed.ok).toBe(true);
    expect(parsed.format).toBe('fasta');
    expect(parsed.fastaRecordCount).toBe(1);
    expect(parsed.droppedLines).toBe(1);
    expect(parsed.droppedCharacters).toBe(0);
  });

  it('drops a protein FASTA header whose letters are all legal residues', () => {
    // A per-character filter cannot defend a protein record at all: every letter
    // of `sp|P69905|HBA_HUMAN` is a residue. Only the line rule saves it.
    const parsed = parsePastedSequence('>sp|P69905|HBA_HUMAN\nMVLSPADKTN', PROTEIN);
    expect(parsed.sequence).toBe('MVLSPADKTN');
    expect(parsed.droppedLines).toBe(1);
  });

  it('rejects multi-record DNA FASTA atomically instead of joining records', () => {
    const parsed = parsePastedSequence(
      '>one description\nATGC\nATGC\n>two description\nGGGG\n',
      DNA,
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('multiple-fasta-records');
    expect(parsed.sequence).toBe('');
    expect(parsed.fastaRecordCount).toBe(2);
    expect(parsed.droppedLines).toBe(2);
    expect(parsed.droppedCharacters).toBe(0);
  });

  it('rejects multi-record protein FASTA atomically', () => {
    const parsed = parsePastedSequence('>alpha\nMVLSPADKTN\n>beta\nGASQAGAP', PROTEIN);
    expect(parsed).toMatchObject({
      ok: false,
      sequence: '',
      error: 'multiple-fasta-records',
      format: 'fasta',
      fastaRecordCount: 2,
    });
  });

  it('recognises leading-space headers and rejects an empty second record', () => {
    const parsed = parsePastedSequence('   >one\nATGC\n\t>empty second record\n', DNA);
    expect(parsed).toMatchObject({
      ok: false,
      sequence: '',
      error: 'multiple-fasta-records',
      fastaRecordCount: 2,
    });
  });

  it('drops semicolon comments without counting them as FASTA records', () => {
    const parsed = parsePastedSequence('>one\n; first comment\nATGC\n  ; second comment\nATGC', DNA);
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'ATGCATGC',
      error: null,
      format: 'fasta',
      fastaRecordCount: 1,
      droppedLines: 3,
    });
  });

  it('takes only the ORIGIN block out of a GenBank record', () => {
    const genbank = [
      'LOCUS       SYNPUC19V     2686 bp    DNA     circular SYN',
      'DEFINITION  Cloning vector pUC19c, complete sequence.',
      'SOURCE      Cloning vector pUC19c',
      'FEATURES             Location/Qualifiers',
      '     CDS             146..469',
      'ORIGIN',
      '        1 tcgcgcgttt cggtgatgac',
      '       21 ggtgaaaacc',
      '//',
    ].join('\n');
    const parsed = parsePastedSequence(genbank, DNA);
    expect(parsed.sequence).toBe('TCGCGCGTTTCGGTGATGACGGTGAAAACC');
    expect(parsed.format).toBe('genbank');
    expect(parsed.fastaRecordCount).toBe(0);
    expect(parsed.genbankRecordCount).toBe(1);
    // Nothing outside ORIGIN reaches the alphabet filter, so nothing is reported
    // as a rejected character — the metadata was recognised, not discarded.
    expect(parsed.droppedCharacters).toBe(0);
  });

  it('recognises real protein GenBank when ORIGIN is also valid protein', () => {
    const genbank = [
      'LOCUS       PEPTIDE       7 aa     linear',
      'DEFINITION  Demonstrates alphabet-aware format detection.',
      'ORIGIN',
      '        1 peptide',
      '//',
    ].join('\n');
    const parsed = parsePastedSequence(genbank, PROTEIN);
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'PEPTIDE',
      format: 'genbank',
      fastaRecordCount: 0,
      genbankRecordCount: 1,
      droppedCharacters: 0,
    });
  });

  it('keeps an ambiguous headerless numbered protein ORIGIN block as sequence', () => {
    const parsed = parsePastedSequence('MKW\nORIGIN\n        1 peptide', PROTEIN);
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'MKWORIGINPEPTIDE',
      format: 'plain',
      genbankRecordCount: 0,
    });
  });

  it('rejects concatenated GenBank records atomically', () => {
    const parsed = parsePastedSequence([
      'LOCUS       FIRST       4 bp    DNA',
      'ORIGIN',
      '        1 atgc',
      '//',
      'LOCUS       SECOND      4 bp    DNA',
      'ORIGIN',
      '        1 gggg',
      '//',
    ].join('\n'), DNA);

    expect(parsed).toMatchObject({
      ok: false,
      sequence: '',
      error: 'multiple-genbank-records',
      format: 'genbank',
      fastaRecordCount: 0,
      genbankRecordCount: 2,
      droppedCharacters: 0,
    });
  });

  it('rejects a second GenBank record even when its ORIGIN block is missing', () => {
    const parsed = parsePastedSequence([
      'LOCUS       FIRST       4 bp    DNA',
      'ORIGIN',
      '        1 atgc',
      '//',
      'LOCUS       TRUNCATED   4 bp    DNA',
      'DEFINITION  second record was copied without its sequence block',
      '//',
    ].join('\n'), DNA);

    expect(parsed).toMatchObject({
      ok: false,
      sequence: '',
      error: 'multiple-genbank-records',
      genbankRecordCount: 2,
    });
  });

  it('does not pair LOCUS and ORIGIN across a record terminator', () => {
    const parsed = parsePastedSequence([
      'LOCUS       PEPTIDE       7 aa',
      '//',
      'ORIGIN',
      'PEPTIDE',
    ].join('\n'), PROTEIN);

    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'LOCUSPEPTIDEAAORIGINPEPTIDE',
      format: 'plain',
      genbankRecordCount: 0,
    });
  });

  it('keeps repeated bare protein ORIGIN lines as sequence', () => {
    const parsed = parsePastedSequence([
      'ORIGIN',
      'PEPTIDE',
      'ORIGIN',
      'MKW',
    ].join('\n'), PROTEIN);

    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'ORIGINPEPTIDEORIGINMKW',
      format: 'plain',
      genbankRecordCount: 0,
    });
  });

  it('rejects concatenated GenBank records when the first terminator is missing', () => {
    const parsed = parsePastedSequence([
      'LOCUS       FIRST       4 bp    DNA',
      'ORIGIN',
      '        1 atgc',
      'LOCUS       SECOND      4 bp    DNA',
      'ORIGIN',
      '        1 gggg',
      '//',
    ].join('\n'), DNA);

    expect(parsed).toMatchObject({
      ok: false,
      sequence: '',
      error: 'multiple-genbank-records',
      genbankRecordCount: 2,
    });
  });

  it('recognises indented lowercase record markers in CRLF text', () => {
    const parsed = parsePastedSequence([
      '  locus       first       4 bp    dna',
      '  origin',
      '        1 atgc',
      '  //  ',
      '\tlocus       second      4 bp    dna',
      '\torigin',
      '        1 gggg',
      '\t//',
    ].join('\r\n'), DNA);

    expect(parsed).toMatchObject({
      ok: false,
      sequence: '',
      error: 'multiple-genbank-records',
      genbankRecordCount: 2,
    });
  });

  it('does not invent another record from duplicate terminators or trailing prose', () => {
    const parsed = parsePastedSequence([
      'LOCUS       ONLY        4 bp    DNA',
      'ORIGIN',
      '        1 atgc',
      '//',
      '//',
      'Copied from a sequence report.',
    ].join('\n'), DNA);

    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'ATGC',
      format: 'genbank',
      genbankRecordCount: 1,
    });
  });

  it('does not treat continuation-column prose as structural markers', () => {
    const parsed = parsePastedSequence([
      'LOCUS       ONLY        4 bp    DNA',
      'DEFINITION  Demonstrates continuation text.',
      '            LOCUS-specific wording remains metadata.',
      'COMMENT     Another continuation follows.',
      '            ORIGIN tracking was recorded separately.',
      'ORIGIN',
      '        1 atgc',
      '//',
    ].join('\n'), DNA);

    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'ATGC',
      format: 'genbank',
      genbankRecordCount: 1,
    });
  });

  it('does not mistake an origin feature key for the ORIGIN sequence section', () => {
    const parsed = parsePastedSequence([
      'LOCUS       ONLY        4 bp    DNA',
      'FEATURES             Location/Qualifiers',
      '     origin          1..4',
      'ORIGIN',
      '        1 atgc',
      '//',
    ].join('\n'), DNA);

    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'ATGC',
      format: 'genbank',
      genbankRecordCount: 1,
    });
  });

  it('does not treat GenBank keywords as structure in an ordinary peptide paste', () => {
    // TITLE, SOURCE, ORGANISM and ORIGIN are all spellable in the supported
    // protein alphabet. A keyword-only rule would silently lose the first two
    // peptide lines after seeing ORIGIN.
    const parsed = parsePastedSequence('MKW\nORIGIN\nPEPTIDE', PROTEIN);
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'MKWORIGINPEPTIDE',
      format: 'plain',
      genbankRecordCount: 0,
      droppedLines: 0,
      droppedCharacters: 0,
    });
  });

  it('keeps an indented lowercase ORIGIN line when it is valid protein', () => {
    const parsed = parsePastedSequence('MKW\n  origin  \nPEPTIDE', PROTEIN);
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'MKWORIGINPEPTIDE',
      format: 'plain',
      genbankRecordCount: 0,
      droppedLines: 0,
    });
  });

  it('does not treat a longer protein line beginning with ORIGIN as a marker', () => {
    const parsed = parsePastedSequence('MKW\nORIGINPEPTIDE\nORIGIN PEPTIDE', PROTEIN);
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'MKWORIGINPEPTIDEORIGINPEPTIDE',
      format: 'plain',
      genbankRecordCount: 0,
    });
  });

  it('does not use a bare protein LOCUS line to corroborate protein ORIGIN', () => {
    const parsed = parsePastedSequence('LOCUS\nORIGIN\nPEPTIDE', PROTEIN);
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'LOCUSORIGINPEPTIDE',
      format: 'plain',
      genbankRecordCount: 0,
      droppedLines: 0,
    });
  });

  it('gives an explicit FASTA header precedence over GenBank-like protein lines', () => {
    const parsed = parsePastedSequence([
      '>protein',
      'LOCUS PEPTIDE 7 aa',
      'ORIGIN',
      'PEPTIDE',
    ].join('\n'), PROTEIN);
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'LOCUSPEPTIDEAAORIGINPEPTIDE',
      format: 'fasta',
      fastaRecordCount: 1,
      genbankRecordCount: 0,
      droppedLines: 1,
    });
  });

  it('does not count angle-bracketed GenBank metadata as a FASTA header', () => {
    const parsed = parsePastedSequence(
      'LOCUS       DEMO        4 bp    DNA\nDEFINITION  >not a FASTA record\nORIGIN\n        1 atgc\n//',
      DNA,
    );
    expect(parsed).toMatchObject({
      ok: true,
      sequence: 'ATGC',
      format: 'genbank',
      fastaRecordCount: 0,
    });
  });

  it('counts letters the alphabet rejects, and ignores whitespace and line numbers', () => {
    const parsed = parsePastedSequence('  1 ATGC ATGC\n  9 ATGZZ\n', DNA);
    expect(parsed.sequence).toBe('ATGCATGCATG');
    expect(parsed.droppedCharacters).toBe(2);
  });

  it('reports an all-rejected paste as empty rather than returning silence', () => {
    const parsed = parsePastedSequence('ZZZZ', DNA);
    expect(parsed.sequence).toBe('');
    expect(parsed.droppedCharacters).toBe(4);
  });

  it('keeps an RNA alphabet honest about T', () => {
    const parsed = parsePastedSequence('AUGCAUGC', 'ACGURYSWKMBDHVN');
    expect(parsed.sequence).toBe('AUGCAUGC');
    expect(parsePastedSequence('ATGC', 'ACGURYSWKMBDHVN').droppedCharacters).toBe(1);
  });

  it('returns nothing for empty input without reporting a loss', () => {
    expect(parsePastedSequence('', DNA)).toEqual({
      ok: true,
      sequence: '',
      error: null,
      format: 'plain',
      fastaRecordCount: 0,
      genbankRecordCount: 0,
      droppedLines: 0,
      droppedCharacters: 0,
    });
  });
});

describe('sequenceLinesFromPaste', () => {
  it('does not count blank lines as structure', () => {
    // A wrapped FASTA paste ends with a newline; reporting that as a dropped line
    // would make every ordinary paste look lossy.
    expect(sequenceLinesFromPaste('ATGC\n\nATGC\n').droppedLines).toBe(0);
  });

  it('runs an unterminated GenBank block to the end of the text', () => {
    const { lines } = sequenceLinesFromPaste([
      'LOCUS       DEMO        8 bp    DNA',
      'ORIGIN',
      '        1 atgc',
      '       5 gggg',
    ].join('\n'));
    expect(lines).toEqual(['        1 atgc', '       5 gggg']);
  });
});
