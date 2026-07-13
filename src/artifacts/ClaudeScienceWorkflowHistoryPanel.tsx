import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { ArtifactWorkflowResult } from './claude-science-workspace-collections';

export type ClaudeScienceWorkflowHistoryPanelProps = {
  results: readonly ArtifactWorkflowResult[];
  recordNames: Readonly<Record<string, string>>;
  onRevealRecord: (recordId: string) => void;
  onRemove: (resultId: string) => boolean | void;
};

const KIND_LABELS: Record<ArtifactWorkflowResult['kind'], string> = {
  digest: 'Digest',
  gel: 'Gel',
  golden_gate: 'Golden Gate',
  ligation: 'Ligation',
};

const RESULT_PAGE_SIZE = 50;
const SUMMARY_RECORD_LIMIT = 3;
const DETAIL_RECORD_LIMIT = 12;
const STRUCTURED_PREVIEW_MAX_NODES = 240;
const STRUCTURED_PREVIEW_MAX_DEPTH = 7;
const STRUCTURED_PREVIEW_MAX_ARRAY_ITEMS = 30;
const STRUCTURED_PREVIEW_MAX_OBJECT_KEYS = 40;
const STRUCTURED_PREVIEW_MAX_STRING_LENGTH = 600;
const STRUCTURED_PREVIEW_MAX_CHARACTERS = 6_000;

function resultTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

function recordList(
  ids: readonly string[],
  names: Readonly<Record<string, string>>,
  limit = SUMMARY_RECORD_LIMIT,
): string {
  if (ids.length === 0) return 'none';
  const visible = ids.slice(0, limit).map((id) => names[id] ?? id);
  const remaining = ids.length - visible.length;
  return `${visible.join(', ')}${remaining > 0 ? ` + ${remaining.toLocaleString()} more` : ''}`;
}

type StructuredPreview = {
  text: string;
  truncated: boolean;
};

function structuredPreview(value: unknown): StructuredPreview {
  let nodes = 0;
  let truncated = false;
  const ancestors = new WeakSet<object>();

  const visit = (item: unknown, depth: number): unknown => {
    nodes += 1;
    if (nodes > STRUCTURED_PREVIEW_MAX_NODES) {
      truncated = true;
      return '[Additional content omitted]';
    }
    if (depth > STRUCTURED_PREVIEW_MAX_DEPTH) {
      truncated = true;
      return '[Additional nesting omitted]';
    }
    if (typeof item === 'string') {
      if (item.length <= STRUCTURED_PREVIEW_MAX_STRING_LENGTH) return item;
      truncated = true;
      return `${item.slice(0, STRUCTURED_PREVIEW_MAX_STRING_LENGTH)}…`;
    }
    if (item === null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (typeof item !== 'object') return String(item);
    if (ancestors.has(item)) {
      truncated = true;
      return '[Circular value omitted]';
    }

    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > STRUCTURED_PREVIEW_MAX_ARRAY_ITEMS) truncated = true;
        return item.slice(0, STRUCTURED_PREVIEW_MAX_ARRAY_ITEMS).map((child) => visit(child, depth + 1));
      }
      const entries = Object.entries(item);
      if (entries.length > STRUCTURED_PREVIEW_MAX_OBJECT_KEYS) truncated = true;
      return Object.fromEntries(entries.slice(0, STRUCTURED_PREVIEW_MAX_OBJECT_KEYS).map(([key, child]) => (
        [key, visit(child, depth + 1)]
      )));
    } finally {
      ancestors.delete(item);
    }
  };

  let text: string;
  try {
    text = JSON.stringify(visit(value, 0), null, 2) ?? String(value);
  } catch {
    text = '[Structured preview unavailable]';
    truncated = true;
  }
  if (text.length > STRUCTURED_PREVIEW_MAX_CHARACTERS) {
    text = `${text.slice(0, STRUCTURED_PREVIEW_MAX_CHARACTERS)}\n…`;
    truncated = true;
  }
  return { text, truncated };
}

function provenanceText(result: ArtifactWorkflowResult, names: Readonly<Record<string, string>>): string {
  const { provenance } = result;
  const parts = [`Source: ${provenance.source}`];
  if (provenance.operation) parts.push(`Operation: ${provenance.operation}`);
  if (provenance.actor) parts.push(`Actor: ${provenance.actor}`);
  if (provenance.engine) {
    parts.push(`Engine: ${provenance.engine}${provenance.engineVersion ? ` ${provenance.engineVersion}` : ''}`);
  }
  if (provenance.parentIds?.length) {
    parts.push(`Parents: ${recordList(provenance.parentIds, names, DETAIL_RECORD_LIMIT)}`);
  }
  if (provenance.metadata && Object.keys(provenance.metadata).length > 0) parts.push('Provenance metadata saved');
  return parts.join(' · ');
}

export function ClaudeScienceWorkflowHistoryPanel({
  results,
  recordNames,
  onRevealRecord,
  onRemove,
}: ClaudeScienceWorkflowHistoryPanelProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const [status, setStatus] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusIdRef = useRef<string | null>(null);
  const ordered = useMemo(() => [...results].sort((left, right) => (
    Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id)
  )), [results]);
  const visibleResults = ordered.slice(0, visibleCount);
  const remainingCount = Math.max(0, ordered.length - visibleResults.length);

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
    setStatus(removed === false ? 'Remove linked results first.' : 'Workflow result removed.');
  };

  return (
    <section className="motif-cs-workflow-history" aria-label="Saved workflow results">
      {ordered.length === 0 ? (
        <div className="motif-cs-workflow-empty">
          <strong>No saved results</strong>
          <span>Save a digest, gel, Golden Gate, or ligation result to keep its inputs and provenance with this workspace.</span>
        </div>
      ) : (
        <div className="motif-cs-workflow-list" data-testid="workflow-result-list">
          {visibleResults.map((result) => {
            const revealOutputId = result.outputRecordIds.find((id) => recordNames[id]);
            const revealInputId = result.inputRecordIds.find((id) => recordNames[id]);
            const engine = result.provenance.engine
              ? `${result.provenance.engine}${result.provenance.engineVersion ? ` ${result.provenance.engineVersion}` : ''}`
              : result.provenance.source;
            const parametersPreview = structuredPreview(result.parameters);
            const resultPreview = result.result ? structuredPreview(result.result) : null;
            return (
              <article className="motif-cs-workflow-row" key={result.id} data-testid={`workflow-result-${result.id}`}>
                <div className="motif-cs-workflow-row-copy">
                  <span className="motif-cs-kicker">{KIND_LABELS[result.kind]}</span>
                  <strong>{result.name}</strong>
                  <span><span className="motif-cs-workflow-record-label">Inputs:</span> {recordList(result.inputRecordIds, recordNames)}</span>
                  {result.outputRecordIds.length > 0 ? (
                    <span><span className="motif-cs-workflow-record-label">Outputs:</span> {recordList(result.outputRecordIds, recordNames)}</span>
                  ) : null}
                  <small><time dateTime={result.createdAt}>{resultTimestamp(result.createdAt)}</time> · {engine}</small>
                  <details className="motif-cs-workflow-details">
                    <summary>Details</summary>
                    <div className="motif-cs-workflow-details-body">
                      <dl className="motif-cs-workflow-details-list">
                        <div>
                          <dt>Inputs</dt>
                          <dd>{recordList(result.inputRecordIds, recordNames, DETAIL_RECORD_LIMIT)}</dd>
                        </div>
                        <div>
                          <dt>Outputs</dt>
                          <dd>{recordList(result.outputRecordIds, recordNames, DETAIL_RECORD_LIMIT)}</dd>
                        </div>
                        {result.inputSha256s?.length ? (
                          <div>
                            <dt>Input SHA-256</dt>
                            <dd className="motif-cs-workflow-hash-list">
                              {result.inputSha256s.map((hash, index) => (
                                <code key={`${hash}-${index}`} title={hash}>{hash.slice(0, 12)}…</code>
                              ))}
                            </dd>
                          </div>
                        ) : null}
                        <div>
                          <dt>Provenance</dt>
                          <dd>{provenanceText(result, recordNames)}</dd>
                        </div>
                      </dl>
                      <section className="motif-cs-workflow-structured" aria-label="Workflow parameters">
                        <strong>Parameters</strong>
                        <pre>{parametersPreview.text}</pre>
                        {parametersPreview.truncated ? (
                          <p className="motif-cs-workflow-preview-warning">Parameter preview limited for responsiveness. The workspace backup retains the complete data.</p>
                        ) : null}
                      </section>
                      {resultPreview ? (
                        <section className="motif-cs-workflow-structured" aria-label="Workflow result data">
                          <strong>Result data</strong>
                          <pre>{resultPreview.text}</pre>
                          {resultPreview.truncated ? (
                            <p className="motif-cs-workflow-preview-warning">Result preview limited for responsiveness. The workspace backup retains the complete data.</p>
                          ) : null}
                        </section>
                      ) : null}
                    </div>
                  </details>
                </div>
                {pendingDeleteId === result.id ? (
                  <div
                    className="motif-cs-workflow-row-actions"
                    role="group"
                    aria-label={`Confirm removal of ${result.name}`}
                    onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
                      if (event.key !== 'Escape') return;
                      event.preventDefault();
                      event.stopPropagation();
                      cancelDelete(result.id);
                    }}
                  >
                    <span className="motif-cs-workflow-delete-copy">
                      <strong>Remove saved result?</strong>
                      <span>Derived records remain with embedded provenance. Remove linked results first.</span>
                    </span>
                    <button ref={cancelRef} className="motif-cs-mini-button" type="button" onClick={() => cancelDelete(result.id)}>Cancel</button>
                    <button className="motif-cs-mini-button motif-cs-confirm-delete" data-armed="true" type="button" onClick={() => confirmDelete(result.id)}>Remove result</button>
                  </div>
                ) : (
                  <div className="motif-cs-workflow-row-actions">
                    {revealOutputId ? <button className="motif-cs-mini-button" type="button" onClick={() => onRevealRecord(revealOutputId)}>Reveal output</button> : null}
                    {revealInputId ? <button className="motif-cs-mini-button" type="button" onClick={() => onRevealRecord(revealInputId)}>Reveal input</button> : null}
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
          {remainingCount > 0 ? (
            <div className="motif-cs-workflow-load-more">
              <span>Showing {visibleResults.length.toLocaleString()} of {ordered.length.toLocaleString()}</span>
              <button
                className="motif-cs-mini-button"
                type="button"
                onClick={() => setVisibleCount((count) => Math.min(count + RESULT_PAGE_SIZE, ordered.length))}
              >
                Show {Math.min(RESULT_PAGE_SIZE, remainingCount).toLocaleString()} more
              </button>
            </div>
          ) : null}
        </div>
      )}
      <p className="motif-cs-settings-reset-status" data-empty={!status || undefined} role="status" aria-live="polite">{status}</p>
    </section>
  );
}
