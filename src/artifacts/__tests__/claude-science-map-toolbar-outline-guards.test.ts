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
  it('borders the shape toggle like the Sites field and rests the zoom group bare', () => {
    // One `role="group"` in the map heading holds three, four, or five controls
    // depending on the record: zoom out, Fit, zoom in, then the shape toggle on a
    // nucleotide record and the Sites field on DNA. A bare shape toggle would read
    // the bare "Line" as part of "Sites". It is an action, so it carries the Sites
    // field's own edge and fill, and only the zoom trio rests bare. The
    // Circle | Line pair is a segmented group whose segments must be full 28px targets,
    // so its 1px field edge is an inset shadow in the edge colour that takes no space
    // (forced colours get a system-colour outline drawn inside instead).
    const mode = rule(artifactCss, '.motif-cs-map-toolbar .motif-cs-map-shape');
    expect(mode).toMatch(/border:\s*0;/);
    expect(mode).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border-strong\);/);
    expect(mode).toMatch(/height:\s*28px/);
    expect(mode).toMatch(/background:\s*var\(--bg-primary\)/);
    expect(mode).toMatch(/margin-left:\s*6px/);

    // The base class stays bare and keeps the 1px reserved, so landing a hover
    // border moves nothing.
    const base = rule(artifactCss, '.motif-cs-map-button');
    expect(base).toMatch(/border:\s*1px solid transparent/);
    expect(base).toMatch(/background:\s*transparent/);
  });

  it('leaves hover and the pressed state as the only marks in the group', () => {
    // Hover and keyboard focus fill the button, as they fill every other button;
    // no edge appears, so a box never means "button" in this app.
    const hover = rule(artifactCss, '.motif-cs-map-button:hover,\n.motif-cs-map-button:focus-visible');
    expect(hover).toMatch(/border-color:\s*transparent/);
    expect(hover).toMatch(/background:\s*var\(--control-hover\)/);
    expect(hover).toMatch(/color:\s*var\(--text-primary\)/);

    // The Sites menu is a field, not a pressed chip: a bordered select with a
    // visible "Sites" label, so its value is the state and nothing else paints it.
    const sites = rule(artifactCss, '.motif-cs-map-sites-toggle');
    expect(sites).toMatch(/border:\s*1px solid var\(--border-strong\)/);
    expect(sites).toMatch(/background:\s*var\(--bg-primary\)/);
    expect(sites).toMatch(/height:\s*28px/);
    expect(artifactCss).not.toContain('.motif-cs-map-sites-toggle[data-active]');
  });

  it('lets the control group own its own layout', () => {
    // Both `.motif-cs-pane-title > div` rules outrank `.motif-cs-map-toolbar`,
    // and the group is a bare `div` in that heading, so without the `:not()`
    // they would govern it. At 1440x900 the group would paint `align-items:
    // baseline`, leaving its five 28px buttons on four tops spanning 3.75px
    // (441.0, 441.5, 444.203, 444.75); `flex: 1 1 0`, stretching its box to 644px
    // around 176px of controls; and `gap: 6px` and `gap: 1px` over its own. With
    // the exclusion: one top, 441.0, in all five record shapes, and a 176px box.
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
    // the whole boundary, so it has to stay twice the gap it separates.
    expect(toolbar).toMatch(/gap:\s*6px/);
  });

  it('paints the focus ring on all four sides of a map control', () => {
    // The ring is 2px wide 2px outside the button, and the heading leaves it
    // 2px before the map frame starts. The frame is `position: relative` and
    // comes later in the document, so at `z-index: auto` it would cover the ring's
    // bottom segment. With the focused button lifted over the frame, all four sides
    // read 5.39 light and 6.21 dark, on every member of every record shape.
    const lift = rule(artifactCss, '.motif-cs-map-button:focus-visible');
    expect(lift).toMatch(/position:\s*relative/);
    expect(lift).toMatch(/z-index:\s*1/);
    expect(artifactCss).toContain('.motif-cs-map-button:focus-visible,\n');
  });

  it('paints the focus ring on all four sides of a Circle or Line segment', () => {
    // The segments do not carry `.motif-cs-map-button`, so the lift above does not
    // reach them, and their group isolates. Unlifted, with the keyboard: at 400px
    // the ring's bottom side shows 0 of 4 ring pixels in light and dark (the map
    // frame covers it), and a free segment's side along the seam shows 0 of 4
    // under the pressed segment's z-index 1. Lifted, every side reads 4 of 4 at
    // 400, 600 and 1040px.
    const group = rule(artifactCss, '.motif-cs-map-toolbar .motif-cs-map-shape:has(> button:focus-visible)');
    expect(group).toMatch(/position:\s*relative/);
    expect(group).toMatch(/z-index:\s*1/);
    const segment = rule(artifactCss, '.motif-cs-map-toolbar .motif-cs-map-shape > button:focus-visible');
    expect(segment).toMatch(/position:\s*relative/);
    expect(segment).toMatch(/z-index:\s*2/);
  });
});
