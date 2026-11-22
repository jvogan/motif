import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '../motif-artifact.css'), 'utf8');
const artifactSource = readFileSync(resolve(here, '../motif-artifact.tsx'), 'utf8');

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, start).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from);
  expect(to, end).toBeGreaterThan(from);
  return source.slice(from, to);
}

function ruleBodies(selector: string): string[] {
  const out: string[] = [];
  const pattern = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`, 'g');
  for (let hit = pattern.exec(artifactCss); hit; hit = pattern.exec(artifactCss)) {
    const open = artifactCss.indexOf('{', hit.index + hit[0].length - 1);
    out.push(artifactCss.slice(open + 1, artifactCss.indexOf('}', open)));
  }
  return out;
}

describe('one line per seam', () => {
  // The Records divider under the filter is one line, 1px: the first group's top
  // border would stack on the filter row's bottom border and draw 2px. Groups
  // separate with `+` only.
  it('gives the first Records group no top border under the filter row', () => {
    const bodies = ruleBodies('.motif-cs-sidebar .motif-cs-inventory-group');
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) expect(body).not.toMatch(/border-top\s*:\s*1px/);
    for (const body of ruleBodies('.motif-cs-inventory-group')) expect(body).not.toMatch(/border-top\s*:\s*1px/);
    expect(ruleBodies('.motif-cs-sidebar .motif-cs-inventory-filter-row').join('')).toMatch(/border-bottom:\s*1px solid var\(--border-subtle\)/);
  });
});

describe('the narrow map toolbar clears the frame', () => {
  // At 400x700 the Circle | Line pair and the Restriction sites select clear the map
  // frame's top border by 2px, as they do at 660, 700 and 1440 wide.
  const at = artifactCss.indexOf('@media (max-width: 480px) and (min-height: 691px) {');
  const block = artifactCss.slice(at, artifactCss.indexOf('\n}\n', at));
  const px = (selector: string, prop: string) => {
    const open = block.indexOf(`${selector} {`);
    expect(open, selector).toBeGreaterThanOrEqual(0);
    const body = block.slice(open, block.indexOf('}', open));
    const hit = new RegExp(`${prop}:\\s*(\\d+)px`).exec(body);
    expect(hit, `${selector} ${prop}`).not.toBeNull();
    return Number(hit![1]);
  };

  it('keeps 2px under the toolbar and takes it from the column top, not the frame', () => {
    const title = px('.motif-cs-map-column > .motif-cs-pane-title', 'padding-bottom');
    const column = px('.motif-cs-main > .motif-cs-map-column[data-pane-placement="docked"]', 'padding-top');
    expect(title).toBe(2);
    expect(column + title).toBe(6);
  });
});

describe('the records strip holds one control height', () => {
  // At 400x700 the tabs are 28px, matching the 28px "+N records" button, and the first
  // tab starts 8px in from the left edge, as the button sits 8px from the right edge.
  it('stands each tab 28px on the centre line, 8px in from the left', () => {
    const tab = ruleBodies('.motif-cs-record-tab')[0];
    expect(tab).toMatch(/\n\s*height:\s*28px;/);
    expect(tab).not.toMatch(/min-height:\s*3\dpx/);
    expect(tab).not.toMatch(/border-bottom:\s*3px/);
    const tabs = ruleBodies('.motif-cs-record-strip > .motif-cs-record-tabs')[0];
    expect(tabs).toMatch(/align-items:\s*center;/);
    const more = ruleBodies('.motif-cs-record-strip > .motif-cs-record-strip-more')[0];
    const end = /margin-inline:\s*\d+px (\d+)px;/.exec(more);
    expect(end).not.toBeNull();
    expect(tabs).toContain(`padding-inline-start: ${end![1]}px;`);
  });
});

describe('the Export popover copy row reads as one rank', () => {
  // "Summary" takes no accent fill among the six plain copy buttons. It marks no
  // state (not default, focused or selected), and the popover already has its
  // one accent command, Print report.
  const tsx = readFileSync(resolve(here, '../motif-artifact.tsx'), 'utf8');
  it('gives Summary its siblings\' class', () => {
    const at = tsx.indexOf('onClick={onCopySummary}');
    expect(at).toBeGreaterThan(0);
    const tag = tsx.slice(tsx.lastIndexOf('<button', at), tsx.indexOf('>', at));
    expect(tag).toContain('className="motif-cs-mini-button"');
    expect(tag).not.toContain('mini-button-accent');
  });
});

describe('the Import popover head centres its chevron', () => {
  // Turned up (-135deg), the 7px chevron's ink sits above the head's centre line;
  // translating it down 3.4px centres it.
  it('drops the upturned chevron by the ink offset', () => {
    const body = ruleBodies('.motif-cs-import-panel[open] > summary.motif-cs-panel-head::after')[0];
    expect(body).toMatch(/transform:\s*translateY\(3\.4px\) rotate\(-135deg\);/);
  });
});

describe('the Find bar lines up with the pane it belongs to', () => {
  // The docked bar starts level with the Find button and the first base: the anchor's
  // side padding is the sequence's 12px inset.
  const findCss = readFileSync(resolve(here, '../claude-science-find.css'), 'utf8');
  it('pads the docked anchor with the sequence\'s 12px inset', () => {
    const at = findCss.indexOf('.motif-cs-find-anchor:has(> .motif-cs-find-bar[data-placement="top"]) {');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = findCss.slice(at, findCss.indexOf('}', at));
    expect(body).toMatch(/padding:\s*var\(--space-1\) var\(--space-3\) 0;/);
    expect(artifactCss).toMatch(/--space-3:\s*12px;/);
    expect(ruleBodies('.motif-cs-sequence')[0]).toMatch(/padding:\s*2px 12px 12px;/);
  });
});

describe('every button rank shows a pressed fill', () => {
  // With the mouse held down a control shows its pressed fill, not its hover fill
  // (light and dark). Hover rules of up to (0,6,0) would outrank a (0,3,0) pressed
  // rule, a toggle that is on and a selected row or tab need a pressed fill of their
  // own, and the soft button's pressed grey must differ from its hover on the
  // panel. One rule per rank, each carrying #root.
  const at = artifactCss.indexOf('/* Pressed: while the button is down');
  const block = artifactCss.slice(at, artifactCss.indexOf('/* An inline link-button', at));
  const rule = (head: RegExp) => {
    const hit = head.exec(block);
    expect(hit, String(head)).not.toBeNull();
    const open = block.indexOf('{', hit!.index + hit![0].length - 1);
    return { selector: block.slice(hit!.index, open), body: block.slice(open + 1, block.indexOf('}', open)) };
  };
  const hex = (theme: string, name: string) => {
    const open = artifactCss.search(new RegExp(`(^|\\n)html\\[data-theme="${theme}"\\] \\{`));
    const body = artifactCss.slice(open, artifactCss.indexOf('\n}', open));
    const m = new RegExp(`${name}:\\s*#([0-9a-f]{6});`).exec(body);
    expect(m, `${name} in ${theme}`).not.toBeNull();
    return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16));
  };
  // share of a over b
  const mix = (a: number[], b: number[], share: number) => a.map((v, i) => v * share + b[i] * (1 - share));
  const step = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const lum = (c: number[]) => {
    const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

  it('outranks every hover rule and covers every control family that can be pressed', () => {
    expect(at).toBeGreaterThan(0);
    const ghost = rule(/#root :is\(\s*\.motif-cs-panel-head/);
    for (const family of ['.motif-cs-panel-head', '.motif-cs-inventory-group-head', '.motif-cs-row', '.motif-cs-record-tab', '.motif-cs-pane-placement-button', '.motif-cs-map-button', '.motif-cs-map-overflow-button', '.motif-cs-pane-toggle', '.motif-cs-segmented button']) {
      expect(ghost.selector, family).toContain(`  ${family},`.replace(/,$/, ''));
    }
    expect(ghost.body).toMatch(/^\s*background-color: var\(--control-active\);\s*$/);
    expect(rule(/#root \.motif-cs-mini-button:active:not\(/).body).toMatch(/^\s*background-color: var\(--control-soft-active\);\s*$/);
    const on = rule(/#root :is\(\s*\.motif-cs-pane-toggle,\s*\.motif-cs-mini-button,\s*\.motif-cs-map-button,\s*\.motif-cs-segmented button\s*\):is\(\[data-active="true"\], \[data-active=""\], \[aria-pressed="true"\]\):active/);
    expect(on.body).toMatch(/^\s*background-color: color-mix\(in srgb, var\(--text-primary\) 16%, var\(--bg-active\)\);\s*$/);
    const selected = rule(/#root :is\(\.motif-cs-row, \.motif-cs-record-tab\)\[data-active="true"\]:active/);
    expect(selected.body).toMatch(/^\s*background-color: color-mix\(in srgb, var\(--text-primary\) 8%, var\(--bg-selected\)\);\s*$/);
    // Every rule here carries #root, so no hover rule without an id outranks it.
    for (const selector of block.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) ?? []) {
      if (/:active/.test(selector) && !/danger-button:not/.test(selector)) {
        // Split the selector list at its top-level commas only.
        let depth = 0, from = 0;
        const parts: string[] = [];
        for (let i = 0; i < selector.length; i++) {
          if (selector[i] === '(') depth++;
          else if (selector[i] === ')') depth--;
          else if (selector[i] === ',' && depth === 0) { parts.push(selector.slice(from, i)); from = i + 1; }
        }
        parts.push(selector.slice(from));
        for (const part of parts) expect(part.trim(), part).toMatch(/^#root /);
      }
    }
    expect(block).not.toMatch(/\b(width|height|padding|margin|transform|font-weight|border-width|top|left)\s*:/);
  });

  it.each(['light', 'dark'])('%s: each rank presses one visible step past its hover and keeps its label at 4.5:1', (theme) => {
    expect(artifactCss).toMatch(/--control-soft-hover:\s*color-mix\(in srgb, var\(--text-primary\) 11%, transparent\);/);
    expect(artifactCss).toMatch(/--control-soft-active:\s*color-mix\(in srgb, var\(--text-primary\) 16%, transparent\);/);
    const text = hex(theme, '--text-primary');
    for (const surface of ['--bg-primary', '--bg-secondary', '--panel-bg', '--topbar-bg']) {
      const s = hex(theme, surface);
      const softHover = mix(text, s, 0.11), softPress = mix(text, s, 0.16);
      expect(step(softPress, softHover), `${theme} soft on ${surface}`).toBeGreaterThanOrEqual(8);
      expect(contrast(text, softPress)).toBeGreaterThanOrEqual(4.5);
    }
    const active = hex(theme, '--bg-active');
    const onHover = mix(text, active, 0.08), onPress = mix(text, active, 0.16);
    expect(step(onPress, onHover), `${theme} on`).toBeGreaterThanOrEqual(8);
    expect(contrast(text, onPress)).toBeGreaterThanOrEqual(4.5);
    const selected = hex(theme, '--bg-selected');
    const selectedPress = mix(text, selected, 0.08);
    expect(step(selectedPress, selected), `${theme} selected`).toBeGreaterThanOrEqual(8);
    expect(contrast(text, selectedPress)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the Import popover drops clear of the Records filter', () => {
  // A fixed top would cut into the filter field, and the field's left edge would run
  // up out of the popover's top-left corner, so the corner would read square. The
  // popover drops from the Import button with a 4px gap and covers the field. The panel
  // sets the top and left from its button, so the rule reads them, with a fixed
  // place at 1440x900 as the fallback.
  it('sits 4px under the Import button and keeps its 12px bottom margin', () => {
    const body = ruleBodies('.motif-cs-sidebar .motif-cs-import-panel[open]')[0];
    expect(body).toMatch(/\btop: var\(--motif-cs-import-top, 84px\);/);
    expect(body).toMatch(/\bleft: var\(--motif-cs-import-left, 8px\);/);
    expect(body).toMatch(/max-height: calc\(100vh - var\(--motif-cs-import-top, 84px\) - 12px\);/);
  });

  it('takes its place from the button that opened it, 4px under it and 8px inside the viewport', () => {
    const panel = sliceBetween(artifactSource, 'function ImportSequencePanel({', 'function FeatureList({');
    expect(panel).toMatch(/querySelectorAll<HTMLElement>\('\[aria-controls="motif-cs-add-entry"\]'\)/);
    expect(panel).toMatch(/setProperty\('--motif-cs-import-top', `\$\{button\.bottom \+ 4\}px`\)/);
    expect(panel).toMatch(/button\.left \+ width <= right \? button\.left : button\.right - width/);
    expect(panel).toMatch(/Math\.max\(8, Math\.min\(left, right - width\)\)/);
    for (const selector of ['.motif-cs-record-strip .motif-cs-import-panel[open]', '.motif-cs-sidebar .motif-cs-import-panel[open]']) {
      expect(ruleBodies(selector).join('\n'), selector).toMatch(/\bleft: var\(--motif-cs-import-left, 8px\);/);
    }
  });
});
