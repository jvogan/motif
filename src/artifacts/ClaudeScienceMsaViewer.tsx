import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import './claude-science-msa.css';
import { ChevronDown, ChevronLeft, ChevronRight, GripVertical, Play, Search, SlidersHorizontal, Trash2, UploadCloud } from 'lucide-react';
import { MSA_MAX_SEQ_LEN } from '../bio/msa';
import type { SangerTraceData } from '../bio/abi-import';
import { reverseComplement } from '../bio/reverse-complement';
import type { SequenceType, Topology } from '../bio/types';
import {
  ARTIFACT_MSA_MAX_LOCAL_SEQUENCES,
  ARTIFACT_MSA_MAX_IMPORT_BYTES,
  ARTIFACT_MSA_LOCAL_WORK_BUDGET,
  ArtifactAlignmentError,
  MSA_MOTIF_SEARCH_MAX_QUERY_LENGTH,
  clampMsaClientPoint,
  computeAlignmentImageLayout,
  computeMsaColumnStats,
  computeSequenceLogoColumns,
  createLocalArtifactAlignment,
  estimateLocalAlignmentWork,
  findMsaMotifMatches,
  formatAlignedFasta,
  formatClustal,
  formatConsensusFasta,
  moveRowId,
  msaColumnFromClientX,
  msaEdgeAutoScrollDelta,
  navigateMsaGridCell,
  msaShadeBucket,
  parseAlignmentText,
  residueColorKey,
  resolveMsaColorScheme,
  resolveResidueCellColor,
  safeAlignmentFilename,
  selectionToColumnsText,
  selectionToFasta,
  selectionToUngappedFasta,
  serializeArtifactAlignment,
  summarizeSelectionColumns,
  translateAlignedRow,
  type AlignmentImageLayout,
  type AlignmentImageScope,
  type ArtifactAlignment,
  type ArtifactMsaRecord,
  type MsaColorScheme,
  type MsaColumnStats,
  type MsaLogoColumn,
  type MsaMotifMatch,
  type MsaSelection,
  type MsaShadeMode,
} from './claude-science-msa';
import {
  ClaudeScienceSangerTraceViewer,
  hasLinkedSangerTrace,
} from './ClaudeScienceSangerTraceViewer';
import { preferredTraceOrientation } from './claude-science-sanger';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  MSA_ZOOM_MIN,
  MSA_ZOOM_MAX,
  normalizeClaudeScienceMsaViewPreferences,
  resolveMsaFitZoom,
  type ClaudeScienceMsaColorMode,
  type ClaudeScienceMsaEmphasisMode,
  type ClaudeScienceMsaRowSortMode,
  type ClaudeScienceMsaTextFormat,
  type ClaudeScienceMsaViewPreferences,
} from './claude-science-msa-view-preferences';

type ViewerRecord = ArtifactMsaRecord & {
  group?: string;
  topology?: Topology;
  sangerTrace?: SangerTraceData;
};

export type ClaudeScienceMsaRecordImportResult = {
  records: readonly ViewerRecord[];
  message: string;
  tone: 'status' | 'error';
};

type SourceMode = 'records' | 'import';
type TextFormat = ClaudeScienceMsaTextFormat;
type EmphasisMode = ClaudeScienceMsaEmphasisMode;
type ColorMode = ClaudeScienceMsaColorMode;
type RowSortMode = ClaudeScienceMsaRowSortMode;
type MsaMatrixVisibility = Pick<ClaudeScienceMsaViewPreferences,
  'showOverview' | 'showAlignmentAxis' | 'showTemplateAxis' | 'showRowStats' | 'showConservation'
  | 'showConservationHistogram' | 'showOccupancy' | 'showConsensus' | 'showSequenceLogo'
  | 'showTranslation' | 'showAminoAcidIndices'>;
type CoordinateSystem = 'alignment' | 'template';

const INPUT_FASTA_HEADER_MAX_LENGTH = 1_024;
const msaMatrixViewportSession = new Map<string, { left: number; top: number }>();
const EMPTY_MSA_SEARCH_RESULT = { matches: [] as MsaMotifMatch[], truncated: false };

export type PairwiseRowStats = {
  ungappedLength: number;
  comparableColumns: number;
  mismatches: number;
  identity: number;
};

type ArtifactAlignmentRow = ArtifactAlignment['rows'][number];

type AlignmentCoverage = { first: number; last: number } | null;

export type MsaCellOutcome = 'match' | 'substitution' | 'deletion' | 'insertion' | 'uncovered' | 'gap';

function alignmentCoverage(aligned: string): AlignmentCoverage {
  const first = aligned.search(/[^-]/);
  if (first < 0) return null;
  for (let last = aligned.length - 1; last >= first; last -= 1) {
    if (aligned[last] !== '-') return { first, last };
  }
  return null;
}

function coversColumn(coverage: AlignmentCoverage, column: number): boolean {
  return Boolean(coverage && column >= coverage.first && column <= coverage.last);
}

// eslint-disable-next-line react-refresh/only-export-components -- pure MSA helper exported for unit tests
export function classifyMsaCell(
  referenceResidue: string,
  rowResidue: string,
  isColumnCoveredByRow: boolean,
): MsaCellOutcome {
  if (referenceResidue === '-' && rowResidue === '-') return 'gap';
  if (rowResidue === '-' && !isColumnCoveredByRow) return 'uncovered';
  if (rowResidue === referenceResidue) return 'match';
  if (referenceResidue === '-') return 'insertion';
  if (rowResidue === '-') return 'deletion';
  return 'substitution';
}

function isMsaCellDifference(outcome: MsaCellOutcome): boolean {
  return outcome === 'substitution' || outcome === 'deletion' || outcome === 'insertion';
}

function templatePositionCoordinates(aligned: string): Array<number | null> {
  const coordinates = new Array<number | null>(aligned.length);
  let position = 0;
  for (let column = 0; column < aligned.length; column += 1) {
    if (aligned[column] === '-') coordinates[column] = null;
    else {
      position += 1;
      coordinates[column] = position;
    }
  }
  return coordinates;
}

export type ClaudeScienceMsaViewerProps = {
  records: readonly ViewerRecord[];
  alignments: readonly ArtifactAlignment[];
  activeRecordId?: string;
  activeAlignmentId: string | null;
  viewPreferences: ClaudeScienceMsaViewPreferences;
  onActiveAlignmentChange: (alignmentId: string | null) => void;
  onViewPreferencesChange: (preferences: ClaudeScienceMsaViewPreferences) => void;
  onSaveAlignment: (alignment: ArtifactAlignment) => ArtifactAlignment;
  onUpdateAlignmentTemplate: (alignmentId: string, rowId: string) => ArtifactAlignment | null;
  onDeleteAlignment: (alignmentId: string) => void;
  onImportRecords: (files: FileList | File[]) => Promise<ClaudeScienceMsaRecordImportResult>;
  onCopy: (label: string, content: string) => Promise<boolean>;
  onDownload: (filename: string, content: string, mime?: string) => void;
};

function compatibleDefaultIds(records: readonly ViewerRecord[], activeRecordId?: string): Set<string> {
  const active = records.find((record) => record.id === activeRecordId && record.sequence.length <= MSA_MAX_SEQ_LEN)
    ?? records.find((record) => record.sequence.length <= MSA_MAX_SEQ_LEN);
  if (!active) return new Set();
  const activeGroup = active.group?.trim().toLocaleLowerCase();
  if (!activeGroup) return new Set([active.id]);
  const partner = records.find((record) => (
    record.id !== active.id
    && record.type === active.type
    && record.sequence.length <= MSA_MAX_SEQ_LEN
    && record.group?.trim().toLocaleLowerCase() === activeGroup
  ));
  return new Set(partner ? [active.id, partner.id] : [active.id]);
}

const TRACE_TEMPLATE_MIN_INFORMATIVE_BASES = 24;
const TRACE_TEMPLATE_MIN_KMER_SUPPORT = 12;
const TRACE_TEMPLATE_MIN_SUPPORT_FRACTION = 0.35;

function normalizedRecordGroup(record: ViewerRecord): string {
  return record.group?.trim().toLocaleLowerCase() ?? '';
}

function traceSupportsTemplate(read: ViewerRecord, template: ViewerRecord): boolean {
  if (!read.sangerTrace || read.type !== 'dna' || template.type !== 'dna') return false;
  if (
    read.sequence.length < TRACE_TEMPLATE_MIN_INFORMATIVE_BASES
    || template.sequence.length < TRACE_TEMPLATE_MIN_INFORMATIVE_BASES
  ) return false;
  const kmerLength = Math.max(3, Math.min(7, read.sequence.length, template.sequence.length));
  let informativeWindows = 0;
  for (let index = 0; index <= read.sequence.length - kmerLength; index += 1) {
    if (/^[ACGT]+$/.test(read.sequence.slice(index, index + kmerLength))) informativeWindows += 1;
  }
  if (informativeWindows < TRACE_TEMPLATE_MIN_KMER_SUPPORT) return false;
  const preference = preferredTraceOrientation(read.sequence, template.sequence);
  const support = Math.max(preference.forwardSupport, preference.reverseSupport);
  return support >= Math.max(
    TRACE_TEMPLATE_MIN_KMER_SUPPORT,
    Math.ceil(informativeWindows * TRACE_TEMPLATE_MIN_SUPPORT_FRACTION),
  );
}

function shouldRetainTraceTemplate(
  candidate: ViewerRecord,
  importedTraces: readonly ViewerRecord[],
  explicitlySelectedTemplateId: string | null,
): boolean {
  if (candidate.id === explicitlySelectedTemplateId) return true;
  const candidateGroup = normalizedRecordGroup(candidate);
  if (candidateGroup && importedTraces.some((record) => normalizedRecordGroup(record) === candidateGroup)) return true;
  return importedTraces.some((record) => traceSupportsTemplate(record, candidate));
}

function engineMetadata(engine: string, version: string) {
  const definitions: Record<string, { id: string; label: string }> = {
    mafft: { id: 'mafft', label: 'MAFFT' },
    muscle: { id: 'muscle', label: 'MUSCLE' },
    'clustal-omega': { id: 'clustal-omega', label: 'Clustal Omega' },
    imported: { id: 'imported', label: 'Imported alignment' },
  };
  const definition = definitions[engine] ?? definitions.imported;
  return {
    ...definition,
    mode: engine === 'imported' ? 'imported' as const : 'local-command' as const,
    version: version.trim() || undefined,
  };
}

function formatAlignment(alignment: ArtifactAlignment, format: TextFormat): string {
  if (format === 'clustal') return formatClustal(alignment);
  if (format === 'consensus') return formatConsensusFasta(alignment);
  if (format === 'json') return `${JSON.stringify(serializeArtifactAlignment(alignment), null, 2)}\n`;
  return formatAlignedFasta(alignment);
}

function formatExtension(format: TextFormat): { extension: string; mime: string; label: string } {
  if (format === 'clustal') return { extension: 'aln', mime: 'text/plain', label: 'CLUSTAL' };
  if (format === 'consensus') return { extension: 'consensus.fasta', mime: 'text/plain', label: 'Consensus FASTA' };
  if (format === 'json') return { extension: 'json', mime: 'application/json', label: 'Alignment JSON' };
  return { extension: 'aligned.fasta', mime: 'text/plain', label: 'Aligned FASTA' };
}

// ===== Image export (PNG raster + SVG vector) =====
//
// Rendered from the alignment data model (the matrix DOM is column-virtualised).
// Colours come from resolveResidueCellColor, which mirrors the CSS scheme fills
// against a fixed, deterministic export background so PNG and SVG match the
// on-screen palette without depending on live CSS variables.
const MSA_IMAGE_EXPORT_BACKGROUND = '#ffffff';
const MSA_IMAGE_LABEL_BG = '#f4f1ea';
const MSA_IMAGE_TEXT_COLOR = '#16130f';
const MSA_IMAGE_MUTED_COLOR = '#6b6459';
const MSA_IMAGE_FONT_STACK = "ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas', monospace";

type ImageExportRow = { name: string; aligned: string; isTemplate: boolean };

/** Rows in export order: the reference/template row pinned first, then the rest
 * in stored order (a deterministic, drag/sort-independent ordering). */
function imageExportRows(alignment: ArtifactAlignment, referenceRowId: string): ImageExportRow[] {
  const template = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  const ordered = template
    ? [template, ...alignment.rows.filter((row) => row.id !== template.id)]
    : [...alignment.rows];
  return ordered.map((row) => ({ name: row.name, aligned: row.aligned, isTemplate: row.id === template?.id }));
}

/** Truncate a row label to fit the label gutter, appending an ellipsis. */
function fitImageLabel(name: string, labelWidth: number, fontSize: number): string {
  const maxChars = Math.max(1, Math.floor((labelWidth - 12) / Math.max(1, fontSize * 0.6)));
  if (name.length <= maxChars) return name;
  return maxChars <= 1 ? '…' : `${name.slice(0, maxChars - 1)}…`;
}

/** Column-tick spacing (in columns) aimed at roughly one label per ~64px. */
function imageColumnTickStep(cellWidth: number): number {
  const target = Math.max(1, Math.round(64 / Math.max(1, cellWidth)));
  const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1_000, 2_000, 5_000];
  return candidates.find((step) => step >= target) ?? 10_000;
}

function imageSubtitle(layout: AlignmentImageLayout): string {
  const first = layout.startColumn + 1;
  const last = layout.startColumn + layout.columnCount;
  return `columns ${first.toLocaleString()}–${last.toLocaleString()} · ${layout.rowCount} rows`;
}

/** Escape text for inclusion in the SVG document. */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => (
    char === '&' ? '&amp;'
      : char === '<' ? '&lt;'
        : char === '>' ? '&gt;'
          : char === '"' ? '&quot;'
            : '&#39;'
  ));
}

/** Binary download via an object URL + temporary anchor (onDownload is text-only). */
function downloadBlobFile(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Revoke on the next tick so the navigation to the blob has started.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Draw the alignment onto an off-DOM canvas sized from the layout. */
function renderAlignmentImageCanvas(
  rows: readonly ImageExportRow[],
  molecule: SequenceType,
  scheme: MsaColorScheme,
  layout: AlignmentImageLayout,
  title: string,
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  const ratio = Math.max(1, Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
  canvas.width = Math.round(layout.width * ratio);
  canvas.height = Math.round(layout.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  const bg = MSA_IMAGE_EXPORT_BACKGROUND;

  // Background + sticky label gutter.
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = MSA_IMAGE_LABEL_BG;
  ctx.fillRect(0, 0, layout.labelWidth, layout.height);

  // Title band.
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = MSA_IMAGE_TEXT_COLOR;
  ctx.font = `600 ${Math.max(10, Math.round(layout.titleHeight * 0.42))}px ${MSA_IMAGE_FONT_STACK}`;
  const titleMaxWidth = Math.max(1, layout.width - 16);
  ctx.fillText(title, 8, layout.titleHeight * 0.4, titleMaxWidth);
  ctx.fillStyle = MSA_IMAGE_MUTED_COLOR;
  ctx.font = `${Math.max(9, Math.round(layout.titleHeight * 0.3))}px ${MSA_IMAGE_FONT_STACK}`;
  ctx.fillText(imageSubtitle(layout), 8, layout.titleHeight * 0.76, titleMaxWidth);

  // Column axis ticks.
  const tickStep = imageColumnTickStep(layout.cellWidth);
  ctx.fillStyle = MSA_IMAGE_MUTED_COLOR;
  ctx.font = `${Math.max(8, Math.round(layout.axisHeight * 0.55))}px ${MSA_IMAGE_FONT_STACK}`;
  ctx.textAlign = 'center';
  for (let index = 0; index < layout.columnCount; index += 1) {
    const column = layout.startColumn + index;
    if (index !== 0 && (column + 1) % tickStep !== 0) continue;
    ctx.fillText(
      (column + 1).toString(),
      layout.labelWidth + (index + 0.5) * layout.cellWidth,
      layout.titleHeight + layout.axisHeight * 0.5,
      layout.cellWidth * 6,
    );
  }

  const cellFont = layout.drawLetters ? `${layout.fontSize}px ${MSA_IMAGE_FONT_STACK}` : '';
  const labelFontSize = Math.max(8, Math.min(layout.fontSize || 11, Math.round(layout.cellHeight * 0.62)));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const y = layout.headerHeight + rowIndex * layout.cellHeight;
    // Cell backgrounds (+0.5 overdraw removes hairline seams between tiles).
    for (let index = 0; index < layout.columnCount; index += 1) {
      const symbol = row.aligned[layout.startColumn + index] ?? '-';
      const fill = resolveResidueCellColor(symbol, molecule, scheme, bg);
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(layout.labelWidth + index * layout.cellWidth, y, layout.cellWidth + 0.5, layout.cellHeight + 0.5);
    }
    // Residue glyphs.
    if (layout.drawLetters) {
      ctx.fillStyle = MSA_IMAGE_TEXT_COLOR;
      ctx.font = cellFont;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let index = 0; index < layout.columnCount; index += 1) {
        const symbol = row.aligned[layout.startColumn + index] ?? '-';
        if (symbol === '-' || symbol === '.') continue;
        ctx.fillText(symbol, layout.labelWidth + (index + 0.5) * layout.cellWidth, y + layout.cellHeight / 2);
      }
    }
    // Row label (drawn last so it sits above any coloured cells).
    ctx.fillStyle = MSA_IMAGE_LABEL_BG;
    ctx.fillRect(0, y, layout.labelWidth, layout.cellHeight);
    ctx.fillStyle = row.isTemplate ? MSA_IMAGE_TEXT_COLOR : MSA_IMAGE_MUTED_COLOR;
    ctx.font = `${row.isTemplate ? '600 ' : ''}${labelFontSize}px ${MSA_IMAGE_FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitImageLabel(row.name, layout.labelWidth, labelFontSize), 8, y + layout.cellHeight / 2);
  }
  return canvas;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob === 'function') canvas.toBlob((blob) => resolve(blob), 'image/png');
    else resolve(null);
  });
}

/** Build a self-contained SVG document for the alignment (vector alternative). */
function renderAlignmentImageSvg(
  rows: readonly ImageExportRow[],
  molecule: SequenceType,
  scheme: MsaColorScheme,
  layout: AlignmentImageLayout,
  title: string,
): string {
  const bg = MSA_IMAGE_EXPORT_BACKGROUND;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}"`
    + ` viewBox="0 0 ${layout.width} ${layout.height}" font-family="${escapeXml(MSA_IMAGE_FONT_STACK)}">`,
  );
  parts.push(`<rect width="${layout.width}" height="${layout.height}" fill="${bg}"/>`);
  parts.push(`<rect width="${layout.labelWidth}" height="${layout.height}" fill="${MSA_IMAGE_LABEL_BG}"/>`);

  // Title band.
  const titleSize = Math.max(10, Math.round(layout.titleHeight * 0.42));
  const subSize = Math.max(9, Math.round(layout.titleHeight * 0.3));
  parts.push(`<text x="8" y="${layout.titleHeight * 0.4}" fill="${MSA_IMAGE_TEXT_COLOR}" font-size="${titleSize}" font-weight="600" dominant-baseline="middle">${escapeXml(title)}</text>`);
  parts.push(`<text x="8" y="${layout.titleHeight * 0.76}" fill="${MSA_IMAGE_MUTED_COLOR}" font-size="${subSize}" dominant-baseline="middle">${escapeXml(imageSubtitle(layout))}</text>`);

  // Column axis ticks.
  const tickStep = imageColumnTickStep(layout.cellWidth);
  const axisSize = Math.max(8, Math.round(layout.axisHeight * 0.55));
  for (let index = 0; index < layout.columnCount; index += 1) {
    const column = layout.startColumn + index;
    if (index !== 0 && (column + 1) % tickStep !== 0) continue;
    const x = layout.labelWidth + (index + 0.5) * layout.cellWidth;
    parts.push(`<text x="${x.toFixed(1)}" y="${layout.titleHeight + layout.axisHeight * 0.5}" fill="${MSA_IMAGE_MUTED_COLOR}" font-size="${axisSize}" text-anchor="middle" dominant-baseline="middle">${column + 1}</text>`);
  }

  const labelFontSize = Math.max(8, Math.min(layout.fontSize || 11, Math.round(layout.cellHeight * 0.62)));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const y = layout.headerHeight + rowIndex * layout.cellHeight;
    // Cell backgrounds.
    for (let index = 0; index < layout.columnCount; index += 1) {
      const symbol = row.aligned[layout.startColumn + index] ?? '-';
      const fill = resolveResidueCellColor(symbol, molecule, scheme, bg);
      if (!fill) continue;
      const x = layout.labelWidth + index * layout.cellWidth;
      parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(layout.cellWidth + 0.5).toFixed(2)}" height="${(layout.cellHeight + 0.5).toFixed(2)}" fill="${fill}"/>`);
    }
    // Residue glyphs.
    if (layout.drawLetters) {
      for (let index = 0; index < layout.columnCount; index += 1) {
        const symbol = row.aligned[layout.startColumn + index] ?? '-';
        if (symbol === '-' || symbol === '.') continue;
        const x = layout.labelWidth + (index + 0.5) * layout.cellWidth;
        parts.push(`<text x="${x.toFixed(1)}" y="${(y + layout.cellHeight / 2).toFixed(1)}" fill="${MSA_IMAGE_TEXT_COLOR}" font-size="${layout.fontSize}" text-anchor="middle" dominant-baseline="middle">${escapeXml(symbol)}</text>`);
      }
    }
    // Row label.
    parts.push(`<rect x="0" y="${y.toFixed(2)}" width="${layout.labelWidth}" height="${layout.cellHeight.toFixed(2)}" fill="${MSA_IMAGE_LABEL_BG}"/>`);
    parts.push(`<text x="8" y="${(y + layout.cellHeight / 2).toFixed(1)}" fill="${row.isTemplate ? MSA_IMAGE_TEXT_COLOR : MSA_IMAGE_MUTED_COLOR}" font-size="${labelFontSize}"${row.isTemplate ? ' font-weight="600"' : ''} dominant-baseline="middle">${escapeXml(fitImageLabel(row.name, layout.labelWidth, labelFontSize))}</text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}

function alignmentPickerLabels(alignments: readonly ArtifactAlignment[]): Map<string, string> {
  const grouped = new Map<string, ArtifactAlignment[]>();
  for (const alignment of alignments) {
    const key = alignment.name.trim().toLocaleLowerCase();
    grouped.set(key, [...(grouped.get(key) ?? []), alignment]);
  }
  const labels = new Map<string, string>();
  for (const group of grouped.values()) {
    if (group.length === 1) {
      labels.set(group[0].id, group[0].name);
      continue;
    }
    group.forEach((alignment, index) => {
      const engine = `${alignment.engine.label}${alignment.engine.version ? ` ${alignment.engine.version}` : ''}`;
      labels.set(alignment.id, `${alignment.name} — ${engine} · ${index + 1}`);
    });
  }
  return labels;
}

function engineModeLabel(mode: ArtifactAlignment['engine']['mode']): string {
  if (mode === 'browser') return 'In-browser preview';
  if (mode === 'local-command') return 'Local command';
  return 'Imported result';
}

function formatCreatedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date);
  return `${value.slice(0, 10)} · ${time}`;
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
}

function formatInputFasta(records: readonly ViewerRecord[]): string {
  const usedHeaders = new Set<string>();
  return `${records.map((record, index) => {
    const rawHeader = (record.name.trim().replace(/[>\r\n]+/g, ' ').replace(/\s+/g, '_') || `sequence_${index + 1}`)
      .slice(0, INPUT_FASTA_HEADER_MAX_LENGTH);
    let header = rawHeader;
    for (let suffix = 2; usedHeaders.has(header.toLowerCase()); suffix += 1) {
      const marker = `_${suffix}`;
      header = `${rawHeader.slice(0, INPUT_FASTA_HEADER_MAX_LENGTH - marker.length)}${marker}`;
    }
    usedHeaders.add(header.toLowerCase());
    const lines = record.sequence.match(/.{1,80}/g) ?? [''];
    return `>${header}\n${lines.join('\n')}`;
  }).join('\n')}\n`;
}

function inputFastaFilename(name: string): string {
  const stem = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${stem || 'alignment-inputs'}.fasta`;
}

function sequenceUnit(type: SequenceType): string {
  return type === 'protein' ? 'aa' : 'bp';
}

function residueTone(symbol: string, molecule: SequenceType): string {
  if (symbol === '-') return 'gap';
  if (molecule !== 'protein') {
    if (symbol === 'A') return 'a';
    if (symbol === 'C') return 'c';
    if (symbol === 'G') return 'g';
    if (symbol === 'T' || symbol === 'U') return 't';
    return 'ambiguous';
  }
  if ('AILMFWVY'.includes(symbol)) return 'hydrophobic';
  if ('KRH'.includes(symbol)) return 'positive';
  if ('DE'.includes(symbol)) return 'negative';
  if ('STNQ'.includes(symbol)) return 'polar';
  if ('GPC'.includes(symbol)) return 'special';
  return 'ambiguous';
}

type ResidueColorLegendItem = {
  residue: string;
  label: string;
};

const NUCLEOTIDE_LEGEND_ITEMS: readonly ResidueColorLegendItem[] = [
  { residue: 'A', label: 'A' },
  { residue: 'C', label: 'C' },
  { residue: 'G', label: 'G' },
  { residue: 'T', label: 'T' },
  { residue: 'N', label: 'Other / ambiguous' },
];

const CLUSTAL_LEGEND_ITEMS: readonly ResidueColorLegendItem[] = [
  { residue: 'A', label: 'Hydrophobic' },
  { residue: 'K', label: 'Positive' },
  { residue: 'D', label: 'Negative' },
  { residue: 'S', label: 'Polar' },
  { residue: 'H', label: 'Aromatic' },
  { residue: 'G', label: 'Glycine' },
  { residue: 'P', label: 'Proline' },
  { residue: 'C', label: 'Cysteine' },
  { residue: 'X', label: 'Other / ambiguous' },
];

const AUTO_PROTEIN_LEGEND_ITEMS: readonly ResidueColorLegendItem[] = [
  { residue: 'A', label: 'Hydrophobic' },
  { residue: 'K', label: 'Positive' },
  { residue: 'D', label: 'Negative' },
  { residue: 'S', label: 'Polar' },
  { residue: 'G', label: 'Special' },
  { residue: 'X', label: 'Other / ambiguous' },
];

const HYDROPHOBICITY_LEGEND_RESIDUES = ['R', 'P', 'G', 'A', 'I'] as const;

function ResidueColorLegend({ molecule, colorScheme }: {
  molecule: SequenceType;
  colorScheme: MsaColorScheme;
}) {
  const resolvedScheme = resolveMsaColorScheme(molecule, colorScheme);
  const schemeLabel = colorScheme === 'auto'
    ? molecule === 'protein' ? 'Automatic protein' : 'Automatic nucleotide'
    : resolvedScheme === 'nucleotide'
      ? 'Nucleotide'
      : resolvedScheme === 'clustal'
        ? 'Clustal protein'
        : resolvedScheme === 'hydrophobicity'
          ? 'Hydrophobicity'
          : 'Taylor';
  const legendItems = resolvedScheme === 'nucleotide'
    ? molecule === 'rna'
      ? [...NUCLEOTIDE_LEGEND_ITEMS.slice(0, 4), { residue: 'U', label: 'U' }, NUCLEOTIDE_LEGEND_ITEMS[4]]
      : NUCLEOTIDE_LEGEND_ITEMS
    : resolvedScheme === 'clustal'
      ? colorScheme === 'auto'
        ? AUTO_PROTEIN_LEGEND_ITEMS
        : CLUSTAL_LEGEND_ITEMS
      : [];

  return (
    <div
      className="motif-cs-msa-color-legend"
      data-testid="msa-color-legend"
      data-color-scheme={resolvedScheme}
      role="group"
      aria-label={`${schemeLabel} residue colour key`}
    >
      <div className="motif-cs-msa-color-legend-heading">
        <strong>Colour key</strong>
        <span>{schemeLabel}</span>
      </div>
      {resolvedScheme === 'taylor' ? (
        <p className="motif-cs-msa-color-legend-note">
          {molecule === 'protein'
            ? 'Each amino acid has its own colour.'
            : 'Residue colours vary by symbol.'}
        </p>
      ) : null}
      {resolvedScheme === 'hydrophobicity' ? (
        <div className="motif-cs-msa-color-legend-scale">
          <div className="motif-cs-msa-color-legend-scale-stops">
            {HYDROPHOBICITY_LEGEND_RESIDUES.map((residue, index) => (
              <span key={residue} className="motif-cs-msa-color-legend-scale-stop">
                <span
                  className="motif-cs-msa-symbol motif-cs-msa-color-legend-swatch"
                  data-color-key={residueColorKey(residue, molecule, colorScheme)}
                  aria-hidden="true"
                />
                <span>{index + 1}</span>
              </span>
            ))}
          </div>
          <div className="motif-cs-msa-color-legend-scale-labels">
            <span>Hydrophilic</span>
            <span>Hydrophobic</span>
          </div>
        </div>
      ) : null}
      {legendItems.length > 0 ? (
        <div className="motif-cs-msa-color-legend-items">
          {legendItems.map((item) => (
            <span key={`${item.residue}-${item.label}`} className="motif-cs-msa-color-legend-item">
              <span
                className="motif-cs-msa-symbol motif-cs-msa-color-legend-swatch"
                data-tone={colorScheme === 'auto' ? residueTone(item.residue, molecule) : undefined}
                data-color-key={colorScheme !== 'auto' ? residueColorKey(item.residue, molecule, colorScheme) : undefined}
                aria-hidden="true"
              />
              <span>{item.label}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- pure MSA helper exported for unit tests
export function differenceColumns(alignment: ArtifactAlignment, referenceRowId: string): number[] {
  const reference = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  if (!reference) return [];
  const referenceCoverage = alignmentCoverage(reference.aligned);
  const rowCoverage = new Map(alignment.rows.map((row) => [row.id, alignmentCoverage(row.aligned)]));
  const columns: number[] = [];
  for (let column = 0; column < alignment.alignmentLength; column += 1) {
    if (alignment.gapOnly[column] || !coversColumn(referenceCoverage, column)) continue;
    if (alignment.rows.some((row) => (
      row.id !== reference.id
      && isMsaCellDifference(classifyMsaCell(
        reference.aligned[column] ?? '-',
        row.aligned[column] ?? '-',
        coversColumn(rowCoverage.get(row.id) ?? null, column),
      ))
    ))) columns.push(column);
  }
  return columns;
}

function rowNameParts(name: string, allNames: readonly string[]): { leading: string; trailing: string } {
  const tokens = Array.from(name.matchAll(/[^\s_./-]+/g));
  if (tokens.length < 2) return { leading: name, trailing: '' };

  const allTokenLists = allNames.map((candidate) => (
    Array.from(candidate.matchAll(/[^\s_./-]+/g), (match) => match[0].toLocaleLowerCase())
  ));
  const ownTokens = tokens.map((match) => match[0].toLocaleLowerCase());
  for (let suffixLength = 1; suffixLength < tokens.length; suffixLength += 1) {
    const suffixKey = ownTokens.slice(-suffixLength).join('\u0000');
    const matches = allTokenLists.filter((candidateTokens) => (
      candidateTokens.slice(-suffixLength).join('\u0000') === suffixKey
    ));
    if (matches.length !== 1) continue;
    const suffixStart = tokens[tokens.length - suffixLength].index ?? 0;
    const leading = name.slice(0, suffixStart).replace(/[\s_./-]+$/u, '');
    const trailing = name.slice(suffixStart);
    if (leading && trailing.length <= 24) return { leading, trailing };
  }
  return { leading: name, trailing: '' };
}

// eslint-disable-next-line react-refresh/only-export-components -- pure MSA helper exported for unit tests
export function pairwiseRowStats(aligned: string, template: string): PairwiseRowStats {
  const rowCoverage = alignmentCoverage(aligned);
  const templateCoverage = alignmentCoverage(template);
  let ungappedLength = 0;
  let comparable = 0;
  let matches = 0;
  let mismatches = 0;
  for (let column = 0; column < Math.max(aligned.length, template.length); column += 1) {
    const symbol = aligned[column] ?? '-';
    const templateSymbol = template[column] ?? '-';
    if (symbol !== '-') ungappedLength += 1;
    if (!coversColumn(templateCoverage, column)) continue;
    const outcome = classifyMsaCell(templateSymbol, symbol, coversColumn(rowCoverage, column));
    if (outcome === 'match') {
      comparable += 1;
      matches += 1;
    } else if (isMsaCellDifference(outcome)) {
      comparable += 1;
      mismatches += 1;
    }
  }
  return {
    ungappedLength,
    comparableColumns: comparable,
    mismatches,
    identity: comparable > 0 ? Math.round((matches / comparable) * 10_000) / 100 : 0,
  };
}

function formatIdentity(identity: number): string {
  return identity < 100 && identity >= 99.9 ? identity.toFixed(2) : identity.toFixed(1);
}

function firstRowDifferenceColumn(aligned: string, template: string): number | null {
  const rowCoverage = alignmentCoverage(aligned);
  const templateCoverage = alignmentCoverage(template);
  for (let column = 0; column < Math.max(aligned.length, template.length); column += 1) {
    if (!coversColumn(templateCoverage, column)) continue;
    const outcome = classifyMsaCell(
      template[column] ?? '-',
      aligned[column] ?? '-',
      coversColumn(rowCoverage, column),
    );
    if (isMsaCellDifference(outcome)) return column;
  }
  return null;
}

function sortedMsaRows(
  rows: readonly ArtifactAlignmentRow[],
  template: ArtifactAlignmentRow | undefined,
  sortMode: RowSortMode,
  statsByRow: ReadonlyMap<string, PairwiseRowStats>,
): ArtifactAlignmentRow[] {
  const originalIndex = new Map(rows.map((row, index) => [row.id, index]));
  const nonTemplateRows = rows.filter((row) => row.id !== template?.id);
  nonTemplateRows.sort((left, right) => {
    const leftStats = statsByRow.get(left.id)!;
    const rightStats = statsByRow.get(right.id)!;
    if (sortMode === 'name') return left.name.localeCompare(right.name, undefined, { numeric: true });
    if (sortMode === 'identity') return rightStats.identity - leftStats.identity || left.name.localeCompare(right.name, undefined, { numeric: true });
    if (sortMode === 'mismatches') return leftStats.mismatches - rightStats.mismatches || left.name.localeCompare(right.name, undefined, { numeric: true });
    if (sortMode === 'length') return rightStats.ungappedLength - leftStats.ungappedLength || left.name.localeCompare(right.name, undefined, { numeric: true });
    return (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
  });
  return template ? [template, ...nonTemplateRows] : nonTemplateRows;
}

// eslint-disable-next-line react-refresh/only-export-components -- pure MSA helper exported for unit tests
export function mismatchOverviewBins(alignment: ArtifactAlignment, referenceRowId: string, binCount: number): number[] {
  const bins = Array.from({ length: binCount }, () => 0);
  if (alignment.alignmentLength === 0 || binCount === 0) return bins;
  const template = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  if (!template) return bins;
  const templateCoverage = alignmentCoverage(template.aligned);
  const rowCoverage = alignment.rows.map((row) => alignmentCoverage(row.aligned));
  for (let column = 0; column < alignment.alignmentLength; column += 1) {
    if (!coversColumn(templateCoverage, column)) continue;
    const templateSymbol = template.aligned[column] ?? '-';
    let comparable = 0;
    let mismatches = 0;
    for (const [rowIndex, row] of alignment.rows.entries()) {
      if (row.id === template.id) continue;
      const symbol = row.aligned[column] ?? '-';
      const outcome = classifyMsaCell(templateSymbol, symbol, coversColumn(rowCoverage[rowIndex], column));
      if (outcome === 'match') comparable += 1;
      else if (isMsaCellDifference(outcome)) {
        comparable += 1;
        mismatches += 1;
      }
    }
    const bin = Math.min(binCount - 1, Math.floor((column / alignment.alignmentLength) * binCount));
    bins[bin] = Math.max(bins[bin], comparable > 0 ? mismatches / comparable : 0);
  }
  return bins;
}

function useObservedWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Inclusive rectangular block: column and (ordered-row) index ranges. */
type MatrixSelection = { colStart: number; colEnd: number; rowStart: number; rowEnd: number };
/** Cell currently under the pointer, with client coords for the floating readout. */
type HoverCell = { column: number; rowIndex: number; rowId: string; clientX: number; clientY: number };
type MatrixActiveCell = { column: number; rowId: string };
type MatrixFocusRequest = MatrixActiveCell & { token: number };
type MatrixContextMenu = { x: number; y: number; column: number; rowId: string | null };
/** Live state while a row is being drag-reordered by its grip handle. */
type RowDragState = { id: string; fromIndex: number; overIndex: number | null; edge: 'before' | 'after' };
type DragAutoScrollAxes = { horizontal: boolean; vertical: boolean };
type DragAutoScrollState = DragAutoScrollAxes & {
  clientX: number;
  clientY: number;
  resolve: () => void;
};

// Column density. The font-derived base cell width is scaled by the zoom
// preference (decoupled from font size); the result is clamped so cells never
// collapse to nothing or grow unreasonably. Below the legibility floor the
// viewer drops letters for a birdseye "blocks" rendering.
const MSA_BASE_CELL_MIN = 8;
const MSA_BASE_CELL_MAX = 15;
const MSA_CELL_MIN = 3;
const MSA_CELL_MAX = 30;
const MSA_LETTER_MIN = 6.5;
// Overlay geometry mirrors the fixed row heights in the viewer stylesheet.
const MSA_MATRIX_ROW_HEIGHT = 30;
const MSA_RULER_ROW_HEIGHT = 27;
// Sequence-logo track: plotting height (must match .motif-cs-msa-logo-row in
// the CSS) and the smallest glyph, in px, still worth drawing in a segment.
const MSA_LOGO_TRACK_HEIGHT = 46;
const MSA_LOGO_LETTER_MIN_PX = 7;

function MsaRowStatsPanel({
  alignment,
  referenceRowId,
  sortMode,
  onSortModeChange,
  onJump,
}: {
  alignment: ArtifactAlignment;
  referenceRowId: string;
  sortMode: RowSortMode;
  onSortModeChange: (sortMode: RowSortMode) => void;
  onJump: (rowId: string, column: number) => void;
}) {
  // Collapsed by default: an open panel of every row would consume the MSA
  // window's bounded height and push the matrix out of its clipped viewport.
  const [open, setOpen] = useState(false);
  const template = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  const statsByRow = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    pairwiseRowStats(row.aligned, template?.aligned ?? ''),
  ])), [alignment.rows, template]);
  const orderedRows = useMemo(
    () => sortedMsaRows(alignment.rows, template, sortMode, statsByRow),
    [alignment.rows, sortMode, statsByRow, template],
  );
  const firstDifferenceByRow = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    firstRowDifferenceColumn(row.aligned, template?.aligned ?? ''),
  ])), [alignment.rows, template]);
  const activeSortLabel = sortMode === 'original'
    ? 'Original order'
    : sortMode === 'name'
      ? 'Name'
      : sortMode === 'identity'
        ? 'Identity'
        : sortMode === 'mismatches'
          ? 'Differences'
          : 'Length';
  const sortDirection = (mode: RowSortMode): 'ascending' | 'descending' | 'none' => {
    if (sortMode !== mode) return 'none';
    return mode === 'name' || mode === 'mismatches' ? 'ascending' : 'descending';
  };
  const sortIndicator = (mode: RowSortMode): string => {
    if (sortMode !== mode) return '↕';
    return sortDirection(mode) === 'ascending' ? '↑' : '↓';
  };

  return (
    <details
      className="motif-cs-msa-row-stats-panel"
      data-testid="msa-row-stats-panel"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="motif-cs-msa-row-stats-summary-copy">
          <strong>Row statistics</strong>
          <small>Compared with {template?.name ?? 'template'}</small>
        </span>
        <span className="motif-cs-msa-row-stats-summary-meta">
          {alignment.rows.length.toLocaleString()} rows · {activeSortLabel}
        </span>
      </summary>
      <div className="motif-cs-msa-row-stats-scroll">
        <table data-testid="msa-row-stats-table">
          <caption className="motif-cs-visually-hidden">Per-row alignment statistics compared with the template row</caption>
          <thead>
            <tr>
              {([
                ['name', 'Name', 'Sort rows by name'],
                ['mismatches', 'Δ', 'Sort rows by differences'],
                ['length', 'Length', 'Sort rows by ungapped length'],
                ['identity', 'Identity', 'Sort rows by identity'],
              ] as const).map(([mode, label, ariaLabel]) => (
                <th key={mode} scope="col" aria-sort={sortDirection(mode)}>
                  <button
                    type="button"
                    data-testid={`msa-row-stats-sort-${mode}`}
                    data-active={sortMode === mode || undefined}
                    aria-label={ariaLabel}
                    aria-sort={sortDirection(mode)}
                    onClick={() => onSortModeChange(mode)}
                  >
                    <span>{label}</span>
                    <span className="motif-cs-msa-row-stats-sort-indicator" aria-hidden="true">{sortIndicator(mode)}</span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row) => {
              const stats = statsByRow.get(row.id) ?? pairwiseRowStats(row.aligned, template?.aligned ?? '');
              const isTemplate = row.id === template?.id;
              const firstDifference = firstDifferenceByRow.get(row.id) ?? null;
              const jump = firstDifference === null ? null : () => onJump(row.id, firstDifference);
              return (
                <tr
                  key={row.id}
                  data-testid="msa-row-stats-row"
                  data-row-id={row.id}
                  data-template={isTemplate || undefined}
                  data-jumpable={jump ? true : undefined}
                  data-first-difference-column={firstDifference === null ? undefined : firstDifference + 1}
                  onClick={jump ?? undefined}
                >
                  <td>
                    <span className="motif-cs-msa-row-stats-name">
                      {jump ? (
                        <button type="button" aria-label={`Jump ${row.name} to its first difference, alignment column ${firstDifference! + 1}`}>
                          {row.name}
                        </button>
                      ) : <span>{row.name}</span>}
                      {isTemplate ? <span className="motif-cs-msa-template-badge">Template</span> : null}
                    </span>
                  </td>
                  <td className="motif-cs-msa-row-stats-number">{stats.mismatches.toLocaleString()}</td>
                  <td className="motif-cs-msa-row-stats-number">{stats.ungappedLength.toLocaleString()} {sequenceUnit(alignment.molecule)}</td>
                  <td className="motif-cs-msa-row-stats-number">{formatIdentity(stats.identity)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function AlignmentMatrix({
  alignment,
  referenceRowId,
  emphasis,
  colorMode,
  colorScheme,
  shadeMode,
  fontSize,
  zoom,
  translationFrame,
  jumpColumn,
  jumpToken,
  jumpRowId,
  searchMatches,
  activeSearchMatch,
  focusRequest,
  searchActive,
  sortMode,
  visibility,
  resetToken,
  onTemplateChange,
  onCopy,
  onZoomChange,
  onVisibleColumnsChange,
}: {
  alignment: ArtifactAlignment;
  referenceRowId: string;
  emphasis: EmphasisMode;
  colorMode: ColorMode;
  colorScheme: MsaColorScheme;
  shadeMode: MsaShadeMode;
  fontSize: number;
  zoom: number;
  translationFrame: 0 | 1 | 2;
  jumpColumn: number | null;
  jumpToken: number;
  jumpRowId: string | null;
  searchMatches: readonly MsaMotifMatch[];
  activeSearchMatch: MsaMotifMatch | null;
  focusRequest: MatrixFocusRequest | null;
  searchActive: boolean;
  sortMode: RowSortMode;
  visibility: MsaMatrixVisibility;
  resetToken: number;
  onTemplateChange: (rowId: string) => void;
  onCopy: (label: string, content: string) => Promise<boolean>;
  onZoomChange: (zoom: number) => void;
  onVisibleColumnsChange: (range: { start: number; end: number }) => void;
}) {
  const [viewportRef, viewportWidth] = useObservedWidth<HTMLDivElement>();
  const initialViewport = useMemo(() => msaMatrixViewportSession.get(alignment.id), [alignment.id]);
  const [scrollLeft, setScrollLeft] = useState(initialViewport?.left ?? 0);
  const scrollFrameRef = useRef<number | null>(null);
  const dragAutoScrollFrameRef = useRef<number | null>(null);
  const dragAutoScrollStateRef = useRef<DragAutoScrollState | null>(null);
  const pendingScrollLeftRef = useRef(initialViewport?.left ?? 0);
  const pendingScrollTopRef = useRef(initialViewport?.top ?? 0);
  const lastResetTokenRef = useRef(resetToken);
  const overviewDraggingRef = useRef(false);
  const [selection, setSelection] = useState<MatrixSelection | null>(null);
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<MatrixContextMenu | null>(null);
  // The context menu's on-screen position after clamping to the viewport (raw
  // pointer coordinates in `contextMenu` would otherwise overflow near edges).
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  // Ephemeral, per-alignment manual row order (ids). Null falls back to the
  // template-pinned sortMode ordering; set once the user drags or key-moves a row.
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [rowDrag, setRowDrag] = useState<RowDragState | null>(null);
  const rowDragRef = useRef<RowDragState | null>(null);
  const [reorderStatus, setReorderStatus] = useState('');
  const selectionAnchorRef = useRef<{ column: number; rowIndex: number } | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const baseCellWidth = Math.max(MSA_BASE_CELL_MIN, Math.min(MSA_BASE_CELL_MAX, fontSize * 0.78 + 2));
  const cellWidth = Math.round(Math.max(MSA_CELL_MIN, Math.min(MSA_CELL_MAX, baseCellWidth * zoom)) * 10) / 10;
  const blocks = cellWidth < MSA_LETTER_MIN;
  // Shrink glyphs to fit narrowing cells as the user zooms out, so letters stay
  // legible (not overlapping) right down to the blocks threshold; never exceed
  // the chosen font size when zooming in.
  const renderFontSize = blocks ? fontSize : Math.min(fontSize, Math.max(7, Math.round(cellWidth * 1.32)));
  const prevCellWidthRef = useRef(cellWidth);
  const labelWidth = Math.max(150, Math.min(260, Math.round(viewportWidth * 0.3)));
  const sequenceViewportWidth = Math.max(120, viewportWidth - labelWidth);
  const overscan = 24;
  const visibleStartColumn = Math.max(0, Math.min(
    Math.max(0, alignment.alignmentLength - 1),
    Math.floor(scrollLeft / cellWidth),
  ));
  const visibleColumnCount = Math.max(1, Math.ceil(sequenceViewportWidth / cellWidth));
  const visibleEndColumn = Math.min(alignment.alignmentLength, visibleStartColumn + visibleColumnCount);
  const startColumn = Math.max(0, visibleStartColumn - overscan);
  const endColumn = Math.min(alignment.alignmentLength, visibleEndColumn + overscan);
  const sequenceWidth = alignment.alignmentLength * cellWidth;
  const totalWidth = labelWidth + sequenceWidth;
  const maxHorizontalScroll = Math.max(0, sequenceWidth - sequenceViewportWidth);
  const fitResolution = useMemo(() => resolveMsaFitZoom({
    baseCellWidth,
    columnCount: alignment.alignmentLength,
    viewportWidth: sequenceViewportWidth,
    minimumCellWidth: MSA_CELL_MIN,
    maximumCellWidth: MSA_CELL_MAX,
  }), [alignment.alignmentLength, baseCellWidth, sequenceViewportWidth]);
  const canFitAlignment = fitResolution.fits;
  const panThumbWidth = Math.max(
    36,
    Math.min(sequenceViewportWidth, sequenceViewportWidth * (sequenceViewportWidth / Math.max(sequenceViewportWidth, sequenceWidth))),
  );
  const template = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  const templateCoverage = useMemo(() => alignmentCoverage(template?.aligned ?? ''), [template]);
  const rowCoverageById = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    alignmentCoverage(row.aligned),
  ])), [alignment.rows]);
  const templateCoordinates = useMemo(
    () => templatePositionCoordinates(template?.aligned ?? ''),
    [template],
  );
  // Amino-acid translation of the reference row (nucleotide alignments only),
  // codons positioned against alignment columns; empty when the track is off.
  const translationCodons = useMemo(
    () => (visibility.showTranslation && alignment.molecule !== 'protein' && template
      ? translateAlignedRow(template.aligned, translationFrame)
      : []),
    [alignment.molecule, template, translationFrame, visibility.showTranslation],
  );
  const translationVisible = translationCodons.length > 0;

  // Per-row matched columns for search highlighting, and the active hit.
  const searchColumnsByRow = useMemo(() => {
    const map = new Map<string, Set<number>>();
    for (const match of searchMatches) {
      let columns = map.get(match.rowId);
      if (!columns) { columns = new Set<number>(); map.set(match.rowId, columns); }
      for (const column of match.columns) columns.add(column);
    }
    return map;
  }, [searchMatches]);
  const activeSearchColumns = useMemo(() => new Set(activeSearchMatch?.columns ?? []), [activeSearchMatch]);
  const activeSearchRowId = activeSearchMatch?.rowId ?? null;
  const statsByRow = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    pairwiseRowStats(row.aligned, template?.aligned ?? ''),
  ])), [alignment.rows, template]);
  const orderedRows = useMemo(() => {
    if (manualOrder) {
      const byId = new Map(alignment.rows.map((row) => [row.id, row] as const));
      const manual = manualOrder
        .map((id) => byId.get(id))
        .filter((row): row is ArtifactAlignment['rows'][number] => row !== undefined);
      // Only honour a manual order that still covers exactly the current rows;
      // anything else falls through to the template-pinned sort below. The
      // reference/template row always stays pinned at the top.
      if (manual.length === alignment.rows.length) {
        return template ? [template, ...manual.filter((row) => row.id !== template.id)] : manual;
      }
    }
    return sortedMsaRows(alignment.rows, template, sortMode, statsByRow);
  }, [alignment.rows, manualOrder, sortMode, statsByRow, template]);
  const [activeCell, setActiveCell] = useState<MatrixActiveCell | null>(() => {
    const row = orderedRows[0];
    if (!row || alignment.alignmentLength <= 0) return null;
    const initialColumn = Math.floor((initialViewport?.left ?? 0) / cellWidth);
    return {
      rowId: row.id,
      column: Math.max(0, Math.min(alignment.alignmentLength - 1, initialColumn)),
    };
  });
  const focusActiveCellRef = useRef(false);
  const activeRowIndex = activeCell ? orderedRows.findIndex((row) => row.id === activeCell.rowId) : -1;
  const activeCellIsRendered = Boolean(
    activeCell
    && activeRowIndex >= 0
    && activeCell.column >= startColumn
    && activeCell.column < endColumn,
  );
  const allRowNames = useMemo(() => alignment.rows.map((row) => row.name), [alignment.rows]);
  const rowLabelsById = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    rowNameParts(row.name, allRowNames),
  ])), [alignment.rows, allRowNames]);
  const overviewBinCount = Math.min(512, Math.max(1, alignment.alignmentLength));
  const overviewBins = useMemo(
    () => mismatchOverviewBins(alignment, template?.id ?? referenceRowId, overviewBinCount),
    [alignment, overviewBinCount, template, referenceRowId],
  );
  const overviewPath = useMemo(() => overviewBins.map((density, index) => {
    if (density <= 0) return '';
    const height = Math.max(3, density * 20);
    const top = Math.max(2, 22 - height);
    return `M${index} 22V${top}H${index + 1}V22Z`;
  }).join(''), [overviewBins]);
  const overviewLeft = alignment.alignmentLength > 0
    ? (visibleStartColumn / alignment.alignmentLength) * 100
    : 0;
  const overviewWidth = alignment.alignmentLength > 0
    ? Math.max(0.9, ((visibleEndColumn - visibleStartColumn) / alignment.alignmentLength) * 100)
    : 100;
  const overviewCenter = Math.min(
    Math.max(0, alignment.alignmentLength - 1),
    Math.floor((visibleStartColumn + Math.max(visibleStartColumn, visibleEndColumn - 1)) / 2),
  );
  const axisRows = Number(visibility.showAlignmentAxis) + Number(visibility.showTemplateAxis);
  const firstSequenceRow = axisRows + 1;
  const tableRowCount = axisRows
    + orderedRows.length
    + Number(visibility.showConservation)
    + Number(visibility.showConservationHistogram)
    + Number(visibility.showOccupancy)
    + Number(visibility.showConsensus)
    + Number(visibility.showSequenceLogo)
    + Number(translationVisible);

  const scrollToColumn = useCallback((column: number, behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const boundedColumn = Math.max(0, Math.min(Math.max(0, alignment.alignmentLength - 1), column));
    // Centre the cell's middle, not its left edge.
    const target = Math.max(0, Math.min(maxHorizontalScroll, ((boundedColumn + 0.5) * cellWidth) - (sequenceViewportWidth / 2)));
    viewport.scrollTo({ left: target, behavior });
  }, [alignment.alignmentLength, cellWidth, maxHorizontalScroll, sequenceViewportWidth, viewportRef]);

  const setZoom = useCallback((next: number) => {
    onZoomChange(Math.max(MSA_ZOOM_MIN, Math.min(MSA_ZOOM_MAX, Math.round(next * 100) / 100)));
  }, [onZoomChange]);

  // Use the greatest persisted zoom whose tenth-pixel cell width actually fits;
  // the pure resolver accounts for both renderer rounding stages.
  const fitZoom = useCallback(() => {
    if (alignment.alignmentLength === 0) return;
    setZoom(fitResolution.zoom);
  }, [alignment.alignmentLength, fitResolution.zoom, setZoom]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const saved = msaMatrixViewportSession.get(alignment.id);
    viewport.scrollLeft = saved?.left ?? 0;
    viewport.scrollTop = saved?.top ?? 0;
    pendingScrollLeftRef.current = viewport.scrollLeft;
    pendingScrollTopRef.current = viewport.scrollTop;
    setScrollLeft(viewport.scrollLeft);
  }, [alignment.id, viewportRef]);

  // Keep the same biological column centred when the cell width changes (zoom or
  // font size), rather than letting the retained pixel scroll shift the view.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const previous = prevCellWidthRef.current;
    prevCellWidthRef.current = cellWidth;
    if (!viewport || previous === cellWidth || previous <= 0) return;
    const centerColumn = (viewport.scrollLeft + sequenceViewportWidth / 2) / previous;
    const target = Math.max(0, Math.min(maxHorizontalScroll, (centerColumn * cellWidth) - (sequenceViewportWidth / 2)));
    viewport.scrollLeft = target;
    pendingScrollLeftRef.current = target;
    setScrollLeft(target);
  }, [cellWidth, maxHorizontalScroll, sequenceViewportWidth, viewportRef]);

  useEffect(() => {
    if (jumpColumn === null || !viewportRef.current) return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    scrollToColumn(jumpColumn, reducedMotion ? 'auto' : 'smooth');
  }, [jumpColumn, jumpToken, scrollToColumn, viewportRef]);

  // Bring a search hit's row into vertical view (horizontal is handled above).
  useEffect(() => {
    if (!jumpRowId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rowElement = viewport.querySelector<HTMLElement>(`[data-msa-row-id="${CSS.escape(jumpRowId)}"]`);
    if (!rowElement) return;
    const viewportRect = viewport.getBoundingClientRect();
    const rowRect = rowElement.getBoundingClientRect();
    const delta = (rowRect.top + rowRect.bottom) / 2 - (viewportRect.top + viewportRect.bottom) / 2;
    if (Math.abs(delta) > 4) viewport.scrollTop += delta;
  }, [jumpRowId, jumpToken, viewportRef]);

  useEffect(() => {
    if (lastResetTokenRef.current === resetToken) return;
    lastResetTokenRef.current = resetToken;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ left: 0, top: 0, behavior: 'auto' });
    pendingScrollLeftRef.current = 0;
    pendingScrollTopRef.current = 0;
    msaMatrixViewportSession.delete(alignment.id);
    setScrollLeft(0);
  }, [alignment.id, resetToken, viewportRef]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (dragAutoScrollFrameRef.current !== null) window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
    dragAutoScrollStateRef.current = null;
  }, []);

  // Surface the currently visible column window so the parent's image export can
  // honour the "Visible view" scope. Half-open [start, end) in alignment columns.
  useEffect(() => {
    onVisibleColumnsChange({ start: visibleStartColumn, end: visibleEndColumn });
  }, [visibleStartColumn, visibleEndColumn, onVisibleColumnsChange]);

  const handleScroll = (left: number, top: number) => {
    // The hover readout is anchored to a fixed screen point; once the content
    // moves under it, it would describe the wrong cell, so drop it on scroll.
    setHoverCell(null);
    pendingScrollLeftRef.current = left;
    pendingScrollTopRef.current = top;
    msaMatrixViewportSession.set(alignment.id, { left, top });
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollLeft(pendingScrollLeftRef.current);
    });
  };

  const setHorizontalScroll = useCallback((left: number, behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({
      left: Math.max(0, Math.min(maxHorizontalScroll, left)),
      behavior,
    });
  }, [maxHorizontalScroll, viewportRef]);

  const stopDragAutoScroll = useCallback(() => {
    dragAutoScrollStateRef.current = null;
    if (dragAutoScrollFrameRef.current === null) return;
    window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
    dragAutoScrollFrameRef.current = null;
  }, []);

  const runDragAutoScrollFrame = useCallback(function runDragAutoScrollFrame() {
    dragAutoScrollFrameRef.current = null;
    const drag = dragAutoScrollStateRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport) return;
    const rect = viewport.getBoundingClientRect();
    const horizontalDelta = drag.horizontal
      ? msaEdgeAutoScrollDelta(drag.clientX, rect.left + labelWidth, rect.right)
      : 0;
    const verticalDelta = drag.vertical
      ? msaEdgeAutoScrollDelta(drag.clientY, rect.top, rect.bottom)
      : 0;
    const maxVerticalScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const canScrollHorizontally = horizontalDelta < 0
      ? viewport.scrollLeft > 0
      : horizontalDelta > 0 && viewport.scrollLeft < maxHorizontalScroll;
    const canScrollVertically = verticalDelta < 0
      ? viewport.scrollTop > 0
      : verticalDelta > 0 && viewport.scrollTop < maxVerticalScroll;

    if (horizontalDelta !== 0) setHorizontalScroll(viewport.scrollLeft + horizontalDelta);
    if (verticalDelta !== 0) {
      viewport.scrollTop = Math.max(0, Math.min(maxVerticalScroll, viewport.scrollTop + verticalDelta));
    }
    drag.resolve();

    if (
      dragAutoScrollStateRef.current === drag
      && (canScrollHorizontally || canScrollVertically)
    ) {
      dragAutoScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScrollFrame);
    }
  }, [labelWidth, maxHorizontalScroll, setHorizontalScroll, viewportRef]);

  const updateDragAutoScroll = useCallback((
    clientX: number,
    clientY: number,
    axes: DragAutoScrollAxes,
    resolve: () => void,
  ) => {
    const drag = { clientX, clientY, ...axes, resolve };
    dragAutoScrollStateRef.current = drag;
    resolve();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const horizontalDelta = axes.horizontal
      ? msaEdgeAutoScrollDelta(clientX, rect.left + labelWidth, rect.right)
      : 0;
    const verticalDelta = axes.vertical
      ? msaEdgeAutoScrollDelta(clientY, rect.top, rect.bottom)
      : 0;
    if (horizontalDelta !== 0 || verticalDelta !== 0) {
      if (dragAutoScrollFrameRef.current === null) {
        dragAutoScrollFrameRef.current = window.requestAnimationFrame(runDragAutoScrollFrame);
      }
      return;
    }
    if (dragAutoScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
      dragAutoScrollFrameRef.current = null;
    }
  }, [labelWidth, runDragAutoScrollFrame, viewportRef]);

  const handleMatrixWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? sequenceViewportWidth
        : 1;
    const horizontalDelta = (event.shiftKey ? event.deltaY : event.deltaX) * deltaScale;
    // Treat the gesture as horizontal only when the user asked for it (Shift) or
    // the horizontal component dominates. A near-vertical diagonal (ordinary
    // trackpad noise) must keep its deltaY instead of being swallowed whole.
    if (event.shiftKey || (event.deltaX !== 0 && Math.abs(event.deltaX) >= Math.abs(event.deltaY))) {
      event.preventDefault();
      setHorizontalScroll(viewport.scrollLeft + horizontalDelta);
      return;
    }

    if (!event.deltaY) return;
    const maxVerticalScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const matrixCanContinue = event.deltaY < 0
      ? viewport.scrollTop > 0
      : viewport.scrollTop < maxVerticalScroll - 1;
    if (matrixCanContinue) return;

    const windowBody = viewport.closest<HTMLElement>('.motif-cs-window-body');
    if (!windowBody || windowBody === viewport || windowBody.scrollHeight <= windowBody.clientHeight) return;
    event.preventDefault();
    windowBody.scrollTop += event.deltaY * deltaScale;
  }, [sequenceViewportWidth, setHorizontalScroll, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    viewport.addEventListener('wheel', handleMatrixWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleMatrixWheel);
  }, [handleMatrixWheel, viewportRef]);

  const columnStats = useMemo<MsaColumnStats[]>(() => computeMsaColumnStats(alignment.rows, alignment.molecule), [alignment.rows, alignment.molecule]);
  // Only pay the O(rows × visible columns) logo pass when the track is on.
  const logoColumns = useMemo<MsaLogoColumn[]>(
    () => (visibility.showSequenceLogo
      ? computeSequenceLogoColumns(alignment.rows, alignment.molecule, { startColumn, endColumn })
      : []),
    [alignment.molecule, alignment.rows, endColumn, startColumn, visibility.showSequenceLogo],
  );
  const explicitScheme = colorMode === 'residue' && colorScheme !== 'auto';
  const shadeByColumn = shadeMode === 'identity' || shadeMode === 'conservation';
  // Colour cells by auto residue tone when the user asked for residue colours,
  // or whenever letters are hidden in blocks view (so the mosaic stays legible).
  // An explicit scheme keeps its own data-color-key fills instead.
  const toneColored = !explicitScheme && (colorMode === 'residue' || blocks);

  const selectingRef = useRef(false);
  const rulerSelectingRef = useRef(false);
  const hoverReadoutRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // The selected rows' ids in displayed order — always explicit (even for a
  // whole-height selection) so copy actions follow the visible order.
  const selectionRowIds = useMemo<string[]>(() => {
    if (!selection) return [];
    const ids: string[] = [];
    for (let index = selection.rowStart; index <= selection.rowEnd; index += 1) {
      const row = orderedRows[index];
      if (row) ids.push(row.id);
    }
    return ids;
  }, [orderedRows, selection]);

  const selectionSummary = useMemo(() => {
    if (!selection) return null;
    // Stats describe the SELECTED block only — slice each selected row to the
    // selected columns so unselected rows never skew the readout. Bounded by the
    // selection size, so it stays cheap even mid-drag on a wide alignment.
    const selectedRows = orderedRows
      .slice(selection.rowStart, selection.rowEnd + 1)
      .map((row) => ({ ...row, aligned: row.aligned.slice(selection.colStart, selection.colEnd + 1) }));
    const blockStats = computeMsaColumnStats(selectedRows, alignment.molecule);
    const stats = summarizeSelectionColumns(blockStats, { start: 0, end: selection.colEnd - selection.colStart });
    // Template coordinates: first/last non-gap position within the range, so a
    // gapped endpoint doesn't hide the whole template range.
    let startPosition: number | null = null;
    let endPosition: number | null = null;
    for (let column = selection.colStart; column <= selection.colEnd; column += 1) {
      if (templateCoordinates[column] != null) { startPosition = templateCoordinates[column]!; break; }
    }
    for (let column = selection.colEnd; column >= selection.colStart; column -= 1) {
      if (templateCoordinates[column] != null) { endPosition = templateCoordinates[column]!; break; }
    }
    return { stats, startPosition, endPosition, rows: selectedRows.length };
  }, [orderedRows, selection, templateCoordinates, alignment.molecule]);

  const columnFromClientX = useCallback((clientX: number, clampToViewport = false): number | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    return msaColumnFromClientX(clientX, {
      viewportLeft: rect.left,
      viewportRight: rect.right,
      labelWidth,
      scrollLeft: viewport.scrollLeft,
      cellWidth,
      columnCount: alignment.alignmentLength,
    }, clampToViewport);
  }, [alignment.alignmentLength, cellWidth, labelWidth, viewportRef]);

  const rowElementFromPoint = useCallback((clientX: number, clientY: number, nearest = false): HTMLElement | null => {
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const direct = target?.closest<HTMLElement>('[data-msa-row-index]') ?? null;
    if (direct || !nearest) return direct;
    const viewport = viewportRef.current;
    if (!viewport) return null;
    let nearestRow: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const row of viewport.querySelectorAll<HTMLElement>('[data-msa-row-index]')) {
      const rect = row.getBoundingClientRect();
      const distance = clientY < rect.top
        ? rect.top - clientY
        : clientY >= rect.bottom
          ? clientY - rect.bottom
          : 0;
      if (distance >= nearestDistance) continue;
      nearestRow = row;
      nearestDistance = distance;
    }
    return nearestRow;
  }, [viewportRef]);

  const pointToCell = useCallback((clientX: number, clientY: number, clampToViewport = false): HoverCell | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const point = clampToViewport
      ? clampMsaClientPoint(clientX, clientY, {
        left: rect.left + labelWidth,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })
      : { clientX, clientY };
    const column = columnFromClientX(point.clientX, clampToViewport);
    if (column == null) return null;
    const rowElement = rowElementFromPoint(point.clientX, point.clientY, clampToViewport);
    if (!rowElement) return null;
    const rowIndex = Number(rowElement.dataset.msaRowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= orderedRows.length) return null;
    return { column, rowIndex, rowId: rowElement.dataset.msaRowId ?? '', ...point };
  }, [columnFromClientX, labelWidth, orderedRows.length, rowElementFromPoint, viewportRef]);

  const applySelectionTo = useCallback((cell: { column: number; rowIndex: number }) => {
    const anchor = selectionAnchorRef.current;
    if (!anchor) return;
    setSelection({
      colStart: Math.min(anchor.column, cell.column),
      colEnd: Math.max(anchor.column, cell.column),
      rowStart: Math.min(anchor.rowIndex, cell.rowIndex),
      rowEnd: Math.max(anchor.rowIndex, cell.rowIndex),
    });
  }, []);

  const findGridCellElement = useCallback((cell: MatrixActiveCell): HTMLElement | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const row = Array.from(viewport.querySelectorAll<HTMLElement>('[data-msa-row-id]'))
      .find((candidate) => candidate.dataset.msaRowId === cell.rowId);
    return row?.querySelector<HTMLElement>(
      `[data-msa-grid-cell="true"][data-alignment-column="${cell.column + 1}"]`,
    ) ?? null;
  }, [viewportRef]);

  const activateCell = useCallback((cell: MatrixActiveCell, focus: boolean) => {
    if (cell.column < 0 || cell.column >= alignment.alignmentLength) return;
    if (!orderedRows.some((row) => row.id === cell.rowId)) return;
    focusActiveCellRef.current = focus;
    setActiveCell({ rowId: cell.rowId, column: cell.column });
  }, [alignment.alignmentLength, orderedRows]);

  // The active column may be outside the rendered symbol slice. Scroll first;
  // the scroll-state render adds that virtualized cell, then the retained focus
  // request places DOM focus on it. Rows are not virtualized, but can need a
  // small vertical nearest-edge adjustment in a short matrix viewport.
  useLayoutEffect(() => {
    if (!activeCell) return undefined;
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    if (!focusActiveCellRef.current) return undefined;

    const cellLeft = activeCell.column * cellWidth;
    const cellRight = cellLeft + cellWidth;
    if (cellLeft < viewport.scrollLeft) setHorizontalScroll(cellLeft);
    else if (cellRight > viewport.scrollLeft + sequenceViewportWidth) {
      setHorizontalScroll(cellRight - sequenceViewportWidth);
    }

    const row = Array.from(viewport.querySelectorAll<HTMLElement>('[data-msa-row-id]'))
      .find((candidate) => candidate.dataset.msaRowId === activeCell.rowId);
    if (row) {
      const viewportRect = viewport.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const visibleTop = viewportRect.top + (axisRows * MSA_RULER_ROW_HEIGHT);
      if (rowRect.top < visibleTop) viewport.scrollTop += rowRect.top - visibleTop;
      else if (rowRect.bottom > viewportRect.bottom) viewport.scrollTop += rowRect.bottom - viewportRect.bottom;
    }

    const frame = window.requestAnimationFrame(() => {
      const element = findGridCellElement(activeCell);
      if (!element) return;
      element.focus({ preventScroll: true });
      focusActiveCellRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeCell, axisRows, cellWidth, endColumn, findGridCellElement, sequenceViewportWidth, setHorizontalScroll, startColumn, viewportRef]);

  const handledFocusRequestTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || handledFocusRequestTokenRef.current === focusRequest.token) return;
    handledFocusRequestTokenRef.current = focusRequest.token;
    activateCell(focusRequest, true);
  }, [activateCell, focusRequest]);

  const handleGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const cell = pointToCell(event.clientX, event.clientY);
    if (!cell) return;
    event.preventDefault();
    setContextMenu(null);
    setHoverCell(null);
    activateCell({ column: cell.column, rowId: cell.rowId }, false);
    if (!(event.shiftKey && selectionAnchorRef.current)) {
      selectionAnchorRef.current = { column: cell.column, rowIndex: cell.rowIndex };
    }
    applySelectionTo(cell);
    selectingRef.current = true;
    stopDragAutoScroll();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  };

  const handleGridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (selectingRef.current) {
      const { clientX, clientY } = event;
      updateDragAutoScroll(clientX, clientY, { horizontal: true, vertical: true }, () => {
        if (!selectingRef.current) return;
        const cell = pointToCell(clientX, clientY, true);
        if (cell) applySelectionTo(cell);
      });
      return;
    }
    setHoverCell(pointToCell(event.clientX, event.clientY));
  };

  const endSelectionDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectingRef.current) return;
    stopDragAutoScroll();
    if (event.type === 'pointerup') {
      const cell = pointToCell(event.clientX, event.clientY, true);
      if (cell) applySelectionTo(cell);
    }
    selectingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const selectWholeColumn = (column: number) => {
    if (column < 0 || column >= alignment.alignmentLength) return;
    setContextMenu(null);
    selectionAnchorRef.current = { column, rowIndex: 0 };
    setSelection({ colStart: column, colEnd: column, rowStart: 0, rowEnd: Math.max(0, orderedRows.length - 1) });
  };

  const handleRulerPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const column = columnFromClientX(event.clientX);
    if (column == null) return;
    event.preventDefault();
    setHoverCell(null);
    selectWholeColumn(column);
    rulerSelectingRef.current = true;
    stopDragAutoScroll();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  };
  const handleRulerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rulerSelectingRef.current) return;
    const { clientX, clientY } = event;
    updateDragAutoScroll(clientX, clientY, { horizontal: true, vertical: false }, () => {
      if (!rulerSelectingRef.current) return;
      const column = columnFromClientX(clientX, true);
      const anchor = selectionAnchorRef.current;
      if (column == null || !anchor) return;
      setSelection({
        colStart: Math.min(anchor.column, column),
        colEnd: Math.max(anchor.column, column),
        rowStart: 0,
        rowEnd: Math.max(0, orderedRows.length - 1),
      });
    });
  };
  const handleRulerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rulerSelectingRef.current) return;
    stopDragAutoScroll();
    if (event.type === 'pointerup') {
      const column = columnFromClientX(event.clientX, true);
      const anchor = selectionAnchorRef.current;
      if (column != null && anchor) {
        setSelection({
          colStart: Math.min(anchor.column, column),
          colEnd: Math.max(anchor.column, column),
          rowStart: 0,
          rowEnd: Math.max(0, orderedRows.length - 1),
        });
      }
    }
    rulerSelectingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const clearSelection = useCallback(() => {
    setSelection(null);
    selectionAnchorRef.current = null;
    setContextMenu(null);
  }, []);

  const openSelectionContextMenu = (
    cell: { column: number; rowIndex: number; rowId: string },
    x: number,
    y: number,
  ) => {
    const insideSelection = selection
      && cell.column >= selection.colStart && cell.column <= selection.colEnd
      && cell.rowIndex >= selection.rowStart && cell.rowIndex <= selection.rowEnd;
    if (!insideSelection) {
      selectionAnchorRef.current = { column: cell.column, rowIndex: 0 };
      setSelection({ colStart: cell.column, colEnd: cell.column, rowStart: 0, rowEnd: Math.max(0, orderedRows.length - 1) });
    }
    setHoverCell(null);
    setContextMenu({ x, y, column: cell.column, rowId: cell.rowId });
  };

  const handleGridContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const cell = pointToCell(event.clientX, event.clientY);
    if (!cell) { setContextMenu(null); return; }
    event.preventDefault();
    activateCell({ column: cell.column, rowId: cell.rowId }, false);
    openSelectionContextMenu(cell, event.clientX, event.clientY);
  };

  const handleMatrixKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const eventTarget = event.target as HTMLElement;
    const targetCell = eventTarget.closest<HTMLElement>('[data-msa-grid-cell="true"]');
    if (!targetCell && event.target !== event.currentTarget) return;

    if (!activeCell || activeRowIndex < 0) {
      if (event.target !== event.currentTarget) return;
      const viewport = event.currentTarget;
      const smallStep = Math.max(cellWidth, sequenceViewportWidth / 4);
      let target: number | null = null;
      if (event.key === 'ArrowLeft') target = viewport.scrollLeft - smallStep;
      else if (event.key === 'ArrowRight') target = viewport.scrollLeft + smallStep;
      else if (event.key === 'PageUp') target = viewport.scrollLeft - sequenceViewportWidth;
      else if (event.key === 'PageDown') target = viewport.scrollLeft + sequenceViewportWidth;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = maxHorizontalScroll;
      if (target === null) return;
      event.preventDefault();
      setHorizontalScroll(target);
      return;
    }

    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      event.stopPropagation();
      const element = findGridCellElement(activeCell);
      const rect = element?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
      openSelectionContextMenu(
        { column: activeCell.column, rowIndex: activeRowIndex, rowId: activeCell.rowId },
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return;
    }

    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      event.stopPropagation();
      selectWholeColumn(activeCell.column);
      return;
    }

    const next = navigateMsaGridCell(
      { rowIndex: activeRowIndex, column: activeCell.column },
      event.key,
      {
        rowCount: orderedRows.length,
        columnCount: alignment.alignmentLength,
        pageColumnCount: visibleColumnCount,
        toGridBoundary: event.ctrlKey || event.metaKey,
      },
    );
    if (!next) return;
    const nextRow = orderedRows[next.rowIndex];
    if (!nextRow) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    if (event.shiftKey) {
      if (!selectionAnchorRef.current) {
        selectionAnchorRef.current = { column: activeCell.column, rowIndex: activeRowIndex };
      }
      applySelectionTo(next);
    } else {
      selectionAnchorRef.current = next;
    }
    activateCell({ column: next.column, rowId: nextRow.id }, true);
  };

  const copySelection = useCallback((mode: 'fasta' | 'ungapped' | 'columns') => {
    if (!selection) return;
    const payload: MsaSelection = { columns: { start: selection.colStart, end: selection.colEnd }, rowIds: selectionRowIds };
    const content = mode === 'fasta'
      ? selectionToFasta(alignment, payload)
      : mode === 'ungapped'
        ? selectionToUngappedFasta(alignment, payload)
        : selectionToColumnsText(alignment, payload);
    const label = mode === 'columns' ? 'Selected columns' : mode === 'ungapped' ? 'Selection ungapped FASTA' : 'Selection FASTA';
    void onCopy(label, content);
    setContextMenu(null);
  }, [alignment, onCopy, selection, selectionRowIds]);

  // ===== Row drag-reorder (grip handle) =====
  // Commit a new manual order and drop any active selection, whose row indices
  // would otherwise point at the wrong rows after the move.
  const commitRowOrder = useCallback((nextIds: string[], movedId: string, movedName: string) => {
    setManualOrder(nextIds);
    setSelection(null);
    selectionAnchorRef.current = null;
    // Announce the DISPLAY position, which keeps the template pinned first.
    const displayIds = template ? [template.id, ...nextIds.filter((id) => id !== template.id)] : nextIds;
    setReorderStatus(`Moved ${movedName} to position ${displayIds.indexOf(movedId) + 1} of ${displayIds.length}.`);
  }, [template]);

  const beginRowDrag = (event: ReactPointerEvent<HTMLButtonElement>, id: string, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setHoverCell(null);
    const state: RowDragState = { id, fromIndex: index, overIndex: index, edge: 'before' };
    rowDragRef.current = state;
    setRowDrag(state);
    stopDragAutoScroll();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  };

  const updateRowDragFromPoint = useCallback((clientX: number, clientY: number) => {
    const prev = rowDragRef.current;
    const viewport = viewportRef.current;
    if (!prev || !viewport) return;
    const viewportRect = viewport.getBoundingClientRect();
    const outsideViewport = clientX < viewportRect.left
      || clientX >= viewportRect.right
      || clientY < viewportRect.top
      || clientY >= viewportRect.bottom;
    const point = outsideViewport
      ? clampMsaClientPoint(clientX, clientY, viewportRect)
      : { clientX, clientY };
    const rowElement = rowElementFromPoint(point.clientX, point.clientY, outsideViewport);
    if (!rowElement) {
      if (prev.overIndex === null) return;
      const next = { ...prev, overIndex: null };
      rowDragRef.current = next;
      setRowDrag(next);
      return;
    }
    const overIndex = Number(rowElement.dataset.msaRowIndex);
    if (!Number.isInteger(overIndex)) return;
    const rect = rowElement.getBoundingClientRect();
    const edge: 'before' | 'after' = point.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (prev.overIndex === overIndex && prev.edge === edge) return;
    const next = { ...prev, overIndex, edge };
    rowDragRef.current = next;
    setRowDrag(next);
  }, [rowElementFromPoint, viewportRef]);

  const updateRowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!rowDragRef.current) return;
    const { clientX, clientY } = event;
    updateDragAutoScroll(clientX, clientY, { horizontal: false, vertical: true }, () => {
      updateRowDragFromPoint(clientX, clientY);
    });
  };

  const endRowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    stopDragAutoScroll();
    const viewportRect = viewportRef.current?.getBoundingClientRect();
    const releasedOffGrid = !viewportRect
      || event.clientX < viewportRect.left
      || event.clientX >= viewportRect.right
      || event.clientY < viewportRect.top
      || event.clientY >= viewportRect.bottom;
    if (!releasedOffGrid) updateRowDragFromPoint(event.clientX, event.clientY);
    const state = releasedOffGrid ? null : rowDragRef.current;
    rowDragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setRowDrag(null);
    if (!state || state.overIndex === null) return;
    // Convert the (over-row, edge) drop target into an insertion index against
    // the array with the dragged id removed.
    let insertion = state.overIndex + (state.edge === 'after' ? 1 : 0);
    if (state.fromIndex < insertion) insertion -= 1;
    // The template is pinned at index 0 and cannot accept a movable row before
    // it. Clamp pointer drops to the same minimum as keyboard reorder so a drop
    // on the template is a real no-op, preserving selection and announcements.
    const minIndex = orderedRows[0]?.id === template?.id ? 1 : 0;
    insertion = Math.max(minIndex, Math.min(orderedRows.length - 1, insertion));
    if (insertion === state.fromIndex) return; // a plain click, or dropped in place
    const ids = orderedRows.map((row) => row.id);
    commitRowOrder(moveRowId(ids, state.id, insertion), state.id, orderedRows[state.fromIndex]?.name ?? 'Row');
  };

  const cancelRowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    stopDragAutoScroll();
    rowDragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setRowDrag(null);
  };

  const handleGripKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const ids = orderedRows.map((row) => row.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    // The template is pinned at the top with no grip, so a movable row can never
    // occupy index 0. Clamp the target there so ArrowUp on the first movable row
    // is a no-op — not a "move" that re-pins the template, clears the selection,
    // and mis-announces a position change that never actually happened.
    const minIndex = orderedRows[0]?.id === template?.id ? 1 : 0;
    const target = Math.max(minIndex, Math.min(ids.length - 1, from + delta));
    if (target === from) return;
    commitRowOrder(moveRowId(ids, id, target), id, orderedRows[from]?.name ?? 'Row');
  };

  const resetRowOrder = useCallback(() => {
    setManualOrder(null);
    // Reordering rows re-indexes them, so an index-based selection would now
    // point at different rows (silently changing what copy actions yield).
    // Drop it, matching commitRowOrder.
    setSelection(null);
    selectionAnchorRef.current = null;
    setContextMenu(null);
    setReorderStatus('Row order reset to the current sort.');
  }, []);

  useEffect(() => {
    stopDragAutoScroll();
    setSelection(null);
    setHoverCell(null);
    setContextMenu(null);
    selectionAnchorRef.current = null;
    selectingRef.current = false;
    rulerSelectingRef.current = false;
    setManualOrder(null);
    setRowDrag(null);
    rowDragRef.current = null;
    setReorderStatus('');
  }, [alignment.id, resetToken, stopDragAutoScroll]);

  // A change to the persisted sort control supersedes any manual drag order.
  useEffect(() => { setManualOrder(null); }, [sortMode]);

  // A change in display order (sort or the pinned template) invalidates the
  // index-based selection, which would otherwise silently point at other rows.
  useEffect(() => {
    setSelection(null);
    selectionAnchorRef.current = null;
    setContextMenu(null);
  }, [sortMode, referenceRowId]);

  useEffect(() => {
    if (!hoverCell) return undefined;
    const onDismiss = () => setHoverCell(null);
    window.addEventListener('resize', onDismiss);
    window.addEventListener('scroll', onDismiss, true);
    return () => {
      window.removeEventListener('resize', onDismiss);
      window.removeEventListener('scroll', onDismiss, true);
    };
  }, [hoverCell]);

  useLayoutEffect(() => {
    if (!hoverCell) { setHoverPosition(null); return; }
    const x = hoverCell.clientX + 14;
    const y = hoverCell.clientY + 16;
    const el = hoverReadoutRef.current;
    if (!el) { setHoverPosition({ x, y }); return; }
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad);
    setHoverPosition({
      x: Math.min(Math.max(pad, x), maxX),
      y: Math.min(Math.max(pad, y), maxY),
    });
  }, [hoverCell]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null); };
    // The menu is anchored to a cell's screen position, so any scroll or resize
    // detaches it from that cell — dismiss rather than leave it stranded. Its
    // own bounded overflow remains scrollable so every action stays reachable.
    const onResize = () => setContextMenu(null);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return;
      setContextMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [contextMenu]);

  // Once the menu has rendered, measure it and clamp its fixed position so it
  // stays fully inside the viewport, flipping in from the right/bottom edges
  // instead of overflowing. Runs before paint, so the clamp is never seen mid-flight.
  useLayoutEffect(() => {
    if (!contextMenu) { setMenuPosition(null); return; }
    const el = contextMenuRef.current;
    if (!el) { setMenuPosition({ x: contextMenu.x, y: contextMenu.y }); return; }
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const maxX = Math.max(pad, window.innerWidth - rect.width - pad);
    const maxY = Math.max(pad, window.innerHeight - rect.height - pad);
    setMenuPosition({
      x: Math.min(Math.max(pad, contextMenu.x), maxX),
      y: Math.min(Math.max(pad, contextMenu.y), maxY),
    });
  }, [contextMenu]);

  useEffect(() => {
    if (!selection) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !contextMenu && !searchActive) clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection, contextMenu, searchActive, selection]);

  const frameStyle = {
    '--motif-cs-msa-label-width': `${labelWidth}px`,
    '--motif-cs-msa-cell-width': `${cellWidth}px`,
    '--motif-cs-msa-font-size': `${renderFontSize}px`,
  } as CSSProperties;

  const matrixStyle = {
    width: totalWidth,
  } as CSSProperties;

  const navigateOverviewPointer = (element: HTMLElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    const fraction = bounds.width > 0 ? (clientX - bounds.left) / bounds.width : 0;
    scrollToColumn(Math.round(Math.max(0, Math.min(1, fraction)) * Math.max(0, alignment.alignmentLength - 1)));
  };

  const renderSymbols = (sequence: string, rowId: string, consensus = false, rowIndex: number | null = null) => (
    <div
      className="motif-cs-msa-symbol-window"
      style={{ left: labelWidth + (startColumn * cellWidth) }}
      aria-hidden={consensus ? true : undefined}
    >
      {Array.from(sequence.slice(startColumn, endColumn)).map((symbol, offset) => {
        const column = startColumn + offset;
        const isGridCell = !consensus && rowIndex !== null;
        const resolvedRowIndex = rowIndex ?? -1;
        const isActive = isGridCell && activeCell?.rowId === rowId && activeCell.column === column;
        const isSelected = isGridCell && selection
          && column >= selection.colStart && column <= selection.colEnd
          && resolvedRowIndex >= selection.rowStart && resolvedRowIndex <= selection.rowEnd;
        const rowName = rowIndex === null ? '' : orderedRows[resolvedRowIndex]?.name ?? '';
        const residueLabel = symbol === '-' || symbol === '.' ? 'Gap' : `Residue ${symbol}`;
        const templateSymbol = template?.aligned[column] ?? '-';
        const isTemplate = rowId === template?.id;
        const cellOutcome = classifyMsaCell(
          templateSymbol,
          symbol,
          coversColumn(rowCoverageById.get(rowId) ?? null, column),
        );
        const matchesTemplate = cellOutcome === 'match';
        const isDifference = coversColumn(templateCoverage, column) && isMsaCellDifference(cellOutcome);
        const quietMatch = !consensus && emphasis === 'differences' && !isTemplate && matchesTemplate && symbol !== '-';
        const display = quietMatch
          ? '·'
          : symbol;
        return (
          <span
            key={column}
            className="motif-cs-msa-symbol"
            data-alignment-column={column + 1}
            data-msa-grid-cell={isGridCell || undefined}
            data-active-cell={isActive || undefined}
            data-residue={symbol}
            data-cell-outcome={!consensus ? cellOutcome : undefined}
            data-tone={toneColored ? residueTone(symbol, alignment.molecule) : 'mono'}
            data-color-key={explicitScheme ? residueColorKey(symbol, alignment.molecule, colorScheme) || undefined : undefined}
            data-shade-bucket={!consensus && shadeByColumn
              ? msaShadeBucket(shadeMode === 'identity' ? (columnStats[column]?.identity ?? 0) : (columnStats[column]?.conservation ?? 0))
              : undefined}
            data-difference={!consensus && isDifference || undefined}
            data-quiet={quietMatch || undefined}
            data-conserved={alignment.conserved[column] || undefined}
            data-jump={jumpColumn === column || undefined}
            data-search-match={searchColumnsByRow.get(rowId)?.has(column) || undefined}
            data-search-active={(activeSearchRowId === rowId && activeSearchColumns.has(column)) || undefined}
            role={isGridCell ? 'gridcell' : undefined}
            tabIndex={isGridCell ? (isActive ? 0 : -1) : undefined}
            aria-colindex={isGridCell ? column + 1 : undefined}
            aria-selected={isGridCell ? Boolean(isSelected) : undefined}
            aria-label={isGridCell ? `${residueLabel}, alignment column ${column + 1}, row ${rowName}` : undefined}
          >
            {display}
          </span>
        );
      })}
    </div>
  );

  const renderHistogram = (metric: (stat: MsaColumnStats) => number, kind: 'conservation' | 'occupancy') => (
    <div className="motif-cs-msa-hist-window" style={{ left: labelWidth + (startColumn * cellWidth) }} aria-hidden="true">
      {columnStats.slice(startColumn, endColumn).map((stat, offset) => {
        const column = startColumn + offset;
        const value = Math.max(0, Math.min(1, metric(stat)));
        return (
          <span key={column} className="motif-cs-msa-hist-cell" data-alignment-column={column + 1} data-jump={jumpColumn === column || undefined}>
            <span
              className={`motif-cs-msa-hist-bar motif-cs-msa-hist-bar-${kind}`}
              data-bucket={msaShadeBucket(value)}
              style={{ height: `${Math.round(value * 100)}%` }}
            />
          </span>
        );
      })}
    </div>
  );

  const renderTranslationTrack = () => (
    <div className="motif-cs-msa-translation-window" style={{ left: labelWidth, width: sequenceWidth }} aria-hidden="true">
      {translationCodons
        .filter((codon) => codon.endColumn >= startColumn && codon.startColumn < endColumn)
        .map((codon) => {
          const width = (codon.endColumn - codon.startColumn + 1) * cellWidth;
          const label = codon.aminoAcid === '*' ? 'Stop' : codon.aminoAcid === 'X' ? 'Unknown' : codon.aminoAcid;
          const showIndex = visibility.showAminoAcidIndices && (codon.position === 1 || codon.position % 10 === 0);
          return (
            <span
              key={codon.startColumn}
              className="motif-cs-msa-aa"
              style={{ left: codon.startColumn * cellWidth, width }}
              data-aa={codon.aminoAcid}
              data-color-key={residueColorKey(codon.aminoAcid, 'protein', 'clustal') || undefined}
              data-stop={codon.aminoAcid === '*' || undefined}
              data-unknown={codon.aminoAcid === 'X' || undefined}
              data-gap-spanning={codon.gapSpanning || undefined}
              data-jump={(jumpColumn !== null && jumpColumn >= codon.startColumn && jumpColumn <= codon.endColumn) || undefined}
              title={`${label} · residue ${codon.position} · codon ${codon.codon}`}
            >
              {showIndex ? <span className="motif-cs-msa-aa-index">{codon.position}</span> : null}
              <span className="motif-cs-msa-aa-letter">{width >= 7 ? codon.aminoAcid : ''}</span>
            </span>
          );
        })}
    </div>
  );

  // A sequence-logo residue always carries a colour (a colourless logo is
  // useless), so fall back to the molecule's default scheme when the alignment
  // itself is drawn mono/auto. Explicit schemes (incl. Taylor via the matrix's
  // data-color-scheme ancestor) reuse the same fills as the letter cells.
  const logoScheme: MsaColorScheme = explicitScheme
    ? colorScheme
    : alignment.molecule === 'protein' ? 'clustal' : 'nucleotide';
  const renderLogoTrack = () => (
    <div className="motif-cs-msa-logo-window" style={{ left: labelWidth + (startColumn * cellWidth) }}>
      {logoColumns.map((col, offset) => {
        const column = startColumn + offset;
        const stackFraction = Math.max(0, Math.min(1, col.information));
        const title = col.stack.length === 0
          ? `Column ${column + 1} · all gaps`
          : `Column ${column + 1} · ${Math.round(stackFraction * 100)}% conserved · `
            + col.stack.map((entry) => `${entry.symbol} ${Math.round(entry.fraction * 100)}%`).join(', ');
        return (
          <span
            key={column}
            className="motif-cs-msa-logo-col"
            data-alignment-column={column + 1}
            data-jump={jumpColumn === column || undefined}
            role="cell"
            aria-colindex={column + 1}
            aria-label={title}
            title={title}
          >
            <span className="motif-cs-msa-logo-stack" style={{ height: `${stackFraction * 100}%` }} aria-hidden="true">
              {col.stack.map((entry) => {
                const segmentPx = entry.fraction * stackFraction * MSA_LOGO_TRACK_HEIGHT;
                // Cap the glyph to the segment height so a tall font never
                // overflows a short block (line-height:1 + overflow:hidden would
                // clip it); only draw it once the capped glyph is still legible.
                const letterPx = Math.min(renderFontSize, Math.floor(segmentPx));
                const showLetter = !blocks && cellWidth >= MSA_LETTER_MIN && letterPx >= MSA_LOGO_LETTER_MIN_PX;
                return (
                  <span
                    key={entry.symbol}
                    className="motif-cs-msa-logo-block motif-cs-msa-symbol"
                    data-residue={entry.symbol}
                    data-color-key={residueColorKey(entry.symbol, alignment.molecule, logoScheme) || undefined}
                    style={{ height: `${entry.fraction * 100}%`, fontSize: showLetter ? letterPx : 0 }}
                  >
                    {showLetter ? entry.symbol : ''}
                  </span>
                );
              })}
            </span>
          </span>
        );
      })}
    </div>
  );

  const selectionColumnLeft = selection ? labelWidth + (selection.colStart * cellWidth) : 0;
  const selectionColumnWidth = selection ? (selection.colEnd - selection.colStart + 1) * cellWidth : 0;
  const selectionRowTop = selection
    ? (axisRows * MSA_RULER_ROW_HEIGHT) + (selection.rowStart * MSA_MATRIX_ROW_HEIGHT)
    : 0;
  const selectionRowHeight = selection
    ? (selection.rowEnd - selection.rowStart + 1) * MSA_MATRIX_ROW_HEIGHT
    : 0;
  const hoverColumnLeft = hoverCell ? labelWidth + (hoverCell.column * cellWidth) : 0;

  return (
    <div
      ref={frameRef}
      className="motif-cs-msa-matrix-frame"
      data-testid="msa-alignment-view"
      style={frameStyle}
      data-has-selection={selection ? true : undefined}
      data-motif-cs-escape-scope={selection ? 'true' : undefined}
    >
      {visibility.showOverview ? <div className="motif-cs-msa-overview-row">
        <span className="motif-cs-msa-overview-label">Overview</span>
        <div
          className="motif-cs-msa-overview"
          data-testid="msa-overview"
          role="slider"
          tabIndex={0}
          aria-label="Alignment overview"
          aria-valuemin={1}
          aria-valuemax={Math.max(1, alignment.alignmentLength)}
          aria-valuenow={overviewCenter + 1}
          aria-valuetext={`Alignment columns ${visibleStartColumn + 1}–${Math.max(visibleStartColumn + 1, visibleEndColumn)} of ${alignment.alignmentLength}`}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            overviewDraggingRef.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            navigateOverviewPointer(event.currentTarget, event.clientX);
          }}
          onPointerMove={(event) => {
            if (!overviewDraggingRef.current) return;
            navigateOverviewPointer(event.currentTarget, event.clientX);
          }}
          onPointerUp={(event) => {
            overviewDraggingRef.current = false;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { overviewDraggingRef.current = false; }}
          onKeyDown={(event) => {
            let target: number | null = null;
            const step = Math.max(1, Math.floor(visibleColumnCount / 4));
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') target = overviewCenter - step;
            else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') target = overviewCenter + step;
            else if (event.key === 'PageUp') target = overviewCenter - visibleColumnCount;
            else if (event.key === 'PageDown') target = overviewCenter + visibleColumnCount;
            else if (event.key === 'Home') target = 0;
            else if (event.key === 'End') target = alignment.alignmentLength - 1;
            if (target === null) return;
            event.preventDefault();
            scrollToColumn(target);
          }}
        >
          <svg viewBox={`0 0 ${overviewBinCount} 24`} preserveAspectRatio="none" aria-hidden="true">
            <path className="motif-cs-msa-overview-mismatches" d={overviewPath} />
          </svg>
          <span
            className="motif-cs-msa-overview-viewport"
            data-testid="msa-overview-viewport"
            style={{ left: `${overviewLeft}%`, width: `${Math.min(100 - overviewLeft, overviewWidth)}%` }}
            aria-hidden="true"
          />
        </div>
      </div> : null}
      <div
        ref={viewportRef}
        className="motif-cs-msa-matrix-scroll"
        onScroll={(event) => handleScroll(event.currentTarget.scrollLeft, event.currentTarget.scrollTop)}
        onKeyDown={handleMatrixKeyDown}
        onFocus={(event) => {
          if (event.target === event.currentTarget) {
            if (activeCellIsRendered) return;
            const row = orderedRows[activeRowIndex] ?? orderedRows[0];
            if (row) activateCell({ rowId: row.id, column: visibleStartColumn }, true);
            return;
          }
          const element = (event.target as HTMLElement).closest<HTMLElement>('[data-msa-grid-cell="true"]');
          const row = element?.closest<HTMLElement>('[data-msa-row-id]');
          const column = Number(element?.dataset.alignmentColumn) - 1;
          const rowId = row?.dataset.msaRowId;
          if (!rowId || !Number.isInteger(column) || (activeCell?.rowId === rowId && activeCell.column === column)) return;
          activateCell({ rowId, column }, false);
        }}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={endSelectionDrag}
        onPointerCancel={endSelectionDrag}
        onPointerLeave={() => setHoverCell(null)}
        onContextMenu={handleGridContextMenu}
        tabIndex={activeCellIsRendered ? -1 : 0}
        role="region"
        aria-label="Scrollable alignment matrix viewport"
        data-selecting={selection ? true : undefined}
      >
        <div
          className="motif-cs-msa-matrix"
          style={matrixStyle}
          role="grid"
          aria-label={`Alignment matrix, ${alignment.rows.length} rows by ${alignment.alignmentLength} columns`}
          aria-describedby="motif-cs-msa-matrix-help"
          aria-rowcount={tableRowCount}
          aria-colcount={alignment.alignmentLength}
          data-color-scheme={explicitScheme ? colorScheme : undefined}
          data-shade={shadeMode !== 'none' ? shadeMode : undefined}
          data-reordering={rowDrag ? true : undefined}
          data-blocks={blocks ? true : undefined}
        >
          {selection ? (
            <div
              className="motif-cs-msa-selection-band"
              style={{
                left: selectionColumnLeft,
                top: selectionRowTop,
                width: selectionColumnWidth,
                height: selectionRowHeight,
              }}
              aria-hidden="true"
            />
          ) : null}
          {hoverCell ? (
            <div className="motif-cs-msa-hover-column" style={{ left: hoverColumnLeft, width: cellWidth }} aria-hidden="true" />
          ) : null}
          {visibility.showAlignmentAxis ? <div className="motif-cs-msa-ruler-row" role="row" aria-rowindex={1}>
            <div className="motif-cs-msa-sticky-label motif-cs-msa-ruler-label" role="columnheader">Alignment position</div>
            <div
              className="motif-cs-msa-ruler-window motif-cs-msa-ruler-window-clickable"
              style={{ left: labelWidth + (startColumn * cellWidth) }}
              aria-hidden="true"
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              onPointerUp={handleRulerPointerUp}
              onPointerCancel={handleRulerPointerUp}
            >
              {Array.from({ length: endColumn - startColumn }, (_, offset) => {
                const column = startColumn + offset;
                const position = column + 1;
                const show = position === 1 || position % 10 === 0;
                return (
                  <span
                    key={column}
                    className="motif-cs-msa-ruler-cell"
                    data-alignment-column={String(column + 1)}
                  >
                    {show ? position : ''}
                  </span>
                );
              })}
            </div>
          </div> : null}

          {visibility.showTemplateAxis ? <div
            className="motif-cs-msa-ruler-row motif-cs-msa-template-ruler-row"
            data-alignment-axis={visibility.showAlignmentAxis || undefined}
            role="row"
            aria-rowindex={visibility.showAlignmentAxis ? 2 : 1}
            aria-label={`Template positions for ${template?.name ?? 'template'}`}
          >
            <div
              className="motif-cs-msa-sticky-label motif-cs-msa-ruler-label motif-cs-msa-template-ruler-label"
              role="columnheader"
              title={`Template position · ${template?.name ?? 'Template'} · ungapped template-row coordinates`}
            >
              <span>Template position</span>
              <small translate="no">{template?.name ?? 'Template'}</small>
            </div>
            <div className="motif-cs-msa-ruler-window" style={{ left: labelWidth + (startColumn * cellWidth) }} aria-hidden="true">
              {templateCoordinates.slice(startColumn, endColumn).map((position, offset) => {
                const column = startColumn + offset;
                const show = position !== null && (position === 1 || position % 10 === 0);
                return (
                  <span
                    key={column}
                    className="motif-cs-msa-ruler-cell"
                    data-alignment-column={String(column + 1)}
                    data-template-position={position === null ? 'gap' : String(position)}
                  >
                    {show ? position : ''}
                  </span>
                );
              })}
            </div>
          </div> : null}

          {orderedRows.map((row, rowIndex) => {
            const label = rowLabelsById.get(row.id) ?? { leading: row.name, trailing: '' };
            const stats = statsByRow.get(row.id) ?? pairwiseRowStats(row.aligned, template?.aligned ?? '');
            const isTemplate = row.id === template?.id;
            return (
              <div
                key={row.id}
                className="motif-cs-msa-matrix-row"
                data-template={isTemplate || undefined}
                data-msa-row-index={rowIndex}
                data-msa-row-id={row.id}
                data-hover={hoverCell?.rowIndex === rowIndex || undefined}
                data-selected={(selection && rowIndex >= selection.rowStart && rowIndex <= selection.rowEnd) || undefined}
                data-dragging={rowDrag?.id === row.id || undefined}
                data-drop-before={(rowDrag && rowDrag.id !== row.id && rowDrag.overIndex === rowIndex && rowDrag.edge === 'before') || undefined}
                data-drop-after={(rowDrag && rowDrag.id !== row.id && rowDrag.overIndex === rowIndex && rowDrag.edge === 'after') || undefined}
                role="row"
                aria-rowindex={firstSequenceRow + rowIndex}
                aria-label={visibility.showRowStats
                  ? `${row.name}; ${stats.mismatches} mismatches; ${stats.ungappedLength} ungapped ${sequenceUnit(alignment.molecule)}; ${formatIdentity(stats.identity)} percent identity to template; ${isTemplate ? 'template row' : 'alignment row'}`
                  : `${row.name}; ${isTemplate ? 'template row' : 'alignment row'}`}
              >
                <div className="motif-cs-msa-sticky-label motif-cs-msa-row-label motif-cs-msa-row-label-draggable" role="rowheader">
                  {isTemplate ? null : (
                    <button
                      type="button"
                      className="motif-cs-msa-row-grip"
                      data-testid="msa-row-grip"
                      aria-label={`Reorder ${row.name}. Drag, or press Up and Down arrows.`}
                      title={`Drag to reorder ${row.name}`}
                      onPointerDown={(event) => beginRowDrag(event, row.id, rowIndex)}
                      onPointerMove={updateRowDrag}
                      onPointerUp={endRowDrag}
                      onPointerCancel={cancelRowDrag}
                      onKeyDown={(event) => handleGripKeyDown(event, row.id)}
                    >
                      <GripVertical size={13} aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="motif-cs-msa-row-select"
                    aria-label={`Use ${row.name} as template`}
                    aria-pressed={isTemplate}
                    title={`${row.name} · use as template`}
                    onClick={() => onTemplateChange(row.id)}
                  >
                    <span className="motif-cs-msa-row-name" aria-hidden="true">
                      <span className="motif-cs-msa-row-name-leading">{label.leading}</span>
                      {label.trailing ? <span className="motif-cs-msa-row-name-trailing">{label.trailing}</span> : null}
                    </span>
                  </button>
                  <span className="motif-cs-msa-row-meta" aria-hidden="true">
                    {isTemplate ? <span className="motif-cs-msa-template-badge">Template</span> : null}
                    {visibility.showRowStats ? (
                      <>
                        <small className="motif-cs-msa-row-stat motif-cs-msa-row-stat-mismatch">{stats.mismatches.toLocaleString()}Δ</small>
                        <small className="motif-cs-msa-row-stat motif-cs-msa-row-stat-length">{stats.ungappedLength.toLocaleString()} {sequenceUnit(alignment.molecule)}</small>
                        <small className="motif-cs-msa-row-stat">{formatIdentity(stats.identity)}%</small>
                      </>
                    ) : null}
                  </span>
                </div>
                {renderSymbols(row.aligned, row.id, false, rowIndex)}
              </div>
            );
          })}

          {visibility.showConservation ? <div className="motif-cs-msa-conservation-row" role="row" aria-rowindex={firstSequenceRow + orderedRows.length} aria-label="Conservation; asterisks mark columns conserved across every row">
            <div className="motif-cs-msa-sticky-label motif-cs-msa-row-label" role="rowheader"><span>Conserved</span></div>
            <div className="motif-cs-msa-symbol-window" style={{ left: labelWidth + (startColumn * cellWidth) }} aria-hidden="true">
              {alignment.conserved.slice(startColumn, endColumn).map((conserved, offset) => (
                <span key={startColumn + offset} className="motif-cs-msa-symbol motif-cs-msa-conservation-mark" data-jump={jumpColumn === startColumn + offset || undefined}>
                  {conserved ? '*' : ''}
                </span>
              ))}
            </div>
          </div> : null}

          {visibility.showConsensus ? <div className="motif-cs-msa-consensus-row" role="row" aria-rowindex={firstSequenceRow + orderedRows.length + Number(visibility.showConservation)} aria-label="Majority consensus row">
            <div className="motif-cs-msa-sticky-label motif-cs-msa-row-label" role="rowheader"><span>Consensus</span></div>
            {renderSymbols(alignment.consensus, '__consensus__', true)}
          </div> : null}

          {visibility.showConservationHistogram ? <div
            className="motif-cs-msa-hist-row"
            role="row"
            aria-rowindex={firstSequenceRow + orderedRows.length + Number(visibility.showConservation) + Number(visibility.showConsensus)}
            aria-label="Per-column conservation histogram"
          >
            <div className="motif-cs-msa-sticky-label motif-cs-msa-row-label motif-cs-msa-hist-label" role="rowheader"><span>Conservation</span></div>
            {renderHistogram((stat) => stat.conservation, 'conservation')}
          </div> : null}

          {visibility.showOccupancy ? <div
            className="motif-cs-msa-hist-row"
            role="row"
            aria-rowindex={firstSequenceRow + orderedRows.length + Number(visibility.showConservation) + Number(visibility.showConsensus) + Number(visibility.showConservationHistogram)}
            aria-label="Per-column occupancy histogram"
          >
            <div className="motif-cs-msa-sticky-label motif-cs-msa-row-label motif-cs-msa-hist-label" role="rowheader"><span>Occupancy</span></div>
            {renderHistogram((stat) => stat.occupancy, 'occupancy')}
          </div> : null}

          {translationVisible ? <div
            className="motif-cs-msa-translation-row"
            role="row"
            aria-rowindex={firstSequenceRow + orderedRows.length + Number(visibility.showConservation) + Number(visibility.showConsensus) + Number(visibility.showConservationHistogram) + Number(visibility.showOccupancy)}
            aria-label={`Amino-acid translation of ${template?.name ?? 'reference'}, reading frame ${translationFrame + 1}`}
          >
            <div className="motif-cs-msa-sticky-label motif-cs-msa-row-label motif-cs-msa-hist-label motif-cs-msa-translation-label" role="rowheader">
              <span>Translation</span>
              <small translate="no">frame +{translationFrame + 1}</small>
            </div>
            {renderTranslationTrack()}
          </div> : null}

          {visibility.showSequenceLogo ? <div
            className="motif-cs-msa-logo-row"
            data-testid="msa-logo-row"
            role="row"
            aria-rowindex={firstSequenceRow + orderedRows.length + Number(visibility.showConservation) + Number(visibility.showConsensus) + Number(visibility.showConservationHistogram) + Number(visibility.showOccupancy) + Number(translationVisible)}
            aria-label="Per-column sequence logo: residue heights scaled by occupancy-weighted conservation"
          >
            <div className="motif-cs-msa-sticky-label motif-cs-msa-row-label motif-cs-msa-hist-label" role="rowheader"><span>Logo</span></div>
            {renderLogoTrack()}
          </div> : null}
        </div>
      </div>
      <div className="motif-cs-msa-zoom-row" data-testid="msa-zoom-row">
        <span className="motif-cs-msa-zoom-label" aria-hidden="true">Zoom</span>
        <input
          className="motif-cs-msa-zoom-range"
          data-testid="msa-zoom-range"
          type="range"
          min={Math.round(MSA_ZOOM_MIN * 100)}
          max={Math.round(MSA_ZOOM_MAX * 100)}
          step={5}
          value={Math.round(zoom * 100)}
          onChange={(event) => setZoom(Number(event.target.value) / 100)}
          aria-label="Alignment column zoom"
          aria-valuetext={`${Math.round(zoom * 100)} percent${blocks ? ', blocks view' : ''}`}
          title="Compress or expand alignment columns"
        />
        <span className="motif-cs-msa-zoom-value" data-testid="msa-zoom-value">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="motif-cs-mini-button"
          data-testid="msa-zoom-fit"
          data-fit-limited={!canFitAlignment || undefined}
          onClick={fitZoom}
          aria-label={canFitAlignment ? 'Fit alignment to window width' : 'Use minimum column zoom'}
          title={canFitAlignment
            ? 'Fit the whole alignment to the window width'
            : 'Use minimum column zoom; the whole alignment remains available through the overview and column scroller'}
        >
          {canFitAlignment ? 'Fit' : 'Min zoom'}
        </button>
        {Math.round(zoom * 100) !== 100 ? (
          <button type="button" className="motif-cs-mini-button" data-testid="msa-zoom-reset" onClick={() => setZoom(1)} title="Reset zoom to 100%">100%</button>
        ) : null}
        {blocks ? <span className="motif-cs-chip motif-cs-msa-blocks-chip" data-testid="msa-blocks-chip" title="Columns are compressed past letter legibility; residues render as coloured blocks">Blocks</span> : null}
      </div>
      {maxHorizontalScroll > 0 ? (
        <div className="motif-cs-msa-pan-row" data-testid="msa-horizontal-scroll-row">
          <span className="motif-cs-msa-pan-label" aria-hidden="true">Columns</span>
          <input
            className="motif-cs-msa-pan-range"
            data-testid="msa-horizontal-scroll"
            type="range"
            min={0}
            max={Math.max(1, Math.ceil(maxHorizontalScroll))}
            step={1}
            value={Math.min(Math.ceil(maxHorizontalScroll), Math.round(scrollLeft))}
            onChange={(event) => setHorizontalScroll(Number(event.target.value))}
            aria-label="Horizontal alignment scroll"
            aria-valuetext={`Columns ${visibleStartColumn + 1}–${Math.max(visibleStartColumn + 1, visibleEndColumn)} of ${alignment.alignmentLength}`}
            title="Drag to pan alignment columns"
            style={{ '--motif-cs-msa-pan-thumb-width': `${panThumbWidth}px` } as CSSProperties}
          />
        </div>
      ) : null}
      <span id="motif-cs-msa-matrix-help" className="motif-cs-visually-hidden">Alignment positions count gapped columns. Template positions count non-gap residues in the chosen template; blank template-axis cells are gaps. Choose any row header button to make that row the template. In the grid, use Arrow keys to move the active residue, Shift plus Arrow keys to extend a selection, Home and End for row boundaries, Control or Command plus Home or End for grid boundaries, Page Up and Page Down to move by a viewport, Space to select a column, and Shift plus F10 or the Context Menu key for selection actions. The Columns slider and Shift plus wheel also pan the alignment. Switch to Text to read or copy the complete aligned sequences with assistive technology.</span>
      <div className="motif-cs-msa-window-note" aria-live="polite">
        Alignment columns {visibleStartColumn + 1}–{Math.max(visibleStartColumn + 1, visibleEndColumn)} of {alignment.alignmentLength.toLocaleString()}
      </div>
      {manualOrder ? (
        <div className="motif-cs-msa-order-note" data-testid="msa-order-note">
          <GripVertical size={12} aria-hidden="true" />
          <span>Custom row order</span>
          <button type="button" className="motif-cs-mini-button" onClick={resetRowOrder}>Reset order</button>
        </div>
      ) : null}
      <span className="motif-cs-visually-hidden" data-testid="msa-reorder-status" role="status" aria-live="polite">{reorderStatus}</span>
      {selection && selectionSummary ? (
        <div className="motif-cs-msa-selection-readout" data-testid="msa-selection-readout" role="status" aria-live="polite">
          <strong>Selected</strong>
          <span>cols {selection.colStart + 1}–{selection.colEnd + 1} ({selectionSummary.stats.columns.toLocaleString()})</span>
          {selectionSummary.startPosition != null && selectionSummary.endPosition != null
            ? <span>· template {selectionSummary.startPosition}–{selectionSummary.endPosition}</span>
            : null}
          <span>· {selectionSummary.rows} row{selectionSummary.rows === 1 ? '' : 's'}</span>
          <span>· {selectionSummary.stats.variableColumns.toLocaleString()} variable</span>
          <span>· {Math.round(selectionSummary.stats.meanIdentity * 100)}% mean id</span>
          <button type="button" className="motif-cs-mini-button" onClick={clearSelection}>Clear</button>
        </div>
      ) : null}
      {hoverCell ? (
        <div ref={hoverReadoutRef} className="motif-cs-msa-hover-readout" style={{ left: hoverPosition?.x ?? hoverCell.clientX + 14, top: hoverPosition?.y ?? hoverCell.clientY + 16 }} aria-hidden="true">
          <b>{orderedRows[hoverCell.rowIndex]?.aligned[hoverCell.column] ?? '-'}</b>
          <span>col {hoverCell.column + 1}</span>
          <span>· {templateCoordinates[hoverCell.column] != null ? `tpl ${templateCoordinates[hoverCell.column]}` : 'tpl gap'}</span>
          <span className="motif-cs-msa-hover-readout-name">{orderedRows[hoverCell.rowIndex]?.name}</span>
        </div>
      ) : null}
      {contextMenu ? (
        <div ref={contextMenuRef} className="motif-cs-msa-context-menu" style={{ left: (menuPosition ?? contextMenu).x, top: (menuPosition ?? contextMenu).y }} role="menu" aria-label="Alignment selection actions">
          <button type="button" role="menuitem" onClick={() => copySelection('fasta')}>Copy selection (FASTA)</button>
          <button type="button" role="menuitem" onClick={() => copySelection('ungapped')}>Copy without gaps</button>
          <button type="button" role="menuitem" onClick={() => copySelection('columns')}>Copy columns</button>
          {contextMenu.rowId ? (
            <button type="button" role="menuitem" onClick={() => { onTemplateChange(contextMenu.rowId!); setContextMenu(null); }}>Set row as reference</button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => { scrollToColumn(contextMenu.column); setContextMenu(null); }}>Center this column</button>
          <button type="button" role="menuitem" onClick={clearSelection}>Clear selection</button>
        </div>
      ) : null}
    </div>
  );
}

export function ClaudeScienceMsaViewer({
  records,
  alignments,
  activeRecordId,
  activeAlignmentId,
  viewPreferences,
  onActiveAlignmentChange,
  onViewPreferencesChange,
  onSaveAlignment,
  onUpdateAlignmentTemplate,
  onDeleteAlignment,
  onImportRecords,
  onCopy,
  onDownload,
}: ClaudeScienceMsaViewerProps) {
  const activeAlignment = useMemo(
    () => alignments.find((alignment) => alignment.id === activeAlignmentId) ?? alignments[0] ?? null,
    [activeAlignmentId, alignments],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => compatibleDefaultIds(records, activeRecordId));
  const [sourceMode, setSourceMode] = useState<SourceMode>('records');
  const [sourceOpen, setSourceOpen] = useState(() => alignments.length === 0);
  const [filter, setFilter] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [localTemplateId, setLocalTemplateId] = useState(activeRecordId ?? '');
  const [autoOrientTraces, setAutoOrientTraces] = useState(true);
  const [alignmentName, setAlignmentName] = useState('');
  const [alignedFasta, setAlignedFasta] = useState('');
  const [importEngine, setImportEngine] = useState('imported');
  const [importVersion, setImportVersion] = useState('');
  const [importMolecule, setImportMolecule] = useState<SequenceType>('dna');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const { displayMode, emphasis, colorMode, colorScheme, shadeMode, sortMode, fontSize, zoom, translationFrame, textFormat } = viewPreferences;
  const [referenceRowId, setReferenceRowId] = useState(activeAlignment?.referenceRowId ?? '');
  const [differenceIndex, setDifferenceIndex] = useState(-1);
  const [jumpColumn, setJumpColumn] = useState<number | null>(null);
  const [jumpToken, setJumpToken] = useState(0);
  const [jumpRowId, setJumpRowId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [searchIndex, setSearchIndex] = useState(-1);
  const [matrixFocusRequest, setMatrixFocusRequest] = useState<MatrixFocusRequest | null>(null);
  const [viewResetToken, setViewResetToken] = useState(0);
  const [coordinateSystem, setCoordinateSystem] = useState<CoordinateSystem>('alignment');
  const [columnDraft, setColumnDraft] = useState('');
  const [columnError, setColumnError] = useState<string | null>(null);
  const [columnStatus, setColumnStatus] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [intakeStatus, setIntakeStatus] = useState<{ message: string; tone: 'status' | 'error' } | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ label: string; message: string; tone: 'status' | 'error' } | null>(null);
  const [imageScope, setImageScope] = useState<AlignmentImageScope>('view');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [viewResetStatus, setViewResetStatus] = useState('');
  const alignmentFileInputRef = useRef<HTMLInputElement>(null);
  const recordFileInputRef = useRef<HTMLInputElement>(null);
  const dropDepthRef = useRef(0);
  const sourceSummaryRef = useRef<HTMLElement>(null);
  const alignmentPickerRef = useRef<HTMLSelectElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const copyStatusTimerRef = useRef<number | null>(null);
  const viewMenuRef = useRef<HTMLDetailsElement>(null);
  const viewMenuButtonRef = useRef<HTMLElement>(null);
  const explicitlySelectedTemplateIdRef = useRef<string | null>(null);
  // Latest visible column window reported by the matrix, for "Visible view" export.
  const visibleColumnsRef = useRef<{ start: number; end: number } | null>(null);
  const handleVisibleColumnsChange = useCallback((range: { start: number; end: number }) => {
    visibleColumnsRef.current = range;
  }, []);

  useEffect(() => {
    const resolvedId = activeAlignment?.id ?? null;
    if (resolvedId !== activeAlignmentId) onActiveAlignmentChange(resolvedId);
  }, [activeAlignment?.id, activeAlignmentId, onActiveAlignmentChange]);

  const updateViewPreferences = useCallback((patch: Partial<ClaudeScienceMsaViewPreferences>) => {
    setViewResetStatus('');
    onViewPreferencesChange(normalizeClaudeScienceMsaViewPreferences({ ...viewPreferences, ...patch }));
  }, [onViewPreferencesChange, viewPreferences]);

  useEffect(() => {
    setReferenceRowId(activeAlignment?.referenceRowId ?? activeAlignment?.rows[0]?.id ?? '');
    setDifferenceIndex(-1);
    setJumpColumn(null);
    setJumpRowId(null);
    setColumnDraft('');
    setColumnError(null);
    setColumnStatus('');
    setPendingDeleteId(null);
    // Drop any stale visible window from the previous alignment; the matrix
    // reports a fresh range on mount (undefined until then falls back to whole).
    visibleColumnsRef.current = null;
  }, [activeAlignment]);

  // Reset the sequence search only when switching to a different alignment, not
  // when the same alignment yields a new object (e.g. a template change), so a
  // template switch keeps the active search.
  useEffect(() => {
    setSearchQuery('');
    setSearchIndex(-1);
    setMatrixFocusRequest(null);
  }, [activeAlignment?.id]);

  // Clear an active search on Escape regardless of where focus sits — the matrix,
  // the step buttons, or another display mode. The search form's own handler only
  // fires while its input is focused, and in Text mode the form is unmounted, so
  // without this Escape would either do nothing or (in Text mode) close the host
  // window while a latent query lingered. The always-mounted workspace carries the
  // escape scope while a query is set (see the return) so the host stands down and
  // this clears the query instead.
  useEffect(() => {
    if (!searchQuery) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setSearchQuery('');
        setSearchIndex(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [searchQuery]);

  const traceAvailable = activeAlignment ? hasLinkedSangerTrace(activeAlignment, records) : false;

  useEffect(() => {
    if (displayMode === 'trace' && !traceAvailable) updateViewPreferences({ displayMode: 'viewer' });
  }, [displayMode, traceAvailable, updateViewPreferences]);

  useEffect(() => () => {
    if (copyStatusTimerRef.current !== null) window.clearTimeout(copyStatusTimerRef.current);
  }, []);

  useEffect(() => {
    if (!pendingDeleteId) return undefined;
    const frame = window.requestAnimationFrame(() => cancelDeleteRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pendingDeleteId]);

  useEffect(() => {
    if (!viewMenuOpen) return undefined;
    const closeFromOutside = (event: PointerEvent) => {
      if (viewMenuRef.current?.contains(event.target as Node)) return;
      setViewMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeFromOutside, true);
    return () => document.removeEventListener('pointerdown', closeFromOutside, true);
  }, [viewMenuOpen]);

  const selectedRecords = useMemo(
    () => records.filter((record) => selectedIds.has(record.id)),
    [records, selectedIds],
  );
  const selectedInputFasta = useMemo(() => formatInputFasta(selectedRecords), [selectedRecords]);
  const selectedTraceCount = selectedRecords.filter((record) => record.sangerTrace).length;
  useEffect(() => {
    if (selectedRecords.some((record) => record.id === localTemplateId)) return;
    if (explicitlySelectedTemplateIdRef.current === localTemplateId) explicitlySelectedTemplateIdRef.current = null;
    const nextTemplate = selectedRecords.find((record) => record.id === activeRecordId) ?? selectedRecords[0];
    setLocalTemplateId(nextTemplate?.id ?? '');
  }, [activeRecordId, localTemplateId, selectedRecords]);
  const selectedType = selectedRecords[0]?.type ?? null;
  const filteredRecords = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const selected = records.filter((record) => selectedIds.has(record.id));
    if (selectedOnly) return selected;
    const matchingUnselected = records.filter((record) => (
      !selectedIds.has(record.id)
      && (!query || [record.name, record.group, record.type, String(record.sequence.length)]
        .some((value) => value?.toLowerCase().includes(query)))
    ));
    return [...selected, ...matchingUnselected];
  }, [filter, records, selectedIds, selectedOnly]);
  const workEstimate = useMemo(() => estimateLocalAlignmentWork(selectedRecords), [selectedRecords]);
  const exceedsLocalBudget = workEstimate > ARTIFACT_MSA_LOCAL_WORK_BUDGET;
  const differences = useMemo(
    () => activeAlignment ? differenceColumns(activeAlignment, referenceRowId) : [],
    [activeAlignment, referenceRowId],
  );
  const computedSearchResult = useMemo(
    () => (activeAlignment && deferredSearchQuery.trim()
      ? findMsaMotifMatches(activeAlignment.rows, deferredSearchQuery, { molecule: activeAlignment.molecule })
      : EMPTY_MSA_SEARCH_RESULT),
    [activeAlignment, deferredSearchQuery],
  );
  const searchPending = deferredSearchQuery !== searchQuery;
  // Do not leave stale highlights from the previous query while React defers the
  // bounded scan; input stays urgent and the deferred render performs the work.
  const searchResult = searchPending ? EMPTY_MSA_SEARCH_RESULT : computedSearchResult;
  const searchMatches = searchResult.matches;
  const activeSearchMatch = searchIndex >= 0 && searchMatches.length > 0
    ? searchMatches[Math.min(searchIndex, searchMatches.length - 1)] ?? null
    : null;
  // A new query starts unnavigated: matches highlight, but nothing is focused
  // until the user steps with Enter or the prev/next controls.
  useEffect(() => { setSearchIndex(-1); }, [searchQuery]);
  const conservedCount = activeAlignment?.conserved.filter(Boolean).length ?? 0;
  const conservedPct = activeAlignment && activeAlignment.alignmentLength > 0
    ? Math.round((conservedCount / activeAlignment.alignmentLength) * 100)
    : 0;
  const activeTemplate = activeAlignment?.rows.find((row) => row.id === referenceRowId)
    ?? activeAlignment?.rows[0];
  const comparisonStats = activeTemplate
    ? (activeAlignment?.rows ?? [])
      .filter((row) => row.id !== activeTemplate.id)
      .map((row) => pairwiseRowStats(row.aligned, activeTemplate.aligned))
      .filter((stats) => stats.comparableColumns > 0)
    : [];
  const hasComparableRows = comparisonStats.length > 0;
  const avgIdentity = hasComparableRows
    ? comparisonStats.reduce((sum, stats) => sum + stats.identity, 0) / comparisonStats.length
    : null;
  const differenceNavigationDisabled = !hasComparableRows || differences.length === 0;
  const differenceNavigationLabel = !hasComparableRows
    ? 'No comparable rows'
    : differenceIndex >= 0
      ? `Difference ${differenceIndex + 1} of ${differences.length}`
      : `${differences.length} differences`;
  const textContent = activeAlignment ? formatAlignment(activeAlignment, textFormat) : '';
  const selectedExport = formatExtension(textFormat);
  const pickerLabels = useMemo(() => alignmentPickerLabels(alignments), [alignments]);
  const matrixVisibility = useMemo<MsaMatrixVisibility>(() => ({
    showOverview: viewPreferences.showOverview,
    showAlignmentAxis: viewPreferences.showAlignmentAxis,
    showTemplateAxis: viewPreferences.showTemplateAxis,
    showRowStats: viewPreferences.showRowStats,
    showConservation: viewPreferences.showConservation,
    showConservationHistogram: viewPreferences.showConservationHistogram,
    showOccupancy: viewPreferences.showOccupancy,
    showConsensus: viewPreferences.showConsensus,
    showSequenceLogo: viewPreferences.showSequenceLogo,
    showTranslation: viewPreferences.showTranslation,
    showAminoAcidIndices: viewPreferences.showAminoAcidIndices,
  }), [
    viewPreferences.showAlignmentAxis,
    viewPreferences.showAminoAcidIndices,
    viewPreferences.showConsensus,
    viewPreferences.showConservation,
    viewPreferences.showConservationHistogram,
    viewPreferences.showOccupancy,
    viewPreferences.showOverview,
    viewPreferences.showRowStats,
    viewPreferences.showSequenceLogo,
    viewPreferences.showTemplateAxis,
    viewPreferences.showTranslation,
  ]);

  const copyFromViewer = useCallback(async (label: string, content: string) => {
    let ok = false;
    try {
      ok = await onCopy(label, content);
    } catch {
      ok = false;
    }
    if (copyStatusTimerRef.current !== null) window.clearTimeout(copyStatusTimerRef.current);
    setCopyStatus({
      label,
      message: ok ? `${label} copied` : 'Copy was blocked. Use Download or copy from Text view.',
      tone: ok ? 'status' : 'error',
    });
    copyStatusTimerRef.current = window.setTimeout(() => {
      setCopyStatus(null);
      copyStatusTimerRef.current = null;
    }, 2200);
    return ok;
  }, [onCopy]);

  // Transient status line (reuses the copy-status region) for image export.
  const flashStatus = useCallback((label: string, message: string, tone: 'status' | 'error') => {
    if (copyStatusTimerRef.current !== null) window.clearTimeout(copyStatusTimerRef.current);
    setCopyStatus({ label, message, tone });
    copyStatusTimerRef.current = window.setTimeout(() => {
      setCopyStatus(null);
      copyStatusTimerRef.current = null;
    }, 2600);
  }, []);

  const exportAlignmentImage = useCallback(async (format: 'png' | 'svg') => {
    if (!activeAlignment) return;
    // "Visible view" uses the matrix's last-reported window; fall back to the
    // whole alignment when the viewer isn't mounted (Text/Trace mode) or hasn't
    // reported yet. "Whole alignment" always spans every column.
    const visible = visibleColumnsRef.current;
    const viewWindow = imageScope === 'view' && visible && visible.end > visible.start ? visible : null;
    // A fixed, legible export density derived from the font-size preference;
    // the layout scales this down when a whole wide alignment must fit the budget.
    const imageFontSize = Math.max(9, Math.min(16, fontSize));
    const layout = computeAlignmentImageLayout(activeAlignment, {
      scope: imageScope,
      startColumn: viewWindow ? viewWindow.start : 0,
      endColumn: viewWindow ? viewWindow.end : activeAlignment.alignmentLength,
      cellWidth: Math.max(11, Math.round(imageFontSize * 0.95)),
      cellHeight: Math.round(imageFontSize * 1.55) + 4,
      fontSize: imageFontSize,
    });
    const rows = imageExportRows(activeAlignment, referenceRowId);
    const title = activeAlignment.name;
    try {
      if (format === 'svg') {
        const svg = renderAlignmentImageSvg(rows, activeAlignment.molecule, colorScheme, layout, title);
        const filename = safeAlignmentFilename(activeAlignment, 'svg');
        downloadBlobFile(filename, new Blob([svg], { type: 'image/svg+xml' }));
        flashStatus('Image export', layout.clamped ? `Saved ${filename} (scaled to fit)` : `Saved ${filename}`, 'status');
        return;
      }
      const canvas = renderAlignmentImageCanvas(rows, activeAlignment.molecule, colorScheme, layout, title);
      const blob = canvas ? await canvasToPngBlob(canvas) : null;
      if (!blob) {
        flashStatus('Image export', 'PNG export is unavailable here. Try Save SVG.', 'error');
        return;
      }
      const filename = safeAlignmentFilename(activeAlignment, 'png');
      downloadBlobFile(filename, blob);
      flashStatus('Image export', layout.clamped ? `Saved ${filename} (scaled; Save SVG for full vector)` : `Saved ${filename}`, 'status');
    } catch {
      flashStatus('Image export', 'Image export failed. Try Save SVG or the Visible view scope.', 'error');
    }
  }, [activeAlignment, colorScheme, fontSize, imageScope, referenceRowId, flashStatus]);

  const hydrateInputsFromAlignment = useCallback((alignment: ArtifactAlignment) => {
    const linked = alignment.rows.map((row) => (
      row.sourceRecordId ? records.find((record) => record.id === row.sourceRecordId) ?? null : null
    ));
    const fullyLinked = linked.length >= 2 && linked.every((record): record is ViewerRecord => Boolean(record));
    const compatible = fullyLinked && linked.every((record) => record.type === linked[0].type);
    setAlignmentName(alignment.name);
    setFilter('');
    setError(null);
    if (compatible) {
      const linkedRecords = linked as ViewerRecord[];
      const reference = alignment.rows.find((row) => row.id === alignment.referenceRowId);
      setSelectedIds(new Set(linkedRecords.map((record) => record.id)));
      setSelectedOnly(false);
      setSourceMode('records');
      setLocalTemplateId(reference?.sourceRecordId ?? linkedRecords[0].id);
      explicitlySelectedTemplateIdRef.current = reference?.sourceRecordId ?? linkedRecords[0].id;
      setIntakeStatus({
        message: `Loaded ${linkedRecords.length} linked workspace records from “${alignment.name}”. Changes create a new session result.`,
        tone: 'status',
      });
      return;
    }
    setSelectedIds(new Set());
    setSelectedOnly(false);
    setLocalTemplateId('');
    explicitlySelectedTemplateIdRef.current = null;
    setSourceMode('records');
    setAlignedFasta(formatAlignedFasta(alignment));
    setImportMolecule(alignment.molecule);
    setImportVersion(alignment.engine.version ?? '');
    setImportEngine(['mafft', 'muscle', 'clustal-omega'].includes(alignment.engine.id) ? alignment.engine.id : 'imported');
    setIntakeStatus({
      message: 'Original inputs are not linked to workspace records, so the record selection was cleared. Switch to Aligned file to reuse the saved aligned rows.',
      tone: 'status',
    });
  }, [records]);

  const selectAlignment = useCallback((id: string) => {
    const next = alignments.find((alignment) => alignment.id === id) ?? null;
    onActiveAlignmentChange(next?.id ?? null);
    if (next && sourceOpen) hydrateInputsFromAlignment(next);
    setError(null);
  }, [alignments, hydrateInputsFromAlignment, onActiveAlignmentChange, sourceOpen]);

  const toggleRecord = (record: ViewerRecord, checked: boolean) => {
    setError(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (!checked) {
        next.delete(record.id);
        return next;
      }
      const chosen = records.filter((candidate) => next.has(candidate.id));
      const molecule = chosen[0]?.type;
      if (molecule && molecule !== record.type) {
        setError(`Choose only ${molecule.toUpperCase()} records for one alignment.`);
        return current;
      }
      if (next.size >= ARTIFACT_MSA_MAX_LOCAL_SEQUENCES) {
        setError(`Browser alignment supports at most ${ARTIFACT_MSA_MAX_LOCAL_SEQUENCES} records.`);
        return current;
      }
      next.add(record.id);
      return next;
    });
  };

  const clearSelectedRecords = () => {
    setSelectedIds(new Set());
    setSelectedOnly(false);
    explicitlySelectedTemplateIdRef.current = null;
    setError(null);
  };

  const importRecordFiles = useCallback(async (files: FileList | File[]) => {
    const pending = Array.from(files);
    if (pending.length === 0) return;
    setError(null);
    setIntakeStatus({ message: `Reading ${pending.length} sequence file${pending.length === 1 ? '' : 's'}…`, tone: 'status' });
    let result: ClaudeScienceMsaRecordImportResult;
    try {
      result = await onImportRecords(pending);
    } catch (caught) {
      setIntakeStatus({
        message: caught instanceof Error ? caught.message : 'The sequence files could not be imported.',
        tone: 'error',
      });
      return;
    }
    const firstType = result.records[0]?.type;
    const compatible = firstType ? result.records.filter((record) => record.type === firstType) : [];
    if (compatible.length > 0) {
      const templateCandidate = records.find((record) => (
        record.id === localTemplateId && record.type === firstType && record.sequence.length <= MSA_MAX_SEQ_LEN
      ));
      const eligibleImports = compatible.filter((record) => record.sequence.length <= MSA_MAX_SEQ_LEN);
      const importedTraces = eligibleImports.filter((record) => record.sangerTrace);
      const isTraceIntake = importedTraces.length > 0;
      const justifiedTemplate = templateCandidate && (
        !isTraceIntake
        || shouldRetainTraceTemplate(templateCandidate, importedTraces, explicitlySelectedTemplateIdRef.current)
      ) ? templateCandidate : null;
      const importsWithoutTemplate = justifiedTemplate
        ? eligibleImports.filter((record) => record.id !== justifiedTemplate.id)
        : eligibleImports;
      const importCapacity = ARTIFACT_MSA_MAX_LOCAL_SEQUENCES - (justifiedTemplate ? 1 : 0);
      const selectedImports = importsWithoutTemplate.slice(0, importCapacity);
      const retainedTemplate = justifiedTemplate;
      const selected = isTraceIntake
        ? [...selectedImports, ...(retainedTemplate ? [retainedTemplate] : [])]
        : [
            ...(retainedTemplate ? [retainedTemplate] : []),
            ...selectedImports,
          ].slice(0, ARTIFACT_MSA_MAX_LOCAL_SEQUENCES);
      const importedTemplate = selectedImports.find((record) => !record.sangerTrace) ?? selectedImports[0];
      const nextTemplate = retainedTemplate ?? importedTemplate ?? selected[0];
      setSelectedIds(new Set(selected.map((record) => record.id)));
      setSelectedOnly(true);
      setSourceMode('records');
      setSourceOpen(true);
      setLocalTemplateId(nextTemplate?.id ?? '');
      explicitlySelectedTemplateIdRef.current = retainedTemplate?.id === explicitlySelectedTemplateIdRef.current
        ? retainedTemplate.id
        : null;
      if (!alignmentName.trim()) {
        setAlignmentName(`${compatible[0].group?.trim() || compatible[0].name} alignment`);
      }
      const skippedMixed = result.records.length - compatible.length;
      const skippedLong = compatible.filter((record) => record.sequence.length > MSA_MAX_SEQ_LEN).length;
      const skippedCapacity = Math.max(
        0,
        importsWithoutTemplate.length - selectedImports.length,
      );
      const notes = [
        skippedMixed > 0 ? `${skippedMixed} different-molecule record${skippedMixed === 1 ? '' : 's'} not selected` : '',
        skippedLong > 0 ? `${skippedLong} long record${skippedLong === 1 ? '' : 's'} need an external alignment` : '',
        skippedCapacity > 0 ? `${skippedCapacity} over the ${ARTIFACT_MSA_MAX_LOCAL_SEQUENCES}-record preview limit` : '',
      ].filter(Boolean);
      const selectedImportedTraceCount = selectedImports.filter((record) => record.sangerTrace).length;
      const traceSelection = isTraceIntake && nextTemplate
        ? `selected ${selectedImportedTraceCount} imported AB1 read${selectedImportedTraceCount === 1 ? '' : 's'} · initial template ${nextTemplate.name}`
        : '';
      setIntakeStatus({
        message: `${result.message}${traceSelection ? ` · ${traceSelection}` : ''}${notes.length > 0 ? ` · ${notes.join(' · ')}` : ''}`,
        tone: result.tone === 'error' || notes.length > 0 ? 'error' : 'status',
      });
      return;
    }
    setIntakeStatus({ message: result.message || 'No usable sequence records were imported.', tone: 'error' });
  }, [alignmentName, localTemplateId, onImportRecords, records]);

  const selectTemplate = useCallback((rowId: string) => {
    if (!activeAlignment?.rows.some((row) => row.id === rowId)) return;
    setReferenceRowId(rowId);
    setDifferenceIndex(-1);
    setJumpColumn(null);
    setColumnDraft('');
    setColumnError(null);
    setColumnStatus('');
    if (activeAlignment.referenceRowId === rowId) return;
    onUpdateAlignmentTemplate(activeAlignment.id, rowId);
  }, [activeAlignment, onUpdateAlignmentTemplate]);

  const saveAlignment = (alignment: ArtifactAlignment) => {
    const saved = onSaveAlignment(alignment);
    onActiveAlignmentChange(saved.id);
    setSourceOpen(false);
    updateViewPreferences({ displayMode: 'viewer' });
    setError(null);
    if (copyStatusTimerRef.current !== null) window.clearTimeout(copyStatusTimerRef.current);
    setCopyStatus({
      label: 'alignment-save',
      message: `Saved ${saved.rows.length} rows × ${saved.alignmentLength.toLocaleString()} columns to this session · export a workspace backup to keep it after reload.`,
      tone: 'status',
    });
    copyStatusTimerRef.current = window.setTimeout(() => {
      setCopyStatus(null);
      copyStatusTimerRef.current = null;
    }, 2_800);
  };

  const runLocalAlignment = () => {
    setRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        const templateRecord = selectedRecords.find((record) => record.id === localTemplateId) ?? selectedRecords[0];
        let reverseOrientedCount = 0;
        const alignmentRecords = selectedRecords.map((record) => {
          if (!autoOrientTraces || !record.sangerTrace || !templateRecord || record.id === templateRecord.id || record.type !== 'dna') return record;
          const preference = preferredTraceOrientation(record.sequence, templateRecord.sequence);
          if (preference.orientation !== 'reverse') return record;
          reverseOrientedCount += 1;
          return { ...record, sequence: reverseComplement(record.sequence) };
        });
        const alignment = createLocalArtifactAlignment(alignmentRecords, {
          id: `alignment-${Date.now()}`,
          name: alignmentName.trim() || `Alignment of ${selectedRecords.length} records`,
        });
        const templateRow = alignment.rows.find((row) => row.sourceRecordId === templateRecord?.id);
        saveAlignment({
          ...alignment,
          referenceRowId: templateRow?.id ?? alignment.referenceRowId,
          note: reverseOrientedCount > 0
            ? `${alignment.note} Auto-oriented ${reverseOrientedCount} AB1 read${reverseOrientedCount === 1 ? '' : 's'} to the chosen template with a bounded k-mer strand check.`
            : alignment.note,
        });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Alignment could not be computed.');
      } finally {
        setRunning(false);
      }
    }, 0);
  };

  const importAlignment = () => {
    try {
      saveAlignment(parseAlignmentText(alignedFasta, {
        id: `alignment-${Date.now()}`,
        name: alignmentName.trim() || 'Imported alignment',
        molecule: importMolecule,
        engine: engineMetadata(importEngine, importVersion),
        createdAt: new Date().toISOString(),
        note: 'Imported from pre-aligned FASTA or CLUSTAL text; the artifact did not execute the external alignment engine.',
      }));
    } catch (caught) {
      setError(caught instanceof ArtifactAlignmentError || caught instanceof Error ? caught.message : 'Aligned file could not be imported.');
    }
  };

  const loadAlignmentFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > ARTIFACT_MSA_MAX_IMPORT_BYTES) {
      setError(`Alignment files cannot exceed ${Math.round(ARTIFACT_MSA_MAX_IMPORT_BYTES / 1_000_000 * 10) / 10} MB.`);
      return;
    }
    try {
      const text = await file.text();
      setAlignedFasta(text);
      if (!alignmentName.trim()) setAlignmentName(file.name.replace(/\.(?:fa|fasta|fas|faa|aln)$/i, ''));
      if (/mafft/i.test(file.name)) setImportEngine('mafft');
      else if (/muscle/i.test(file.name)) setImportEngine('muscle');
      else if (/clustal|clustalo/i.test(file.name)) setImportEngine('clustal-omega');
      setSourceMode('import');
      setSourceOpen(true);
      setIntakeStatus({ message: `Loaded ${file.name} · review the molecule and engine, then import.`, tone: 'status' });
      setError(null);
    } catch {
      setError('The alignment file could not be read.');
    }
  };

  const dragHasFiles = (event: ReactDragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  const handleDragEnter = (event: ReactDragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dropDepthRef.current += 1;
    setDropActive(true);
  };
  const handleDragOver = (event: ReactDragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = (event: ReactDragEvent) => {
    if (!dragHasFiles(event) && !dropActive) return;
    event.preventDefault();
    event.stopPropagation();
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) setDropActive(false);
  };
  const handleDrop = (event: ReactDragEvent) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dropDepthRef.current = 0;
    setDropActive(false);
    const files = event.dataTransfer.files;
    if (!files.length) return;
    const obviousRecordFiles = Array.from(files).some((file) => /\.(?:ab1|abi|gb|gbk|genbank)$/i.test(file.name));
    const obviousAlignmentFile = files.length === 1 && /\.aln$/i.test(files[0].name);
    if (obviousAlignmentFile) {
      setSourceMode('import');
      void loadAlignmentFile(files[0]);
      return;
    }
    if (sourceMode === 'records' || obviousRecordFiles || files.length > 1) {
      void importRecordFiles(files);
      return;
    }
    void loadAlignmentFile(files[0]);
  };

  const jumpDifference = (direction: -1 | 1) => {
    if (differenceNavigationDisabled) return;
    const nextIndex = differenceIndex < 0
      ? direction > 0 ? 0 : differences.length - 1
      : (differenceIndex + direction + differences.length) % differences.length;
    setDifferenceIndex(nextIndex);
    setJumpColumn(differences[nextIndex]);
    setJumpRowId(null);
    setJumpToken((token) => token + 1);
  };

  const jumpToRowDifference = useCallback((rowId: string, column: number) => {
    setDifferenceIndex(-1);
    setJumpColumn(column);
    setJumpRowId(rowId);
    setJumpToken((token) => token + 1);
  }, []);

  const goToSearchMatch = useCallback((index: number) => {
    const count = searchMatches.length;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    const match = searchMatches[next];
    const matchColumn = match.columns[Math.floor(match.columns.length / 2)] ?? match.startColumn;
    setSearchIndex(next);
    setDifferenceIndex(-1);
    // Centre on an actual matched residue column, not the midpoint between the
    // endpoints — a gap-spanning match's midpoint can be an unrelated column.
    setJumpColumn(matchColumn);
    setJumpRowId(match.rowId);
    setJumpToken((token) => token + 1);
    setMatrixFocusRequest((request) => ({ rowId: match.rowId, column: matchColumn, token: (request?.token ?? 0) + 1 }));
  }, [searchMatches]);

  const stepSearch = useCallback((direction: 1 | -1) => {
    if (searchMatches.length === 0) return;
    if (searchIndex < 0) goToSearchMatch(direction === 1 ? 0 : searchMatches.length - 1);
    else goToSearchMatch(searchIndex + direction);
  }, [goToSearchMatch, searchIndex, searchMatches.length]);

  const goToCoordinate = () => {
    if (!activeAlignment) return;
    const normalized = columnDraft.trim();
    const requested = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
    const template = activeAlignment.rows.find((row) => row.id === referenceRowId) ?? activeAlignment.rows[0];
    const maximum = coordinateSystem === 'alignment'
      ? activeAlignment.alignmentLength
      : template?.aligned.replace(/-/g, '').length ?? 0;
    if (!Number.isInteger(requested) || requested < 1 || requested > maximum) {
      setColumnError(`Enter a whole ${coordinateSystem === 'alignment' ? 'column' : 'template position'} from 1 to ${maximum.toLocaleString()}.`);
      setColumnStatus('');
      return;
    }
    const column = coordinateSystem === 'alignment'
      ? requested - 1
      : templatePositionCoordinates(template?.aligned ?? '').findIndex((position) => position === requested);
    if (column < 0) {
      setColumnError(`Template position ${requested.toLocaleString()} could not be mapped in this alignment.`);
      setColumnStatus('');
      return;
    }
    setColumnError(null);
    setDifferenceIndex(-1);
    setJumpColumn(column);
    setJumpRowId(null);
    setJumpToken((token) => token + 1);
    setColumnStatus(coordinateSystem === 'alignment'
      ? `Alignment column ${requested.toLocaleString()} shown.`
      : `Template position ${requested.toLocaleString()} in ${template?.name ?? 'template'} shown at alignment column ${(column + 1).toLocaleString()}.`);
  };

  const resetAlignmentView = useCallback(() => {
    onViewPreferencesChange({ ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES });
    setDifferenceIndex(-1);
    setJumpColumn(null);
    setCoordinateSystem('alignment');
    setColumnDraft('');
    setColumnError(null);
    setColumnStatus('');
    setViewResetToken((token) => token + 1);
    setViewResetStatus('Alignment view reset. Result and comparison template kept.');
  }, [onViewPreferencesChange]);

  const closeViewMenu = useCallback(() => {
    setViewMenuOpen(false);
    window.requestAnimationFrame(() => viewMenuButtonRef.current?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!viewMenuOpen) return undefined;
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeViewMenu();
    };
    window.addEventListener('keydown', closeFromEscape, true);
    return () => window.removeEventListener('keydown', closeFromEscape, true);
  }, [closeViewMenu, viewMenuOpen]);

  const deleteActiveAlignment = () => {
    if (!activeAlignment) return;
    const currentIndex = alignments.findIndex((alignment) => alignment.id === activeAlignment.id);
    onDeleteAlignment(activeAlignment.id);
    const remaining = alignments.filter((alignment) => alignment.id !== activeAlignment.id);
    onActiveAlignmentChange(remaining[Math.min(currentIndex, Math.max(0, remaining.length - 1))]?.id ?? null);
    setPendingDeleteId(null);
    if (remaining.length === 0) setSourceOpen(true);
    window.requestAnimationFrame(() => {
      if (remaining.length > 0) alignmentPickerRef.current?.focus();
      else sourceSummaryRef.current?.focus();
    });
  };

  const cancelDelete = () => {
    setPendingDeleteId(null);
    window.requestAnimationFrame(() => deleteButtonRef.current?.focus());
  };

  const revealSourceSettings = useCallback(() => {
    if (activeAlignment) hydrateInputsFromAlignment(activeAlignment);
    setSourceOpen(true);
    setError(null);
    window.requestAnimationFrame(() => {
      sourceSummaryRef.current?.scrollIntoView({ block: 'nearest' });
      sourceSummaryRef.current?.focus({ preventScroll: true });
    });
  }, [activeAlignment, hydrateInputsFromAlignment]);

  const handleSourceToggle = useCallback((open: boolean) => {
    if (open && !sourceOpen && activeAlignment) hydrateInputsFromAlignment(activeAlignment);
    setSourceOpen(open);
  }, [activeAlignment, hydrateInputsFromAlignment, sourceOpen]);

  return (
    <div
      className="motif-cs-msa-workspace"
      data-testid="msa-workspace"
      data-drop-active={dropActive || undefined}
      data-motif-cs-escape-scope={searchQuery ? 'true' : undefined}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropActive ? (
        <div className="motif-cs-msa-drop-overlay" data-testid="msa-drop-overlay" aria-hidden="true">
          <UploadCloud size={22} />
          <strong>{sourceMode === 'records' ? 'Add and select sequence files' : 'Load an aligned FASTA or CLUSTAL file'}</strong>
        </div>
      ) : null}
      <details
        className="motif-cs-msa-source"
        open={sourceOpen}
        onToggle={(event) => handleSourceToggle(event.currentTarget.open)}
      >
        <summary ref={sourceSummaryRef}>
          <span className="motif-cs-msa-source-summary-copy">
            <strong>Inputs &amp; alignment settings</strong>
            <small>{sourceOpen ? 'Choose records or import an aligned file' : 'Change records, template, or source'}</small>
          </span>
          <span className="motif-cs-msa-source-summary-actions">
            <span className="motif-cs-chip">
              {!sourceOpen && activeAlignment
                ? activeAlignment.engine.label
                : sourceMode === 'records'
                  ? `${selectedRecords.length} selected`
                  : 'aligned file'}
            </span>
            <span className="motif-cs-msa-source-edit-label">{sourceOpen ? 'Hide' : 'Edit'}</span>
            <ChevronDown className="motif-cs-msa-source-chevron" size={14} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </summary>
        <div className="motif-cs-msa-source-body" id="motif-cs-msa-source-body">
          <div className="motif-cs-segmented motif-cs-msa-source-tabs" role="group" aria-label="Alignment source">
            <button type="button" data-active={sourceMode === 'records' || undefined} aria-pressed={sourceMode === 'records'} onClick={() => setSourceMode('records')}>Workspace records</button>
            <button type="button" data-active={sourceMode === 'import' || undefined} aria-pressed={sourceMode === 'import'} onClick={() => setSourceMode('import')}>Aligned file</button>
          </div>
          {activeAlignment ? <p className="motif-cs-msa-source-guide">Changes create a new alignment; the current result stays available in this session.</p> : null}

          {sourceMode === 'records' ? (
            <div className="motif-cs-msa-record-source" data-testid="msa-record-source">
              <div className="motif-cs-msa-file-intake" data-testid="msa-record-dropzone" role="group" aria-label="Add sequence files to this alignment">
                <UploadCloud size={16} aria-hidden="true" />
                <span><strong>Drop sequence files</strong><small>FASTA, GenBank, AB1/ABI, or raw text</small></span>
                <input
                  ref={recordFileInputRef}
                  className="motif-cs-visually-hidden"
                  type="file"
                  multiple
                  accept=".fa,.fasta,.fas,.faa,.fna,.gb,.gbk,.genbank,.ab1,.abi,.txt,text/plain"
                  aria-label="Choose sequence files for alignment"
                  onChange={(event) => {
                    if (event.target.files?.length) void importRecordFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
                <button className="motif-cs-mini-button" type="button" onClick={() => recordFileInputRef.current?.click()}>Choose files</button>
              </div>
              <div className="motif-cs-msa-source-fields">
                <label>
                  <span>Name</span>
                  <input className="motif-cs-input" name="alignment-name" autoComplete="off" value={alignmentName} onChange={(event) => setAlignmentName(event.target.value)} placeholder="Alignment name" />
                </label>
                <label>
                  <span>Filter records</span>
                  <input className="motif-cs-input" name="alignment-record-filter" autoComplete="off" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Name, group, type…" />
                </label>
              </div>
              <div className="motif-cs-msa-selection-actions">
                <span>{selectedRecords.length} selected</span>
                <button
                  className="motif-cs-mini-button"
                  type="button"
                  data-testid="msa-selected-only"
                  data-active={selectedOnly || undefined}
                  aria-pressed={selectedOnly}
                  disabled={selectedRecords.length === 0}
                  onClick={() => setSelectedOnly((current) => !current)}
                >
                  Selected only
                </button>
                <button
                  className="motif-cs-mini-button"
                  type="button"
                  data-testid="msa-clear-selection"
                  disabled={selectedRecords.length === 0}
                  onClick={clearSelectedRecords}
                >
                  Clear
                </button>
              </div>
              <div className="motif-cs-msa-record-list" data-testid="msa-record-list">
                {filteredRecords.map((record) => {
                  const checked = selectedIds.has(record.id);
                  const tooLong = record.sequence.length > MSA_MAX_SEQ_LEN;
                  const wrongType = Boolean(selectedType && selectedType !== record.type && !checked);
                  const atCapacity = !checked && selectedIds.size >= ARTIFACT_MSA_MAX_LOCAL_SEQUENCES;
                  const disabled = tooLong || wrongType || atCapacity;
                  return (
                    <label key={record.id} className="motif-cs-msa-record-option" data-active={checked || undefined} data-disabled={disabled || undefined}>
                      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => toggleRecord(record, event.target.checked)} />
                      <span className="motif-cs-msa-record-name" title={record.name}>{record.name}</span>
                      <small>{record.group ? `${record.group} · ` : ''}{record.type.toUpperCase()} · {record.sequence.length.toLocaleString()} {sequenceUnit(record.type)}</small>
                      {tooLong ? <em>import an external alignment</em> : wrongType ? <em>different molecule</em> : atCapacity ? <em>preview limit reached</em> : null}
                    </label>
                  );
                })}
                {filteredRecords.length === 0 ? <p className="motif-cs-muted">{selectedOnly ? 'No records selected.' : 'No records match this filter.'}</p> : null}
              </div>
              {selectedRecords.length >= 2 ? (
                <div className="motif-cs-msa-local-options">
                  <label>
                    <span>Initial template</span>
                    <select value={localTemplateId} onChange={(event) => {
                      setLocalTemplateId(event.target.value);
                      explicitlySelectedTemplateIdRef.current = event.target.value;
                    }}>
                      {selectedRecords.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
                    </select>
                  </label>
                  {selectedTraceCount > 0 && selectedType === 'dna' ? (
                    <label className="motif-cs-msa-auto-orient" title="Compare forward and reverse k-mer support against the chosen template before alignment">
                      <input type="checkbox" checked={autoOrientTraces} onChange={(event) => setAutoOrientTraces(event.target.checked)} />
                      <span>Auto-orient AB1 reads</span>
                    </label>
                  ) : null}
                </div>
              ) : null}
              <div className="motif-cs-msa-run-row">
                <span className="motif-cs-muted">
                  {selectedRecords.length >= 2
                    ? exceedsLocalBudget
                      ? `${Math.round(workEstimate / 1_000_000)}M cells is above the browser budget · import an external alignment`
                      : `${Math.max(1, Math.round(workEstimate / 1_000_000))}M estimated comparison cells`
                    : `Select 2–${ARTIFACT_MSA_MAX_LOCAL_SEQUENCES} same-type records`}
                </span>
                <button
                  className="motif-cs-mini-button motif-cs-mini-button-accent"
                  type="button"
                  data-testid="msa-run-button"
                  disabled={selectedRecords.length < 2 || exceedsLocalBudget || running}
                  onClick={runLocalAlignment}
                >
                  <Play size={13} aria-hidden="true" />
                  {running ? 'Aligning…' : activeAlignment ? 'Align as new result' : 'Align in browser'}
                </button>
              </div>
              {selectedRecords.length >= 2 ? (
                <div className="motif-cs-msa-external-handoff">
                  <span>
                    <strong>External runner input</strong>
                    <small>{selectedType === 'rna'
                      ? 'Unaligned RNA FASTA for MAFFT, MUSCLE, or Clustal Omega'
                      : 'Unaligned FASTA for run-msa.mjs, MAFFT, MUSCLE, or Clustal Omega'}</small>
                  </span>
                  <div>
                    <button className="motif-cs-mini-button" type="button" data-testid="msa-copy-input-fasta" onClick={() => void copyFromViewer('Unaligned FASTA inputs', selectedInputFasta)}>Copy inputs</button>
                    <button className="motif-cs-mini-button" type="button" data-testid="msa-download-input-fasta" onClick={() => onDownload(inputFastaFilename(alignmentName), selectedInputFasta, 'text/plain')}>Download FASTA</button>
                  </div>
                </div>
              ) : null}
              {selectedRecords.some((record) => record.topology === 'circular') ? (
                <p className="motif-cs-msa-caution">Circular records align from their stored base 1; the preview does not rotate origins automatically.</p>
              ) : null}
            </div>
          ) : (
            <div className="motif-cs-msa-import-source" data-testid="msa-import-source">
              <div className="motif-cs-msa-file-intake" data-testid="msa-alignment-dropzone" role="group" aria-label="Drop a pre-aligned sequence file">
                <UploadCloud size={16} aria-hidden="true" />
                <span><strong>Drop an aligned file</strong><small>Aligned FASTA or CLUSTAL · one file</small></span>
                <input ref={alignmentFileInputRef} className="motif-cs-visually-hidden" type="file" accept=".fa,.fasta,.fas,.faa,.aln,text/plain" aria-label="Choose a pre-aligned sequence file" onChange={(event) => { void loadAlignmentFile(event.target.files?.[0]); event.target.value = ''; }} />
                <button className="motif-cs-mini-button" type="button" onClick={() => alignmentFileInputRef.current?.click()}>Choose file</button>
              </div>
              <div className="motif-cs-msa-source-fields motif-cs-msa-import-fields">
                <label>
                  <span>Name</span>
                  <input className="motif-cs-input" name="imported-alignment-name" autoComplete="off" value={alignmentName} onChange={(event) => setAlignmentName(event.target.value)} placeholder="Imported alignment" />
                </label>
                <label>
                  <span>Molecule</span>
                  <select className="motif-cs-input" value={importMolecule} onChange={(event) => setImportMolecule(event.target.value as SequenceType)}>
                    <option value="dna">DNA</option>
                    <option value="rna">RNA</option>
                    <option value="protein">Protein</option>
                  </select>
                </label>
                <label>
                  <span>Created with</span>
                  <select className="motif-cs-input" value={importEngine} onChange={(event) => setImportEngine(event.target.value)}>
                    <option value="mafft">MAFFT</option>
                    <option value="muscle">MUSCLE</option>
                    <option value="clustal-omega">Clustal Omega</option>
                    <option value="imported">Other / unknown</option>
                  </select>
                </label>
                <label>
                  <span>Version <small>optional</small></span>
                  <input className="motif-cs-input" name="alignment-engine-version" autoComplete="off" value={importVersion} onChange={(event) => setImportVersion(event.target.value)} placeholder="e.g. 7.526" />
                </label>
              </div>
              <textarea
                className="motif-cs-textarea motif-cs-msa-import-text"
                value={alignedFasta}
                onChange={(event) => setAlignedFasta(event.target.value)}
                placeholder=">sample-a&#10;ACGT--ACGT&#10;>sample-b&#10;ACGTTTACGT"
                spellCheck={false}
                name="aligned-sequence-text"
                aria-label="Aligned FASTA or CLUSTAL"
              />
              <div className="motif-cs-msa-run-row">
                <span className="motif-cs-muted">FASTA or CLUSTAL · rows must already be aligned.</span>
                <button className="motif-cs-mini-button motif-cs-mini-button-accent" type="button" data-testid="msa-import-button" disabled={!alignedFasta.trim()} onClick={importAlignment}>{activeAlignment ? 'Import as new alignment' : 'Import alignment'}</button>
              </div>
              <p className="motif-cs-msa-caution">The HTML viewer does not run external executables. This label records the engine you used; it is never a silent fallback.</p>
            </div>
          )}
          {intakeStatus ? <div className="motif-cs-msa-intake-status" data-testid="msa-source-link-status" role="status" data-tone={intakeStatus.tone}>{intakeStatus.message}</div> : null}
          {error ? <div className="motif-cs-msa-error" role="alert">{error}</div> : null}
        </div>
      </details>

      <div
        className="motif-cs-msa-copy-status"
        data-testid="msa-copy-status"
        data-tone={copyStatus?.tone}
        data-empty={!copyStatus || undefined}
        role="status"
        aria-live="polite"
      >
        {copyStatus?.message ?? ''}
      </div>

      {activeAlignment ? (
        <>
          <div className="motif-cs-msa-toolbar" data-testid="msa-result-toolbar">
            <label className="motif-cs-msa-alignment-picker">
              <span className="motif-cs-visually-hidden">Alignment in session</span>
              <select ref={alignmentPickerRef} value={activeAlignment.id} onChange={(event) => selectAlignment(event.target.value)}>
                {alignments.map((alignment) => <option key={alignment.id} value={alignment.id}>{pickerLabels.get(alignment.id) ?? alignment.name}</option>)}
                {!alignments.some((alignment) => alignment.id === activeAlignment.id) ? <option value={activeAlignment.id}>{pickerLabels.get(activeAlignment.id) ?? activeAlignment.name}</option> : null}
              </select>
            </label>
            <span
              className="motif-cs-chip motif-cs-msa-engine-chip"
              data-fallback={activeAlignment.engine.usedFallback || undefined}
              title={`${activeAlignment.engine.label}${activeAlignment.engine.version ? ` ${activeAlignment.engine.version}` : ''}${activeAlignment.engine.usedFallback ? ' · fallback used' : ''}`}
            >
              {activeAlignment.engine.label}{activeAlignment.engine.version ? ` ${activeAlignment.engine.version}` : ''}{activeAlignment.engine.usedFallback ? ' · fallback' : ''}
            </span>
            <button
              className="motif-cs-mini-button motif-cs-msa-edit-inputs"
              type="button"
              data-testid="msa-edit-inputs"
              onClick={revealSourceSettings}
              aria-controls="motif-cs-msa-source-body"
              title="Change records, template, or alignment source"
            >
              <SlidersHorizontal size={13} strokeWidth={2.1} aria-hidden="true" />
              Edit inputs
            </button>
            <div className="motif-cs-msa-toolbar-spacer" />
            <div className="motif-cs-segmented" role="group" aria-label="Alignment presentation">
              <button type="button" data-active={displayMode === 'viewer' || undefined} aria-pressed={displayMode === 'viewer'} onClick={() => updateViewPreferences({ displayMode: 'viewer' })}>Viewer</button>
              {traceAvailable ? <button type="button" data-active={displayMode === 'trace' || undefined} aria-pressed={displayMode === 'trace'} onClick={() => updateViewPreferences({ displayMode: 'trace' })}>Traces</button> : null}
              <button type="button" data-active={displayMode === 'text' || undefined} aria-pressed={displayMode === 'text'} onClick={() => updateViewPreferences({ displayMode: 'text' })}>Text</button>
            </div>
            <details
              ref={viewMenuRef}
              className="motif-cs-msa-view-menu"
              open={viewMenuOpen}
              onToggle={(event) => setViewMenuOpen(event.currentTarget.open)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                closeViewMenu();
              }}
            >
              <summary ref={viewMenuButtonRef} data-testid="msa-view-menu-button" aria-label="Alignment view options" aria-expanded={viewMenuOpen}>
                <SlidersHorizontal size={13} strokeWidth={2.1} aria-hidden="true" />
                View
                <ChevronDown size={12} aria-hidden="true" />
              </summary>
              <div className="motif-cs-msa-view-menu-panel" data-testid="msa-view-menu" data-motif-cs-escape-scope={viewMenuOpen || undefined}>
                <strong>Display tracks</strong>
                {([
                  ['showOverview', 'Overview'],
                  ['showAlignmentAxis', 'Alignment axis'],
                  ['showTemplateAxis', 'Template axis'],
                  ['showRowStats', 'Row statistics'],
                  ['showRowStatsPanel', 'Row statistics table'],
                  ['showConservation', 'Conservation marks'],
                  ['showConservationHistogram', 'Conservation histogram'],
                  ['showOccupancy', 'Occupancy'],
                  ['showConsensus', 'Consensus'],
                  ['showSequenceLogo', 'Sequence logo'],
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={viewPreferences[key]}
                      onChange={(event) => updateViewPreferences({ [key]: event.target.checked })}
                    />
                    <span>{label}</span>
                  </label>
                ))}
                {activeAlignment.molecule !== 'protein' ? (
                  <>
                    <label>
                      <input
                        type="checkbox"
                        checked={viewPreferences.showTranslation}
                        onChange={(event) => updateViewPreferences({ showTranslation: event.target.checked })}
                      />
                      <span>Translation (amino acids)</span>
                    </label>
                    {viewPreferences.showTranslation ? (
                      <>
                        <label>
                          <input
                            type="checkbox"
                            checked={viewPreferences.showAminoAcidIndices}
                            onChange={(event) => updateViewPreferences({ showAminoAcidIndices: event.target.checked })}
                          />
                          <span>Amino-acid indices</span>
                        </label>
                        <label className="motif-cs-msa-view-select">
                          <span>Reading frame</span>
                          <select
                            value={translationFrame}
                            aria-label="Translation reading frame"
                            onChange={(event) => updateViewPreferences({ translationFrame: Number(event.target.value) as 0 | 1 | 2 })}
                          >
                            <option value={0}>+1</option>
                            <option value={1}>+2</option>
                            <option value={2}>+3</option>
                          </select>
                        </label>
                      </>
                    ) : null}
                  </>
                ) : null}
                <label>
                  <input
                    type="checkbox"
                    checked={colorMode === 'residue'}
                    onChange={(event) => updateViewPreferences({ colorMode: event.target.checked ? 'residue' : 'mono' })}
                  />
                  <span>Residue colors</span>
                </label>
                <label className="motif-cs-msa-view-select">
                  <span>Colour scheme</span>
                  <select
                    value={colorScheme}
                    disabled={colorMode !== 'residue'}
                    onChange={(event) => updateViewPreferences({ colorScheme: event.target.value as MsaColorScheme })}
                  >
                    <option value="auto">Auto (by molecule)</option>
                    <option value="nucleotide">Nucleotide</option>
                    <option value="clustal">Clustal (protein)</option>
                    <option value="hydrophobicity">Hydrophobicity</option>
                    <option value="taylor">Taylor</option>
                  </select>
                </label>
                {colorMode === 'residue' ? (
                  <ResidueColorLegend molecule={activeAlignment.molecule} colorScheme={colorScheme} />
                ) : null}
                <label className="motif-cs-msa-view-select">
                  <span>Shade columns</span>
                  <select
                    value={shadeMode}
                    onChange={(event) => updateViewPreferences({ shadeMode: event.target.value as MsaShadeMode })}
                  >
                    <option value="none">None</option>
                    <option value="mismatch">Mismatches</option>
                    <option value="identity">By identity</option>
                    <option value="conservation">By conservation</option>
                  </select>
                </label>
                <div className="motif-cs-msa-view-font-row">
                  <span>Aa {fontSize} px</span>
                  <div className="motif-cs-msa-font-controls" role="group" aria-label="Alignment font size">
                    <button className="motif-cs-mini-button" type="button" disabled={fontSize <= 9} onClick={() => updateViewPreferences({ fontSize: Math.max(9, fontSize - 1) })} aria-label="Decrease alignment font size">−</button>
                    <button className="motif-cs-mini-button" type="button" disabled={fontSize >= 16} onClick={() => updateViewPreferences({ fontSize: Math.min(16, fontSize + 1) })} aria-label="Increase alignment font size">+</button>
                  </div>
                </div>
                <button className="motif-cs-mini-button motif-cs-msa-view-reset" type="button" onClick={resetAlignmentView}>Reset alignment view</button>
                <span className="motif-cs-msa-view-menu-status" data-testid="msa-view-menu-status" data-empty={!viewResetStatus || undefined} role="status" aria-live="polite">{viewResetStatus}</span>
              </div>
            </details>
            {pendingDeleteId === activeAlignment.id ? (
              <div className="motif-cs-msa-delete-confirm" role="group" aria-label="Confirm alignment deletion">
                <span>Delete?</span>
                <button ref={cancelDeleteRef} className="motif-cs-mini-button" type="button" onClick={cancelDelete}>Cancel</button>
                <button className="motif-cs-mini-button motif-cs-msa-delete-danger" type="button" data-testid="msa-confirm-delete" onClick={deleteActiveAlignment}>Delete</button>
              </div>
            ) : (
              <button ref={deleteButtonRef} className="motif-cs-mini-button motif-cs-msa-delete" type="button" onClick={() => setPendingDeleteId(activeAlignment.id)} title="Delete this alignment from the session" aria-label="Delete this alignment from the session"><Trash2 size={13} aria-hidden="true" /></button>
            )}
          </div>

          <details
            className="motif-cs-msa-provenance"
            data-testid="msa-provenance"
            data-fallback={activeAlignment.engine.usedFallback || undefined}
          >
            <summary>
              <span>Provenance</span>
              <strong>
                {activeAlignment.engine.label}{activeAlignment.engine.version ? ` ${activeAlignment.engine.version}` : ''}
                {activeAlignment.engine.usedFallback ? ' · fallback: Motif browser preview' : ` · ${engineModeLabel(activeAlignment.engine.mode)}`}
              </strong>
              <ChevronDown size={13} aria-hidden="true" />
            </summary>
            <dl>
              <div><dt>Engine</dt><dd>{activeAlignment.engine.label}{activeAlignment.engine.version ? ` ${activeAlignment.engine.version}` : ''}</dd></div>
              <div><dt>Execution</dt><dd>{engineModeLabel(activeAlignment.engine.mode)}</dd></div>
              {activeAlignment.engine.usedFallback ? <div><dt>Fallback</dt><dd>The requested engine was not used; Motif local browser preview produced this alignment.</dd></div> : null}
              {activeAlignment.engine.parameters?.length ? <div><dt>Parameters</dt><dd><code>{activeAlignment.engine.parameters.join(' ')}</code></dd></div> : null}
              {formatCreatedAt(activeAlignment.createdAt) ? <div><dt>Created</dt><dd><time dateTime={activeAlignment.createdAt}>{formatCreatedAt(activeAlignment.createdAt)}</time></dd></div> : null}
              {activeAlignment.outputSha256 ? <div><dt>Output SHA-256</dt><dd><code title={activeAlignment.outputSha256}>{shortHash(activeAlignment.outputSha256)}</code></dd></div> : null}
              {activeAlignment.rows.some((row) => row.inputSha256) ? (
                <div>
                  <dt>Input SHA-256</dt>
                  <dd className="motif-cs-msa-provenance-inputs">
                    {activeAlignment.rows.filter((row) => row.inputSha256).map((row) => (
                      <span key={row.id}><b>{row.name}</b><code title={row.inputSha256}>{shortHash(row.inputSha256!)}</code></span>
                    ))}
                  </dd>
                </div>
              ) : null}
              {activeAlignment.note ? <div><dt>Note</dt><dd>{activeAlignment.note}</dd></div> : null}
            </dl>
          </details>

          <div className="motif-cs-msa-stats" data-testid="msa-stats-bar">
            <span><strong>{activeAlignment.rows.length}</strong> rows</span>
            <span><strong>{activeAlignment.alignmentLength.toLocaleString()}</strong> columns</span>
            <span><strong>{conservedPct}%</strong> conserved</span>
            <span><strong>{avgIdentity === null ? 'N/A' : `${formatIdentity(avgIdentity)}%`}</strong> avg to template</span>
            <span><strong>{differences.length.toLocaleString()}</strong> differences in overlap</span>
          </div>

          {displayMode === 'viewer' ? (
            <>
              <div className="motif-cs-msa-view-controls">
                <div className="motif-cs-segmented" role="group" aria-label="Alignment emphasis">
                  <button type="button" data-active={emphasis === 'differences' || undefined} aria-pressed={emphasis === 'differences'} onClick={() => updateViewPreferences({ emphasis: 'differences' })}>Differences</button>
                  <button type="button" data-active={emphasis === 'letters' || undefined} aria-pressed={emphasis === 'letters'} onClick={() => updateViewPreferences({ emphasis: 'letters' })}>All letters</button>
                </div>
                <label className="motif-cs-msa-reference-picker">
                  <span>Compare against</span>
                  <select value={referenceRowId} disabled={!hasComparableRows} onChange={(event) => selectTemplate(event.target.value)}>
                    {activeAlignment.rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <label className="motif-cs-msa-sort-picker">
                  <span>Sort</span>
                  <select value={sortMode} onChange={(event) => updateViewPreferences({ sortMode: event.target.value as RowSortMode })}>
                    <option value="original">Original order</option>
                    <option value="name">Name</option>
                    <option value="identity">Identity</option>
                    <option value="mismatches">Mismatches</option>
                    <option value="length">Ungapped length</option>
                  </select>
                </label>
                <div className="motif-cs-msa-difference-nav" role="group" aria-label="Variable column navigation">
                  <button className="motif-cs-mini-button" type="button" disabled={differenceNavigationDisabled} onClick={() => jumpDifference(-1)} aria-label="Previous variable column"><ChevronLeft size={13} /></button>
                  <span>{differenceNavigationLabel}</span>
                  <button className="motif-cs-mini-button" type="button" disabled={differenceNavigationDisabled} onClick={() => jumpDifference(1)} aria-label="Next variable column"><ChevronRight size={13} /></button>
                </div>
                <form
                  className="motif-cs-msa-search"
                  data-testid="msa-search"
                  role="search"
                  aria-busy={searchPending}
                  data-motif-cs-escape-scope={searchQuery ? 'true' : undefined}
                  onSubmit={(event) => { event.preventDefault(); stepSearch(1); }}
                >
                  <Search size={13} aria-hidden="true" className="motif-cs-msa-search-icon" />
                  <input
                    className="motif-cs-input motif-cs-msa-search-input"
                    data-testid="msa-search-input"
                    type="search"
                    name="alignment-search"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MSA_MOTIF_SEARCH_MAX_QUERY_LENGTH}
                    value={searchQuery}
                    placeholder="Find sequence…"
                    aria-label="Find a sequence motif in the alignment"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); stepSearch(event.shiftKey ? -1 : 1); }
                      else if (event.key === 'Escape' && searchQuery) { event.preventDefault(); event.stopPropagation(); setSearchQuery(''); }
                    }}
                  />
                  <span className="motif-cs-msa-search-count" data-testid="msa-search-count" role="status" aria-live="polite">
                    {searchQuery.trim()
                      ? searchPending
                        ? 'Searching…'
                        : searchMatches.length === 0
                          ? searchResult.truncated ? 'Search limit reached' : 'No matches'
                          : `${searchIndex >= 0 ? `${Math.min(searchIndex, searchMatches.length - 1) + 1} of ` : ''}${searchMatches.length.toLocaleString()}${searchResult.truncated ? '+' : ''}`
                      : ''}
                  </span>
                  <button type="button" className="motif-cs-mini-button" data-testid="msa-search-prev" disabled={searchMatches.length === 0} onClick={() => stepSearch(-1)} aria-label="Previous match"><ChevronLeft size={13} /></button>
                  <button type="submit" className="motif-cs-mini-button" data-testid="msa-search-next" disabled={searchMatches.length === 0} aria-label="Next match"><ChevronRight size={13} /></button>
                </form>
                <form
                  className="motif-cs-msa-column-jump"
                  data-invalid={columnError ? true : undefined}
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    goToCoordinate();
                  }}
                >
                  <label className="motif-cs-msa-coordinate-system">
                    <span className="motif-cs-visually-hidden">Coordinate system</span>
                    <select
                      data-testid="msa-coordinate-system"
                      name="alignment-coordinate-system"
                      value={coordinateSystem}
                      aria-label="Coordinate system"
                      onChange={(event) => {
                        setCoordinateSystem(event.target.value as CoordinateSystem);
                        setColumnDraft('');
                        setColumnError(null);
                        setColumnStatus('');
                      }}
                    >
                      <option value="alignment">Alignment column</option>
                      <option value="template">Template position</option>
                    </select>
                  </label>
                  <label>
                    <span className="motif-cs-visually-hidden">{coordinateSystem === 'alignment' ? 'Alignment column' : 'Template position'}</span>
                    <input
                      data-testid="msa-coordinate-input"
                      type="number"
                      name="alignment-coordinate"
                      autoComplete="off"
                      inputMode="numeric"
                      min={1}
                      max={coordinateSystem === 'alignment' ? activeAlignment.alignmentLength : activeTemplate?.aligned.replace(/-/g, '').length ?? 0}
                      step={1}
                      value={columnDraft}
                      onChange={(event) => {
                        setColumnDraft(event.target.value);
                        setColumnError(null);
                        setColumnStatus('');
                      }}
                      aria-label={coordinateSystem === 'alignment' ? 'Go to alignment column' : 'Go to template position'}
                      aria-invalid={columnError ? true : undefined}
                      aria-describedby={columnError ? 'motif-cs-msa-column-error' : undefined}
                    />
                  </label>
                  <button className="motif-cs-mini-button" type="submit">Go</button>
                  {columnError ? <span id="motif-cs-msa-column-error" className="motif-cs-msa-column-error" role="alert">{columnError}</span> : null}
                  <span className="motif-cs-visually-hidden" role="status" aria-live="polite">{columnStatus}</span>
                </form>
              </div>
              {viewPreferences.showRowStatsPanel ? (
                <MsaRowStatsPanel
                  alignment={activeAlignment}
                  referenceRowId={referenceRowId}
                  sortMode={sortMode}
                  onSortModeChange={(nextSortMode) => updateViewPreferences({ sortMode: nextSortMode })}
                  onJump={jumpToRowDifference}
                />
              ) : null}
              <AlignmentMatrix
                key={activeAlignment.id}
                alignment={activeAlignment}
                referenceRowId={referenceRowId}
                emphasis={emphasis}
                colorMode={colorMode}
                colorScheme={colorScheme}
                shadeMode={shadeMode}
                fontSize={fontSize}
                zoom={zoom}
                translationFrame={translationFrame}
                jumpColumn={jumpColumn}
                jumpToken={jumpToken}
                jumpRowId={jumpRowId}
                searchMatches={searchMatches}
                activeSearchMatch={activeSearchMatch}
                focusRequest={matrixFocusRequest}
                searchActive={Boolean(searchQuery)}
                sortMode={sortMode}
                visibility={matrixVisibility}
                resetToken={viewResetToken}
                onTemplateChange={selectTemplate}
                onCopy={copyFromViewer}
                onZoomChange={(next) => updateViewPreferences({ zoom: next })}
                onVisibleColumnsChange={handleVisibleColumnsChange}
              />
            </>
          ) : displayMode === 'trace' ? (
            <>
              <div className="motif-cs-msa-view-controls motif-cs-msa-trace-controls">
                <label className="motif-cs-msa-reference-picker">
                  <span>Compare against</span>
                  <select value={referenceRowId} disabled={!hasComparableRows} onChange={(event) => selectTemplate(event.target.value)}>
                    {activeAlignment.rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <div className="motif-cs-msa-difference-nav" role="group" aria-label="Variable column navigation">
                  <button className="motif-cs-mini-button" type="button" disabled={differenceNavigationDisabled} onClick={() => jumpDifference(-1)} aria-label="Previous variable column"><ChevronLeft size={13} /></button>
                  <span>{differenceNavigationLabel}</span>
                  <button className="motif-cs-mini-button" type="button" disabled={differenceNavigationDisabled} onClick={() => jumpDifference(1)} aria-label="Next variable column"><ChevronRight size={13} /></button>
                </div>
                <span className="motif-cs-muted">Click a call, drag the position slider, or use arrow keys inside the trace.</span>
              </div>
              <ClaudeScienceSangerTraceViewer
                key={activeAlignment.id}
                alignment={activeAlignment}
                records={records}
                templateRowId={referenceRowId}
                jumpColumn={jumpColumn}
                jumpToken={jumpToken}
              />
            </>
          ) : (
            <div className="motif-cs-msa-text-view" data-testid="msa-text-view">
              <textarea className="motif-cs-textarea" readOnly value={textContent} aria-label={`${selectedExport.label} alignment text`} />
            </div>
          )}

          <div className="motif-cs-msa-export-row">
            <label>
              <span>Export</span>
              <select value={textFormat} onChange={(event) => updateViewPreferences({ textFormat: event.target.value as TextFormat })}>
                <option value="fasta">Aligned FASTA</option>
                <option value="clustal">CLUSTAL</option>
                <option value="consensus">Consensus FASTA</option>
                <option value="json">Alignment JSON</option>
              </select>
            </label>
            <button className="motif-cs-mini-button" type="button" onClick={() => void copyFromViewer(selectedExport.label, textContent)}>{copyStatus?.label === selectedExport.label && copyStatus.tone === 'status' ? 'Copied' : 'Copy'}</button>
            <button className="motif-cs-mini-button" type="button" onClick={() => onDownload(safeAlignmentFilename(activeAlignment, selectedExport.extension), textContent, selectedExport.mime)}>Download</button>
            <div className="motif-cs-msa-export-image" data-testid="msa-export-image">
              <label className="motif-cs-msa-image-scope">
                <span>Image</span>
                <select
                  value={imageScope}
                  data-testid="msa-export-image-scope"
                  aria-label="Image export scope"
                  onChange={(event) => setImageScope(event.target.value as AlignmentImageScope)}
                >
                  <option value="view">Visible view</option>
                  <option value="all">Whole alignment</option>
                </select>
              </label>
              <button className="motif-cs-mini-button" type="button" data-testid="msa-export-png" onClick={() => void exportAlignmentImage('png')}>Save PNG</button>
              <button className="motif-cs-mini-button" type="button" data-testid="msa-export-svg" onClick={() => void exportAlignmentImage('svg')}>Save SVG</button>
            </div>
            <span className="motif-cs-muted">In session · Export a workspace backup before reload. To restore a ZIP export, unzip it and choose inventory.json in Settings. {activeAlignment.note}</span>
          </div>
        </>
      ) : (
        <div className="motif-cs-msa-empty" data-testid="msa-empty-state">
          <strong>No alignment loaded</strong>
          <span>Select workspace records for a bounded local preview, or import aligned FASTA from MAFFT, MUSCLE, or Clustal Omega.</span>
        </div>
      )}
    </div>
  );
}
