/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceWorkflowHistoryPanel } from '../ClaudeScienceWorkflowHistoryPanel';
import type { ArtifactWorkflowResult } from '../claude-science-workspace-collections';

const result: ArtifactWorkflowResult = {
  id: 'digest-1',
  kind: 'digest',
  name: '<Digest result>',
  inputRecordIds: ['source'],
  inputSha256s: ['a'.repeat(64)],
  parameters: { enzymes: ['EcoRI'] },
  outputRecordIds: ['fragment'],
  createdAt: '2026-07-12T20:00:00.000Z',
  provenance: { source: 'motif-artifact', engine: 'restriction-digest', engineVersion: '1' },
};

afterEach(cleanup);

describe('ClaudeScienceWorkflowHistoryPanel', () => {
  it('shows an actionable empty state', () => {
    render(<ClaudeScienceWorkflowHistoryPanel results={[]} recordNames={{}} onRevealRecord={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('No saved results')).toBeTruthy();
    expect(screen.getByText(/Save a digest, gel, Golden Gate/)).toBeTruthy();
  });

  it('renders provenance as inert text and reveals a surviving output record', async () => {
    const user = userEvent.setup();
    const onRevealRecord = vi.fn();
    const view = render(
      <ClaudeScienceWorkflowHistoryPanel
        results={[result]}
        recordNames={{ source: 'Source', fragment: 'Fragment 1' }}
        onRevealRecord={onRevealRecord}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('<Digest result>')).toBeTruthy();
    expect(view.container.querySelector('digest')).toBeNull();
    expect(screen.getAllByText('Source')).toHaveLength(2);
    expect(screen.getAllByText('Fragment 1')).toHaveLength(2);
    expect(screen.getAllByText(/restriction-digest 1/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Reveal output' }));
    expect(onRevealRecord).toHaveBeenCalledWith('fragment');
    await user.click(screen.getByRole('button', { name: 'Reveal input' }));
    expect(onRevealRecord).toHaveBeenLastCalledWith('source');
  });

  it('surfaces unverified lineage in both the row and workflow details', async () => {
    const user = userEvent.setup();
    render(
      <ClaudeScienceWorkflowHistoryPanel
        results={[result]}
        recordNames={{ source: 'Source', fragment: 'Fragment 1' }}
        freshnessByResultId={new Map([[
          result.id,
          { state: 'unverified', reasons: [{ code: 'missing_input_hash', recordId: 'source' }] },
        ]])}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getAllByText('Unverified')).toHaveLength(2);
    await user.click(screen.getByText('Details'));
    expect(screen.getByText(/Source was saved without a sequence fingerprint/)).toBeTruthy();
  });

  it('summarizes large record sets and exposes bounded, inert workflow details', async () => {
    const user = userEvent.setup();
    const outputRecordIds = Array.from({ length: 18 }, (_, index) => `output-${index + 1}`);
    const recordNames = Object.fromEntries(outputRecordIds.map((id, index) => [id, `Fragment ${index + 1}`]));
    const largeResult: ArtifactWorkflowResult = {
      ...result,
      id: 'digest-large',
      name: '<img src=x onerror=alert(1)>',
      outputRecordIds,
      parameters: {
        enzymes: Array.from({ length: 50 }, (_, index) => `Enzyme-${index + 1}`),
        unsafe: '<script>alert(1)</script>',
      },
      result: {
        fragments: Array.from({ length: 50 }, (_, index) => ({ index, sequence: 'A'.repeat(700) })),
      },
      provenance: {
        source: '<external-engine>',
        operation: 'digest',
        engine: 'test-engine',
        engineVersion: '9',
        parentIds: ['source'],
      },
    };
    const view = render(
      <ClaudeScienceWorkflowHistoryPanel
        results={[largeResult]}
        recordNames={{ source: 'Source', ...recordNames }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByText('Fragment 1, Fragment 2, Fragment 3 + 15 more')).toBeTruthy();
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();
    await user.click(screen.getByText('Details'));
    expect(screen.getByText(/Source: <external-engine>/)).toBeTruthy();
    expect(screen.getByTitle('a'.repeat(64)).textContent).toBe('aaaaaaaaaaaa…');
    expect(screen.getByText(/Parameter preview limited for responsiveness/)).toBeTruthy();
    expect(screen.getByText(/Result preview limited for responsiveness/)).toBeTruthy();
    expect(screen.getByLabelText('Workflow parameters').textContent).toContain('<script>alert(1)</script>');
  });

  it('progressively renders long workflow histories in batches of 50', async () => {
    const user = userEvent.setup();
    const results = Array.from({ length: 125 }, (_, index): ArtifactWorkflowResult => ({
      ...result,
      id: `digest-${String(index).padStart(3, '0')}`,
      name: `Digest ${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 6, 12, 20, 0, index)).toISOString(),
    }));
    render(
      <ClaudeScienceWorkflowHistoryPanel
        results={results}
        recordNames={{ source: 'Source', fragment: 'Fragment 1' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId(/^workflow-result-digest-/)).toHaveLength(50);
    expect(screen.getByText('Showing 50 of 125')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show 50 more' }));
    expect(screen.getAllByTestId(/^workflow-result-digest-/)).toHaveLength(100);
    await user.click(screen.getByRole('button', { name: 'Show 25 more' }));
    expect(screen.getAllByTestId(/^workflow-result-digest-/)).toHaveLength(125);
    expect(screen.queryByText(/^Showing /)).toBeNull();
  });

  it('uses a reversible, focus-safe two-step removal', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <ClaudeScienceWorkflowHistoryPanel
        results={[result]}
        recordNames={{ source: 'Source', fragment: 'Fragment 1' }}
        onRevealRecord={vi.fn()}
        onRemove={onRemove}
      />,
    );
    const row = screen.getByTestId('workflow-result-digest-1');
    const remove = within(row).getByRole('button', { name: 'Remove <Digest result>' });
    await user.click(remove);
    const cancel = within(row).getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    expect(within(row).getByText(/Derived records remain with embedded provenance/)).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(remove);
    expect(onRemove).not.toHaveBeenCalled();
    await user.click(remove);
    await user.click(within(row).getByRole('button', { name: 'Remove result' }));
    expect(onRemove).toHaveBeenCalledWith('digest-1');
    expect(screen.getByRole('status').textContent).toContain('Workflow result removed.');
  });

  it('reports when a linked result prevents removal', async () => {
    const user = userEvent.setup();
    render(
      <ClaudeScienceWorkflowHistoryPanel
        results={[result]}
        recordNames={{ source: 'Source', fragment: 'Fragment 1' }}
        onRevealRecord={vi.fn()}
        onRemove={() => false}
      />,
    );

    const row = screen.getByTestId('workflow-result-digest-1');
    await user.click(within(row).getByRole('button', { name: 'Remove <Digest result>' }));
    await user.click(within(row).getByRole('button', { name: 'Remove result' }));
    expect(screen.getByRole('status').textContent).toContain('Remove linked results first.');
  });
});
