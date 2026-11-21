import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Fine details of control styling. Each guard pins one rule.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: match[1].trim().replace(/\s+/g, ' '),
  body: match[2],
}));

function bodyOf(selector: string): string {
  const found = rules.filter((rule) => rule.selector === selector);
  expect(found, selector).toHaveLength(1);
  return found[0].body;
}

describe('control finish', () => {
  it('centres the Enzymes | Sites labels in their buttons', () => {
    const body = bodyOf('.motif-cs-restriction-view button');
    expect(body).toMatch(/align-items:\s*center;/);
    expect(body).not.toMatch(/align-items:\s*baseline;/);
  });

  it('reserves the records list gutter on both edges so a selected row is inset evenly', () => {
    expect(bodyOf('.motif-cs-inventory-groups')).toMatch(/scrollbar-gutter:\s*stable both-edges;/);
  });

  it('draws no grip and takes no pointer on a horizontal splitter with under 48px of travel', () => {
    const name = ':is(.motif-cs-stacked-resize-handle, .motif-cs-map-frame-resize, .motif-cs-translation-resize-handle)[aria-disabled="true"]';
    expect(bodyOf(name)).toMatch(/pointer-events:\s*none;/);
    expect(bodyOf(`${name}::after`)).toMatch(/display:\s*none;/);
    const tsx = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
    expect(tsx).toContain('const SPLITTER_MIN_TRAVEL = 48;');
    // All three horizontal splitters drop their Tab stop with the grip.
    expect(tsx.match(/< SPLITTER_MIN_TRAVEL \? -1 : 0\}/g)?.length).toBe(3);
  });

  it('rings a solid primary button 3:1 or more against its fill and the surface in both themes', () => {
    const raw = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
    const block = (head: string) => raw.slice(raw.indexOf(head), raw.indexOf('}', raw.indexOf(head)));
    const token = (text: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-f]{6});`).exec(text)?.[1] ?? '';
    const lum = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
    const mixBlack = (hex: string, keep: number) => `#${[1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * keep).toString(16).padStart(2, '0')).join('')}`;
    const dark = block('html[data-theme="dark"] {');
    const light = block('html[data-theme="light"] {');
    const root = raw.slice(raw.indexOf('--focus-ring: var(--accent);', raw.indexOf(light)));
    for (const [name, theme, ring] of [['dark', dark, token(dark, '--focus-ring-on-accent')], ['light', light, token(root, '--focus-ring-on-accent')]] as const) {
      const fill = token(theme, '--accent-base');
      // Rest fill, and the hover and focus fill (86% of it toward black ink).
      for (const against of [fill, mixBlack(fill, 0.86), token(theme, '--bg-primary'), token(theme, '--panel-bg')]) {
        expect(ratio(ring, against), `${name} ring ${ring} on ${against}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(bodyOf(':is(#root, .motif-cs-cloning-design) .motif-cs-cloning-design-primary-button:focus-visible'))
      .toMatch(/outline-color:\s*var\(--focus-ring-on-accent\);/);
    expect(bodyOf('.motif-cs-cloning-design .motif-cs-cloning-design-primary-button')).toMatch(/background:\s*var\(--accent-base\);/);
  });

  it('rounds every popover and menu with one radius token', () => {
    // A popover or menu: a surface lifted with the popover elevation that is not
    // a window, a modal, a pane or a notice.
    const lifted = rules.filter((rule) => rule.body.includes('var(--elevation-popover)')
      && /popover|menu|import-panel|tool-panel-body|panel-head|export-body/.test(rule.selector));
    expect(lifted.length).toBeGreaterThanOrEqual(7);
    for (const rule of lifted) {
      expect(rule.body, rule.selector).toMatch(/border-radius:\s*var\(--radius-sm\);/);
    }
    expect(bodyOf('.motif-cs-map-enzyme-menu-all')).toMatch(/border-radius:\s*0 0 var\(--radius-sm\) var\(--radius-sm\);/);
  });

  it('rings the selected theme tile in accent and leaves the other without one', () => {
    const on = bodyOf('.motif-cs-theme-choice[data-active="true"]');
    expect(on).toMatch(/outline:\s*2px solid var\(--accent\);/);
    expect(on).toMatch(/outline-offset:\s*-2px;/);
    for (const rule of rules.filter((r) => r.selector === '.motif-cs-theme-choice')) expect(rule.body).not.toMatch(/outline/);
  });

  it('lines the Tools Translation panel actions up in columns', () => {
    const grid = bodyOf('.motif-cs-translation-body:not([data-compact]) > .motif-cs-translate-actions');
    expect(grid).toMatch(/display:\s*grid;/);
    expect(grid).toMatch(/grid-template-columns:\s*repeat\(auto-fill, minmax\(112px, max-content\)\);/);
    expect(bodyOf('.motif-cs-translation-body:not([data-compact]) > .motif-cs-translate-actions > .motif-cs-mini-button-accent'))
      .toMatch(/grid-column:\s*auto;/);
  });
});
