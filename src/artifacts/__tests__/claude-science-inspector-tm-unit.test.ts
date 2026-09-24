import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

describe('the Inspector melting temperature', () => {
  it('writes °C for a selected feature and for a map range, as motifDescribe does', () => {
    const tmChips = artifactSource.match(/<span>Tm \{inspectorTm\.toFixed\(1\)\} [^<]*<\/span>/g) ?? [];
    expect(tmChips).toEqual([
      '<span>Tm {inspectorTm.toFixed(1)} °C</span>',
      '<span>Tm {inspectorTm.toFixed(1)} °C</span>',
    ]);
    expect(artifactSource).toContain('` · Tm ${tm.toFixed(1)} °C`');
  });
});
