import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const msaCss = readFileSync(resolve(here, '..', 'claude-science-msa.css'), 'utf8');

// The body of the rule whose selector list is exactly `selector`.
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at + selector.length);
  return css.slice(open + 1, css.indexOf('}', open));
}

const FLOOR = /var\(--control-h-sm\)/;

describe('hit targets are at least 28px', () => {
  it.each(['.motif-cs-pane-collapse', '.motif-cs-pane-placement-button'])('%s is a 28px square', (selector) => {
    const body = ruleBody(artifactCss, selector);
    expect(body).toMatch(new RegExp(`width:\\s*${FLOOR.source};`));
    expect(body).toMatch(new RegExp(`height:\\s*${FLOOR.source};`));
  });

  it('the map header collapse override never shrinks the button', () => {
    for (const [css, selector] of [
      [artifactCss, '.motif-cs-map-column > .motif-cs-pane-title .motif-cs-pane-collapse'],
      [msaCss, 'html .motif-cs-map-column > .motif-cs-pane-title .motif-cs-pane-collapse'],
    ] as const) {
      const body = ruleBody(css, selector);
      expect(body).toMatch(new RegExp(`width:\\s*${FLOOR.source};`));
      expect(body).toMatch(new RegExp(`height:\\s*${FLOOR.source};`));
    }
  });

  it('the map "+N features" and "+N sites" buttons and the rename title are 28px tall', () => {
    expect(ruleBody(artifactCss, '.motif-cs-map-overflow-button')).toMatch(new RegExp(`min-height:\\s*${FLOOR.source};`));
    expect(ruleBody(artifactCss, '.motif-cs-title-edit-trigger')).toMatch(new RegExp(`min-height:\\s*${FLOOR.source};`));
  });

  it('the Alignment name, filter and import fields sit under their labels, inside the card', () => {
    // The shared .motif-cs-input carries 8px 12px margins for stacked form panels; with width: 100%
    // those margins would push the field right of its label and past the card, so these fields use none.
    const body = ruleBody(artifactCss, '.motif-cs-msa-source-fields .motif-cs-input');
    expect(body).toMatch(/width:\s*100%;/);
    expect(body).toMatch(/margin:\s*0;/);
  });
});
