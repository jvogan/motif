/* eslint-disable react-refresh/only-export-components -- exports a pure candidate adapter for the standalone workspace */
import { useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import type { SequenceType, Topology } from '../bio/types';
import {
  ARTIFACT_GEL_MAX_AGAROSE_PERCENT,
  ARTIFACT_GEL_MIN_AGAROSE_PERCENT,
  ARTIFACT_GEL_QUALITATIVE_CAVEAT,
  MAX_ARTIFACT_GEL_FRAGMENT_BP,
  MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE,
  MAX_ARTIFACT_GEL_SAMPLE_LANES,
  buildArtifactGelPreview,
  type ArtifactGelBand,
  type ArtifactGelLadderPreset,
  type ArtifactGelLane,
  type ArtifactGelLaneInput,
  type ArtifactGelPreview,
} from './claude-science-gel-preview';
import {
  normalizeSha256Hex,
  sha256HexSync,
} from './claude-science-sha256';
import type {
  ArtifactJsonObject,
  ArtifactProvenance,
  ArtifactWorkflowResult,
} from './claude-science-workspace-collections';

const MAX_GEL_WORKFLOW_NAME_LENGTH = 256;
const MAX_GEL_LANE_LABEL_LENGTH = 128;
const MAX_GEL_LANE_ID_LENGTH = 160;

export type ClaudeScienceGelRecord = {
  id: string;
  name: string;
  type: SequenceType;
  topology: Topology;
  sequence: string;
  /** Optional precomputed digest; when supplied it must match `sequence`. */
  sha256?: string;
};

export type ClaudeScienceGelLaneCandidate = {
  /** UI identity. Persisted workflow and record ids stay intact inside `lane`. */
  id: string;
  label: string;
  detail: string;
  sourceKind: 'digest' | 'linear-record';
  lane: ArtifactGelLaneInput;
};

export type ClaudeScienceGelResultIdentity = {
  /** Durable id supplied by the parent; this component never invents one. */
  workflowResultId: string;
  /** ISO timestamp supplied by the parent; this component never reads the clock. */
  createdAt: string;
  provenance: ArtifactProvenance;
};

export type ClaudeScienceGelWorkspaceProps = {
  candidates: readonly ClaudeScienceGelLaneCandidate[];
  selectedCandidateIds: readonly string[];
  ladderPreset: ArtifactGelLadderPreset;
  agarosePercent: number;
  workflowName: string;
  resultIdentity: ClaudeScienceGelResultIdentity;
  onSelectedCandidateIdsChange: (ids: string[]) => void;
  onLadderPresetChange: (preset: ArtifactGelLadderPreset) => void;
  onAgarosePercentChange: (percent: number) => void;
  onWorkflowNameChange: (name: string) => void;
  onSaveResult: (preview: ArtifactGelPreview) => void;
  onClose: () => void;
  isSaving?: boolean;
  isSaved?: boolean;
  statusMessage?: string;
  errorMessage?: string;
  /** Hide the redundant internal title bar when hosted in the artifact's draggable window. */
  embedded?: boolean;
};

type GelBandStyle = CSSProperties & {
  '--motif-cs-gel-band-y': string;
  '--motif-cs-gel-band-intensity': string;
};

type GelPlateStyle = CSSProperties & {
  '--motif-cs-gel-lane-count': string;
};

function isJsonObject(value: unknown): value is ArtifactJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asTopology(value: unknown): Topology | null {
  return value === 'linear' || value === 'circular' ? value : null;
}

function stableShortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function boundedLaneId(prefix: string, durableId: string): string {
  const candidate = `${prefix}:${durableId}`;
  if (candidate.length <= MAX_GEL_LANE_ID_LENGTH) return candidate;
  const suffix = `:${stableShortHash(candidate)}`;
  return `${candidate.slice(0, MAX_GEL_LANE_ID_LENGTH - suffix.length)}${suffix}`;
}

function boundedLaneLabel(value: string, fallback: string): string {
  const normalized = value.trim() || fallback;
  return normalized.length <= MAX_GEL_LANE_LABEL_LENGTH
    ? normalized
    : `${normalized.slice(0, MAX_GEL_LANE_LABEL_LENGTH - 1)}…`;
}

function digestFragmentLengths(result: ArtifactWorkflowResult): number[] | null {
  if (!isJsonObject(result.result)) return null;
  const structured = result.result.fragments;
  const rawLengths = result.result.fragmentLengthsBp;
  const values = Array.isArray(structured)
    ? structured.map((fragment) => (isJsonObject(fragment) ? fragment.length : fragment))
    : Array.isArray(rawLengths) ? rawLengths : null;
  if (!values || values.length === 0 || values.length > MAX_ARTIFACT_GEL_FRAGMENTS_PER_LANE) return null;
  const lengths: number[] = [];
  for (const value of values) {
    if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > MAX_ARTIFACT_GEL_FRAGMENT_BP) {
      return null;
    }
    lengths.push(value as number);
  }
  return lengths;
}

function digestOutcome(result: ArtifactWorkflowResult): string | null {
  const resultOutcome = isJsonObject(result.result) ? result.result.outcome : null;
  const parameterOutcome = result.parameters.outcome;
  if (typeof resultOutcome === 'string') return resultOutcome;
  return typeof parameterOutcome === 'string' ? parameterOutcome : null;
}

function validatedRecordSha256(record: ClaudeScienceGelRecord): string | null {
  const computed = sha256HexSync(record.sequence);
  if (record.sha256 === undefined) return computed;
  try {
    return normalizeSha256Hex(record.sha256, `record ${record.id} sha256`) === computed ? computed : null;
  } catch {
    return null;
  }
}

function digestInputSha256(result: ArtifactWorkflowResult, recordId: string): string | null | undefined {
  if (result.inputSha256s === undefined) return undefined;
  const inputIndex = result.inputRecordIds.indexOf(recordId);
  if (inputIndex < 0 || result.inputSha256s.length !== result.inputRecordIds.length) return null;
  try {
    return normalizeSha256Hex(
      result.inputSha256s[inputIndex],
      `workflow result ${result.id} inputSha256s[${inputIndex}]`,
    );
  } catch {
    return null;
  }
}

/**
 * Turn durable workspace records and digest history into bounded lane choices.
 * Invalid/ambiguous history is omitted instead of being rendered as a physical
 * claim. Uncut circular DNA is intentionally excluded.
 */
export function createClaudeScienceGelLaneCandidates(
  records: readonly ClaudeScienceGelRecord[],
  workflowResults: readonly ArtifactWorkflowResult[],
  freshnessByResultId?: ReadonlyMap<string, { state: 'fresh' | 'stale' | 'unverified' }>,
): ClaudeScienceGelLaneCandidate[] {
  const recordById = new Map(records.map((record) => [record.id, record]));
  const candidates: ClaudeScienceGelLaneCandidate[] = [];

  for (const result of workflowResults) {
    if (result.kind !== 'digest') continue;
    if (freshnessByResultId && freshnessByResultId.get(result.id)?.state !== 'fresh') continue;
    const outcome = digestOutcome(result);
    if (outcome === 'uncut') continue;
    const fragmentLengthsBp = digestFragmentLengths(result);
    if (!fragmentLengthsBp) continue;
    const sourceLengthBp = fragmentLengthsBp.reduce((sum, length) => sum + length, 0);
    if (sourceLengthBp <= 0 || sourceLengthBp > MAX_ARTIFACT_GEL_FRAGMENT_BP) continue;
    const recordId = result.inputRecordIds[0];
    if (!recordId) continue;
    const sourceRecord = recordById.get(recordId);
    const savedInputSha256 = digestInputSha256(result, recordId);
    if (savedInputSha256 === null) continue;
    const currentRecordSha256 = sourceRecord ? validatedRecordSha256(sourceRecord) : undefined;
    if (currentRecordSha256 === null) continue;
    if (savedInputSha256 && currentRecordSha256 && savedInputSha256 !== currentRecordSha256) continue;
    // A legacy digest without saved input hashes cannot attest that its
    // fragment lengths came from the current record contents. Keep that lane
    // hashless instead of attaching a newly computed hash to stale results.
    const recordSha256 = savedInputSha256;
    const sourceTopology = asTopology(result.parameters.topology) ?? sourceRecord?.topology ?? null;
    if (!sourceTopology) continue;
    // A legacy circular result with one fragment and no explicit outcome might
    // be linearized or entirely uncut. Do not make a mobility claim when the
    // saved provenance cannot distinguish those physical states.
    if (sourceTopology === 'circular' && fragmentLengthsBp.length === 1 && outcome !== 'linearized') continue;
    const sourceName = sourceRecord?.name.trim() || recordId;
    const label = result.name.trim() || `Digest of ${sourceName}`;
    candidates.push({
      id: `digest:${result.id}`,
      label,
      detail: `${fragmentLengthsBp.length.toLocaleString()} fragment${fragmentLengthsBp.length === 1 ? '' : 's'} · ${sourceLengthBp.toLocaleString()} bp`,
      sourceKind: 'digest',
      lane: {
        id: boundedLaneId('digest', result.id),
        label: boundedLaneLabel(label, `Digest of ${sourceName}`),
        sourceKind: 'digest',
        recordId,
        ...(recordSha256 === undefined ? {} : { recordSha256 }),
        sequenceType: 'dna',
        sourceTopology,
        sourceLengthBp,
        fragmentLengthsBp,
        digestWorkflowResultId: result.id,
      },
    });
  }

  for (const record of records) {
    if (record.type !== 'dna' || record.topology !== 'linear') continue;
    const lengthBp = record.sequence.length;
    if (!Number.isInteger(lengthBp) || lengthBp <= 0 || lengthBp > MAX_ARTIFACT_GEL_FRAGMENT_BP) continue;
    const recordSha256 = validatedRecordSha256(record);
    if (!recordSha256) continue;
    const label = record.name.trim() || record.id;
    candidates.push({
      id: `record:${record.id}`,
      label,
      detail: `Linear DNA · ${lengthBp.toLocaleString()} bp`,
      sourceKind: 'linear-record',
      lane: {
        id: boundedLaneId('record', record.id),
        label: boundedLaneLabel(label, record.id),
        sourceKind: 'linear-record',
        recordId: record.id,
        recordSha256,
        sequenceType: 'dna',
        topology: 'linear',
        lengthBp,
      },
    });
  }

  return candidates;
}

function formatBp(value: number): string {
  return `${value.toLocaleString()} bp`;
}

function bandLabel(lane: ArtifactGelLane, band: ArtifactGelBand): string {
  const sizes = band.fragmentSizesBp.map(formatBp).join(', ');
  if (band.coMigrating) {
    return `${lane.label}: ${formatBp(band.representativeSizeBp)} apparent band; ${band.fragmentCount} co-migrating fragments (${sizes}).`;
  }
  return `${lane.label}: ${formatBp(band.representativeSizeBp)}.`;
}

function moveBandFocus(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const track = event.currentTarget.closest('.motif-cs-gel-lane-track');
  if (!track) return;
  const bands = Array.from(track.querySelectorAll<HTMLElement>('.motif-cs-gel-band'));
  const currentIndex = bands.indexOf(event.currentTarget);
  if (currentIndex < 0 || bands.length < 2) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? bands.length - 1
      : Math.min(
          bands.length - 1,
          Math.max(0, currentIndex + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1)),
        );
  bands[nextIndex]?.focus();
}

function GelLaneView({ lane }: { lane: ArtifactGelLane }) {
  return (
    <div
      className="motif-cs-gel-lane"
      data-source-kind={lane.sourceKind}
      data-testid={`gel-lane-${lane.id}`}
      role="listitem"
    >
      <div className="motif-cs-gel-lane-track" aria-label={`${lane.label}, ${lane.bands.length} visible bands`}>
        <span className="motif-cs-gel-well" aria-hidden="true" />
        {lane.bands.map((band) => {
          const label = bandLabel(lane, band);
          const style: GelBandStyle = {
            '--motif-cs-gel-band-y': `${Math.round(band.normalizedY * 10000) / 100}%`,
            '--motif-cs-gel-band-intensity': `${band.relativeIntensity}`,
          };
          return (
            <span
              key={band.bandIndex}
              className="motif-cs-gel-band"
              data-co-migrating={band.coMigrating || undefined}
              data-clipped={band.clippedAtBoundary || undefined}
              data-testid={`gel-band-${lane.id}-${band.bandIndex}`}
              data-tooltip={label}
              role="img"
              tabIndex={band.bandIndex === 0 ? 0 : -1}
              aria-label={label}
              title={label}
              style={style}
              onKeyDown={moveBandFocus}
            />
          );
        })}
      </div>
      <span className="motif-cs-gel-lane-index" aria-hidden="true">{lane.laneIndex === 0 ? 'M' : lane.laneIndex}</span>
      <span className="motif-cs-gel-lane-label" title={lane.label}>{lane.label}</span>
    </div>
  );
}

function normalizedAgarosePercent(value: number): number {
  if (!Number.isFinite(value)) return ARTIFACT_GEL_MIN_AGAROSE_PERCENT;
  const clamped = Math.min(ARTIFACT_GEL_MAX_AGAROSE_PERCENT, Math.max(ARTIFACT_GEL_MIN_AGAROSE_PERCENT, value));
  return Math.round(clamped * 10) / 10;
}

export function ClaudeScienceGelWorkspace({
  candidates,
  selectedCandidateIds,
  ladderPreset,
  agarosePercent,
  workflowName,
  resultIdentity,
  onSelectedCandidateIdsChange,
  onLadderPresetChange,
  onAgarosePercentChange,
  onWorkflowNameChange,
  onSaveResult,
  onClose,
  isSaving = false,
  isSaved = false,
  statusMessage = '',
  errorMessage = '',
  embedded = false,
}: ClaudeScienceGelWorkspaceProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const candidateById = useMemo(() => {
    const index = new Map<string, ClaudeScienceGelLaneCandidate>();
    for (const candidate of candidates) {
      if (!index.has(candidate.id)) index.set(candidate.id, candidate);
    }
    return index;
  }, [candidates]);
  const normalizedCandidates = useMemo(() => Array.from(candidateById.values()), [candidateById]);

  const effectiveSelection = useMemo(() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of selectedCandidateIds) {
      if (!candidateById.has(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      if (ids.length === MAX_ARTIFACT_GEL_SAMPLE_LANES) break;
    }
    return ids;
  }, [candidateById, selectedCandidateIds]);
  const selectedSet = useMemo(() => new Set(effectiveSelection), [effectiveSelection]);
  const normalizedAgarose = normalizedAgarosePercent(agarosePercent);
  const normalizedWorkflowName = workflowName.trim();
  const workflowNameError = !normalizedWorkflowName
    ? 'Enter a result name before saving.'
    : workflowName.length > MAX_GEL_WORKFLOW_NAME_LENGTH
      ? `Result name cannot exceed ${MAX_GEL_WORKFLOW_NAME_LENGTH} characters.`
      : '';
  const renderWorkflowName = workflowNameError ? 'Unsaved gel preview' : workflowName;
  const selectedLanes = useMemo(() => effectiveSelection.map((id) => candidateById.get(id)?.lane)
    .filter((lane): lane is ArtifactGelLaneInput => lane !== undefined), [candidateById, effectiveSelection]);

  const built = useMemo((): { preview: ArtifactGelPreview | null; error: string } => {
    if (selectedLanes.length === 0) return { preview: null, error: '' };
    try {
      return {
        preview: buildArtifactGelPreview({
          workflowResultId: resultIdentity.workflowResultId,
          workflowName: renderWorkflowName,
          createdAt: resultIdentity.createdAt,
          ladderPreset,
          agarosePercent: normalizedAgarose,
          lanes: selectedLanes,
          provenance: resultIdentity.provenance,
        }),
        error: '',
      };
    } catch (error) {
      return { preview: null, error: error instanceof Error ? error.message : 'The gel preview could not be built.' };
    }
  }, [ladderPreset, normalizedAgarose, renderWorkflowName, resultIdentity, selectedLanes]);

  const updateSelection = (candidateId: string, checked: boolean) => {
    const current = [...effectiveSelection];
    if (checked) {
      if (current.includes(candidateId) || current.length >= MAX_ARTIFACT_GEL_SAMPLE_LANES) return;
      onSelectedCandidateIdsChange([...current, candidateId]);
      return;
    }
    onSelectedCandidateIdsChange(current.filter((id) => id !== candidateId));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  const digestCandidates = normalizedCandidates.filter((candidate) => candidate.sourceKind === 'digest');
  const recordCandidates = normalizedCandidates.filter((candidate) => candidate.sourceKind === 'linear-record');
  const atLaneLimit = effectiveSelection.length >= MAX_ARTIFACT_GEL_SAMPLE_LANES;
  const plateStyle: GelPlateStyle = {
    '--motif-cs-gel-lane-count': `${(built.preview?.lanes.length ?? 1)}`,
  };

  return (
    <section
      className="motif-cs-gel-workspace"
      aria-label="Gel preview workspace"
      aria-describedby="motif-cs-gel-caveat"
      data-testid="gel-workspace"
      onKeyDown={embedded ? undefined : handleKeyDown}
    >
      {embedded ? null : <header className="motif-cs-gel-workspace-head">
        <div>
          <span className="motif-cs-kicker">Qualitative agarose preview</span>
          <h2>Gel workspace</h2>
          <p>Compare saved restriction digests with linear DNA records before exporting or recording the result.</p>
        </div>
        <button className="motif-cs-window-icon motif-cs-window-close" type="button" onClick={onClose} aria-label="Close gel workspace">
          <span aria-hidden="true">×</span>
        </button>
      </header>}

      <div className="motif-cs-gel-workspace-layout">
        <aside className="motif-cs-gel-setup" aria-label="Gel setup">
          <fieldset className="motif-cs-gel-source-picker">
            <legend>Sample lanes</legend>
            <div className="motif-cs-gel-source-summary">
              <span>{effectiveSelection.length} of {MAX_ARTIFACT_GEL_SAMPLE_LANES} lanes</span>
              <span className="motif-cs-gel-source-actions">
                {effectiveSelection.length > 0 ? (
                  <button className="motif-cs-text-button" type="button" onClick={() => onSelectedCandidateIdsChange([])}>Clear</button>
                ) : null}
                <button
                  className="motif-cs-text-button motif-cs-gel-mobile-preview-link"
                  type="button"
                  onClick={() => {
                    previewRef.current?.scrollIntoView({ block: 'start' });
                    previewRef.current?.focus({ preventScroll: true });
                  }}
                >
                  View preview ↓
                </button>
              </span>
            </div>
            {normalizedCandidates.length === 0 ? (
              <p className="motif-cs-gel-empty-source" data-testid="gel-no-sources">
                Save a restriction digest or add a linear DNA record to create a sample lane.
              </p>
            ) : null}
            {digestCandidates.length > 0 ? (
              <div className="motif-cs-gel-source-group" data-testid="gel-digest-sources">
                <strong>Saved digests</strong>
                {digestCandidates.map((candidate) => {
                  const checked = selectedSet.has(candidate.id);
                  return (
                    <label className="motif-cs-gel-source-row" key={candidate.id} data-selected={checked || undefined}>
                      <input
                        type="checkbox"
                        aria-label={`${candidate.label}, ${candidate.detail}`}
                        checked={checked}
                        disabled={!checked && atLaneLimit}
                        onChange={(event) => updateSelection(candidate.id, event.currentTarget.checked)}
                      />
                      <span>
                        <strong>{candidate.label}</strong>
                        <small>{candidate.detail}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
            {recordCandidates.length > 0 ? (
              <div className="motif-cs-gel-source-group" data-testid="gel-record-sources">
                <strong>Linear DNA records</strong>
                {recordCandidates.map((candidate) => {
                  const checked = selectedSet.has(candidate.id);
                  return (
                    <label className="motif-cs-gel-source-row" key={candidate.id} data-selected={checked || undefined}>
                      <input
                        type="checkbox"
                        aria-label={`${candidate.label}, ${candidate.detail}`}
                        checked={checked}
                        disabled={!checked && atLaneLimit}
                        onChange={(event) => updateSelection(candidate.id, event.currentTarget.checked)}
                      />
                      <span>
                        <strong>{candidate.label}</strong>
                        <small>{candidate.detail}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </fieldset>

          <fieldset className="motif-cs-gel-ladder-picker">
            <legend>Ladder</legend>
            <div className="motif-cs-segmented" role="radiogroup" aria-label="DNA ladder">
              {([['1kb', '1 kb'], ['100bp', '100 bp']] as const).map(([value, label]) => (
                <label key={value} data-selected={ladderPreset === value || undefined}>
                  <input
                    type="radio"
                    name="motif-cs-gel-ladder"
                    value={value}
                    checked={ladderPreset === value}
                    onChange={() => onLadderPresetChange(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="motif-cs-gel-agarose-control">
            <span>
              <strong>Agarose</strong>
              <output htmlFor="motif-cs-gel-agarose">{normalizedAgarose.toFixed(1)}%</output>
            </span>
            <input
              id="motif-cs-gel-agarose"
              data-testid="gel-agarose-range"
              type="range"
              min={ARTIFACT_GEL_MIN_AGAROSE_PERCENT}
              max={ARTIFACT_GEL_MAX_AGAROSE_PERCENT}
              step={0.1}
              value={normalizedAgarose}
              aria-label="Agarose percentage"
              aria-valuetext={`${normalizedAgarose.toFixed(1)} percent agarose`}
              onChange={(event) => onAgarosePercentChange(normalizedAgarosePercent(Number(event.currentTarget.value)))}
            />
            <small>Higher percentages separate smaller fragments more strongly in this qualitative model.</small>
          </label>
        </aside>

        <div
          ref={previewRef}
          className="motif-cs-gel-preview-column"
          tabIndex={-1}
          role="region"
          aria-label="Gel preview"
        >
          <div className="motif-cs-gel-preview-head">
            <div>
              <span className="motif-cs-kicker">Preview</span>
              <strong>{built.preview ? `${built.preview.sampleLaneCount} sample lane${built.preview.sampleLaneCount === 1 ? '' : 's'}` : 'No sample lanes'}</strong>
            </div>
            {built.preview ? <span>{built.preview.sampleBandCount} sample band{built.preview.sampleBandCount === 1 ? '' : 's'}</span> : null}
          </div>

          {built.preview ? (
            <div className="motif-cs-gel-plate" data-testid="gel-plate" style={plateStyle}>
              <div className="motif-cs-gel-lanes" role="list" aria-label="Qualitative gel lanes">
                {built.preview.lanes.map((lane) => <GelLaneView key={lane.id} lane={lane} />)}
              </div>
            </div>
          ) : (
            <div className="motif-cs-gel-empty-preview" data-testid="gel-empty-preview">
              <strong>Choose at least one sample lane</strong>
              <span>The marker lane is added automatically.</span>
            </div>
          )}

          <p className="motif-cs-gel-caveat" id="motif-cs-gel-caveat" role="note">
            <strong>Interpretation limit.</strong> {ARTIFACT_GEL_QUALITATIVE_CAVEAT}
          </p>
          {built.error || workflowNameError || errorMessage ? (
            <p className="motif-cs-gel-error" role="alert">{built.error || workflowNameError || errorMessage}</p>
          ) : null}
        </div>
      </div>

      <footer className="motif-cs-gel-workspace-footer">
        <label className="motif-cs-gel-result-name">
          <span>Result name</span>
          <input
            type="text"
            maxLength={MAX_GEL_WORKFLOW_NAME_LENGTH}
            value={workflowName}
            onChange={(event) => onWorkflowNameChange(event.currentTarget.value)}
            autoComplete="off"
          />
        </label>
        <p className="motif-cs-gel-status" data-empty={!statusMessage || undefined} role="status" aria-live="polite">{statusMessage}</p>
        <div className="motif-cs-gel-footer-actions">
          <button className="motif-cs-mini-button" type="button" onClick={onClose}>Close</button>
          <button
            className="motif-cs-mini-button motif-cs-mini-button-accent"
            data-testid="gel-save-result"
            type="button"
            disabled={!built.preview || !!built.error || !!workflowNameError || isSaving || isSaved}
            onClick={() => {
              if (built.preview) onSaveResult(built.preview);
            }}
          >
            {isSaving ? 'Saving…' : isSaved ? 'Saved' : 'Save Result'}
          </button>
        </div>
      </footer>
    </section>
  );
}

export default ClaudeScienceGelWorkspace;
