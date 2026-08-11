import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const filesystemScripts = [
  'scripts/build-preview.mjs',
  'scripts/check-release-alignment.mjs',
  'scripts/check-release-publish.mjs',
  'scripts/check-release-review-threads.mjs',
  'scripts/check-release-budgets.mjs',
  'scripts/check-runtime-compatibility.mjs',
  'scripts/report-gate-coverage.mjs',
];

describe('filesystem URL path portability', () => {
  it('uses fileURLToPath for filesystem module-relative paths', () => {
    for (const relativePath of filesystemScripts) {
      const source = readFileSync(join(root, relativePath), 'utf8');
      expect(source, relativePath).toContain('fileURLToPath');
      expect(source, relativePath).not.toContain('new URL(\'..\', import.meta.url).pathname');
    }
  });

  it('round-trips spaces and Unicode in a filesystem URL', () => {
    const moduleUrl = pathToFileURL('/tmp/Motif release π/scripts/check.mjs');
    expect(resolve(fileURLToPath(new URL('..', moduleUrl)))).toBe('/tmp/Motif release π');
  });

  it('decodes Windows drive URLs when running on Windows', () => {
    if (process.platform !== 'win32') return;
    expect(fileURLToPath(new URL('file:///C:/Motif%20release/%CF%80/scripts/check.mjs')))
      .toBe('C:\\Motif release\\π\\scripts\\check.mjs');
  });
});
