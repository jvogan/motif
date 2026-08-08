import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containsDisallowedRepositoryLanguage, githubEventMetadataViolations } from '../check-repository-language.mjs';

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

  it('checks public pull-request and repository metadata from the GitHub event payload', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-language-event-'));
    const eventPath = join(directory, 'event.json');
    writeFileSync(eventPath, JSON.stringify({
      repository: { name: 'motif', description: 'Molecular biology workbench', topics: ['bioinformatics'] },
      pull_request: { title: `Disallowed ${disallowedWords(' ')} wording`, body: 'neutral body', head: { ref: 'topic' }, base: { ref: 'main' } },
    }));
    try {
      expect(githubEventMetadataViolations({ GITHUB_EVENT_PATH: eventPath })).toMatchObject({
        violations: ['GitHub event metadata: pull request title'],
        fields: 17,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
