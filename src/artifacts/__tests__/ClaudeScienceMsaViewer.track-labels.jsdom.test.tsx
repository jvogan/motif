/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer } from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

const alignment = normalizeArtifactAlignment({
  id: 'track-labels',
  name: 'Track labels',
  molecule: 'dna',
  referenceRowId: 'reference',
  rows: [
    { id: 'reference', name: 'ref', aligned: 'ACGTACGTAC' },
    { id: 'observed', name: 'variant', aligned: 'ACGTTCGTAC' },
  ],
});

function Harness() {
  const [viewPreferences, setViewPreferences] = useState(DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES);
  return (
    <ClaudeScienceMsaViewer
      records={[]}
      alignments={[alignment]}
      activeAlignmentId={alignment.id}
      viewPreferences={viewPreferences}
      onActiveAlignmentChange={vi.fn()}
      onViewPreferencesChange={setViewPreferences}
      onSaveAlignment={(next) => next}
      onUpdateAlignmentTemplate={vi.fn()}
      onDeleteAlignment={vi.fn()}
      onImportRecords={async () => ({ records: [], message: '', tone: 'status' })}
      onCopy={async () => true}
      onDownload={vi.fn()}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer summary track labels', () => {
  it('names each conservation and consensus track as the View menu toggle that hides it', () => {
    render(<Harness />);
    const menu = screen.getByTestId('msa-view-menu');
    const trackRows: Array<[string, string]> = [
      ['.motif-cs-msa-conservation-row', 'Conservation marks'],
      ['.motif-cs-msa-consensus-row', 'Consensus'],
      ['.motif-cs-msa-hist-row[aria-label="Per-column conservation histogram"]', 'Conservation histogram'],
    ];
    for (const [selector, name] of trackRows) {
      const row = document.querySelector<HTMLElement>(selector);
      expect(row).toBeTruthy();
      expect(within(row!).getByRole('rowheader').textContent).toBe(name);
      expect(within(menu).getByRole('checkbox', { name })).toBeTruthy();
    }
    // The old row word appears nowhere as a track label.
    const labels = Array.from(document.querySelectorAll('[role="rowheader"]'), (element) => element.textContent);
    expect(labels).not.toContain('Conserved');
    expect(labels).not.toContain('Conservation');
  });
});
