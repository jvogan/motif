/**
 * The sequence edit toolbar wraps in a narrow pane instead of scrolling a control away.
 *
 * A scrolling strip would hide 69px at 390x844 and cut "Complement" off, and 106px at
 * 1024x768. The toolbar wraps at every width with no breakpoint to maintain:
 * the edit controls and the display switches are two groups, and a pane too narrow for
 * both puts the second on its own row.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

function rule(selector: string): string {
  const at = css.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`));
  expect(at, `missing CSS rule ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

describe('the sequence edit toolbar in a narrow pane', () => {
  it('wraps its groups and never scrolls', () => {
    const toolbar = rule('.motif-cs-edit-toolbar');
    expect(toolbar).toMatch(/flex-wrap:\s*wrap/);
    expect(toolbar).not.toMatch(/overflow/);
  });

  it('wraps inside each group too, so one group can never exceed the pane', () => {
    expect(rule('.motif-cs-edit-controls,\n.motif-cs-display-toggles')).toMatch(/flex-wrap:\s*wrap/);
  });

  it('has no container breakpoint of its own', () => {
    expect(css).not.toMatch(/@container \([^)]*\) \{\s*\.motif-cs-sequence-chrome/);
    expect(css).not.toMatch(/@container \([^)]*\) \{\s*\.motif-cs-edit-toolbar/);
  });
});
