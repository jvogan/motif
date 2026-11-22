import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

type Rgb = [number, number, number];

// Every plain rule in the stylesheet as { selector, body }. The pattern matches the innermost
// braces, so a rule inside @media or @container comes back on its own.
const vectors = JSON.parse(readFileSync(resolve(here, '..', '..', '..', 'public', 'data', 'vectors.json'), 'utf8')) as Array<{
  name: string;
  features: Array<{ color: string }>;
}>;

const rules = [...artifactCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(),
  body: match[2],
}));

function rule(selector: string): string {
  const found = rules.find((candidate) => candidate.selector === selector);
  expect(found, `missing CSS rule: ${selector}`).toBeDefined();
  return found!.body;
}

function themeBlock(selector: string): string {
  const found = rules.find((candidate) => candidate.selector === selector);
  expect(found, `missing theme block: ${selector}`).toBeDefined();
  return found!.body;
}

function hexVariable(block: string, name: string): Rgb {
  const value = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1];
  expect(value, `missing ${name}`).toBeTruthy();
  return [1, 3, 5].map((index) => Number.parseInt(value!.slice(index, index + 2), 16)) as Rgb;
}

function mix(foreground: Rgb, background: Rgb, weight: number): Rgb {
  return foreground.map((channel, index) => channel * weight + background[index] * (1 - weight)) as Rgb;
}

function luminance(color: Rgb): number {
  const linear = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: Rgb, b: Rgb): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function accentWeight(body: string, property = 'background'): number {
  const match = new RegExp(`${property}:\\s*color-mix\\(in srgb, var\\(--accent\\) (\\d+)%`).exec(body);
  expect(match, `an accent mix in: ${body.trim()}`).not.toBeNull();
  return Number(match![1]) / 100;
}

const selectionWeight = Number(
  /--selection-bg:\s*color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--bg-primary\)\)/.exec(artifactCss)?.[1],
) / 100;

const themes = [
  { name: 'light', block: themeBlock(':root,\nhtml[data-theme="light"]') },
  { name: 'dark', block: themeBlock('html[data-theme="dark"]') },
];

describe('sequence selection is one flat layer', () => {
  it('paints the overlay highlight and nothing else', () => {
    // A pointer drag leaves a native text selection beside the overlay. The ::selection
    // rule makes it transparent, so the custom overlay supplies the one visible selection band.
    const native = rules.find((candidate) => (
      candidate.selector.includes('.motif-cs-sequence::selection')
      && candidate.selector.includes('.motif-cs-sequence ::selection')
    ));
    expect(native, 'a ::selection rule scoped to the sequence view').toBeDefined();
    expect(native!.body).toMatch(/background:\s*transparent/);

    const highlight = rule('.motif-cs-seq-hl');
    expect(highlight).toMatch(/background:\s*var\(--selection-bg\)/);
    expect(highlight).not.toMatch(/gradient/);
    expect(highlight).not.toMatch(/(?:^|[\s;])(?:border(?!-radius)[a-z-]*|outline[a-z-]*)\s*:/);
    expect(highlight).toMatch(/border-radius:\s*0;/);
    expect(highlight).toMatch(/box-shadow:\s*none/);
  });

  it('draws a selected translation in the same tint with no wash behind it', () => {
    expect(rule('.motif-cs-seq-aa-row[data-aa-track-selected="true"] .motif-cs-seq-aa'))
      .toMatch(/background:\s*var\(--selection-bg\)/);
    expect(rules.some((candidate) => (
      candidate.selector.includes('[data-aa-track-selected="true"] .motif-cs-aa-track')
    )), 'a second tint under the selected translation').toBe(false);
    expect(rule('.motif-cs-seq-aa-row[data-aa-track-selected="true"] .motif-cs-seq-aa')).not.toMatch(/border-radius/);
  });

  it('draws a run of selected residues as one band in the same tint', () => {
    const band = rule('.motif-cs-aa-hl');
    expect(band).toMatch(/background:\s*var\(--selection-bg\)/);
    expect(band).toMatch(/border-radius:\s*0;/);
    expect(band).not.toMatch(/gradient/);
    expect(band).not.toMatch(/(?:^|[\s;])(?:border(?!-radius)[a-z-]*|outline[a-z-]*|box-shadow)\s*:/);
    // On the band a selected residue paints no tint of its own, so hover and focus leave no
    // hole, and its ink is primary. The rule comes after hover, focus, stop and start.
    const selected = rule('.motif-cs-seq-aa[data-selected="true"]');
    expect(selected).toMatch(/background:\s*transparent/);
    expect(selected).toMatch(/color:\s*var\(--text-primary\)/);
    expect(selected).not.toMatch(/font-(?:weight|size)|outline|border(?!-radius)/);
    const at = (selector: string) => artifactCss.indexOf(`\n${selector} {`);
    for (const earlier of ['.motif-cs-seq-aa:hover', '.motif-cs-seq-aa:focus-visible', '.motif-cs-seq-aa[data-stop="true"]', '.motif-cs-seq-aa[data-start="true"]']) {
      expect(at(earlier), earlier).toBeGreaterThan(0);
      expect(at(earlier), `${earlier} comes before the selected rule`).toBeLessThan(at('.motif-cs-seq-aa[data-selected="true"]'));
    }
    const cell = rule('.motif-cs-protein-aa[data-selected="true"]');
    expect(cell).toMatch(/background:\s*var\(--selection-bg\)/);
    expect(cell).toMatch(/color:\s*var\(--text-primary\)/);
    expect(cell).toMatch(/border-radius:\s*0;/);
  });

  it('keeps hover weaker than selection', () => {
    expect(accentWeight(rule('.motif-cs-seq-aa:hover'))).toBeLessThan(selectionWeight);
    expect(accentWeight(rule('.motif-cs-seq-aa:focus-visible'))).toBeLessThan(selectionWeight);

    const featureWeight = (body: string) => Number(/background:\s*color-mix\(in srgb, var\(--feature-color\) (\d+)%/.exec(body)?.[1]);
    const resting = featureWeight(rule('.motif-cs-feature-block'));
    const hover = featureWeight(rule('.motif-cs-feature-block:hover,\n.motif-cs-feature-block:focus-visible,\n.motif-cs-feature-block[data-selected="true"]'));
    const selected = featureWeight(rule('.motif-cs-feature-block[data-selected="true"]'));
    expect(resting).toBeLessThan(hover);
    expect(hover).toBeLessThan(selected);
  });

  it('lets only the caret blink', () => {
    const sequenceSelector = /\.motif-cs-(seq-|aa-|restriction-|feature-)/;
    const infinite = rules
      .filter((candidate) => sequenceSelector.test(candidate.selector) && /animation:[^;]*infinite/.test(candidate.body))
      .map((candidate) => candidate.selector);
    // And only while the sequence view itself has keyboard focus.
    expect(infinite).toEqual(['.motif-cs-sequence:focus .motif-cs-seq-caret']);
  });

  it('keeps sequence text at 4.5:1 on the selection tint in every theme', () => {
    expect(selectionWeight).toBeGreaterThan(0);
    for (const theme of themes) {
      const background = hexVariable(theme.block, '--bg-primary');
      const tint = mix(hexVariable(theme.block, '--accent'), background, selectionWeight);
      // Bases and selected residues are primary ink; the complement strand is promoted to
      // secondary ink on a line that carries the tint.
      expect(contrast(hexVariable(theme.block, '--text-primary'), tint), `${theme.name}: bases on the tint`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hexVariable(theme.block, '--text-secondary'), tint), `${theme.name}: complement on the tint`).toBeGreaterThanOrEqual(4.5);
      // The tint still separates from the surface it sits on.
      expect(contrast(tint, background), `${theme.name}: tint against the surface`).toBeGreaterThanOrEqual(1.25);
    }
  });

  it('keeps feature bar labels at 4.5:1 when the bar is hovered and when it is selected', () => {
    const weight = (body: string) => Number(/background:\s*color-mix\(in srgb, var\(--feature-color\) (\d+)%/.exec(body)?.[1]) / 100;
    const weights = {
      resting: weight(rule('.motif-cs-feature-block')),
      hover: weight(rule('.motif-cs-feature-block:hover,\n.motif-cs-feature-block:focus-visible,\n.motif-cs-feature-block[data-selected="true"]')),
      selected: weight(rule('.motif-cs-feature-block[data-selected="true"]')),
    };
    const colors = [...new Set(vectors.find((record) => record.name === 'pUC19')!.features.map((feature) => feature.color))]
      .map((hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16)) as Rgb);
    expect(colors.length).toBeGreaterThan(3);
    for (const theme of themes) {
      const background = hexVariable(theme.block, '--bg-primary');
      const ink = hexVariable(theme.block, '--text-primary');
      for (const [state, w] of Object.entries(weights)) {
        for (const color of colors) {
          expect(contrast(ink, mix(color, background, w)), `${theme.name}: ${state} bar label`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});
