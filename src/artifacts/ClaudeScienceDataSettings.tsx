import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from 'react';

type MaybePromise = void | Promise<void>;

export interface ClaudeScienceDataSettingsProps {
  recordCount: number;
  alignmentCount: number;
  noteCount: number;
  workflowCount: number;
  analysisResultCount?: number;
  sessionOnly: boolean;
  hasUnsavedChanges: boolean;
  onDownloadBackup: () => MaybePromise;
  onRestoreFile: (file: File, returnFocus: HTMLElement | null) => MaybePromise;
  onClearWorkspace: () => MaybePromise;
  onResetDisplayPreferences: () => MaybePromise;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function workspaceDataCountLabel({
  recordCount,
  alignmentCount,
  noteCount,
  workflowCount,
  analysisResultCount = 0,
}: Pick<
  ClaudeScienceDataSettingsProps,
  'recordCount' | 'alignmentCount' | 'noteCount' | 'workflowCount' | 'analysisResultCount'
>): string {
  return [
    countLabel(recordCount, 'record'),
    countLabel(alignmentCount, 'alignment'),
    countLabel(noteCount, 'note'),
    countLabel(workflowCount, 'workflow result'),
    ...(analysisResultCount > 0 ? [countLabel(analysisResultCount, 'analysis result')] : []),
  ].join(' · ');
}

export default function ClaudeScienceDataSettings({
  recordCount,
  alignmentCount,
  noteCount,
  workflowCount,
  analysisResultCount = 0,
  sessionOnly,
  hasUnsavedChanges,
  onDownloadBackup,
  onRestoreFile,
  onClearWorkspace,
  onResetDisplayPreferences,
}: ClaudeScienceDataSettingsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoreTriggerRef = useRef<HTMLButtonElement>(null);
  const clearTriggerRef = useRef<HTMLButtonElement>(null);
  const clearCancelRef = useRef<HTMLButtonElement>(null);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const returnClearFocusRef = useRef(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [pendingAction, setPendingAction] = useState<'backup' | 'restore' | 'clear' | 'reset' | null>(null);
  const [status, setStatus] = useState('');
  const countSummary = workspaceDataCountLabel({
    recordCount,
    alignmentCount,
    noteCount,
    workflowCount,
    analysisResultCount,
  });
  const isBusy = pendingAction !== null;

  useEffect(() => {
    if (confirmingClear) {
      clearCancelRef.current?.focus();
      return;
    }
    if (returnClearFocusRef.current) {
      returnClearFocusRef.current = false;
      clearTriggerRef.current?.focus();
    }
  }, [confirmingClear]);

  const closeClearConfirmation = () => {
    returnClearFocusRef.current = true;
    setConfirmingClear(false);
  };

  const handleBackup = async () => {
    setPendingAction('backup');
    setStatus('Preparing workspace backup…');
    try {
      await onDownloadBackup();
      setStatus('Workspace backup downloaded.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Workspace backup could not be downloaded.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleRestoreChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setPendingAction('restore');
    setStatus(`Restoring ${file.name}…`);
    try {
      await onRestoreFile(file, restoreTriggerRef.current);
      setStatus(`${file.name} is valid. Review the confirmation to restore it.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The workspace backup could not be restored.');
    } finally {
      input.value = '';
      setPendingAction(null);
    }
  };

  const handleClear = async () => {
    setPendingAction('clear');
    setStatus('Clearing workspace…');
    try {
      await onClearWorkspace();
      setStatus('Workspace cleared.');
      closeClearConfirmation();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'The workspace could not be cleared.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleResetDisplay = async () => {
    setPendingAction('reset');
    setStatus('Resetting display preferences…');
    try {
      await onResetDisplayPreferences();
      setStatus('Display preferences reset.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Display preferences could not be reset.');
    } finally {
      setPendingAction(null);
      window.requestAnimationFrame(() => resetTriggerRef.current?.focus());
    }
  };

  const handleConfirmationKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || pendingAction === 'clear') return;
    event.preventDefault();
    event.stopPropagation();
    closeClearConfirmation();
  };

  return (
    <section
      className="motif-cs-settings-section motif-cs-data-settings"
      aria-labelledby="motif-cs-data-settings-title"
      data-testid="data-recovery-settings"
    >
      <div className="motif-cs-settings-section-heading">
        <h3 id="motif-cs-data-settings-title">Data &amp; recovery</h3>
        <span className="motif-cs-chip">{hasUnsavedChanges ? 'Unsaved changes' : 'Backup current'}</span>
      </div>

      <div className="motif-cs-settings-row">
        <div className="motif-cs-settings-row-copy">
          <strong>Workspace backup</strong>
          <small>{countSummary}. Download a complete JSON backup before closing or reloading.</small>
        </div>
        <div className="motif-cs-settings-row-actions">
          <button
            className="motif-cs-mini-button"
            type="button"
            disabled={isBusy}
            onClick={handleBackup}
            data-testid="download-workspace-backup"
          >
            {pendingAction === 'backup' ? 'Preparing…' : 'Download backup'}
          </button>
          <button
            ref={restoreTriggerRef}
            className="motif-cs-mini-button"
            type="button"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
            data-testid="restore-workspace-backup"
          >
            Restore backup
          </button>
          <input
            ref={fileInputRef}
            className="motif-cs-visually-hidden"
            type="file"
            accept=".json,application/json"
            aria-label="Choose workspace backup JSON"
            disabled={isBusy}
            onChange={handleRestoreChange}
            data-testid="restore-workspace-file"
          />
        </div>
      </div>

      <p className="motif-cs-settings-privacy-note" role="note">
        <strong>{sessionOnly ? 'Session workspace.' : 'Local workspace.'}</strong>{' '}
        {sessionOnly
          ? 'Changes remain in this browser session until you export them. '
          : 'Changes remain on this device until you remove them. '}
        Nothing is uploaded automatically. Backups are plaintext JSON, not an encrypted vault.
      </p>

      <div className="motif-cs-settings-row" data-testid="library-mode-status">
        <div className="motif-cs-settings-row-copy">
          <strong>Growing library</strong>
          <small>
            Use this artifact for portable review and design. Move a reviewed backup into an appropriate managed local system
            when you need a durable library, projects, and a linked research notebook.
          </small>
        </div>
        <div className="motif-cs-settings-row-actions">
          <span className="motif-cs-chip">Portable session</span>
        </div>
      </div>

      <div className="motif-cs-settings-row">
        <div className="motif-cs-settings-row-copy">
          <strong>Display preferences</strong>
          <small>Restore default pane sizes and reset alignment, trace, and viewer controls.</small>
        </div>
        <div className="motif-cs-settings-row-actions">
          <button
            ref={resetTriggerRef}
            className="motif-cs-mini-button"
            type="button"
            disabled={isBusy}
            onClick={handleResetDisplay}
            data-testid="reset-display-preferences"
          >
            Reset display
          </button>
        </div>
      </div>

      <div className="motif-cs-settings-row motif-cs-settings-danger-row">
        <div className="motif-cs-settings-row-copy">
          <strong>Clear workspace</strong>
          <small>Remove all {countSummary} from this workspace.</small>
        </div>
        {!confirmingClear ? (
          <div className="motif-cs-settings-row-actions">
            <button
              ref={clearTriggerRef}
              className="motif-cs-mini-button motif-cs-danger-button"
              type="button"
              disabled={isBusy}
              aria-expanded="false"
              onClick={() => {
                setStatus('');
                setConfirmingClear(true);
              }}
              data-testid="clear-workspace"
            >
              Clear workspace
            </button>
          </div>
        ) : (
          <div
            className="motif-cs-settings-clear-confirmation"
            role="group"
            aria-labelledby="motif-cs-clear-confirmation-title"
            aria-describedby="motif-cs-clear-confirmation-description"
            onKeyDown={handleConfirmationKeyDown}
            data-testid="clear-workspace-confirmation"
          >
            <div className="motif-cs-settings-row-copy">
              <strong id="motif-cs-clear-confirmation-title">Clear everything?</strong>
              <small id="motif-cs-clear-confirmation-description">
                {countSummary}. {hasUnsavedChanges ? 'Unsaved changes will be lost. ' : ''}
                This cannot be undone unless you downloaded a backup.
              </small>
            </div>
            <div className="motif-cs-settings-row-actions">
              <button
                ref={clearCancelRef}
                className="motif-cs-mini-button"
                type="button"
                disabled={pendingAction === 'clear'}
                onClick={closeClearConfirmation}
                data-testid="clear-workspace-cancel"
              >
                Cancel
              </button>
              <button
                className="motif-cs-mini-button motif-cs-danger-button"
                type="button"
                disabled={pendingAction === 'clear'}
                onClick={handleClear}
                data-testid="clear-workspace-confirm"
              >
                {pendingAction === 'clear' ? 'Clearing…' : 'Clear all data'}
              </button>
            </div>
          </div>
        )}
      </div>

      <span
        className="motif-cs-settings-reset-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="data-recovery-status"
        data-empty={!status || undefined}
      >
        {status}
      </span>
    </section>
  );
}
