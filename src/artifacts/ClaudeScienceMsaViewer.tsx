import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import './claude-science-msa.css';
import { ChevronDown, ChevronLeft, ChevronRight, Crosshair, Download, FilePenLine, GripVertical, Info, List, Play, Search, SlidersHorizontal, Trash2, UploadCloud } from 'lucide-react';
import { MSA_MAX_SEQ_LEN } from '../bio/msa';
import type { SangerTraceData } from '../bio/abi-import';
import { reverseComplement } from '../bio/reverse-complement';
import type { SequenceType, Topology } from '../bio/types';
import {
  ARTIFACT_MSA_MAX_LOCAL_SEQUENCES,
  ARTIFACT_MSA_MAX_IMPORT_BYTES,
  ARTIFACT_MSA_LOCAL_WORK_BUDGET,
  ArtifactAlignmentError,
  alignmentComparisonOf,
  MSA_MOTIF_SEARCH_MAX_QUERY_LENGTH,
  clampMsaClientPoint,
  computeAlignmentImageLayout,
  computeMsaColumnStats,
  computeSequenceLogoColumns,
  createLocalArtifactAlignment,
  detectAlphabetAnomalies,
  estimateLocalAlignmentWork,
  buildMsaDifferenceColumnSlots,
  findMsaMatches,
  formatAlignedFasta,
  formatClustal,
  formatConsensusFasta,
  moveRowId,
  msaColumnFromClientX,
  msaEdgeAutoScrollDelta,
  navigateMsaGridCell,
  resolveMsaSearchDebounceMs,
  resolveMsaWheelGesture,
  msaShadeBucket,
  parseAlignmentText,
  residueColorKey,
  resolveMsaColorScheme,
  resolveResidueCellColor,
  safeAlignmentFilename,
  scheduleMsaSearch,
  selectionToColumnsText,
  selectionToFasta,
  selectionToUngappedFasta,
  serializeArtifactAlignment,
  summarizeSelectionColumns,
  translateAlignedRow,
  type AlignmentImageLayout,
  type AlignmentImageScope,
  type ArtifactAlignment,
  type ArtifactAlignmentReferenceNumbering,
  type ArtifactMsaRecord,
  type MsaColorScheme,
  type MsaColumnStats,
  type MsaLogoColumn,
  type MsaExpandedColumnRange,
  type MsaColumnViewSlot,
  type MsaSearchMatch,
  type MsaSelection,
  type MsaShadeMode,
  type MsaWheelGestureState,
} from './claude-science-msa';
import {
  ClaudeScienceSangerTraceViewer,
  hasLinkedSangerTrace,
} from './ClaudeScienceSangerTraceViewer';
import {
  alignmentCoverage,
  classifyMsaCell,
  coversColumn,
  isMsaCellDifference,
} from './claude-science-msa-cell-semantics';
import { preferredTraceOrientation } from './claude-science-sanger';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  MSA_ZOOM_MIN,
  MSA_ZOOM_MAX,
  normalizeClaudeScienceMsaViewPreferences,
  resolveMsaFitZoom,
  type ClaudeScienceMsaColorMode,
  type ClaudeScienceMsaColumnFilter,
  type ClaudeScienceMsaEmphasisMode,
  type ClaudeScienceMsaRowSortMode,
  type ClaudeScienceMsaTextFormat,
  type ClaudeScienceMsaViewPreferences,
} from './claude-science-msa-view-preferences';
import {
  computeMsaVariants,
  summarizeMsaVariants,
  type MsaVariant,
  type MsaVariantSummary,
} from './claude-science-msa-variants';

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
type ColumnFilter = ClaudeScienceMsaColumnFilter;
type MsaMatrixVisibility = Pick<ClaudeScienceMsaViewPreferences,
  'showOverview' | 'showAlignmentAxis' | 'showTemplateAxis' | 'showRowStats' | 'showConservation'
  | 'showConservationHistogram' | 'showOccupancy' | 'showConsensus' | 'showSequenceLogo'
  | 'showTranslation' | 'showAminoAcidIndices'>;
type CoordinateSystem = 'alignment' | 'template';
type MsaVisibleColumnWindow = {
  start: number;
  end: number;
  slots: MsaColumnViewSlot[];
};

function isMsaShortcutTextTarget(target: EventTarget | null): boolean {
  const element = target instanceof HTMLElement ? target : null;
  if (!element) return false;
  return element.matches('input, textarea, select') || element.isContentEditable;
}

function escapeMsaAttributeSelector(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');
}

const INPUT_FASTA_HEADER_MAX_LENGTH = 1_024;
const MSA_VARIANT_LIST_LIMIT = 500;
// `handledJumpToken` belongs here rather than in a ref for the same reason the
// position does: switching to Text unmounts the matrix, so a ref-only guard is
// re-seeded empty on the way back and replays the jump the reader already took.
const msaMatrixViewportSession = new Map<string, { centerColumn: number; top: number; handledJumpToken: number | null }>();
const EMPTY_MSA_SEARCH_RESULT = { matches: [] as MsaSearchMatch[], truncated: false };

type SettledMsaSearch = {
  alignment: ArtifactAlignment | null;
  query: string;
  result: ReturnType<typeof findMsaMatches>;
};

export type PairwiseRowStats = {
  ungappedLength: number;
  comparableColumns: number;
  mismatches: number;
  ambiguities: number;
  identity: number;
};

type ArtifactAlignmentRow = ArtifactAlignment['rows'][number];

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

export type MsaReferenceCoordinateLabel = {
  referencePosition: number;
  insertionCode: string;
  label: string;
};

function referenceInsertionCode(ordinal: number): string {
  let value = ordinal + 1;
  let code = '';
  while (value > 0) {
    value -= 1;
    code = String.fromCharCode(65 + (value % 26)) + code;
    value = Math.floor(value / 26);
  }
  return code;
}

// eslint-disable-next-line react-refresh/only-export-components -- pure MSA helper exported for unit tests
export function referenceCoordinateLabels(
  referenceAligned: string,
  firstResiduePosition: number,
): MsaReferenceCoordinateLabel[] {
  if (!Number.isSafeInteger(firstResiduePosition) || firstResiduePosition < 1) {
    throw new RangeError('firstResiduePosition must be a positive safe integer.');
  }
  const labels = new Array<MsaReferenceCoordinateLabel>(referenceAligned.length);
  let referencePosition = firstResiduePosition - 1;
  let insertionOrdinal = 0;
  for (let column = 0; column < referenceAligned.length; column += 1) {
    const isGap = referenceAligned[column] === '-' || referenceAligned[column] === '.';
    if (isGap) {
      const insertionCode = referenceInsertionCode(insertionOrdinal);
      labels[column] = { referencePosition, insertionCode, label: `${referencePosition}${insertionCode}` };
      insertionOrdinal += 1;
      continue;
    }
    referencePosition += 1;
    if (!Number.isSafeInteger(referencePosition)) throw new RangeError('Reference coordinates exceed the safe integer range.');
    insertionOrdinal = 0;
    labels[column] = { referencePosition, insertionCode: '', label: String(referencePosition) };
  }
  return labels;
}

const REFERENCE_COORDINATE_PATTERN = /^(0|[1-9]\d*)([A-Z]*)$/;

// eslint-disable-next-line react-refresh/only-export-components -- pure MSA helper exported for unit tests
export function parseReferenceCoordinateColumn(
  input: string,
  coordinates: readonly MsaReferenceCoordinateLabel[],
): number | null {
  const match = REFERENCE_COORDINATE_PATTERN.exec(input.trim().toUpperCase());
  if (!match) return null;
  const referencePosition = Number(match[1]);
  if (!Number.isSafeInteger(referencePosition)) return null;
  const insertionCode = match[2];
  const column = coordinates.findIndex((coordinate) => (
    coordinate.referencePosition === referencePosition && coordinate.insertionCode === insertionCode
  ));
  return column < 0 ? null : column;
}

function sameOptionalStrings(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameOptionalProvenance(
  a: ArtifactAlignment['provenance'],
  b: ArtifactAlignment['provenance'],
): boolean {
  if (!a || !b) return !a && !b;
  const fields = ['runner', 'executable', 'executableSha256', 'executableSource', 'version', 'runtimePathsRedacted', 'inputFastaSha256', 'outputFastaSha256', 'stderrSha256'] as const;
  if (fields.some((field) => a[field] !== b[field])) return false;
  return sameOptionalStrings(a.versionArgv, b.versionArgv) && sameOptionalStrings(a.argv, b.argv);
}

function sameBooleans(a: readonly boolean[], b: readonly boolean[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// A saved numbering variant receives a fresh id and name, but every scientific
// and provenance field is preserved. Treat results as the same lineage only when
// all of those preserved fields agree; identical residue text can legitimately
// come from distinct engines, inputs, or analysis runs.
function sameAlignmentApartFromNumbering(a: ArtifactAlignment, b: ArtifactAlignment): boolean {
  return a.molecule === b.molecule
    && a.referenceRowId === b.referenceRowId
    && a.alignmentLength === b.alignmentLength
    && a.centerIdx === b.centerIdx
    && a.createdAt === b.createdAt
    && a.outputSha256 === b.outputSha256
    && a.note === b.note
    && sameOptionalProvenance(a.provenance, b.provenance)
    && a.consensus === b.consensus
    && sameBooleans(a.conserved, b.conserved)
    && sameBooleans(a.gapOnly, b.gapOnly)
    && a.engine.id === b.engine.id
    && a.engine.label === b.engine.label
    && a.engine.mode === b.engine.mode
    && a.engine.version === b.engine.version
    && a.engine.usedFallback === b.engine.usedFallback
    && (() => {
      const left = alignmentComparisonOf(a);
      const right = alignmentComparisonOf(b);
      return left.route === right.route
        && left.method === right.method
        && left.algorithm === right.algorithm
        && left.fallback === right.fallback
        && left.ambiguityCount === right.ambiguityCount
        && sameOptionalStrings(left.warnings, right.warnings);
    })()
    && sameOptionalStrings(a.engine.parameters, b.engine.parameters)
    && a.rows.length === b.rows.length
    && a.rows.every((row, index) => {
      const other = b.rows[index];
      return row.id === other.id
        && row.name === other.name
        && row.aligned === other.aligned
        && row.identity === other.identity
        && row.sourceRecordId === other.sourceRecordId
        && row.inputSha256 === other.inputSha256;
    });
}

function sameReferenceNumbering(
  a: ArtifactAlignmentReferenceNumbering | undefined,
  b: ArtifactAlignmentReferenceNumbering | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return a.rowId === b.rowId && a.firstResiduePosition === b.firstResiduePosition;
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

// Frames available for restoring a saved viewport while responsive geometry
// settles. A far-edge restoration measured three; the rest is headroom for a
// slower machine.
const MSA_VIEWPORT_RESTORE_FRAMES = 12;

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
  const absoluteColumns = layout.columns.flatMap((slot) => slot.kind === 'column' ? [slot.column] : []);
  const hiddenCount = layout.columns.reduce((sum, slot) => sum + (slot.kind === 'elision' ? slot.hiddenCount : 0), 0);
  const first = absoluteColumns[0] ?? layout.startColumn;
  const last = absoluteColumns[absoluteColumns.length - 1] ?? first;
  return hiddenCount > 0
    ? `columns ${(first + 1).toLocaleString()}–${(last + 1).toLocaleString()} · ${hiddenCount.toLocaleString()} hidden · ${layout.rowCount} rows`
    : `columns ${(first + 1).toLocaleString()}–${(last + 1).toLocaleString()} · ${layout.rowCount} rows`;
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

/**
 * Draw the alignment onto an off-DOM canvas sized from the layout. A null scheme
 * means the caller asked for no residue colouring, and cells are left as
 * background — the export's equivalent of the matrix's monochrome mode.
 */
function renderAlignmentImageCanvas(
  rows: readonly ImageExportRow[],
  molecule: SequenceType,
  scheme: MsaColorScheme | null,
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
    const slot = layout.columns[index];
    if (!slot) continue;
    if (slot.kind === 'elision') {
      ctx.fillText(
        `⋯${slot.hiddenCount.toLocaleString()}⋯`,
        layout.labelWidth + (index + 0.5) * layout.cellWidth,
        layout.titleHeight + layout.axisHeight * 0.5,
        layout.cellWidth,
      );
      continue;
    }
    const column = slot.column;
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
    for (let index = 0; scheme && index < layout.columnCount; index += 1) {
      const slot = layout.columns[index];
      if (!slot || slot.kind === 'elision') continue;
      const symbol = row.aligned[slot.column] ?? '-';
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
        const slot = layout.columns[index];
        if (!slot || slot.kind === 'elision') continue;
        const symbol = row.aligned[slot.column] ?? '-';
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

/**
 * Build a self-contained SVG document for the alignment (vector alternative).
 * A null scheme means no residue colouring, as in the canvas renderer above.
 */
function renderAlignmentImageSvg(
  rows: readonly ImageExportRow[],
  molecule: SequenceType,
  scheme: MsaColorScheme | null,
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
    const slot = layout.columns[index];
    if (!slot) continue;
    const x = layout.labelWidth + (index + 0.5) * layout.cellWidth;
    if (slot.kind === 'elision') {
      parts.push(`<text x="${x.toFixed(1)}" y="${layout.titleHeight + layout.axisHeight * 0.5}" fill="${MSA_IMAGE_MUTED_COLOR}" font-size="${axisSize}" text-anchor="middle" dominant-baseline="middle">${escapeXml(`⋯${slot.hiddenCount.toLocaleString()}⋯`)}</text>`);
      continue;
    }
    const column = slot.column;
    if (index !== 0 && (column + 1) % tickStep !== 0) continue;
    parts.push(`<text x="${x.toFixed(1)}" y="${layout.titleHeight + layout.axisHeight * 0.5}" fill="${MSA_IMAGE_MUTED_COLOR}" font-size="${axisSize}" text-anchor="middle" dominant-baseline="middle">${column + 1}</text>`);
  }

  const labelFontSize = Math.max(8, Math.min(layout.fontSize || 11, Math.round(layout.cellHeight * 0.62)));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const y = layout.headerHeight + rowIndex * layout.cellHeight;
    // Cell backgrounds.
    for (let index = 0; scheme && index < layout.columnCount; index += 1) {
      const slot = layout.columns[index];
      if (!slot || slot.kind === 'elision') continue;
      const symbol = row.aligned[slot.column] ?? '-';
      const fill = resolveResidueCellColor(symbol, molecule, scheme, bg);
      if (!fill) continue;
      const x = layout.labelWidth + index * layout.cellWidth;
      parts.push(`<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${(layout.cellWidth + 0.5).toFixed(2)}" height="${(layout.cellHeight + 0.5).toFixed(2)}" fill="${fill}"/>`);
    }
    // Residue glyphs.
    if (layout.drawLetters) {
      for (let index = 0; index < layout.columnCount; index += 1) {
        const slot = layout.columns[index];
        if (!slot || slot.kind === 'elision') continue;
        const symbol = row.aligned[slot.column] ?? '-';
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
      aria-label={`${schemeLabel} residue color key`}
    >
      <div className="motif-cs-msa-color-legend-heading">
        <strong>Color key</strong>
        <span>{schemeLabel}</span>
      </div>
      {resolvedScheme === 'taylor' ? (
        <p className="motif-cs-msa-color-legend-note">
          {molecule === 'protein'
            ? 'Each amino acid has its own color.'
            : 'Residue colors vary by symbol.'}
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
export function differenceColumns(
  alignment: ArtifactAlignment,
  referenceRowId: string,
  strictDifferences = false,
): number[] {
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
        alignment.molecule,
        strictDifferences,
      ))
    ))) columns.push(column);
  }
  return columns;
}

// eslint-disable-next-line react-refresh/only-export-components -- pure MSA helper exported for unit tests
export function ambiguousColumns(
  alignment: ArtifactAlignment,
  referenceRowId: string,
  strictDifferences = false,
): number[] {
  if (strictDifferences) return [];
  const reference = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  if (!reference) return [];
  const referenceCoverage = alignmentCoverage(reference.aligned);
  const rowCoverage = new Map(alignment.rows.map((row) => [row.id, alignmentCoverage(row.aligned)]));
  const columns: number[] = [];
  for (let column = 0; column < alignment.alignmentLength; column += 1) {
    if (alignment.gapOnly[column] || !coversColumn(referenceCoverage, column)) continue;
    let hasAmbiguity = false;
    let hasDifference = false;
    for (const row of alignment.rows) {
      if (row.id === reference.id) continue;
      const outcome = classifyMsaCell(
        reference.aligned[column] ?? '-',
        row.aligned[column] ?? '-',
        coversColumn(rowCoverage.get(row.id) ?? null, column),
        alignment.molecule,
        false,
      );
      if (isMsaCellDifference(outcome)) { hasDifference = true; break; }
      if (outcome === 'ambiguous') hasAmbiguity = true;
    }
    if (!hasDifference && hasAmbiguity) columns.push(column);
  }
  return columns;
}

// The shared prefix is CHOSEN by a case-insensitive comparison, so it has to be
// RECOGNISED by one too. Mixed-case accession or chromosome prefixes — "Chr1_"
// beside "chr1_", "sp|" beside "SP|" — otherwise leave exactly one row holding
// its full name while every sibling loses theirs, and that longer row is then
// the one a narrow control truncates. Precisely backwards.
function startsWithSharedPrefix(name: string, prefix: string): boolean {
  return prefix.length > 0
    && name.length >= prefix.length
    && name.slice(0, prefix.length).toLocaleLowerCase() === prefix.toLocaleLowerCase();
}

// Drop a prefix every row shares, keeping the whole name if nothing would be
// left. Used wherever a narrow control has to tell rows apart by their text.
function withoutSharedPrefix(name: string, prefix: string): string {
  if (!startsWithSharedPrefix(name, prefix)) return name;
  return name.slice(prefix.length).replace(/^[\s_./-]+/u, '') || name;
}

// Width of the sticky row-name gutter, and therefore the x origin of the
// residue grid. Names are the index; residues are the subject. At the previous
// 30% of viewport width this gutter cost as much as both app rails combined, so
// it is biased back toward the alignment while keeping rows tellable apart.
// eslint-disable-next-line react-refresh/only-export-components -- pure MSA helper exported for unit tests
export function msaRowLabelWidth(viewportWidth: number): number {
  return Math.max(136, Math.min(216, Math.round(viewportWidth * 0.22)));
}

// Rows in one alignment routinely share a gene or project prefix ("PAL — ")
// that repeats on every label and so does nothing to tell them apart. The name
// gutter is narrow and truncates from the right, which spends its width on that
// shared text and elides the species that actually differs. Returns the prefix
// worth hiding, or '' when there is none; the full name stays in the row
// button's title and aria-label either way.
function sharedNamePrefix(allNames: readonly string[]): string {
  if (allNames.length < 2) return '';
  // Keep separators attached so a prefix is never cut mid-word.
  const tokenise = (name: string) => Array.from(name.matchAll(/[^\s_./-]+[\s_./-]*/gu), (match) => match[0]);
  const tokenLists = allNames.map(tokenise);
  const [first] = tokenLists;
  // Always leave one token, so no row can render an empty label.
  const limit = Math.min(...tokenLists.map((tokens) => tokens.length)) - 1;
  let shared = 0;
  while (
    shared < limit
    && tokenLists.every((tokens) => tokens[shared].toLocaleLowerCase() === first[shared].toLocaleLowerCase())
  ) shared += 1;
  const prefix = first.slice(0, shared).join('');
  // Hiding one or two characters is not worth the ambiguity it introduces.
  return prefix.trim().length >= 3 ? prefix : '';
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
export function pairwiseRowStats(
  aligned: string,
  template: string,
  molecule: SequenceType = 'dna',
  strictDifferences = false,
): PairwiseRowStats {
  const rowCoverage = alignmentCoverage(aligned);
  const templateCoverage = alignmentCoverage(template);
  let ungappedLength = 0;
  let comparable = 0;
  let matches = 0;
  let mismatches = 0;
  let ambiguities = 0;
  for (let column = 0; column < Math.max(aligned.length, template.length); column += 1) {
    const symbol = aligned[column] ?? '-';
    const templateSymbol = template[column] ?? '-';
    if (symbol !== '-') ungappedLength += 1;
    if (!coversColumn(templateCoverage, column)) continue;
    const outcome = classifyMsaCell(templateSymbol, symbol, coversColumn(rowCoverage, column), molecule, strictDifferences);
    if (outcome === 'match') {
      comparable += 1;
      matches += 1;
    } else if (outcome === 'ambiguous') {
      comparable += 1;
      ambiguities += 1;
    } else if (isMsaCellDifference(outcome)) {
      comparable += 1;
      mismatches += 1;
    }
  }
  return {
    ungappedLength,
    comparableColumns: comparable,
    mismatches,
    ambiguities,
    identity: comparable > 0 ? Math.round((matches / comparable) * 10_000) / 100 : 0,
  };
}

function formatIdentity(identity: number): string {
  return identity < 100 && identity >= 99.9 ? identity.toFixed(2) : identity.toFixed(1);
}

function firstRowDifferenceColumn(
  aligned: string,
  template: string,
  molecule: SequenceType,
  strictDifferences = false,
): number | null {
  const rowCoverage = alignmentCoverage(aligned);
  const templateCoverage = alignmentCoverage(template);
  for (let column = 0; column < Math.max(aligned.length, template.length); column += 1) {
    if (!coversColumn(templateCoverage, column)) continue;
    const outcome = classifyMsaCell(
      template[column] ?? '-',
      aligned[column] ?? '-',
      coversColumn(rowCoverage, column),
      molecule,
      strictDifferences,
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
export function mismatchOverviewBins(
  alignment: ArtifactAlignment,
  referenceRowId: string,
  binCount: number,
  strictDifferences = false,
): number[] {
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
      const outcome = classifyMsaCell(
        templateSymbol,
        symbol,
        coversColumn(rowCoverage[rowIndex], column),
        alignment.molecule,
        strictDifferences,
      );
      if (outcome === 'match') comparable += 1;
      else if (outcome === 'ambiguous') comparable += 1;
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

/**
 * Content width of the observed element, plus the width its scrollbar gutter
 * reserves. The matrix scroller keeps a `scrollbar-gutter: stable` reservation,
 * which sits outside the content box and cannot be scrolled out from under; the
 * content has to be widened by it or its tail is unreachable. Measured rather
 * than assumed because the reservation is 11px where the styled webkit
 * scrollbar applies and the platform default elsewhere.
 */
function useObservedWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  // Height is observed for the same reason width is: reading it off the element
  // during a scroll would force a synchronous layout on every frame, which is
  // the cost this measurement exists to avoid.
  const [height, setHeight] = useState(0);
  const [scrollbarGutter, setScrollbarGutter] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.floor(entry.contentRect.width));
      setHeight(Math.max(0, Math.floor(entry.contentRect.height)));
      // offsetWidth − clientWidth is the gutter plus any horizontal border; the
      // scroller carries no border, and an extra border's worth of trailing
      // space would only ever be blank.
      setScrollbarGutter(Math.max(0, element.offsetWidth - element.clientWidth));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width, scrollbarGutter, height] as const;
}

/** Inclusive rectangular block: column and (ordered-row) index ranges. */
type MatrixSelection = { colStart: number; colEnd: number; rowStart: number; rowEnd: number };
/** Cell currently under the pointer, with client coords for the floating readout. */
type HoverCell = { column: number; rowIndex: number; rowId: string; clientX: number; clientY: number };
type MatrixActiveCell = { column: number; rowId: string };
type MatrixFocusRequest = MatrixActiveCell & { token: number; focus: boolean };
type MatrixContextMenu = { x: number; y: number; column: number; rowId: string | null };
/** Live state while a row is being drag-reordered by its grip handle. */
type RowDragState = { id: string; fromIndex: number; overIndex: number | null; edge: 'before' | 'after' };
type DragAutoScrollAxes = { horizontal: boolean; vertical: boolean };
type DragAutoScrollState = DragAutoScrollAxes & {
  clientX: number;
  clientY: number;
  resolve: () => void;
};

function msaGridCellLabel(
  symbol: string | undefined,
  column: number,
  rowName: string,
  referenceLabel?: string,
): string {
  const residue = symbol ?? '-';
  const residueLabel = residue === '-' || residue === '.' ? 'Gap' : `Residue ${residue}`;
  return `${residueLabel}, alignment column ${column + 1}${referenceLabel ? `, reference position ${referenceLabel}` : ''}, row ${rowName}`;
}

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
/**
 * Rows above and below the visible matrix that keep their residue cells, and the
 * block the window snaps to.
 *
 * Columns are windowed; rows are not, so every row of the alignment holds a full
 * set of cells and a HORIZONTAL scroll re-renders all of them because the column
 * window moved under each one. Measured at 4,000 columns with one scroll step per
 * animation frame: p50 20.2 / 28.2 / 43.3 / 83.6 ms at 20 / 30 / 50 / 100
 * rendered rows, against 8.6 ms for a VERTICAL scroll at 100 rows, which
 * re-renders nothing at all. The fit is p50 ~= 4.5 + 0.79 x rows and only 19 rows
 * fit a 570px matrix, so four fifths of that time drew rows nobody could see.
 *
 * The block is what keeps vertical scrolling cheap. Without it every row of
 * travel would move the window and re-render; snapped, a vertical scroll pays
 * once every MSA_ROW_WINDOW_BLOCK rows instead of on every frame.
 */
const MSA_ROW_WINDOW_OVERSCAN = 6;
const MSA_ROW_WINDOW_BLOCK = 6;
const MSA_RULER_ROW_HEIGHT = 27;
/** Mirrors `.motif-cs-msa-overview-row { min-height }` in motif-artifact.css. */
const MSA_OVERVIEW_ROW_HEIGHT = 30;
/**
 * Mirrors `.motif-cs-msa-matrix-scroll { min-height }`. This predates the shell and
 * already encodes what the residue viewport refuses to go below.
 */
const MSA_MATRIX_SCROLL_MIN_HEIGHT = 142;
/**
 * Floor for the clipped matrix frame: the sum of the floors its own two children
 * already declare. Not a chosen number — a frame shorter than this clips content that
 * has refused to shrink, which is the same defect the shell exists to remove, just
 * one box further in. Deriving it from ruler + N rows instead gave 147 and lost
 * exactly 25px to the clip, measured.
 *
 * The floor is what lets the body scroll again on a short panel: below it the frame
 * would collapse and take the residue viewport with it, while above it the frame
 * shrinks normally, so at 1024x768 (415px available) and 1280x900 (547px) it never
 * binds and those sizes keep zero body overflow. It is deliberately NOT
 * `min-height: min-content`, which computes to ~469px and forces whole-UI scrolling.
 *
 * Slightly conservative when the overview row is hidden, which over-reserves its 30px.
 * The alternative is a floor that moves as tracks are toggled, and a viewport that
 * resizes when you hide something is the defect class this whole change is about.
 */
const MSA_MATRIX_FRAME_MIN_HEIGHT = MSA_OVERVIEW_ROW_HEIGHT + MSA_MATRIX_SCROLL_MIN_HEIGHT;
/**
 * Fallback for the bottom chrome before it has been measured, and the floor under
 * `.motif-cs-msa-statusbar`'s own declaration: one unwrapped status line. The real
 * height is measured at runtime, because this strip WRAPS at narrow widths — an
 * existing e2e expectation has the zoom row past 40px at 440x760.
 */
const MSA_STATUSBAR_HEIGHT = 33;
/** `.motif-cs-msa-selection-readout`: 40px plus its 6px top margin, in flow. */
const MSA_SELECTION_READOUT_HEIGHT = 46;
/**
 * The same readout while FLOATING — absolutely positioned, so no margin. The bottom
 * chrome must be at least this tall for the float to sit over it without overhanging
 * into the residue grid.
 */
const MSA_SELECTION_READOUT_FLOAT_HEIGHT = 40;
/** The shell's own 1px border, top and bottom. */
const MSA_MATRIX_SHELL_BORDERS = 2;
/**
 * Floor for the shell: the frame's floor plus every row currently mounted beneath it.
 *
 * Without a floor the shell is a flex item with `min-height: 0`, free to be shorter
 * than its own content — and a border wraps the BORDER BOX, not the overflow. At
 * 1100x420 the shell measured 97px against 233px of content, so its bottom border
 * painted a hairline straight across the residue grid, 8px into row 2, reading as a
 * row divider that is not one.
 *
 * It has to be COMPUTED rather than constant, because three of the four rows are
 * conditional and this box's whole problem is the rows that are not always there. A
 * constant covering only the permanent rows left the shell short by 45px once a
 * selection settled, and 77px with the order note as well: the border then drew
 * correctly around everything else and left those rows orphaned just below it.
 * Padding the constant unconditionally would instead waste 78px at exactly the panel
 * size that cannot spare it.
 *
 * The readout counts only when it is IN FLOW. While the pointer is still down it is
 * absolutely positioned (see its `data-live` rule) and contributes no layout height,
 * so reserving for it mid-drag would shrink the residue viewport at the one moment
 * this change exists to hold steady.
 *
 * `min-height: auto` on the shell is the intuitive alternative and is WRONG — the
 * expectation being that `overflow: hidden` on the frame clamps its contribution to
 * its own floor. Measured, it resolves to 469px, identical to `min-content` and
 * `fit-content`, because the frame contributes its full matrix height to a
 * content-based minimum regardless. All three bind at 1024x768 and take body overflow
 * from 0 to 40px, introducing whole-interface scrolling.
 *
 * If the status line ever wraps, this falls short by the extra line and the border
 * cuts the status line rather than the grid: chrome instead of data, which is the
 * right way round for it to fail.
 */
function msaMatrixShellMinHeight(rows: {
  /** MEASURED height of the in-flow strip: pan row, status line, order note. */
  chromeHeight: number;
  readoutInFlow: boolean;
}): number {
  return MSA_MATRIX_FRAME_MIN_HEIGHT
    + rows.chromeHeight
    + (rows.readoutInFlow ? MSA_SELECTION_READOUT_HEIGHT : 0)
    + MSA_MATRIX_SHELL_BORDERS;
}
// Sequence-logo track: plotting height (must match .motif-cs-msa-logo-row in
// the CSS) and the smallest glyph, in px, still worth drawing in a segment.
const MSA_LOGO_TRACK_HEIGHT = 46;
const MSA_LOGO_LETTER_MIN_PX = 7;

function MsaRowStatsPanel({
  alignment,
  referenceRowId,
  sortMode,
  strictDifferences,
  onSortModeChange,
  onJump,
}: {
  alignment: ArtifactAlignment;
  referenceRowId: string;
  sortMode: RowSortMode;
  strictDifferences: boolean;
  onSortModeChange: (sortMode: RowSortMode) => void;
  onJump: (rowId: string, column: number) => void;
}) {
  // Collapsed by default: an open panel of every row would consume the MSA
  // window's bounded height and push the matrix out of its clipped viewport.
  const [open, setOpen] = useState(false);
  const template = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  const statsByRow = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    pairwiseRowStats(row.aligned, template?.aligned ?? '', alignment.molecule, strictDifferences),
  ])), [alignment.molecule, alignment.rows, strictDifferences, template]);
  const orderedRows = useMemo(
    () => sortedMsaRows(alignment.rows, template, sortMode, statsByRow),
    [alignment.rows, sortMode, statsByRow, template],
  );
  const firstDifferenceByRow = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    firstRowDifferenceColumn(row.aligned, template?.aligned ?? '', alignment.molecule, strictDifferences),
  ])), [alignment.molecule, alignment.rows, strictDifferences, template]);
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
              <th scope="col" aria-label="Compatible ambiguity-code calls">
                <span title="Compatible ambiguity-code calls (not counted as differences)">≈</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row) => {
              const stats = statsByRow.get(row.id) ?? pairwiseRowStats(row.aligned, template?.aligned ?? '', alignment.molecule, strictDifferences);
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
                  <td className="motif-cs-msa-row-stats-number">{stats.ambiguities.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function MsaDifferenceNavigation({
  disabled,
  label,
  labelWidth,
  open,
  onPrevious,
  onNext,
  onToggle,
}: {
  disabled: boolean;
  label: string;
  labelWidth: number;
  open: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="motif-cs-msa-difference-nav" role="group" aria-label="Variable column navigation">
      <button className="motif-cs-mini-button" type="button" disabled={disabled} onClick={onPrevious} aria-label="Previous variable column" title="Previous variable column (P)"><ChevronLeft size={13} /></button>
      <span style={{ minWidth: `${labelWidth}ch` }}>{label}</span>
      <button className="motif-cs-mini-button" type="button" disabled={disabled} onClick={onNext} aria-label="Next variable column" title="Next variable column (N)"><ChevronRight size={13} /></button>
      <button
        className="motif-cs-mini-button motif-cs-msa-differences-toggle"
        type="button"
        data-testid="msa-differences-toggle"
        aria-expanded={open}
        aria-controls="motif-cs-msa-differences-pane"
        aria-label={`${open ? 'Hide' : 'Show'} differences list`}
        title={`${open ? 'Hide' : 'Show'} differences list`}
        onClick={onToggle}
      >
        <List size={13} aria-hidden="true" />
        <ChevronDown size={10} aria-hidden="true" />
      </button>
    </div>
  );
}

function MsaDifferencesPane({
  variants,
  summary,
  truncated,
  templateName,
  rowLabels,
  onClose,
  onJump,
}: {
  variants: readonly MsaVariant[];
  summary: MsaVariantSummary;
  truncated: boolean;
  templateName: string;
  /** Row names with the prefix every row shares removed, as the gutter and the
      template picker already show them. The Row column is 245px, so a shared
      head eats the whole cell: five rows named "…ORF1ab polyprotein clone A"
      through "clone E" rendered the same 43 characters in every one of them and
      cut all five clone letters. The full name stays in the cell's title. */
  rowLabels: ReadonlyMap<string, string>;
  onClose: () => void;
  onJump: (variant: MsaVariant) => void;
}) {
  const paneRef = useRef<HTMLElement>(null);
  const summaryParts = [
    summary.substitutions > 0
      ? `${summary.substitutions.toLocaleString()} substitution${summary.substitutions === 1 ? '' : 's'}`
      : null,
    summary.insertions > 0
      ? `${summary.insertions.toLocaleString()} insertion${summary.insertions === 1 ? '' : 's'}`
      : null,
    summary.deletions > 0
      ? `${summary.deletions.toLocaleString()} deletion${summary.deletions === 1 ? '' : 's'}`
      : null,
  ].filter((part): part is string => part !== null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => paneRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <section
      ref={paneRef}
      id="motif-cs-msa-differences-pane"
      className="motif-cs-msa-differences-pane"
      data-testid="msa-differences-pane"
      role="region"
      aria-labelledby="motif-cs-msa-differences-title"
      tabIndex={-1}
    >
      <header className="motif-cs-msa-differences-header">
        <div>
          <h3 id="motif-cs-msa-differences-title">Differences from {templateName}</h3>
          {summary.total > 0 ? (
            <p>
              {summaryParts.join(' · ')}
            </p>
          ) : null}
        </div>
        <button type="button" className="motif-cs-mini-button" data-testid="msa-differences-close" onClick={onClose}>Close</button>
      </header>
      {truncated ? (
        <p className="motif-cs-msa-differences-limit" data-testid="msa-differences-limit" role="status">
          Showing {summary.total.toLocaleString()} differences. More exist.
        </p>
      ) : null}
      {variants.length === 0 ? (
        <p className="motif-cs-msa-differences-empty">No differences from {templateName}</p>
      ) : (
        <div className="motif-cs-msa-differences-table-wrap">
          <table className="motif-cs-msa-differences-table">
            <thead>
              <tr>
                <th scope="col">Variant</th>
                <th scope="col">Row</th>
                <th scope="col">Type</th>
                <th scope="col">Template → observed</th>
                <th scope="col">Alignment column</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant) => (
                <tr
                  key={`${variant.rowId}:${variant.column}`}
                  data-testid="msa-difference-row"
                  tabIndex={0}
                  aria-label={`Jump to ${variant.label} in ${variant.rowName}, alignment column ${variant.column + 1}`}
                  onClick={() => onJump(variant)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onJump(variant);
                  }}
                >
                  <th scope="row"><code>{variant.label}</code></th>
                  <td title={variant.rowName}>{rowLabels.get(variant.rowId) ?? variant.rowName}</td>
                  <td>{variant.kind}</td>
                  <td><code>{variant.templateResidue} → {variant.residue}</code></td>
                  <td>{(variant.column + 1).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AlignmentMatrix({
  alignment,
  referenceRowId,
  referenceCoordinates,
  emphasis,
  colorMode,
  colorScheme,
  shadeMode,
  fontSize,
  zoom,
  columnFilter,
  columnFilterContext,
  differingColumns,
  translationFrame,
  jumpColumn,
  jumpToken,
  jumpRowId,
  searchMatches,
  activeSearchMatch,
  focusRequest,
  searchActive,
  sortMode,
  strictDifferences,
  visibility,
  resetToken,
  onTemplateChange,
  onCopy,
  onZoomChange,
  onVisibleColumnsChange,
  onActiveCellChange,
  footerNavigation,
}: {
  alignment: ArtifactAlignment;
  referenceRowId: string;
  referenceCoordinates: readonly MsaReferenceCoordinateLabel[] | null;
  emphasis: EmphasisMode;
  colorMode: ColorMode;
  colorScheme: MsaColorScheme;
  shadeMode: MsaShadeMode;
  fontSize: number;
  zoom: number;
  columnFilter: ColumnFilter;
  columnFilterContext: number;
  differingColumns: readonly number[];
  translationFrame: 0 | 1 | 2;
  jumpColumn: number | null;
  jumpToken: number;
  jumpRowId: string | null;
  searchMatches: readonly MsaSearchMatch[];
  activeSearchMatch: MsaSearchMatch | null;
  focusRequest: MatrixFocusRequest | null;
  searchActive: boolean;
  sortMode: RowSortMode;
  strictDifferences: boolean;
  visibility: MsaMatrixVisibility;
  resetToken: number;
  onTemplateChange: (rowId: string) => void;
  onCopy: (label: string, content: string) => Promise<boolean>;
  onZoomChange: (zoom: number) => void;
  onVisibleColumnsChange: (range: MsaVisibleColumnWindow) => void;
  /** Reports the roving cursor so a control outside the grid can hand focus back to it. */
  onActiveCellChange: (cell: MatrixActiveCell | null) => void;
  /** Keeps variable-column navigation beside the visible-column status it changes. */
  footerNavigation: ReactNode;
}) {
  const [viewportRef, viewportWidth, viewportScrollbarGutter, viewportHeight] = useObservedWidth<HTMLDivElement>();
  const gridRef = useRef<HTMLDivElement>(null);
  const gridCellIdPrefix = useId();
  const initialViewport = useMemo(() => msaMatrixViewportSession.get(alignment.id), [alignment.id]);
  const [scrollLeft, setScrollLeft] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);
  const viewportRestoreFrameRef = useRef<number | null>(null);
  const dragAutoScrollFrameRef = useRef<number | null>(null);
  const dragAutoScrollStateRef = useRef<DragAutoScrollState | null>(null);
  const reducedMotionRef = useRef(false);
  const wheelGestureRef = useRef<MsaWheelGestureState | null>(null);
  const pendingScrollLeftRef = useRef(0);
  const pendingScrollTopRef = useRef(initialViewport?.top ?? 0);
  const desiredCenterColumnRef = useRef<number | null>(initialViewport?.centerColumn ?? null);
  const pendingUserScrollRef = useRef(false);
  const pendingUserScrollFrameRef = useRef<number | null>(null);
  const userScrollPointerRef = useRef(false);
  const restoredViewportRef = useRef(false);
  // Seeded from the session, not from null. Leaving Viewer for Text unmounts this
  // component; a null seed made it forget that the incoming jump had already been
  // taken, so on the way back it replayed jump token 1 (column 0) straight over
  // the position it had just correctly restored. Measured: restore set scrollLeft
  // to 15,271 and a scrollTo({left: 0}) followed it within one frame.
  const handledJumpTokenRef = useRef<number | null>(
    msaMatrixViewportSession.get(alignment.id)?.handledJumpToken ?? null,
  );
  const markUserScrollIntent = useCallback(() => {
    pendingUserScrollRef.current = true;
    if (pendingUserScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingUserScrollFrameRef.current);
    }
    // A discrete wheel, key, range, or overview action should authorize only
    // the scroll it initiated. Leaving that authorization armed would let an
    // unrelated resize-generated scroll overwrite the session later.
    pendingUserScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingUserScrollFrameRef.current = null;
      pendingUserScrollRef.current = false;
    });
  }, []);
  const pendingColumnScrollRef = useRef<{ column: number; behavior: ScrollBehavior } | null>(null);
  const lastResetTokenRef = useRef(resetToken);
  const overviewDraggingRef = useRef(false);
  const rowTemplateClickRef = useRef<{
    rowId: string;
    timeStamp: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const [selection, setSelection] = useState<MatrixSelection | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<MatrixContextMenu | null>(null);
  const hasSelection = selection !== null;
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
  const chromeRef = useRef<HTMLDivElement>(null);
  /**
   * MEASURED height of the in-flow rows under the frame — pan slider, status line,
   * order note — rather than a sum of constants.
   *
   * Two things depend on it and a constant 33 had both wrong. The shell's floor was
   * short whenever the status line wrapped, and `claude-science-msa-interactions`
   * already asserts the zoom row exceeds 40px at 440x760, so that was demonstrated
   * rather than theoretical. And the mid-drag readout floats over exactly this strip,
   * so whether it FITS turns on the same number: with no pan row the strip is a single
   * status line and a 40px readout overhangs it into the residue grid.
   *
   * It cannot oscillate. These rows are sized by the shell's WIDTH, which no height
   * floor affects, so the measurement never feeds back into itself.
   */
  const [chromeHeight, setChromeHeight] = useState(MSA_STATUSBAR_HEIGHT);
  const readoutRef = useRef<HTMLDivElement>(null);
  /**
   * MEASURED height of the readout itself. The float gate compares this against the
   * chrome strip, and BOTH wrap: at 520px the strip grows to 44px and the readout to
   * 61px, so gating on a 40px constant let it float and cover a residue row by 17px.
   * Measured-against-measured is the only version that holds at every width.
   */
  const [readoutHeight, setReadoutHeight] = useState(MSA_SELECTION_READOUT_FLOAT_HEIGHT);
  // Selection drags update the range every animation frame. Keep one observer
  // for the readout's mounted lifetime; re-subscribing and synchronously
  // measuring on every render can re-enter the state update loop during a drag.
  useEffect(() => {
    const node = readoutRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const sync = () => setReadoutHeight((prev) => {
      const next = Math.round(node.getBoundingClientRect().height);
      return next > 0 && next !== prev ? next : prev;
    });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasSelection]);
  useEffect(() => {
    const node = chromeRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const sync = () => setChromeHeight((prev) => {
      const next = Math.round(node.getBoundingClientRect().height);
      return next > 0 && next !== prev ? next : prev;
    });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
    // The wrapper itself is always rendered; its conditional children change its
    // height, which the observer sees. Re-subscribing per render would be churn.
  }, []);
  const baseCellWidth = Math.max(MSA_BASE_CELL_MIN, Math.min(MSA_BASE_CELL_MAX, fontSize * 0.78 + 2));
  const cellWidth = Math.round(Math.max(MSA_CELL_MIN, Math.min(MSA_CELL_MAX, baseCellWidth * zoom)) * 10) / 10;
  const blocks = cellWidth < MSA_LETTER_MIN;
  // Shrink glyphs to fit narrowing cells as the user zooms out, so letters stay
  // legible (not overlapping) right down to the blocks threshold; never exceed
  // the chosen font size when zooming in.
  const renderFontSize = blocks ? fontSize : Math.min(fontSize, Math.max(7, Math.round(cellWidth * 1.32)));
  const [expandedColumnRanges, setExpandedColumnRanges] = useState<MsaExpandedColumnRange[]>([]);
  useEffect(() => { setExpandedColumnRanges([]); }, [alignment.id, columnFilter, columnFilterContext, referenceRowId]);
  const columnSlots = useMemo<MsaColumnViewSlot[]>(() => (
    columnFilter === 'differences'
      ? buildMsaDifferenceColumnSlots(
          alignment.alignmentLength,
          differingColumns,
          columnFilterContext,
          expandedColumnRanges,
        )
      : Array.from(
          { length: alignment.alignmentLength },
          (_, column): MsaColumnViewSlot => ({ kind: 'column', column }),
        )
  ), [alignment.alignmentLength, columnFilter, columnFilterContext, differingColumns, expandedColumnRanges]);
  const columnSlotIndex = useMemo(() => {
    const map = new Map<number, number>();
    columnSlots.forEach((slot, index) => { if (slot.kind === 'column') map.set(slot.column, index); });
    return map;
  }, [columnSlots]);
  const labelWidth = msaRowLabelWidth(viewportWidth);
  const sequenceViewportWidth = Math.max(120, viewportWidth - labelWidth);
  const overscan = 24;
  const visibleStartSlot = Math.max(0, Math.min(
    Math.max(0, columnSlots.length - 1),
    Math.floor(scrollLeft / cellWidth),
  ));
  const visibleColumnCount = Math.max(1, Math.ceil(sequenceViewportWidth / cellWidth));
  const visibleEndSlot = Math.min(columnSlots.length, visibleStartSlot + visibleColumnCount);
  const startSlot = Math.max(0, visibleStartSlot - overscan);
  const endSlot = Math.min(columnSlots.length, visibleEndSlot + overscan);
  const renderedSlots = columnSlots.slice(startSlot, endSlot);
  const visibleSlots = columnSlots.slice(visibleStartSlot, visibleEndSlot);
  const visibleAbsoluteColumns = visibleSlots.flatMap((slot) => slot.kind === 'column' ? [slot.column] : []);
  const firstVisibleSlot = visibleSlots[0];
  const lastVisibleSlot = visibleSlots[visibleSlots.length - 1];
  const visibleStartColumn = visibleAbsoluteColumns[0]
    ?? (firstVisibleSlot?.kind === 'elision' ? firstVisibleSlot.startColumn : 0);
  const visibleEndColumn = (visibleAbsoluteColumns[visibleAbsoluteColumns.length - 1]
    ?? (lastVisibleSlot?.kind === 'elision' ? lastVisibleSlot.endColumn - 1 : visibleStartColumn)) + 1;
  const shownAlignmentColumnCount = columnSlots.reduce((count, slot) => count + Number(slot.kind === 'column'), 0);
  const hiddenAlignmentColumnCount = alignment.alignmentLength - shownAlignmentColumnCount;
  const visibleWindowText = columnFilter === 'differences'
    ? `${visibleAbsoluteColumns.length.toLocaleString()} displayed alignment columns in this window · ${hiddenAlignmentColumnCount.toLocaleString()} identical columns hidden overall`
    : `Alignment columns ${visibleStartColumn + 1}–${Math.max(visibleStartColumn + 1, visibleEndColumn)} of ${alignment.alignmentLength.toLocaleString()}`;
  const sequenceWidth = columnSlots.length * cellWidth;
  const totalWidth = labelWidth + sequenceWidth;
  const maxHorizontalScroll = Math.max(0, sequenceWidth - sequenceViewportWidth);
  const previousViewportGeometryRef = useRef({ cellWidth, sequenceViewportWidth });
  const absoluteCenterColumnForScrollLeft = useCallback((left: number) => {
    if (columnSlots.length === 0 || cellWidth <= 0) return 0;
    const slotPosition = Math.max(
      0,
      Math.min(columnSlots.length, (left + sequenceViewportWidth / 2) / cellWidth),
    );
    const slotIndex = Math.min(columnSlots.length - 1, Math.floor(slotPosition));
    const slotFraction = Math.max(0, Math.min(1, slotPosition - slotIndex));
    const slot = columnSlots[slotIndex];
    if (!slot) return 0;
    return slot.kind === 'column'
      ? slot.column + slotFraction
      : slot.startColumn + slotFraction * (slot.endColumn - slot.startColumn);
  }, [cellWidth, columnSlots, sequenceViewportWidth]);
  const scrollLeftForAbsoluteCenterColumn = useCallback((centerColumn: number) => {
    if (columnSlots.length === 0 || cellWidth <= 0) return 0;
    const boundedCenter = Math.max(0, Math.min(alignment.alignmentLength, centerColumn));
    const column = Math.min(Math.max(0, alignment.alignmentLength - 1), Math.floor(boundedCenter));
    const columnFraction = Math.max(0, Math.min(1, boundedCenter - column));
    let slotIndex = columnSlotIndex.get(column);
    let slotFraction = columnFraction;
    if (slotIndex === undefined) {
      slotIndex = columnSlots.findIndex((slot) => (
        slot.kind === 'elision' && column >= slot.startColumn && column < slot.endColumn
      ));
      const slot = columnSlots[slotIndex];
      if (slot?.kind === 'elision') {
        slotFraction = (boundedCenter - slot.startColumn) / Math.max(1, slot.endColumn - slot.startColumn);
      }
    }
    if (slotIndex < 0 || slotIndex === undefined) return 0;
    const centerPixel = (slotIndex + Math.max(0, Math.min(1, slotFraction))) * cellWidth;
    return Math.max(0, Math.min(maxHorizontalScroll, centerPixel - sequenceViewportWidth / 2));
  }, [alignment.alignmentLength, cellWidth, columnSlotIndex, columnSlots, maxHorizontalScroll, sequenceViewportWidth]);
  const fitResolution = useMemo(() => resolveMsaFitZoom({
    baseCellWidth,
    columnCount: columnSlots.length,
    viewportWidth: sequenceViewportWidth,
    minimumCellWidth: MSA_CELL_MIN,
    maximumCellWidth: MSA_CELL_MAX,
  }), [baseCellWidth, columnSlots.length, sequenceViewportWidth]);
  const canFitAlignment = fitResolution.fits;
  const panThumbWidth = Math.max(
    36,
    Math.min(sequenceViewportWidth, sequenceViewportWidth * (sequenceViewportWidth / Math.max(sequenceViewportWidth, sequenceWidth))),
  );
  const template = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  const referenceNumbering = alignment.referenceNumbering;
  const numberingReference = referenceNumbering
    ? alignment.rows.find((row) => row.id === referenceNumbering.rowId)
    : undefined;
  const templateCoverage = useMemo(() => alignmentCoverage(template?.aligned ?? ''), [template]);
  const rowCoverageById = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    alignmentCoverage(row.aligned),
  ])), [alignment.rows]);
  const templateCoordinates = useMemo(
    () => templatePositionCoordinates(template?.aligned ?? ''),
    [template],
  );
  // With an ungapped template and no reference numbering, the template axis
  // prints the same number as the alignment axis in every column, so the two
  // rows are one row's worth of information in two rows' worth of height.
  // Decided across the whole alignment rather than the visible window: a
  // template gapped only near the end would otherwise make the row appear and
  // disappear as you pan, which is worse than the duplication.
  const axesAreIdentical = useMemo(() => (
    !referenceCoordinates
    && templateCoordinates.length > 0
    && templateCoordinates[templateCoordinates.length - 1] === templateCoordinates.length
  ), [referenceCoordinates, templateCoordinates]);
  const mergeAxisRows = axesAreIdentical && visibility.showAlignmentAxis && visibility.showTemplateAxis;
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
  const searchNameMatchRowIds = useMemo(() => new Set(
    searchMatches.filter((match) => match.kind === 'row-name').map((match) => match.rowId),
  ), [searchMatches]);
  const activeSearchColumns = useMemo(() => new Set(activeSearchMatch?.columns ?? []), [activeSearchMatch]);
  const activeSearchRowId = activeSearchMatch?.rowId ?? null;
  const activeSearchNameRowId = activeSearchMatch?.kind === 'row-name' ? activeSearchMatch.rowId : null;
  const statsByRow = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    pairwiseRowStats(row.aligned, template?.aligned ?? '', alignment.molecule, strictDifferences),
  ])), [alignment.molecule, alignment.rows, strictDifferences, template]);
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
    const initialColumn = Math.floor(initialViewport?.centerColumn ?? 0);
    return {
      rowId: row.id,
      column: Math.max(0, Math.min(alignment.alignmentLength - 1, initialColumn)),
    };
  });
  useEffect(() => {
    setActiveCell((current) => {
      const fallbackRow = orderedRows[0];
      if (!fallbackRow || alignment.alignmentLength <= 0) return null;
      const rowId = current && orderedRows.some((row) => row.id === current.rowId)
        ? current.rowId
        : fallbackRow.id;
      const column = Math.max(0, Math.min(alignment.alignmentLength - 1, current?.column ?? 0));
      return current?.rowId === rowId && current.column === column ? current : { rowId, column };
    });
  }, [alignment.alignmentLength, orderedRows]);
  const focusGridRef = useRef(false);
  const activeRowIndex = activeCell ? orderedRows.findIndex((row) => row.id === activeCell.rowId) : -1;
  const activeCellIsValid = Boolean(
    activeCell
    && activeRowIndex >= 0
    && activeCell.column >= 0
    && activeCell.column < alignment.alignmentLength,
  );
  const activeCellIsRendered = Boolean(
    activeCellIsValid
    && activeCell
    && (() => {
      const slot = columnSlotIndex.get(activeCell.column);
      return slot !== undefined && slot >= startSlot && slot < endSlot;
    })(),
  );
  const activeCellDomId = activeCellIsValid && activeCell
    ? `${gridCellIdPrefix}-cell-${activeRowIndex}-${activeCell.column}`
    : undefined;
  const allRowNames = useMemo(() => alignment.rows.map((row) => row.name), [alignment.rows]);
  const commonNamePrefix = useMemo(() => sharedNamePrefix(allRowNames), [allRowNames]);
  const rowLabelsById = useMemo(() => {
    // rowNameParts trims trailing separators off `leading`, while the shared
    // prefix carries its own. Compare on the trimmed form, or names whose
    // distinguishing text sits entirely in the tail ("Homo sapiens hemoglobin
    // alpha 1/2/3") never match and keep every shared character.
    const prefix = commonNamePrefix.trimEnd();
    return new Map(alignment.rows.map((row) => {
      const parts = rowNameParts(row.name, allRowNames);
      if (!startsWithSharedPrefix(parts.leading, prefix)) return [row.id, parts];
      const leading = parts.leading.slice(prefix.length).replace(/^[\s_./-]+/u, '');
      // Never leave a row with nothing to render.
      return [row.id, leading || parts.trailing ? { ...parts, leading } : parts];
    }));
  }, [alignment.rows, allRowNames, commonNamePrefix]);
  const overviewBinCount = Math.min(512, Math.max(1, alignment.alignmentLength));
  const overviewBins = useMemo(
    () => mismatchOverviewBins(alignment, template?.id ?? referenceRowId, overviewBinCount, strictDifferences),
    [alignment, overviewBinCount, template, referenceRowId, strictDifferences],
  );
  const overviewPlotWidth = Math.max(1, sequenceViewportWidth - 16);
  const overviewTickWidth = Math.min(
    overviewBinCount,
    // A small fractional guard keeps device-independent rounding from turning
    // a nominal 2px bar into a measured 1.99px target.
    Math.max(1, (2.1 * overviewBinCount) / overviewPlotWidth),
  );
  const overviewTicks = useMemo(() => overviewBins.flatMap((density, index) => {
    if (density <= 0) return [];
    const height = Math.max(3, density * 20);
    const top = Math.max(2, 22 - height);
    const x = Math.max(
      0,
      Math.min(overviewBinCount - overviewTickWidth, index + 0.5 - overviewTickWidth / 2),
    );
    return [{ index, x, top, width: overviewTickWidth, height: 22 - top }];
  }), [overviewBinCount, overviewBins, overviewTickWidth]);
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
  // When the two position axes are identical they render as ONE row, so the
  // template axis must not be counted here — otherwise every sequence row's
  // aria-rowindex is one too high, aria-rowcount overshoots, and index 2 is
  // never emitted, which assistive tech reads as a hole in the grid.
  const axisRows = Number(visibility.showAlignmentAxis) + Number(visibility.showTemplateAxis && !mergeAxisRows);

  /**
   * Which rows keep their residue cells. See MSA_ROW_WINDOW_OVERSCAN.
   *
   * Both bounds err towards rendering too much. The header depth comes off the
   * scroll offset before the divide, so the first index can only be too small,
   * and the visible span is taken from the whole scroller height including that
   * header, so the last can only be too large. A row outside the band still
   * renders — its element, its sticky label and its aria-rowindex are all
   * untouched — it just renders an empty cell window.
   */
  const rowWindowFor = useCallback((scrollTop: number, clientHeight: number) => {
    const headerDepth = axisRows * MSA_RULER_ROW_HEIGHT;
    const firstVisible = Math.floor(Math.max(0, scrollTop - headerDepth) / MSA_MATRIX_ROW_HEIGHT);
    const span = Math.ceil(Math.max(0, clientHeight) / MSA_MATRIX_ROW_HEIGHT);
    const start = Math.max(
      0,
      Math.floor((firstVisible - MSA_ROW_WINDOW_OVERSCAN) / MSA_ROW_WINDOW_BLOCK) * MSA_ROW_WINDOW_BLOCK,
    );
    const end = Math.min(
      orderedRows.length,
      Math.ceil((firstVisible + span + MSA_ROW_WINDOW_OVERSCAN) / MSA_ROW_WINDOW_BLOCK) * MSA_ROW_WINDOW_BLOCK,
    );
    return { start, end };
  }, [axisRows, orderedRows.length]);

  // Everything renders until the scroller has been measured, so the first paint
  // can never be short of a row.
  const [rowWindow, setRowWindow] = useState({ start: 0, end: Number.POSITIVE_INFINITY });
  const syncRowWindow = useCallback((scrollTop: number, clientHeight: number) => {
    if (clientHeight <= 0) return;
    const next = rowWindowFor(scrollTop, clientHeight);
    setRowWindow((current) => (
      current.start === next.start && current.end === next.end ? current : next
    ));
  }, [rowWindowFor]);
  useEffect(() => {
    syncRowWindow(pendingScrollTopRef.current, viewportHeight);
  }, [syncRowWindow, viewportHeight]);

  const firstSequenceRow = axisRows + 1;
  const tableRowCount = axisRows
    + orderedRows.length
    + Number(visibility.showConservation)
    + Number(visibility.showConservationHistogram)
    + Number(visibility.showOccupancy)
    + Number(visibility.showConsensus)
    + Number(visibility.showSequenceLogo)
    + Number(translationVisible);

  const expandElision = useCallback((slot: Extract<MsaColumnViewSlot, { kind: 'elision' }>) => {
    setExpandedColumnRanges((current) => (
      current.some((range) => range.startColumn === slot.startColumn && range.endColumn === slot.endColumn)
        ? current
        : [...current, { startColumn: slot.startColumn, endColumn: slot.endColumn }]
    ));
  }, []);

  const scrollToColumn = useCallback((column: number, behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const boundedColumn = Math.max(0, Math.min(Math.max(0, alignment.alignmentLength - 1), column));
    const slotIndex = columnSlotIndex.get(boundedColumn);
    if (slotIndex === undefined) {
      const elision = columnSlots.find((slot): slot is Extract<MsaColumnViewSlot, { kind: 'elision' }> => (
        slot.kind === 'elision' && boundedColumn >= slot.startColumn && boundedColumn < slot.endColumn
      ));
      if (elision) {
        pendingColumnScrollRef.current = { column: boundedColumn, behavior };
        expandElision(elision);
      }
      return;
    }
    // Centre the cell's middle, not its left edge.
    const target = Math.max(0, Math.min(maxHorizontalScroll, ((slotIndex + 0.5) * cellWidth) - (sequenceViewportWidth / 2)));
    desiredCenterColumnRef.current = boundedColumn + 0.5;
    if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ left: target, behavior });
    else { viewport.scrollLeft = target; setScrollLeft(target); }
  }, [alignment.alignmentLength, cellWidth, columnSlotIndex, columnSlots, expandElision, maxHorizontalScroll, sequenceViewportWidth, viewportRef]);

  useLayoutEffect(() => {
    const pending = pendingColumnScrollRef.current;
    const viewport = viewportRef.current;
    if (!pending || !viewport) return;
    const slotIndex = columnSlotIndex.get(pending.column);
    if (slotIndex === undefined) return;
    pendingColumnScrollRef.current = null;
    const target = Math.max(0, Math.min(maxHorizontalScroll, ((slotIndex + 0.5) * cellWidth) - (sequenceViewportWidth / 2)));
    desiredCenterColumnRef.current = pending.column + 0.5;
    if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ left: target, behavior: pending.behavior });
    else { viewport.scrollLeft = target; setScrollLeft(target); }
  }, [cellWidth, columnSlotIndex, maxHorizontalScroll, sequenceViewportWidth, viewportRef]);

  const setZoom = useCallback((next: number) => {
    onZoomChange(Math.max(MSA_ZOOM_MIN, Math.min(MSA_ZOOM_MAX, Math.round(next * 100) / 100)));
  }, [onZoomChange]);

  // Use the greatest persisted zoom whose tenth-pixel cell width actually fits;
  // the pure resolver accounts for both renderer rounding stages.
  const fitZoom = useCallback(() => {
    if (alignment.alignmentLength === 0) return;
    setZoom(fitResolution.zoom);
  }, [alignment.alignmentLength, fitResolution.zoom, setZoom]);

  // Preserve an absolute biological column across every pixel-geometry change.
  // A restore is retried only when the browser rejected the first assignment:
  // the matrix can still have its transient pre-layout width during this layout
  // effect, and a one-shot assignment would then be clamped to the beginning.
  // This replaces the old pixel restore (`viewport.scrollLeft = saved?.left ?? 0;`
  // and `viewport.scrollTop = saved?.top ?? 0;`) and its matching unconditional
  // `msaMatrixViewportSession.set(alignment.id, { left, top });`: those statements
  // let transient layout pixels become durable review position.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const previousGeometry = previousViewportGeometryRef.current;
    const geometryChanged = previousGeometry.cellWidth !== cellWidth
      || previousGeometry.sequenceViewportWidth !== sequenceViewportWidth;
    previousViewportGeometryRef.current = { cellWidth, sequenceViewportWidth };

    const firstLayout = !restoredViewportRef.current;
    restoredViewportRef.current = true;
    const saved = firstLayout ? msaMatrixViewportSession.get(alignment.id) : undefined;
    if (saved) desiredCenterColumnRef.current = saved.centerColumn;
    if (!firstLayout && !geometryChanged) return;

    // Only a position the reader actually created is worth restoring: a saved
    // session, a jump, or their own scroll. Seeding this from the live scrollLeft
    // instead looked harmless and was not. During this layout effect the matrix
    // can still hold its transient pre-layout width, so the seed is taken at one
    // width and converted back at another, and half the difference survives as a
    // permanent offset. Measured at a 700px window: seeded at 698px, applied at
    // 597px, the alignment opened on column 5 of 120 and the retry below kept
    // re-applying it. With nothing to restore, leave the scroll alone.
    const centerColumn = desiredCenterColumnRef.current;
    if (centerColumn === null) return;
    const top = saved?.top ?? viewport.scrollTop;
    const applyPosition = () => {
      const target = scrollLeftForAbsoluteCenterColumn(centerColumn);
      viewport.scrollLeft = target;
      viewport.scrollTop = top;
      pendingScrollLeftRef.current = viewport.scrollLeft;
      pendingScrollTopRef.current = viewport.scrollTop;
      setScrollLeft(viewport.scrollLeft);
      return Math.abs(viewport.scrollLeft - target) < 0.5;
    };

    if (viewportRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(viewportRestoreFrameRef.current);
      viewportRestoreFrameRef.current = null;
    }
    if (applyPosition()) return;
    let framesLeft = MSA_VIEWPORT_RESTORE_FRAMES;
    const retry = () => {
      viewportRestoreFrameRef.current = null;
      if (applyPosition()) return;
      framesLeft -= 1;
      if (framesLeft > 0) viewportRestoreFrameRef.current = window.requestAnimationFrame(retry);
    };
    viewportRestoreFrameRef.current = window.requestAnimationFrame(retry);
  }, [
    alignment.id,
    cellWidth,
    scrollLeftForAbsoluteCenterColumn,
    sequenceViewportWidth,
    viewportRef,
  ]);

  useEffect(() => {
    if (jumpColumn === null || !viewportRef.current) return;
    if (handledJumpTokenRef.current === jumpToken) return;
    handledJumpTokenRef.current = jumpToken;
    const saved = msaMatrixViewportSession.get(alignment.id);
    if (saved) msaMatrixViewportSession.set(alignment.id, { ...saved, handledJumpToken: jumpToken });
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    scrollToColumn(jumpColumn, reducedMotion ? 'auto' : 'smooth');
  }, [alignment.id, jumpColumn, jumpToken, scrollToColumn, viewportRef]);

  // Bring a search hit's row into vertical view (horizontal is handled above).
  useEffect(() => {
    if (!jumpRowId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rowElement = viewport.querySelector<HTMLElement>(`[data-msa-row-id="${escapeMsaAttributeSelector(jumpRowId)}"]`);
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
    // Reset means the start of the alignment, which is scrollLeft 0 at every
    // viewport width. Converting that through a width-dependent centre column
    // reintroduces the offset described above, so drop the desired column and
    // let this scrollTo stand.
    desiredCenterColumnRef.current = null;
    msaMatrixViewportSession.delete(alignment.id);
    setScrollLeft(0);
  }, [absoluteCenterColumnForScrollLeft, alignment.id, resetToken, viewportRef]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (viewportRestoreFrameRef.current !== null) window.cancelAnimationFrame(viewportRestoreFrameRef.current);
    if (pendingUserScrollFrameRef.current !== null) window.cancelAnimationFrame(pendingUserScrollFrameRef.current);
    if (dragAutoScrollFrameRef.current !== null) window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
    dragAutoScrollStateRef.current = null;
  }, []);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const sync = () => { reducedMotionRef.current = query.matches; };
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  // Surface the currently visible column window so the parent's image export can
  // honour the "Visible view" scope. Half-open [start, end) in alignment columns.
  useEffect(() => {
    onVisibleColumnsChange({ start: visibleStartColumn, end: visibleEndColumn, slots: visibleSlots });
  }, [visibleStartColumn, visibleEndColumn, visibleSlots, onVisibleColumnsChange]);

  const handleScroll = (left: number, top: number, isTrusted: boolean) => {
    // The hover readout is anchored to a fixed screen point; once the content
    // moves under it, it would describe the wrong cell, so drop it on scroll.
    setHoverCell(null);
    pendingScrollLeftRef.current = left;
    pendingScrollTopRef.current = top;
    // From the OBSERVED height, not the element's: reading clientHeight here
    // would force a synchronous layout on every scroll frame.
    syncRowWindow(top, viewportHeight);
    // Browser scroll events are trusted whether they came from a person or a DOM
    // assignment, so production relies on the input intent recorded above. jsdom
    // cannot create trusted events; its untrusted scroll is the test harness's
    // direct model of dragging the native scrollbar.
    const userScrolled = userScrollPointerRef.current || pendingUserScrollRef.current || !isTrusted;
    pendingUserScrollRef.current = false;
    if (pendingUserScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingUserScrollFrameRef.current);
      pendingUserScrollFrameRef.current = null;
    }
    if (userScrolled) {
      const centerColumn = absoluteCenterColumnForScrollLeft(left);
      desiredCenterColumnRef.current = centerColumn;
      msaMatrixViewportSession.set(alignment.id, {
        centerColumn,
        top,
        handledJumpToken: handledJumpTokenRef.current,
      });
      if (viewportRestoreFrameRef.current !== null) {
        window.cancelAnimationFrame(viewportRestoreFrameRef.current);
        viewportRestoreFrameRef.current = null;
      }
    }
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollLeft(pendingScrollLeftRef.current);
    });
  };

  const setHorizontalScroll = useCallback((left: number, behavior: ScrollBehavior = 'auto') => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const target = Math.max(0, Math.min(maxHorizontalScroll, left));
    desiredCenterColumnRef.current = absoluteCenterColumnForScrollLeft(target);
    viewport.scrollTo({
      left: target,
      behavior,
    });
  }, [absoluteCenterColumnForScrollLeft, maxHorizontalScroll, viewportRef]);

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
    if (reducedMotionRef.current) {
      dragAutoScrollStateRef.current = null;
      if (dragAutoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(dragAutoScrollFrameRef.current);
        dragAutoScrollFrameRef.current = null;
      }
      resolve();
      return;
    }
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
    const gesture = resolveMsaWheelGesture(
      event.deltaX,
      event.deltaY,
      event.shiftKey,
      event.timeStamp,
      wheelGestureRef.current,
    );
    wheelGestureRef.current = gesture;
    if (gesture.axis === 'horizontal') {
      event.preventDefault();
      const horizontalDelta = (event.shiftKey ? event.deltaY : event.deltaX) * deltaScale;
      markUserScrollIntent();
      setHorizontalScroll(viewport.scrollLeft + horizontalDelta);
      return;
    }

    // A gesture that began vertically stays vertical even if a later event has
    // only horizontal noise. Prevent that event from leaking into column pan.
    if (!event.deltaY) {
      event.preventDefault();
      return;
    }
    const maxVerticalScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const matrixCanContinue = event.deltaY < 0
      ? viewport.scrollTop > 0
      : viewport.scrollTop < maxVerticalScroll - 1;
    if (matrixCanContinue) {
      event.preventDefault();
      markUserScrollIntent();
      viewport.scrollTop = Math.max(
        0,
        Math.min(maxVerticalScroll, viewport.scrollTop + event.deltaY * deltaScale),
      );
      return;
    }

    const windowBody = viewport.closest<HTMLElement>('.motif-cs-window-body');
    if (!windowBody || windowBody === viewport || windowBody.scrollHeight <= windowBody.clientHeight) {
      // At a vertical boundary, suppress a locked gesture's horizontal noise;
      // a pure vertical wheel may still bubble to an outer page scroller.
      if (event.deltaX !== 0) event.preventDefault();
      return;
    }
    event.preventDefault();
    windowBody.scrollTop += event.deltaY * deltaScale;
  }, [markUserScrollIntent, sequenceViewportWidth, setHorizontalScroll, viewportRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    viewport.addEventListener('wheel', handleMatrixWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', handleMatrixWheel);
  }, [handleMatrixWheel, viewportRef]);

  const columnStats = useMemo<MsaColumnStats[]>(() => computeMsaColumnStats(alignment.rows, alignment.molecule), [alignment.rows, alignment.molecule]);
  // Only pay the O(rows × columns) logo pass when the track is on. Filtered
  // geometry then indexes this absolute-column array without changing its
  // biological coordinates.
  const logoColumns = useMemo<MsaLogoColumn[]>(
    () => (visibility.showSequenceLogo
      ? computeSequenceLogoColumns(alignment.rows, alignment.molecule, { startColumn: 0, endColumn: alignment.alignmentLength })
      : []),
    [alignment.alignmentLength, alignment.molecule, alignment.rows, visibility.showSequenceLogo],
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

  const selectionCoordinates = useMemo(() => {
    if (!selection) return null;
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
    return {
      columns: selection.colEnd - selection.colStart + 1,
      startPosition,
      endPosition,
      rows: selection.rowEnd - selection.rowStart + 1,
    };
  }, [selection, templateCoordinates]);

  const selectionSummary = useMemo(() => {
    if (!selection || isSelecting) return null;
    // Stats describe the selected block only. Pointer drags keep the cheap
    // coordinate summary live, then pay this block-sized cost at settle.
    const selectedRows = orderedRows
      .slice(selection.rowStart, selection.rowEnd + 1)
      .map((row) => ({ ...row, aligned: row.aligned.slice(selection.colStart, selection.colEnd + 1) }));
    const blockStats = computeMsaColumnStats(selectedRows, alignment.molecule);
    return summarizeSelectionColumns(blockStats, { start: 0, end: selection.colEnd - selection.colStart });
  }, [orderedRows, selection, alignment.molecule, isSelecting]);

  const selectionReferenceRange = useMemo(() => {
    if (!selection || !referenceCoordinates) return null;
    const start = referenceCoordinates[selection.colStart];
    const end = referenceCoordinates[selection.colEnd];
    return start && end ? { start: start.label, end: end.label } : null;
  }, [referenceCoordinates, selection]);

  const columnFromClientX = useCallback((clientX: number, clampToViewport = false): number | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const slotIndex = msaColumnFromClientX(clientX, {
      viewportLeft: rect.left,
      viewportRight: rect.right,
      labelWidth,
      scrollLeft: viewport.scrollLeft,
      cellWidth,
      columnCount: columnSlots.length,
    }, clampToViewport);
    if (slotIndex === null) return null;
    const slot = columnSlots[slotIndex];
    if (!slot) return null;
    if (slot.kind === 'column') return slot.column;
    if (!clampToViewport) return null;
    const sequenceX = clientX - rect.left - labelWidth + viewport.scrollLeft;
    const withinSlot = sequenceX - slotIndex * cellWidth;
    return withinSlot < cellWidth / 2 ? slot.startColumn : slot.endColumn - 1;
  }, [cellWidth, columnSlots, labelWidth, viewportRef]);

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
    // A newer passive pointer request cancels any not-yet-consumed keyboard
    // focus request, preventing a delayed reveal from moving under the pointer.
    focusGridRef.current = focus;
    setActiveCell({ rowId: cell.rowId, column: cell.column });
  }, [alignment.alignmentLength, orderedRows]);

  // The grid owns DOM focus while activeCell owns the virtual cursor. A focus
  // request can therefore move the cursor and scroll its cell into view without
  // waiting for that cell's virtualized DOM node to mount. Rows are not
  // virtualized, but can need a small vertical nearest-edge adjustment in a
  // short matrix viewport.
  useLayoutEffect(() => {
    if (!activeCell) return undefined;
    const viewport = viewportRef.current;
    if (!viewport) return undefined;

    // Pointer selection and passive view changes may update the virtual cursor
    // without asking the viewport to move. Revealing those cells here expands
    // filtered ranges and can scroll a context menu out from under its pointer.
    if (!focusGridRef.current) return undefined;
    gridRef.current?.focus({ preventScroll: true });
    focusGridRef.current = false;

    const activeSlotIndex = columnSlotIndex.get(activeCell.column);
    if (activeSlotIndex === undefined) {
      const elision = columnSlots.find((slot): slot is Extract<MsaColumnViewSlot, { kind: 'elision' }> => (
        slot.kind === 'elision' && activeCell.column >= slot.startColumn && activeCell.column < slot.endColumn
      ));
      if (elision) expandElision(elision);
      return undefined;
    }
    const cellLeft = activeSlotIndex * cellWidth;
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

    return undefined;
  }, [activeCell, axisRows, cellWidth, columnSlotIndex, columnSlots, expandElision, sequenceViewportWidth, setHorizontalScroll, viewportRef]);

  // Reported through a callback the parent stores in a ref rather than state:
  // the cursor moves on every arrow key, and re-rendering the whole viewer that
  // often would cost far more than the one thing the parent needs it for.
  useEffect(() => { onActiveCellChange(activeCell); }, [activeCell, onActiveCellChange]);

  const handledFocusRequestTokenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || handledFocusRequestTokenRef.current === focusRequest.token) return;
    handledFocusRequestTokenRef.current = focusRequest.token;
    activateCell(focusRequest, focusRequest.focus);
  }, [activateCell, focusRequest]);

  const handleGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    userScrollPointerRef.current = true;
    const cell = pointToCell(event.clientX, event.clientY);
    if (!cell) return;
    event.preventDefault();
    setContextMenu(null);
    setHoverCell(null);
    activateCell({ column: cell.column, rowId: cell.rowId }, false);
    // preventDefault suppresses the browser's pointer-focus step, so place focus
    // on the persistent grid owner without scrolling the partially visible cell
    // under the pointer.
    gridRef.current?.focus({ preventScroll: true });
    if (!(event.shiftKey && selectionAnchorRef.current)) {
      selectionAnchorRef.current = { column: cell.column, rowIndex: cell.rowIndex };
    }
    selectingRef.current = true;
    setIsSelecting(true);
    applySelectionTo(cell);
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
    userScrollPointerRef.current = false;
    if (!selectingRef.current) return;
    stopDragAutoScroll();
    if (event.type === 'pointerup') {
      const cell = pointToCell(event.clientX, event.clientY, true);
      if (cell) applySelectionTo(cell);
    }
    selectingRef.current = false;
    setIsSelecting(false);
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
    // Mirrors the grid path. `isSelecting` is what floats the selection readout out of
    // the flow and defers the block statistics while the pointer is down. Without it a
    // ruler drag mounted the readout as a row mid-gesture and took 46px — one whole
    // residue row — out of the viewport, measured at 1100x640. A ruler drag selects
    // every row, so it is the case where losing one hurts most.
    setIsSelecting(true);
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
    setIsSelecting(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const clearSelection = useCallback(() => {
    setSelection(null);
    setIsSelecting(false);
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
      const viewport = viewportRef.current;
      if (!viewport) return;
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
      markUserScrollIntent();
      setHorizontalScroll(target);
      return;
    }

    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      event.stopPropagation();
      const element = findGridCellElement(activeCell);
      const rect = element?.getBoundingClientRect()
        ?? viewportRef.current?.getBoundingClientRect()
        ?? event.currentTarget.getBoundingClientRect();
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
    markUserScrollIntent();
    setContextMenu(null);
    if (event.shiftKey) {
      if (!selectionAnchorRef.current) {
        selectionAnchorRef.current = { column: activeCell.column, rowIndex: activeRowIndex };
      }
      applySelectionTo(next);
    } else {
      selectionAnchorRef.current = next;
      setSelection({
        colStart: next.column,
        colEnd: next.column,
        rowStart: next.rowIndex,
        rowEnd: next.rowIndex,
      });
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

  const chooseRowTemplate = (event: ReactMouseEvent<HTMLButtonElement>, rowId: string) => {
    const previous = rowTemplateClickRef.current;
    const sameScreenPoint = previous !== null
      && Math.abs(event.clientX - previous.clientX) <= 4
      && Math.abs(event.clientY - previous.clientY) <= 4;
    const repeatedPointerClick = event.detail > 0
      && previous !== null
      && sameScreenPoint
      && event.timeStamp >= previous.timeStamp
      && event.timeStamp - previous.timeStamp <= 600;
    if (!repeatedPointerClick) {
      rowTemplateClickRef.current = {
        rowId,
        timeStamp: event.timeStamp,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    }
    // Promoting a row pins it at the top immediately. On a double-click the
    // second press can therefore land on the row that moved into the original
    // screen position; retain the row selected by the first press.
    onTemplateChange(repeatedPointerClick ? previous.rowId : rowId);
  };

  useEffect(() => {
    stopDragAutoScroll();
    setSelection(null);
    setHoverCell(null);
    setContextMenu(null);
    selectionAnchorRef.current = null;
    selectingRef.current = false;
    setIsSelecting(false);
    rulerSelectingRef.current = false;
    setManualOrder(null);
    setRowDrag(null);
    rowDragRef.current = null;
    rowTemplateClickRef.current = null;
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

  /**
   * Where the selection readout sits. It FLOATS over the bottom chrome only while the
   * pointer is down AND that chrome is tall enough to hold it — otherwise it takes a
   * row like anything else.
   *
   * The height test is the whole point. The float is anchored to the shell's bottom
   * and grows upward, so it covers the chrome strip; when that strip is a lone status
   * line (no pan row, which happens whenever the alignment fits horizontally) a 40px
   * readout overhangs it and paints an opaque panel across the last residue row —
   * measured at 7px, over the very rows the pointer is aiming at. Covering data is
   * worse than the viewport shrink the float exists to avoid, so in that case the
   * float is declined and the pre-existing in-flow behaviour stands.
   */
  const readoutVisible = !!selection && !!selectionCoordinates;
  const readoutPlacement: 'none' | 'flow' | 'float' = !readoutVisible
    ? 'none'
    : isSelecting && chromeHeight >= readoutHeight
      ? 'float'
      : 'flow';

  const frameStyle = {
    '--motif-cs-msa-label-width': `${labelWidth}px`,
    '--motif-cs-msa-cell-width': `${cellWidth}px`,
    '--motif-cs-msa-font-size': `${renderFontSize}px`,
    // Derived from the row-height constants above, so the floors cannot drift away
    // from the rows they exist to hold. The shell's floor tracks what is actually
    // mounted — three of its four rows come and go — and drops the readout while the
    // pointer is down, when it floats instead of taking a row.
    '--motif-cs-msa-frame-min-height': `${MSA_MATRIX_FRAME_MIN_HEIGHT}px`,
    '--motif-cs-msa-shell-min-height': `${msaMatrixShellMinHeight({
      chromeHeight,
      readoutInFlow: readoutPlacement === 'flow',
    })}px`,
  } as CSSProperties;

  const matrixStyle = {
    /**
     * The scroller reserves a stable scrollbar gutter on its inline end, and
     * scrolling stops with the content's right edge against the OUTER edge of
     * the box — so content sized to `totalWidth` alone leaves its last gutter's
     * worth of columns permanently underneath the reservation. Measured at
     * 1440x980: the tail stopped 15px short at 120, 500, 5,000, 50,000 and
     * 100x20,000 columns alike, hiding the final column completely and 64% of
     * the one before it, through every route into the tail. Reserving the same
     * width as trailing space lands the scroll exactly on maxHorizontalScroll.
     * Only while the alignment overflows: adding it to one that already fits
     * would manufacture the overflow it exists to correct.
     */
    width: totalWidth + (maxHorizontalScroll > 0 ? viewportScrollbarGutter : 0),
  } as CSSProperties;

  const navigateOverviewPointer = (element: HTMLElement, clientX: number) => {
    markUserScrollIntent();
    const bounds = element.getBoundingClientRect();
    const fraction = bounds.width > 0 ? (clientX - bounds.left) / bounds.width : 0;
    scrollToColumn(Math.round(Math.max(0, Math.min(1, fraction)) * Math.max(0, alignment.alignmentLength - 1)));
  };

  const renderSymbols = (sequence: string, rowId: string, consensus = false, rowIndex: number | null = null) => (
    <div
      className="motif-cs-msa-symbol-window"
      style={{ left: labelWidth + (startSlot * cellWidth) }}
      aria-hidden={consensus ? true : undefined}
    >
      {renderedSlots.map((slot) => {
        if (slot.kind === 'elision') {
          return (
            <span
              key={`elision-${slot.startColumn}-${slot.endColumn}`}
              className="motif-cs-msa-symbol motif-cs-msa-elision-spacer"
              data-msa-elision-spacer="true"
              aria-hidden="true"
            />
          );
        }
        const column = slot.column;
        const symbol = sequence[column] ?? '-';
        const isGridCell = !consensus && rowIndex !== null;
        const resolvedRowIndex = rowIndex ?? -1;
        const isActive = isGridCell && activeCell?.rowId === rowId && activeCell.column === column;
        const isSelected = isGridCell && selection
          && column >= selection.colStart && column <= selection.colEnd
          && resolvedRowIndex >= selection.rowStart && resolvedRowIndex <= selection.rowEnd;
        const rowName = rowIndex === null ? '' : orderedRows[resolvedRowIndex]?.name ?? '';
        const referenceCoordinate = referenceCoordinates?.[column];
        const templateSymbol = template?.aligned[column] ?? '-';
        const isTemplate = rowId === template?.id;
        const cellOutcome = classifyMsaCell(
          templateSymbol,
          symbol,
          coversColumn(rowCoverageById.get(rowId) ?? null, column),
          alignment.molecule,
          strictDifferences,
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
            id={isGridCell ? `${gridCellIdPrefix}-cell-${resolvedRowIndex}-${column}` : undefined}
            tabIndex={isGridCell ? -1 : undefined}
            aria-colindex={isGridCell ? column + 1 : undefined}
            aria-selected={isGridCell ? Boolean(isSelected) : undefined}
            aria-label={isGridCell
              ? msaGridCellLabel(symbol, column, rowName, referenceCoordinate?.label)
              : undefined}
          >
            {display}
          </span>
        );
      })}
    </div>
  );

  const renderHistogram = (metric: (stat: MsaColumnStats) => number, kind: 'conservation' | 'occupancy') => (
    <div className="motif-cs-msa-hist-window" style={{ left: labelWidth + (startSlot * cellWidth) }} aria-hidden="true">
      {renderedSlots.map((slot) => {
        if (slot.kind === 'elision') {
          return <span key={`elision-${slot.startColumn}-${slot.endColumn}`} className="motif-cs-msa-hist-cell motif-cs-msa-elision-spacer" data-msa-elision-spacer="true" />;
        }
        const column = slot.column;
        const stat = columnStats[column];
        if (!stat) return null;
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
        .flatMap((codon) => {
          const slotIndices: number[] = [];
          for (let column = codon.startColumn; column <= codon.endColumn; column += 1) {
            const slotIndex = columnSlotIndex.get(column);
            if (slotIndex !== undefined && slotIndex >= startSlot && slotIndex < endSlot) slotIndices.push(slotIndex);
          }
          if (slotIndices.length === 0) return [];
          const firstSlot = Math.min(...slotIndices);
          const lastSlot = Math.max(...slotIndices);
          const width = (lastSlot - firstSlot + 1) * cellWidth;
          const label = codon.aminoAcid === '*' ? 'Stop' : codon.aminoAcid === 'X' ? 'Unknown' : codon.aminoAcid;
          const showIndex = visibility.showAminoAcidIndices && (codon.position === 1 || codon.position % 10 === 0);
          return [(
            <span
              key={codon.startColumn}
              className="motif-cs-msa-aa"
              style={{ left: firstSlot * cellWidth, width }}
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
          )];
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
    <div className="motif-cs-msa-logo-window" style={{ left: labelWidth + (startSlot * cellWidth) }}>
      {renderedSlots.map((slot) => {
        if (slot.kind === 'elision') {
          return <span key={`elision-${slot.startColumn}-${slot.endColumn}`} className="motif-cs-msa-logo-col motif-cs-msa-elision-spacer" data-msa-elision-spacer="true" aria-hidden="true" />;
        }
        const column = slot.column;
        const col = logoColumns[column];
        if (!col) return null;
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

  const selectionStartSlot = selection ? columnSlotIndex.get(selection.colStart) : undefined;
  const selectionEndSlot = selection ? columnSlotIndex.get(selection.colEnd) : undefined;
  const selectionColumnLeft = selectionStartSlot === undefined ? 0 : labelWidth + (selectionStartSlot * cellWidth);
  const selectionColumnWidth = selectionStartSlot === undefined || selectionEndSlot === undefined
    ? 0
    : (selectionEndSlot - selectionStartSlot + 1) * cellWidth;
  const selectionRowTop = selection
    ? (axisRows * MSA_RULER_ROW_HEIGHT) + (selection.rowStart * MSA_MATRIX_ROW_HEIGHT)
    : 0;
  const selectionRowHeight = selection
    ? (selection.rowEnd - selection.rowStart + 1) * MSA_MATRIX_ROW_HEIGHT
    : 0;
  const hoverSlot = hoverCell ? columnSlotIndex.get(hoverCell.column) : undefined;
  const hoverColumnLeft = hoverSlot === undefined ? 0 : labelWidth + (hoverSlot * cellWidth);

  return (
    /*
     * Two boxes, on purpose. The SHELL owns the visible enclosure and the layout
     * vars; the FRAME is the clipped residue viewport and holds only the overview
     * and the matrix.
     *
     * Everything that does not scroll — the pan slider, the status line, the order
     * note, the selection readout — is a sibling of the frame rather than a child.
     * Inside the frame those rows were squeezed out of a box that clips, with the
     * window body no longer overflowing, so on a short panel they were unreachable:
     * no scrollbar anywhere led to them. As siblings they keep their own height, the
     * frame absorbs the shrink instead, and once the frame hits its floor the shell
     * outgrows the body and the body scrolls again.
     *
     * frameStyle is declared on BOTH boxes, deliberately, but for two different
     * reasons — and only one of them is about production.
     *
     * The SHELL genuinely needs it: --motif-cs-msa-label-width sizes the pan row's
     * grid, and the pan row is now a sibling of the frame, so without it the slider
     * falls back to 180px and stops lining up with the residue columns it scrolls.
     *
     * The FRAME's copy is redundant to the browser. Nothing in production reads these
     * properties — they are consumed by CSS, which inherits, so the shell alone would
     * serve the whole subtree. The frame keeps its own copy solely because two jsdom
     * tests read them as INLINE style off `data-testid="msa-alignment-view"`
     * (ClaudeScienceMsaViewer.overlays and .correctness); the e2e spec uses
     * getComputedStyle and would be fine either way. Removing it would mean repointing
     * those tests at a different element to accommodate a layout change, which is how
     * a suite quietly stops testing what it says it does. It is the same object on
     * both elements, so the two cannot drift.
     *
     * The cursor channel stays declared on the frame in CSS — both widgets that read
     * it (active cell, overview viewport) are inside it.
     */
    <div
      className="motif-cs-msa-matrix-shell"
      style={frameStyle}
      /* On the shell, not the frame: the host swallows Escape for whatever the
         target sits inside, and the selection readout's Clear button is now a
         sibling of the frame. Scoped to the frame it would fall outside, and
         Escape there would close the whole window instead of the selection. */
      data-motif-cs-escape-scope={selection ? 'true' : undefined}
    >
    <div
      ref={frameRef}
      className="motif-cs-msa-matrix-frame"
      data-testid="msa-alignment-view"
      style={frameStyle}
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
          aria-valuetext={visibleWindowText}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            overviewDraggingRef.current = true;
            event.currentTarget.dataset.scrubbing = 'true';
            event.currentTarget.setPointerCapture(event.pointerId);
            navigateOverviewPointer(event.currentTarget, event.clientX);
          }}
          onPointerMove={(event) => {
            if (!overviewDraggingRef.current) return;
            navigateOverviewPointer(event.currentTarget, event.clientX);
          }}
          onPointerUp={(event) => {
            overviewDraggingRef.current = false;
            delete event.currentTarget.dataset.scrubbing;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={(event) => {
            overviewDraggingRef.current = false;
            delete event.currentTarget.dataset.scrubbing;
          }}
          onLostPointerCapture={(event) => {
            overviewDraggingRef.current = false;
            delete event.currentTarget.dataset.scrubbing;
          }}
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
            markUserScrollIntent();
            scrollToColumn(target);
          }}
        >
          <svg viewBox={`0 0 ${overviewBinCount} 24`} preserveAspectRatio="none" aria-hidden="true">
            <g className="motif-cs-msa-overview-mismatches">
              {overviewTicks.map((tick) => (
                <rect
                  key={tick.index}
                  data-msa-overview-difference="true"
                  x={tick.x}
                  y={tick.top}
                  width={tick.width}
                  height={tick.height}
                />
              ))}
            </g>
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
        onScroll={(event) => handleScroll(
          event.currentTarget.scrollLeft,
          event.currentTarget.scrollTop,
          event.nativeEvent.isTrusted,
        )}
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={endSelectionDrag}
        onPointerCancel={endSelectionDrag}
        onPointerLeave={() => setHoverCell(null)}
        onContextMenu={handleGridContextMenu}
        role="region"
        aria-label="Scrollable alignment matrix viewport"
        data-selecting={selection ? true : undefined}
      >
        <div
          ref={gridRef}
          className="motif-cs-msa-matrix"
          style={matrixStyle}
          role="grid"
          tabIndex={0}
          aria-label={`Alignment matrix, ${alignment.rows.length} rows by ${alignment.alignmentLength} columns`}
          aria-describedby="motif-cs-msa-matrix-help"
          aria-activedescendant={activeCellDomId}
          aria-rowcount={tableRowCount}
          aria-colcount={alignment.alignmentLength}
          onKeyDown={handleMatrixKeyDown}
          onFocus={(event) => {
            if (event.target === event.currentTarget) {
              if (activeCell) return;
              const row = orderedRows[0];
              if (row) activateCell({ rowId: row.id, column: visibleStartColumn }, false);
              return;
            }
            const element = (event.target as HTMLElement).closest<HTMLElement>('[data-msa-grid-cell="true"]');
            const row = element?.closest<HTMLElement>('[data-msa-row-id]');
            const column = Number(element?.dataset.alignmentColumn) - 1;
            const rowId = row?.dataset.msaRowId;
            if (!rowId || !Number.isInteger(column)) return;
            // Browsers can focus a tabIndex=-1 cell on a secondary click. Keep
            // the virtual cursor there, then restore the persistent grid owner
            // without revealing or scrolling a cell already under the pointer.
            activateCell({ rowId, column }, false);
            gridRef.current?.focus({ preventScroll: true });
          }}
          data-color-scheme={explicitScheme ? colorScheme : undefined}
          data-shade={shadeMode !== 'none' ? shadeMode : undefined}
          data-reordering={rowDrag ? true : undefined}
          data-blocks={blocks ? true : undefined}
          data-column-filter={columnFilter}
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
          {columnFilter === 'differences' ? columnSlots.map((slot, slotIndex) => (
            slot.kind === 'elision' && slotIndex >= startSlot && slotIndex < endSlot ? (
              <button
                key={`elision-${slot.startColumn}-${slot.endColumn}`}
                type="button"
                className="motif-cs-msa-elision-marker"
                data-msa-elision-marker="true"
                data-hidden-columns={slot.hiddenCount}
                style={{ left: labelWidth + slotIndex * cellWidth, width: cellWidth }}
                title={`${slot.hiddenCount.toLocaleString()} identical columns hidden`}
                aria-label={`${slot.hiddenCount.toLocaleString()} identical columns hidden. Show these columns.`}
                onPointerDown={(event) => { event.stopPropagation(); }}
                onClick={(event) => { event.stopPropagation(); expandElision(slot); }}
              >
                ⋯{slot.hiddenCount.toLocaleString()}⋯
              </button>
            ) : null
          )) : null}
          {visibility.showAlignmentAxis ? <div
            className="motif-cs-msa-ruler-row"
            role="row"
            aria-rowindex={1}
            aria-label={mergeAxisRows
              ? `Alignment positions, matching template positions for ${template?.name ?? 'template'}`
              : undefined}
          >
            <div
              // When merged this label carries a name in a <small>, which is the
              // template ruler's two-part shape — it needs that class or the name
              // inherits the ruler's uppercase mono styling with no ellipsis and
              // overflows the sticky gutter onto the residues.
              className={`motif-cs-msa-sticky-label motif-cs-msa-ruler-label${mergeAxisRows ? ' motif-cs-msa-template-ruler-label' : ''}`}
              role="columnheader"
              title={mergeAxisRows
                ? `Alignment position · identical to template position for ${template?.name ?? 'Template'}, which has no gaps`
                : undefined}
            >
              <span>{mergeAxisRows ? 'Alignment / template' : 'Alignment position'}</span>
              {mergeAxisRows ? <small translate="no">{template?.name ?? 'Template'}</small> : null}
            </div>
            <div
              className="motif-cs-msa-ruler-window motif-cs-msa-ruler-window-clickable"
              style={{ left: labelWidth + (startSlot * cellWidth) }}
              aria-hidden="true"
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              onPointerUp={handleRulerPointerUp}
              onPointerCancel={handleRulerPointerUp}
            >
              {renderedSlots.map((slot) => {
                if (slot.kind === 'elision') {
                  return <span key={`elision-${slot.startColumn}-${slot.endColumn}`} className="motif-cs-msa-ruler-cell motif-cs-msa-elision-spacer" data-msa-elision-spacer="true" />;
                }
                const column = slot.column;
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

          {visibility.showTemplateAxis && !mergeAxisRows ? <div
            className="motif-cs-msa-ruler-row motif-cs-msa-template-ruler-row"
            data-alignment-axis={visibility.showAlignmentAxis || undefined}
            role="row"
            aria-rowindex={visibility.showAlignmentAxis ? 2 : 1}
            aria-label={referenceCoordinates
              ? `Reference positions for ${numberingReference?.name ?? 'reference'}`
              : `Template positions for ${template?.name ?? 'template'}`}
          >
            <div
              className="motif-cs-msa-sticky-label motif-cs-msa-ruler-label motif-cs-msa-template-ruler-label"
              role="columnheader"
              title={referenceCoordinates
                ? `Reference position · ${numberingReference?.name ?? 'Reference'} · first residue ${referenceNumbering?.firstResiduePosition}`
                : `Template position · ${template?.name ?? 'Template'} · ungapped template-row coordinates`}
            >
              <span>{referenceCoordinates ? 'Reference position' : 'Template position'}</span>
              <small translate="no">{referenceCoordinates ? numberingReference?.name ?? 'Reference' : template?.name ?? 'Template'}</small>
            </div>
            <div className="motif-cs-msa-ruler-window" style={{ left: labelWidth + (startSlot * cellWidth) }} aria-hidden="true">
              {renderedSlots.map((slot) => {
                if (slot.kind === 'elision') {
                  return <span key={`elision-${slot.startColumn}-${slot.endColumn}`} className="motif-cs-msa-ruler-cell motif-cs-msa-elision-spacer" data-msa-elision-spacer="true" />;
                }
                const column = slot.column;
                const position = templateCoordinates[column] ?? null;
                const referenceCoordinate = referenceCoordinates?.[column];
                const show = referenceCoordinate
                  ? referenceCoordinate.insertionCode !== ''
                    || referenceCoordinate.referencePosition === referenceNumbering?.firstResiduePosition
                    || referenceCoordinate.referencePosition % 10 === 0
                  : position !== null && (position === 1 || position % 10 === 0);
                return (
                  <span
                    key={column}
                    className="motif-cs-msa-ruler-cell"
                    data-alignment-column={String(column + 1)}
                    data-template-position={position === null ? 'gap' : String(position)}
                    data-reference-coordinate={referenceCoordinate?.label}
                    data-reference-insertion={referenceCoordinate?.insertionCode || undefined}
                    data-reference-label-lane={referenceCoordinate?.insertionCode ? String(column % 3) : undefined}
                    title={referenceCoordinate?.label}
                  >
                    {show ? referenceCoordinate?.label ?? position : ''}
                  </span>
                );
              })}
            </div>
          </div> : null}

          {orderedRows.map((row, rowIndex) => {
            const label = rowLabelsById.get(row.id) ?? { leading: row.name, trailing: '' };
            const stats = statsByRow.get(row.id) ?? pairwiseRowStats(row.aligned, template?.aligned ?? '', alignment.molecule, strictDifferences);
            const isTemplate = row.id === template?.id;
            // Off-band rows keep everything except their residue cells. See
            // MSA_ROW_WINDOW_OVERSCAN for what that is worth and why the row
            // itself stays.
            const cellsRendered = rowIndex >= rowWindow.start && rowIndex < rowWindow.end;
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
                data-search-name-match={searchNameMatchRowIds.has(row.id) || undefined}
                data-search-name-active={activeSearchNameRowId === row.id || undefined}
                role="row"
                aria-rowindex={firstSequenceRow + rowIndex}
                aria-label={visibility.showRowStats
                  ? `${row.name}; ${stats.mismatches} mismatches; ${stats.ambiguities > 0 ? `${stats.ambiguities} compatible ambiguity ${stats.ambiguities === 1 ? 'call' : 'calls'}; ` : ''}${stats.ungappedLength} ungapped ${sequenceUnit(alignment.molecule)}; ${formatIdentity(stats.identity)} percent identity to template; ${isTemplate ? 'template row' : 'alignment row'}`
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
                    onClick={(event) => chooseRowTemplate(event, row.id)}
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
                        {stats.ambiguities > 0 ? (
                          <small className="motif-cs-msa-row-stat motif-cs-msa-row-stat-ambiguous" title="Compatible ambiguity-code calls (not counted as differences)">{stats.ambiguities.toLocaleString()}≈</small>
                        ) : null}
                        <small className="motif-cs-msa-row-stat motif-cs-msa-row-stat-length">{stats.ungappedLength.toLocaleString()} {sequenceUnit(alignment.molecule)}</small>
                        <small className="motif-cs-msa-row-stat">{formatIdentity(stats.identity)}%</small>
                      </>
                    ) : null}
                  </span>
                </div>
                {activeCell?.rowId === row.id && (!activeCellIsRendered || !cellsRendered) && activeCellDomId ? (
                  <span
                    id={activeCellDomId}
                    className="motif-cs-visually-hidden"
                    role="gridcell"
                    aria-colindex={activeCell.column + 1}
                    aria-selected={Boolean(selection
                      && activeCell.column >= selection.colStart
                      && activeCell.column <= selection.colEnd
                      && rowIndex >= selection.rowStart
                      && rowIndex <= selection.rowEnd)}
                    aria-label={msaGridCellLabel(
                      row.aligned[activeCell.column],
                      activeCell.column,
                      row.name,
                      referenceCoordinates?.[activeCell.column]?.label,
                    )}
                  />
                ) : null}
                {cellsRendered ? renderSymbols(row.aligned, row.id, false, rowIndex) : (
                  <div
                    className="motif-cs-msa-symbol-window"
                    style={{ left: labelWidth + (startSlot * cellWidth) }}
                    aria-hidden="true"
                  />
                )}
              </div>
            );
          })}

          {visibility.showConservation || visibility.showConsensus || visibility.showConservationHistogram ? (
            <div className="motif-cs-msa-pinned-tracks" data-testid="msa-pinned-tracks" role="rowgroup">
              {visibility.showConservation ? <div className="motif-cs-msa-conservation-row" role="row" aria-rowindex={firstSequenceRow + orderedRows.length} aria-label="Conservation; asterisks mark columns conserved across every row">
                <div className="motif-cs-msa-sticky-label motif-cs-msa-row-label" role="rowheader"><span>Conserved</span></div>
                <div className="motif-cs-msa-symbol-window" style={{ left: labelWidth + (startSlot * cellWidth) }} aria-hidden="true">
                  {renderedSlots.map((slot) => slot.kind === 'elision' ? (
                    <span key={`elision-${slot.startColumn}-${slot.endColumn}`} className="motif-cs-msa-symbol motif-cs-msa-elision-spacer" data-msa-elision-spacer="true" />
                  ) : (
                    <span key={slot.column} className="motif-cs-msa-symbol motif-cs-msa-conservation-mark" data-alignment-column={slot.column + 1} data-jump={jumpColumn === slot.column || undefined}>
                      {alignment.conserved[slot.column] ? '*' : ''}
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
            </div>
          ) : null}

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
      </div>
      {/* Every in-flow row under the frame, in one box so its real height can be
          MEASURED. The floor and the mid-drag float both depend on how tall this
          strip actually is, and both were wrong while it was assumed to be 33px:
          the status line wraps at narrow widths, and with no pan row the strip is
          too short for the floating readout to sit over. */}
      <div className="motif-cs-msa-matrix-chrome" ref={chromeRef}>
      {/* The pan slider is the alignment's horizontal scrollbar, so it sits
          directly against the matrix and stays aligned to the residue columns
          rather than joining the status line below. It is a SIBLING of the frame,
          not a child: inside the clipped frame it was the first thing squeezed off
          a short panel, with nothing to scroll to reach it. */}
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
            onChange={(event) => {
              markUserScrollIntent();
              setHorizontalScroll(Number(event.target.value));
            }}
            aria-label="Horizontal alignment scroll"
            aria-valuetext={visibleWindowText}
            title="Drag to pan alignment columns"
            style={{ '--motif-cs-msa-pan-thumb-width': `${panThumbWidth}px` } as CSSProperties}
          />
        </div>
      ) : null}
      {/* Zoom and the visible-column readout answer the same question — what am
          I looking at, and how closely — so they share one status line instead
          of taking a strip each under the alignment. */}
      <div className="motif-cs-msa-statusbar">
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
        {blocks ? <span className="motif-cs-chip motif-cs-msa-blocks-chip" data-testid="msa-blocks-chip" title="Columns are compressed past letter legibility; residues render as colored blocks">Blocks</span> : null}
      </div>
      {footerNavigation}
      <span id="motif-cs-msa-matrix-help" className="motif-cs-visually-hidden">{referenceCoordinates
        ? 'Alignment positions count gapped columns. Reference positions use the saved first-residue coordinate; reference-gap columns append stable insertion letters, and leading gaps use the preceding coordinate. Choose any row header button to make that row the comparison template. In the grid, use Arrow keys to move the active residue, Shift plus Arrow keys to extend a selection, Home and End for row boundaries, Control or Command plus Home or End for grid boundaries, Page Up and Page Down to move by a viewport, Space to select a column, and Shift plus F10 or the Context Menu key for selection actions. The Columns slider and Shift plus wheel also pan the alignment. Switch to Text to read or copy the complete aligned sequences with assistive technology.'
        : 'Alignment positions count gapped columns. Template positions count non-gap residues in the chosen template; blank template-axis cells are gaps. Choose any row header button to make that row the template. In the grid, use Arrow keys to move the active residue, Shift plus Arrow keys to extend a selection, Home and End for row boundaries, Control or Command plus Home or End for grid boundaries, Page Up and Page Down to move by a viewport, Space to select a column, and Shift plus F10 or the Context Menu key for selection actions. The Columns slider and Shift plus wheel also pan the alignment. Switch to Text to read or copy the complete aligned sequences with assistive technology.'}</span>
      <div className="motif-cs-msa-window-note" aria-live="polite">{visibleWindowText}</div>
      </div>
      {manualOrder ? (
        <div className="motif-cs-msa-order-note" data-testid="msa-order-note">
          <GripVertical size={12} aria-hidden="true" />
          <span>Custom row order</span>
          <button type="button" className="motif-cs-mini-button" onClick={resetRowOrder}>Reset order</button>
        </div>
      ) : null}
      <span className="motif-cs-visually-hidden" data-testid="msa-reorder-status" role="status" aria-live="polite">{reorderStatus}</span>
      </div>
      {selection && selectionCoordinates ? (
        <div
          ref={readoutRef}
          className="motif-cs-msa-selection-readout"
          data-testid="msa-selection-readout"
          /* While the pointer is still down the readout floats instead of claiming a
             row. Taking one mid-drag shrinks the residue viewport by 46px under the
             pointer — measured at 1 to 2 rows cut off between 1100x600 and 1100x768 —
             which moves the rows you are dragging toward away from you. It settles
             into the flow on pointer-up, when nothing is being aimed at. Same
             reasoning as selectionSummary, which already waits for the settle. */
          data-live={readoutPlacement === 'float' || undefined}
          role="status"
          aria-live="polite"
        >
          <strong>Selected</strong>
          <span>cols {selection.colStart + 1}–{selection.colEnd + 1} ({selectionCoordinates.columns.toLocaleString()})</span>
          {selectionReferenceRange
            ? <span>· reference {selectionReferenceRange.start}–{selectionReferenceRange.end}</span>
            : selectionCoordinates.startPosition != null && selectionCoordinates.endPosition != null
            ? <span>· template {selectionCoordinates.startPosition}–{selectionCoordinates.endPosition}</span>
            : null}
          <span>· {selectionCoordinates.rows} row{selectionCoordinates.rows === 1 ? '' : 's'}</span>
          <span data-testid="msa-selection-variable">· {selectionSummary ? selectionSummary.variableColumns.toLocaleString() : '…'} variable</span>
          <span data-testid="msa-selection-identity">· {selectionSummary ? `${Math.round(selectionSummary.meanIdentity * 100)}%` : '…'} mean id</span>
          <button type="button" className="motif-cs-mini-button" onClick={clearSelection}>Clear</button>
        </div>
      ) : null}
      {hoverCell ? (
        <div ref={hoverReadoutRef} className="motif-cs-msa-hover-readout" style={{ left: hoverPosition?.x ?? hoverCell.clientX + 14, top: hoverPosition?.y ?? hoverCell.clientY + 16 }} aria-hidden="true">
          <b>{orderedRows[hoverCell.rowIndex]?.aligned[hoverCell.column] ?? '-'}</b>
          <span>col {hoverCell.column + 1}</span>
          <span>· {referenceCoordinates?.[hoverCell.column]
            ? `ref ${referenceCoordinates[hoverCell.column].label}`
            : templateCoordinates[hoverCell.column] != null
              ? `tpl ${templateCoordinates[hoverCell.column]}`
              : 'tpl gap'}</span>
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

/**
 * Shared dismissal behaviour for the toolbar's `<details>` menus: an outside
 * pointerdown closes the menu, and Escape closes it and returns focus to its own
 * summary. Both listeners are capture-phase on purpose — the floating window's
 * own Escape handler also listens on capture, so a bubble-phase listener here
 * would never see the key first and Escape would close the whole window.
 *
 * Returns the focus-restoring close, for callers that dismiss the menu directly.
 */
function useDismissableMenu(
  open: boolean,
  setOpen: (next: boolean) => void,
  menuRef: RefObject<HTMLDetailsElement | null>,
  buttonRef: RefObject<HTMLElement | null>,
): () => void {
  // The browser opens a <details> during the click and only tells React later,
  // through the `toggle` event — measured at ~52ms. Inside that gap the menu is
  // open on screen while `open` here is still false, so `setOpen(false)` alone
  // is a no-op and the dismissal is silently dropped. Closing the element itself
  // is what actually shuts it; the toggle that follows settles the state.
  const shut = useCallback(() => {
    if (menuRef.current?.open) menuRef.current.open = false;
    setOpen(false);
  }, [menuRef, setOpen]);

  const close = useCallback(() => {
    shut();
    window.requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  }, [buttonRef, shut]);

  useEffect(() => {
    if (!open) return undefined;
    const closeFromOutside = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      shut();
    };
    document.addEventListener('pointerdown', closeFromOutside, true);
    // focusin as well as pointerdown: a <summary> activated from the keyboard
    // fires click but never pointerdown, so tabbing to a sibling trigger and
    // pressing Enter would otherwise leave both menus open, stacked in the same
    // right-anchored rectangle with their Escape handlers racing.
    document.addEventListener('focusin', closeFromOutside, true);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside, true);
      document.removeEventListener('focusin', closeFromOutside, true);
    };
  }, [menuRef, open, shut]);

  useEffect(() => {
    if (!open) return undefined;
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', closeFromEscape, true);
    return () => window.removeEventListener('keydown', closeFromEscape, true);
  }, [close, open]);

  return close;
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
  const {
    displayMode,
    emphasis,
    columnFilter,
    columnFilterContext,
    colorMode,
    colorScheme,
    shadeMode,
    sortMode,
    fontSize,
    zoom,
    translationFrame,
    textFormat,
    strictDifferences,
  } = viewPreferences;
  const [referenceRowId, setReferenceRowId] = useState(activeAlignment?.referenceRowId ?? '');
  const [differenceIndex, setDifferenceIndex] = useState(-1);
  const [differencesOpen, setDifferencesOpen] = useState(false);
  const differenceLandingScopeRef = useRef<{
    alignmentId: string;
    referenceRowId: string;
    strictDifferences: boolean;
  } | null>(null);
  const [jumpColumn, setJumpColumn] = useState<number | null>(null);
  const [jumpToken, setJumpToken] = useState(0);
  const [jumpRowId, setJumpRowId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [settledSearch, setSettledSearch] = useState<SettledMsaSearch>(() => ({
    alignment: activeAlignment ?? null,
    query: '',
    result: EMPTY_MSA_SEARCH_RESULT,
  }));
  const [searchIndex, setSearchIndex] = useState(-1);
  const [matrixFocusRequest, setMatrixFocusRequest] = useState<MatrixFocusRequest | null>(null);
  // Where the grid cursor is sitting, so a control that takes keyboard focus can
  // give it back rather than stranding it. A ref, not state: see the reporting
  // effect in AlignmentMatrix.
  const matrixActiveCellRef = useRef<MatrixActiveCell | null>(null);
  const reportMatrixActiveCell = useCallback((cell: MatrixActiveCell | null) => {
    matrixActiveCellRef.current = cell;
  }, []);
  const returnFocusToGrid = useCallback(() => {
    const cell = matrixActiveCellRef.current;
    if (!cell) return;
    setMatrixFocusRequest((request) => ({ ...cell, focus: true, token: (request?.token ?? 0) + 1 }));
  }, []);
  const [viewResetToken, setViewResetToken] = useState(0);
  const [coordinateSystem, setCoordinateSystem] = useState<CoordinateSystem>('alignment');
  const [columnDraft, setColumnDraft] = useState('');
  const [columnError, setColumnError] = useState<string | null>(null);
  const [columnStatus, setColumnStatus] = useState('');
  const [referenceNumberingRowDraft, setReferenceNumberingRowDraft] = useState(
    activeAlignment?.referenceNumbering?.rowId ?? activeAlignment?.referenceRowId ?? '',
  );
  const [firstResiduePositionDraft, setFirstResiduePositionDraft] = useState(
    String(activeAlignment?.referenceNumbering?.firstResiduePosition ?? 1),
  );
  const [referenceNumberingError, setReferenceNumberingError] = useState<string | null>(null);
  const [referenceNumberingStatus, setReferenceNumberingStatus] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dismissedAlphabetWarningId, setDismissedAlphabetWarningId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [intakeStatus, setIntakeStatus] = useState<{ message: string; tone: 'status' | 'error' } | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ label: string; message: string; tone: 'status' | 'error' } | null>(null);
  const [imageScope, setImageScope] = useState<AlignmentImageScope>('view');
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [gotoMenuOpen, setGotoMenuOpen] = useState(false);
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
  const exportMenuRef = useRef<HTMLDetailsElement>(null);
  const exportMenuButtonRef = useRef<HTMLElement>(null);
  const gotoMenuRef = useRef<HTMLDetailsElement>(null);
  const gotoMenuButtonRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const cancelScheduledSearchRef = useRef<(() => void) | null>(null);
  const pendingReferenceNumberingStatusRef = useRef<{ alignmentId: string; message: string } | null>(null);
  const explicitlySelectedTemplateIdRef = useRef<string | null>(null);
  const previousActiveAlignmentIdRef = useRef(activeAlignment?.id ?? null);
  // Latest visible column window reported by the matrix, for "Visible view" export.
  const visibleColumnsRef = useRef<MsaVisibleColumnWindow | null>(null);
  const handleVisibleColumnsChange = useCallback((range: MsaVisibleColumnWindow) => {
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
    const nextAlignmentId = activeAlignment?.id ?? null;
    const alignmentChanged = previousActiveAlignmentIdRef.current !== nextAlignmentId;
    previousActiveAlignmentIdRef.current = nextAlignmentId;
    setReferenceRowId(activeAlignment?.referenceRowId ?? activeAlignment?.rows[0]?.id ?? '');
    if (alignmentChanged) {
      setDifferenceIndex(-1);
      setDifferencesOpen(false);
      setJumpColumn(null);
      setJumpRowId(null);
    }
    setColumnDraft('');
    setColumnError(null);
    setColumnStatus('');
    setReferenceNumberingRowDraft(activeAlignment?.referenceNumbering?.rowId ?? activeAlignment?.referenceRowId ?? activeAlignment?.rows[0]?.id ?? '');
    setFirstResiduePositionDraft(String(activeAlignment?.referenceNumbering?.firstResiduePosition ?? 1));
    setReferenceNumberingError(null);
    const pendingNumberingStatus = pendingReferenceNumberingStatusRef.current;
    setReferenceNumberingStatus(
      pendingNumberingStatus && activeAlignment && pendingNumberingStatus.alignmentId === activeAlignment.id
        ? pendingNumberingStatus.message
        : '',
    );
    pendingReferenceNumberingStatusRef.current = null;
    setPendingDeleteId(null);
    // Drop any stale visible window from the previous alignment; the matrix
    // reports a fresh range on mount (undefined until then falls back to whole).
    visibleColumnsRef.current = null;
  }, [activeAlignment]);

  // Only the matrix reports a visible column window, but Export now lives in the
  // toolbar and is offered in every mode. Without this, leaving the Viewer would
  // leave the last window behind, and "Image · Visible view" from Traces or Text
  // would silently export columns the user is no longer looking at. Clearing it
  // falls through to the whole-alignment path.
  useEffect(() => {
    if (displayMode !== 'viewer') visibleColumnsRef.current = null;
  }, [displayMode]);

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
  const activeTemplate = activeAlignment?.rows.find((row) => row.id === referenceRowId)
    ?? activeAlignment?.rows[0];
  const variantAlignment = useMemo(() => {
    if (!activeAlignment || activeAlignment.referenceRowId === referenceRowId) return activeAlignment;
    return { ...activeAlignment, referenceRowId };
  }, [activeAlignment, referenceRowId]);
  const variantResult = useMemo(
    () => variantAlignment
      ? computeMsaVariants(variantAlignment, { maxVariants: MSA_VARIANT_LIST_LIMIT, strictDifferences })
      : { variants: [], truncated: false },
    [strictDifferences, variantAlignment],
  );
  const variantSummary = useMemo(
    () => summarizeMsaVariants(variantResult.variants),
    [variantResult.variants],
  );
  const differences = useMemo(
    () => activeAlignment ? differenceColumns(activeAlignment, referenceRowId, strictDifferences) : [],
    [activeAlignment, referenceRowId, strictDifferences],
  );
  useEffect(() => {
    if (!activeAlignment) {
      differenceLandingScopeRef.current = null;
      return;
    }
    const scope = { alignmentId: activeAlignment.id, referenceRowId, strictDifferences };
    const previous = differenceLandingScopeRef.current;
    if (
      previous?.alignmentId === scope.alignmentId
      && previous.referenceRowId === scope.referenceRowId
      && previous.strictDifferences === scope.strictDifferences
    ) return;
    differenceLandingScopeRef.current = scope;
    if (differences.length === 0) {
      setDifferenceIndex(-1);
      return;
    }
    const openingAlignment = !previous || previous.alignmentId !== scope.alignmentId;
    if (openingAlignment && msaMatrixViewportSession.has(scope.alignmentId)) return;
    setDifferenceIndex(0);
    setJumpColumn(differences[0]);
    setJumpRowId(null);
    setJumpToken((token) => token + 1);
  }, [activeAlignment, differences, referenceRowId, strictDifferences]);
  const ambiguities = useMemo(
    () => activeAlignment ? ambiguousColumns(activeAlignment, referenceRowId, strictDifferences) : [],
    [activeAlignment, referenceRowId, strictDifferences],
  );
  const alphabetAnomalies = useMemo(
    () => (activeAlignment ? detectAlphabetAnomalies(activeAlignment.rows, activeAlignment.molecule) : []),
    [activeAlignment],
  );
  const searchDebounceMs = useMemo(
    () => activeAlignment ? resolveMsaSearchDebounceMs(activeAlignment.rows) : 0,
    [activeAlignment],
  );
  // Below the debounce threshold the scan is cheap, so run it during render and
  // let the result land in the same commit as the keystroke. Routing it through
  // the effect instead spent a paint in the pending state on every key: measured
  // on a 600-cell alignment, five keystrokes painted five "Searching" frames and
  // strobed the whole highlight layer off and back on each time.
  const immediateSearchResult = useMemo(
    () => (searchDebounceMs === 0 && activeAlignment && searchQuery.trim()
      ? findMsaMatches(activeAlignment.rows, searchQuery, { molecule: activeAlignment.molecule })
      : null),
    [activeAlignment, searchDebounceMs, searchQuery],
  );
  useEffect(() => {
    cancelScheduledSearchRef.current?.();
    cancelScheduledSearchRef.current = null;
    const alignment = activeAlignment ?? null;
    if (!alignment || !searchQuery.trim()) {
      setSettledSearch({ alignment, query: searchQuery, result: EMPTY_MSA_SEARCH_RESULT });
      return undefined;
    }
    if (searchDebounceMs === 0) return undefined;
    const cancel = scheduleMsaSearch(() => {
      const result = findMsaMatches(alignment.rows, searchQuery, { molecule: alignment.molecule });
      setSettledSearch({ alignment, query: searchQuery, result });
    }, searchDebounceMs);
    cancelScheduledSearchRef.current = cancel;
    return () => {
      cancel();
      if (cancelScheduledSearchRef.current === cancel) cancelScheduledSearchRef.current = null;
    };
  }, [activeAlignment, searchDebounceMs, searchQuery]);
  const searchHasQuery = Boolean(searchQuery.trim());
  const searchPending = searchHasQuery
    && immediateSearchResult === null
    && (settledSearch.alignment !== activeAlignment || settledSearch.query !== searchQuery);
  // Never present the previous query's matches while the current query is
  // waiting or scanning; the live status remains honest until the result settles.
  const searchResult = !searchHasQuery || searchPending
    ? EMPTY_MSA_SEARCH_RESULT
    : immediateSearchResult ?? settledSearch.result;
  const searchMatches = searchResult.matches;
  const activeSearchMatch = searchIndex >= 0 && searchMatches.length > 0
    ? searchMatches[Math.min(searchIndex, searchMatches.length - 1)] ?? null
    : null;
  const rowNameSearchCount = searchMatches.filter((match) => match.kind === 'row-name').length;
  const motifSearchCount = searchMatches.length - rowNameSearchCount;
  const runCurrentSearchImmediately = useCallback(() => {
    cancelScheduledSearchRef.current?.();
    cancelScheduledSearchRef.current = null;
    const alignment = activeAlignment ?? null;
    const result = alignment && searchQuery.trim()
      ? findMsaMatches(alignment.rows, searchQuery, { molecule: alignment.molecule })
      : EMPTY_MSA_SEARCH_RESULT;
    setSettledSearch({ alignment, query: searchQuery, result });
    return result;
  }, [activeAlignment, searchQuery]);
  // A new query starts unnavigated: matches highlight, but nothing is focused
  // until the user steps with Enter or the prev/next controls.
  useEffect(() => { setSearchIndex(-1); }, [searchQuery]);
  const conservedCount = activeAlignment?.conserved.filter(Boolean).length ?? 0;
  const conservedPct = activeAlignment && activeAlignment.alignmentLength > 0
    ? Math.round((conservedCount / activeAlignment.alignmentLength) * 100)
    : 0;
  const activeReferenceNumbering = activeAlignment?.referenceNumbering;
  const activeNumberingReference = activeReferenceNumbering
    ? activeAlignment?.rows.find((row) => row.id === activeReferenceNumbering.rowId)
    : undefined;
  const activeReferenceCoordinates = useMemo(
    () => (activeReferenceNumbering && activeNumberingReference
      ? referenceCoordinateLabels(activeNumberingReference.aligned, activeReferenceNumbering.firstResiduePosition)
      : null),
    [activeNumberingReference, activeReferenceNumbering],
  );
  const comparisonStats = activeTemplate
    ? (activeAlignment?.rows ?? [])
      .filter((row) => row.id !== activeTemplate.id)
      .map((row) => pairwiseRowStats(row.aligned, activeTemplate.aligned, activeAlignment?.molecule ?? 'dna', strictDifferences))
      .filter((stats) => stats.comparableColumns > 0)
    : [];
  const hasComparableRows = comparisonStats.length > 0;
  const avgIdentity = hasComparableRows
    ? comparisonStats.reduce((sum, stats) => sum + stats.identity, 0) / comparisonStats.length
    : null;
  const differenceNavigationDisabled = !hasComparableRows || differences.length === 0;
  // One phrasing in both states. Reading "717 differences" before stepping and
  // "Difference 1 of 717" after made the same control look like two controls.
  const differenceNavigationLabel = !hasComparableRows
    ? 'No comparable rows'
    : differenceIndex >= 0
      ? `Difference ${differenceIndex + 1} of ${differences.length}`
      : `Difference — of ${differences.length}`;
  // Reserve the widest label this alignment can produce. The counter gains
  // digits as you step, and a box that grows with it walks the "next" button
  // out from under the cursor clicking it.
  const differenceNavigationWidth = Math.max(
    'No comparable rows'.length,
    `Difference ${differences.length} of ${differences.length}`.length,
  );
  const textContent = activeAlignment ? formatAlignment(activeAlignment, textFormat) : '';
  const selectedExport = formatExtension(textFormat);
  const pickerLabels = useMemo(() => alignmentPickerLabels(alignments), [alignments]);
  // The template picker is a narrow control listing rows that often differ only
  // in their tail, so a shared prefix pushes the distinguishing text past the
  // ellipsis and every option renders alike. Strip it here too.
  const compareRowLabels = useMemo(() => {
    const rows = activeAlignment?.rows ?? [];
    const prefix = sharedNamePrefix(rows.map((row) => row.name)).trimEnd();
    return new Map(rows.map((row) => [row.id, withoutSharedPrefix(row.name, prefix)]));
  }, [activeAlignment]);
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
      // Keep the default failure state and show the bounded recovery message.
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
      columns: viewWindow?.slots,
      cellWidth: Math.max(11, Math.round(imageFontSize * 0.95)),
      cellHeight: Math.round(imageFontSize * 1.55) + 4,
      fontSize: imageFontSize,
    });
    const rows = imageExportRows(activeAlignment, referenceRowId);
    const title = activeAlignment.name;
    // Mirror what the matrix paints rather than the scheme alone. The export used
    // to read only `colorScheme`, so turning "Residue colors" off changed nothing
    // about the image — and because the scheme select is disabled while colours
    // are off, the saved file was coloured by a setting the UI was preventing the
    // user from inspecting. The exception is the same one the matrix makes: when
    // cells are too narrow to carry glyphs, colour is the only thing left holding
    // the sequence, so a monochrome birdseye would export a blank rectangle. In
    // that case the matrix falls back to the automatic tone scheme, not to the
    // user's stored one, so this does too.
    const exportScheme: MsaColorScheme | null = colorMode === 'residue'
      ? colorScheme
      : layout.drawLetters ? null : 'auto';
    try {
      if (format === 'svg') {
        const svg = renderAlignmentImageSvg(rows, activeAlignment.molecule, exportScheme, layout, title);
        const filename = safeAlignmentFilename(activeAlignment, 'svg');
        downloadBlobFile(filename, new Blob([svg], { type: 'image/svg+xml' }));
        flashStatus('Image export', layout.clamped ? `Saved ${filename} (scaled to fit)` : `Saved ${filename}`, 'status');
        return;
      }
      const canvas = renderAlignmentImageCanvas(rows, activeAlignment.molecule, exportScheme, layout, title);
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
  }, [activeAlignment, colorMode, colorScheme, fontSize, imageScope, referenceRowId, flashStatus]);

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
      message: 'This result is not linked to workspace records. Switch to Aligned file to reuse its rows.',
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
        message: caught instanceof Error ? caught.message : 'The sequence files could not be imported. Check their format and contents.',
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
    setIntakeStatus({ message: result.message || 'No supported sequence records were found. Choose FASTA, GenBank, AB1/ABI, or raw text files.', tone: 'error' });
  }, [alignmentName, localTemplateId, onImportRecords, records]);

  const selectTemplate = useCallback((rowId: string) => {
    if (!activeAlignment?.rows.some((row) => row.id === rowId)) return;
    setReferenceRowId(rowId);
    setDifferenceIndex(-1);
    setJumpColumn(null);
    setColumnDraft('');
    setColumnError(null);
    setColumnStatus('');
    if (!activeAlignment.referenceNumbering) {
      setReferenceNumberingRowDraft(rowId);
      setReferenceNumberingError(null);
      setReferenceNumberingStatus('');
    }
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
      setIntakeStatus({ message: `Loaded ${file.name}. Review the molecule and engine, then import.`, tone: 'status' });
      setError(null);
    } catch {
      setError('The alignment file could not be read. Check the file and try again.');
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

  const jumpDifference = useCallback((direction: -1 | 1) => {
    if (differenceNavigationDisabled) return;
    // Stepping back off the front returns to the neutral "— of N" state rather
    // than teleporting to the far end. Both ends used to wrap by modular
    // arithmetic with nothing said about it, so three Prev presses from the start
    // read "130 of 130" and threw the view to the opposite end of the alignment —
    // and Prev from neutral did the same, before the user had gone anywhere.
    // Forward still wraps, because there is no neutral state past the last one to
    // land on, and that wrap is at least announced by the counter returning to 1.
    if (direction < 0 && differenceIndex <= 0) {
      setDifferenceIndex(-1);
      setJumpColumn(null);
      setJumpRowId(null);
      return;
    }
    const nextIndex = differenceIndex < 0
      ? 0
      : (differenceIndex + direction + differences.length) % differences.length;
    const column = differences[nextIndex];
    setDifferenceIndex(nextIndex);
    setJumpColumn(column);
    setJumpRowId(null);
    setJumpToken((token) => token + 1);
    const rowId = matrixActiveCellRef.current?.rowId
      ?? activeAlignment?.referenceRowId
      ?? activeAlignment?.rows[0]?.id;
    if (rowId) {
      setMatrixFocusRequest((request) => ({ rowId, column, focus: false, token: (request?.token ?? 0) + 1 }));
    }
  }, [activeAlignment, differenceIndex, differenceNavigationDisabled, differences]);

  useEffect(() => {
    if (!activeAlignment || displayMode !== 'viewer') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isMsaShortcutTextTarget(event.target)) return;
      const key = event.key.toLocaleLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && (key === '/' || key === 'n' || key === 'p')) {
        event.preventDefault();
        if (key === '/') searchInputRef.current?.focus();
        else jumpDifference(key === 'n' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeAlignment, displayMode, jumpDifference]);

  const jumpToRowDifference = useCallback((rowId: string, column: number) => {
    setDifferenceIndex(-1);
    setJumpColumn(column);
    setJumpRowId(rowId);
    setJumpToken((token) => token + 1);
    setMatrixFocusRequest((request) => ({ rowId, column, focus: false, token: (request?.token ?? 0) + 1 }));
  }, []);

  const jumpToVariant = useCallback((variant: MsaVariant) => {
    // Variants retain the full-alignment zero-based column. Hand that coordinate
    // straight to both navigation channels: filtered windows are only a view and
    // must never change the scientific address of the selected cell.
    setDifferenceIndex(differences.indexOf(variant.column));
    setJumpColumn(variant.column);
    setJumpRowId(variant.rowId);
    setJumpToken((token) => token + 1);
    setMatrixFocusRequest((request) => ({
      rowId: variant.rowId,
      column: variant.column,
      focus: true,
      token: (request?.token ?? 0) + 1,
    }));
    setDifferencesOpen(false);
    if (displayMode !== 'viewer') updateViewPreferences({ displayMode: 'viewer' });
  }, [differences, displayMode, updateViewPreferences]);

  const goToSearchMatch = useCallback((index: number, matches: readonly MsaSearchMatch[] = searchMatches) => {
    const count = matches.length;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    const match = matches[next];
    const matchColumn = match.kind === 'row-name'
      ? differences[0] ?? match.startColumn
      : match.columns[Math.floor(match.columns.length / 2)] ?? match.startColumn;
    setSearchIndex(next);
    setDifferenceIndex(-1);
    // Centre on an actual matched residue column, not the midpoint between the
    // endpoints — a gap-spanning match's midpoint can be an unrelated column.
    setJumpColumn(matchColumn);
    setJumpRowId(match.rowId);
    setJumpToken((token) => token + 1);
    setMatrixFocusRequest((request) => ({ rowId: match.rowId, column: matchColumn, focus: true, token: (request?.token ?? 0) + 1 }));
  }, [differences, searchMatches]);

  const stepSearch = useCallback((direction: 1 | -1) => {
    const matches = searchPending ? runCurrentSearchImmediately().matches : searchMatches;
    if (matches.length === 0) return;
    // Enter during the debounce belongs to the newly typed query, so it starts
    // that result set rather than carrying an index over from the prior query.
    if (searchPending || searchIndex < 0) goToSearchMatch(direction === 1 ? 0 : matches.length - 1, matches);
    else goToSearchMatch(searchIndex + direction, matches);
  }, [goToSearchMatch, runCurrentSearchImmediately, searchIndex, searchMatches, searchPending]);

  const goToCoordinate = () => {
    if (!activeAlignment) return;
    const normalized = columnDraft.trim();
    const template = activeAlignment.rows.find((row) => row.id === referenceRowId) ?? activeAlignment.rows[0];
    const requested = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
    let column: number | null;
    if (coordinateSystem === 'alignment') {
      const maximum = activeAlignment.alignmentLength;
      if (!Number.isInteger(requested) || requested < 1 || requested > maximum) {
        setColumnError(`Enter a whole column from 1 to ${maximum.toLocaleString()}.`);
        setColumnStatus('');
        return;
      }
      column = requested - 1;
    } else if (activeReferenceCoordinates) {
      column = parseReferenceCoordinateColumn(normalized, activeReferenceCoordinates);
      if (column === null) {
        setColumnError('Enter a reference position present in this alignment, such as 101 or 101A.');
        setColumnStatus('');
        return;
      }
    } else {
      const maximum = template?.aligned.replace(/-/g, '').length ?? 0;
      if (!Number.isInteger(requested) || requested < 1 || requested > maximum) {
        setColumnError(`Enter a whole template position from 1 to ${maximum.toLocaleString()}.`);
        setColumnStatus('');
        return;
      }
      column = templatePositionCoordinates(template?.aligned ?? '').findIndex((position) => position === requested);
    }
    if (column === null || column < 0) {
      setColumnError(`Template position ${requested.toLocaleString()} could not be mapped in this alignment.`);
      setColumnStatus('');
      return;
    }
    setColumnError(null);
    setDifferenceIndex(-1);
    setJumpColumn(column);
    setJumpRowId(null);
    setJumpToken((token) => token + 1);
    const rowId = matrixActiveCellRef.current?.rowId ?? template?.id;
    if (rowId) {
      setMatrixFocusRequest((request) => ({ rowId, column, focus: false, token: (request?.token ?? 0) + 1 }));
    }
    setColumnStatus(coordinateSystem === 'alignment'
      ? `Alignment column ${requested.toLocaleString()} shown.`
      : activeReferenceCoordinates
        ? `Reference position ${activeReferenceCoordinates[column].label} in ${activeNumberingReference?.name ?? 'reference'} shown at alignment column ${(column + 1).toLocaleString()}.`
        : `Template position ${requested.toLocaleString()} in ${template?.name ?? 'template'} shown at alignment column ${(column + 1).toLocaleString()}.`);
    // Deliberately does NOT close the menu. The jump issues no focus request, so
    // nothing dismisses the panel and it stays over the stats row it just
    // changed — which reads like an oversight until you try closing it: looking
    // up a run of positions is the normal use of this box, and auto-close makes
    // every position after the first cost a reopen. The residues themselves are
    // below the panel, so what it covers is re-readable metadata. Staying open
    // is the cheaper of the two costs.
  };

  // The saved result that is this alignment in the numbering state asked for, if
  // the session already holds one. Both buttons used to save unconditionally,
  // which made "Use plain 1-based" a third result rather than a way back to the
  // first: three round trips left seven results named up to "REVIEW 2 2 2 2 2 2".
  // Reopening the state the user already has keeps one result per distinct
  // numbering, which is what "save as a new session result" was always meant to
  // mean.
  const savedResultWithNumbering = (numbering: ArtifactAlignmentReferenceNumbering | undefined) => (
    activeAlignment
      ? alignments.find((candidate) => (
        candidate.id !== activeAlignment.id
        && sameAlignmentApartFromNumbering(candidate, activeAlignment)
        && sameReferenceNumbering(candidate.referenceNumbering, numbering)
      )) ?? null
      : null
  );

  const openSavedResult = (alignment: ArtifactAlignment, message: string) => {
    pendingReferenceNumberingStatusRef.current = { alignmentId: alignment.id, message };
    setReferenceNumberingError(null);
    setReferenceNumberingStatus(message);
    onActiveAlignmentChange(alignment.id);
  };

  const applyReferenceNumbering = () => {
    if (!activeAlignment) return;
    const numberingRow = activeAlignment.rows.find((row) => row.id === referenceNumberingRowDraft);
    const normalizedPosition = firstResiduePositionDraft.trim();
    const firstResiduePosition = /^[1-9]\d*$/.test(normalizedPosition)
      ? Number(normalizedPosition)
      : Number.NaN;
    if (!numberingRow) {
      setReferenceNumberingError('Choose a reference row from this alignment.');
      setReferenceNumberingStatus('');
      return;
    }
    const residueCount = numberingRow.aligned.replace(/[-.]/g, '').length;
    if (
      !Number.isSafeInteger(firstResiduePosition)
      || firstResiduePosition < 1
      || !Number.isSafeInteger(firstResiduePosition + residueCount - 1)
    ) {
      setReferenceNumberingError('Enter a positive whole number within the supported coordinate range.');
      setReferenceNumberingStatus('');
      return;
    }
    if (
      activeAlignment.referenceNumbering?.rowId === numberingRow.id
      && activeAlignment.referenceNumbering.firstResiduePosition === firstResiduePosition
    ) {
      setReferenceNumberingError(null);
      setReferenceNumberingStatus('Reference numbering is already applied.');
      return;
    }
    const numbering = { rowId: numberingRow.id, firstResiduePosition };
    const alreadySaved = savedResultWithNumbering(numbering);
    if (alreadySaved) {
      openSavedResult(alreadySaved, `Opened “${alreadySaved.name}”, the saved result that already uses this numbering.`);
      return;
    }
    const successMessage = 'Reference numbering saved as a new session result and opened.';
    try {
      const saved = onSaveAlignment({ ...activeAlignment, referenceNumbering: numbering });
      pendingReferenceNumberingStatusRef.current = { alignmentId: saved.id, message: successMessage };
      setReferenceNumberingError(null);
      setReferenceNumberingStatus(successMessage);
      onActiveAlignmentChange(saved.id);
    } catch (caught) {
      setReferenceNumberingError(caught instanceof Error ? caught.message : 'Reference numbering could not be saved.');
      setReferenceNumberingStatus('');
    }
  };

  const clearReferenceNumbering = () => {
    if (!activeAlignment?.referenceNumbering) return;
    const plainResult = savedResultWithNumbering(undefined);
    if (plainResult) {
      openSavedResult(plainResult, `Reopened “${plainResult.name}”, which is this alignment on plain 1-based numbering.`);
      return;
    }
    const plainAlignment = { ...activeAlignment };
    delete plainAlignment.referenceNumbering;
    const successMessage = 'Plain 1-based numbering saved as a new session result and opened.';
    try {
      const saved = onSaveAlignment(plainAlignment);
      pendingReferenceNumberingStatusRef.current = { alignmentId: saved.id, message: successMessage };
      setReferenceNumberingError(null);
      setReferenceNumberingStatus(successMessage);
      onActiveAlignmentChange(saved.id);
    } catch (caught) {
      setReferenceNumberingError(caught instanceof Error ? caught.message : 'Plain numbering could not be saved.');
      setReferenceNumberingStatus('');
    }
  };

  const resetAlignmentView = useCallback(() => {
    // Everything about how the alignment is DRAWN goes back to its default, which
    // is what the button offers. Two stored preferences are deliberately carried
    // through rather than reset, because neither describes the drawing:
    // `textFormat` decides the bytes Copy and Download write, and resetting it
    // silently changed a chosen export format; `displayMode` is which pane is
    // open, and resetting it threw a user reading the Text pane back into the
    // Viewer. Both controls live outside the View menu this button sits in.
    onViewPreferencesChange({
      ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
      displayMode: viewPreferences.displayMode,
      textFormat: viewPreferences.textFormat,
    });
    setDifferenceIndex(-1);
    setJumpColumn(null);
    setCoordinateSystem('alignment');
    setColumnDraft('');
    setColumnError(null);
    setColumnStatus('');
    setViewResetToken((token) => token + 1);
    setViewResetStatus('Alignment view reset. The result, template, and export format are unchanged.');
  }, [onViewPreferencesChange, viewPreferences.displayMode, viewPreferences.textFormat]);

  const closeViewMenu = useDismissableMenu(viewMenuOpen, setViewMenuOpen, viewMenuRef, viewMenuButtonRef);
  const closeExportMenu = useDismissableMenu(exportMenuOpen, setExportMenuOpen, exportMenuRef, exportMenuButtonRef);
  const closeGotoMenu = useDismissableMenu(gotoMenuOpen, setGotoMenuOpen, gotoMenuRef, gotoMenuButtonRef);

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

  const activeComparison = activeAlignment ? alignmentComparisonOf(activeAlignment) : null;

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
        /* Once a result exists the toolbar's "Edit inputs" button is the way in,
           so this banner is redundant chrome; it only re-appears while open. */
        data-redundant={activeAlignment && !sourceOpen ? 'true' : undefined}
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
                      ? `Estimated work exceeds the browser limit at ${Math.round(workEstimate / 1_000_000).toLocaleString()} million comparison cells. Import an aligned file.`
                      : `Estimated work: ${Math.max(1, Math.round(workEstimate / 1_000_000)).toLocaleString()} million comparison cells`
                    : `Select 2–${ARTIFACT_MSA_MAX_LOCAL_SEQUENCES} records of one molecule type`}
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
                    <strong>External alignment input</strong>
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
                    <option value="imported">Other or unknown</option>
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
                <span className="motif-cs-muted">Rows must already be aligned in FASTA or CLUSTAL format.</span>
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
            {/* The engine chip used to sit here repeating what the Provenance
                summary one row below already says — same label, same version,
                same fallback note — and it cost 134px of a row that had none to
                spare. Provenance says strictly more (it adds how the engine was
                executed), so nothing is lost by letting it be the one voice. */}
            <button
              className="motif-cs-mini-button motif-cs-msa-edit-inputs"
              type="button"
              data-testid="msa-edit-inputs"
              onClick={revealSourceSettings}
              aria-controls="motif-cs-msa-source-body"
              aria-label="Edit inputs"
              title="Change records, template, or alignment source"
            >
              <FilePenLine size={13} strokeWidth={2.1} aria-hidden="true" />
              <span>Edit inputs</span>
            </button>
            <div className="motif-cs-msa-header-meta" data-testid="msa-stats-bar">
              <span><strong>{activeAlignment.rows.length}</strong> rows</span>
              <span><strong>{activeAlignment.alignmentLength.toLocaleString()}</strong> columns</span>
              <details
                className="motif-cs-msa-provenance"
                data-testid="msa-provenance"
                data-fallback={activeComparison?.fallback || activeAlignment.engine.usedFallback || undefined}
              >
                <summary
                  aria-label={`Provenance: ${activeAlignment.engine.label}${activeAlignment.engine.version ? ` ${activeAlignment.engine.version}` : ''}`}
                  title="Provenance"
                >
                  <Info size={13} aria-hidden="true" />
                  <span className="motif-cs-visually-hidden">
                    Provenance · {activeAlignment.engine.label}{activeAlignment.engine.version ? ` ${activeAlignment.engine.version}` : ''}
                    {activeAlignment.engine.usedFallback
                      ? ' · fallback: Motif browser preview'
                      : activeComparison?.fallback
                        ? ' · fallback: bounded comparison route'
                        : ` · ${engineModeLabel(activeAlignment.engine.mode)}`}
                  </span>
                </summary>
                <dl>
                  <div><dt>Conserved</dt><dd><strong>{conservedPct}%</strong> conserved</dd></div>
                  <div><dt>Average to template</dt><dd><strong>{avgIdentity === null ? 'N/A' : `${formatIdentity(avgIdentity)}%`}</strong> avg to template</dd></div>
                  <div><dt>Columns differ from template</dt><dd><strong>{differences.length.toLocaleString()}</strong> columns differ from template</dd></div>
                  {ambiguities.length > 0 ? (
                    <div><dt>Compatible calls</dt><dd><span data-testid="msa-ambiguous-count"><strong>{ambiguities.length.toLocaleString()}</strong> compatible</span></dd></div>
                  ) : null}
                  <div><dt>Engine</dt><dd>{activeAlignment.engine.label}{activeAlignment.engine.version ? ` ${activeAlignment.engine.version}` : ''}</dd></div>
                  <div><dt>Execution</dt><dd>{engineModeLabel(activeAlignment.engine.mode)}</dd></div>
                  {activeComparison ? <div><dt>Method</dt><dd>{activeComparison.method}</dd></div> : null}
                  {activeComparison ? <div><dt>Algorithm</dt><dd>{activeComparison.algorithm}</dd></div> : null}
                  {activeComparison?.fallback || activeAlignment.engine.usedFallback ? <div><dt>Fallback</dt><dd>{activeAlignment.engine.usedFallback ? 'The requested engine was not used; Motif local browser preview produced this alignment.' : 'The primary comparison route was not used; the recorded bounded route produced these aligned rows.'}</dd></div> : null}
                  {activeComparison?.warnings.length ? <div><dt>Warnings</dt><dd><ul>{activeComparison.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></dd></div> : null}
                  {activeAlignment.engine.parameters?.length ? <div><dt>Parameters</dt><dd><code>{activeAlignment.engine.parameters.join(' ')}</code></dd></div> : null}
                  {formatCreatedAt(activeAlignment.createdAt) ? <div><dt>Created</dt><dd><time dateTime={activeAlignment.createdAt}>{formatCreatedAt(activeAlignment.createdAt)}</time></dd></div> : null}
                  {activeAlignment.outputSha256 ? <div><dt>Output SHA-256</dt><dd><code title={activeAlignment.outputSha256}>{shortHash(activeAlignment.outputSha256)}</code></dd></div> : null}
                  {activeAlignment.provenance?.executable ? <div><dt>Executable</dt><dd><code>{activeAlignment.provenance.executable}</code>{activeAlignment.provenance.executableSource ? ` · ${activeAlignment.provenance.executableSource}` : ''}</dd></div> : null}
                  {activeAlignment.provenance?.executableSha256 ? <div><dt>Executable SHA-256</dt><dd><code title={activeAlignment.provenance.executableSha256}>{shortHash(activeAlignment.provenance.executableSha256)}</code></dd></div> : null}
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
            </div>
            <div className="motif-cs-msa-toolbar-spacer" />
            <div className="motif-cs-segmented" role="group" aria-label="Alignment presentation">
              <button type="button" data-active={displayMode === 'viewer' || undefined} aria-pressed={displayMode === 'viewer'} onClick={() => updateViewPreferences({ displayMode: 'viewer' })}>Viewer</button>
              {traceAvailable ? <button type="button" data-active={displayMode === 'trace' || undefined} aria-pressed={displayMode === 'trace'} onClick={() => updateViewPreferences({ displayMode: 'trace' })}>Traces</button> : null}
              <button type="button" data-active={displayMode === 'text' || undefined} aria-pressed={displayMode === 'text'} onClick={() => updateViewPreferences({ displayMode: 'text' })}>Text</button>
            </div>
            {/* Jumping to a coordinate is a deliberate "take me there" action, not
                something read while scanning residues, and as a permanent form it
                was the control that forced the row below onto a second line. */}
            {displayMode === 'viewer' ? (
              <details
                ref={gotoMenuRef}
                className="motif-cs-msa-goto-menu"
                // Static, and read together with the element's own `open`: the
                // panel's data-motif-cs-escape-scope below cannot be trusted for
                // the ~52ms between the browser opening this menu and React
                // hearing about it, which is long enough for the host window to
                // take an Escape meant for the menu and close itself.
                data-motif-cs-escape-scope-when-open="true"
                open={gotoMenuOpen}
                onToggle={(event) => setGotoMenuOpen(event.currentTarget.open)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  closeGotoMenu();
                }}
              >
                <summary ref={gotoMenuButtonRef} data-testid="msa-goto-menu-button" aria-label="Go to a position in the alignment" aria-expanded={gotoMenuOpen}>
                  <Crosshair size={13} strokeWidth={2.1} aria-hidden="true" />
                  <span>{coordinateSystem === 'alignment'
                    ? 'Go to'
                    : activeReferenceCoordinates ? 'Go to \u00b7 reference' : 'Go to \u00b7 template'}</span>
                  <ChevronDown size={12} aria-hidden="true" />
                </summary>
                <div className="motif-cs-msa-goto-menu-panel" data-testid="msa-goto-menu" data-motif-cs-escape-scope={gotoMenuOpen || undefined}>
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
                          <option value="template">{activeReferenceCoordinates ? 'Reference position' : 'Template position'}</option>
                        </select>
                      </label>
                      <label>
                        <span className="motif-cs-visually-hidden">{coordinateSystem === 'alignment' ? 'Alignment column' : activeReferenceCoordinates ? 'Reference position' : 'Template position'}</span>
                        <input
                          data-testid="msa-coordinate-input"
                          type={coordinateSystem === 'template' && activeReferenceCoordinates ? 'text' : 'number'}
                          name="alignment-coordinate"
                          autoComplete="off"
                          inputMode={coordinateSystem === 'template' && activeReferenceCoordinates ? 'text' : 'numeric'}
                          min={coordinateSystem === 'template' && activeReferenceCoordinates ? undefined : 1}
                          max={coordinateSystem === 'template' && activeReferenceCoordinates
                            ? undefined
                            : coordinateSystem === 'alignment'
                              ? activeAlignment.alignmentLength
                              : activeTemplate?.aligned.replace(/-/g, '').length ?? 0}
                          step={coordinateSystem === 'template' && activeReferenceCoordinates ? undefined : 1}
                          pattern={coordinateSystem === 'template' && activeReferenceCoordinates ? '[0-9]+[A-Za-z]*' : undefined}
                          placeholder={coordinateSystem === 'template' && activeReferenceCoordinates ? '101 or 101A' : undefined}
                          value={columnDraft}
                          onChange={(event) => {
                            setColumnDraft(event.target.value);
                            setColumnError(null);
                            setColumnStatus('');
                          }}
                          aria-label={coordinateSystem === 'alignment' ? 'Go to alignment column' : activeReferenceCoordinates ? 'Go to reference position' : 'Go to template position'}
                          aria-invalid={columnError ? true : undefined}
                          aria-describedby={columnError ? 'motif-cs-msa-column-error' : undefined}
                        />
                      </label>
                      <button className="motif-cs-mini-button" type="submit">Go</button>
                      {columnError ? <span id="motif-cs-msa-column-error" className="motif-cs-msa-column-error" role="alert">{columnError}</span> : null}
                      {/* Safe inside the panel only because the panel stays open
                          after a jump (see goToCoordinate). Anyone adding
                          auto-close must move this out first, or the success is
                          announced into a closed <details> and never heard. */}
                      <span className="motif-cs-visually-hidden" role="status" aria-live="polite">{columnStatus}</span>
                    </form>
                </div>
              </details>
            ) : null}
            <details
              ref={viewMenuRef}
              className="motif-cs-msa-view-menu"
              data-motif-cs-escape-scope-when-open="true"
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
                  ['showTemplateAxis', activeReferenceCoordinates ? 'Reference axis' : 'Template axis'],
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
                {/* Row order is a display preference like the tracks above it, and
                    it is set once and left alone — it does not earn 155px of the
                    control row it used to sit in. */}
                <label className="motif-cs-msa-view-select">
                  <span>Sort</span>
                  <select
                    data-testid="msa-row-sort-toolbar"
                    aria-label="Sort"
                    value={sortMode}
                    onChange={(event) => updateViewPreferences({ sortMode: event.target.value as RowSortMode })}
                  >
                    <option value="original">Original order</option>
                    <option value="name">Name</option>
                    <option value="identity">Identity</option>
                    <option value="mismatches">Mismatches</option>
                    <option value="length">Ungapped length</option>
                  </select>
                </label>
                <label className="motif-cs-msa-view-select">
                  <span>Flanking columns</span>
                  <input
                    className="motif-cs-input"
                    data-testid="msa-column-filter-context"
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    value={columnFilterContext}
                    aria-label="Flanking columns around differences"
                    onChange={(event) => updateViewPreferences({ columnFilterContext: Number(event.target.value) })}
                  />
                </label>
                <label>
                  <input
                    data-testid="msa-residue-colors-toolbar"
                    type="checkbox"
                    checked={colorMode === 'residue'}
                    onChange={(event) => updateViewPreferences({ colorMode: event.target.checked ? 'residue' : 'mono' })}
                  />
                  <span>Residue colors</span>
                </label>
                <label className="motif-cs-msa-view-select">
                  <span>Color scheme</span>
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
                <label title="When off, compatible IUPAC ambiguity codes are shown separately from hard differences.">
                  <input
                    type="checkbox"
                    checked={strictDifferences}
                    onChange={(event) => updateViewPreferences({ strictDifferences: event.target.checked })}
                  />
                  <span>Strict differences</span>
                </label>
                <div className="motif-cs-msa-reference-numbering" data-testid="msa-reference-numbering-editor" data-active={activeReferenceCoordinates ? true : undefined}>
                  <div className="motif-cs-msa-reference-numbering-heading">
                    <strong>Reference numbering</strong>
                    <span>{activeReferenceCoordinates ? 'On' : 'Plain 1-based'}</span>
                  </div>
                  <label className="motif-cs-msa-view-select">
                    <span>Reference row</span>
                    <select
                      value={referenceNumberingRowDraft}
                      aria-label="Numbering reference row"
                      onChange={(event) => {
                        setReferenceNumberingRowDraft(event.target.value);
                        setReferenceNumberingError(null);
                        setReferenceNumberingStatus('');
                      }}
                    >
                      {activeAlignment.rows.map((row) => <option key={row.id} value={row.id} title={row.name}>{compareRowLabels.get(row.id) ?? row.name}</option>)}
                    </select>
                  </label>
                  <label className="motif-cs-msa-reference-numbering-position">
                    <span>First residue position</span>
                    <input
                      className="motif-cs-input"
                      data-testid="msa-reference-numbering-position"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={firstResiduePositionDraft}
                      aria-invalid={referenceNumberingError ? true : undefined}
                      aria-describedby="motif-cs-msa-reference-numbering-convention"
                      onChange={(event) => {
                        setFirstResiduePositionDraft(event.target.value);
                        setReferenceNumberingError(null);
                        setReferenceNumberingStatus('');
                      }}
                    />
                  </label>
                  <small id="motif-cs-msa-reference-numbering-convention">Gap columns append A…Z, then AA…, to the preceding position. Leading gaps use the position before the first residue. Applying changes saves a new session result.</small>
                  <div className="motif-cs-msa-reference-numbering-actions">
                    <button className="motif-cs-mini-button" data-testid="msa-apply-reference-numbering" type="button" onClick={applyReferenceNumbering}>Apply reference numbering</button>
                    <button className="motif-cs-mini-button" data-testid="msa-clear-reference-numbering" type="button" disabled={!activeAlignment.referenceNumbering} onClick={clearReferenceNumbering}>Use plain 1-based</button>
                  </div>
                  {referenceNumberingError ? <span className="motif-cs-msa-reference-numbering-error" role="alert">{referenceNumberingError}</span> : null}
                  <span className="motif-cs-msa-reference-numbering-status" data-empty={!referenceNumberingStatus || undefined} role="status" aria-live="polite">{referenceNumberingStatus}</span>
                </div>
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
            {/* Export used to be a permanent 49px strip under the alignment, most
                of it a sentence of guidance nobody rereads. It is an end-of-look
                action, so it belongs beside the other toolbar menus. */}
            <details
              ref={exportMenuRef}
              className="motif-cs-msa-export-menu"
              data-motif-cs-escape-scope-when-open="true"
              open={exportMenuOpen}
              onToggle={(event) => setExportMenuOpen(event.currentTarget.open)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                closeExportMenu();
              }}
            >
              <summary ref={exportMenuButtonRef} data-testid="msa-export-menu-button" aria-label="Export alignment" aria-expanded={exportMenuOpen}>
                <Download size={13} strokeWidth={2.1} aria-hidden="true" />
                <span>Export</span>
                <ChevronDown size={12} aria-hidden="true" />
              </summary>
              <div className="motif-cs-msa-export-row motif-cs-msa-export-menu-panel" data-testid="msa-export-menu" data-motif-cs-escape-scope={exportMenuOpen || undefined}>
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
                <span className="motif-cs-muted">Saved for this session. Export a workspace backup before reloading. To restore it, unzip the export and choose inventory.json in Settings. {activeAlignment.note}</span>
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

          {alphabetAnomalies.length > 0 && dismissedAlphabetWarningId !== activeAlignment.id ? (
            <div
              className="motif-cs-msa-alphabet-warning"
              data-testid="msa-alphabet-warning"
              role="status"
              aria-live="polite"
            >
              <span>
                <strong>Check molecule type.</strong>{' '}
                {alphabetAnomalies.length} of {activeAlignment.rows.length} sequences contain only nucleotide letters but are displayed as protein.
              </span>
              <button
                className="motif-cs-mini-button"
                type="button"
                aria-label="Dismiss molecule type warning"
                onClick={() => setDismissedAlphabetWarningId(activeAlignment.id)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {displayMode === 'viewer' ? (
            <>
              <div className="motif-cs-msa-view-controls">
                <div className="motif-cs-segmented" role="group" aria-label="Alignment emphasis">
                  <button type="button" data-active={emphasis === 'differences' || undefined} aria-label="Differences" aria-pressed={emphasis === 'differences'} onClick={() => updateViewPreferences({ emphasis: 'differences' })}>
                    <span className="motif-cs-msa-emphasis-full">Differences</span><span className="motif-cs-msa-emphasis-short" aria-hidden="true">Diff</span>
                  </button>
                  <button type="button" data-active={emphasis === 'letters' || undefined} aria-label="All letters" aria-pressed={emphasis === 'letters'} onClick={() => updateViewPreferences({ emphasis: 'letters' })}>
                    <span className="motif-cs-msa-emphasis-full">All letters</span><span className="motif-cs-msa-emphasis-short" aria-hidden="true">All</span>
                  </button>
                </div>
                <button
                  type="button"
                  className="motif-cs-mini-button motif-cs-msa-column-filter-toggle"
                  data-testid="msa-column-filter-toggle"
                  data-active={columnFilter === 'differences' || undefined}
                  aria-pressed={columnFilter === 'differences'}
                  title={`Show only differing columns with ${columnFilterContext} flanking columns on each side`}
                  onClick={() => updateViewPreferences({ columnFilter: columnFilter === 'differences' ? 'all' : 'differences' })}
                >
                  Differing only
                </button>
                <label className="motif-cs-msa-reference-picker">
                  <span>Compare against</span>
                  <select value={referenceRowId} disabled={!hasComparableRows} onChange={(event) => selectTemplate(event.target.value)}>
                    {activeAlignment.rows.map((row) => <option key={row.id} value={row.id} title={row.name}>{compareRowLabels.get(row.id) ?? row.name}</option>)}
                  </select>
                </label>
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
                    ref={searchInputRef}
                    className="motif-cs-input motif-cs-msa-search-input"
                    data-testid="msa-search-input"
                    type="search"
                    name="alignment-search"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={MSA_MOTIF_SEARCH_MAX_QUERY_LENGTH}
                    value={searchQuery}
                    // Degenerate codes are honoured and nothing said so, which
                    // made a correct count look like a bug: typing ZZ into a
                    // protein alignment containing no literal Z returns every
                    // adjacent E/Q pair, and that is right. The rule is in the
                    // title rather than the placeholder because the box is 146px
                    // and every phrasing naming IUPAC needs 151px or more — a
                    // placeholder that says it and then clips says nothing.
                    placeholder="Find row or motif…"
                    title="Find a row name or residue motif (/ or Command/Control+F). Motifs are case-insensitive; IUPAC ambiguity codes match the residues they stand for."
                    aria-label="Find a row name or residue motif in the alignment"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') { event.preventDefault(); stepSearch(event.shiftKey ? -1 : 1); }
                      else if (event.key === 'Escape') {
                        // Escape has to hand focus back to the grid, not just empty
                        // the box. Leaving the caret here left every single-key
                        // shortcut dead — N and P for the next variable column, /
                        // to search again — because they are ignored while a text
                        // field has focus. The reader saw a finder they had already
                        // dismissed silently swallowing the next thing they typed.
                        event.preventDefault();
                        event.stopPropagation();
                        if (searchQuery) setSearchQuery('');
                        returnFocusToGrid();
                      }
                    }}
                  />
                  <span className="motif-cs-msa-search-count" data-testid="msa-search-count" role="status" aria-live="polite">
                    {searchQuery.trim()
                      ? searchPending
                        ? 'Searching…'
                          : searchMatches.length === 0
                          ? searchResult.truncated ? 'Search limit reached' : 'No matches'
                          // Before anything has been stepped to there is no
                          // current match, and a bare "13" beside a pair of
                          // step arrows reads as "match 13 of something". The
                          // noun says which number this is.
                          : searchIndex >= 0
                            ? `${Math.min(searchIndex, searchMatches.length - 1) + 1} of ${searchMatches.length.toLocaleString()}${searchResult.truncated ? '+' : ''} · ${activeSearchMatch?.kind === 'row-name' ? 'row name' : 'motif'}`
                            : rowNameSearchCount > 0 && motifSearchCount > 0
                              ? `${rowNameSearchCount.toLocaleString()} row name · ${motifSearchCount.toLocaleString()} motif${searchResult.truncated ? '+' : ''}`
                              : rowNameSearchCount > 0
                                ? `${rowNameSearchCount.toLocaleString()} row-name ${rowNameSearchCount === 1 ? 'match' : 'matches'}${searchResult.truncated ? '+' : ''}`
                                : `${motifSearchCount.toLocaleString()}${searchResult.truncated ? '+' : ''} motif ${motifSearchCount === 1 ? 'match' : 'matches'}`
                      : ''}
                  </span>
                  <button type="button" className="motif-cs-mini-button" data-testid="msa-search-prev" disabled={searchMatches.length === 0} onClick={() => stepSearch(-1)} aria-label="Previous match"><ChevronLeft size={13} /></button>
                  <button type="submit" className="motif-cs-mini-button" data-testid="msa-search-next" disabled={searchMatches.length === 0} aria-label="Next match"><ChevronRight size={13} /></button>
                </form>
              </div>
              {viewPreferences.showRowStatsPanel ? (
                <MsaRowStatsPanel
                  alignment={activeAlignment}
                  referenceRowId={referenceRowId}
                  sortMode={sortMode}
                  strictDifferences={strictDifferences}
                  onSortModeChange={(nextSortMode) => updateViewPreferences({ sortMode: nextSortMode })}
                  onJump={jumpToRowDifference}
                />
              ) : null}
              <div className="motif-cs-msa-differences-stage" data-testid="msa-differences-stage">
              {differencesOpen ? (
                <MsaDifferencesPane
                  variants={variantResult.variants}
                  summary={variantSummary}
                  truncated={variantResult.truncated}
                  templateName={activeTemplate?.name ?? 'template'}
                  rowLabels={compareRowLabels}
                  onClose={() => setDifferencesOpen(false)}
                  onJump={jumpToVariant}
                />
              ) : null}
              <AlignmentMatrix
                key={activeAlignment.id}
                alignment={activeAlignment}
                referenceRowId={referenceRowId}
                referenceCoordinates={activeReferenceCoordinates}
                emphasis={emphasis}
                colorMode={colorMode}
                colorScheme={colorScheme}
                shadeMode={shadeMode}
                fontSize={fontSize}
                zoom={zoom}
                columnFilter={columnFilter}
                columnFilterContext={columnFilterContext}
                differingColumns={differences}
                translationFrame={translationFrame}
                jumpColumn={jumpColumn}
                jumpToken={jumpToken}
                jumpRowId={jumpRowId}
                searchMatches={searchMatches}
                activeSearchMatch={activeSearchMatch}
                focusRequest={matrixFocusRequest}
                searchActive={Boolean(searchQuery)}
                sortMode={sortMode}
                strictDifferences={strictDifferences}
                visibility={matrixVisibility}
                resetToken={viewResetToken}
                onTemplateChange={selectTemplate}
                onCopy={copyFromViewer}
                onZoomChange={(next) => updateViewPreferences({ zoom: next })}
                onActiveCellChange={reportMatrixActiveCell}
                onVisibleColumnsChange={handleVisibleColumnsChange}
                footerNavigation={(
                  <MsaDifferenceNavigation
                    disabled={differenceNavigationDisabled}
                    label={differenceNavigationLabel}
                    labelWidth={differenceNavigationWidth}
                    open={differencesOpen}
                    onPrevious={() => jumpDifference(-1)}
                    onNext={() => jumpDifference(1)}
                    onToggle={() => setDifferencesOpen((open) => !open)}
                  />
                )}
              />
              </div>
            </>
          ) : displayMode === 'trace' ? (
            <>
              <div className="motif-cs-msa-view-controls motif-cs-msa-trace-controls">
                <label className="motif-cs-msa-reference-picker">
                  <span>Compare against</span>
                  <select value={referenceRowId} disabled={!hasComparableRows} onChange={(event) => selectTemplate(event.target.value)}>
                    {activeAlignment.rows.map((row) => <option key={row.id} value={row.id} title={row.name}>{compareRowLabels.get(row.id) ?? row.name}</option>)}
                  </select>
                </label>
                <MsaDifferenceNavigation
                  disabled={differenceNavigationDisabled}
                  label={differenceNavigationLabel}
                  labelWidth={differenceNavigationWidth}
                  open={differencesOpen}
                  onPrevious={() => jumpDifference(-1)}
                  onNext={() => jumpDifference(1)}
                  onToggle={() => setDifferencesOpen((open) => !open)}
                />
                <span className="motif-cs-muted">Click a call, drag the position slider, or use arrow keys inside the trace.</span>
              </div>
              <div className="motif-cs-msa-differences-stage motif-cs-msa-differences-stage-trace">
              {differencesOpen ? (
                <MsaDifferencesPane
                  variants={variantResult.variants}
                  summary={variantSummary}
                  truncated={variantResult.truncated}
                  templateName={activeTemplate?.name ?? 'template'}
                  rowLabels={compareRowLabels}
                  onClose={() => setDifferencesOpen(false)}
                  onJump={jumpToVariant}
                />
              ) : null}
              <ClaudeScienceSangerTraceViewer
                key={activeAlignment.id}
                alignment={activeAlignment}
                records={records}
                templateRowId={referenceRowId}
                jumpColumn={jumpColumn}
                jumpToken={jumpToken}
              />
              </div>
            </>
          ) : (
            <div className="motif-cs-msa-text-view" data-testid="msa-text-view">
              <textarea className="motif-cs-textarea" readOnly value={textContent} aria-label={`${selectedExport.label} alignment text`} />
            </div>
          )}
        </>
      ) : (
        <div className="motif-cs-msa-empty" data-testid="msa-empty-state">
          <strong>No alignment loaded</strong>
          <span>Select workspace records to align in the browser, or import an aligned FASTA or CLUSTAL file.</span>
        </div>
      )}
    </div>
  );
}
