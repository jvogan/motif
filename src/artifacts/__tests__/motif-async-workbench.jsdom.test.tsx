// @vitest-environment jsdom

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import './motif-workbench-jsdom-setup';
import { applyMotifToolResult, MOTIF_BRIDGE_MESSAGES } from '../../mcp-app/motif-workbench-bridge';
import * as fileImport from '../claude-science-file-import';
import type { ArtifactNote } from '../claude-science-workspace-collections';

// Intake decodes from the file's bytes, so hold both readers; holding only
// text() would let the byte read finish at once and the test pass vacuously.
function heldFile(name: string) {
  let finish!: (text: string) => void;
  const text = new Promise<string>((resolve) => { finish = resolve; });
  const file = new File([], name);
  Object.defineProperty(file, 'text', { value: () => text });
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => text.then((value) => new TextEncoder().encode(value).buffer),
  });
  return { file, finish };
}

const workbench = () => document.querySelector<HTMLElement>('[data-motif-artifact]')!;
const recordIds = () => window.motifGetInventory!().map((record) => record.id);
const choose = (input: Element, file: File) => fireEvent.change(input, { target: { files: [file] } });
const drop = (file: File) => fireEvent.drop(workbench(), { dataTransfer: { types: ['Files'], files: [file] } });
const importPicker = () => screen.getByLabelText('Choose sequence or workspace files');

function addRecord(id: string, seq = 'ACGTACGTACGT') {
  act(() => { window.motifAddRecords!({ id, name: id, seq, molecule: 'dna', proposeAnnotations: false }); });
}

beforeAll(async () => {
  await act(async () => { await import('../motif-artifact'); });
  expect(window.motifGetWorkspace).toBeTypeOf('function');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  const staleDialog = screen.queryByTestId('database-restore-dialog');
  if (staleDialog) fireEvent.click(within(staleDialog).getByRole('button', { name: 'Cancel' }));
});

describe('workbench file intake', () => {
  it('keeps a cleared workspace empty when a pending FASTA drop finishes', async () => {
    const pending = heldFile('late.fasta');
    drop(pending.file);
    act(() => window.motifClearWorkspace!());
    await act(async () => pending.finish('>late\nACGTACGTACGT'));
    expect(recordIds()).toEqual([]);
  });

  it.each(['Import records', 'Data & recovery'])('ignores a Workspace JSON read in %s after a replacement', async (source) => {
    act(() => window.motifClearWorkspace!());
    addRecord('replacement');
    const replacement = window.motifGetWorkspace!();
    act(() => window.motifClearWorkspace!());
    addRecord('old-workspace');
    const pending = heldFile('late.json');
    choose(source === 'Import records' ? importPicker() : screen.getByTestId('restore-workspace-file'), pending.file);
    act(() => { window.motifReplaceWorkspace!(replacement, { discardUnsavedChanges: true }); });
    await act(async () => pending.finish(JSON.stringify(replacement)));
    expect(recordIds()).toEqual(['replacement']);
    expect(screen.queryByTestId('database-restore-dialog')).toBeNull();
  });

  it.each(['picker', 'drop', 'trace picker'])('shows a visible error when the importer rejects from the %s', async (source) => {
    const importer = vi.spyOn(fileImport, 'stageArtifactFileImport').mockRejectedValueOnce(new Error('unexpected importer failure'));
    const file = new File([], source === 'trace picker' ? 'unreadable.ab1' : 'unreadable.fasta');
    if (source === 'picker' && !importPicker().closest('details')?.open) {
      fireEvent.click(document.querySelector<HTMLButtonElement>('.motif-cs-add-entry-button')!);
    }
    // A pick or a drop on the open Import records panel reports in its status line.
    const reportsInPanel = source === 'picker' || (source === 'drop' && Boolean(importPicker().closest('details')?.open));
    await act(async () => {
      if (source === 'picker') {
        choose(importPicker(), file);
      } else if (source === 'trace picker') {
        choose(screen.getByTestId('import-sanger-traces').previousElementSibling!, file);
      } else {
        drop(file);
      }
    });
    expect(importer).toHaveBeenCalledTimes(1);
    const selector = reportsInPanel ? '#motif-cs-import-status[data-error="true"]' : '.motif-cs-workbench-notice[role="alert"]';
    expect(document.querySelector(selector)?.textContent).toBe('Import failed. Choose the files again.');
  });
});

describe('workbench host receipts', () => {
  function stubUnconfirmedDownload() {
    const URLWithDownload = class extends URL {
      static createObjectURL = () => 'blob:motif-test';
      static revokeObjectURL = () => {};
    };
    vi.stubGlobal('URL', URLWithDownload);
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  }

  describe('a new workspace from the host over unsaved edits', () => {
    type HostWindow = Window & { motifHostDownload?: (filename: string, text: string, mimeType: string) => Promise<boolean> };
    const rootData = document.documentElement.dataset;
    const orfSequence = 'ATG' + 'GCC'.repeat(55) + 'TAAGAATTC';
    const deliver = (id: string, sequence = 'ACGTTGCA'.repeat(7) + 'ACGT', notes: ArtifactNote[] = []) => act(async () => applyMotifToolResult({
      content: [],
      structuredContent: {
        schema: 'motif.mcp.workbench.v1', mode: 'payload', recordCount: 1, residueCount: sequence.length,
        payload: { records: [{ id, name: id, sequence, molecule: 'dna', topology: 'linear' }], notes },
      },
    }));
    const bridgeNotice = () => document.getElementById('motif-mcp-notice')?.querySelector('span')?.textContent ?? null;
    const backupStatus = () => screen.queryByTestId('data-backup-status')?.textContent ?? null;
    const exportStatus = () => screen.getByTestId('session-durability-status').textContent;
    const closeWarns = () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    const openCleanRecord = async (id: string, sequence = orfSequence, notes?: ArtifactNote[]) => {
      act(() => window.motifReplaceWorkspace!({
        records: [{ id: 'baseline-fixture', seq: 'ACGT', molecule: 'dna', proposeAnnotations: false }],
      }, { discardUnsavedChanges: true }));
      await deliver(id, sequence, notes);
      expect(rootData.motifMcpState).toBe('ready');
    };
    const waitForProposals = (proposedCount: number) => waitFor(() => {
      expect(window.motifGetInventory!()[0].provenance?.motifAutoAnnotation).toMatchObject({ proposedCount });
    });
    const openTool = (tool: string) => {
      const panel = workbench().querySelector<HTMLDetailsElement>(`details[data-rail-tool="${tool}"]`)!;
      act(() => {
        panel.open = true;
        fireEvent(panel, new Event('toggle'));
      });
      return panel;
    };
    const typeBase = () => {
      const field = document.getElementById('motif-cs-sequence-view')!;
      act(() => field.focus());
      fireEvent.keyDown(field, { key: 'ArrowRight' });
      fireEvent.keyDown(field, { key: 'c' });
    };
    const renameRecord = () => {
      const panel = within(openTool('entry'));
      const name = panel.getByLabelText('Record name');
      fireEvent.change(name, { target: { value: 'Renamed record' } });
      fireEvent.keyDown(name, { key: 'Enter' });
    };
    const backUp = () => act(async () => { fireEvent.click(screen.getByTestId('download-workspace-backup')); });
    const hostSaves = (saved: boolean) => {
      const hostDownload = vi.fn(async () => saved);
      (window as HostWindow).motifHostDownload = hostDownload;
      return hostDownload;
    };

    afterEach(() => {
      delete rootData.motifMcpState;
      delete rootData.motifMcpMessage;
      delete rootData.motifMcpHydrated;
      document.getElementById('motif-mcp-notice')?.remove();
      delete (window as HostWindow).motifHostDownload;
    });

    it.each([
      { label: 'no proposals', sequence: 'ACGT'.repeat(15), proposals: 0 },
      { label: 'an ORF proposal', sequence: orfSequence, proposals: 1 },
      { label: 'a large record', sequence: orfSequence + 'C'.repeat(50_001), proposals: 1 },
    ])('stays clean after the automatic pass on $label', async ({ sequence, proposals }) => {
      await openCleanRecord('auto-annotated', sequence);
      await waitForProposals(proposals);
      if (sequence.length > 50_000) expect(screen.getByTestId('large-sequence-viewer')).toBeTruthy();
      else if (proposals > 0) {
        expect(workbench().querySelector('[data-rail-tool="restriction-sites"]')?.textContent).toContain('EcoRI');
        expect(workbench().querySelector('.motif-cs-seq-aa[data-aa-track-id]')).not.toBeNull();
      }
      expect.soft(backupStatus()).toBeNull();
      expect.soft(exportStatus()).toBe('session only');
      expect.soft(closeWarns()).toBe(false);
      await deliver('next-workspace');
      expect.soft(rootData.motifMcpState).toBe('ready');
      expect(recordIds()).toEqual(['next-workspace']);
    });

    it.each(['type a base', 'edit a feature', 'Accept feature', 'Dismiss proposal', 'rename a record', 'delete a record', 'change a note', 'redo an undone base', 'change the genetic code', 'import a second record'] as const)(
      'protects the workspace after the user chooses to %s',
      async (action) => {
        const id = 'user-edit';
        await openCleanRecord(id, orfSequence, action === 'change a note' ? [{
          id: 'review', title: 'Review', body: 'Check this region.', scope: 'workspace', format: 'plain',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        }] : undefined);
        await waitForProposals(1);
        expect(backupStatus()).toBeNull();
        if (action === 'type a base') {
          typeBase();
          expect(window.motifGetInventory!()[0].seq).toBe('C' + orfSequence.slice(1));
        } else if (action === 'redo an undone base') {
          typeBase();
          fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
          expect(window.motifGetInventory!()[0].seq).toBe(orfSequence);
          fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
          expect(window.motifGetInventory!()[0].seq).toBe('C' + orfSequence.slice(1));
        } else if (action === 'change the genetic code') {
          // The Translation row opens the Translation window, where the genetic code is chosen.
          act(() => { fireEvent.click(workbench().querySelector<HTMLElement>('details[data-rail-tool="translation"] > summary')!); });
          const select = document.querySelector<HTMLSelectElement>('[role="dialog"][aria-label="Translation"] select[name="translation-table"]')!;
          fireEvent.change(select, { target: { value: '11' } });
          expect(window.motifGetInventory!()[0].translationTableId).toBe(11);
        } else if (action === 'import a second record') {
          act(() => { window.motifAddRecords!({ id: 'second-record', name: 'second-record', seq: orfSequence, molecule: 'dna' }); });
          // The automatic pass then annotates the imported record too.
          await waitFor(() => expect(window.motifGetInventory!()[1].provenance?.motifAutoAnnotation).toMatchObject({ proposedCount: 1 }));
          expect(recordIds()).toEqual([id, 'second-record']);
        } else if (action === 'rename a record') {
          renameRecord();
          expect(window.motifGetInventory!()[0].name).toBe('Renamed record');
        } else if (action === 'delete a record') {
          const panel = within(openTool('entry'));
          fireEvent.click(panel.getByRole('button', { name: `Delete record ${id}` }));
          fireEvent.click(panel.getByRole('button', { name: `Confirm delete record ${id}` }));
          expect(recordIds()).toEqual([]);
        } else if (action === 'change a note') {
          openTool('notes');
          const note = within(screen.getByTestId('note-review'));
          fireEvent.click(note.getByRole('button', { name: 'Edit' }));
          fireEvent.change(note.getByLabelText('Note'), { target: { value: 'Region checked.' } });
          fireEvent.click(note.getByRole('button', { name: 'Save note' }));
          expect(window.motifGetNotes!()).toMatchObject([{ id: 'review', body: 'Region checked.' }]);
        } else {
          const panel = openTool('annotations');
          fireEvent.click(panel.querySelector<HTMLButtonElement>('.motif-cs-feature-annotation-list button')!);
          if (action === 'edit a feature') {
            fireEvent.change(within(panel).getByLabelText('Name'), { target: { value: 'Edited feature' } });
            fireEvent.click(within(panel).getByRole('button', { name: 'Save feature' }));
            expect(window.motifGetInventory!()[0].annotations?.[0].name).toBe('Edited feature');
          } else {
            fireEvent.click(within(screen.getByTestId('proposed-annotation-review')).getByRole('button', { name: action }));
            expect(window.motifGetInventory!()[0].provenance?.motifAutoAnnotation).toMatchObject({
              acceptedCount: action === 'Accept feature' ? 1 : 0,
              dismissedCount: action === 'Dismiss proposal' ? 1 : 0,
            });
          }
        }
        expect(backupStatus()).toBe('Unsaved changes');
        expect(exportStatus()).toBe('unsaved changes');
        expect(closeWarns()).toBe(true);
        await deliver('incoming');
        expect(bridgeNotice()).toBe(MOTIF_BRIDGE_MESSAGES.unsavedEditsWithoutDownloads);
      },
    );

    describe('with a find query', () => {
      const query = 'GCCGCCGCC';
      const findAndStep = () => {
        fireEvent.click(workbench().querySelector<HTMLButtonElement>('.motif-cs-find-button')!);
        const field = screen.getByRole('searchbox', { name: 'Find in sequence' });
        fireEvent.change(field, { target: { value: query } });
        fireEvent.keyDown(field, { key: 'Enter' });
        fireEvent.keyDown(field, { key: 'Enter' });
      };
      const savedPattern = (workspace: unknown) => (workspace as { artifactState: { motifsByRecord: Record<string, string> } })
        .artifactState.motifsByRecord;

      it('stays clean after finding and stepping, and a new workspace opens', async () => {
        await openCleanRecord('find-only');
        await waitForProposals(1);
        findAndStep();
        expect(savedPattern(window.motifGetWorkspace!())).toEqual({ 'find-only': query });
        // Clean at once, not after the fingerprint settles.
        expect(exportStatus()).toBe('session only');
        expect(backupStatus()).toBeNull();
        expect(closeWarns()).toBe(false);
        await deliver('next-workspace');
        expect(rootData.motifMcpState).toBe('ready');
        expect(recordIds()).toEqual(['next-workspace']);
      });

      it('keeps an edit made during a find unsaved, and Undo clears it', async () => {
        await openCleanRecord('find-then-edit');
        await waitForProposals(1);
        findAndStep();
        typeBase();
        expect(backupStatus()).toBe('Unsaved changes');
        expect(closeWarns()).toBe(true);
        await deliver('refused-workspace');
        expect(bridgeNotice()).toBe(MOTIF_BRIDGE_MESSAGES.unsavedEditsWithoutDownloads);
        expect(recordIds()).toEqual(['find-then-edit']);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await waitFor(() => expect(backupStatus()).toBeNull());
        expect(closeWarns()).toBe(false);
        await deliver('next-workspace');
        expect(recordIds()).toEqual(['next-workspace']);
      });

      const deliverPattern = (id: string, pattern: string) => act(async () => applyMotifToolResult({
        content: [],
        structuredContent: {
          schema: 'motif.mcp.workbench.v1', mode: 'payload', recordCount: 1, residueCount: orfSequence.length,
          payload: {
            records: [{ id, name: id, sequence: orfSequence, molecule: 'dna', topology: 'linear' }],
            artifactState: { motifsByRecord: { [id]: pattern } },
          },
        },
      }));
      const searchField = () => openTool('pattern-search').querySelector<HTMLInputElement>('input[name="motif-search"]')!;

      it('applies a delivery of the open records with a new search pattern', async () => {
        await openCleanRecord('pattern-delivery');
        await waitForProposals(1);
        await deliverPattern('pattern-delivery', 'GAATTC');
        expect(rootData.motifMcpState).toBe('ready');
        expect(bridgeNotice()).toBeNull();
        expect(savedPattern(window.motifGetWorkspace!())).toEqual({ 'pattern-delivery': 'GAATTC' });
        expect(searchField().value).toBe('GAATTC');
        expect(backupStatus()).toBeNull();
        expect(closeWarns()).toBe(false);
      });

      it('keeps the open workspace when the same pattern arrives again', async () => {
        await openCleanRecord('pattern-repeat');
        await deliverPattern('pattern-repeat', 'GAATTC');
        await waitForProposals(1);
        await deliverPattern('pattern-repeat', 'GAATTC');
        // A reload would replace the annotated record with the delivered one.
        expect(window.motifGetInventory!()[0].annotations).toHaveLength(1);
        expect(exportStatus()).toBe('session only');
        expect(rootData.motifMcpState).toBe('ready');
        expect(searchField().value).toBe('GAATTC');
      });

      it('refuses a new search pattern over a real edit', async () => {
        await openCleanRecord('pattern-over-edit');
        await waitForProposals(1);
        typeBase();
        await deliverPattern('pattern-over-edit', 'GAATTC');
        expect(bridgeNotice()).toBe(MOTIF_BRIDGE_MESSAGES.unsavedEditsWithoutDownloads);
        expect(window.motifGetInventory!()[0].seq).toBe('C' + orfSequence.slice(1));
        expect(savedPattern(window.motifGetWorkspace!())).toEqual({});
      });

      it('still saves the search pattern in a backup', async () => {
        await openCleanRecord('find-backup');
        await waitForProposals(1);
        findAndStep();
        const hostDownload = hostSaves(true);
        await backUp();
        expect(savedPattern(JSON.parse((hostDownload.mock.calls[0] as unknown as [string, string])[1]))).toEqual({ 'find-backup': query });
        expect(backupStatus()).toBe('Backup saved');
      });
    });

    it('keeps the open workspace when the host delivers its current export again', async () => {
      await openCleanRecord('round-trip');
      await waitForProposals(1);
      renameRecord();
      const exported = window.motifGetWorkspace!();
      await act(async () => applyMotifToolResult({
        content: [],
        structuredContent: {
          schema: 'motif.mcp.workbench.v1', mode: 'payload', recordCount: 1, residueCount: orfSequence.length,
          payload: exported,
        },
      }));
      expect(rootData.motifMcpState).toBe('ready');
      expect(bridgeNotice()).toBeNull();
      expect(window.motifGetInventory!()[0].name).toBe('Renamed record');
      expect(backupStatus()).toBe('Unsaved changes');
    });

    it('clears the guard when Undo returns to the delivered revision', async () => {
      await openCleanRecord('undo-delivery');
      await waitForProposals(1);
      typeBase();
      expect(closeWarns()).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(window.motifGetInventory!()[0].seq).toBe(orfSequence);
      expect(closeWarns()).toBe(false);
      await waitFor(() => expect(backupStatus()).toBeNull());
      await deliver('incoming');
      expect(recordIds()).toEqual(['incoming']);
    });

    it('keeps an edit made before the automatic pass unsaved, then clears it on Undo', async () => {
      vi.useFakeTimers();
      try {
        await openCleanRecord('edit-before-pass');
        expect(window.motifGetInventory!()[0].proposeAnnotations).toBe(true);
        typeBase();
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(window.motifGetInventory!()[0].proposeAnnotations).toBe(false);
        expect(backupStatus()).toBe('Unsaved changes');
        expect(closeWarns()).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        expect(window.motifGetInventory!()[0].provenance?.motifAutoAnnotation).toMatchObject({ proposedCount: 1 });
        expect(backupStatus()).toBeNull();
        expect(closeWarns()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('is refused once, in the dismissible bridge notice, and the edits stay', async () => {
      act(() => window.motifClearWorkspace!());
      addRecord('unsaved-record');
      const snapshot = () => {
        const workspace = window.motifGetWorkspace!();
        delete workspace.exportedAt;
        return workspace;
      };
      const before = snapshot();
      await deliver('incoming');
      expect(rootData.motifMcpState).toBe('error');
      expect(snapshot()).toEqual(before);
      const notice = document.getElementById('motif-mcp-notice');
      expect(notice?.getAttribute('role')).toBe('alert');
      // This host cannot save files, so the notice offers what lifts the guard here.
      expect(bridgeNotice()).toBe(MOTIF_BRIDGE_MESSAGES.unsavedEditsWithoutDownloads);
      // The refusal is said once, in the bridge notice; the workbench notice does not repeat it.
      expect(workbench().querySelector('.motif-cs-workbench-notice')?.textContent ?? '').not.toMatch(/unsaved/i);
      fireEvent.click(within(notice!).getByRole('button', { name: 'Dismiss' }));
      expect(document.getElementById('motif-mcp-notice')).toBeNull();
    });

    it('opens after the host confirms a backup of the edits', async () => {
      act(() => window.motifClearWorkspace!());
      addRecord('edited');
      const hostDownload = hostSaves(true);
      await deliver('incoming');
      expect(bridgeNotice()).toBe(MOTIF_BRIDGE_MESSAGES.unsavedEdits);
      expect(recordIds()).toEqual(['edited']);

      await backUp();
      expect(hostDownload).toHaveBeenCalledExactlyOnceWith('motif-workspace-backup.json', expect.stringContaining('"edited"'), 'application/json');
      expect(screen.getByTestId('data-recovery-status').textContent).toBe('Backup saved as motif-workspace-backup.json.');
      expect(backupStatus()).toBe('Backup saved');
      expect(exportStatus()).toBe('backup saved');
      expect(closeWarns()).toBe(false);
      await deliver('incoming');
      expect(rootData.motifMcpState).toBe('ready');
      expect(recordIds()).toEqual(['incoming']);
      expect(bridgeNotice()).toBeNull();
    });

    it('is refused again after an edit made since the confirmed backup', async () => {
      act(() => window.motifClearWorkspace!());
      addRecord('edited');
      hostSaves(true);
      await backUp();
      expect(closeWarns()).toBe(false);
      addRecord('edited-after-backup');
      expect(backupStatus()).toBe('Unsaved changes');
      expect(closeWarns()).toBe(true);
      await deliver('incoming');
      expect(rootData.motifMcpState).toBe('error');
      expect(bridgeNotice()).toBe(MOTIF_BRIDGE_MESSAGES.unsavedEdits);
      expect(recordIds()).toEqual(['edited', 'edited-after-backup']);
    });

    it('keeps edits made while the host is saving the previous revision', async () => {
      await openCleanRecord('backup-in-progress');
      await waitForProposals(1);
      renameRecord();
      let confirmSave!: (saved: boolean) => void;
      (window as HostWindow).motifHostDownload = () => new Promise<boolean>((resolve) => { confirmSave = resolve; });
      await backUp();
      typeBase();
      await act(async () => confirmSave(true));
      expect(backupStatus()).toBe('Unsaved changes');
      expect(closeWarns()).toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      await waitFor(() => expect(backupStatus()).toBe('Backup saved'));
      expect(closeWarns()).toBe(false);
    });

    it('keeps a new delivery clean when the host finishes saving the previous workspace', async () => {
      await openCleanRecord('previous-workspace');
      let confirmSave!: (saved: boolean) => void;
      (window as HostWindow).motifHostDownload = () => new Promise<boolean>((resolve) => { confirmSave = resolve; });
      await backUp();
      await deliver('incoming');
      await act(async () => confirmSave(true));
      expect(recordIds()).toEqual(['incoming']);
      expect(backupStatus()).toBeNull();
      expect(closeWarns()).toBe(false);
    });

    it.each(['requested from the browser', 'declined by the host'] as const)('is still refused after a backup %s', async (outcome) => {
      act(() => window.motifClearWorkspace!());
      addRecord('edited');
      if (outcome === 'declined by the host') hostSaves(false);
      else stubUnconfirmedDownload();
      await backUp();
      expect(screen.getByTestId('data-recovery-status').textContent).toMatch(outcome === 'declined by the host'
        ? /^The backup was not saved\. Try again\.$/
        : /^Download requested for motif-workspace-backup\.json\./);
      expect(backupStatus()).toBe(outcome === 'declined by the host' ? 'Unsaved changes' : 'Backup requested');
      expect(closeWarns()).toBe(true);
      await deliver('incoming');
      expect(rootData.motifMcpState).toBe('error');
      expect(recordIds()).toEqual(['edited']);
      expect(bridgeNotice()).toBe(outcome === 'declined by the host'
        ? MOTIF_BRIDGE_MESSAGES.unsavedEdits
        : MOTIF_BRIDGE_MESSAGES.unsavedEditsWithoutDownloads);
    });

    it('opens after a backup is restored, as the notice says when the host cannot save files', async () => {
      act(() => window.motifClearWorkspace!());
      addRecord('edited');
      const backup = JSON.stringify(window.motifGetWorkspace!());
      addRecord('edited-later');
      await deliver('incoming');
      expect(bridgeNotice()).toBe(MOTIF_BRIDGE_MESSAGES.unsavedEditsWithoutDownloads);

      const file = heldFile('motif-workspace-backup.json');
      choose(screen.getByTestId('restore-workspace-file'), file.file);
      await act(async () => file.finish(backup));
      const dialog = await screen.findByTestId('database-restore-dialog');
      await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Replace workspace' })); });
      expect(recordIds()).toEqual(['edited']);
      await deliver('incoming');
      expect(rootData.motifMcpState).toBe('ready');
      expect(recordIds()).toEqual(['incoming']);
    });
  });

  it('labels a backup as requested even if the browser silently drops it', async () => {
    act(() => window.motifClearWorkspace!());
    addRecord('backup-fixture');
    const click = stubUnconfirmedDownload();
    await act(async () => { fireEvent.click(screen.getByTestId('download-workspace-backup')); });
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByTestId('data-recovery-status').textContent).toMatch(/^Download requested for motif-workspace-backup.json\./);
    await waitFor(() => expect(screen.getByTestId('session-durability-status').textContent).toBe('backup requested'));
  });

  it('uses actual clipboard and download outcomes in the primer workspace', async () => {
    act(() => window.motifClearWorkspace!());
    addRecord('Primer-fixture', 'ATGCGTACGATCCGTAAGCTGACCTAGTCGATGCTACGGTCAATCG'.repeat(24));
    fireEvent.click(screen.getByTestId('open-primer-workspace'));
    const workspace = document.querySelector<HTMLElement>('.motif-cs-primer-workspace')!;
    // Copy pair and Export FASTA live in the footer's More menu.
    within(workspace).getByTestId('primer-more-menu').closest('details')!.open = true;
    const copy = within(workspace).getByRole<HTMLButtonElement>('menuitem', { name: 'Copy pair' });
    const fasta = within(workspace).getByRole<HTMLButtonElement>('menuitem', { name: 'Export FASTA' });
    const status = () => workspace.querySelector('.motif-cs-primer-live-status')?.textContent;
    const acknowledge = within(workspace).queryByTestId('primer-evidence-acknowledgment');
    if (acknowledge) fireEvent.click(acknowledge);
    expect(copy.disabled).toBe(false);

    const writeText = vi.fn().mockRejectedValueOnce(new Error('clipboard denied')).mockResolvedValueOnce(undefined);
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }));
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const origin = vi.spyOn(window, 'origin', 'get').mockReturnValue('null');
    const top = vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);

    try {
      await act(async () => { fireEvent.click(copy); });
      expect.soft(status()).toBe('Copy blocked. Select and copy the primer sequences.');
      expect.soft(workbench().querySelector('.motif-cs-workbench-notice[role="alert"]')?.textContent)
        .toBe('Copy blocked. Select and copy the primer sequences.');
      expect(execCommand).toHaveBeenCalledOnce();
      await act(async () => { fireEvent.click(copy); });
      expect.soft(status()).toBe('Primer pair copied.');
      expect(writeText).toHaveBeenCalledTimes(2);

      const anchorClick = stubUnconfirmedDownload();
      await act(async () => { fireEvent.click(fasta); });
      expect.soft(status()).toBe('Downloads are off in this panel. Use Copy instead.');
      expect(anchorClick).not.toHaveBeenCalled();

      origin.mockRestore();
      top.mockRestore();
      await act(async () => { fireEvent.click(fasta); });
      expect.soft(status()).toMatch(/^Download requested for .+\. Verify the file before relying on it\.$/);
      expect(anchorClick).toHaveBeenCalledOnce();
    } finally {
      Reflect.deleteProperty(document, 'execCommand');
    }
  });
});
