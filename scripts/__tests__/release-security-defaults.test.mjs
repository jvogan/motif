import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { assertVersionTagMatchesHead, checkReleaseAlignment } from '../check-release-alignment.mjs';
import { checkGithubReleaseAvailable, checkReleasePublish } from '../check-release-publish.mjs';

const root = resolve(import.meta.dirname, '..', '..');

describe('release security defaults', () => {
  it('disables dependency lifecycle scripts in the project npm configuration', () => {
    const npmrc = readFileSync(resolve(root, '.npmrc'), 'utf8');
    expect(npmrc).toMatch(/^\s*ignore-scripts\s*=\s*true\s*$/mu);
  });

  it('includes the MCP stdio fallback in release-version alignment', () => {
    expect(checkReleaseAlignment()).toMatchObject({ version: '0.3.5', surfaces: 10 });
  });

  it('allows a post-tag development commit in alignment but blocks it for publishing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-release-alignment-'));
    try {
      const version = '1.2.3';
      const files = {
        'package.json': JSON.stringify({ version }) + '\n',
        'package-lock.json': JSON.stringify({ version, packages: { '': { version } } }) + '\n',
        'src/artifacts/motif-for-claude-science-plugin/.claude-plugin/plugin.json': JSON.stringify({ version }) + '\n',
        'src/artifacts/motif-artifact.tsx': `const MOTIF_ARTIFACT_VERSION = '${version}';\n`,
        'src/mcp-app/motif-workbench-bridge.ts': `name: 'Motif for Claude Science', version: '${version}'\n`,
        'mcp/motif/stdio-server.ts': `async function readVersion(path: string): Promise<string> { return '${version}'; }\nasync function readRuntimeBuildId() { return ''; }\n`,
        'CHANGELOG.md': `## ${version}\n`,
        'src/artifacts/motif-for-claude-science-plugin/CHANGELOG.md': `## ${version}\n`,
        'AGENTS.md': `Current release version is \`${version}\`\n`,
        'docs/CLAUDE_SCIENCE_INTEGRATION.md': `Connector version: \`${version}\`\n`,
      };
      for (const [relativePath, contents] of Object.entries(files)) {
        const path = join(directory, relativePath);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, contents);
      }
      execFileSync('git', ['init', '--quiet'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'release-test@example.invalid'], { cwd: directory });
      execFileSync('git', ['config', 'user.name', 'Release test'], { cwd: directory });
      execFileSync('git', ['add', '.'], { cwd: directory });
      execFileSync('git', ['commit', '--quiet', '--message', 'release source'], { cwd: directory });
      execFileSync('git', ['tag', `v${version}`], { cwd: directory });
      execFileSync('git', ['commit', '--quiet', '--allow-empty', '--message', 'post-tag development'], { cwd: directory });

      expect(checkReleaseAlignment(directory)).toMatchObject({ version, surfaces: 10 });
      expect(() => checkReleasePublish(directory)).toThrow(/Bump the release version before building/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps the authenticated GitHub release check opt-in and blocks an existing published release', () => {
    const run = (_command, _args, _options) => ({
      status: 0,
      stdout: JSON.stringify({ data: { repository: { release: { isDraft: false, publishedAt: '2026-08-11T00:00:00Z' } } } }),
      stderr: '',
    });
    expect(() => checkGithubReleaseAvailable('1.2.3', { repository: 'owner/repository', run }))
      .toThrow(/already exists; publish checks refuse version reuse/u);
    expect(checkGithubReleaseAvailable('1.2.4', {
      repository: 'owner/repository',
      run: () => ({
        status: 0,
        stdout: JSON.stringify({ data: { repository: { release: null } } }),
        stderr: '',
      }),
    })).toMatchObject({ version: '1.2.4', existingDraft: false });
  });

  it('rejects reusing a version tag after the tagged commit changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-release-tag-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'release-test@example.invalid'], { cwd: directory });
      execFileSync('git', ['config', 'user.name', 'Release test'], { cwd: directory });
      execFileSync('git', ['commit', '--allow-empty', '--message', 'first'], { cwd: directory });
      expect(assertVersionTagMatchesHead('1.2.3', directory)).toEqual({ tag: 'v1.2.3', status: 'unpublished' });
      execFileSync('git', ['branch', 'v1.2.4'], { cwd: directory });
      expect(assertVersionTagMatchesHead('1.2.4', directory)).toEqual({ tag: 'v1.2.4', status: 'unpublished' });
      execFileSync('git', ['tag', 'v1.2.3'], { cwd: directory });
      expect(assertVersionTagMatchesHead('1.2.3', directory)).toMatchObject({ tag: 'v1.2.3', status: 'current' });
      execFileSync('git', ['commit', '--allow-empty', '--message', 'second'], { cwd: directory });
      expect(() => assertVersionTagMatchesHead('1.2.3', directory)).toThrow(/Bump the release version before building/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed for an existing tag ref that does not resolve to a commit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-release-invalid-tag-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'release-test@example.invalid'], { cwd: directory });
      execFileSync('git', ['config', 'user.name', 'Release test'], { cwd: directory });
      execFileSync('git', ['commit', '--allow-empty', '--message', 'first'], { cwd: directory });
      const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: directory, input: 'not a commit\n', encoding: 'utf8' }).trim();
      execFileSync('git', ['update-ref', 'refs/tags/v1.2.5', blob], { cwd: directory });
      expect(() => assertVersionTagMatchesHead('1.2.5', directory)).toThrow(/does not resolve to a commit/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
