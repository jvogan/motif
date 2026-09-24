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
import {
  constructVariantTraceReadIds,
  constructVerificationTraceTarget,
  type ConstructVerificationTraceTarget,
  type ConstructVerificationTraceVariant,
} from './claude-science-construct-verification-traces';
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
  /** Inventory group; reads in the reference's group are the default evidence. */
  group?: string;
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

/**
 * An unsaved (or just-saved) run, kept by the host while the window is closed.
 * Opening Alignment closes this window, and the run used to live only in its
 * component state, so it was lost without a word. The draft is tied to the
 * records it was made from and is dropped if any of them changed meanwhile.
 */
export type ClaudeScienceConstructVerificationDraft = Readonly<{
  recordSignature: string;
  form: Readonly<{
    referenceId: string;
    selectedReadIds: readonly string[];
    minDepth: number;
    requireBothStrands: boolean;
  }>;
  completedRun: Readonly<{
    result: ClaudeScienceConstructVerificationResult;
    snapshot: ClaudeScienceConstructVerificationSnapshot;
  }> | null;
  saved: boolean;
}>;

export type ClaudeScienceConstructVerificationWorkspaceProps = {
  records: readonly ClaudeScienceConstructVerificationRecord[];
  initialReferenceId?: string;
  /** Runs synchronously against bounded inputs; the large result stays local until Save. */
  onVerify: (request: ClaudeScienceConstructVerificationRequest) => ClaudeScienceConstructVerificationResult;
  onSave: (payload: ClaudeScienceConstructVerificationSavePayload) => void;
  onClose?: () => void;
  embedded?: boolean;
  /** Imports files through the workbench's own importer; offered when no read is available. */
  onImportReads?: (files: FileList | File[]) => unknown;
  /** Returns the draft the host kept from the last time this window was open. Read once, at mount. */
  loadDraft?: () => ClaudeScienceConstructVerificationDraft | null;
  /** Receives the current run and settings whenever they change, for the host to keep. */
  onDraftChange?: (draft: ClaudeScienceConstructVerificationDraft) => void;
  /**
   * Opens a variant's reads in Alignment's Traces view: receives the alignment
   * to show (built from the run's own read map), the variant's column and the
   * read to show first. Without it the variant rows are plain text.
   */
  onInspectVariant?: (target: ConstructVerificationTraceTarget) => void;
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

function normalizedGroup(record: ClaudeScienceConstructVerificationRecord | undefined): string {
  return record?.group?.trim().toLocaleLowerCase() ?? '';
}

/**
 * The reads a run starts with: those in the reference's inventory group (no
 * group counts as a group of its own). Selecting every trace in the workspace
 * pooled unrelated clones: a reference plus two clones' reads in separate
 * groups defaulted to "4 of 4" and came back Inconsistent on the mixture.
 */
function defaultConstructVerificationReadIds(
  records: readonly ClaudeScienceConstructVerificationRecord[],
  referenceId: string,
): string[] {
  const group = normalizedGroup(records.find((record) => record.id === referenceId));
  return eligibleReadRecords(records, referenceId)
    .filter((record) => normalizedGroup(record) === group)
    .slice(0, MAX_SELECTED_READS)
    .map((record) => record.id);
}

function initialFormState(
  records: readonly ClaudeScienceConstructVerificationRecord[],
  initialReferenceId: string | undefined,
): VerificationFormState {
  const referenceId = preferredReferenceId(records, initialReferenceId);
  return {
    referenceId,
    selectedReadIds: defaultConstructVerificationReadIds(records, referenceId),
    minDepth: MIN_DEPTH,
    requireBothStrands: false,
  };
}

type ReadGroup = {
  key: string;
  label: string;
  reads: ClaudeScienceConstructVerificationReadRecord[];
};

/** The reference's own group first, then the others by name, ungrouped reads last. */
function groupReads(
  reads: readonly ClaudeScienceConstructVerificationReadRecord[],
  reference: ClaudeScienceConstructVerificationRecord | undefined,
): ReadGroup[] {
  const groups = new Map<string, ReadGroup>();
  for (const read of reads) {
    const key = normalizedGroup(read);
    const group = groups.get(key) ?? { key, label: read.group?.trim() || 'No group', reads: [] };
    group.reads.push(read);
    groups.set(key, group);
  }
  const referenceKey = normalizedGroup(reference);
  return [...groups.values()].sort((left, right) => (
    Number(right.key === referenceKey) - Number(left.key === referenceKey)
    || Number(left.key === '') - Number(right.key === '')
    || left.label.localeCompare(right.label)
  ));
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
  onImportReads,
  loadDraft,
  onDraftChange,
  onInspectVariant,
}: ClaudeScienceConstructVerificationWorkspaceProps) {
  const titleId = useId();
  const criteriaId = useId();
  const workspaceRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLSelectElement>(null);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const importInputRef = useRef<HTMLInputElement>(null);
  const importPendingRef = useRef(false);
  const knownReadIdsRef = useRef(new Set(records.filter(isTraceBacked).map((record) => record.id)));
  const recordSignature = useMemo(() => recordsSignature(records), [records]);
  // Read once: a draft made from the same records comes back whole; one made
  // from records that have since changed is dropped, and the reader is told.
  const [restore] = useState(() => {
    const draft = loadDraft?.() ?? null;
    if (!draft) return { draft: null, discarded: false };
    return draft.recordSignature === recordsSignature(records)
      ? { draft, discarded: false }
      : { draft: null, discarded: draft.completedRun !== null };
  });
  const [form, setForm] = useState<VerificationFormState>(() => (
    restore.draft
      ? { ...restore.draft.form, selectedReadIds: [...restore.draft.form.selectedReadIds] }
      : initialFormState(records, initialReferenceId)
  ));
  const [completedRun, setCompletedRun] = useState<CompletedRun | null>(() => restore.draft?.completedRun ?? null);
  const [saved, setSaved] = useState(() => restore.draft?.saved ?? false);
  const [statusMessage, setStatusMessage] = useState(() => {
    if (restore.discarded) return 'Your earlier run was discarded because its records changed. Run verification again.';
    if (!restore.draft?.completedRun) return '';
    return restore.draft.saved
      ? 'Showing your last run, already saved to Results.'
      : 'Your unsaved run is restored. Review it, then save it to keep it in Results.';
  });
  const appliedSignatureRef = useRef(recordSignature);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
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
    onDraftChangeRef.current?.({ recordSignature, form, completedRun, saved });
  }, [completedRun, form, recordSignature, saved]);

  useEffect(() => {
    // Only a real change of records invalidates the form and the run; the
    // records the window opened with (or restored a draft for) do not.
    if (appliedSignatureRef.current === recordSignature) return;
    appliedSignatureRef.current = recordSignature;
    const currentRecords = recordsRef.current;
    const knownReadIds = knownReadIdsRef.current;
    const importedReadIds = importPendingRef.current
      ? currentRecords.filter((record) => isTraceBacked(record) && !knownReadIds.has(record.id)).map((record) => record.id)
      : [];
    if (importedReadIds.length) importPendingRef.current = false;
    knownReadIdsRef.current = new Set(currentRecords.filter(isTraceBacked).map((record) => record.id));
    setForm((current) => {
      const referenceStillExists = currentRecords.some((record) => (
        record.id === current.referenceId && !isTraceBacked(record)
      ));
      const referenceId = referenceStillExists
        ? current.referenceId
        : preferredReferenceId(currentRecords, undefined);
      const nextEligibleReads = eligibleReadRecords(currentRecords, referenceId);
      const validReadIds = new Set(nextEligibleReads.map((record) => record.id));
      // Reads imported from this workspace join the selection: that is what
      // the reader imported them for, whatever group the importer gave them.
      const selectedReadIds = referenceStillExists
        ? [...new Set([...current.selectedReadIds, ...importedReadIds])]
          .filter((id) => validReadIds.has(id))
          .slice(0, MAX_SELECTED_READS)
        : defaultConstructVerificationReadIds(currentRecords, referenceId);
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
      selectedReadIds: defaultConstructVerificationReadIds(records, referenceId),
    }));
    clearCompletedRun();
  };

  const selectReadGroup = (group: ReadGroup) => {
    setForm((current) => {
      const selected = new Set(current.selectedReadIds);
      for (const read of group.reads) {
        if (selected.size >= MAX_SELECTED_READS) break;
        selected.add(read.id);
      }
      return {
        ...current,
        selectedReadIds: eligibleReads.filter((record) => selected.has(record.id)).map((record) => record.id),
      };
    });
    clearCompletedRun();
  };

  const importReads = (files: FileList | null) => {
    if (!files?.length || !onImportReads) return;
    importPendingRef.current = true;
    void onImportReads(files);
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
      setErrorMessage(boundedErrorMessage(`Verification not saved. ${boundedErrorMessage(error)}`));
    }
  };

  const reference = recordById.get(form.referenceId);
  const selectedCount = selectedReads.length;
  const defaultSelectedReadIds = eligibleReads.slice(0, MAX_SELECTED_READS).map((record) => record.id);
  const allReadsSelected = defaultSelectedReadIds.length > 0
    && defaultSelectedReadIds.length === selectedCount
    && defaultSelectedReadIds.every((id) => selectedReadIdSet.has(id));
  const readSelectionAtLimit = selectedCount >= MAX_SELECTED_READS;
  const readGroups = groupReads(eligibleReads, reference);
  const showReadGroups = readGroups.length > 1 || (readGroups[0] !== undefined && readGroups[0].key !== '');
  const referenceGroupLabel = reference?.group?.trim();
  const runDisabled = !reference || isTraceBacked(reference) || eligibleReads.length === 0 || selectedCount === 0;
  const resultReadNames = useMemo(
    () => Object.fromEntries(records.map((record) => [record.id, record.name])),
    [records],
  );
  const completedResult = completedRun?.result ?? null;
  const canInspectVariant = useCallback((variant: ConstructVerificationTraceVariant) => (
    completedResult !== null && constructVariantTraceReadIds(completedResult, variant).length > 0
  ), [completedResult]);
  const inspectVariant = useCallback((variant: ConstructVerificationTraceVariant) => {
    if (!completedResult || !onInspectVariant) return;
    const runReference = recordById.get(completedResult.reference.id);
    setErrorMessage('');
    try {
      const target = runReference
        ? constructVerificationTraceTarget({ result: completedResult, variant, reference: runReference, records: recordById })
        : null;
      if (!target) {
        setErrorMessage('The reads that cover this position could not be laid out against the reference, so Traces cannot open here.');
        return;
      }
      onInspectVariant(target);
    } catch (error) {
      setErrorMessage(boundedErrorMessage(error));
    }
  }, [completedResult, onInspectVariant, recordById]);

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
                  {onImportReads && eligibleReads.length ? (
                    <button type="button" data-testid="construct-verification-import-more" onClick={() => importInputRef.current?.click()}>Import…</button>
                  ) : null}
                </div>
              </div>
              {onImportReads ? (
                <input
                  ref={importInputRef}
                  className="motif-cs-verification-sr-only"
                  type="file"
                  multiple
                  accept=".ab1,.abi"
                  tabIndex={-1}
                  aria-hidden="true"
                  data-testid="construct-verification-import-input"
                  onChange={(event) => {
                    importReads(event.target.files);
                    event.target.value = '';
                  }}
                />
              ) : null}
              {showReadGroups && eligibleReads.length ? (
                <p className="motif-cs-verification-read-default" data-testid="construct-verification-read-default">
                  {referenceGroupLabel
                    ? `Reads in “${referenceGroupLabel}”, the reference's group, start selected.`
                    : 'Reads without a group, like the reference, start selected.'}
                </p>
              ) : null}

              {eligibleReads.length ? (
                <div
                  className="motif-cs-verification-read-list"
                  data-testid="construct-verification-read-list"
                  aria-label="Available imported Sanger reads"
                >
                  {readGroups.map((group) => (
                    <div key={group.key || 'ungrouped'} className="motif-cs-verification-read-group" role="group" aria-label={`${group.label}: ${group.reads.length.toLocaleString()} read${group.reads.length === 1 ? '' : 's'}`}>
                      {showReadGroups ? (
                        <div className="motif-cs-verification-read-group-heading">
                          <span>{group.label} · {group.reads.length.toLocaleString()}</span>
                          <button
                            type="button"
                            onClick={() => selectReadGroup(group)}
                            disabled={group.reads.every((read) => selectedReadIdSet.has(read.id)) || readSelectionAtLimit}
                            aria-label={`Select the reads in ${group.label}`}
                          >Select group</button>
                        </div>
                      ) : null}
                      {group.reads.map((read) => {
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
                  ))}
                </div>
              ) : (
                <div className="motif-cs-verification-empty-evidence" role="note">
                  <p>No trace-backed DNA records are available besides the selected reference. Import Sanger evidence to run verification.</p>
                  {onImportReads ? (
                    <button
                      type="button"
                      className="motif-cs-verification-import-button"
                      data-testid="construct-verification-import"
                      onClick={() => importInputRef.current?.click()}
                    >Import AB1 reads…</button>
                  ) : null}
                </div>
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
              onInspectVariant={onInspectVariant ? inspectVariant : undefined}
              canInspectVariant={canInspectVariant}
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
