import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

// The body of the rule whose selector list is exactly `selector`. A selector
// that is also the tail of a longer list -- `.motif-cs-map-button:focus-visible`
// is the second half of the hover rule -- would otherwise return the wrong body,
// so skip any match whose preceding line ends in a comma.
function rule(source: string, selector: string): string {
  const needle = `\n${selector} {`;
  let start = -1;
  for (let at = source.indexOf(needle); at >= 0; at = source.indexOf(needle, at + 1)) {
    if (source[at - 1] !== ',') { start = at; break; }
  }
  expect(start, `missing rule: ${selector}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n}', start);
  expect(end, `unterminated rule: ${selector}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('map control group treatment guards', () => {
  it('rests every member of the map control group bare', () => {
    // One `role="group"` in the map heading holds three, four, or five controls
    // depending on the record: zoom out, Fit, zoom in, then the render-mode
    // toggle on a nucleotide record and the restriction-sites toggle on DNA.
    // Only one of them carries a state, and only that one may be marked at rest.
    //
    // The mode toggle used to carry a resting box. Measured on the built
    // artifact, rasterised over the heading it sits on (rasteriser checked
    // first against #777 on white = 4.48):
    //   resting box vs its own fill  1.24 light  1.13 dark  1.21 claude-light  1.26 claude-dark
    //   hover box, every member      1.84        1.84       1.83              2.24
    //   resting background           1.00        1.07       1.03              1.04
    // A permanent mark a third of the way to the hover mark reads as a control
    // under a pointer that is not there, and its background paints nothing in
    // any theme. Both are gone; `margin-left` was already marking the boundary.
    const mode = rule(artifactCss, '.motif-cs-map-mode-toggle');
    expect(mode, 'the render-mode toggle grew a resting border again').not.toMatch(/border-color:/);
    expect(mode, 'the render-mode toggle grew a resting background again').not.toMatch(/background:/);
    expect(mode).toMatch(/margin-left:\s*6px/);

    // The base class stays bare and keeps the 1px reserved, so landing a hover
    // border moves nothing.
    const base = rule(artifactCss, '.motif-cs-map-button');
    expect(base).toMatch(/border:\s*1px solid transparent/);
    expect(base).toMatch(/background:\s*transparent/);
  });

  it('leaves hover and the pressed state as the only marks in the group', () => {
    // Hover and keyboard focus are the one thing that draws a box here, so a
    // box has to keep meaning "the pointer is here": 1.84 / 1.84 / 1.83 / 2.24
    // against the button's fill.
    const hover = rule(artifactCss, '.motif-cs-map-button:hover,\n.motif-cs-map-button:focus-visible');
    expect(hover).toMatch(/border-color:\s*color-mix\(in srgb, var\(--border-strong\) 55%, transparent\)/);
    expect(hover).toMatch(/color:\s*var\(--text-primary\)/);

    // The scissors toggle is the only member with `aria-pressed`, so it is the
    // only one that has a state to paint. Its chip measures 5.39 light, 3.29
    // dark, 4.60 claude-light, 3.44 claude-dark against the same heading.
    const pressed = rule(
      artifactCss,
      '.motif-cs-map-sites-toggle[data-active],\n.motif-cs-map-sites-toggle[data-active]:hover,\n.motif-cs-map-sites-toggle[data-active]:focus-visible',
    );
    expect(pressed).toMatch(/background:\s*var\(--accent-base\)/);
    expect(pressed).toMatch(/color:\s*var\(--accent-contrast\)/);
  });

  it('lets the control group own its own layout', () => {
    // Both `.motif-cs-pane-title > div` rules outrank `.motif-cs-map-toolbar`,
    // and the group is a bare `div` in that heading, so without the `:not()`
    // they governed it. Measured at 1440x900 before the exclusion: the group
    // painted `align-items: baseline`, leaving its five 28px buttons on four
    // tops spanning 3.75px (441.0, 441.5, 444.203, 444.75); `flex: 1 1 0`,
    // stretching its box to 644px around 176px of controls; and `gap: 6px` and
    // `gap: 1px` over its own. After: one top, 441.0, in all five record
    // shapes, and a 176px box.
    expect(artifactCss, 'the title-block rule reached the map control group again')
      .toContain('.motif-cs-pane-title > div:not(.motif-cs-map-toolbar) {');
    expect(artifactCss, 'the map-column title rule reached the control group again')
      .toContain('.motif-cs-map-column > .motif-cs-pane-title > div:not(.motif-cs-map-toolbar) {');
    expect(artifactCss).not.toMatch(/\n\.motif-cs-pane-title > div \{/);
    expect(artifactCss).not.toMatch(/\n\.motif-cs-map-column > \.motif-cs-pane-title > div \{/);

    const toolbar = rule(artifactCss, '.motif-cs-map-toolbar');
    expect(toolbar).toMatch(/align-items:\s*center/);
    expect(toolbar).toMatch(/flex:\s*0 0 auto/);
    // 6px within the group against the mode toggle's 12px break: the spacing is
    // the whole boundary now, so it has to stay twice the gap it separates.
    expect(toolbar).toMatch(/gap:\s*6px/);
  });

  it('paints the focus ring on all four sides of a map control', () => {
    // The ring is 2px wide 2px outside the button, and the heading leaves it
    // 2px before the map frame starts. The frame is `position: relative` and
    // comes later in the document, so at `z-index: auto` it covered the ring's
    // bottom segment: three sides read 5.10-6.82:1 against the gap in front of
    // them while the bottom read 1.00-1.21. With the focused button lifted over
    // the frame, all four sides read 5.39 light, 6.21 dark, 5.10 claude-light,
    // 6.82 claude-dark, on every member of every record shape.
    const lift = rule(artifactCss, '.motif-cs-map-button:focus-visible');
    expect(lift).toMatch(/position:\s*relative/);
    expect(lift).toMatch(/z-index:\s*1/);
    expect(artifactCss).toContain('.motif-cs-map-button:focus-visible,\n');
  });
});
