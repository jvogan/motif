import { describe, expect, it } from 'vitest';
import { containsDisallowedRepositoryLanguage } from '../check-repository-language.mjs';

const disallowedWords = (separator = '') => [
  String.fromCharCode(119, 101, 116),
  separator,
  String.fromCharCode(108, 97, 98),
].join('');

describe('repository language policy', () => {
  it('rejects compact, spaced, and hyphenated variants without flagging neutral language', () => {
    expect(containsDisallowedRepositoryLanguage(disallowedWords())).toBe(true);
    expect(containsDisallowedRepositoryLanguage(disallowedWords(' '))).toBe(true);
    expect(containsDisallowedRepositoryLanguage(disallowedWords('-'))).toBe(true);
    expect(containsDisallowedRepositoryLanguage('experimental planning')).toBe(false);
  });
});
