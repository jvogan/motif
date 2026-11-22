/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ClaudeScienceDataSettings from '../ClaudeScienceDataSettings';

afterEach(() => {
  cleanup();
});

function renderSettings(overrides: Partial<React.ComponentProps<typeof ClaudeScienceDataSettings>> = {}) {
  const props: React.ComponentProps<typeof ClaudeScienceDataSettings> = {
    recordCount: 3,
    alignmentCount: 2,
    noteCount: 1,
    workflowCount: 4,
    sessionOnly: true,
    hasUnsavedChanges: true,
    onDownloadBackup: vi.fn(() => ({
      status: 'requested' as const,
      channel: 'browser' as const,
      filename: 'motif-workspace-backup.json',
      message: 'Download requested. Verify the file before reloading.',
    })),
    onRestoreFile: vi.fn(),
    onClearWorkspace: vi.fn(),
    onResetDisplayPreferences: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ClaudeScienceDataSettings {...props} />) };
}

describe('ClaudeScienceDataSettings', () => {
  it.each([
    { hasUnsavedChanges: true, backupStatus: null, chip: 'Unsaved changes' },
    { hasUnsavedChanges: true, backupStatus: 'requested', chip: 'Backup requested' },
    { hasUnsavedChanges: false, backupStatus: 'saved', chip: 'Backup saved' },
  ] as const)('reads "$chip" on the backup chip', ({ hasUnsavedChanges, backupStatus, chip }) => {
    const { getByTestId } = renderSettings({ hasUnsavedChanges, backupStatus });
    expect(getByTestId('data-backup-status').textContent).toBe(chip);
  });

  it('shows no backup chip when nothing needs backing up', () => {
    const { queryByTestId } = renderSettings({ hasUnsavedChanges: false });
    expect(queryByTestId('data-backup-status')).toBeNull();
  });

  it('presents explicit backup/restore controls, counts, and the session privacy boundary', async () => {
    const onDownloadBackup = vi.fn(() => ({
      status: 'requested' as const,
      channel: 'browser' as const,
      filename: 'motif-workspace-backup.json',
      message: 'Download requested. Verify the file before reloading.',
    }));
    const onRestoreFile = vi.fn();
    const { getByTestId } = renderSettings({ onDownloadBackup, onRestoreFile });

    // The counts appear once, under Clear workspace.
    expect(screen.getByText('Back up before closing or reloading.')).toBeTruthy();
    expect(screen.getAllByText(/3 records · 2 alignments · 1 note · 4 workflow results/)).toHaveLength(1);
    expect(screen.getByText('3 records · 2 alignments · 1 note · 4 workflow results will be removed.')).toBeTruthy();
    expect(screen.getByText(/Kept in this browser session\. Nothing is uploaded\. Backups are unencrypted JSON\./)).toBeTruthy();
    expect(screen.queryByTestId('library-mode-status')).toBeNull();

    fireEvent.click(getByTestId('download-workspace-backup'));
    await waitFor(() => expect(onDownloadBackup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByTestId('data-recovery-status').textContent)
      .toBe('Download requested. Verify the file before reloading.'));

    const backup = new File(['{"schema":"motif"}'], 'workspace.json', { type: 'application/json' });
    const input = getByTestId('restore-workspace-file') as HTMLInputElement;
    expect(input.accept).toBe('.json,application/json');
    fireEvent.change(input, { target: { files: [backup] } });
    await waitFor(() => expect(onRestoreFile).toHaveBeenCalledWith(
      backup,
      getByTestId('restore-workspace-backup'),
    ));
    expect(getByTestId('data-recovery-status').textContent).toBe('workspace.json is valid. Review and confirm restore.');
  });

  it('includes typed analysis results in portable workspace counts when present', () => {
    renderSettings({ analysisResultCount: 3 });
    // Once, under Clear workspace; the backup row does not repeat it.
    expect(screen.getAllByText(/4 workflow results · 3 analysis results/)).toHaveLength(1);
    expect(screen.getByText(/4 workflow results · 3 analysis results will be removed\./)).toBeTruthy();
  });

  it('uses an inline two-step clear confirmation with Cancel focused by default', async () => {
    const onClearWorkspace = vi.fn();
    const { getByTestId } = renderSettings({ onClearWorkspace });
    const trigger = getByTestId('clear-workspace');

    fireEvent.click(trigger);
    const confirmation = getByTestId('clear-workspace-confirmation');
    const cancel = getByTestId('clear-workspace-cancel');
    expect(confirmation.getAttribute('role')).toBe('group');
    // The counts stay in the line above the confirmation, not repeated in it;
    // the group names that line first in its description.
    expect(confirmation.textContent).not.toContain('3 records');
    expect(confirmation.getAttribute('aria-describedby')).toBe('motif-cs-clear-workspace-counts motif-cs-clear-confirmation-description');
    expect(document.getElementById('motif-cs-clear-workspace-counts')?.textContent).toBe('3 records · 2 alignments · 1 note · 4 workflow results will be removed.');
    expect(confirmation.textContent).toContain('Unsaved changes will be lost');
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    fireEvent.click(cancel);
    expect(onClearWorkspace).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(getByTestId('clear-workspace')));

    fireEvent.click(getByTestId('clear-workspace'));
    await waitFor(() => expect(document.activeElement).toBe(getByTestId('clear-workspace-cancel')));
    fireEvent.click(getByTestId('clear-workspace-confirm'));
    await waitFor(() => expect(onClearWorkspace).toHaveBeenCalledTimes(1));
    expect(getByTestId('data-recovery-status').textContent).toBe('Workspace cleared.');
  });

  it('treats Escape as Cancel and returns focus to the clear trigger', async () => {
    const onClearWorkspace = vi.fn();
    const { getByTestId } = renderSettings({ onClearWorkspace });

    fireEvent.click(getByTestId('clear-workspace'));
    await waitFor(() => expect(document.activeElement).toBe(getByTestId('clear-workspace-cancel')));
    fireEvent.keyDown(getByTestId('clear-workspace-confirmation'), { key: 'Escape' });

    expect(onClearWorkspace).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(getByTestId('clear-workspace')));
  });

  it('resets all display preferences and announces completion', async () => {
    const onResetDisplayPreferences = vi.fn();
    const { getByTestId } = renderSettings({ onResetDisplayPreferences });

    fireEvent.click(getByTestId('reset-display-preferences'));
    await waitFor(() => expect(onResetDisplayPreferences).toHaveBeenCalledTimes(1));
    expect(getByTestId('data-recovery-status').getAttribute('aria-live')).toBe('polite');
    expect(getByTestId('data-recovery-status').textContent).toBe('Display reset.');
  });
});
