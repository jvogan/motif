import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  ClaudeScienceConstructVerificationPanel,
} from './ClaudeScienceConstructVerificationPanel';
import {
  ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS,
  type ArtifactConstructVerificationResult,
} from './claude-science-construct-verification';
import './claude-science-construct-verification-workspace.css';

const MIN_DEPTH = 1;
const MAX_DEPTH = 96;
const MAX_SELECTED_READS = ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads;
const FOCUSABLE = [
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  'summary',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export type ClaudeScienceConstructVerificationSangerTrace = {
  baseCalls: string;
  qualityScores?: readonly number[];
};

export type ClaudeScienceConstructVerificationRecord = {
  id: string;
  name: string;
  sequence: string;
  topology: 'linear' | 'circular';
  /** SHA-256 of the current normalized record sequence. */
  sha256: string;
  sangerTrace?: ClaudeScienceConstructVerificationSangerTrace;
  /** SHA-256 of the imported Sanger evidence, distinct from the record sequence hash. */
  sangerEvidenceSha256?: string;
};

export type ClaudeScienceConstructVerificationReadRecord = ClaudeScienceConstructVerificationRecord & {
  sangerTrace: ClaudeScienceConstructVerificationSangerTrace;
};

export type ClaudeScienceConstructVerificationRequest = {
  reference: ClaudeScienceConstructVerificationRecord;
  reads: readonly ClaudeScienceConstructVerificationReadRecord[];
  minDepth: number;
  requireBothStrands: boolean;
};

export type ClaudeScienceConstructVerificationThresholds = {
  trimQuality: number;
  trimWindow: number;
  minTrimmedReadLength: number;
  minMappingIdentity: number;
  minMappingMargin: number;
  maxIndelFraction: number;
  minCoverageFraction: number;
  minDepth: number;
  requireBothStrands: boolean;
  minConsensusFraction: number;
  minVariantQuality: number;
  minVariantFraction: number;
};

/**
 * Structural extension of the evidence panel's presentation boundary. The
 * construct-verification engine result is directly assignable without making
 * this workspace own or persist its large coordinate and depth arrays.
 */
export type ClaudeScienceConstructVerificationResult = ArtifactConstructVerificationResult;

export type ClaudeScienceConstructVerificationSnapshot = Readonly<{
  reference: Readonly<{
    id: string;
    sequenceSha256: string;
    topology: 'linear' | 'circular';
  }>;
  reads: readonly Readonly<{
    id: string;
    sequenceSha256: string;
    sangerEvidenceSha256: string | null;
  }>[];
  minDepth: number;
  requireBothStrands: boolean;
}>;

export type ClaudeScienceConstructVerificationSavePayload = Readonly<{
  result: ClaudeScienceConstructVerificationResult;
  snapshot: ClaudeScienceConstructVerificationSnapshot;
}>;

export type ClaudeScienceConstructVerificationWorkspaceProps = {
  records: readonly ClaudeScienceConstructVerificationRecord[];
  initialReferenceId?: string;
  /** Runs synchronously against bounded inputs; the large result stays local until Save. */
  onVerify: (request: ClaudeScienceConstructVerificationRequest) => ClaudeScienceConstructVerificationResult;
  onSave: (payload: ClaudeScienceConstructVerificationSavePayload) => void;
  onClose?: () => void;
  embedded?: boolean;
};

type VerificationFormState = {
  referenceId: string;
  selectedReadIds: string[];
  minDepth: number;
  requireBothStrands: boolean;
};

type CompletedRun = {
  result: ClaudeScienceConstructVerificationResult;
  snapshot: ClaudeScienceConstructVerificationSnapshot;
};

function isTraceBacked(
  record: ClaudeScienceConstructVerificationRecord,
): record is ClaudeScienceConstructVerificationReadRecord {
  return Boolean(record.sangerTrace && record.sangerTrace.baseCalls.trim().length > 0);
}

function eligibleReferenceRecords(
  records: readonly ClaudeScienceConstructVerificationRecord[],
): ClaudeScienceConstructVerificationRecord[] {
  return records.filter((record) => !isTraceBacked(record));
}

function preferredReferenceId(
  records: readonly ClaudeScienceConstructVerificationRecord[],
  initialReferenceId: string | undefined,
): string {
  const references = eligibleReferenceRecords(records);
  const requested = initialReferenceId
    ? references.find((record) => record.id === initialReferenceId)
    : undefined;
  return requested?.id ?? references[0]?.id ?? '';
}

function eligibleReadRecords(
  records: readonly ClaudeScienceConstructVerificationRecord[],
  referenceId: string,
): ClaudeScienceConstructVerificationReadRecord[] {
  return records.filter((record): record is ClaudeScienceConstructVerificationReadRecord => (
    record.id !== referenceId && isTraceBacked(record)
  ));
}

function initialFormState(
  records: readonly ClaudeScienceConstructVerificationRecord[],
  initialReferenceId: string | undefined,
): VerificationFormState {
  const referenceId = preferredReferenceId(records, initialReferenceId);
  return {
    referenceId,
    selectedReadIds: eligibleReadRecords(records, referenceId)
      .slice(0, MAX_SELECTED_READS)
      .map((record) => record.id),
    minDepth: MIN_DEPTH,
    requireBothStrands: false,
  };
}

function recordsSignature(records: readonly ClaudeScienceConstructVerificationRecord[]): string {
  return JSON.stringify(records.map((record) => {
    const trace = record.sangerTrace;
    const fallbackEvidence = trace ? [trace.baseCalls, trace.qualityScores ?? null] : null;
    return [
      record.id,
      record.sha256,
      record.topology,
      record.sangerEvidenceSha256 ?? fallbackEvidence,
    ];
  }));
}

function clampDepth(value: number): number {
  if (!Number.isFinite(value)) return MIN_DEPTH;
  return Math.max(MIN_DEPTH, Math.min(MAX_DEPTH, Math.round(value)));
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim() || 'Construct verification could not be completed.';
  return normalized.length <= 320 ? normalized : `${normalized.slice(0, 319)}…`;
}

function freezeSnapshot(
  reference: ClaudeScienceConstructVerificationRecord,
  reads: readonly ClaudeScienceConstructVerificationReadRecord[],
  minDepth: number,
  requireBothStrands: boolean,
): ClaudeScienceConstructVerificationSnapshot {
  const frozenReads = Object.freeze(reads.map((read) => Object.freeze({
    id: read.id,
    sequenceSha256: read.sha256,
    sangerEvidenceSha256: read.sangerEvidenceSha256 ?? null,
  })));
  return Object.freeze({
    reference: Object.freeze({
      id: reference.id,
      sequenceSha256: reference.sha256,
      topology: reference.topology,
    }),
    reads: frozenReads,
    minDepth,
    requireBothStrands,
  });
}

export function ClaudeScienceConstructVerificationWorkspace({
  records,
  initialReferenceId,
  onVerify,
  onSave,
  onClose,
  embedded = false,
}: ClaudeScienceConstructVerificationWorkspaceProps) {
  const titleId = useId();
  const criteriaId = useId();
  const workspaceRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLSelectElement>(null);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const recordSignature = useMemo(() => recordsSignature(records), [records]);
  const [form, setForm] = useState<VerificationFormState>(() => (
    initialFormState(records, initialReferenceId)
  ));
  const [completedRun, setCompletedRun] = useState<CompletedRun | null>(null);
  const [saved, setSaved] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const recordById = useMemo(
    () => new Map(records.map((record) => [record.id, record])),
    [records],
  );
  const referenceRecords = useMemo(
    () => eligibleReferenceRecords(records),
    [records],
  );
  const eligibleReads = useMemo(
    () => eligibleReadRecords(records, form.referenceId),
    [form.referenceId, records],
  );
  const eligibleReadIdSet = useMemo(
    () => new Set(eligibleReads.map((record) => record.id)),
    [eligibleReads],
  );
  const selectedReadIdSet = useMemo(
    () => new Set(form.selectedReadIds),
    [form.selectedReadIds],
  );
  const selectedReads = useMemo(
    () => eligibleReads.filter((record) => selectedReadIdSet.has(record.id)),
    [eligibleReads, selectedReadIdSet],
  );

  const clearCompletedRun = useCallback(() => {
    setCompletedRun(null);
    setSaved(false);
    setStatusMessage('');
    setErrorMessage('');
  }, []);

  useEffect(() => {
    const currentRecords = recordsRef.current;
    setForm((current) => {
      const referenceStillExists = currentRecords.some((record) => (
        record.id === current.referenceId && !isTraceBacked(record)
      ));
      const referenceId = referenceStillExists
        ? current.referenceId
        : preferredReferenceId(currentRecords, undefined);
      const nextEligibleReads = eligibleReadRecords(currentRecords, referenceId);
      const validReadIds = new Set(nextEligibleReads.map((record) => record.id));
      const selectedReadIds = referenceStillExists
        ? current.selectedReadIds.filter((id) => validReadIds.has(id)).slice(0, MAX_SELECTED_READS)
        : nextEligibleReads.slice(0, MAX_SELECTED_READS).map((record) => record.id);
      if (
        referenceId === current.referenceId
        && selectedReadIds.length === current.selectedReadIds.length
        && selectedReadIds.every((id, index) => id === current.selectedReadIds[index])
      ) return current;
      return { ...current, referenceId, selectedReadIds };
    });
    clearCompletedRun();
  }, [clearCompletedRun, recordSignature]);

  useEffect(() => {
    if (embedded) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    initialFocusRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [embedded]);

  useEffect(() => {
    if (embedded || !onClose) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        workspaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      ).filter((element) => element.offsetParent !== null || element === document.activeElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [embedded, onClose]);

  const updateReference = (referenceId: string) => {
    if (!referenceRecords.some((record) => record.id === referenceId)) return;
    setForm((current) => ({
      ...current,
      referenceId,
      selectedReadIds: eligibleReadRecords(records, referenceId)
        .slice(0, MAX_SELECTED_READS)
        .map((record) => record.id),
    }));
    clearCompletedRun();
  };

  const updateReadSelection = (readId: string, checked: boolean) => {
    if (checked && !selectedReadIdSet.has(readId) && selectedReads.length >= MAX_SELECTED_READS) return;
    setForm((current) => {
      const selected = new Set(current.selectedReadIds);
      if (checked) selected.add(readId);
      else selected.delete(readId);
      return {
        ...current,
        selectedReadIds: eligibleReads
          .filter((record) => selected.has(record.id))
          .map((record) => record.id),
      };
    });
    clearCompletedRun();
  };

  const selectAllReads = () => {
    setForm((current) => ({
      ...current,
      selectedReadIds: eligibleReads.slice(0, MAX_SELECTED_READS).map((record) => record.id),
    }));
    clearCompletedRun();
  };

  const clearReads = () => {
    setForm((current) => ({ ...current, selectedReadIds: [] }));
    clearCompletedRun();
  };

  const updateMinimumDepth = (value: number) => {
    setForm((current) => ({ ...current, minDepth: clampDepth(value) }));
    clearCompletedRun();
  };

  const updateStrandRequirement = (requireBothStrands: boolean) => {
    setForm((current) => ({ ...current, requireBothStrands }));
    clearCompletedRun();
  };

  const runVerification = (event: FormEvent) => {
    event.preventDefault();
    setCompletedRun(null);
    setSaved(false);
    setErrorMessage('');
    setStatusMessage('');

    const reference = recordById.get(form.referenceId);
    if (!reference || isTraceBacked(reference)) {
      setErrorMessage('Choose a predicted DNA reference before verification.');
      return;
    }
    if (!selectedReads.length) {
      setErrorMessage('Select at least one imported Sanger read before verification.');
      return;
    }
    if (selectedReads.length > MAX_SELECTED_READS) {
      setErrorMessage(`Select no more than ${MAX_SELECTED_READS.toLocaleString()} Sanger reads per verification run.`);
      return;
    }

    const snapshot = freezeSnapshot(
      reference,
      selectedReads,
      form.minDepth,
      form.requireBothStrands,
    );
    const request = Object.freeze({
      reference,
      reads: Object.freeze([...selectedReads]),
      minDepth: form.minDepth,
      requireBothStrands: form.requireBothStrands,
    });

    try {
      const result = onVerify(request);
      setCompletedRun({ result, snapshot });
      setStatusMessage('Verification complete. Review the evidence before saving.');
    } catch (error) {
      setErrorMessage(boundedErrorMessage(error));
    }
  };

  const saveVerification = () => {
    if (!completedRun || saved) return;
    setErrorMessage('');
    try {
      onSave(Object.freeze({
        result: completedRun.result,
        snapshot: completedRun.snapshot,
      }));
      setSaved(true);
      setStatusMessage('Verification saved to Results with its frozen evidence snapshot.');
    } catch (error) {
      setErrorMessage(boundedErrorMessage(error));
    }
  };

  const reference = recordById.get(form.referenceId);
  const selectedCount = selectedReads.length;
  const defaultSelectedReadIds = eligibleReads.slice(0, MAX_SELECTED_READS).map((record) => record.id);
  const allReadsSelected = defaultSelectedReadIds.length > 0
    && defaultSelectedReadIds.length === selectedCount
    && defaultSelectedReadIds.every((id) => selectedReadIdSet.has(id));
  const readSelectionAtLimit = selectedCount >= MAX_SELECTED_READS;
  const runDisabled = !reference || isTraceBacked(reference) || eligibleReads.length === 0 || selectedCount === 0;
  const resultReadNames = useMemo(
    () => Object.fromEntries(records.map((record) => [record.id, record.name])),
    [records],
  );

  const workspace = (
    <section
      ref={workspaceRef}
      className="motif-cs-verification-workspace"
      data-embedded={embedded || undefined}
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={embedded ? 'Construct verification' : undefined}
      aria-labelledby={embedded ? undefined : titleId}
      data-testid="construct-verification-workspace"
    >
      {embedded ? null : (
        <header className="motif-cs-verification-workspace-header">
          <div>
            <span>Evidence workspace</span>
            <h2 id={titleId}>Construct verification</h2>
            <p>Compare imported Sanger base calls with the predicted DNA record.</p>
          </div>
          {onClose ? (
            <button
              className="motif-cs-verification-icon-button"
              type="button"
              onClick={onClose}
              aria-label="Close construct verification workspace"
            >×</button>
          ) : null}
        </header>
      )}

      <div className="motif-cs-verification-workspace-body">
        <form className="motif-cs-verification-setup" onSubmit={runVerification}>
          <div className="motif-cs-verification-intro">
            <span>Predicted vs observed</span>
            <strong>Define the acceptance evidence</strong>
            <p>Motif uses the entire predicted construct as the required region. Adjustments invalidate the prior run until you verify again.</p>
          </div>

          <section className="motif-cs-verification-form-section" aria-labelledby={`${criteriaId}-reference`}>
            <div className="motif-cs-verification-section-index" aria-hidden="true">01</div>
            <div className="motif-cs-verification-section-content">
              <label className="motif-cs-verification-field" htmlFor={`${criteriaId}-reference-select`}>
                <span id={`${criteriaId}-reference`}>Predicted reference</span>
                <select
                  ref={initialFocusRef}
                  id={`${criteriaId}-reference-select`}
                  data-testid="construct-verification-reference"
                  value={form.referenceId}
                  disabled={!referenceRecords.length}
                  onChange={(event) => updateReference(event.target.value)}
                >
                  {!referenceRecords.length ? <option value="">No predicted DNA references</option> : null}
                  {referenceRecords.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.name}
                    </option>
                  ))}
                </select>
              </label>
              {reference ? (
                <p className="motif-cs-verification-record-detail">
                  {reference.sequence.length.toLocaleString()} bp · {reference.topology} · sequence hash recorded
                </p>
              ) : (
                <p className="motif-cs-verification-record-detail">Add a DNA record to define the predicted construct.</p>
              )}
            </div>
          </section>

          <fieldset className="motif-cs-verification-form-section motif-cs-verification-read-fieldset">
            <legend className="motif-cs-verification-sr-only">Imported Sanger evidence</legend>
            <div className="motif-cs-verification-section-index" aria-hidden="true">02</div>
            <div className="motif-cs-verification-section-content">
              <div className="motif-cs-verification-read-heading">
                <div>
                  <strong>Imported Sanger evidence</strong>
                  <span id={`${criteriaId}-read-limit`}>
                    {selectedCount.toLocaleString()} of {eligibleReads.length.toLocaleString()} reads selected · maximum {MAX_SELECTED_READS.toLocaleString()} per run
                  </span>
                </div>
                <div className="motif-cs-verification-read-actions" aria-label="Sanger read selection actions">
                  <button type="button" onClick={selectAllReads} disabled={!eligibleReads.length || allReadsSelected}>
                    {eligibleReads.length > MAX_SELECTED_READS ? `First ${MAX_SELECTED_READS.toLocaleString()}` : 'All'}
                  </button>
                  <button type="button" onClick={clearReads} disabled={!selectedCount}>Clear</button>
                </div>
              </div>

              {eligibleReads.length ? (
                <div
                  className="motif-cs-verification-read-list"
                  data-testid="construct-verification-read-list"
                  aria-label="Available imported Sanger reads"
                >
                  {eligibleReads.map((read) => {
                    const checked = eligibleReadIdSet.has(read.id) && selectedReadIdSet.has(read.id);
                    const disabledByLimit = !checked && readSelectionAtLimit;
                    return (
                      <label key={read.id} className="motif-cs-verification-read-option">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabledByLimit}
                          aria-describedby={`${criteriaId}-read-limit`}
                          title={disabledByLimit ? 'Deselect another read to include this evidence.' : undefined}
                          onChange={(event) => updateReadSelection(read.id, event.target.checked)}
                        />
                        <span>
                          <strong>{read.name}</strong>
                          <small>
                            {read.sangerTrace.baseCalls.length.toLocaleString()} calls · {read.sangerEvidenceSha256 ? 'evidence hash recorded' : 'evidence hash unavailable'}
                          </small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="motif-cs-verification-empty-evidence" role="note">
                  No trace-backed DNA records are available besides the selected reference. Import Sanger evidence to run verification.
                </p>
              )}
            </div>
          </fieldset>

          <section className="motif-cs-verification-form-section" aria-labelledby={`${criteriaId}-acceptance`}>
            <div className="motif-cs-verification-section-index" aria-hidden="true">03</div>
            <div className="motif-cs-verification-section-content">
              <div className="motif-cs-verification-acceptance-heading">
                <strong id={`${criteriaId}-acceptance`}>Full-reference acceptance</strong>
                <span>Every reference base is required</span>
              </div>
              <div className="motif-cs-verification-criteria-grid">
                <label className="motif-cs-verification-field">
                  <span>Minimum read depth</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={MIN_DEPTH}
                    max={MAX_DEPTH}
                    value={form.minDepth}
                    onChange={(event) => updateMinimumDepth(Number(event.target.value))}
                  />
                </label>
                <label className="motif-cs-verification-strand-toggle">
                  <input
                    type="checkbox"
                    checked={form.requireBothStrands}
                    onChange={(event) => updateStrandRequirement(event.target.checked)}
                  />
                  <span>
                    <strong>Require both strands</strong>
                    <small>Forward and reverse evidence at every required base</small>
                  </span>
                </label>
              </div>
            </div>
          </section>

          <div className="motif-cs-verification-action-bar">
            <div className="motif-cs-verification-messages" aria-live="polite">
              {errorMessage ? (
                <p className="motif-cs-verification-error" role="alert" data-testid="construct-verification-error">
                  {errorMessage}
                </p>
              ) : statusMessage ? (
                <p className="motif-cs-verification-status" role="status" data-testid="construct-verification-status">
                  {statusMessage}
                </p>
              ) : (
                <p>Run explicitly after reviewing the evidence and criteria.</p>
              )}
            </div>
            <div className="motif-cs-verification-buttons">
              <button
                className="motif-cs-verification-secondary-button"
                type="button"
                onClick={saveVerification}
                disabled={!completedRun || saved}
                data-testid="construct-verification-save"
              >{saved ? 'Saved' : 'Save verification'}</button>
              <button
                className="motif-cs-verification-primary-button"
                type="submit"
                disabled={runDisabled}
                data-testid="construct-verification-run"
              >Run verification</button>
            </div>
          </div>
        </form>

        <main className="motif-cs-verification-output" aria-label="Construct verification evidence result">
          {completedRun ? (
            <ClaudeScienceConstructVerificationPanel
              result={completedRun.result}
              referenceName={completedRun.result.reference.name ?? reference?.name}
              readNames={resultReadNames}
            />
          ) : (
            <div className="motif-cs-verification-awaiting" data-testid="construct-verification-awaiting">
              <span aria-hidden="true">OBSERVED / PREDICTED</span>
              <strong>Evidence has not been evaluated</strong>
              <p>Select trace-backed records and run verification. Motif will retain the complete result locally for review, then save only on explicit confirmation.</p>
              <dl>
                <div><dt>Reference</dt><dd>{reference?.name ?? 'Not selected'}</dd></div>
                <div><dt>Sanger reads</dt><dd>{selectedCount.toLocaleString()}</dd></div>
                <div><dt>Required depth</dt><dd>{form.minDepth.toLocaleString()}×</dd></div>
                <div><dt>Strands</dt><dd>{form.requireBothStrands ? 'Forward + reverse' : 'Either accepted'}</dd></div>
              </dl>
            </div>
          )}
        </main>
      </div>
    </section>
  );

  if (embedded) return workspace;
  return (
    <div
      className="motif-cs-verification-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      {workspace}
    </div>
  );
}

export default ClaudeScienceConstructVerificationWorkspace;
