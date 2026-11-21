// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import './motif-workbench-jsdom-setup';

// The whole workbench, mounted the way the artifact mounts itself. A record
// switch is view state: what each record had selected comes back with it, and
// none of it reaches the workspace or the unsaved-changes guard.

const SEQUENCE_A = 'ATGGCTAGCAAAGGAGAAGAACTTTTCACTGGAGTTGTCCCAATTCTTGTTGAATTAGATG'.repeat(3);
const SEQUENCE_B = 'TTGACAGCTAGCTCAGTCCTAGGTATAATGCTAGCGAATTCGGATCCAAGCTTGCATGCC'.repeat(3);

beforeAll(async () => {
  await act(async () => { await import('../motif-artifact'); });
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

// `revision` changes record B, so a second call is a real replacement rather
// than a repeat delivery of the open workspace (which keeps the view as it is).
function openTwoRecords(revision = 0) {
  act(() => window.motifReplaceWorkspace!({
    records: [
      {
        id: 'link-a', name: 'Record A', seq: SEQUENCE_A, molecule: 'dna', topology: 'linear', proposeAnnotations: false,
        annotations: [{ id: 'a-cds', name: 'alpha', type: 'cds', start: 3, end: 90, strand: 1 }],
      },
      {
        id: 'link-b', name: 'Record B', seq: SEQUENCE_B + 'A'.repeat(revision), molecule: 'dna', topology: 'linear', proposeAnnotations: false,
        annotations: [{ id: 'b-cds', name: 'beta', type: 'cds', start: 6, end: 60, strand: 1 }],
      },
    ],
  }, { discardUnsavedChanges: true }));
}

const recordTab = (name: string) => document.querySelector<HTMLElement>(`.motif-cs-record-tab[aria-label="${name}"]`)!;
const activeRecordId = () => window.motifGetActiveRecord!()?.id;
const ribbon = (name: string) => document.querySelector<HTMLElement>(`.motif-cs-feature-block[aria-label^="${name},"]`);
const durability = () => screen.getByTestId('session-durability-status').textContent;
const durableWorkspace = () => {
  const { selectedRecordId: _selectedRecordId, exportedAt: _exportedAt, ...rest } = window.motifGetWorkspace!() as unknown as Record<string, unknown>;
  return JSON.stringify(rest);
};

async function switchTo(name: string, id: string) {
  act(() => { fireEvent.click(recordTab(name)); });
  await waitFor(() => expect(activeRecordId()).toBe(id));
}

describe('a record switch keeps each record\'s selection', () => {
  it('brings back a selected feature after visiting another record, without changing the workspace', async () => {
    openTwoRecords();
    await switchTo('Record A', 'link-a');
    await waitFor(() => expect(ribbon('alpha')).not.toBeNull());
    const statusBefore = durability();
    const workspaceBefore = durableWorkspace();

    act(() => { fireEvent.click(ribbon('alpha')!); });
    expect(ribbon('alpha')!.getAttribute('aria-pressed')).toBe('true');

    await switchTo('Record B', 'link-b');
    // The other record shows nothing selected: feature ids never carry across.
    await waitFor(() => expect(ribbon('beta')).not.toBeNull());
    expect(ribbon('beta')!.getAttribute('aria-pressed')).toBe('false');

    await switchTo('Record A', 'link-a');
    await waitFor(() => expect(ribbon('alpha')!.getAttribute('aria-pressed')).toBe('true'));

    // View state only: the unsaved-changes guard and the workspace are untouched.
    expect(durability()).toBe(statusBefore);
    expect(durability()).not.toBe('unsaved changes');
    expect(durableWorkspace()).toBe(workspaceBefore);
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
  });

  it('forgets every record\'s selection when the workspace is replaced', async () => {
    openTwoRecords();
    await switchTo('Record A', 'link-a');
    await waitFor(() => expect(ribbon('alpha')).not.toBeNull());
    act(() => { fireEvent.click(ribbon('alpha')!); });
    await switchTo('Record B', 'link-b');

    openTwoRecords(1);
    await switchTo('Record A', 'link-a');
    await waitFor(() => expect(ribbon('alpha')).not.toBeNull());
    expect(ribbon('alpha')!.getAttribute('aria-pressed')).toBe('false');
  });
});
