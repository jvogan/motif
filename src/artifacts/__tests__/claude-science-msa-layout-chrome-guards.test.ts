import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const overlayCss = readFileSync(resolve(here, '..', 'claude-science-msa.css'), 'utf8');
const viewer = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');

function sliceBetween(startNeedle: string, endNeedle: string): string {
  const start = artifactCss.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = artifactCss.indexOf(endNeedle, start);
  expect(end, `missing end marker after ${startNeedle}: ${endNeedle}`).toBeGreaterThan(start);
  return artifactCss.slice(start, end);
}

describe('Claude Science MSA narrow chrome guards', () => {
  it('docks the delete target without shrinking its hit area or changing DOM order', () => {
    const toolbar = sliceBetween('.motif-cs-msa-toolbar {', '.motif-cs-msa-copy-status {');
    const narrow = sliceBetween(
      '@container motif-cs-msa-toolbar (max-width: 820px)',
      '\n.motif-cs-msa-alignment-picker {',
    );

    expect(toolbar).toContain('padding: 5px 38px 6px 4px;');
    expect(narrow).toMatch(/\.motif-cs-msa-delete\s*\{[\s\S]*?position:\s*absolute;/);
    expect(narrow).toMatch(/\.motif-cs-msa-delete\s*\{[\s\S]*?width:\s*28px;[\s\S]*?min-height:\s*28px;/);
    expect(narrow).not.toMatch(/\border\s*:/);
  });

  it('keeps provenance and stats in one token-safe strip only where their bases fit', () => {
    const meta = sliceBetween('.motif-cs-msa-meta-row {', '.motif-cs-msa-meta-row > .motif-cs-msa-stats {');
    const compact = sliceBetween(
      '@container motif-cs-msa-meta (min-width: 740px) and (max-width: 820px)',
      '.motif-cs-msa-view-controls {',
    );

    expect(meta).toContain('container-name: motif-cs-msa-meta;');
    expect(meta).toContain('container-type: inline-size;');
    expect(compact).toMatch(/\.motif-cs-msa-stats\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
    expect(compact).toContain('min-height: 30px;');
    expect(compact).toContain('font-size: 11px;');
    expect(compact).toContain('white-space: nowrap;');
    expect(compact).not.toMatch(/(?:#(?:[\da-f]{3}){1,2}|rgba?\()/i);
  });
});

describe('Claude Science MSA overflow affordance guards', () => {
  it('keeps the derived matrix floors and adds a non-interactive short-viewport fade', () => {
    const frame = sliceBetween('.motif-cs-msa-matrix-frame {', '.motif-cs-msa-overview-row {');
    const fade = sliceBetween('@media (max-height: 820px)', '.motif-cs-msa-matrix-scroll:focus-visible {');

    expect(frame).toContain('min-height: 0;');
    expect(fade).toMatch(/\.motif-cs-msa-workspace\s*\{[\s\S]*?gap:\s*4px;/);
    expect(fade).toContain('.motif-cs-msa-matrix-frame::after');
    expect(fade).toContain('pointer-events: none;');
    expect(fade).toContain('var(--border-strong)');
    expect(fade).toContain('var(--bg-primary)');
  });

  it('uses local covers over scroll-attached horizontal shadows so cues appear only with overflow', () => {
    const scroller = sliceBetween('.motif-cs-msa-matrix-scroll {', '.motif-cs-msa-matrix-scroll:focus-visible {');

    expect(scroller.match(/no-repeat local/g)).toHaveLength(2);
    expect(scroller.match(/no-repeat scroll/g)).toHaveLength(2);
    expect(scroller).toContain('var(--border-strong)');
    expect(scroller).toContain('var(--bg-primary)');
    expect(scroller).not.toMatch(/(?:#(?:[\da-f]{3}){1,2}|rgba?\()/i);
  });
});

describe('Claude Science MSA pinned track labels', () => {
  /** The rule block that gives the gutter's track labels their heading case. */
  function trackLabelRule(): { selectors: string[]; body: string } {
    const match = overlayCss
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .match(/([^{}]*\.motif-cs-msa-hist-label[^{}]*)\{([^{}]*)\}/);
    expect(match, 'no rule styles the track labels').not.toBeNull();
    return { selectors: match![1].split(',').map((one) => one.trim()), body: match![2] };
  }

  it('gives every row in the pinned group the same label treatment', () => {
    // Read the group's rows off the markup: a new track must not slip in with
    // sentence-case labels beside four uppercase ones.
    const group = viewer.slice(
      viewer.indexOf('data-testid="msa-pinned-tracks"'),
      viewer.indexOf('data-testid="msa-logo-row"'),
    );
    const rowClasses = [...new Set(
      [...group.matchAll(/className="motif-cs-msa-(conservation|consensus|hist)-row"/g)].map((one) => one[1]),
    )].sort();
    expect(rowClasses).toEqual(['consensus', 'conservation', 'hist']);

    const rule = trackLabelRule();
    expect(rule.body).toContain('text-transform: uppercase');
    for (const rowClass of rowClasses) {
      const covered = rowClass === 'hist'
        ? rule.selectors.includes('.motif-cs-msa-hist-label')
        : rule.selectors.includes(`.motif-cs-msa-${rowClass}-row > .motif-cs-msa-row-label`);
      expect(covered, `the ${rowClass} track label keeps its own case`).toBe(true);
    }
  });

  it('leaves the labels on the gutter\'s left edge', () => {
    // Every label in the list also carries .motif-cs-msa-row-label, whose
    // `align-items: stretch` loads later and wins. Restating align-items here
    // does nothing for the hist labels and pushes the other two to the middle
    // of a 196px gutter the moment the selector outranks that rule.
    expect(trackLabelRule().body).not.toMatch(/align-items\s*:/);
  });
});

describe('Claude Science MSA matrix panel height', () => {
  /**
   * Every rule in either sheet whose selector's last compound is the matrix shell
   * itself. Both copies matter: the stage-scoped one wins today, and a bare
   * `flex-grow: 1` left behind would reinstate the old height the moment the stage
   * class moves or is renamed.
   */
  function shellRules(): { sheet: string; selector: string; body: string }[] {
    const out: { sheet: string; selector: string; body: string }[] = [];
    for (const [sheet, css] of [['claude-science-msa.css', overlayCss], ['motif-artifact.css', artifactCss]] as const) {
      for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const selector = match[1].trim();
        const targetsShell = selector
          .split(',')
          .some((one) => one.trim().endsWith('.motif-cs-msa-matrix-shell'));
        if (targetsShell) out.push({ sheet, selector, body: match[2] });
      }
    }
    return out;
  }

  it('finds the rules it is about to judge', () => {
    // Guard against the false pass: a renamed class would empty the set and every
    // assertion below would hold for the wrong reason.
    const rules = shellRules();
    expect(rules.length, 'no rule targets .motif-cs-msa-matrix-shell').toBeGreaterThanOrEqual(2);
    expect(
      rules.filter((rule) => /flex\s*:/.test(rule.body)).length,
      'no shell rule declares flex at all',
    ).toBeGreaterThanOrEqual(2);
  });

  it('stops the panel claiming height its alignment does not fill', () => {
    // A read against a template is two rows: 167px of rows and tracks. Growing into
    // the window left 403px of bordered white below them at 1920x1080, and put the
    // pan slider — this surface's only horizontal scrollbar — that far from the
    // residues it moves. Tall alignments are untouched: flex-grow spends free space
    // only, so at 40 rows every measured height is identical either way.
    for (const rule of shellRules()) {
      expect(
        rule.body,
        `${rule.sheet} ${rule.selector} grows the panel past its content`,
      ).not.toMatch(/flex\s*:\s*1\b/);
      expect(
        rule.body,
        `${rule.sheet} ${rule.selector} grows the panel past its content`,
      ).not.toMatch(/flex-grow\s*:\s*[1-9]/);
    }
  });

  it('leaves the panel able to shrink, so a tall alignment still scrolls inside it', () => {
    // flex-shrink 0 here would make the shell demand its whole matrix height and
    // hand the window body the scrolling the matrix is supposed to own.
    for (const rule of shellRules()) {
      expect(rule.body, `${rule.sheet} ${rule.selector} pins flex-shrink to 0`)
        .not.toMatch(/flex\s*:\s*\d+\s+0\b/);
      expect(rule.body, `${rule.sheet} ${rule.selector} pins flex-shrink to 0`)
        .not.toMatch(/flex-shrink\s*:\s*0/);
    }
  });

  it('keeps the stage growing, so the difference inventory still opens across the free height', () => {
    const stage = overlayCss.slice(
      overlayCss.indexOf('.motif-cs-msa-differences-stage {'),
      overlayCss.indexOf('.motif-cs-msa-differences-stage > .motif-cs-msa-matrix-shell'),
    );
    expect(stage, 'the stage rule moved').toContain('flex: 1 1 auto;');
  });
});
