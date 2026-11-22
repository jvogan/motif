import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

// Where the rule whose selector list is exactly `selector` starts, and its body.
function rule(selector: string): { at: number; body: string } {
  const at = artifactCss.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = artifactCss.indexOf('{', at + selector.length);
  return { at, body: artifactCss.slice(open + 1, artifactCss.indexOf('}', open)) };
}

// Replace | Insert and Circle | Line draw their edge as a 1px inset shadow, and the
// selected segment's fill sits inside it through a clear 1px border and
// background-clip: padding-box. Two things would break that: a 2px radius on
// Circle | Line's fill would fill the group's 6px corner over the edge (edge-to-fill
// contrast 1.00 at the corner), and a hovered selected Replace or Insert taking the
// `background` shorthand of the hover rules would reset the clip to border-box, so
// the fill would cover the edge.
describe('a selected segment stays inside its group\'s inset edge', () => {
  // The on hand toggle shares the selected Circle | Line rule, so the list names both.
  it('rounds the selected Circle | Line fill with the group\'s radius', () => {
    const { body } = rule('.motif-cs-map-toolbar .motif-cs-map-shape > button[data-active],\nhtml[data-theme] .motif-cs-map-toolbar .motif-cs-segmented.motif-cs-map-shape > button[data-active],\n.motif-cs-map-toolbar .motif-cs-map-hand[data-active],\nhtml[data-theme] .motif-cs-map-toolbar .motif-cs-map-button.motif-cs-map-hand[data-active]');
    expect(body).toMatch(/border-radius:\s*var\(--radius-sm\);/);
    expect(body).toMatch(/background-clip:\s*padding-box;/);
    expect(rule('.motif-cs-map-toolbar .motif-cs-map-shape').body).toMatch(/border-radius:\s*var\(--radius-sm\);/);
  });

  it('keeps the clip and the radius when the selected segment is hovered, focused or pressed', () => {
    const guard = rule('html[data-theme] :is(.motif-cs-edit-toolbar .motif-cs-segmented, .motif-cs-map-toolbar .motif-cs-map-shape) > button[data-active]:is(:hover, :focus-visible, :active)');
    expect(guard.body).toMatch(/background-clip:\s*padding-box;/);
    expect(guard.body).toMatch(/border-radius:\s*var\(--radius-sm\);/);
    // Specificity (0,5,2) and later in the file than every state rule that sets the
    // shorthand on a selected segment, the strongest of which is (0,5,1).
    const shorthandStates = rule('.motif-cs-mini-button[data-active="true"]:hover,\n.motif-cs-mini-button[data-active="true"]:focus-visible,\n.motif-cs-segmented button[data-active]:hover,\n.motif-cs-segmented button[data-active]:focus-visible,\n.motif-cs-sequence-panel .motif-cs-edit-toolbar .motif-cs-segmented button[data-active]:hover');
    expect(shorthandStates.body).toMatch(/(^|[\s;])background:/);
    expect(guard.at).toBeGreaterThan(shorthandStates.at);
  });

  // Hovering or pressing the free Circle or Line segment must not paint its fill over
  // the group's edge along its three outer sides. The edge is drawn over both
  // segments, and only a focused segment, whose 2px ring is drawn inside it, rises
  // above it.
  it('draws the Circle | Line edge over both segments, so no hover, press or selected fill covers it', () => {
    expect(rule('.motif-cs-map-toolbar .motif-cs-map-shape').body).toMatch(/position:\s*relative;/);
    const edge = rule('.motif-cs-map-toolbar .motif-cs-map-shape::after').body;
    expect(edge).toMatch(/content:\s*"";/);
    expect(edge).toMatch(/position:\s*absolute;/);
    expect(edge).toMatch(/inset:\s*0;/);
    expect(edge).toMatch(/z-index:\s*1;/);
    expect(edge).toMatch(/border-radius:\s*inherit;/);
    expect(edge).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border-strong\);/);
    expect(edge).toMatch(/pointer-events:\s*none;/);
    // The free segment's fill stays out from under the edge, so its anti-aliased
    // corner pixels read the same hovered as at rest.
    const free = rule('html[data-theme] .motif-cs-map-toolbar .motif-cs-map-shape > button:is(:hover, :active)');
    expect(free.body).toMatch(/background-clip:\s*padding-box;/);
    expect(free.at).toBeGreaterThan(rule('.motif-cs-segmented button:not([data-active], :disabled):hover').at);
    // A focused segment, selected or not, stays above the edge: (0,4,2) beats the
    // selected segment's (0,3,2) z-index 1.
    expect(rule('html[data-theme] .motif-cs-map-toolbar .motif-cs-map-shape > button:focus-visible').body).toMatch(/z-index:\s*2;/);
  });

  // With each segment selected, in Light and Dark: rounded corners on the seam side of the
  // selected fill, and Circle | Line's clear 1px edge there, would leave the fill 4-17
  // device px short of the seam at its top and bottom rows (a notch). It ends in one
  // straight seam; the group's own ends stay round.
  it('ends the selected fill in one straight seam and keeps only the group\'s ends round', () => {
    const circle = rule('html[data-theme] .motif-cs-map-toolbar .motif-cs-map-shape > button[data-active]:first-child').body;
    expect(circle).toMatch(/border-right-width:\s*0;/);
    expect(circle).toMatch(/border-top-right-radius:\s*0;/);
    expect(circle).toMatch(/border-bottom-right-radius:\s*0;/);
    // The 1px of padding takes the edge's place, so the icon does not move.
    expect(circle).toMatch(/padding-right:\s*1px;/);
    expect(circle).not.toMatch(/border-(top|bottom)-left-radius/);
    const line = rule('html[data-theme] .motif-cs-map-toolbar .motif-cs-map-shape > button[data-active]:last-child').body;
    expect(line).toMatch(/border-left-width:\s*0;/);
    expect(line).toMatch(/border-top-left-radius:\s*0;/);
    expect(line).toMatch(/border-bottom-left-radius:\s*0;/);
    expect(line).toMatch(/padding-left:\s*1px;/);
    expect(line).not.toMatch(/border-(top|bottom)-right-radius/);
    // (0,5,2) and later than the state rule that puts the full radius back on a
    // hovered, focused or pressed selected segment.
    const states = rule('html[data-theme] :is(.motif-cs-edit-toolbar .motif-cs-segmented, .motif-cs-map-toolbar .motif-cs-map-shape) > button[data-active]:is(:hover, :focus-visible, :active)');
    expect(rule('html[data-theme] .motif-cs-map-toolbar .motif-cs-map-shape > button[data-active]:first-child').at).toBeGreaterThan(states.at);

    const left = rule('html[data-theme] .motif-cs-segmented > button[data-active]:not(:first-child)');
    expect(left.body).toMatch(/border-top-left-radius:\s*0;/);
    expect(left.body).toMatch(/border-bottom-left-radius:\s*0;/);
    expect(left.body).not.toMatch(/right-radius/);
    const right = rule('html[data-theme] .motif-cs-segmented > button[data-active]:not(:last-child)');
    expect(right.body).toMatch(/border-top-right-radius:\s*0;/);
    expect(right.body).toMatch(/border-bottom-right-radius:\s*0;/);
    expect(right.body).not.toMatch(/left-radius/);
    // Later than the (0,3,1) rule that gives a selected segment its 2px corners.
    const twoPx = rule('html[data-theme] .motif-cs-segmented > button[data-active]');
    expect(twoPx.body).toMatch(/border-radius:\s*2px;/);
    expect(left.at).toBeGreaterThan(twoPx.at);
    expect(right.at).toBeGreaterThan(twoPx.at);
  });

  // In Light and Dark, hovering or pressing the FREE segment must not bend the
  // seam: round seam-side corners (up to 11 device px for Circle | Line, 2 for
  // Strand and Reading frame) would bend it, and Circle | Line's clear 1px edge
  // would leave a 1px gap to the selected fill.
  it('ends a hovered, pressed or focused free segment in the same straight seam', () => {
    const left = rule('html[data-theme] .motif-cs-segmented > button:not(:first-child)');
    expect(left.body).toMatch(/border-top-left-radius:\s*0;/);
    expect(left.body).toMatch(/border-bottom-left-radius:\s*0;/);
    expect(left.body).not.toMatch(/right-radius/);
    const right = rule('html[data-theme] .motif-cs-segmented > button:not(:last-child)');
    expect(right.body).toMatch(/border-top-right-radius:\s*0;/);
    expect(right.body).toMatch(/border-bottom-right-radius:\s*0;/);
    expect(right.body).not.toMatch(/left-radius/);
    // (0,3,2) outranks the (0,2,1) radius every Circle | Line segment takes.
    expect(rule('.motif-cs-map-toolbar .motif-cs-map-shape > button').body).toMatch(/border-radius:\s*var\(--radius-sm\);/);
    const circle = rule('html[data-theme] .motif-cs-map-toolbar .motif-cs-map-shape > button:first-child').body;
    expect(circle).toMatch(/border-right-width:\s*0;/);
    expect(circle).toMatch(/padding-right:\s*1px;/);
    const line = rule('html[data-theme] .motif-cs-map-toolbar .motif-cs-map-shape > button:last-child').body;
    expect(line).toMatch(/border-left-width:\s*0;/);
    expect(line).toMatch(/padding-left:\s*1px;/);
  });

  it('keeps the groups\' edge an inset shadow that takes no space, so both options stay 28px', () => {
    for (const group of ['.motif-cs-edit-toolbar .motif-cs-segmented', '.motif-cs-map-toolbar .motif-cs-map-shape']) {
      const { body } = rule(group);
      expect(body, group).toMatch(/border:\s*0;/);
      expect(body, group).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--border-strong\);/);
    }
  });
});
