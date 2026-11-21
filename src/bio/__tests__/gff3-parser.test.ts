import { describe, expect, it } from 'vitest';
import { gff3SequenceRegionEnds, isGff3, parseGff3Features, splitGff3 } from '../gff3-parser';

const row = (...columns: string[]) => columns.join('\t');

describe('GFF3 reading', () => {
  it('recognises version 3 with or without a minor and patch number', () => {
    expect(isGff3('##gff-version 3\n')).toBe(true);
    expect(isGff3('##gff-version 3.1.26\r\n')).toBe(true);
    expect(isGff3('##gff-version 2\n')).toBe(false);
    expect(isGff3('##gff-version 30\n')).toBe(false);
  });

  it('reads the declared region ends and finds the ##FASTA section across CRLF', () => {
    const text = ['##gff-version 3', '##sequence-region chr1 1 12', '##sequence-region chr2 1 8', '##FASTA', '>chr1', 'ACGT', ''].join('\r\n');
    expect([...gff3SequenceRegionEnds(text)]).toEqual([['chr1', 12], ['chr2', 8]]);
    expect(splitGff3(text)?.fasta).toBe('>chr1\r\nACGT\r\n');
  });

  it('keeps a bare percent sign as written and decodes %XX escapes', () => {
    const features = parseGff3Features(row('chr1', 'x', 'gene', '1', '4', '.', '+', '.', 'ID=g;Note=45% identity;Name=lac%20Z%3B%C3%A9'));
    expect(features.get('chr1')?.[0]).toMatchObject({ name: 'lac Z;é', metadata: { note: '45% identity' } });
  });

  it('reads a line with no attribute column and names what is wrong with a malformed line', () => {
    expect(parseGff3Features(row('chr1', 'x', 'gene', '2', '4', '.', '-', '.')).get('chr1')?.[0])
      .toMatchObject({ name: 'gene', start: 1, end: 4, strand: -1 });
    expect(() => parseGff3Features(row('chr1', 'x', 'gene', '1', '4', '.', '+')))
      .toThrow('GFF3 line 1 has 7 tab-separated columns, not 9. Fix the line and retry.');
    expect(() => parseGff3Features(`#\n${row('chr1', 'x', 'gene', '5', '4', '.', '+', '.', 'ID=g')}`))
      .toThrow('GFF3 line 2 needs a start and end from 1 up, with the start no greater than the end. Fix the line and retry.');
    expect(() => parseGff3Features(row('chr1', 'x', 'gene', '1', '4', '.', 'plus', '.', 'ID=g')))
      .toThrow('GFF3 line 1 has strand "plus"; use +, -, . or ?. Fix the line and retry.');
  });
});
