import { describe, expect, it } from 'vitest';
import { InvalidSequenceCharacterError, normalizeSequenceStrict } from '../sequence-normalization';

describe('strict direct sequence normalization', () => {
  it('removes only explicit formatting whitespace', () => {
    expect(normalizeSequenceStrict('AT GC\n\tAT', 'dna')).toBe('ATGCAT');
  });

  it('reports the original offset and character for invalid input', () => {
    expect(() => normalizeSequenceStrict('AT-GC', 'dna')).toThrowError(
      expect.objectContaining({
        name: 'InvalidSequenceCharacterError',
        offset: 2,
        character: '-',
      }),
    );
    expect(() => normalizeSequenceStrict('AT\u00a0GC', 'dna')).toThrowError(InvalidSequenceCharacterError);
  });
});
