import { describe, expect, it } from 'vitest';
import { FastaParseError, parseFasta } from '../fasta-parser';

describe('FASTA input integrity', () => {
  it('rejects digits and punctuation with original line, column, and offset', () => {
    expect(() => parseFasta('>record\nACG?T\n')).toThrowError(FastaParseError);

    try {
      parseFasta('>record\nACG?T\n');
      throw new Error('expected FASTA parsing to fail');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'invalid_sequence_character',
        line: 2,
        column: 4,
        offset: 11,
        character: '?',
      });
      expect(error).toHaveProperty('message', expect.stringContaining('invalid character "?"'));
    }
  });

  it('allows formatting whitespace and preserves documented gap accounting', () => {
    expect(parseFasta('>aligned\nAC- G\tT.\n')).toEqual([expect.objectContaining({
      header: 'aligned',
      sequence: 'ACGT',
      gapsRemoved: 2,
    })]);
  });

  it('rejects non-ASCII whitespace instead of silently changing the sequence', () => {
    expect(() => parseFasta('>record\nACG\u00a0T\n')).toThrowError(/invalid character/iu);
  });
});
