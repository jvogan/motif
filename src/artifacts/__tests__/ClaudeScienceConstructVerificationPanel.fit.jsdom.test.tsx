/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceConstructVerificationPanel } from '../ClaudeScienceConstructVerificationPanel';
import { verifyArtifactConstruct } from '../claude-science-construct-verification';
import { sha256HexSync } from '../claude-science-sha256';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '..', 'claude-science-construct-verification.css'), 'utf8');

/** The body of the narrow-panel container query: a Results row is about 300px wide. */
function narrowBlock(): string {
  const start = css.indexOf('@container motif-cs-verification (max-width: 560px) {');
  expect(start).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(start, index + 1);
  }
  throw new Error('unbalanced container query');
}

function verified() {
  const reference = 'TCCGGGTCCACTCAATAGGGCCTATGGTGTTAAATATGTGTCTCTTGTTCGCTAGGGTGATAGCAAAAAATATAGTGCCTGCTTTTGTGGATGTAAATAATAACTCGCCCCCCTCCCTCACGAGAGCGCTACGCAAACGTATTTGCCGCCCGCCCTTGGTCAGACATTAGCAGTCGTTTGCTAGATATCCCCTGAAGACTAATGCCCACATTGCGCGCCGATACCCCAGCGTAGGACGAA';
  const chars = Array.from(reference);
  chars[60] = chars[60] === 'A' ? 'G' : 'A';
  const baseCalls = chars.join('');
  return verifyArtifactConstruct({
    reference: { id: 'ref', name: 'Predicted', sequence: reference, topology: 'linear', sha256: sha256HexSync(reference) },
    reads: [{ id: 'f.ab1', name: 'f.ab1', baseCalls, qualityScores: new Array(baseCalls.length).fill(40), sha256: sha256HexSync(baseCalls) }],
    requiredRegions: [{ id: 'full-reference', name: 'Full predicted construct', start: 0, end: reference.length, minDepth: 1, requireBothStrands: false }],
    expectedVariants: [],
    thresholds: { minCoverageFraction: 1, minDepth: 1, requireBothStrands: false },
  });
}

afterEach(cleanup);

describe('the variant table in a narrow panel', () => {
  it('drops the 620px floor and stacks each variant on two lines there only', () => {
    const block = narrowBlock();
    // Wide panels keep the six-column table.
    expect(css.slice(0, css.indexOf('@container motif-cs-verification'))).toMatch(/\.motif-cs-construct-verification-table \{[^}]*min-width: 620px;/);
    expect(block).toMatch(/\.motif-cs-construct-verification-table \{\s*min-width: 0;\s*\}/);
    expect(block).toMatch(/\.motif-cs-construct-verification-variants tr \{[^}]*display: grid;/);
    // Position spans both lines; change, assessment on the first; type, support, quality under them.
    const placements = [1, 2, 3, 4, 5, 6].map((n) => {
      const match = new RegExp(`:is\\(th, td\\):nth-child\\(${n}\\) \\{([^}]*)\\}`).exec(block);
      return match?.[1].replace(/\s+/g, ' ').trim().replace(/ padding-top: 0;/, '');
    });
    expect(placements).toEqual([
      'grid-column: 1; grid-row: 1 / span 2;',
      'grid-column: 2; grid-row: 1;',
      'grid-column: 2; grid-row: 2;',
      'grid-column: 3 / span 2; grid-row: 1;',
      'grid-column: 3; grid-row: 2;',
      'grid-column: 4; grid-row: 2;',
    ]);
  });

  it('keeps table roles and the column order the placements rely on', () => {
    render(<ClaudeScienceConstructVerificationPanel result={verified()} onInspectVariant={vi.fn()} />);
    const scroll = screen.getByTestId('construct-verification-variant-table');
    const table = scroll.querySelector('table')!;
    expect(table.classList.contains('motif-cs-construct-verification-variants')).toBe(true);
    expect(table.getAttribute('role')).toBe('table');
    expect([...table.querySelectorAll('thead, tbody')].map((group) => group.getAttribute('role'))).toEqual(['rowgroup', 'rowgroup']);
    expect(within(table).getAllByRole('columnheader').map((th) => [th.getAttribute('role'), th.textContent])).toEqual(
      ['Position', 'Change', 'Type', 'Assessment', 'Support', 'Quality'].map((name) => ['columnheader', name]),
    );
    const rows = [...table.querySelectorAll('tr')];
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows.slice(1)) {
      expect(row.getAttribute('role')).toBe('row');
      expect([...row.children].map((cell) => cell.getAttribute('role'))).toEqual(Array(6).fill('cell'));
    }
    expect(within(table).getByRole('button', { name: 'Show the traces at reference position 61' }).textContent).toBe('61');
  });
});
