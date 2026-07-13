import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { Topology } from '../bio/types';
import {
  createArtifactAssemblyArtifacts,
  MAX_ARTIFACT_ASSEMBLY_PARTS,
  planArtifactGoldenGateAssembly,
  planArtifactLigation,
  type ArtifactAssemblyArtifacts,
  type ArtifactAssemblyEndType,
  type ArtifactAssemblyPlan,
  type ArtifactGoldenGateJunction,
  type ArtifactGoldenGatePartInput,
  type ArtifactLigationJunction,
  type ArtifactLigationPartInput,
} from './claude-science-assembly-workflows';

export type ClaudeScienceAssemblyMode = 'golden_gate' | 'ligation';

export type ClaudeScienceAssemblyRecord = {
  id: string;
  name: string;
  sequence: string;
  molecule: 'dna';
  topology?: Topology;
  sha256?: string;
  /** Absent means unknown; an empty string is an explicitly blunt end. */
  overhang5?: string;
  /** Absent means unknown; an empty string is an explicitly blunt end. */
  overhang3?: string;
  overhang5Type?: ArtifactAssemblyEndType;
  overhang3Type?: ArtifactAssemblyEndType;
};

export type ClaudeScienceAssemblySavePayload = ArtifactAssemblyArtifacts & {
  plan: ArtifactAssemblyPlan;
  intent: 'product' | 'result';
};

export type ClaudeScienceAssemblyWorkspaceProps = {
  records: readonly ClaudeScienceAssemblyRecord[];
  onClose: () => void;
  /** Persist the workflow result and optional derived record in one transaction. */
  onSave: (payload: ClaudeScienceAssemblySavePayload) => void | Promise<void>;
  initialMode?: ClaudeScienceAssemblyMode;
  initialRecordIds?: readonly string[];
  createId?: () => string;
  now?: () => string;
  /** Hide the modal title bar and focus trap when hosted in the artifact's draggable window. */
  embedded?: boolean;
};

type OrderedPart = { key: string; recordId: string };

const TYPE_IIS_ENZYMES = ['BsaI', 'BbsI', 'BsmBI', 'Esp3I', 'SapI', 'BspQI'] as const;
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function defaultCreateId(): string {
  return crypto.randomUUID();
}

function defaultNow(): string {
  return new Date().toISOString();
}

function initialParts(
  records: readonly ClaudeScienceAssemblyRecord[],
  ids: readonly string[] | undefined,
  createId: () => string,
): OrderedPart[] {
  const available = new Set(records.map((record) => record.id));
  const preferred = ids?.filter((id) => available.has(id)) ?? records.slice(0, 2).map((record) => record.id);
  return preferred.slice(0, MAX_ARTIFACT_ASSEMBLY_PARTS).map((recordId) => ({ key: createId(), recordId }));
}

function endLabel(sequence: string | undefined, type: ArtifactAssemblyEndType | undefined): string {
  if (sequence === undefined) return 'Unknown';
  if (sequence.length === 0) return 'Blunt';
  if (type === '5prime') return `5′ ${sequence.toUpperCase()}`;
  if (type === '3prime') return `3′ ${sequence.toUpperCase()}`;
  return `${sequence.toUpperCase()} · polarity needed`;
}

function junctionEndLabel(junction: ArtifactGoldenGateJunction | ArtifactLigationJunction, side: 'left' | 'right'): string {
  if ('leftOverhang' in junction) {
    const value = side === 'left' ? junction.leftOverhang : junction.rightOverhang;
    return value ?? '—';
  }
  const value = side === 'left' ? junction.leftEnd : junction.rightEnd;
  if (value.type === 'blunt') return 'Blunt';
  return `${value.type === '5prime' ? '5′' : '3′'} ${value.sequence}`;
}

function planSummary(plan: ArtifactAssemblyPlan): string {
  if (plan.status === 'ready' && plan.productSequence) {
    return `${plan.inputRecordIds.length} parts · ${plan.junctions.length} junction${plan.junctions.length === 1 ? '' : 's'} · ${plan.productSequence.length.toLocaleString()} bp ${plan.kind === 'ligation' ? 'intended product' : 'product'}`;
  }
  return `${plan.inputRecordIds.length} valid part${plan.inputRecordIds.length === 1 ? '' : 's'} · ${plan.errors.length} blocking issue${plan.errors.length === 1 ? '' : 's'}`;
}

function modeLabel(mode: ClaudeScienceAssemblyMode): string {
  return mode === 'golden_gate' ? 'Golden Gate' : 'Traditional ligation';
}

function compactFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function ClaudeScienceAssemblyWorkspace({
  records,
  onClose,
  onSave,
  initialMode = 'golden_gate',
  initialRecordIds,
  createId = defaultCreateId,
  now = defaultNow,
  embedded = false,
}: ClaudeScienceAssemblyWorkspaceProps) {
  const titleId = useId();
  const tabPanelId = useId();
  const partInstructionsId = useId();
  const workspaceRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const createIdRef = useRef(createId);
  const [mode, setMode] = useState<ClaudeScienceAssemblyMode>(initialMode);
  const [orderedParts, setOrderedParts] = useState<OrderedPart[]>(() => (
    initialParts(records, initialRecordIds, createIdRef.current)
  ));
  const [candidateRecordId, setCandidateRecordId] = useState(records[0]?.id ?? '');
  const [enzyme, setEnzyme] = useState<(typeof TYPE_IIS_ENZYMES)[number]>('BsaI');
  const [topologies, setTopologies] = useState<Record<ClaudeScienceAssemblyMode, Topology>>({
    golden_gate: 'circular',
    ligation: 'linear',
  });
  const [productNames, setProductNames] = useState<Record<ClaudeScienceAssemblyMode, string>>({
    golden_gate: 'Golden Gate product',
    ligation: 'Ligation product',
  });
  const [status, setStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [savingIntent, setSavingIntent] = useState<'product' | 'result' | null>(null);
  const [savedSignatures, setSavedSignatures] = useState<ReadonlySet<string>>(() => new Set());
  const saving = savingIntent !== null;

  useEffect(() => {
    if (embedded) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [embedded]);

  useEffect(() => {
    const available = new Set(records.map((record) => record.id));
    setOrderedParts((current) => current.filter((part) => available.has(part.recordId)));
    setCandidateRecordId((current) => (available.has(current) ? current : records[0]?.id ?? ''));
  }, [records]);

  useEffect(() => {
    if (embedded) return undefined;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || saving) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [embedded, onClose, saving]);

  const recordsById = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const selectedRecords = useMemo(() => orderedParts.flatMap((part) => {
    const record = recordsById.get(part.recordId);
    return record ? [record] : [];
  }), [orderedParts, recordsById]);
  const topology = topologies[mode];

  const plan = useMemo<ArtifactAssemblyPlan>(() => {
    if (mode === 'golden_gate') {
      const parts: ArtifactGoldenGatePartInput[] = selectedRecords.map((record) => ({
        recordId: record.id,
        name: record.name,
        sequence: record.sequence,
        molecule: 'dna',
        ...(record.topology === undefined ? {} : { sourceTopology: record.topology }),
        ...(record.sha256 === undefined ? {} : { sha256: record.sha256 }),
      }));
      return planArtifactGoldenGateAssembly({ parts, enzyme, topology });
    }
    const parts: ArtifactLigationPartInput[] = selectedRecords.map((record) => ({
      recordId: record.id,
      name: record.name,
      sequence: record.sequence,
      molecule: 'dna',
      ...(record.sha256 === undefined ? {} : { sha256: record.sha256 }),
      ...(record.overhang5 === undefined ? {} : { overhang5: record.overhang5 }),
      ...(record.overhang3 === undefined ? {} : { overhang3: record.overhang3 }),
      ...(record.overhang5Type === undefined ? {} : { overhang5Type: record.overhang5Type }),
      ...(record.overhang3Type === undefined ? {} : { overhang3Type: record.overhang3Type }),
    }));
    return planArtifactLigation({ parts, topology });
  }, [enzyme, mode, selectedRecords, topology]);

  const planFingerprint = useMemo(() => compactFingerprint(JSON.stringify({
    mode,
    enzyme: mode === 'golden_gate' ? enzyme : null,
    topology,
    parts: selectedRecords.map((record) => ({
      id: record.id,
      sequence: record.sha256 ?? compactFingerprint(record.sequence),
      overhang5: record.overhang5,
      overhang3: record.overhang3,
      overhang5Type: record.overhang5Type,
      overhang3Type: record.overhang3Type,
    })),
    status: plan.status,
  })), [enzyme, mode, plan.status, selectedRecords, topology]);
  const resultSaveSignature = `${planFingerprint}:result:${productNames[mode].trim()}`;
  const productSaveSignature = `${planFingerprint}:product:${productNames[mode].trim()}`;
  const resultSaved = savedSignatures.has(resultSaveSignature);
  const productSaved = savedSignatures.has(productSaveSignature);

  const movePart = useCallback((index: number, offset: -1 | 1) => {
    const destination = index + offset;
    if (destination < 0 || destination >= orderedParts.length) return;
    const movedRecord = recordsById.get(orderedParts[index]?.recordId ?? '');
    setOrderedParts((current) => {
      if (index >= current.length || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setStatus(`${movedRecord?.name ?? 'Part'} moved to position ${destination + 1}.`);
  }, [orderedParts, recordsById]);

  const removePart = useCallback((key: string) => {
    const removed = recordsById.get(orderedParts.find((part) => part.key === key)?.recordId ?? '');
    setOrderedParts((current) => current.filter((part) => part.key !== key));
    setStatus(`${removed?.name ?? 'Part'} removed from the assembly.`);
  }, [orderedParts, recordsById]);

  const addPart = useCallback(() => {
    if (!candidateRecordId || !recordsById.has(candidateRecordId) || orderedParts.length >= MAX_ARTIFACT_ASSEMBLY_PARTS) return;
    setOrderedParts((current) => [...current, { key: createIdRef.current(), recordId: candidateRecordId }]);
    setStatus(`${recordsById.get(candidateRecordId)?.name ?? 'Part'} added at position ${orderedParts.length + 1}.`);
  }, [candidateRecordId, orderedParts.length, recordsById]);

  const changePart = useCallback((key: string, recordId: string) => {
    setOrderedParts((current) => current.map((part) => (part.key === key ? { ...part, recordId } : part)));
    setStatus(`Position updated to ${recordsById.get(recordId)?.name ?? 'the selected record'}.`);
  }, [recordsById]);

  const handlePartKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    movePart(index, event.key === 'ArrowUp' ? -1 : 1);
  }, [movePart]);

  const handleWorkspaceKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = [...(workspaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])]
      .filter((element) => element.getAttribute('aria-hidden') !== 'true');
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  const save = useCallback(async (intent: 'product' | 'result') => {
    if (saving) return;
    const productName = productNames[mode].trim();
    if (intent === 'product' && (!productName || plan.status !== 'ready')) return;
    const signature = intent === 'product' ? productSaveSignature : resultSaveSignature;
    if (savedSignatures.has(signature)) return;
    setSavingIntent(intent);
    setSaveError('');
    setStatus('');
    try {
      const id = createIdRef.current();
      const label = productName || `${modeLabel(mode)} plan`;
      const artifacts = createArtifactAssemblyArtifacts(plan, {
        workflowResultId: `assembly-${id}`,
        createdAt: now(),
        name: intent === 'product' ? label : `${label} · ${plan.status} result`,
        provenance: {
          source: 'motif-for-claude-science-artifact',
          operation: plan.kind,
          engine: 'cloning-workspace',
          engineVersion: '1',
        },
        ...(intent === 'product' ? {
          outputRecord: {
            id: `assembly-product-${id}`,
            name: productName,
            description: `${modeLabel(mode)} product from ${selectedRecords.length} ordered parts.`,
            group: 'Assembly products',
            tags: [plan.kind, 'assembly-product'],
          },
        } : {}),
      });
      await onSave({ ...artifacts, plan, intent });
      setSavedSignatures((current) => new Set(current).add(signature));
      setStatus(intent === 'product' ? `${productName} saved with its workflow result.` : `${modeLabel(mode)} result saved.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The assembly result could not be saved.');
    } finally {
      setSavingIntent(null);
    }
  }, [mode, now, onSave, plan, productNames, productSaveSignature, resultSaveSignature, savedSignatures, saving, selectedRecords.length]);

  const goldenGateParts = plan.kind === 'golden_gate' ? plan.parts : [];
  const domesticationNames = plan.kind === 'golden_gate'
    ? plan.domesticationRequiredRecordIds.map((id) => recordsById.get(id)?.name ?? id)
    : [];

  return (
    <div className="motif-cs-assembly-overlay" data-embedded={embedded || undefined} data-testid="assembly-workspace">
      <section
        ref={workspaceRef}
        className="motif-cs-assembly-workspace"
        role={embedded ? undefined : 'dialog'}
        aria-modal={embedded ? undefined : true}
        aria-labelledby={titleId}
        onKeyDown={embedded ? undefined : handleWorkspaceKeyDown}
      >
        {embedded ? null : <header className="motif-cs-assembly-header">
          <div>
            <span className="motif-cs-kicker">Cloning</span>
            <h2 id={titleId}>Assembly workspace</h2>
          </div>
          <button
            ref={closeRef}
            className="motif-cs-window-icon motif-cs-window-close"
            type="button"
            aria-label="Close assembly workspace"
            onClick={onClose}
            disabled={saving}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>}

        <div className="motif-cs-assembly-tabs" role="tablist" aria-label="Assembly method">
          <button
            id={`${tabPanelId}-golden-gate-tab`}
            type="button"
            role="tab"
            aria-selected={mode === 'golden_gate'}
            aria-controls={tabPanelId}
            data-active={mode === 'golden_gate' || undefined}
            data-testid="assembly-mode-golden-gate"
            onClick={() => setMode('golden_gate')}
          >
            Golden Gate
          </button>
          <button
            id={`${tabPanelId}-ligation-tab`}
            type="button"
            role="tab"
            aria-selected={mode === 'ligation'}
            aria-controls={tabPanelId}
            data-active={mode === 'ligation' || undefined}
            data-testid="assembly-mode-ligation"
            onClick={() => setMode('ligation')}
          >
            Traditional ligation
          </button>
        </div>

        <div
          id={tabPanelId}
          className="motif-cs-assembly-body"
          role="tabpanel"
          aria-labelledby={`${tabPanelId}-${mode === 'golden_gate' ? 'golden-gate' : 'ligation'}-tab`}
        >
          <div className="motif-cs-assembly-main">
            <section className="motif-cs-assembly-section" aria-labelledby={`${tabPanelId}-parts-heading`}>
              <div className="motif-cs-assembly-section-heading">
                <div>
                  <span className="motif-cs-kicker">Ordered inputs</span>
                  <h3 id={`${tabPanelId}-parts-heading`}>Parts</h3>
                </div>
                <span>{orderedParts.length} selected</span>
              </div>
              <p id={partInstructionsId} className="motif-cs-assembly-hint">
                Order defines the intended junctions. Use the arrow controls, or Alt+↑ and Alt+↓ on a row.
              </p>
              <div className="motif-cs-assembly-part-list" role="list" data-testid="assembly-part-list">
                {orderedParts.length === 0 ? (
                  <div className="motif-cs-assembly-empty">Add at least two DNA records to evaluate an assembly.</div>
                ) : orderedParts.map((part, index) => {
                  const record = recordsById.get(part.recordId);
                  const goldenGatePart = goldenGateParts[index];
                  if (!record) return null;
                  return (
                    <div
                      key={part.key}
                      className="motif-cs-assembly-part-row"
                      role="listitem"
                      aria-posinset={index + 1}
                      aria-setsize={orderedParts.length}
                      aria-describedby={partInstructionsId}
                      data-testid={`assembly-part-row-${index}`}
                      onKeyDown={(event) => handlePartKeyDown(event, index)}
                    >
                      <span className="motif-cs-assembly-part-index" aria-hidden="true">{index + 1}</span>
                      <label className="motif-cs-assembly-part-picker">
                        <span className="motif-cs-visually-hidden">Part {index + 1}</span>
                        <select
                          aria-label={`Part ${index + 1}`}
                          value={part.recordId}
                          onChange={(event) => changePart(part.key, event.target.value)}
                        >
                          {records.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                        </select>
                        <small>{record.sequence.length.toLocaleString()} bp</small>
                      </label>
                      {mode === 'ligation' ? (
                        <div className="motif-cs-assembly-end-pair" aria-label={`${record.name} end chemistry`}>
                          <span><small>Left</small>{endLabel(record.overhang5, record.overhang5Type)}</span>
                          <span><small>Right</small>{endLabel(record.overhang3, record.overhang3Type)}</span>
                        </div>
                      ) : (
                        <div className="motif-cs-assembly-end-pair" aria-label={`${record.name} Type IIS boundaries`}>
                          <span><small>Left fusion</small>{goldenGatePart?.leftOverhang ?? '—'}</span>
                          <span><small>Right fusion</small>{goldenGatePart?.rightOverhang ?? '—'}</span>
                        </div>
                      )}
                      <div className="motif-cs-assembly-part-actions" aria-label={`Reorder ${record.name}`}>
                        <button
                          type="button"
                          aria-label={`Move ${record.name} up`}
                          onClick={() => movePart(index, -1)}
                          disabled={index === 0}
                        >
                          <span aria-hidden="true">↑</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${record.name} down`}
                          onClick={() => movePart(index, 1)}
                          disabled={index === orderedParts.length - 1}
                        >
                          <span aria-hidden="true">↓</span>
                        </button>
                        <button type="button" aria-label={`Remove ${record.name}`} onClick={() => removePart(part.key)}>
                          <span aria-hidden="true">×</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="motif-cs-assembly-add-part">
                <label>
                  <span className="motif-cs-visually-hidden">Record to add</span>
                  <select
                    aria-label="Record to add"
                    value={candidateRecordId}
                    onChange={(event) => setCandidateRecordId(event.target.value)}
                    disabled={records.length === 0}
                    data-testid="assembly-add-record"
                  >
                    {records.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
                  </select>
                </label>
                <button
                  className="motif-cs-mini-button"
                  type="button"
                  onClick={addPart}
                  disabled={!candidateRecordId || orderedParts.length >= MAX_ARTIFACT_ASSEMBLY_PARTS}
                  data-testid="assembly-add-part"
                >
                  {orderedParts.length >= MAX_ARTIFACT_ASSEMBLY_PARTS ? `${MAX_ARTIFACT_ASSEMBLY_PARTS}-part limit` : 'Add part'}
                </button>
              </div>
            </section>

            <section className="motif-cs-assembly-section" aria-labelledby={`${tabPanelId}-junctions-heading`}>
              <div className="motif-cs-assembly-section-heading">
                <div>
                  <span className="motif-cs-kicker">Predicted chemistry</span>
                  <h3 id={`${tabPanelId}-junctions-heading`}>Junctions</h3>
                </div>
                <span>{plan.junctions.length}</span>
              </div>
              {plan.junctions.length === 0 ? (
                <div className="motif-cs-assembly-empty">Add a second part to inspect junction compatibility.</div>
              ) : (
                <div className="motif-cs-assembly-table-wrap">
                  <table className="motif-cs-assembly-junction-table" data-testid="assembly-junction-table">
                    <thead>
                      <tr><th>Junction</th><th>Left end</th><th>Right end</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {plan.junctions.map((junction, index) => {
                        const leftRecord = recordsById.get(junction.leftRecordId);
                        const rightRecord = recordsById.get(junction.rightRecordId);
                        const leftEnd = 'leftEnd' in junction && junction.type === 'not_evaluable'
                          ? endLabel(leftRecord?.overhang3, leftRecord?.overhang3Type)
                          : junctionEndLabel(junction, 'left');
                        const rightEnd = 'rightEnd' in junction && junction.type === 'not_evaluable'
                          ? endLabel(rightRecord?.overhang5, rightRecord?.overhang5Type)
                          : junctionEndLabel(junction, 'right');
                        return (
                          <tr key={`${junction.leftRecordId}-${junction.rightRecordId}-${index}`} data-state={junction.compatible ? 'ready' : 'blocked'}>
                            <th scope="row">
                              {leftRecord?.name ?? junction.leftRecordId}
                              {' → '}
                              {rightRecord?.name ?? junction.rightRecordId}
                              {junction.closing ? <small> closes circle</small> : null}
                            </th>
                            <td>{leftEnd}</td>
                            <td>{rightEnd}</td>
                            <td><span className="motif-cs-assembly-status-word">{junction.compatible ? 'Compatible' : 'Blocked'}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <aside className="motif-cs-assembly-sidebar" aria-label="Assembly settings and validation">
            <section className="motif-cs-assembly-settings">
              <span className="motif-cs-kicker">Settings</span>
              {mode === 'golden_gate' ? (
                <label className="motif-cs-assembly-field">
                  <span>Type IIS enzyme</span>
                  <select value={enzyme} onChange={(event) => setEnzyme(event.target.value as typeof enzyme)}>
                    {TYPE_IIS_ENZYMES.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>
              ) : null}
              <fieldset className="motif-cs-assembly-topology">
                <legend>Product topology</legend>
                <div className="motif-cs-segmented">
                  {(['linear', 'circular'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={topology === value}
                      data-active={topology === value || undefined}
                      onClick={() => setTopologies((current) => ({ ...current, [mode]: value }))}
                    >
                      {value === 'linear' ? 'Linear' : 'Circular'}
                    </button>
                  ))}
                </div>
              </fieldset>
              {mode === 'golden_gate' && plan.kind === 'golden_gate' && plan.enzyme ? (
                <p className="motif-cs-assembly-enzyme-detail">
                  {plan.enzyme.recognitionSequence} · {plan.enzyme.overhangLength}-base {plan.enzyme.overhangType === '5prime' ? '5′' : '3′'} overhang
                </p>
              ) : null}
            </section>

            <section className="motif-cs-assembly-validation" aria-labelledby={`${tabPanelId}-validation-heading`}>
              <div className="motif-cs-assembly-plan-state" data-state={plan.status} data-testid="assembly-plan-status">
                <span className="motif-cs-kicker">Validation</span>
                <strong id={`${tabPanelId}-validation-heading`}>
                  {plan.status === 'ready'
                    ? plan.kind === 'ligation' ? 'Ends support this order' : 'Ready to save'
                    : 'Needs attention'}
                </strong>
                <span>{planSummary(plan)}</span>
              </div>
              {domesticationNames.length > 0 ? (
                <div className="motif-cs-assembly-domestication" role="note">
                  <strong>Domestication required</strong>
                  <span>{domesticationNames.join(', ')} contain internal {enzyme} sites.</span>
                </div>
              ) : mode === 'golden_gate' && selectedRecords.length >= 2 ? (
                <div className="motif-cs-assembly-domestication" data-state="clear" role="note">
                  <strong>No internal-site conflicts</strong>
                  <span>Selected boundaries passed the {enzyme} site check.</span>
                </div>
              ) : null}
              {plan.errors.length > 0 ? (
                <div className="motif-cs-assembly-issues" data-level="error">
                  <strong>Blocking issues</strong>
                  <ul>{plan.errors.map((entry, index) => <li key={`${entry.code}-${index}`}>{entry.message}</li>)}</ul>
                </div>
              ) : null}
              {plan.warnings.length > 0 ? (
                <div className="motif-cs-assembly-issues" data-level="warning">
                  <strong>Warnings</strong>
                  <ul>{plan.warnings.map((entry, index) => <li key={`${entry.code}-${index}`}>{entry.message}</li>)}</ul>
                </div>
              ) : null}
            </section>
          </aside>
        </div>

        <footer className="motif-cs-assembly-footer">
          <div className="motif-cs-assembly-output-field">
            <label htmlFor={`${tabPanelId}-product-name`}>Product name</label>
            <input
              id={`${tabPanelId}-product-name`}
              value={productNames[mode]}
              maxLength={256}
              onChange={(event) => setProductNames((current) => ({ ...current, [mode]: event.target.value }))}
              disabled={saving}
            />
          </div>
          <div className="motif-cs-assembly-save-actions">
            <button
              className="motif-cs-mini-button"
              type="button"
              onClick={() => void save('result')}
              disabled={saving || resultSaved || orderedParts.length === 0}
              data-testid="assembly-save-result"
            >
              {savingIntent === 'result'
                ? 'Saving…'
                : resultSaved
                  ? 'Result saved'
                  : plan.status === 'blocked' ? 'Save blocked result' : 'Save result only'}
            </button>
            <button
              className="motif-cs-mini-button motif-cs-mini-button-accent"
              type="button"
              onClick={() => void save('product')}
              disabled={saving || productSaved || plan.status !== 'ready' || !productNames[mode].trim()}
              data-testid="assembly-save-product"
            >
              {savingIntent === 'product'
                ? 'Saving…'
                : productSaved
                  ? 'Saved'
                  : mode === 'ligation' ? 'Save ligation product' : 'Save product'}
            </button>
          </div>
          <p className="motif-cs-assembly-save-error" role="alert" data-empty={!saveError || undefined}>{saveError}</p>
          <p className="motif-cs-assembly-live-status" role="status" aria-live="polite" data-empty={!status || undefined}>{status}</p>
        </footer>
      </section>
    </div>
  );
}
