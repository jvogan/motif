import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { compactRawJsonImports } from '../../vite.claude-science.config.ts';

const vectorsPath = fileURLToPath(new URL('../../public/data/vectors.json', import.meta.url));

function load(id) {
  return compactRawJsonImports().load.call({}, id);
}

// Run the generated module and return its default export.
function exportedText(code) {
  expect(code).toMatch(/\nexport default [^\n]+;$/u);
  return runInNewContext(code.replace(/\nexport default ([^\n]+);$/u, '\n$1'));
}

describe('compact raw JSON imports', () => {
  it('serves the built-in vectors as the same JSON text without indentation', () => {
    const source = readFileSync(vectorsPath, 'utf8');
    const code = load(`${vectorsPath}?raw`);
    const text = exportedText(code);
    expect(text).toBe(JSON.stringify(JSON.parse(source)));
    expect(JSON.parse(text)).toEqual(JSON.parse(source));
    expect(JSON.parse(text)).toHaveLength(13);
    expect(source.length - code.length).toBeGreaterThan(40_000);
  });

  it('stores each long base run three bases to a character and rebuilds it exactly', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-raw-json-'));
    try {
      const path = join(directory, 'runs.json');
      const runs = [47, 48, 49, 50, 51].map((length) => 'TGCA'.repeat(13).slice(0, length));
      const value = { runs, mixed: `${'G'.repeat(60)}N${'C'.repeat(50)}acgt`, note: 'A CAT ACT', count: 1.0 };
      writeFileSync(path, JSON.stringify(value, null, 2));
      const code = load(`${path}?raw`);
      expect(exportedText(code)).toBe(JSON.stringify(value));
      expect(code).toContain('TGCA'.repeat(11).slice(0, 47));
      expect(code).not.toContain('G'.repeat(48));
      expect(code).not.toContain('C'.repeat(48));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('leaves every other import to Vite', () => {
    expect(load(vectorsPath)).toBeNull();
    expect(load(`${vectorsPath}?url`)).toBeNull();
    expect(load('/workspace/notes.txt?raw')).toBeNull();
  });
});
