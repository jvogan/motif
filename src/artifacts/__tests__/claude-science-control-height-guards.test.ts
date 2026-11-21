import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// One control height: every button, field, select and segmented option is 28px
// (--control-h-sm). Soft buttons at 30 and 32, fields at 32, segmented options at
// 31 and selects at 30 and 32 would sit beside 28px neighbours. Each rule below
// sets one of those to 28px.
const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const primerCss = readFileSync(resolve(here, '..', 'claude-science-primer-workspace.css'), 'utf8');
const resultsCss = readFileSync(resolve(here, '..', 'claude-science-agent-results.css'), 'utf8');

function rule(css: string, selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} not found`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('one control height', () => {
  it('makes fields and selects 28px, as the Translation panel and the Import popover show them', () => {
    expect(artifactCss).toContain('--control-h-sm: 28px;');
    expect(rule(artifactCss, '.motif-cs-field')).toMatch(/\n {2}height: var\(--control-h-sm\);/);
    expect(rule(artifactCss, '.motif-cs-input')).toMatch(/\n {2}height: var\(--control-h-sm\);/);
    // The guide RNA panel keeps its select at the taller control height.
    expect(rule(artifactCss, '.motif-cs-guide-controls .motif-cs-field')).toContain('height: var(--control-h);');
  });

  it('makes the Export popover\'s Copy, Download and Print report 28px', () => {
    expect(rule(artifactCss, '.motif-cs-export-picker-actions .motif-cs-mini-button')).toMatch(/\n {2}min-height: var\(--control-h-sm\);/);
  });

  it('makes the Tools panels\' launch buttons, source options and results filter 28px', () => {
    // Open design workspace, Open Digest, Open primer workspace and the other launchers,
    // Open alignment and the restriction sources all take the small control height.
    expect(rule(artifactCss, '.motif-cs-cloning-launcher > .motif-cs-mini-button')).toMatch(/\n {2}min-height: var\(--control-h-sm\);/);
    expect(rule(artifactCss, '.motif-cs-alignment-launch')).toMatch(/\n {2}min-height: var\(--control-h-sm\);/);
    expect(rule(artifactCss, '.motif-cs-restriction-check')).toMatch(/\n {2}min-height: var\(--control-h-sm\);/);
    expect(rule(resultsCss, '.motif-cs-agent-results-toolbar select')).toMatch(/\n {2}min-height: var\(--control-h-sm\);/);
  });

  it('makes the Primer design window\'s fields and Tm preset 28px', () => {
    const fields = rule(primerCss, '.motif-cs-primer-workspace input:not([type="checkbox"]):not([type="radio"]),\n.motif-cs-primer-workspace select');
    expect(fields).toMatch(/\n {2}min-height: var\(--control-h-sm\);/);
  });

  it('makes the Tools panels\' segmented groups 28px outside, with 28px options', () => {
    // Strand and Reading frame (Translation), Enzymes | Sites, Circular | Linear
    // and the Notes scope are 28px groups, not the 32px that 1px padding and a 1px
    // border round 28px options would make.
    const groups = '.motif-cs-entry-form .motif-cs-segmented,\n.motif-cs-notes-panel .motif-cs-segmented,\n.motif-cs-translation-body .motif-cs-segmented,\n.motif-cs-restriction-list .motif-cs-segmented';
    const group = rule(artifactCss, groups);
    expect(group).toMatch(/\n {2}padding: 0;/);
    expect(group).toMatch(/\n {2}border: 0;/);
    const edge = rule(artifactCss, groups.replace(/,\n/g, '::after,\n') + '::after');
    expect(edge).toContain('box-shadow: inset 0 0 0 1px var(--border-strong);');
    expect(edge).toContain('pointer-events: none;');
    expect(rule(artifactCss, '.motif-cs-segmented button')).toMatch(/\n {2}min-height: var\(--control-h-sm\);/);
  });
});
