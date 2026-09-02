import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const mapCss = readFileSync(resolve(here, '..', 'plasmid-map.css'), 'utf8');

describe('circular map accessibility polish', () => {
  it('uses the forced-colors system palette and non-colour feature patterns', () => {
    const forcedColorsAt = mapCss.indexOf('@media (forced-colors: active)');
    const forcedColors = mapCss.slice(forcedColorsAt);

    expect(forcedColorsAt).toBeGreaterThan(-1);
    expect(forcedColors).toContain('forced-color-adjust: auto;');
    expect(forcedColors).toContain('forced-color-adjust: none;');
    expect(forcedColors).toContain('fill: Canvas;');
    expect(forcedColors).toContain('stroke: CanvasText;');
    expect(forcedColors).toContain('stroke: Highlight;');
    expect(forcedColors).toMatch(/stroke-dasharray:\s*5 2;/);
    expect(forcedColors).toMatch(/stroke-dasharray:\s*2 2;/);
  });
});
