// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ImportSequencePanel } from '../motif-artifact';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanelProps = Parameters<typeof ImportSequencePanel>[0];

const FULL_LIST = 'Imported 1 record · skipped empty.fa: the file is empty · skipped notes.txt: no sequence found'
  + ' · skipped fake.dna: not supported · skipped x.embl: not supported · skipped corrupt.gb: no ORIGIN sequence';

let root: Root | null = null;

function renderPanel(droppedOutcome: PanelProps['droppedOutcome']) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const props: PanelProps = {
    defaults: { name: '', group: '', type: 'auto', topology: 'linear' },
    open: true,
    droppedOutcome,
    confirmedRestoreCount: 0,
    onDefaultsChange: () => {},
    onOpenChange: () => {},
    onAddRecords: () => 0,
    onImportFiles: async () => ({ records: [], message: '', tone: 'status' }),
    onRestoreDatabase: () => 0,
  };
  act(() => root!.render(<ImportSequencePanel {...props} />));
  return {
    status: () => container.querySelector('#motif-cs-import-status'),
    rerender: (next: PanelProps['droppedOutcome']) => act(() => root!.render(<ImportSequencePanel {...props} droppedOutcome={next} />)),
  };
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe('Add entry status after a file drop', () => {
  it('names every skipped file from a dropped batch, as it does for a pick', () => {
    const panel = renderPanel({ id: 1, text: FULL_LIST, error: true });
    const status = panel.status();
    expect(status?.textContent).toBe(FULL_LIST);
    for (const name of ['empty.fa', 'notes.txt', 'fake.dna', 'x.embl', 'corrupt.gb']) {
      expect(status?.textContent).toContain(name);
    }
    expect(status?.getAttribute('data-error')).toBe('true');
    // The notice announced the drop; the lasting copy is not a second live region.
    expect(status?.getAttribute('aria-live')).toBe('off');
  });

  it('shows the latest drop when a second batch arrives', () => {
    const panel = renderPanel({ id: 1, text: FULL_LIST, error: true });
    panel.rerender({ id: 2, text: 'Imported 2 records', error: false });
    expect(panel.status()?.textContent).toBe('Imported 2 records');
    expect(panel.status()?.getAttribute('data-error')).toBeNull();
  });
});
