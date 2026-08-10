import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertVersionTagMatchesHead, checkReleaseAlignment } from '../check-release-alignment.mjs';

const root = resolve(import.meta.dirname, '..', '..');

describe('release security defaults', () => {
  it('disables dependency lifecycle scripts in the project npm configuration', () => {
    const npmrc = readFileSync(resolve(root, '.npmrc'), 'utf8');
    expect(npmrc).toMatch(/^\s*ignore-scripts\s*=\s*true\s*$/mu);
  });

  it('includes the MCP stdio fallback in release-version alignment', () => {
    expect(checkReleaseAlignment()).toMatchObject({ version: '0.3.4', surfaces: 10 });
  });

  it('rejects reusing a version tag after the tagged commit changes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-release-tag-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: directory });
      execFileSync('git', ['config', 'user.email', 'release-test@example.invalid'], { cwd: directory });
      execFileSync('git', ['config', 'user.name', 'Release test'], { cwd: directory });
      execFileSync('git', ['commit', '--allow-empty', '--message', 'first'], { cwd: directory });
      expect(assertVersionTagMatchesHead('1.2.3', directory)).toEqual({ tag: 'v1.2.3', status: 'unpublished' });
      execFileSync('git', ['tag', 'v1.2.3'], { cwd: directory });
      expect(assertVersionTagMatchesHead('1.2.3', directory)).toMatchObject({ tag: 'v1.2.3', status: 'current' });
      execFileSync('git', ['commit', '--allow-empty', '--message', 'second'], { cwd: directory });
      expect(() => assertVersionTagMatchesHead('1.2.3', directory)).toThrow(/Bump the release version before building/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
