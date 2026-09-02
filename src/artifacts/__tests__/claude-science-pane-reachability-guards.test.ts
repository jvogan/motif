import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

/** Declarations of the first rule whose selector line matches `selector`. */
function declarationsOf(selector: string): string {
  const start = artifactCss.indexOf(`${selector} {`);
  expect(start, `missing rule: ${selector}`).toBeGreaterThanOrEqual(0);
  const open = artifactCss.indexOf('{', start);
  const close = artifactCss.indexOf('}', open);
  expect(close, `unterminated rule: ${selector}`).toBeGreaterThan(open);
  return artifactCss.slice(open + 1, close);
}

/** Body of the first `@media <condition>` block, brace-matched. */
function mediaBlock(condition: string): string {
  const start = artifactCss.indexOf(`@media ${condition} {`);
  expect(start, `missing media block: ${condition}`).toBeGreaterThanOrEqual(0);
  const open = artifactCss.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < artifactCss.length; i += 1) {
    if (artifactCss[i] === '{') depth += 1;
    else if (artifactCss[i] === '}') {
      depth -= 1;
      if (depth === 0) return artifactCss.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated media block: ${condition}`);
}

describe('pane reachability guards', () => {
  it('lets the compact sequence panel shrink so the bases scroll inside it', () => {
    // `flex: 0 0 auto` held the panel at content height instead of at its floor.
    // Measured at 1280x720: panel 2207px inside a 240px pane, `.motif-cs-sequence`
    // scroll range 0, pane scroll range 2077px. The edit toolbar and the selection
    // bar cleared the pane's top edge at 124px of that range and the Export and
    // copy summary needed 2066px of pane scroll. With `1 1 auto` the same pane
    // scrolls 150px and the sequence scrolls 1921px.
    const panel = declarationsOf('.motif-cs-main > .motif-cs-sequence-column > .motif-cs-sequence-panel');
    expect(panel).toMatch(/flex:\s*1\s+1\s+auto\s*;/);
    expect(panel).not.toMatch(/flex:\s*0\s+0\s+auto\s*;/);
    // The floor is what keeps the toolbar off the bases; shrinking without it
    // would collapse the sequence to its own 160px minimum and no further.
    expect(panel).toMatch(/min-height:\s*280px\s*;/);
  });

  it('keeps the sequence pane the only scrollport its own bases do not use', () => {
    // `.motif-cs-sequence` must stay the scroller the panel delegates to.
    const sequence = declarationsOf('.motif-cs-sequence-panel > .motif-cs-sequence');
    expect(sequence).toMatch(/flex:\s*1\s+1\s+auto\s*;/);
    expect(sequence).toMatch(/min-height:\s*160px\s*;/);
  });

  it('does not floor the wide circular map frame above what its column can show', () => {
    // The column shows `viewport - 154px` (topbar 70, pad 10, pane title 30, dock
    // strip 34, pad 10), so a 600px floor overflowed every viewport shorter than
    // 754px. The collapsed dock strip is sticky, so it then covered 24px of map at
    // 1920x720 and 34px at 1536x700 -- a whole restriction label on 7 of the 13
    // shipped records at 1920x720.
    const wide = mediaBlock('(min-width: 1536px)');
    expect(wide).toContain(".motif-cs-map-frame .motif-pm-container[data-map-mode='circular']");
    expect(wide).not.toMatch(/min-height:\s*600px/);
    expect(wide).not.toMatch(/height:\s*clamp\(640px/);
  });

  it('keeps the map dock strip a sticky footer only while both panels are collapsed', () => {
    // Opening one makes the strip the panel body; pinning that would cover the map.
    const collapsed = declarationsOf('.motif-cs-map-dock-strip:not(:has(> details[open]))');
    expect(collapsed).toMatch(/position:\s*sticky\s*;/);
    expect(collapsed).toMatch(/bottom:\s*-10px\s*;/);
    expect(artifactCss).not.toMatch(/\.motif-cs-map-dock-strip\s*\{[^}]*position:\s*sticky/);
  });
});
