import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

// The plasmid map stylesheet sizes SVG text in user units; its on-screen floor is tested with the map.
const UI_STYLESHEETS = [
  'motif-artifact.css',
  'claude-science-agent-results.css',
  'claude-science-cloning-design-workspace.css',
  'claude-science-construct-verification-workspace.css',
  'claude-science-construct-verification.css',
  'claude-science-freshness.css',
  'claude-science-msa.css',
  'claude-science-primer-workspace.css',
];

const MIN_FONT_PX = 12;

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function literalFontSizes(css: string): number[] {
  const sizes: number[] = [];
  for (const match of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) sizes.push(Number(match[1]));
  for (const match of css.matchAll(/\bfont:\s*([^;}]*)/g)) {
    const size = /(\d+(?:\.\d+)?)px/.exec(match[1]);
    if (size) sizes.push(Number(size[1]));
  }
  return sizes;
}

describe('type scale guards', () => {
  const artifactCss = stripComments(readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8'));

  it('defines the type scale 12, 13, 14, 18 with a 12px floor', () => {
    // Pane titles and record names are 14px, so --fs-lg equals --fs-md and no
    // 16px size is left on screen.
    expect(artifactCss).toContain('--fs-xs: 12px;');
    expect(artifactCss).toContain('--fs-sm: 13px;');
    expect(artifactCss).toContain('--fs-md: 14px;');
    expect(artifactCss).toContain('--fs-lg: 14px;');
    expect(artifactCss).toContain('--fs-xl: 18px;');
    expect(artifactCss).not.toMatch(/--fs-[a-z]+:\s*16px/);
  });

  it.each(UI_STYLESHEETS)('%s sets no font size below 12px', (name) => {
    const css = stripComments(readFileSync(resolve(here, '..', name), 'utf8'));
    const tooSmall = literalFontSizes(css).filter((size) => size > 0 && size < MIN_FONT_PX);
    expect(tooSmall).toEqual([]);
    for (const match of css.matchAll(/font-size:\s*var\(--[a-z-]+,\s*(\d+(?:\.\d+)?)px\)/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(MIN_FONT_PX);
    }
  });

  it.each(UI_STYLESHEETS)('%s uses only regular, medium and semibold weights', (name) => {
    const css = stripComments(readFileSync(resolve(here, '..', name), 'utf8'));
    const weights = [...css.matchAll(/font-weight:\s*(\d{3})\b/g)].map((match) => match[1]);
    expect(weights.filter((value) => !['400', '500', '600'].includes(value))).toEqual([]);
  });
});
