import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containsDisallowedRepositoryLanguage, checkRepositoryLanguage, githubEventMetadataViolations } from '../check-repository-language.mjs';

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

  it('fails closed in CI when the event payload is missing or not a bounded regular file', () => {
    expect(() => githubEventMetadataViolations({ CI: 'true' })).toThrow(/requires a GitHub event payload in CI/);

    const directory = mkdtempSync(join(tmpdir(), 'motif-language-event-'));
    const directoryPath = join(directory, 'event-directory');
    const linkPath = join(directory, 'event-link');
    mkdirSync(directoryPath);
    writeFileSync(join(directory, 'event.json'), '{}');
    symlinkSync(join(directory, 'event.json'), linkPath);
    try {
      expect(() => githubEventMetadataViolations({ CI: 'true', GITHUB_EVENT_PATH: directoryPath })).toThrow(/regular file/);
      expect(() => githubEventMetadataViolations({ CI: 'true', GITHUB_EVENT_PATH: linkPath })).toThrow(/regular file/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    const oversized = mkdtempSync(join(tmpdir(), 'motif-language-event-'));
    const oversizedPath = join(oversized, 'event.json');
    writeFileSync(oversizedPath, JSON.stringify({ body: 'x'.repeat(2 * 1024 * 1024) }));
    try {
      expect(() => githubEventMetadataViolations({ CI: 'true', GITHUB_EVENT_PATH: oversizedPath })).toThrow(/size limit/);
    } finally {
      rmSync(oversized, { recursive: true, force: true });
    }
  });

  it('checks fork metadata, labels, comments, reviews, discussions, push messages, and release assets', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-language-event-'));
    const eventPath = join(directory, 'event.json');
    writeFileSync(eventPath, JSON.stringify({
      repository: { name: 'motif', parent: { description: `parent ${disallowedWords()}` } },
      pull_request: {
        title: 'neutral title',
        head: { ref: 'topic', repo: { name: disallowedWords(' ') } },
        base: { ref: 'main', repo: { description: `base ${disallowedWords('-')}` } },
        labels: [{ name: disallowedWords() }],
      },
      comment: { body: `comment ${disallowedWords()}` },
      review: { body: `review ${disallowedWords(' ')}` },
      discussion: { body: `discussion ${disallowedWords('-')}` },
      commits: [{ message: `push ${disallowedWords()}` }],
      release: { assets: [{ name: `asset-${disallowedWords()}.zip` }] },
    }));
    try {
      const result = githubEventMetadataViolations({ GITHUB_EVENT_PATH: eventPath });
      expect(result.violations).toEqual(expect.arrayContaining([
        'GitHub event metadata: pull request head repository metadata.name',
        'GitHub event metadata: pull request base repository metadata.description',
        'GitHub event metadata: pull request labels[0].name',
        'GitHub event metadata: comment metadata.body',
        'GitHub event metadata: review metadata.body',
        'GitHub event metadata: discussion metadata.body',
        'GitHub event metadata: push commit message 1',
        'GitHub event metadata: release asset name 1',
      ]));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('scans every commit message in the explicit event base-to-head range', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-language-history-'));
    const runGit = (args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    const gitEnvironment = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Motif Test',
      GIT_AUTHOR_EMAIL: 'motif-test@example.invalid',
      GIT_COMMITTER_NAME: 'Motif Test',
      GIT_COMMITTER_EMAIL: 'motif-test@example.invalid',
    };
    const commit = (message, content) => {
      writeFileSync(join(directory, 'tracked.txt'), content);
      execFileSync('git', ['add', 'tracked.txt'], { cwd: directory, env: gitEnvironment });
      execFileSync('git', ['commit', '-m', message], { cwd: directory, env: gitEnvironment, stdio: 'ignore' });
      return runGit(['rev-parse', 'HEAD']);
    };
    try {
      execFileSync('git', ['init', '-q'], { cwd: directory });
      execFileSync('git', ['config', 'user.name', 'Motif Test'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'motif-test@example.invalid'], { cwd: directory });
      const base = commit('baseline', 'base');
      commit(`middle ${disallowedWords()}`, 'middle');
      const head = commit('head', 'head');
      const eventPath = join(directory, 'event.json');
      writeFileSync(eventPath, JSON.stringify({ before: base, after: head }));
      expect(() => checkRepositoryLanguage(directory, {
        CI: 'true',
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventPath,
      })).toThrow(/base-to-head commit messages/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('scans all local branch and tag ref names plus their annotations', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-language-refs-'));
    const gitEnvironment = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Motif Test',
      GIT_AUTHOR_EMAIL: 'motif-test@example.invalid',
      GIT_COMMITTER_NAME: 'Motif Test',
      GIT_COMMITTER_EMAIL: 'motif-test@example.invalid',
    };
    try {
      execFileSync('git', ['init', '-q'], { cwd: directory });
      execFileSync('git', ['config', 'user.name', 'Motif Test'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'motif-test@example.invalid'], { cwd: directory });
      writeFileSync(join(directory, 'tracked.txt'), 'neutral');
      execFileSync('git', ['add', 'tracked.txt'], { cwd: directory, env: gitEnvironment });
      execFileSync('git', ['commit', '-m', 'neutral'], { cwd: directory, env: gitEnvironment, stdio: 'ignore' });
      execFileSync('git', ['branch', `${disallowedWords()}-branch`], { cwd: directory });
      execFileSync('git', ['tag', '-a', 'annotated-release', '-m', `annotation ${disallowedWords()}`], { cwd: directory, env: gitEnvironment });
      const eventPath = join(directory, 'event.json');
      writeFileSync(eventPath, '{}');
      expect(() => checkRepositoryLanguage(directory, {
        CI: 'true',
        GITHUB_EVENT_NAME: 'issues',
        GITHUB_EVENT_PATH: eventPath,
      })).toThrow(/all branch and tag/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
