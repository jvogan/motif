/**
 * The sequence edit toolbar wraps in a narrow pane instead of scrolling a control away.
 *
 * Measured before: at 390x844 the toolbar hid 69px and cut "Complement" off, and at
 * 1024x768 it hid 106px. A 387px pane (1280x720) scrolled only its end padding, and
 * wider panes fit, so those keep their one line.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

/** The body of every `@container (max-width: Npx) { … }` block, by N. */
function containerBlocks(source: string): Array<{ maxWidth: number; body: string }> {
  const blocks: Array<{ maxWidth: number; body: string }> = [];
  const opener = /@container \(max-width: (\d+)px\) \{/g;
  for (let match = opener.exec(source); match; match = opener.exec(source)) {
    let depth = 1;
    let i = opener.lastIndex;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') depth -= 1;
    }
    blocks.push({ maxWidth: Number(match[1]), body: source.slice(opener.lastIndex, i - 1) });
  }
  return blocks;
}

const WRAP_RULE = /\.motif-cs-sequence-chrome > \.motif-cs-edit-toolbar \{[^}]*flex-wrap: wrap;/;

describe('the sequence edit toolbar in a narrow pane', () => {
  it('wraps its display switches below the edit controls up to a 383px pane', () => {
    const wrapping = containerBlocks(css).filter((block) => WRAP_RULE.test(block.body));
    expect(wrapping.map((block) => block.maxWidth)).toEqual([383]);
  });

  it('keeps one line in a wider pane', () => {
    const outside = containerBlocks(css).reduce((source, block) => source.replace(block.body, ''), css);
    expect(outside).not.toMatch(WRAP_RULE);
  });
});
