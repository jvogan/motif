import { describe, expect, it } from 'vitest';
import {
  normalizeSha256Hex,
  sha256HexSync,
} from '../claude-science-sha256';

describe('sha256HexSync', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'The quick brown fox jumps over the lazy dog',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
    ['é🧬', 'e851758ecd27e7fd3d1d70913d383c729ba13fa6156c4bf551caa146570423a8'],
  ])('matches the published SHA-256 vector for %j', (input, expected) => {
    expect(sha256HexSync(input)).toBe(expected);
  });

  it.each([
    [55, '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
    [56, 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    [64, 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb'],
  ])('handles the SHA-256 padding boundary at %i bytes', (length, expected) => {
    expect(sha256HexSync('a'.repeat(length))).toBe(expected);
  });

  it('hashes exact UTF-8 input without implicit biological normalization', () => {
    expect(sha256HexSync('ACGT')).not.toBe(sha256HexSync('acgt'));
    expect(sha256HexSync('ACGT')).not.toBe(sha256HexSync('ACGT\n'));
  });
});

describe('normalizeSha256Hex', () => {
  it('accepts a 64-character digest and normalizes hex casing', () => {
    expect(normalizeSha256Hex('AB'.repeat(32))).toBe('ab'.repeat(32));
  });

  it('rejects malformed or padded digests instead of silently changing them', () => {
    expect(() => normalizeSha256Hex('f'.repeat(63))).toThrow(/64-character SHA-256/i);
    expect(() => normalizeSha256Hex(` ${'f'.repeat(64)}`)).toThrow(/64-character SHA-256/i);
    expect(() => normalizeSha256Hex('g'.repeat(64))).toThrow(/64-character SHA-256/i);
  });
});
