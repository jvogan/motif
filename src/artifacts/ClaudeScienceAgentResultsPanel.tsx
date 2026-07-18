import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  ArtifactAnalysisAsset,
  ArtifactAnalysisKind,
  ArtifactAnalysisResult,
} from './claude-science-analysis-results';
import {
  ClaudeScienceFreshnessBadge,
  type ScientificFreshnessDisplayEvaluation,
} from './ClaudeScienceFreshnessBadge';
import './claude-science-agent-results.css';

export type ClaudeScienceAgentResultsPanelProps = {
  results: readonly ArtifactAnalysisResult[];
  assets: readonly ArtifactAnalysisAsset[];
  recordNames: Readonly<Record<string, string>>;
  freshnessByResultId?: ReadonlyMap<string, ScientificFreshnessDisplayEvaluation>;
  onRevealRecord: (recordId: string) => void;
  onRemove: (resultId: string) => boolean | void;
};

const KIND_LABELS: Record<ArtifactAnalysisKind, string> = {
  primer_design: 'Primer Design',
  pcr: 'PCR',
  assembly_plan: 'Assembly Plan',
  construct_verification: 'Construct Verification',
  blast_search: 'BLAST Search',
  structure_model: 'Structure Model',
  report: 'Report',
  table: 'Table',
};

type ResultFilter = 'all' | 'design' | 'sequence' | 'evidence';

const FILTER_KINDS: Record<Exclude<ResultFilter, 'all'>, ReadonlySet<ArtifactAnalysisKind>> = {
  design: new Set(['primer_design', 'pcr', 'assembly_plan']),
  sequence: new Set(['construct_verification', 'blast_search', 'structure_model']),
  evidence: new Set(['report', 'table']),
};

function timestamp(value: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(parsed));
}

function recordList(ids: readonly string[], names: Readonly<Record<string, string>>): string {
  if (ids.length === 0) return 'No linked records';
  const visible = ids.slice(0, 3).map((id) => names[id] ?? id);
  const remaining = ids.length - visible.length;
  return `${visible.join(', ')}${remaining > 0 ? ` + ${remaining.toLocaleString()} more` : ''}`;
}

function resultFacts(result: ArtifactAnalysisResult): Array<{ label: string; value: string }> {
  switch (result.kind) {
    case 'primer_design': {
      const selected = result.data.pairs.find((pair) => pair.id === result.data.selectedPairId) ?? result.data.pairs[0];
      return [
        { label: 'Candidates', value: result.data.pairs.length.toLocaleString() },
        ...(selected ? [{ label: 'Selected Product', value: `${selected.productLengthBp.toLocaleString()} bp` }] : []),
      ];
    }
    case 'pcr':
      return [{ label: 'Products', value: result.data.products.length.toLocaleString() }];
    case 'assembly_plan':
      return [
        { label: 'Method', value: result.data.method.replaceAll('_', ' ') },
        { label: 'Parts', value: result.data.orderedPartRecordIds.length.toLocaleString() },
        ...(result.data.standard ? [{ label: 'Standard', value: result.data.standard }] : []),
      ];
    case 'construct_verification':
      return [
        { label: 'Verdict', value: result.data.state.replaceAll('_', ' ') },
        { label: 'Coverage', value: `${(result.data.coverageFraction * 100).toFixed(1)}%` },
        { label: 'Mapped Reads', value: `${result.data.mappedReadCount}/${result.data.readRecordIds.length}` },
        { label: 'Unexpected', value: result.data.unexpectedVariantCount.toLocaleString() },
      ];
    case 'blast_search':
      return [
        { label: 'Program', value: result.data.program },
        { label: 'Database', value: result.data.databaseVersion ? `${result.data.database} ${result.data.databaseVersion}` : result.data.database },
        { label: 'Hits', value: result.data.hits.length.toLocaleString() },
      ];
    case 'structure_model':
      return [
        { label: 'Method', value: result.data.method },
        { label: 'Format', value: result.data.format.toUpperCase() },
        { label: 'Chains', value: result.data.chains.length.toLocaleString() },
      ];
    case 'report':
      return [{ label: 'Format', value: result.data.format }];
    case 'table':
      return [
        { label: 'Rows', value: result.data.rows.length.toLocaleString() },
        { label: 'Columns', value: result.data.columns.length.toLocaleString() },
      ];
  }
}

function safePreview(result: ArtifactAnalysisResult): string | null {
  if (result.kind === 'report') return result.data.body?.slice(0, 1_200) ?? null;
  if (result.kind === 'blast_search') {
    return result.data.hits.slice(0, 5).map((hit) => (
      `${hit.accession} · ${hit.identityPercent.toFixed(1)}% identity · ${hit.queryCoveragePercent.toFixed(1)}% coverage · E ${hit.eValue}`
    )).join('\n') || null;
  }
  if (result.kind === 'table') {
    const header = result.data.columns.map((column) => column.label).join('\t');
    const rows = result.data.rows.slice(0, 8).map((row) => row.map((cell) => String(cell ?? '')).join('\t'));
    return [header, ...rows].join('\n');
  }
  if (result.kind === 'construct_verification') {
    return result.data.reasonCodes.length
      ? result.data.reasonCodes.map((code) => code.replaceAll('_', ' ')).join('\n')
      : 'No verification issues recorded.';
  }
  return null;
}

export function ClaudeScienceAgentResultsPanel({
  results,
  assets,
  recordNames,
  freshnessByResultId,
  onRevealRecord,
  onRemove,
}: ClaudeScienceAgentResultsPanelProps) {
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusIdRef = useRef<string | null>(null);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const ordered = useMemo(() => [...results]
    .filter((result) => filter === 'all' || FILTER_KINDS[filter].has(result.kind))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id)), [filter, results]);

  useLayoutEffect(() => {
    if (pendingDeleteId) {
      cancelRef.current?.focus();
      return;
    }
    const id = restoreFocusIdRef.current;
    restoreFocusIdRef.current = null;
    if (id) deleteRefs.current.get(id)?.focus();
  }, [pendingDeleteId]);

  const cancelDelete = (resultId: string) => {
    restoreFocusIdRef.current = resultId;
    setPendingDeleteId(null);
  };

  const confirmDelete = (resultId: string) => {
    const removed = onRemove(resultId);
    setPendingDeleteId(null);
    setStatus(removed === false ? 'Remove dependent analysis results first.' : 'Analysis result removed.');
  };

  return (
    <section className="motif-cs-agent-results" aria-label="Agent and analysis results">
      <div className="motif-cs-agent-results-toolbar">
        <label>
          <span>Show</span>
          <select name="analysis-result-filter" autoComplete="off" value={filter} onChange={(event) => setFilter(event.target.value as ResultFilter)}>
            <option value="all">All Results</option>
            <option value="design">Design &amp; PCR</option>
            <option value="sequence">Sequence &amp; Structure</option>
            <option value="evidence">Reports &amp; Tables</option>
          </select>
        </label>
        <span>{ordered.length.toLocaleString()} shown</span>
      </div>

      {results.length === 0 ? (
        <div className="motif-cs-agent-results-empty">
          <strong>No analysis results yet</strong>
          <span>Primer designs, assembly plans, construct checks, BLAST hits, structures, reports, and tables will appear here with their provenance.</span>
        </div>
      ) : ordered.length === 0 ? (
        <div className="motif-cs-agent-results-empty">
          <strong>No results in this view</strong>
          <span>Choose All Results to see the complete saved analysis history.</span>
        </div>
      ) : (
        <div className="motif-cs-agent-result-list" data-testid="analysis-result-list">
          {ordered.map((result) => {
            const revealId = result.inputRecordIds.find((id) => recordNames[id]);
            const preview = safePreview(result);
            const linkedAssets = result.assetIds.map((id) => assetsById.get(id)).filter((asset): asset is ArtifactAnalysisAsset => Boolean(asset));
            const engine = result.provenance.engine
              ? `${result.provenance.engine}${result.provenance.engineVersion ? ` ${result.provenance.engineVersion}` : ''}`
              : result.provenance.source;
            const freshness = freshnessByResultId?.get(result.id);
            return (
              <article className="motif-cs-agent-result-row" key={result.id} data-testid={`analysis-result-${result.id}`}>
                <div className="motif-cs-agent-result-heading">
                  <div>
                    <span className="motif-cs-agent-result-kind">{KIND_LABELS[result.kind]}</span>
                    <strong>{result.name}</strong>
                    <small>{recordList(result.inputRecordIds, recordNames)}</small>
                  </div>
                  <span className="motif-cs-agent-result-state">
                    <span className="motif-cs-agent-result-status" data-status={result.status}>{result.status}</span>
                    {freshness ? <ClaudeScienceFreshnessBadge evaluation={freshness} recordNames={recordNames} /> : null}
                  </span>
                </div>

                {result.summary ? <p>{result.summary}</p> : null}
                <dl className="motif-cs-agent-result-facts">
                  {resultFacts(result).map((fact) => (
                    <div key={fact.label}>
                      <dt>{fact.label}</dt>
                      <dd>{fact.value}</dd>
                    </div>
                  ))}
                </dl>

                <details className="motif-cs-agent-result-details">
                  <summary>Provenance &amp; Data</summary>
                  <div>
                    <dl>
                      <div><dt>Created</dt><dd><time dateTime={result.createdAt}>{timestamp(result.createdAt)}</time></dd></div>
                      <div><dt>Engine</dt><dd>{engine}</dd></div>
                      <div><dt>Inputs</dt><dd>{recordList(result.inputRecordIds, recordNames)}</dd></div>
                      {result.inputSha256s?.length ? (
                        <div><dt>Hashes</dt><dd>{result.inputSha256s.map((hash) => hash.slice(0, 12)).join(', ')}…</dd></div>
                      ) : null}
                      {freshness ? (
                        <div>
                          <dt>Freshness</dt>
                          <dd><ClaudeScienceFreshnessBadge evaluation={freshness} recordNames={recordNames} showReason /></dd>
                        </div>
                      ) : null}
                      {linkedAssets.length ? (
                        <div><dt>Assets</dt><dd>{linkedAssets.map((asset) => `${asset.name} (${asset.mediaType})`).join(', ')}</dd></div>
                      ) : null}
                    </dl>
                    {preview ? <pre aria-label={`${result.name} safe text preview`}>{preview}</pre> : null}
                  </div>
                </details>

                {pendingDeleteId === result.id ? (
                  <div
                    className="motif-cs-agent-result-actions motif-cs-agent-result-confirm"
                    role="group"
                    aria-label={`Confirm removal of ${result.name}`}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      cancelDelete(result.id);
                    }}
                  >
                    <span>Remove this saved result? Linked assets are retained when still in use.</span>
                    <button ref={cancelRef} className="motif-cs-mini-button" type="button" onClick={() => cancelDelete(result.id)}>Cancel</button>
                    <button className="motif-cs-mini-button motif-cs-confirm-delete" type="button" onClick={() => confirmDelete(result.id)}>Remove Result</button>
                  </div>
                ) : (
                  <div className="motif-cs-agent-result-actions">
                    {revealId ? <button className="motif-cs-mini-button" type="button" onClick={() => onRevealRecord(revealId)}>Reveal Input</button> : null}
                    <button
                      ref={(element) => {
                        if (element) deleteRefs.current.set(result.id, element);
                        else deleteRefs.current.delete(result.id);
                      }}
                      className="motif-cs-mini-button"
                      type="button"
                      onClick={() => setPendingDeleteId(result.id)}
                      aria-label={`Remove ${result.name}`}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="motif-cs-agent-results-live" role="status" aria-live="polite" data-empty={!status || undefined}>{status}</p>
    </section>
  );
}

export default ClaudeScienceAgentResultsPanel;
