import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'claude-science-agent-results.css'), 'utf8');

describe('Claude Science agent results style guards', () => {
  it('uses the artifact semantic color tokens for complete and failed states', () => {
    expect(css).toContain('var(--green)');
    expect(css).toContain('var(--red)');
    expect(css).not.toContain('var(--success)');
    expect(css).not.toContain('var(--danger)');
  });

  it('lets the bounded result list contribute its intrinsic height immediately', () => {
    const listRule = css.slice(
      css.indexOf('.motif-cs-agent-result-list {'),
      css.indexOf('.motif-cs-agent-result-row {'),
    );
    expect(listRule).toContain('min-width: 0');
    expect(listRule).not.toContain('content-visibility');
  });
});
