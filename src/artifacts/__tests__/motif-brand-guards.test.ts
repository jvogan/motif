import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const legacyBrand = ['gene', 'chat'].join('');
const legacyBrandPattern = new RegExp(legacyBrand, 'i');

const ignoredDirectories = new Set([
  '.git',
  'coverage',
  'dist',
  'dist-electron',
  'dist-motif',
  'node_modules',
  'playwright-report',
  'test-results',
]);

const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

function collectPublicTextFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return collectPublicTextFiles(path);
    if (!entry.isFile() || !textExtensions.has(extname(entry.name).toLowerCase())) return [];
    return [path];
  });
}

describe('Motif public-brand guard', () => {
  it('contains no case-insensitive legacy product name in public paths or text', () => {
    const violations: string[] = [];

    for (const path of collectPublicTextFiles(root)) {
      const publicPath = relative(root, path);
      if (legacyBrandPattern.test(publicPath)) violations.push(`${publicPath} (path)`);
      if (legacyBrandPattern.test(readFileSync(path, 'utf8'))) violations.push(`${publicPath} (content)`);
    }

    expect(violations, `Legacy product branding remains:\n${violations.join('\n')}`).toEqual([]);
  });
});
