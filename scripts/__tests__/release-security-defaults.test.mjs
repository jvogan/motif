import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkReleaseAlignment } from '../check-release-alignment.mjs';

const root = resolve(import.meta.dirname, '..', '..');

describe('release security defaults', () => {
  it('disables dependency lifecycle scripts in the project npm configuration', () => {
    const npmrc = readFileSync(resolve(root, '.npmrc'), 'utf8');
    expect(npmrc).toMatch(/^\s*ignore-scripts\s*=\s*true\s*$/mu);
  });

  it('includes the MCP stdio fallback in release-version alignment', () => {
    expect(checkReleaseAlignment()).toMatchObject({ version: '0.3.2', surfaces: 10 });
  });
});
