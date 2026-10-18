import { describe, expect, it } from 'vitest';
import { parseGenBank } from '../genbank-parser';

const SEQUENCE = 'atgaaagcgtaa';

function record(trailer: string): string {
  return [
    'LOCUS       TESTSEQ                   12 bp    DNA     linear   SYN 01-JAN-2000',
    'DEFINITION  Feature-table boundary fixture.',
    'FEATURES             Location/Qualifiers',
    '     source          1..12',
    '                     /organism="synthetic construct"',
    '     CDS             1..12',
    '                     /note="short coding',
    '                     sequence"',
    '                     /translation="MKA"',
    trailer,
    'ORIGIN',
    `        1 ${SEQUENCE.slice(0, 10)} ${SEQUENCE.slice(10)}`,
    '//',
    '',
  ].join('\n');
}

function cds(text: string) {
  const [parsed] = parseGenBank(text);
  const feature = parsed.features.find((candidate) => candidate.type === 'cds');
  return { parsed, feature };
}

describe('GenBank feature-table boundary', () => {
  it('does not glue a legacy BASE COUNT line onto the last qualifier', () => {
    const { parsed, feature } = cds(record('BASE COUNT        5 a      1 c      3 g      3 t'));
    expect(feature?.metadata.translation).toBe('MKA');
    expect(feature?.metadata.note).toBe('short coding sequence');
    expect(parsed.sequence).toBe(SEQUENCE);
    expect(parsed.truncated).toBeUndefined();
  });

  it('ignores a multi-line CONTIG block after the feature table', () => {
    const { parsed, feature } = cds(record([
      'CONTIG      join(AB000001.1:1..6,',
      '            AB000002.1:1..6)',
    ].join('\n')));
    expect(feature?.metadata.translation).toBe('MKA');
    expect(parsed.features).toHaveLength(2);
    expect(parsed.sequence).toBe(SEQUENCE);
  });

  it('ends the feature table at any other top-level keyword line', () => {
    const { parsed, feature } = cds(record('WGS         ABCD01000001-ABCD01000010'));
    expect(feature?.metadata.translation).toBe('MKA');
    expect(parsed.sequence).toBe(SEQUENCE);
  });

  it('keeps both features around a column-0 qualifier continuation and reports it', () => {
    const text = [
      'LOCUS       TESTSEQ                   12 bp    DNA     linear   SYN 01-JAN-2000',
      'FEATURES             Location/Qualifiers',
      '     misc_feature    1..6',
      '                     /note="first line',
      'continued at column zero"',
      '     misc_feature    7..12',
      '                     /note="second"',
      'ORIGIN',
      `        1 ${SEQUENCE.slice(0, 10)} ${SEQUENCE.slice(10)}`,
      '//',
      '',
    ].join('\n');
    const [parsed] = parseGenBank(text);
    expect(parsed.features).toHaveLength(2);
    const [first, second] = parsed.features;
    expect(first.metadata.note).toBe('first line continued at column zero');
    expect(first.metadata.motifImportDiagnostics).toEqual([expect.objectContaining({
      severity: 'warning',
      code: 'unindented_feature_line',
      featureKey: 'misc_feature',
      location: '1..6',
    })]);
    expect(first.metadata.motifLocationQuarantined).toBeUndefined();
    expect(second.metadata.note).toBe('second');
    expect(second.metadata.motifImportDiagnostics).toBeUndefined();
    expect(parsed.importDiagnostics).toEqual([expect.objectContaining({ code: 'unindented_feature_line' })]);
    expect(parsed.sequence).toBe(SEQUENCE);
  });

  it('ends the table cleanly at BASE COUNT without a diagnostic', () => {
    const { parsed, feature } = cds(record('BASE COUNT        5 a      1 c      3 g      3 t'));
    expect(feature?.metadata.translation).toBe('MKA');
    expect(feature?.metadata.motifImportDiagnostics).toBeUndefined();
    expect(parsed.importDiagnostics).toBeUndefined();
  });
});
