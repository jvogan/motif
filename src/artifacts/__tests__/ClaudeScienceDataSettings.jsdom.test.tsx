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
    onDownloadBackup: vi.fn(),
    onRestoreFile: vi.fn(),
    onClearWorkspace: vi.fn(),
    onResetDisplayPreferences: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ClaudeScienceDataSettings {...props} />) };
}

describe('ClaudeScienceDataSettings', () => {
  it('presents explicit backup/restore controls, counts, and the session privacy boundary', async () => {
    const onDownloadBackup = vi.fn();
    const onRestoreFile = vi.fn();
    const { getByTestId } = renderSettings({ onDownloadBackup, onRestoreFile });

    expect(screen.getByText('3 records · 2 alignments · 1 note · 4 workflow results. Download a complete JSON backup before closing or reloading.')).toBeTruthy();
    expect(screen.getByText(/Changes remain in this browser session/)).toBeTruthy();
    expect(screen.getByText(/Nothing is uploaded automatically/)).toBeTruthy();
    expect(screen.getByText(/plaintext JSON, not an encrypted vault/i)).toBeTruthy();
    expect(getByTestId('library-mode-status').textContent).toContain('Move a reviewed backup');
    expect(getByTestId('library-mode-status').textContent).toContain('Portable session');

    fireEvent.click(getByTestId('download-workspace-backup'));
    await waitFor(() => expect(onDownloadBackup).toHaveBeenCalledTimes(1));
    expect(getByTestId('data-recovery-status').textContent).toBe('Workspace backup downloaded.');

    const backup = new File(['{"schema":"motif"}'], 'workspace.json', { type: 'application/json' });
    const input = getByTestId('restore-workspace-file') as HTMLInputElement;
    expect(input.accept).toBe('.json,application/json');
    fireEvent.change(input, { target: { files: [backup] } });
    await waitFor(() => expect(onRestoreFile).toHaveBeenCalledWith(
      backup,
      getByTestId('restore-workspace-backup'),
    ));
    expect(getByTestId('data-recovery-status').textContent).toBe('workspace.json is valid. Review the confirmation to restore it.');
  });

  it('includes typed analysis results in portable workspace counts when present', () => {
    renderSettings({ analysisResultCount: 3 });
    expect(screen.getAllByText(/4 workflow results · 3 analysis results/)).toHaveLength(2);
  });

  it('uses an inline two-step clear confirmation with Cancel focused by default', async () => {
    const onClearWorkspace = vi.fn();
    const { getByTestId } = renderSettings({ onClearWorkspace });
    const trigger = getByTestId('clear-workspace');

    fireEvent.click(trigger);
    const confirmation = getByTestId('clear-workspace-confirmation');
    const cancel = getByTestId('clear-workspace-cancel');
    expect(confirmation.getAttribute('role')).toBe('group');
    expect(confirmation.textContent).toContain('3 records · 2 alignments · 1 note · 4 workflow results');
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
    expect(getByTestId('data-recovery-status').textContent).toBe('Display preferences reset.');
  });
});
