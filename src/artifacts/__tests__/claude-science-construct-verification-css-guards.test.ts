import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'claude-science-construct-verification.css'), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('construct verification style guards', () => {
  it('paints the coverage bar in neutral ink, never the accent or the failure red', () => {
    // A Consistent run draws a full bar, so it must not take --red, which reads as
    // Inconsistent, or the accent, which can sit close to it.
    for (const selector of [
      '.motif-cs-construct-verification-coverage progress',
      '.motif-cs-construct-verification-coverage progress::-webkit-progress-value',
      '.motif-cs-construct-verification-coverage progress::-moz-progress-bar',
    ]) {
      const body = rule(selector);
      expect(body).not.toContain('var(--accent)');
      expect(body).not.toContain('var(--red)');
    }
    expect(rule('.motif-cs-construct-verification-coverage progress::-webkit-progress-value')).toContain('background: var(--text-secondary)');
  });

  it('keeps the covered bases and the percentage on one line', () => {
    // In the 279px Results card "1,300 bp · 86.7%" broke after the "·".
    expect(rule('.motif-cs-construct-verification-coverage-label strong')).toContain('white-space: nowrap');
  });
});
