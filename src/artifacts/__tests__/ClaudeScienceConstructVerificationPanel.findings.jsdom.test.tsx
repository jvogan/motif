/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ClaudeScienceConstructVerificationPanel } from '../ClaudeScienceConstructVerificationPanel';
import { verifyArtifactConstruct, type ArtifactConstructReadInput } from '../claude-science-construct-verification';
import { sha256HexSync } from '../claude-science-sha256';

function deterministicDna(length: number, seed: number): string {
  const bases = ['A', 'C', 'G', 'T'] as const;
  let state = seed >>> 0;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    sequence += bases[(state >>> 28) & 3];
  }
  return sequence;
}

function read(id: string, baseCalls: string): ArtifactConstructReadInput {
  return { id, name: id, baseCalls, qualityScores: new Array(baseCalls.length).fill(40), sha256: sha256HexSync(baseCalls) };
}

function substituteAt(sequence: string, positions: readonly number[]): string {
  const chars = Array.from(sequence);
  for (const position of positions) chars[position] = chars[position] === 'A' ? 'G' : 'A';
  return chars.join('');
}

function verify(reference: string, reads: ArtifactConstructReadInput[]) {
  return verifyArtifactConstruct({
    reference: { id: 'ref', name: 'Predicted', sequence: reference, topology: 'linear', sha256: sha256HexSync(reference) },
    reads,
    requiredRegions: [{ id: 'full-reference', name: 'Full predicted construct', start: 0, end: reference.length, minDepth: 1, requireBothStrands: false }],
    expectedVariants: [],
    thresholds: { minCoverageFraction: 1, minDepth: 1, requireBothStrands: false },
  });
}

afterEach(cleanup);

describe('ClaudeScienceConstructVerificationPanel findings and numbering', () => {
  it('leads with the deciding finding and counts conflicts and low-confidence variants in the facts row', () => {
    const reference = deterministicDna(240, 0xabc);
    const positions = [17, 36, 54, 81, 103, 119, 149];
    const result = verify(reference, [read('clone-a.ab1', substituteAt(reference, positions)), read('clone-b.ab1', reference)]);
    expect(result.state).toBe('inconsistent');
    render(<ClaudeScienceConstructVerificationPanel result={result} />);

    const facts = screen.getByLabelText('Verification summary facts');
    const fact = (label: string) => within(facts).getByText(label).nextElementSibling?.textContent;
    expect(fact('Unexpected')).toBe('0');
    expect(fact('Conflicts')).toBe('7');
    expect(fact('Low confidence')).toBe('7');

    const firstFinding = document.querySelector('.motif-cs-construct-verification-reason');
    expect(firstFinding?.getAttribute('data-code')).toBe('conflicting_consensus');
    expect(firstFinding?.getAttribute('data-severity')).toBe('inconsistent');
    expect(firstFinding?.textContent).toContain('Reads disagree at 7 reference positions');
    // Seven low-confidence reasons read as one line, and no internal id is shown.
    expect(screen.getAllByText(/low-confidence substitutions/)).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/observed:substitution:/);
    expect(screen.queryByText(/more finding/)).toBeNull();
  });

  it('numbers the variant table and read ranges from 1', async () => {
    const user = userEvent.setup();
    const reference = deterministicDna(240, 0xdef);
    const result = verify(reference, [read('f.ab1', substituteAt(reference, [17]))]);
    render(<ClaudeScienceConstructVerificationPanel result={result} />);

    const table = screen.getByTestId('construct-verification-variant-table');
    expect(within(table).getByRole('columnheader', { name: 'Position' })).toBeTruthy();
    expect(within(table).queryByText(/0-based/)).toBeNull();
    const row = within(table).getAllByRole('row')[1];
    // 0-based 17 in the engine is the 18th base on screen.
    expect(within(row).getAllByRole('cell')[0]?.textContent).toBe('18');

    await user.click(screen.getByText('Inspect mapped reads and quality'));
    expect(screen.getByText(/ref 1–240/)).toBeTruthy();
    expect(screen.queryByText(/end exclusive/)).toBeNull();
  });
});
