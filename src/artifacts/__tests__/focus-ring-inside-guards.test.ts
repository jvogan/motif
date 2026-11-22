import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

// The body of the first rule whose selector text is exactly `selector`.
function cssBlock(selector: string): string {
  const open = artifactCss.indexOf(`\n${selector} {`);
  expect(open, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const start = artifactCss.indexOf('{', open) + 1;
  return artifactCss.slice(start, artifactCss.indexOf('\n}', start));
}

describe('the focus ring is drawn inside the control', () => {
  // A 2px ring at offset 2px would reach 4px outside the control, where a
  // scrolling list (the Records rows and group head) cuts it, the sequence
  // toolbar loses its top 2px, and the control beside Export, the title button
  // or a pane toggle paints over it. Inside the box nothing cuts or covers it.
  it('draws the shell-wide ring 2px wide and wholly inside the border box', () => {
    const body = cssBlock('#root :focus-visible');
    expect(body).toMatch(/outline:\s*2px solid var\(--focus-ring\);/);
    expect(body).toMatch(/outline-offset:\s*-2px;/);
  });

  it('lets no id-scoped focus rule push the ring back outside', () => {
    // Only an id-scoped rule outranks `#root :focus-visible` (1,1,0).
    const offsets = [...artifactCss.matchAll(/\n(#root [^{]*:focus-visible[^{]*)\{([^}]*)\}/g)]
      .map((m) => ({ selector: m[1].trim(), offset: /outline-offset:\s*(-?[\d.]+)px/.exec(m[2])?.[1] }))
      .filter((r) => r.offset !== undefined);
    expect(offsets.length).toBeGreaterThan(0);
    for (const r of offsets) expect(Number(r.offset), r.selector).toBeLessThanOrEqual(-2);
  });

  it('shows an arrow-headed block whole while focused, so clip-path cannot cut the ring', () => {
    expect(cssBlock('#root .motif-cs-feature-block[data-head="true"]:focus-visible')).toMatch(/clip-path:\s*none;/);
  });
});

describe('a focused field shows one ring', () => {
  // Every text field and select shows the same single ring however it got focus: not
  // an accent border plus a 1px outline when picked with the pointer, and not a grey
  // border and nothing else.
  it('gives every text field and select the shell ring on any focus', () => {
    const body = cssBlock('#root :is(select, textarea, .motif-cs-field, .motif-cs-input, .motif-cs-find-input, .motif-cs-title-edit):focus');
    expect(body).toMatch(/outline:\s*2px solid var\(--focus-ring\);/);
    expect(body).toMatch(/outline-offset:\s*-2px;/);
  });

  it('keeps no second field treatment beside it', () => {
    for (const selector of ['.motif-cs-input:focus', '.motif-cs-field:focus', '.motif-cs-textarea:focus', '.motif-cs-title-edit:focus']) {
      expect(artifactCss, selector).not.toMatch(new RegExp(`\\n${selector.replace(/[\\.]/g, '\\$&')}\\s*[,{]`));
    }
  });
});

describe('an on toggle answers the pointer', () => {
  // Show tracks (on) and Circle (on) change on hover in light and dark.
  it('gives the on Circle | Line segment a hover step past its fill', () => {
    const body = cssBlock('.motif-cs-map-toolbar .motif-cs-map-shape > button[data-active]:hover,\nhtml[data-theme] .motif-cs-map-toolbar .motif-cs-segmented.motif-cs-map-shape > button[data-active]:hover');
    expect(body).toMatch(/background:\s*color-mix\(in srgb, var\(--text-primary\) 8%, var\(--bg-active\)\);/);
  });

  it('gives an on display switch the hover fill', () => {
    expect(cssBlock('.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-display-switch[data-active="true"]:hover')).toMatch(/background:\s*var\(--control-hover\);/);
  });
});

describe('an on display switch in the narrow toolbar answers the pointer', () => {
  it('steps the filled on switch past its fill on hover', () => {
    const at = artifactCss.indexOf('  .motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-display-switch.motif-cs-mini-button[data-active="true"]:hover {');
    expect(at).toBeGreaterThan(artifactCss.indexOf('@container (max-width: 559px) {'));
    expect(artifactCss.slice(at, artifactCss.indexOf('}', at))).toMatch(/background:\s*color-mix\(in srgb, var\(--text-primary\) 8%, var\(--bg-active\)\);/);
  });
});
