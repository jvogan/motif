import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  ENZYME_TAIL_PRESETS,
  designPrimerPairWithDiagnostics,
  primerToFeature,
  type PrimerCandidate,
  type PrimerDesignParams,
  type PrimerPair,
  type PrimerPairResult,
} from '../bio/primer-design';
import {
  predictHairpin,
  predictPrimerDimer,
  predictSelfDimer,
} from '../bio/primer-thermodynamics';
import type { Feature } from '../bio/types';
import './claude-science-primer-workspace.css';

export type ClaudeSciencePrimerIntent = 'pcr' | 'cloning' | 'verification';

export type ClaudeSciencePrimerRecord = {
  id: string;
  name: string;
  sequence: string;
  molecule: 'dna' | 'rna';
};

export type ClaudeSciencePrimerPreparationContext = {
  /** Short host-supplied description of the preparation step. */
  label: string;
  /** Optional host-supplied rationale or boundary detail. */
  detail?: string;
  /** Stable cloning-plan identity retained with the saved primer result. */
  requestSha256: string;
  actionId: string;
  actionKind: string;
  method: 'golden_gate' | 'gibson';
  orientation: 'forward' | 'reverse';
  enzyme?: string;
  fusionSites?: { left: string; right: string };
  junction?: {
    index: number;
    leftRecordId: string;
    rightRecordId: string;
    overlapSequence?: string;
    overlapLength?: number;
  };
};

export type ClaudeSciencePrimerHandoff = {
  recordId: string;
  recordName: string;
  intent: ClaudeSciencePrimerIntent;
  target: { start: number; end: number };
  pair: PrimerPair;
  pairNumber: number;
  parameters: PrimerDesignParams;
  /** Present only when this result belongs to a reviewed cloning-plan action. */
  preparationContext?: ClaudeSciencePrimerPreparationContext;
};

export type ClaudeSciencePrimerExport = ClaudeSciencePrimerHandoff & {
  filename: string;
  format: 'fasta';
  text: string;
};

export type ClaudeSciencePrimerWorkspaceProps = {
  record: ClaudeSciencePrimerRecord;
  selectedRange?: { start: number; end: number } | null;
  onClose: () => void;
  onSelectRange?: (start: number, end: number) => void;
  onCopy?: (label: string, value: string) => void | Promise<void>;
  onExport?: (payload: ClaudeSciencePrimerExport) => void | Promise<void>;
  onSaveDesign?: (handoff: ClaudeSciencePrimerHandoff) => void | Promise<void>;
  onAddAnnotations?: (features: readonly Feature[], handoff: ClaudeSciencePrimerHandoff) => void | Promise<void>;
  onSimulatePcr?: (handoff: ClaudeSciencePrimerHandoff) => void | Promise<void>;
  /** Creates an exact linear amplicon record; distinct from result-only simulation. */
  onCreateAmplicon?: (handoff: ClaudeSciencePrimerHandoff) => void | Promise<void>;
  onUseForCloning?: (handoff: ClaudeSciencePrimerHandoff) => void | Promise<void>;
  initialIntent?: ClaudeSciencePrimerIntent;
  /** Verified preparation context supplied by the owning cloning workflow. */
  preparationContext?: ClaudeSciencePrimerPreparationContext | null;
  preparationProgress?: { current: number; total: number; completed: number; remaining: number } | null;
  onPreviousPreparation?: () => void;
  onNextPreparation?: () => void;
  /** Optional verified 5′ tails. The scientist can still edit them before saving. */
  initialForwardTail?: string;
  initialReverseTail?: string;
  /** Removes modal behavior when the workspace is hosted by the artifact window manager. */
  embedded?: boolean;
};

type PrimerPreset = {
  id: string;
  name: string;
  note: string;
  intent: ClaudeSciencePrimerIntent;
  minLength: number;
  maxLength: number;
  targetTm: number;
  tmTolerance: number;
  minGC: number;
  maxGC: number;
  flankingWindow: number;
};

const PRESETS: readonly PrimerPreset[] = [
  {
    id: 'standard',
    name: 'Standard PCR',
    note: 'Balanced defaults for routine amplification',
    intent: 'pcr',
    minLength: 18,
    maxLength: 28,
    targetTm: 60,
    tmTolerance: 5,
    minGC: 30,
    maxGC: 70,
    flankingWindow: 50,
  },
  {
    id: 'colony',
    name: 'Colony PCR',
    note: 'Compact primers for fast screening',
    intent: 'verification',
    minLength: 18,
    maxLength: 24,
    targetTm: 58,
    tmTolerance: 5,
    minGC: 30,
    maxGC: 70,
    flankingWindow: 30,
  },
  {
    id: 'cloning',
    name: 'Cloning',
    note: 'Longer binding regions with room for 5′ tails',
    intent: 'cloning',
    minLength: 20,
    maxLength: 32,
    targetTm: 62,
    tmTolerance: 4,
    minGC: 30,
    maxGC: 70,
    flankingWindow: 75,
  },
  {
    id: 'touchdown',
    name: 'Touchdown',
    note: 'Tighter, higher-Tm specificity window',
    intent: 'pcr',
    minLength: 22,
    maxLength: 30,
    targetTm: 65,
    tmTolerance: 3,
    minGC: 40,
    maxGC: 70,
    flankingWindow: 50,
  },
] as const;

const MAX_VISIBLE_PAIRS = 10;
const FOCUSABLE = [
  'button:not([disabled])',
  'select:not([disabled])',
  'input:not([disabled])',
  'summary',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function initialPresetForIntent(intent: ClaudeSciencePrimerIntent): PrimerPreset {
  if (intent === 'cloning') return PRESETS.find((preset) => preset.id === 'cloning') ?? PRESETS[0];
  if (intent === 'verification') return PRESETS.find((preset) => preset.id === 'colony') ?? PRESETS[0];
  return PRESETS[0];
}

function normalizeInitialTail(value: string | undefined): string {
  return (value ?? '').toUpperCase().replace(/[^A-Z]/g, '');
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function defaultTarget(
  sequenceLength: number,
  selectedRange?: { start: number; end: number } | null,
  preferFullRecord = false,
) {
  if (preferFullRecord) return { start: 1, end: sequenceLength };
  if (selectedRange && selectedRange.start >= 0 && selectedRange.end > selectedRange.start && selectedRange.end <= sequenceLength) {
    return { start: selectedRange.start + 1, end: selectedRange.end };
  }
  const flank = 50;
  const hasFlanks = sequenceLength > flank * 2 + 60;
  const start = hasFlanks ? flank + 1 : 1;
  const end = hasFlanks ? Math.min(start + 499, sequenceLength - flank) : sequenceLength;
  return { start, end: Math.max(start, end) };
}

function fastaForPair(recordName: string, pair: PrimerPair, pairNumber: number): string {
  const safeName = recordName.trim().replace(/\s+/g, '_') || 'sequence';
  return [
    `>${safeName}_pair_${pairNumber}_forward`,
    pair.forward.fullSequence,
    `>${safeName}_pair_${pairNumber}_reverse`,
    pair.reverse.fullSequence,
  ].join('\n');
}

function filenameFor(recordName: string): string {
  const safe = recordName.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'sequence';
  return `${safe}-primers.fasta`;
}

function diagnosticMessage(result: PrimerPairResult): string {
  if (result.forwardCount > 0 && result.reverseCount > 0) {
    const reasons: string[] = [];
    if (result.rejections.tmDiff > 0) reasons.push(`${result.rejections.tmDiff.toLocaleString()} pairings exceeded ΔTm 5 °C`);
    if (result.rejections.productLength > 0) reasons.push(`${result.rejections.productLength.toLocaleString()} produced no amplicon`);
    return reasons.length > 0
      ? `${result.forwardCount} forward and ${result.reverseCount} reverse candidates were found, but ${reasons.join(' and ')}.`
      : 'Forward and reverse candidates were found, but none formed a valid pair.';
  }

  const reasons: string[] = [];
  if (result.rejections.gc > 0) reasons.push(`${result.rejections.gc.toLocaleString()} GC`);
  if (result.rejections.tm > 0) reasons.push(`${result.rejections.tm.toLocaleString()} Tm`);
  if (result.rejections.clamp > 0) reasons.push(`${result.rejections.clamp.toLocaleString()} clamp`);
  if ((result.rejections.hairpin ?? 0) > 0) reasons.push(`${result.rejections.hairpin?.toLocaleString()} hairpin`);
  if ((result.rejections.dimer ?? 0) > 0) reasons.push(`${result.rejections.dimer?.toLocaleString()} self-dimer`);
  if (reasons.length > 0) return `No pair passed the current filters. Rejections: ${reasons.join(', ')}.`;
  if (result.rejections.invalid > 0) return 'No pair was found because candidate windows contain ambiguous bases.';
  return 'No pair fits this target. Widen the flank or move the target away from a sequence edge.';
}

function hasClamp(candidate: PrimerCandidate): boolean {
  return /[GC]/.test(candidate.sequence.slice(-5).toUpperCase());
}

function qualityState(deltaG: number, cutoff: number): 'pass' | 'review' {
  return deltaG < cutoff ? 'review' : 'pass';
}

function Metric({ label, value, state }: { label: string; value: string; state?: 'pass' | 'review' }) {
  return (
    <span className="motif-cs-primer-metric" data-state={state}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

export function ClaudeSciencePrimerWorkspace({
  record,
  selectedRange = null,
  onClose,
  onSelectRange,
  onCopy,
  onExport,
  onSaveDesign,
  onAddAnnotations,
  onSimulatePcr,
  onCreateAmplicon,
  onUseForCloning,
  initialIntent = 'pcr',
  preparationContext = null,
  preparationProgress = null,
  onPreviousPreparation,
  onNextPreparation,
  initialForwardTail,
  initialReverseTail,
  embedded = false,
}: ClaudeSciencePrimerWorkspaceProps) {
  const titleId = useId();
  const statusId = useId();
  const workspaceRef = useRef<HTMLElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const initialTarget = useMemo(
    () => defaultTarget(record.sequence.length, selectedRange, initialIntent === 'cloning'),
    [initialIntent, record.sequence.length, selectedRange],
  );
  const initialPreset = initialPresetForIntent(initialIntent);
  const [intent, setIntent] = useState<ClaudeSciencePrimerIntent>(initialIntent);
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [targetStart, setTargetStart] = useState(initialTarget.start);
  const [targetEnd, setTargetEnd] = useState(initialTarget.end);
  const [minLength, setMinLength] = useState(initialPreset.minLength);
  const [maxLength, setMaxLength] = useState(initialPreset.maxLength);
  const [targetTm, setTargetTm] = useState(initialPreset.targetTm);
  const [tmTolerance, setTmTolerance] = useState(initialPreset.tmTolerance);
  const [minGC, setMinGC] = useState(initialPreset.minGC);
  const [maxGC, setMaxGC] = useState(initialPreset.maxGC);
  const [flankingWindow, setFlankingWindow] = useState(initialPreset.flankingWindow);
  const [requireGcClamp, setRequireGcClamp] = useState(true);
  const [forwardTail, setForwardTail] = useState(() => normalizeInitialTail(initialForwardTail));
  const [reverseTail, setReverseTail] = useState(() => normalizeInitialTail(initialReverseTail));
  const [selectedPairIndex, setSelectedPairIndex] = useState(0);
  const [status, setStatus] = useState('');
  const [busyAction, setBusyAction] = useState('');

  useEffect(() => {
    setTargetStart(initialTarget.start);
    setTargetEnd(initialTarget.end);
    setSelectedPairIndex(0);
  }, [initialTarget.end, initialTarget.start, record.id]);

  useEffect(() => {
    const preset = initialPresetForIntent(initialIntent);
    setIntent(initialIntent);
    setPresetId(preset.id);
    setMinLength(preset.minLength);
    setMaxLength(preset.maxLength);
    setTargetTm(preset.targetTm);
    setTmTolerance(preset.tmTolerance);
    setMinGC(preset.minGC);
    setMaxGC(preset.maxGC);
    setFlankingWindow(preset.flankingWindow);
    setRequireGcClamp(true);
    setSelectedPairIndex(0);
    setStatus('');
  }, [initialIntent]);

  useEffect(() => {
    setForwardTail(normalizeInitialTail(initialForwardTail));
    setReverseTail(normalizeInitialTail(initialReverseTail));
    setSelectedPairIndex(0);
    setStatus('');
  }, [initialForwardTail, initialReverseTail, preparationContext?.actionId]);

  useEffect(() => {
    if (embedded) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [embedded]);

  useEffect(() => {
    if (embedded) return undefined;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !busyAction) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(workspaceRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
        .filter((element) => element.offsetParent !== null || element === document.activeElement);
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
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [busyAction, embedded, onClose]);

  const normalizedSequence = useMemo(
    () => record.sequence.toUpperCase().replace(/U/g, 'T').replace(/\s/g, ''),
    [record.sequence],
  );
  const validationMessage = useMemo(() => {
    if (normalizedSequence.length < 24) return 'The record is too short for paired primer design.';
    if (targetStart < 1 || targetEnd > normalizedSequence.length || targetEnd <= targetStart) {
      return `Use a non-wrapping target inside 1–${normalizedSequence.length.toLocaleString()}.`;
    }
    if (minLength < 12 || maxLength > 60 || minLength > maxLength) return 'Primer length must be 12–60 nt, with minimum no larger than maximum.';
    if (targetTm < 40 || targetTm > 80) return 'Target Tm must be between 40 and 80 °C.';
    if (minGC < 0 || maxGC > 100 || minGC > maxGC) return 'GC range must be 0–100%, with minimum no larger than maximum.';
    if (!/^[ACGTN]+$/.test(normalizedSequence)) return 'Primer design supports nucleotide records containing A, C, G, T/U, and N.';
    return '';
  }, [maxGC, maxLength, minGC, minLength, normalizedSequence, targetEnd, targetStart, targetTm]);

  const parameters = useMemo<PrimerDesignParams>(() => ({
    targetStart: targetStart - 1,
    targetEnd,
    minLength,
    maxLength,
    targetTm,
    tmTolerance,
    minGC: minGC / 100,
    maxGC: maxGC / 100,
    flankingWindow,
    requireGcClamp,
    forwardTail: forwardTail.trim().toUpperCase() || undefined,
    reverseTail: reverseTail.trim().toUpperCase() || undefined,
    maxPairs: MAX_VISIBLE_PAIRS,
  }), [flankingWindow, forwardTail, maxGC, maxLength, minGC, minLength, requireGcClamp, reverseTail, targetEnd, targetStart, targetTm, tmTolerance]);

  const result = useMemo<PrimerPairResult | null>(() => {
    if (validationMessage) return null;
    return designPrimerPairWithDiagnostics(normalizedSequence, parameters);
  }, [normalizedSequence, parameters, validationMessage]);
  const pairs = useMemo(() => result?.pairs ?? [], [result]);
  const selectedPair = pairs[selectedPairIndex] ?? pairs[0] ?? null;

  useEffect(() => {
    if (selectedPairIndex >= pairs.length) setSelectedPairIndex(0);
  }, [pairs.length, selectedPairIndex]);

  const selectedDiagnostics = useMemo(() => {
    if (!selectedPair) return null;
    const forwardHairpin = predictHairpin(selectedPair.forward.fullSequence);
    const reverseHairpin = predictHairpin(selectedPair.reverse.fullSequence);
    const forwardDimer = predictSelfDimer(selectedPair.forward.fullSequence);
    const reverseDimer = predictSelfDimer(selectedPair.reverse.fullSequence);
    const crossDimer = predictPrimerDimer(selectedPair.forward.fullSequence, selectedPair.reverse.fullSequence);
    return { forwardHairpin, reverseHairpin, forwardDimer, reverseDimer, crossDimer };
  }, [selectedPair]);

  const handoff = useMemo<ClaudeSciencePrimerHandoff | null>(() => selectedPair ? ({
    recordId: record.id,
    recordName: record.name,
    intent,
    target: { start: targetStart - 1, end: targetEnd },
    pair: selectedPair,
    pairNumber: Math.max(1, pairs.indexOf(selectedPair) + 1),
    parameters,
    ...(preparationContext ? { preparationContext: { ...preparationContext } } : {}),
  }) : null, [intent, pairs, parameters, preparationContext, record.id, record.name, selectedPair, targetEnd, targetStart]);

  const applyPreset = useCallback((preset: PrimerPreset) => {
    setPresetId(preset.id);
    setIntent(preset.intent);
    setMinLength(preset.minLength);
    setMaxLength(preset.maxLength);
    setTargetTm(preset.targetTm);
    setTmTolerance(preset.tmTolerance);
    setMinGC(preset.minGC);
    setMaxGC(preset.maxGC);
    setFlankingWindow(preset.flankingWindow);
    setSelectedPairIndex(0);
    setStatus(`${preset.name} conditions applied.`);
  }, []);

  const markCustom = useCallback(() => {
    setPresetId('custom');
    setSelectedPairIndex(0);
  }, []);

  const choosePair = useCallback((index: number) => {
    const pair = pairs[index];
    if (!pair) return;
    setSelectedPairIndex(index);
    onSelectRange?.(pair.forward.start, pair.reverse.end);
    setStatus(`Pair ${index + 1} selected on the sequence.`);
  }, [onSelectRange, pairs]);

  const runAction = useCallback(async (label: string, action: (() => void | Promise<void>) | undefined) => {
    if (!action || busyAction) return;
    setBusyAction(label);
    setStatus('');
    try {
      await action();
      setStatus(`${label} complete.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusyAction('');
    }
  }, [busyAction]);

  const copyPair = useCallback(() => {
    if (!handoff || !onCopy) return;
    const value = `Forward\t${handoff.pair.forward.fullSequence}\nReverse\t${handoff.pair.reverse.fullSequence}`;
    void runAction('Copy pair', () => onCopy(`Primer pair ${handoff.pairNumber}`, value));
  }, [handoff, onCopy, runAction]);

  const exportPair = useCallback(() => {
    if (!handoff || !onExport) return;
    void runAction('Export FASTA', () => onExport({
      ...handoff,
      format: 'fasta',
      filename: filenameFor(record.name),
      text: fastaForPair(record.name, handoff.pair, handoff.pairNumber),
    }));
  }, [handoff, onExport, record.name, runAction]);

  const addAnnotations = useCallback(() => {
    if (!handoff || !onAddAnnotations) return;
    const features = [
      primerToFeature(handoff.pair.forward, `Forward primer ${handoff.pairNumber} (${record.name})`),
      primerToFeature(handoff.pair.reverse, `Reverse primer ${handoff.pairNumber} (${record.name})`),
    ];
    void runAction('Add annotations', () => onAddAnnotations(features, handoff));
  }, [handoff, onAddAnnotations, record.name, runAction]);

  const selectedSummary = selectedPair
    ? `Pair ${selectedPairIndex + 1}: ${selectedPair.productLength.toLocaleString()} bp amplicon; melting temperatures differ by ${selectedPair.tmDifference.toFixed(1)} degrees Celsius.`
    : '';

  const handlePairKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || pairs.length === 0) return;
    event.preventDefault();
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? pairs.length - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % pairs.length
          : (index - 1 + pairs.length) % pairs.length;
    choosePair(next);
    workspaceRef.current?.querySelector<HTMLButtonElement>(`[data-pair-index="${next}"]`)?.focus();
  };

  const workspace = (
    <section
      ref={workspaceRef}
      className="motif-cs-primer-workspace"
      data-embedded={embedded || undefined}
      role={embedded ? 'region' : 'dialog'}
      aria-modal={embedded ? undefined : true}
      aria-label={embedded ? 'Primer design' : undefined}
      aria-labelledby={embedded ? undefined : titleId}
      data-testid="primer-workspace"
    >
      {embedded ? null : <header className="motif-cs-primer-workspace-header">
        <div>
          <div className="motif-cs-primer-eyebrow">Design workspace</div>
          <h2 id={titleId}>Primer design</h2>
          <p>{record.name} <span aria-hidden="true">·</span> {normalizedSequence.length.toLocaleString()} {record.molecule === 'rna' ? 'nt RNA' : 'bp DNA'}</p>
        </div>
        <button ref={initialFocusRef} className="motif-cs-primer-icon-button" type="button" onClick={onClose} aria-label="Close primer design workspace">×</button>
      </header>}

      <nav className="motif-cs-primer-presets" aria-label="Primer design presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            className="motif-cs-primer-preset"
            type="button"
            data-active={presetId === preset.id || undefined}
            aria-pressed={presetId === preset.id}
            title={preset.note}
            onClick={() => applyPreset(preset)}
          >
            {preset.name}
          </button>
        ))}
        {presetId === 'custom' ? <span className="motif-cs-primer-custom-chip">Custom conditions</span> : null}
      </nav>

      <div className="motif-cs-primer-workspace-body">
        <aside className="motif-cs-primer-settings" aria-label="Primer design settings">
          {preparationContext ? (
            <div className="motif-cs-primer-preparation-context" role="note" aria-label="Cloning preparation context" data-testid="primer-preparation-context">
              <span>Cloning preparation</span>
              <strong>{preparationContext.label}</strong>
              {preparationContext.detail ? <p>{preparationContext.detail}</p> : null}
              {initialForwardTail || initialReverseTail ? <small>Starting 5′ tails are loaded in Advanced constraints and remain editable.</small> : null}
              {preparationContext.method === 'gibson' && !initialForwardTail && !initialReverseTail ? (
                <small>No homology tail was inferred. Enter the intended 5′ tail in Advanced constraints before saving.</small>
              ) : null}
              <small>Simulate PCR saves a result only. Create &amp; use amplicon creates the exact linear PCR product, keeps the source record unchanged, replaces this prepared part, and rechecks the live cloning draft. Save primer plan only records the oligos without creating DNA.</small>
              {preparationProgress ? (
                <div className="motif-cs-primer-preparation-navigation" aria-label="Primer preparation worklist">
                  <span>
                    Action {preparationProgress.current} of {preparationProgress.total}
                    <small>{preparationProgress.completed} complete · {preparationProgress.remaining} remaining</small>
                  </span>
                  {preparationProgress.total > 1 ? <div>
                    <button
                      type="button"
                      disabled={preparationProgress.current <= 1 || !onPreviousPreparation}
                      onClick={onPreviousPreparation}
                    >Previous action</button>
                    <button
                      type="button"
                      disabled={preparationProgress.current >= preparationProgress.total || !onNextPreparation}
                      onClick={onNextPreparation}
                    >Next action</button>
                  </div> : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <section className="motif-cs-primer-section">
            <div className="motif-cs-primer-section-heading">
              <div><span>01</span><h3>Goal and target</h3></div>
              <span>{(targetEnd - targetStart + 1).toLocaleString()} bp</span>
            </div>
            <fieldset className="motif-cs-primer-intent">
              <legend className="motif-cs-primer-sr-only">Primer purpose</legend>
              {(['pcr', 'cloning', 'verification'] as const).map((value) => (
                <label key={value} data-checked={intent === value || undefined}>
                  <input type="radio" name="primer-intent" value={value} checked={intent === value} onChange={() => setIntent(value)} />
                  {value === 'pcr' ? 'PCR' : value === 'cloning' ? 'Cloning' : 'Verify'}
                </label>
              ))}
            </fieldset>
            <div className="motif-cs-primer-field-grid">
              <label>
                <span>Target start</span>
                <input aria-describedby={statusId} name="primer-target-start" type="number" inputMode="numeric" autoComplete="off" min={1} max={normalizedSequence.length} value={targetStart} onChange={(event) => { setTargetStart(Number(event.target.value)); markCustom(); }} />
              </label>
              <label>
                <span>Target end</span>
                <input aria-describedby={statusId} name="primer-target-end" type="number" inputMode="numeric" autoComplete="off" min={1} max={normalizedSequence.length} value={targetEnd} onChange={(event) => { setTargetEnd(Number(event.target.value)); markCustom(); }} />
              </label>
            </div>
            {selectedRange ? (
              <button className="motif-cs-primer-text-button" type="button" onClick={() => { const next = defaultTarget(normalizedSequence.length, selectedRange); setTargetStart(next.start); setTargetEnd(next.end); setSelectedPairIndex(0); }}>
                Use current selection ({selectedRange.start + 1}–{selectedRange.end})
              </button>
            ) : null}
          </section>

          <section className="motif-cs-primer-section">
            <div className="motif-cs-primer-section-heading"><div><span>02</span><h3>Conditions</h3></div></div>
            <div className="motif-cs-primer-field-grid">
              <label>
                <span>Target Tm <small>°C</small></span>
                <input name="primer-target-tm" type="number" inputMode="decimal" autoComplete="off" min={40} max={80} step={1} value={targetTm} onChange={(event) => { setTargetTm(Number(event.target.value)); markCustom(); }} />
              </label>
              <label>
                <span>Tolerance <small>± °C</small></span>
                <input name="primer-tm-tolerance" type="number" inputMode="decimal" autoComplete="off" min={1} max={15} step={1} value={tmTolerance} onChange={(event) => { setTmTolerance(clamp(Number(event.target.value), 1, 15)); markCustom(); }} />
              </label>
              <label>
                <span>Minimum length</span>
                <input name="primer-min-length" type="number" inputMode="numeric" autoComplete="off" min={12} max={60} step={1} value={minLength} onChange={(event) => { setMinLength(Number(event.target.value)); markCustom(); }} />
              </label>
              <label>
                <span>Maximum length</span>
                <input name="primer-max-length" type="number" inputMode="numeric" autoComplete="off" min={12} max={60} step={1} value={maxLength} onChange={(event) => { setMaxLength(Number(event.target.value)); markCustom(); }} />
              </label>
            </div>
          </section>

          <details className="motif-cs-primer-advanced">
            <summary>Advanced constraints <span>GC, scan, tails</span></summary>
            <div className="motif-cs-primer-advanced-body">
              <div className="motif-cs-primer-field-grid">
                <label>
                  <span>Minimum GC <small>%</small></span>
                  <input name="primer-min-gc" type="number" inputMode="decimal" autoComplete="off" min={0} max={100} value={minGC} onChange={(event) => { setMinGC(Number(event.target.value)); markCustom(); }} />
                </label>
                <label>
                  <span>Maximum GC <small>%</small></span>
                  <input name="primer-max-gc" type="number" inputMode="decimal" autoComplete="off" min={0} max={100} value={maxGC} onChange={(event) => { setMaxGC(Number(event.target.value)); markCustom(); }} />
                </label>
                <label>
                  <span>Flanking scan <small>nt</small></span>
                  <input name="primer-flanking-window" type="number" inputMode="numeric" autoComplete="off" min={0} max={250} value={flankingWindow} onChange={(event) => { setFlankingWindow(clamp(Number(event.target.value), 0, 250)); markCustom(); }} />
                </label>
                <label className="motif-cs-primer-check-field">
                  <input type="checkbox" checked={requireGcClamp} onChange={(event) => { setRequireGcClamp(event.target.checked); markCustom(); }} />
                  <span>Require 3′ GC clamp</span>
                </label>
              </div>
              <div className="motif-cs-primer-tail-grid">
                <label>
                  <span>Forward 5′ tail</span>
                  <input className="motif-cs-primer-sequence-input" autoComplete="off" spellCheck={false} value={forwardTail} onChange={(event) => { setForwardTail(event.target.value.replace(/[^A-Za-z]/g, '')); markCustom(); }} placeholder="Optional sequence" />
                </label>
                <label>
                  <span>Tail preset</span>
                  <select aria-label="Forward tail preset" value="" onChange={(event) => { setForwardTail(event.target.value); markCustom(); }}>
                    <option value="">Choose…</option>
                    {ENZYME_TAIL_PRESETS.map((preset) => <option key={`f-${preset.name}`} value={preset.tail}>{preset.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Reverse 5′ tail</span>
                  <input className="motif-cs-primer-sequence-input" autoComplete="off" spellCheck={false} value={reverseTail} onChange={(event) => { setReverseTail(event.target.value.replace(/[^A-Za-z]/g, '')); markCustom(); }} placeholder="Optional sequence" />
                </label>
                <label>
                  <span>Tail preset</span>
                  <select aria-label="Reverse tail preset" value="" onChange={(event) => { setReverseTail(event.target.value); markCustom(); }}>
                    <option value="">Choose…</option>
                    {ENZYME_TAIL_PRESETS.map((preset) => <option key={`r-${preset.name}`} value={preset.tail}>{preset.name}</option>)}
                  </select>
                </label>
              </div>
              <p className="motif-cs-primer-help">Tm and GC are calculated from the annealing region. Full-length tail sequences are included in structure diagnostics.</p>
            </div>
          </details>
        </aside>

        <main className="motif-cs-primer-results">
          <div className="motif-cs-primer-results-heading">
            <div>
              <span className="motif-cs-primer-eyebrow">Ranked candidates</span>
              <h3>{validationMessage ? 'Check settings' : `${pairs.length} primer pair${pairs.length === 1 ? '' : 's'}`}</h3>
            </div>
            {!validationMessage && pairs.length > 0 ? <span className="motif-cs-primer-result-badge">Best ΔTm {pairs[0].tmDifference.toFixed(1)} °C</span> : null}
          </div>

          {validationMessage ? (
            <div className="motif-cs-primer-empty" role="alert"><strong>Cannot design primers</strong><p>{validationMessage}</p></div>
          ) : pairs.length === 0 ? (
            <div className="motif-cs-primer-empty" role="status"><strong>No passing pair</strong><p>{result ? diagnosticMessage(result) : 'Adjust the design conditions.'}</p></div>
          ) : (
            <>
              <div className="motif-cs-primer-pair-list" role="listbox" aria-label="Ranked primer pairs" aria-describedby={statusId}>
                {pairs.map((pair, index) => (
                  <button
                    className="motif-cs-primer-pair-row"
                    type="button"
                    role="option"
                    aria-selected={selectedPairIndex === index}
                    data-selected={selectedPairIndex === index || undefined}
                    data-pair-index={index}
                    key={`${pair.forward.start}:${pair.reverse.end}:${index}`}
                    onClick={() => choosePair(index)}
                    onKeyDown={(event) => handlePairKeyDown(event, index)}
                  >
                    <span className="motif-cs-primer-pair-rank">{String(index + 1).padStart(2, '0')}</span>
                    <span className="motif-cs-primer-pair-main"><strong>{pair.productLength.toLocaleString()} bp</strong><small>{pair.forward.start + 1}–{pair.reverse.end}</small></span>
                    <span><small>F / R Tm</small><strong>{pair.forward.tm.toFixed(1)} / {pair.reverse.tm.toFixed(1)}°</strong></span>
                    <span><small>ΔTm</small><strong>{pair.tmDifference.toFixed(1)} °C</strong></span>
                    <span className="motif-cs-primer-pair-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>

              {selectedPair && selectedDiagnostics ? (
                <section className="motif-cs-primer-evidence" aria-label={`Primer pair ${selectedPairIndex + 1} evidence`}>
                  <div className="motif-cs-primer-evidence-heading">
                    <div><span className="motif-cs-primer-eyebrow">Selected pair</span><h3>Pair {selectedPairIndex + 1}</h3></div>
                    <span>{selectedPair.productLength.toLocaleString()} bp amplicon</span>
                  </div>

                  {([
                    ['Forward', selectedPair.forward, selectedDiagnostics.forwardHairpin.deltaG, selectedDiagnostics.forwardDimer.deltaG],
                    ['Reverse', selectedPair.reverse, selectedDiagnostics.reverseHairpin.deltaG, selectedDiagnostics.reverseDimer.deltaG],
                  ] as const).map(([label, candidate, hairpin, dimer]) => (
                    <div className="motif-cs-primer-oligo" key={label}>
                      <div className="motif-cs-primer-oligo-name"><strong>{label}</strong><span>{candidate.start + 1}–{candidate.end}</span></div>
                      <code title={candidate.fullSequence}>{candidate.fullSequence}</code>
                      <div className="motif-cs-primer-metrics">
                        <Metric label="Tm" value={`${candidate.tm.toFixed(1)} °C`} />
                        <Metric label="GC" value={`${candidate.gcPercent.toFixed(0)}%`} />
                        <Metric label="Length" value={`${candidate.fullLength} nt`} />
                        <Metric label="3′ clamp" value={hasClamp(candidate) ? 'Yes' : 'No'} state={hasClamp(candidate) ? 'pass' : 'review'} />
                        <Metric label="Hairpin ΔG" value={`${hairpin.toFixed(1)}`} state={qualityState(hairpin, -3)} />
                        <Metric label="Self-dimer ΔG" value={`${dimer.toFixed(1)}`} state={qualityState(dimer, -5)} />
                      </div>
                    </div>
                  ))}

                  <div className="motif-cs-primer-cross-check" data-state={qualityState(selectedDiagnostics.crossDimer.deltaG, -5)}>
                    <span>Cross-dimer check</span>
                    <strong>ΔG {selectedDiagnostics.crossDimer.deltaG.toFixed(1)} kcal/mol</strong>
                    <small>{selectedDiagnostics.crossDimer.deltaG < -5 ? 'Review before ordering' : 'No strong pair interaction predicted'}</small>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </main>
      </div>

      <footer className="motif-cs-primer-workspace-footer">
        <div className="motif-cs-primer-live-status" id={statusId} role="status" aria-live="polite" aria-atomic="true">
          {status || selectedSummary || 'Select a ranked pair to inspect its evidence.'}
        </div>
        <div className="motif-cs-primer-footer-actions">
          <button type="button" disabled={!handoff || !onCopy || !!busyAction} onClick={copyPair}>Copy pair</button>
          <button type="button" disabled={!handoff || !onExport || !!busyAction} onClick={exportPair}>Export FASTA</button>
          <button type="button" disabled={!handoff || !onSaveDesign || !!busyAction} onClick={() => { if (handoff) void runAction('Save design', () => onSaveDesign?.(handoff)); }}>Save design</button>
          <button type="button" disabled={!handoff || !onAddAnnotations || !!busyAction} onClick={addAnnotations}>Add annotations</button>
          <button type="button" disabled={!handoff || !onSimulatePcr || !!busyAction} onClick={() => { if (handoff) void runAction('PCR simulation', () => onSimulatePcr?.(handoff)); }}>Simulate PCR</button>
          {preparationContext ? (
            <button
              type="button"
              disabled={!handoff || !onUseForCloning || !!busyAction}
              onClick={() => {
                if (handoff) void runAction('Save primer plan only', () => onUseForCloning?.(handoff));
              }}
            >Save primer plan only</button>
          ) : (
            <button
              type="button"
              disabled={!handoff || !onCreateAmplicon || !!busyAction}
              onClick={() => {
                if (handoff) void runAction('Create amplicon record', () => onCreateAmplicon?.(handoff));
              }}
            >Create amplicon record</button>
          )}
          <button
            className="motif-cs-primer-primary-action"
            type="button"
            disabled={!handoff || !(preparationContext ? onCreateAmplicon : onUseForCloning) || !!busyAction}
            onClick={() => {
              if (!handoff) return;
              if (preparationContext) {
                void runAction('Create & use amplicon', () => onCreateAmplicon?.(handoff));
              } else {
                void runAction('Cloning handoff', () => onUseForCloning?.(handoff));
              }
            }}
          >{preparationContext ? 'Create & use amplicon' : 'Use in cloning'}</button>
        </div>
      </footer>
    </section>
  );

  return embedded ? workspace : <div className="motif-cs-primer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyAction) onClose(); }}>{workspace}</div>;
}

export default ClaudeSciencePrimerWorkspace;
