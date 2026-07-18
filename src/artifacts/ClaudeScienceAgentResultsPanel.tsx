import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type {
  ArtifactAnalysisAsset,
  ArtifactAnalysisKind,
  ArtifactAnalysisResult,
  ArtifactBlastHit,
} from './claude-science-analysis-results';
import {
  artifactAnalysisResultAssets,
  artifactTableToTsv,
  artifactTextPage,
  resolveArtifactReport,
  safeAnalysisFilename,
  sortArtifactBlastHits,
  type ArtifactBlastSortKey,
} from './claude-science-analysis-result-viewers';
import {
  ClaudeScienceFreshnessBadge,
  type ScientificFreshnessDisplayEvaluation,
} from './ClaudeScienceFreshnessBadge';
import { requestBrowserTextDownload } from './claude-science-download';
import './claude-science-agent-results.css';

export type ArtifactResultCopyHandler = (
  label: string,
  content: string,
) => void | Promise<void>;

export type ArtifactResultDownloadHandler = (
  filename: string,
  content: string,
  mediaType: string,
) => void | Promise<void>;

export type ClaudeScienceAgentResultsPanelProps = {
  results: readonly ArtifactAnalysisResult[];
  assets: readonly ArtifactAnalysisAsset[];
  recordNames: Readonly<Record<string, string>>;
  freshnessByResultId?: ReadonlyMap<string, ScientificFreshnessDisplayEvaluation>;
  onRevealRecord: (recordId: string) => void;
  onRemove: (resultId: string) => boolean | void;
  /** Optional host adapter; the standalone workbench otherwise uses the Clipboard API. */
  onCopyText?: ArtifactResultCopyHandler;
  /** Optional host adapter; the standalone workbench otherwise downloads a text Blob. */
  onDownloadText?: ArtifactResultDownloadHandler;
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
type ReportResult = Extract<ArtifactAnalysisResult, { kind: 'report' }>;
type TableResult = Extract<ArtifactAnalysisResult, { kind: 'table' }>;
type BlastResult = Extract<ArtifactAnalysisResult, { kind: 'blast_search' }>;

type ResultTextActions = {
  copyText: (label: string, content: string) => Promise<void>;
  downloadText: (filename: string, content: string, mediaType: string) => Promise<void>;
};

const FILTER_KINDS: Record<Exclude<ResultFilter, 'all'>, ReadonlySet<ArtifactAnalysisKind>> = {
  design: new Set(['primer_design', 'pcr', 'assembly_plan']),
  sequence: new Set(['construct_verification', 'blast_search', 'structure_model']),
  evidence: new Set(['report', 'table']),
};

const RESULT_PAGE_SIZE = 25;
const BLAST_PAGE_SIZE = 25;
const TABLE_PAGE_SIZE = 50;
const TABLE_BODY_CELL_BUDGET = 1_000;
const TABLE_CELL_PREVIEW_CHARACTERS = 512;
const ASSET_PAGE_SIZE = 25;
const TEXT_PAGE_CHARACTERS = 20_000;
const ASSET_PREVIEW_CHARACTERS = 12_000;

function boundedTextPreview(text: string, maxCharacters: number): string {
  const preview = text.slice(0, maxCharacters);
  const lastCodeUnit = preview.charCodeAt(preview.length - 1);
  return lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff ? preview.slice(0, -1) : preview;
}

const BLAST_SORT_OPTIONS: ReadonlyArray<{ value: ArtifactBlastSortKey; label: string }> = [
  { value: 'evalue', label: 'E-value · lowest first' },
  { value: 'bit_score', label: 'Bit score · highest first' },
  { value: 'identity', label: 'Identity · highest first' },
  { value: 'coverage', label: 'Query coverage · highest first' },
  { value: 'accession', label: 'Accession · A to Z' },
];

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

function assetListSummary(assets: readonly ArtifactAnalysisAsset[]): string {
  const visible = assets.slice(0, 3).map((asset) => `${asset.name} (${asset.mediaType})`);
  const remaining = assets.length - visible.length;
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

function constructVerificationPreview(result: ArtifactAnalysisResult): string | null {
  if (result.kind !== 'construct_verification') return null;
  return result.data.reasonCodes.length
    ? result.data.reasonCodes.map((code) => code.replaceAll('_', ' ')).join('\n')
    : 'No verification issues recorded.';
}

function assetExtension(asset: ArtifactAnalysisAsset): string {
  if (asset.mediaType === 'application/json') return 'json';
  if (asset.mediaType === 'text/csv') return 'csv';
  if (asset.mediaType === 'text/markdown') return 'md';
  if (asset.mediaType === 'text/tab-separated-values') return 'tsv';
  if (asset.mediaType === 'text/x-fasta') return 'fasta';
  if (asset.mediaType === 'chemical/x-pdb') return 'pdb';
  if (asset.mediaType === 'chemical/x-cif' || asset.mediaType === 'chemical/x-mmcif') return 'cif';
  return 'txt';
}

async function copyTextInBrowser(content: string): Promise<void> {
  if (globalThis.navigator?.clipboard?.writeText) {
    try {
      await globalThis.navigator.clipboard.writeText(content);
      return;
    } catch {
      // Artifact sandboxes commonly deny the async Clipboard API.
    }
  }

  if (!globalThis.document?.body) throw new Error('Clipboard API unavailable.');
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) {
      throw new Error('Clipboard API unavailable.');
    }
  } finally {
    textarea.remove();
    activeElement?.focus({ preventScroll: true });
  }
}

function PagingControls({
  label,
  pageIndex,
  pageCount,
  itemStart,
  itemEnd,
  itemCount,
  onPage,
}: {
  label: string;
  pageIndex: number;
  pageCount: number;
  itemStart: number;
  itemEnd: number;
  itemCount: number;
  onPage: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="motif-cs-agent-result-pager" role="group" aria-label={label}>
      <button
        className="motif-cs-mini-button"
        type="button"
        onClick={() => onPage(pageIndex - 1)}
        disabled={pageIndex === 0}
        aria-label={`Previous ${label.toLocaleLowerCase()}`}
      >Previous</button>
      <span aria-live="polite" aria-atomic="true">
        {itemStart.toLocaleString()}–{itemEnd.toLocaleString()} of {itemCount.toLocaleString()}
      </span>
      <button
        className="motif-cs-mini-button"
        type="button"
        onClick={() => onPage(pageIndex + 1)}
        disabled={pageIndex >= pageCount - 1}
        aria-label={`Next ${label.toLocaleLowerCase()}`}
      >Next</button>
    </div>
  );
}

function useBoundedPage(pageCount: number, resetToken: unknown) {
  const [requestedPage, setRequestedPage] = useState(0);
  const previousResetToken = useRef(resetToken);
  const pageIndex = Math.max(0, Math.min(requestedPage, pageCount - 1));

  useLayoutEffect(() => {
    const sourceChanged = !Object.is(previousResetToken.current, resetToken);
    previousResetToken.current = resetToken;
    setRequestedPage((current) => (
      sourceChanged ? 0 : Math.max(0, Math.min(current, pageCount - 1))
    ));
  }, [pageCount, resetToken]);

  return { pageIndex, setRequestedPage };
}

function PagedTextViewer({ text, label }: { text: string; label: string }) {
  const pageCount = useMemo(() => artifactTextPage(text, 0, TEXT_PAGE_CHARACTERS).pageCount, [text]);
  const { pageIndex, setRequestedPage } = useBoundedPage(pageCount, text);
  const page = artifactTextPage(text, pageIndex, TEXT_PAGE_CHARACTERS);
  return (
    <div className="motif-cs-agent-text-viewer">
      <pre aria-label={label} data-empty={text.length === 0 || undefined} tabIndex={0}>{page.text}</pre>
      <PagingControls
        label={`Pages for ${label}`}
        pageIndex={page.pageIndex}
        pageCount={page.pageCount}
        itemStart={text.length === 0 ? 0 : page.start + 1}
        itemEnd={page.end}
        itemCount={text.length}
        onPage={setRequestedPage}
      />
    </div>
  );
}

function AssetViewer({ asset, copyText, downloadText }: { asset: ArtifactAnalysisAsset } & ResultTextActions) {
  const [open, setOpen] = useState(false);
  const preview = open ? boundedTextPreview(asset.content, ASSET_PREVIEW_CHARACTERS) : '';
  const truncated = preview.length < asset.content.length;
  const filename = safeAnalysisFilename(asset.name, 'analysis-asset', assetExtension(asset));
  return (
    <details className="motif-cs-agent-asset" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="motif-cs-agent-asset-summary">
          <span>{asset.name}</span>
          <small>{asset.mediaType} · {asset.content.length.toLocaleString()} characters</small>
        </span>
      </summary>
      {open ? (
        <div>
          <div className="motif-cs-agent-viewer-actions">
            <button aria-label={`Copy full asset ${asset.name}`} className="motif-cs-mini-button" type="button" onClick={() => void copyText(`Asset ${asset.name}`, asset.content)}>Copy full asset</button>
            <button aria-label={`Download asset ${asset.name}`} className="motif-cs-mini-button" type="button" onClick={() => void downloadText(filename, asset.content, asset.mediaType)}>Download</button>
          </div>
          <pre aria-label={`${asset.name} inert text preview`} tabIndex={0}>{preview}</pre>
          {truncated ? <p>Preview limited to {ASSET_PREVIEW_CHARACTERS.toLocaleString()} characters. Copy or download retains the complete inert asset.</p> : null}
        </div>
      ) : null}
    </details>
  );
}

function AssetList({
  assets,
  resultName,
  copyText,
  downloadText,
}: {
  assets: readonly ArtifactAnalysisAsset[];
  resultName: string;
} & ResultTextActions) {
  const pageCount = Math.max(1, Math.ceil(assets.length / ASSET_PAGE_SIZE));
  const resetToken = assets.map((asset) => asset.id).join('\u0000');
  const { pageIndex, setRequestedPage } = useBoundedPage(pageCount, resetToken);
  if (assets.length === 0) return null;
  const start = pageIndex * ASSET_PAGE_SIZE;
  const visibleAssets = assets.slice(start, start + ASSET_PAGE_SIZE);
  return (
    <section className="motif-cs-agent-assets" aria-label="Linked inert assets">
      <strong>Linked assets · {assets.length.toLocaleString()}</strong>
      {visibleAssets.map((asset) => (
        <AssetViewer key={asset.id} asset={asset} copyText={copyText} downloadText={downloadText} />
      ))}
      <PagingControls
        label={`Linked asset pages for ${resultName}`}
        pageIndex={pageIndex}
        pageCount={pageCount}
        itemStart={start + 1}
        itemEnd={start + visibleAssets.length}
        itemCount={assets.length}
        onPage={setRequestedPage}
      />
    </section>
  );
}

function ReportViewer({
  result,
  assetsById,
  copyText,
  downloadText,
}: {
  result: ReportResult;
  assetsById: ReadonlyMap<string, ArtifactAnalysisAsset>;
} & ResultTextActions) {
  const report = resolveArtifactReport(result, assetsById);
  if (!report) return <p className="motif-cs-agent-viewer-warning" role="alert">The report body asset is unavailable.</p>;
  const extension = report.format === 'markdown' ? 'md' : 'txt';
  const mediaType = report.format === 'markdown' ? 'text/markdown' : 'text/plain';
  const filename = safeAnalysisFilename(result.name, 'analysis-report', extension);
  return (
    <section className="motif-cs-agent-data-viewer" aria-label={`${result.name} report viewer`}>
      <div className="motif-cs-agent-viewer-head">
        <div>
          <strong>Full report</strong>
          <small>{report.format === 'markdown' ? 'Markdown shown as inert source text' : 'Plain text'} · {report.text.length.toLocaleString()} characters</small>
        </div>
        <div className="motif-cs-agent-viewer-actions">
          <button aria-label={`Copy report ${result.name}`} className="motif-cs-mini-button" type="button" onClick={() => void copyText(`Report ${result.name}`, report.text)}>Copy report</button>
          <button aria-label={`Download report ${result.name}`} className="motif-cs-mini-button" type="button" onClick={() => void downloadText(filename, report.text, mediaType)}>Download</button>
        </div>
      </div>
      <PagedTextViewer text={report.text} label={`${result.name} safe text preview`} />
    </section>
  );
}

function TableViewer({ result, copyText, downloadText }: { result: TableResult } & ResultTextActions) {
  const rowCount = result.data.rows.length;
  const rowsPerPage = Math.max(1, Math.min(
    TABLE_PAGE_SIZE,
    Math.floor(TABLE_BODY_CELL_BUDGET / Math.max(1, result.data.columns.length)),
  ));
  const pageCount = Math.max(1, Math.ceil(rowCount / rowsPerPage));
  const { pageIndex, setRequestedPage } = useBoundedPage(pageCount, result.data.rows);
  const start = pageIndex * rowsPerPage;
  const visibleRows = result.data.rows.slice(start, start + rowsPerPage);
  const hasTruncatedCells = useMemo(() => result.data.rows.some((row) => row.some((cell) => (
    typeof cell === 'string' && cell.length > TABLE_CELL_PREVIEW_CHARACTERS
  ))), [result.data.rows]);
  const filename = safeAnalysisFilename(result.name, 'analysis-table', 'tsv');
  const copyTable = () => copyText(`Table ${result.name}`, artifactTableToTsv(result.data));
  const downloadTable = () => downloadText(filename, artifactTableToTsv(result.data), 'text/tab-separated-values');
  return (
    <section className="motif-cs-agent-data-viewer" aria-label={`${result.name} table viewer`}>
      <div className="motif-cs-agent-viewer-head">
        <div>
          <strong>Full table</strong>
          <small>{rowCount.toLocaleString()} rows · {result.data.columns.length.toLocaleString()} columns</small>
          {hasTruncatedCells ? <small>Cell previews are limited to {TABLE_CELL_PREVIEW_CHARACTERS.toLocaleString()} characters; TSV retains complete values.</small> : null}
        </div>
        <div className="motif-cs-agent-viewer-actions">
          <button aria-label={`Copy table ${result.name} as TSV`} className="motif-cs-mini-button" type="button" onClick={() => void copyTable()}>Copy TSV</button>
          <button aria-label={`Download table ${result.name} as TSV`} className="motif-cs-mini-button" type="button" onClick={() => void downloadTable()}>Download TSV</button>
        </div>
      </div>
      <div className="motif-cs-agent-table-scroll" role="region" aria-label={`${result.name} safe text preview`} tabIndex={0}>
        <table aria-label={`${result.name} data table`}>
          <thead>
            <tr>{result.data.columns.map((column) => <th key={column.id} scope="col">{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {visibleRows.map((row, rowOffset) => (
              <tr key={start + rowOffset}>
                {row.map((cell, cellIndex) => {
                  const text = cell === null ? '' : String(cell);
                  const preview = text.length > TABLE_CELL_PREVIEW_CHARACTERS
                    ? `${boundedTextPreview(text, TABLE_CELL_PREVIEW_CHARACTERS)}…`
                    : text;
                  return <td key={result.data.columns[cellIndex]?.id ?? cellIndex}>{preview}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rowCount === 0 ? <p>No table rows were saved.</p> : null}
      </div>
      <PagingControls
        label={`Table pages for ${result.name}`}
        pageIndex={pageIndex}
        pageCount={pageCount}
        itemStart={rowCount === 0 ? 0 : start + 1}
        itemEnd={start + visibleRows.length}
        itemCount={rowCount}
        onPage={setRequestedPage}
      />
    </section>
  );
}

function blastCoordinate(start: number | undefined, end: number | undefined): string {
  return start === undefined || end === undefined ? '—' : `${start.toLocaleString()}–${end.toLocaleString()}`;
}

function blastEValue(value: number): string {
  if (value === 0) return '0';
  return value < 0.001 ? value.toExponential(2) : value.toLocaleString(undefined, { maximumSignificantDigits: 4 });
}

function BlastAlignmentEvidence({
  hit,
  asset,
  copyText,
  downloadText,
}: {
  hit: ArtifactBlastHit;
  asset: ArtifactAnalysisAsset | undefined;
} & ResultTextActions) {
  const [open, setOpen] = useState(false);
  const evidenceId = useId();
  if (!hit.alignmentAssetId) return <span className="motif-cs-agent-no-evidence">—</span>;
  if (!asset) return <span className="motif-cs-agent-no-evidence">Unavailable</span>;
  const preview = open ? boundedTextPreview(asset.content, ASSET_PREVIEW_CHARACTERS) : '';
  const filename = safeAnalysisFilename(asset.name || `${hit.accession}-alignment`, 'blast-alignment', assetExtension(asset));
  return (
    <div className="motif-cs-agent-blast-evidence">
      <button
        className="motif-cs-mini-button"
        type="button"
        aria-label={`${open ? 'Hide' : 'Show'} alignment ${hit.accession}`}
        aria-expanded={open}
        aria-controls={evidenceId}
        onClick={() => setOpen((value) => !value)}
      >{open ? 'Hide' : 'Show'} alignment</button>
      {open ? (
        <div id={evidenceId}>
          <div className="motif-cs-agent-viewer-actions">
            <button aria-label={`Copy full evidence ${hit.accession}`} className="motif-cs-mini-button" type="button" onClick={() => void copyText(`BLAST alignment ${hit.accession}`, asset.content)}>Copy full evidence</button>
            <button aria-label={`Download alignment ${hit.accession}`} className="motif-cs-mini-button" type="button" onClick={() => void downloadText(filename, asset.content, asset.mediaType)}>Download</button>
          </div>
          <pre aria-label={`${hit.accession} bounded alignment evidence`} tabIndex={0}>{preview}</pre>
          {preview.length < asset.content.length ? <p>Showing the first {preview.length.toLocaleString()} of {asset.content.length.toLocaleString()} characters. Copy or download retains the complete evidence.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function BlastViewer({
  result,
  assetsById,
  copyText,
  downloadText,
}: {
  result: BlastResult;
  assetsById: ReadonlyMap<string, ArtifactAnalysisAsset>;
} & ResultTextActions) {
  const [sortKey, setSortKey] = useState<ArtifactBlastSortKey>('evalue');
  const sortedHits = useMemo(() => sortArtifactBlastHits(result.data.hits, sortKey), [result.data.hits, sortKey]);
  const pageCount = Math.max(1, Math.ceil(sortedHits.length / BLAST_PAGE_SIZE));
  const { pageIndex, setRequestedPage } = useBoundedPage(pageCount, result.data.hits);
  const start = pageIndex * BLAST_PAGE_SIZE;
  const visibleHits = sortedHits.slice(start, start + BLAST_PAGE_SIZE);
  return (
    <section className="motif-cs-agent-data-viewer" aria-label={`${result.name} safe text preview`}>
      <div className="motif-cs-agent-viewer-head">
        <div>
          <strong>BLAST hits</strong>
          <small>{sortedHits.length.toLocaleString()} saved hits · inert evidence only</small>
        </div>
        <label className="motif-cs-agent-blast-sort">
          <span>Sort hits</span>
          <select
            value={sortKey}
            onChange={(event) => {
              setSortKey(event.target.value as ArtifactBlastSortKey);
              setRequestedPage(0);
            }}
          >
            {BLAST_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      {visibleHits.length === 0 ? <p className="motif-cs-agent-viewer-warning">No BLAST hits were saved.</p> : (
        <div className="motif-cs-agent-table-scroll" role="region" aria-label={`${result.name} BLAST hit table`} tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th scope="col">Accession</th>
                <th scope="col">Description</th>
                <th scope="col">Identity</th>
                <th scope="col">Coverage</th>
                <th scope="col">E-value</th>
                <th scope="col">Bit score</th>
                <th scope="col">Query</th>
                <th scope="col">Subject</th>
                <th scope="col">Alignment evidence</th>
              </tr>
            </thead>
            <tbody>
              {visibleHits.map((hit, hitOffset) => (
                <tr key={`${hit.accession}:${start + hitOffset}`}>
                  <td><code>{hit.accession}</code></td>
                  <td>{hit.title}</td>
                  <td>{hit.identityPercent.toFixed(1)}%</td>
                  <td>{hit.queryCoveragePercent.toFixed(1)}%</td>
                  <td>{blastEValue(hit.eValue)}</td>
                  <td>{hit.bitScore.toLocaleString()}</td>
                  <td>{blastCoordinate(hit.queryStart, hit.queryEnd)}</td>
                  <td>{blastCoordinate(hit.subjectStart, hit.subjectEnd)}</td>
                  <td>
                    <BlastAlignmentEvidence
                      hit={hit}
                      asset={hit.alignmentAssetId ? assetsById.get(hit.alignmentAssetId) : undefined}
                      copyText={copyText}
                      downloadText={downloadText}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PagingControls
        label={`BLAST hit pages for ${result.name}`}
        pageIndex={pageIndex}
        pageCount={pageCount}
        itemStart={sortedHits.length === 0 ? 0 : start + 1}
        itemEnd={start + visibleHits.length}
        itemCount={sortedHits.length}
        onPage={setRequestedPage}
      />
    </section>
  );
}

function ResultDataViewer({
  result,
  assetsById,
  copyText,
  downloadText,
}: {
  result: ArtifactAnalysisResult;
  assetsById: ReadonlyMap<string, ArtifactAnalysisAsset>;
} & ResultTextActions) {
  if (result.kind === 'report') return <ReportViewer result={result} assetsById={assetsById} copyText={copyText} downloadText={downloadText} />;
  if (result.kind === 'table') return <TableViewer result={result} copyText={copyText} downloadText={downloadText} />;
  if (result.kind === 'blast_search') return <BlastViewer result={result} assetsById={assetsById} copyText={copyText} downloadText={downloadText} />;
  const preview = constructVerificationPreview(result);
  return preview ? <pre aria-label={`${result.name} safe text preview`} tabIndex={0}>{preview}</pre> : null;
}

function AnalysisResultRow({
  result,
  assetsById,
  recordNames,
  freshness,
  pendingDelete,
  cancelRef,
  setDeleteRef,
  onRevealRecord,
  onRequestRemove,
  onCancelRemove,
  onConfirmRemove,
  copyText,
  downloadText,
}: {
  result: ArtifactAnalysisResult;
  assetsById: ReadonlyMap<string, ArtifactAnalysisAsset>;
  recordNames: Readonly<Record<string, string>>;
  freshness: ScientificFreshnessDisplayEvaluation | undefined;
  pendingDelete: boolean;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  setDeleteRef: (element: HTMLButtonElement | null) => void;
  onRevealRecord: (recordId: string) => void;
  onRequestRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
} & ResultTextActions) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const linkedAssets = useMemo(() => (
    detailsOpen ? artifactAnalysisResultAssets(result, assetsById) : []
  ), [assetsById, detailsOpen, result]);
  const revealId = result.inputRecordIds.find((id) => recordNames[id]);
  const engine = result.provenance.engine
    ? `${result.provenance.engine}${result.provenance.engineVersion ? ` ${result.provenance.engineVersion}` : ''}`
    : result.provenance.source;
  return (
    <article className="motif-cs-agent-result-row" data-testid={`analysis-result-${result.id}`}>
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

      <details className="motif-cs-agent-result-details" onToggle={(event) => setDetailsOpen(event.currentTarget.open)}>
        <summary>Provenance &amp; Data</summary>
        {detailsOpen ? (
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
                <div><dt>Assets</dt><dd>{assetListSummary(linkedAssets)}</dd></div>
              ) : null}
            </dl>
            <ResultDataViewer result={result} assetsById={assetsById} copyText={copyText} downloadText={downloadText} />
            <AssetList assets={linkedAssets} resultName={result.name} copyText={copyText} downloadText={downloadText} />
          </div>
        ) : null}
      </details>

      {pendingDelete ? (
        <div
          className="motif-cs-agent-result-actions motif-cs-agent-result-confirm"
          role="group"
          aria-label={`Confirm removal of ${result.name}`}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            onCancelRemove();
          }}
        >
          <span>Remove this saved result? Linked assets are retained when still in use.</span>
          <button ref={cancelRef} className="motif-cs-mini-button" type="button" onClick={onCancelRemove}>Cancel</button>
          <button className="motif-cs-mini-button motif-cs-confirm-delete" type="button" onClick={onConfirmRemove}>Remove Result</button>
        </div>
      ) : (
        <div className="motif-cs-agent-result-actions">
          {revealId ? <button className="motif-cs-mini-button" type="button" onClick={() => onRevealRecord(revealId)}>Reveal Input</button> : null}
          <button
            ref={setDeleteRef}
            className="motif-cs-mini-button"
            type="button"
            onClick={onRequestRemove}
            aria-label={`Remove ${result.name}`}
          >Remove</button>
        </div>
      )}
    </article>
  );
}

export function ClaudeScienceAgentResultsPanel({
  results,
  assets,
  recordNames,
  freshnessByResultId,
  onRevealRecord,
  onRemove,
  onCopyText,
  onDownloadText,
}: ClaudeScienceAgentResultsPanelProps) {
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [visibleCount, setVisibleCount] = useState(RESULT_PAGE_SIZE);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusIdRef = useRef<string | null>(null);
  const showFirstResultsRef = useRef<HTMLButtonElement>(null);
  const showMoreResultsRef = useRef<HTMLButtonElement>(null);
  const paginationFocusTargetRef = useRef<'first' | 'more' | null>(null);
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const ordered = useMemo(() => results
    .filter((result) => filter === 'all' || FILTER_KINDS[filter].has(result.kind))
    .map((result, originalIndex) => ({ result, originalIndex }))
    .sort((left, right) => (
      Date.parse(right.result.createdAt) - Date.parse(left.result.createdAt)
      || left.result.id.localeCompare(right.result.id)
      || left.originalIndex - right.originalIndex
    ))
    .map(({ result }) => result), [filter, results]);
  const previousOrderedLengthRef = useRef(ordered.length);
  const visibleResults = ordered.slice(0, visibleCount);
  const remainingCount = Math.max(0, ordered.length - visibleResults.length);

  useLayoutEffect(() => {
    const previousLength = previousOrderedLengthRef.current;
    previousOrderedLengthRef.current = ordered.length;
    if (ordered.length >= previousLength) return;
    const lastFullWindow = Math.max(
      RESULT_PAGE_SIZE,
      Math.floor(ordered.length / RESULT_PAGE_SIZE) * RESULT_PAGE_SIZE,
    );
    setVisibleCount((current) => Math.min(current, lastFullWindow));
  }, [ordered.length]);

  useLayoutEffect(() => {
    if (pendingDeleteId) {
      cancelRef.current?.focus();
      return;
    }
    const id = restoreFocusIdRef.current;
    restoreFocusIdRef.current = null;
    if (id) deleteRefs.current.get(id)?.focus();
  }, [pendingDeleteId]);

  useLayoutEffect(() => {
    const target = paginationFocusTargetRef.current;
    paginationFocusTargetRef.current = null;
    if (target === 'first') showFirstResultsRef.current?.focus();
    if (target === 'more') showMoreResultsRef.current?.focus();
  }, [visibleResults.length]);

  const cancelDelete = (resultId: string) => {
    restoreFocusIdRef.current = resultId;
    setPendingDeleteId(null);
  };

  const confirmDelete = (resultId: string) => {
    const removed = onRemove(resultId);
    setPendingDeleteId(null);
    setStatus(removed === false ? 'Remove dependent analysis results first.' : 'Analysis result removed.');
  };

  const showFirstResults = () => {
    paginationFocusTargetRef.current = 'more';
    setVisibleCount(RESULT_PAGE_SIZE);
  };

  const showMoreResults = () => {
    const nextCount = Math.min(visibleResults.length + RESULT_PAGE_SIZE, ordered.length);
    paginationFocusTargetRef.current = nextCount >= ordered.length ? 'first' : 'more';
    setVisibleCount(nextCount);
  };

  const copyText = async (label: string, content: string) => {
    try {
      if (onCopyText) await onCopyText(label, content);
      else await copyTextInBrowser(content);
      setStatus(`${label} copied.`);
    } catch {
      setStatus(`${label} could not be copied.`);
    }
  };

  const downloadText = async (filename: string, content: string, mediaType: string) => {
    try {
      if (onDownloadText) {
        await onDownloadText(filename, content, mediaType);
        setStatus(`Download requested for ${filename}. Verify the file before relying on it.`);
        return;
      }
      setStatus(requestBrowserTextDownload(filename, content, mediaType).message);
    } catch {
      setStatus(`Download could not be requested for ${filename}.`);
    }
  };

  return (
    <section className="motif-cs-agent-results" aria-label="Agent and analysis results">
      <div className="motif-cs-agent-results-toolbar">
        <label>
          <span>Show</span>
          <select
            name="analysis-result-filter"
            autoComplete="off"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as ResultFilter);
              setVisibleCount(RESULT_PAGE_SIZE);
              setPendingDeleteId(null);
            }}
          >
            <option value="all">All Results</option>
            <option value="design">Design &amp; PCR</option>
            <option value="sequence">Sequence &amp; Structure</option>
            <option value="evidence">Reports &amp; Tables</option>
          </select>
        </label>
        <span>{visibleResults.length < ordered.length
          ? `${visibleResults.length.toLocaleString()} of ${ordered.length.toLocaleString()} shown`
          : `${ordered.length.toLocaleString()} shown`}</span>
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
          {visibleResults.map((result) => (
            <AnalysisResultRow
              key={result.id}
              result={result}
              assetsById={assetsById}
              recordNames={recordNames}
              freshness={freshnessByResultId?.get(result.id)}
              pendingDelete={pendingDeleteId === result.id}
              cancelRef={cancelRef}
              setDeleteRef={(element) => {
                if (element) deleteRefs.current.set(result.id, element);
                else deleteRefs.current.delete(result.id);
              }}
              onRevealRecord={onRevealRecord}
              onRequestRemove={() => setPendingDeleteId(result.id)}
              onCancelRemove={() => cancelDelete(result.id)}
              onConfirmRemove={() => confirmDelete(result.id)}
              copyText={copyText}
              downloadText={downloadText}
            />
          ))}
          {remainingCount > 0 || visibleResults.length > RESULT_PAGE_SIZE ? (
            <div className="motif-cs-agent-results-pagination" role="group" aria-label="Analysis result list pagination">
              <span aria-live="polite" aria-atomic="true">Showing {visibleResults.length.toLocaleString()} of {ordered.length.toLocaleString()}</span>
              {visibleResults.length > RESULT_PAGE_SIZE ? (
                <button ref={showFirstResultsRef} className="motif-cs-mini-button" type="button" onClick={showFirstResults}>Show first {RESULT_PAGE_SIZE}</button>
              ) : null}
              {remainingCount > 0 ? (
                <button
                  ref={showMoreResultsRef}
                  className="motif-cs-mini-button"
                  type="button"
                  onClick={showMoreResults}
                >Show {Math.min(RESULT_PAGE_SIZE, remainingCount).toLocaleString()} more</button>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
      <p className="motif-cs-agent-results-live" role="status" aria-live="polite" data-empty={!status || undefined}>{status}</p>
    </section>
  );
}

export default ClaudeScienceAgentResultsPanel;
