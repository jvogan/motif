import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Dark theme must stay easy to see. These guards pin its contrast as numbers
// worked out from the theme's own tokens, so a value change that sinks one of them
// into the ground fails here. Light is the reference.
const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const mapCss = readFileSync(resolve(here, '..', '..', 'components', 'plasmid-map', 'plasmid-map.css'), 'utf8');

type Rgb = [number, number, number];

const parse = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(),
    body: match[2],
  }));
const artifactRules = parse(artifactCss);
const mapRules = parse(mapCss);

function body(rules: ReturnType<typeof parse>, selector: string): string {
  const found = rules.find((candidate) => candidate.selector === selector);
  expect(found, `missing CSS rule: ${selector}`).toBeDefined();
  return found!.body;
}

const dark = body(artifactRules, 'html[data-theme="dark"]');
const light = body(artifactRules, ':root,\nhtml[data-theme="light"]');

function hex(block: string, name: string): Rgb {
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

describe('Dark theme legibility', () => {
  it('washes a map selection so it reads as a region on the dark map ground', () => {
    const rule = body(mapRules, 'html[data-theme="dark"] .motif-cs-map-frame .motif-pm-selection-layer .motif-pm-selection');
    const opacity = Number(/fill-opacity:\s*([\d.]+)/.exec(rule)?.[1]);
    const ground = hex(dark, '--bg-primary');
    const wash = mix(hex(dark, '--accent'), ground, opacity);
    // The wash steps at least 1.15 off the map ground.
    expect(contrast(wash, ground)).toBeGreaterThanOrEqual(1.15);
    // Coordinate numerals (secondary ink) stay easy to read on it.
    expect(contrast(hex(dark, '--text-secondary'), wash)).toBeGreaterThanOrEqual(7);
    // The shared rule that Light uses keeps its 0.06.
    expect(body(artifactRules, '.motif-cs-map-frame .motif-pm-selection-layer .motif-pm-selection')).toMatch(/fill-opacity:\s*0\.06;/);
    expect(light).toBeTruthy();
  });

  it('tints a sequence selection so it stands off the dark ground with its bases still crisp', () => {
    const rules = artifactRules.filter((candidate) => candidate.selector === 'html[data-theme="dark"]' && /--selection-bg/.test(candidate.body));
    expect(rules).toHaveLength(1);
    const weight = Number(/--selection-bg:\s*color-mix\(in srgb, var\(--accent\) (\d+)%, var\(--bg-primary\)\)/.exec(rules[0].body)?.[1]) / 100;
    const ground = hex(dark, '--bg-primary');
    const tint = mix(hex(dark, '--accent'), ground, weight);
    // The tint steps at least 1.5 off the ground.
    expect(contrast(tint, ground)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(hex(dark, '--text-primary'), tint)).toBeGreaterThanOrEqual(9.5);
    expect(contrast(hex(dark, '--text-secondary'), tint)).toBeGreaterThanOrEqual(7);
    // Light keeps the shared 22% rule.
    expect(artifactCss).toMatch(/:root \{[^}]*--selection-bg:\s*color-mix\(in srgb, var\(--accent\) 22%, var\(--bg-primary\)\)/);
  });
  it('draws map ticks and field outlines in a strong edge that holds on every dark surface', () => {
    const edge = hex(dark, '--border-strong');
    // Minor map ticks paint in --border-strong on the map ground (--bg-primary).
    expect(contrast(edge, hex(dark, '--bg-primary'))).toBeGreaterThanOrEqual(4.5);
    // Field and control outlines hold 3:1 on the surfaces they sit on.
    for (const surface of ['--bg-primary', '--bg-secondary', '--panel-bg', '--workspace-bg']) {
      expect(contrast(edge, hex(dark, surface)), surface).toBeGreaterThanOrEqual(3);
    }
    // And stay quieter than muted text, so an outline never outweighs a label.
    expect(contrast(edge, hex(dark, '--bg-primary'))).toBeLessThan(contrast(hex(dark, '--text-muted'), hex(dark, '--bg-primary')));
  });
  it('separates rows, panels and floating surfaces with edges as distinct as Light draws them', () => {
    const ground = hex(dark, '--bg-primary');
    const white = hex(light, '--bg-primary');
    // Light's dividers read 1.41 (border) and 1.24 (subtle) on white; Dark's are at least as distinct.
    expect(contrast(hex(dark, '--border'), ground)).toBeGreaterThanOrEqual(contrast(hex(light, '--border'), white));
    expect(contrast(hex(dark, '--border-subtle'), ground)).toBeGreaterThanOrEqual(contrast(hex(light, '--border-subtle'), white) - 0.01);
    // The order holds: subtle under border under strong.
    expect(luminance(hex(dark, '--border-subtle'))).toBeLessThan(luminance(hex(dark, '--border')));
    expect(luminance(hex(dark, '--border'))).toBeLessThan(luminance(hex(dark, '--border-strong')));
    // A menu or window painted in the pane's own colour is found by its 1px ring.
    expect(contrast(hex(dark, '--elevation-edge'), ground)).toBeGreaterThanOrEqual(1.75);
  });
  it('steps the canvas under the panes far enough that a pane reads as a surface', () => {
    // The panes (records list, sequence, map frame) stand at least 1.12 off the canvas.
    const canvas = hex(dark, '--workspace-bg');
    for (const pane of ['--bg-primary', '--panel-bg']) expect(contrast(hex(dark, pane), canvas), pane).toBeGreaterThanOrEqual(1.12);
    expect(hex(dark, '--topbar-bg')).toEqual(canvas);
    // The page behind the shell stays at or under the canvas.
    expect(luminance(hex(dark, '--app-bg'))).toBeLessThanOrEqual(luminance(canvas));
    // An on-state fill in the top bar keeps its step and does not jump: 1.4 to 1.7.
    const on = contrast(hex(dark, '--bg-active'), canvas);
    expect(on).toBeGreaterThanOrEqual(1.4);
    expect(on).toBeLessThan(1.7);
  });
  it('lifts an on-state far enough off a raised surface to tell it from its off neighbour', () => {
    // Sense | Antisense and the reading frames sit on the secondary surface; the on segment
    // stands at least 1.4 off it. Primary text on it keeps 10:1.
    const on = hex(dark, '--bg-active');
    expect(contrast(on, hex(dark, '--bg-secondary'))).toBeGreaterThanOrEqual(1.4);
    expect(contrast(on, hex(dark, '--bg-primary'))).toBeGreaterThanOrEqual(1.4);
    expect(contrast(on, hex(dark, '--bg-hover'))).toBeGreaterThanOrEqual(1.15);
    expect(contrast(hex(dark, '--text-primary'), on)).toBeGreaterThanOrEqual(10);
  });
  it('raises a menu off the pane it opens over, with its hover and separators lifted too', () => {
    const rule = body(artifactRules, 'html:is([data-theme="dark"]) :is(.motif-cs-action-menu-list, .motif-cs-map-enzyme-menu)');
    expect(rule).toMatch(/--bg-primary:\s*var\(--bg-hover\);/);
    const fill = hex(dark, '--bg-hover');
    // The right-click menu stands at least 1.2:1 off the sequence pane it floats over.
    for (const under of ['--bg-primary', '--panel-bg', '--workspace-bg']) {
      expect(contrast(fill, hex(dark, under)), under).toBeGreaterThanOrEqual(1.2);
    }
    // Over the secondary surface the step is 1.18, so the 3:1 ring below carries it there.
    expect(contrast(fill, hex(dark, '--bg-secondary'))).toBeGreaterThanOrEqual(1.15);
    const lift = Number(/--control-hover:\s*color-mix\(in srgb, var\(--text-primary\) (\d+)%, var\(--bg-active\)\);/.exec(rule)?.[1]) / 100;
    const hover = mix(hex(dark, '--text-primary'), hex(dark, '--bg-active'), lift);
    expect(contrast(hover, fill)).toBeGreaterThanOrEqual(1.25);
    expect(rule).toMatch(/--border-subtle:\s*var\(--elevation-edge\);/);
    expect(contrast(hex(dark, '--elevation-edge'), fill)).toBeGreaterThanOrEqual(1.4);
    // Text holds on the raised fill and on its hover; the ring stays 3:1.
    expect(contrast(hex(dark, '--text-primary'), hover)).toBeGreaterThanOrEqual(7);
    expect(contrast(hex(dark, '--text-secondary'), fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(dark, '--text-muted'), fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(dark, '--border-strong'), fill)).toBeGreaterThanOrEqual(3);
  });
  it('tints a Find match deep enough to spot on the dark sequence ground', () => {
    const findRules = parse(readFileSync(resolve(here, '..', 'claude-science-find.css'), 'utf8'));
    const rule = body(findRules, 'html[data-theme="dark"] .motif-cs-find-hit');
    const weight = Number(/color-mix\(in srgb, var\(--purple\) (\d+)%, transparent\)/.exec(rule)?.[1]) / 100;
    const ground = hex(dark, '--bg-primary');
    const tint = mix(hex(dark, '--purple'), ground, weight);
    // A match tint at the shared 22% or at 30% reads as faint; Dark's steps at least 1.8 off the ground.
    expect(contrast(tint, ground)).toBeGreaterThanOrEqual(1.8);
    expect(contrast(hex(dark, '--text-primary'), tint)).toBeGreaterThanOrEqual(8.5);
    // The complement under a bottom-strand hit is drawn in secondary ink (4.5 floor).
    expect(contrast(hex(dark, '--text-secondary'), tint)).toBeGreaterThanOrEqual(6);
    // It stays apart from the selection tint and the hover grey (25 or more RGB units).
    const selection = mix(hex(dark, '--accent'), ground, 0.3);
    const far = (a: Rgb, b: Rgb) => Math.max(...a.map((channel, index) => Math.abs(channel - b[index])));
    expect(far(tint, selection)).toBeGreaterThanOrEqual(25);
    expect(far(tint, hex(dark, '--bg-hover'))).toBeGreaterThanOrEqual(25);
    // Light keeps the shared 22%.
    expect(body(findRules, '.motif-cs-find-hit')).toMatch(/var\(--purple\) 22%/);
  });
  it('fills map features deep enough to read as bands while a name on the brightest keeps 7:1', () => {
    const rule = body(mapRules, 'html[data-theme="dark"] .motif-pm-feature:not(:hover)');
    const weight = Number(/--pm-fill:\s*color-mix\(in srgb, var\(--pm-base, #8a8a8a\) (\d+)%, var\(--bg-primary, #1f1f1f\)\)/.exec(rule)?.[1]) / 100;
    const ground = hex(dark, '--bg-primary');
    // Dark feature bases measured in the build: the dimmest band (misc, purple) and the
    // brightest (promoter, amber), the one a riding name has least room on.
    const dimmest: Rgb = [156, 90, 181];
    const brightest: Rgb = [255, 153, 0];
    // The misc band steps at least 1.5 off the ground; the shared 32% is too faint there.
    expect(contrast(mix(dimmest, ground, weight), ground)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(hex(dark, '--text-primary'), mix(brightest, ground, weight))).toBeGreaterThanOrEqual(7);
    // Hover stays a step deeper than rest, and Light keeps the shared 32%.
    expect(body(mapRules, '.motif-pm-feature:hover')).toMatch(/44%/);
    expect(weight).toBeLessThan(0.44);
    expect(body(mapRules, '.motif-pm-feature')).toMatch(/var\(--pm-base, #8a8a8a\) 32%/);
  });
  it('sets the records list a step low enough that a hovered row stands off its neighbours', () => {
    const rule = body(artifactRules, 'html:is([data-theme="dark"]) .motif-cs-sidebar');
    const weight = Number(/--panel-bg:\s*color-mix\(in srgb, var\(--bg-primary\) (\d+)%, var\(--workspace-bg\)\);/.exec(rule)?.[1]) / 100;
    const list = mix(hex(dark, '--bg-primary'), hex(dark, '--workspace-bg'), weight);
    // A hovered row stands at least 1.3 off the lifted pane.
    expect(contrast(hex(dark, '--bg-hover'), list)).toBeGreaterThanOrEqual(1.3);
    expect(contrast(hex(dark, '--bg-selected'), list)).toBeGreaterThanOrEqual(1.6);
    // Still a surface over the canvas, with its text and the filter outline intact.
    expect(luminance(list)).toBeGreaterThan(luminance(hex(dark, '--workspace-bg')));
    expect(contrast(hex(dark, '--text-primary'), list)).toBeGreaterThanOrEqual(7);
    expect(contrast(hex(dark, '--text-muted'), list)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(hex(dark, '--border-strong'), list)).toBeGreaterThanOrEqual(3);
  });
  it('scopes a token override to its element without reading as a Dark theme block', () => {
    // Guards elsewhere gather every rule that starts html[data-theme="dark"] as theme
    // tokens. An element-scoped override written that way (a menu's --bg-primary) would
    // be read as the theme's own and sink the MSA template badge to 4.18:1 there.
    const scoped = artifactRules.filter((rule) => rule.selector.startsWith('html[data-theme="dark"] '));
    for (const rule of scoped) expect(rule.body, rule.selector).not.toMatch(/--[a-z-]+\s*:/);
    const overrides = artifactRules.filter((rule) => rule.selector.startsWith('html:is([data-theme="dark"]) ') && /--[a-z-]+\s*:/.test(rule.body));
    expect(overrides.map((rule) => rule.selector)).toEqual([
      'html:is([data-theme="dark"]) :is(.motif-cs-action-menu-list, .motif-cs-map-enzyme-menu)',
      'html:is([data-theme="dark"]) .motif-cs-sidebar',
      'html:is([data-theme="dark"]) button.motif-cs-digest-enzyme-chip',
    ]);
  });
});

describe('Dark digest enzyme tiles read as buttons', () => {
  // A tile resting in the panel's own fill would sit 1.04:1 off it, behind a
  // 1.23:1 edge. It rests in the hover grey and steps up on hover and press.
  it('rests 1.2:1 off the panel, steps on hover and press, and keeps the selected tile 1.25:1 apart', () => {
    const rule = body(artifactRules, 'html:is([data-theme="dark"]) button.motif-cs-digest-enzyme-chip');
    expect(rule).toMatch(/--control-bg:\s*var\(--bg-hover\);/);
    expect(rule).toMatch(/--control-hover:\s*var\(--bg-active\);/);
    expect(rule).toMatch(/--control-active:\s*color-mix\(in srgb, var\(--text-primary\) 8%, var\(--bg-active\)\);/);
    const panel = hex(dark, '--bg-primary');
    const text = hex(dark, '--text-primary');
    const rest = hex(dark, '--bg-hover');
    const hover = hex(dark, '--bg-active');
    const press = mix(text, hover, 0.08);
    const selected = mix(hex(dark, '--accent'), panel, 0.3);
    expect(contrast(rest, panel)).toBeGreaterThanOrEqual(1.2);
    expect(contrast(hover, rest)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(press, hover)).toBeGreaterThanOrEqual(1.15);
    expect(contrast(selected, rest)).toBeGreaterThanOrEqual(1.25);
    for (const ground of [rest, hover, press, selected]) {
      expect(contrast(hex(dark, '--text-secondary'), ground)).toBeGreaterThanOrEqual(press === ground ? 6 : 7);
      expect(contrast(text, ground)).toBeGreaterThanOrEqual(7);
    }
    // The tile rules read the three tokens, so Light keeps its own values.
    expect(body(artifactRules, '.motif-cs-digest-enzyme-chip')).toMatch(/background:\s*var\(--control-bg\);/);
    expect(body(artifactRules, 'button.motif-cs-digest-enzyme-chip:hover')).toMatch(/background:\s*var\(--control-hover\);/);
    expect(body(artifactRules, 'button.motif-cs-digest-enzyme-chip:active')).toMatch(/background:\s*var\(--control-active\);/);
  });
});
