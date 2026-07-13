import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const artifactSource = readFileSync(resolve(root, 'src/artifacts/motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(root, 'src/artifacts/motif-artifact.css'), 'utf8');
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

  it('keeps the Motif identity visible in Claude Science frame widths', () => {
    expect(artifactSource).toContain('aria-label="Motif for Claude Science workspace"');
    expect(artifactSource).toContain('<span translate="no">Motif</span>');
    expect(artifactSource).toContain('<small translate="no">for Claude Science</small>');
    expect(artifactCss).not.toMatch(/@media \(max-width: (?:1180|840)px\)[\s\S]*?\.motif-cs-brand\s*\{\s*display:\s*none;/);
  });

  it('brands generated inventory reports and derived-record provenance as Motif', () => {
    expect(artifactSource).toContain('# Motif Sequence Inventory');
    expect(artifactSource).toContain('<title>Motif Sequence Inventory</title>');
    expect(artifactSource).toContain('exported from Motif.');
    expect(artifactSource).not.toContain('exported from the Claude Science artifact');
    expect(artifactSource).not.toContain('generated in the Claude Science artifact');
  });
});
