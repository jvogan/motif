import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The map frame's bottom splitter and the docked Translation panel's top splitter
// share the stacked pane splitter's look. One rule draws both, so a change to one
// cannot leave the other behind. The same rule covers every grip: the stacked
// splitters and the vertical pane dividers draw the same pill, from one rule.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  selector: match[1].trim().replace(/\s+/g, ' '),
  body: match[2],
}));
const both = ':is(.motif-cs-map-frame-resize, .motif-cs-translation-resize-handle)';
const every = ':is(.motif-cs-resize-handle, .motif-cs-stacked-resize-handle, .motif-cs-map-frame-resize, .motif-cs-translation-resize-handle)';
const horizontal = ':is(.motif-cs-stacked-resize-handle, .motif-cs-map-frame-resize, .motif-cs-translation-resize-handle)';

function bodyOf(selector: string): string {
  const found = rules.filter((rule) => rule.selector === selector);
  expect(found, selector).toHaveLength(1);
  return found[0].body;
}

function startsWith(selector: string): string {
  const found = rules.filter((rule) => rule.selector.startsWith(selector));
  expect(found, selector).toHaveLength(1);
  return found[0].body;
}

describe('one look for every splitter grip', () => {
  it('draws both horizontal splitters with one cursor and focus rule', () => {
    expect(bodyOf(both)).toMatch(/cursor:\s*ns-resize;/);
    const focus = bodyOf(`${both}:focus-visible`);
    expect(focus).toMatch(/outline:\s*none;/);
    expect(focus).toMatch(/linear-gradient\(to bottom, transparent 0 3px, var\(--accent\) 3px 5px, transparent 5px 100%\)/);
  });

  it('draws every grip, vertical dividers included, with one pill at 3:1 or more', () => {
    const grip = bodyOf(`${every}::after`);
    expect(grip).toMatch(/top:\s*var\(--grip-y, 4px\);/);
    expect(grip).toMatch(/left:\s*var\(--grip-x, 50%\);/);
    expect(grip).toMatch(/width:\s*var\(--grip-w, 28px\);/);
    expect(grip).toMatch(/height:\s*var\(--grip-h, 4px\);/);
    expect(grip).toMatch(/border-radius:\s*999px;/);
    expect(grip).toMatch(/background:\s*var\(--border-strong\);/);
    // The vertical divider stands the same pill up inside its 7px box, so the
    // next pane cannot paint over its right edge.
    const vertical = rules.filter((rule) => rule.selector === '.motif-cs-resize-handle')
      .map((rule) => rule.body).find((body) => body.includes('--grip-x')) ?? '';
    expect(vertical).toMatch(/--grip-x:\s*3px;/);
    expect(vertical).toMatch(/--grip-y:\s*50%;/);
    expect(vertical).toMatch(/--grip-w:\s*4px;/);
    expect(vertical).toMatch(/--grip-h:\s*28px;/);
    expect(vertical).toMatch(/flex:\s*0 0 7px;/);
  });

  it('turns the pill and a full-length line accent on hover, focus and drag, and gives press its own halo', () => {
    expect(startsWith(`${every}:is(:hover, :focus-visible, :active)::after`)).toMatch(/background:\s*var\(--accent\);/);
    expect(startsWith(`${horizontal}:is(:hover, :active)::before`)).toMatch(/background:\s*var\(--accent\);/);
    expect(startsWith(`${every}:active::after`)).toMatch(/box-shadow:\s*0 0 0 3px color-mix\(in srgb, var\(--accent\) 35%, transparent\);/);
    // The vertical divider's line is its own background; hover, focus and drag
    // all turn it accent, the same as the horizontal ::before line.
    expect(startsWith('.motif-cs-resize-handle:hover, .motif-cs-resize-handle:focus-visible, body[data-motif-cs-resizing] .motif-cs-resize-handle'))
      .toMatch(/var\(--accent\) 2px 4px/);
  });

  it('leaves no second copy of the grip on any splitter', () => {
    for (const name of ['.motif-cs-resize-handle', '.motif-cs-stacked-resize-handle', '.motif-cs-map-frame-resize', '.motif-cs-translation-resize-handle']) {
      const own = rules.filter((rule) => !rule.selector.startsWith(':is(')
        && rule.selector.split(',').some((part) => part.trim().includes(name) && /::after/.test(part)));
      for (const rule of own) {
        expect(rule.body, rule.selector).not.toMatch(/width:|height:|border-radius:|content:|background:/);
      }
    }
  });
});
