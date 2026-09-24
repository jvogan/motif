/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceConstructVerificationPanel } from '../ClaudeScienceConstructVerificationPanel';
import { verifyArtifactConstruct } from '../claude-science-construct-verification';
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

function verifyWithSubstitutions(positions: readonly number[]) {
  const reference = deterministicDna(240, 0xdef);
  const chars = Array.from(reference);
  for (const position of positions) chars[position] = chars[position] === 'A' ? 'G' : 'A';
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

describe('ClaudeScienceConstructVerificationPanel variant rows', () => {
  it('opens a variant from its Position button with the engine’s 0-based start', async () => {
    const user = userEvent.setup();
    const result = verifyWithSubstitutions([17, 36]);
    const onInspectVariant = vi.fn();
    render(<ClaudeScienceConstructVerificationPanel result={result} onInspectVariant={onInspectVariant} />);

    const table = screen.getByTestId('construct-verification-variant-table');
    const button = within(table).getByRole('button', { name: 'Show the traces at reference position 18' });
    expect(button.textContent).toBe('18');
    expect(button.closest('tr')?.hasAttribute('data-actionable')).toBe(true);
    await user.click(button);
    expect(onInspectVariant).toHaveBeenCalledTimes(1);
    expect(onInspectVariant.mock.calls[0][0]).toMatchObject({ type: 'substitution', referenceStart: 17 });

    // Keyboard: the button takes focus and Enter opens it.
    button.focus();
    await user.keyboard('{Enter}');
    expect(onInspectVariant).toHaveBeenCalledTimes(2);

    // The rest of the row opens it for a pointer, once per click.
    const second = within(table).getAllByRole('row')[2];
    await user.click(within(second).getAllByRole('cell')[1]);
    expect(onInspectVariant).toHaveBeenCalledTimes(3);
    expect(onInspectVariant.mock.calls[2][0]).toMatchObject({ referenceStart: 36 });
  });

  it('leaves a row plain where no read covers it, and every row plain without a handler', () => {
    const result = verifyWithSubstitutions([17, 36]);
    const { unmount } = render(
      <ClaudeScienceConstructVerificationPanel
        result={result}
        onInspectVariant={vi.fn()}
        canInspectVariant={(variant) => variant.referenceStart === 36}
      />,
    );
    let table = screen.getByTestId('construct-verification-variant-table');
    expect(within(table).getAllByRole('button').map((button) => button.textContent)).toEqual(['37']);
    expect(within(table).getAllByRole('row')[1].hasAttribute('data-actionable')).toBe(false);
    unmount();

    // A saved report shown in Results has no traces to open.
    render(<ClaudeScienceConstructVerificationPanel result={result} />);
    table = screen.getByTestId('construct-verification-variant-table');
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    expect(within(table).getAllByRole('row')[1].hasAttribute('data-actionable')).toBe(false);
  });

  it('names an insertion and a range for what they are', () => {
    const result = verifyWithSubstitutions([17]);
    const insertion = { id: 'ins', type: 'insertion' as const, referenceStart: 50, referenceEnd: 50, reference: '', alternate: 'T', depth: 1, support: 1, supportWeight: 1, fraction: 1, meanQuality: 40, confidence: 'high' as const, supportingReadIds: ['f.ab1'] };
    const deletion = { ...insertion, id: 'del', type: 'deletion' as const, referenceStart: 60, referenceEnd: 63, reference: 'ACG', alternate: '' };
    render(
      <ClaudeScienceConstructVerificationPanel
        result={{ ...result, variants: { ...result.variants, unexpected: [insertion, deletion] } }}
        onInspectVariant={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Show the traces at the insertion after reference position 50' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show the traces at reference positions 61–63' })).toBeTruthy();
  });
});
