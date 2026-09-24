/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer } from '../ClaudeScienceMsaViewer';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

const records = [
  { id: 'long', name: 'Long plasmid', type: 'dna' as const, sequence: 'ACGT'.repeat(1_000) },
  { id: 'short-a', name: 'Short A', type: 'dna' as const, sequence: 'ACGTACGTAC'.repeat(18) },
  { id: 'short-b', name: 'Short B', type: 'dna' as const, sequence: 'ACGTACGTAG'.repeat(18) },
];

function Harness() {
  const [viewPreferences, setViewPreferences] = useState(DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES);
  return (
    <ClaudeScienceMsaViewer
      records={records}
      alignments={[]}
      activeRecordId="short-a"
      activeAlignmentId={null}
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

describe('ClaudeScienceMsaViewer alignment setup limits', () => {
  it('says a disabled record is over the browser length limit and states the work against the limit', () => {
    render(<Harness />);
    const list = screen.getByTestId('msa-record-list');
    const long = within(list).getByText('Long plasmid').closest('label');
    expect(long?.getAttribute('data-disabled')).toBe('true');
    expect(long?.querySelector('em')?.textContent).toBe('over the 3,000 bp browser limit');
    expect(long?.getAttribute('title')).toContain('up to 3,000 bp');

    const shortB = within(list).getByText('Short B').closest('label');
    const checkbox = shortB?.querySelector('input') as HTMLInputElement;
    if (!checkbox.checked) fireEvent.click(checkbox);
    const runRow = document.querySelector('.motif-cs-msa-run-row .motif-cs-muted');
    expect(runRow?.textContent).toBe("Within the browser's size limit (about 1% of it)");
    expect(document.body.textContent).not.toMatch(/comparison cells/);
  });
});
