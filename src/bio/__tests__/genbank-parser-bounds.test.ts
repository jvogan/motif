import { describe, expect, it } from 'vitest';
import {
  hasGenBankLocus,
  parseFeatures,
  parseGenBank,
  QUALIFIER_TRUNCATED_SUFFIX,
  QUALIFIER_VALUE_MAX_BYTES,
} from '../genbank-parser';

describe('bounded GenBank text scans', () => {
  const recordLines = ['LOCUS sample 4 bp DNA', 'ORIGIN', '        1 ac gt', '//'];

  it('keeps a terminator-shaped line inside a quoted feature note', () => {
    const first = [
      recordLines[0],
      'FEATURES             Location/Qualifiers',
      '     CDS             <1..>4',
      '                     /note="first ""quoted"" line',
      '                     //',
      '                     last line"',
      '                     /translation="M',
      '                     K*"',
      ...recordLines.slice(1),
    ];
    const [sample, second] = parseGenBank([...first, 'LOCUS second 4 bp DNA', ...recordLines.slice(1, -1)].join('\r\n'));
    expect(sample).toMatchObject({
      name: 'sample', sequence: 'acgt',
      features: [{
        start: 0, end: 4,
        metadata: { motifOriginalLocation: '<1..>4', motifLocationFuzzy: true, note: 'first "quoted" line // last line', translation: 'MK*' },
      }],
    });
    expect(second).toMatchObject({ name: 'second', sequence: 'acgt', truncated: undefined });
  });

  it('still ends a record at an indented // outside a feature note', () => {
    for (const terminator of ['   //  ', '\t//', '  //']) {
      const lines = [...recordLines.slice(0, -1), terminator];
      const records = parseGenBank([...lines, ...lines].join('\n'));
      expect(records).toHaveLength(2);
      for (const record of records) expect(record).toMatchObject({ name: 'sample', sequence: 'acgt', truncated: undefined });
    }
  });

  it('keeps the sequence across mixed line endings and flags a missing terminator', () => {
    expect(parseGenBank(recordLines.join('\r'))[0]).toMatchObject({ sequence: 'acgt', truncated: undefined });
    const unmeasured = ['LOCUS sample', ...recordLines.slice(1, -1)].join('\n');
    expect(parseGenBank(unmeasured)[0].truncated?.reason).toMatch(/\/\/.*no length/);
    const short = recordLines.slice(0, -1).join('\n').replace('4 bp', '6 bp');
    expect(parseGenBank(short)[0].truncated?.reason).toMatch(/\/\/.*4 of the 6 bp/);
  });

  it('names the missing terminator when two records run together after ORIGIN', () => {
    const second = recordLines.join('\n').replace('sample', 'second');
    expect(() => parseGenBank(`${recordLines.slice(0, -1).join('\n')}\n${second}`))
      .toThrow('GenBank record is missing its // terminator before the next LOCUS.');
  });

  it('accepts a complete record without its final terminator and ignores text after the last record', () => {
    expect(parseGenBank(recordLines.slice(0, -1).join('\n'))[0]).toMatchObject({ sequence: 'acgt', truncated: undefined });
    expect(parseGenBank(recordLines.slice(0, -1).join('\r\n'))[0]).toMatchObject({ sequence: 'acgt', truncated: undefined });
    const trailing = parseGenBank(`${recordLines.join('\n')}\nExported by a lab notebook\n`);
    expect(trailing.map((record) => record.truncated)).toEqual([undefined, undefined]);
    expect(trailing[1].sequence).toBe('');
  });

  it('does not discard misplaced ORIGIN punctuation or admit unclosed qualifiers', () => {
    expect(() => parseGenBank(recordLines.join('\n').replace('ac gt', 'ac /gt')))
      .toThrow(/ORIGIN/);
    expect(() => parseFeatures('     misc_feature    1..2\n                     /note="unfinished'))
      .toThrow(/unclosed/i);
    expect(parseFeatures('     constructor     1..2')[0].type).toBe('custom');
    expect(parseFeatures('     CDS             1..4\n                     /translation="M""K"')[0].metadata.translation)
      .toBe('M"K');
  });

  it('recognizes indented LOCUS lines across LF and CRLF without treating whitespace as a record', () => {
    for (const newline of ['\n', '\r\n', '\u2028']) {
      const blanks = newline.repeat(80_000);
      expect(hasGenBankLocus(`prefix${blanks}suffix`)).toBe(false);
      expect(hasGenBankLocus(`prefix${blanks} \tLOCUS sample`)).toBe(true);
    }
  });

  it('preserves interior whitespace in comments', () => {
    const space = ' '.repeat(80_000);
    const input = [
      'LOCUS sample 4 bp DNA',
      `COMMENT     before${space}after   `,
      'ORIGIN', `        1 ${'a'.repeat(4)}`, '//',
    ].join('\n');
    expect(parseGenBank(input)[0].comment).toBe(`before${space}after`);
  });

  it('counts wrapped qualifier bytes and retains a complete Unicode prefix at the cap', () => {
    const line = 'é'.repeat(64);
    const repeats = 8_200;
    const wrap = (tail: string, count: number) => parseFeatures([
      '     misc_feature    1..2',
      `                     /note="${line}`,
      ...Array.from({ length: count - 1 }, () => `                     ${line}`),
      `                     ${tail}"`,
    ].join('\n'))[0].metadata;
    const short = wrap('😀""', 3);
    expect(short.note).toBe(`${line} ${line} ${line} 😀"`);
    const large = wrap('😀""', repeats);
    const note = large.note as string;
    const original = `${line} `.repeat(repeats) + '😀"';
    const encoder = new TextEncoder();
    expect(note.endsWith(QUALIFIER_TRUNCATED_SUFFIX)).toBe(true);
    expect(original.startsWith(note.slice(0, -QUALIFIER_TRUNCATED_SUFFIX.length))).toBe(true);
    const retainedBytes = encoder.encode(note).byteLength;
    expect(retainedBytes).toBeGreaterThanOrEqual(QUALIFIER_VALUE_MAX_BYTES - 1);
    expect(retainedBytes).toBeLessThanOrEqual(QUALIFIER_VALUE_MAX_BYTES);
    expect(large.motifQualifierTruncations).toMatchObject([{
      key: 'note', originalBytes: encoder.encode(original).byteLength, retainedBytes,
    }]);
  });
});
