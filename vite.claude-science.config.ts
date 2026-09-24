import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const BASE_RUN = /[ACGT]{48,}/g;
const PACKED_BASE_DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
// Shipped verbatim in the generated module; the build also runs this exact
// source to prove the module rebuilds the text it replaces.
const UNPACK_BASES_SOURCE = `(packed, length) => {
  let bases = '';
  for (let index = 0; index < length; index += 1) {
    const digit = ${JSON.stringify(PACKED_BASE_DIGITS)}.indexOf(packed[Math.floor(index / 3)]);
    bases += 'ACGT'[(digit >> (4 - 2 * (index % 3))) & 3];
  }
  return bases;
}`;

/** Three bases per character: A, C, G, T are 0-3, most significant first. */
function packBases(bases: string): string {
  let packed = '';
  for (let index = 0; index < bases.length; index += 3) {
    let digit = 0;
    for (let offset = 0; offset < 3; offset += 1) digit = digit * 4 + Math.max(0, 'ACGT'.indexOf(bases[index + offset] ?? 'A'));
    packed += PACKED_BASE_DIGITS[digit];
  }
  return packed;
}

/**
 * Serve `*.json?raw` imports as the same JSON text without indentation, with
 * each run of 48 or more A/C/G/T characters stored three bases to a
 * character and expanded when the module loads. The artifact imports its
 * built-in vectors this way and passes the text to JSON.parse, so the text,
 * and the parsed records, are unchanged. The build fails if the generated
 * module would not rebuild the text exactly.
 */
export function compactRawJsonImports(): Plugin {
  return {
    name: 'motif-compact-raw-json',
    enforce: 'pre',
    load(id) {
      const [path, query] = id.split('?', 2);
      if (query !== 'raw' || !path.endsWith('.json')) return null;
      const text = JSON.stringify(JSON.parse(readFileSync(path, 'utf8')));
      const pieces: string[] = [];
      let end = 0;
      for (const run of text.matchAll(BASE_RUN)) {
        pieces.push(JSON.stringify(text.slice(end, run.index)), `unpack(${JSON.stringify(packBases(run[0]))}, ${run[0].length})`);
        end = run.index + run[0].length;
      }
      pieces.push(JSON.stringify(text.slice(end)));
      const body = `const unpack = ${UNPACK_BASES_SOURCE};\n`;
      const value = `[${pieces.join(', ')}].join('')`;
      if (runInNewContext(`${body}${value}`) !== text) throw new Error(`Packed ${path} does not rebuild its JSON text.`);
      return `${body}export default ${value};`;
    },
  };
}

export default defineConfig({
  base: './',
  // The built-in vectors are imported into the self-contained bundle. Disable
  // Vite's URL-only public-directory handling so development and E2E resolve
  // that source import the same way as the production build.
  publicDir: false,
  plugins: [compactRawJsonImports(), react()],
  build: {
    outDir: 'dist-motif',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    rollupOptions: {
      input: 'motif.html',
    },
  },
});
