import {
  useCallback,
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
  computeMsaColumnStats,
  createLocalArtifactAlignment,
  estimateLocalAlignmentWork,
  findMsaMotifMatches,
  formatAlignedFasta,
  formatClustal,
  formatConsensusFasta,
  moveRowId,
  msaShadeBucket,
  parseAlignmentText,
  residueColorKey,
  safeAlignmentFilename,
  selectionToColumnsText,
  selectionToFasta,
  selectionToUngappedFasta,
  serializeArtifactAlignment,
  summarizeSelectionColumns,
  translateAlignedRow,
  type ArtifactAlignment,
  type ArtifactMsaRecord,
  type MsaColorScheme,
  type MsaColumnStats,
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
  | 'showConservationHistogram' | 'showOccupancy' | 'showConsensus' | 'showTranslation' | 'showAminoAcidIndices'>;
type CoordinateSystem = 'alignment' | 'template';

const INPUT_FASTA_HEADER_MAX_LENGTH = 1_024;
const msaMatrixViewportSession = new Map<string, { left: number; top: number }>();

type PairwiseRowStats = {
  ungappedLength: number;
  mismatches: number;
  identity: number;
};

type AlignmentCoverage = { first: number; last: number } | null;

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

function differenceColumns(alignment: ArtifactAlignment, referenceRowId: string): number[] {
  const reference = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
  if (!reference) return [];
  const referenceCoverage = alignmentCoverage(reference.aligned);
  const rowCoverage = new Map(alignment.rows.map((row) => [row.id, alignmentCoverage(row.aligned)]));
  const columns: number[] = [];
  for (let column = 0; column < alignment.alignmentLength; column += 1) {
    if (alignment.gapOnly[column] || !coversColumn(referenceCoverage, column)) continue;
    if (alignment.rows.some((row) => (
      row.id !== reference.id
      && coversColumn(rowCoverage.get(row.id) ?? null, column)
      && row.aligned[column] !== reference.aligned[column]
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

function pairwiseRowStats(aligned: string, template: string): PairwiseRowStats {
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
    if (!coversColumn(rowCoverage, column) || !coversColumn(templateCoverage, column)) continue;
    if (symbol === '-' && templateSymbol === '-') continue;
    comparable += 1;
    if (symbol === templateSymbol) matches += 1;
    else mismatches += 1;
  }
  return {
    ungappedLength,
    mismatches,
    identity: comparable > 0 ? Math.round((matches / comparable) * 10_000) / 100 : 0,
  };
}

function formatIdentity(identity: number): string {
  return identity < 100 && identity >= 99.9 ? identity.toFixed(2) : identity.toFixed(1);
}

function mismatchOverviewBins(alignment: ArtifactAlignment, template: string, binCount: number): number[] {
  const bins = Array.from({ length: binCount }, () => 0);
  if (alignment.alignmentLength === 0 || binCount === 0) return bins;
  const templateCoverage = alignmentCoverage(template);
  const rowCoverage = alignment.rows.map((row) => alignmentCoverage(row.aligned));
  for (let column = 0; column < alignment.alignmentLength; column += 1) {
    if (!coversColumn(templateCoverage, column)) continue;
    const templateSymbol = template[column] ?? '-';
    let comparable = 0;
    let mismatches = 0;
    for (const [rowIndex, row] of alignment.rows.entries()) {
      if (!coversColumn(rowCoverage[rowIndex], column)) continue;
      const symbol = row.aligned[column] ?? '-';
      if (symbol === '-' && templateSymbol === '-') continue;
      comparable += 1;
      if (symbol !== templateSymbol) mismatches += 1;
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
type MatrixContextMenu = { x: number; y: number; column: number; rowId: string | null };
/** Live state while a row is being drag-reordered by its grip handle. */
type RowDragState = { id: string; fromIndex: number; overIndex: number; edge: 'before' | 'after' };

// Column density. The font-derived base cell width is scaled by the zoom
// preference (decoupled from font size); the result is clamped so cells never
// collapse to nothing or grow unreasonably. Below the legibility floor the
// viewer drops letters for a birdseye "blocks" rendering.
const MSA_BASE_CELL_MIN = 8;
const MSA_BASE_CELL_MAX = 15;
const MSA_CELL_MIN = 3;
const MSA_CELL_MAX = 30;
const MSA_LETTER_MIN = 6.5;

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
  sortMode,
  visibility,
  resetToken,
  onTemplateChange,
  onCopy,
  onZoomChange,
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
  sortMode: RowSortMode;
  visibility: MsaMatrixVisibility;
  resetToken: number;
  onTemplateChange: (rowId: string) => void;
  onCopy: (label: string, content: string) => Promise<boolean>;
  onZoomChange: (zoom: number) => void;
}) {
  const [viewportRef, viewportWidth] = useObservedWidth<HTMLDivElement>();
  const initialViewport = useMemo(() => msaMatrixViewportSession.get(alignment.id), [alignment.id]);
  const [scrollLeft, setScrollLeft] = useState(initialViewport?.left ?? 0);
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollLeftRef = useRef(initialViewport?.left ?? 0);
  const pendingScrollTopRef = useRef(initialViewport?.top ?? 0);
  const lastResetTokenRef = useRef(resetToken);
  const overviewDraggingRef = useRef(false);
  const [selection, setSelection] = useState<MatrixSelection | null>(null);
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null);
  const [contextMenu, setContextMenu] = useState<MatrixContextMenu | null>(null);
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
  const panThumbWidth = Math.max(
    36,
    Math.min(sequenceViewportWidth, sequenceViewportWidth * (sequenceViewportWidth / Math.max(sequenceViewportWidth, sequenceWidth))),
  );
  const template = alignment.rows.find((row) => row.id === referenceRowId) ?? alignment.rows[0];
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
    const originalIndex = new Map(alignment.rows.map((row, index) => [row.id, index]));
    const nonTemplateRows = alignment.rows.filter((row) => row.id !== template?.id);
    nonTemplateRows.sort((left, right) => {
      const leftStats = statsByRow.get(left.id)!;
      const rightStats = statsByRow.get(right.id)!;
      if (sortMode === 'name') return left.name.localeCompare(right.name, undefined, { numeric: true });
      if (sortMode === 'identity') return rightStats.identity - leftStats.identity || left.name.localeCompare(right.name, undefined, { numeric: true });
      if (sortMode === 'mismatches') return leftStats.mismatches - rightStats.mismatches || left.name.localeCompare(right.name, undefined, { numeric: true });
      return (originalIndex.get(left.id) ?? 0) - (originalIndex.get(right.id) ?? 0);
    });
    return template ? [template, ...nonTemplateRows] : nonTemplateRows;
  }, [alignment.rows, manualOrder, sortMode, statsByRow, template]);
  const allRowNames = useMemo(() => alignment.rows.map((row) => row.name), [alignment.rows]);
  const rowLabelsById = useMemo(() => new Map(alignment.rows.map((row) => [
    row.id,
    rowNameParts(row.name, allRowNames),
  ])), [alignment.rows, allRowNames]);
  const overviewBinCount = Math.min(512, Math.max(1, alignment.alignmentLength));
  const overviewBins = useMemo(
    () => mismatchOverviewBins(alignment, template?.aligned ?? '', overviewBinCount),
    [alignment, overviewBinCount, template],
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

  // Fit the whole alignment across the sequence viewport by solving for the zoom
  // that makes every column's base-width cell span the available width.
  const fitZoom = useCallback(() => {
    if (alignment.alignmentLength === 0) return;
    setZoom(sequenceViewportWidth / (alignment.alignmentLength * baseCellWidth));
  }, [alignment.alignmentLength, baseCellWidth, sequenceViewportWidth, setZoom]);

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
  }, []);

  const handleScroll = (left: number, top: number) => {
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

  const handleMatrixWheel = useCallback((event: WheelEvent) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? sequenceViewportWidth
        : 1;
    const horizontalDelta = (event.shiftKey ? event.deltaY : event.deltaX) * deltaScale;
    if (event.shiftKey || Math.abs(event.deltaX) > 0) {
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

  const handleMatrixKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
  };

  const columnStats = useMemo<MsaColumnStats[]>(() => computeMsaColumnStats(alignment.rows, alignment.molecule), [alignment.rows, alignment.molecule]);
  const explicitScheme = colorMode === 'residue' && colorScheme !== 'auto';
  const shadeByColumn = shadeMode === 'identity' || shadeMode === 'conservation';
  // Colour cells by auto residue tone when the user asked for residue colours,
  // or whenever letters are hidden in blocks view (so the mosaic stays legible).
  // An explicit scheme keeps its own data-color-key fills instead.
  const toneColored = !explicitScheme && (colorMode === 'residue' || blocks);

  const selectingRef = useRef(false);
  const rulerSelectingRef = useRef(false);
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

  const pointToCell = useCallback((clientX: number, clientY: number): HoverCell | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    // The sticky row-label gutter is not part of the sequence area.
    if (localX < labelWidth || localX > rect.width) return null;
    const column = Math.floor((localX - labelWidth + viewport.scrollLeft) / cellWidth);
    if (column < 0 || column >= alignment.alignmentLength) return null;
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const rowElement = target?.closest<HTMLElement>('[data-msa-row-index]');
    if (!rowElement) return null;
    const rowIndex = Number(rowElement.dataset.msaRowIndex);
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= orderedRows.length) return null;
    return { column, rowIndex, rowId: rowElement.dataset.msaRowId ?? '', clientX, clientY };
  }, [alignment.alignmentLength, cellWidth, labelWidth, orderedRows.length, viewportRef]);

  const columnFromClientX = useCallback((clientX: number): number | null => {
    const viewport = viewportRef.current;
    if (!viewport) return null;
    const rect = viewport.getBoundingClientRect();
    const localX = clientX - rect.left;
    if (localX < labelWidth || localX > rect.width) return null;
    const column = Math.floor((localX - labelWidth + viewport.scrollLeft) / cellWidth);
    return column >= 0 && column < alignment.alignmentLength ? column : null;
  }, [alignment.alignmentLength, cellWidth, labelWidth, viewportRef]);

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

  const handleGridPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const cell = pointToCell(event.clientX, event.clientY);
    if (!cell) return;
    event.preventDefault();
    setContextMenu(null);
    setHoverCell(null);
    if (!(event.shiftKey && selectionAnchorRef.current)) {
      selectionAnchorRef.current = { column: cell.column, rowIndex: cell.rowIndex };
    }
    applySelectionTo(cell);
    selectingRef.current = true;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  };

  const handleGridPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const cell = pointToCell(event.clientX, event.clientY);
    if (selectingRef.current) {
      if (cell) applySelectionTo(cell);
      return;
    }
    setHoverCell(cell);
  };

  const endSelectionDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectingRef.current) return;
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
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  };
  const handleRulerPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rulerSelectingRef.current) return;
    const column = columnFromClientX(event.clientX);
    const anchor = selectionAnchorRef.current;
    if (column == null || !anchor) return;
    setSelection({
      colStart: Math.min(anchor.column, column),
      colEnd: Math.max(anchor.column, column),
      rowStart: 0,
      rowEnd: Math.max(0, orderedRows.length - 1),
    });
  };
  const handleRulerPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rulerSelectingRef.current) return;
    rulerSelectingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const clearSelection = useCallback(() => {
    setSelection(null);
    selectionAnchorRef.current = null;
    setContextMenu(null);
  }, []);

  const handleGridContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    const cell = pointToCell(event.clientX, event.clientY);
    if (!cell) { setContextMenu(null); return; }
    event.preventDefault();
    const insideSelection = selection
      && cell.column >= selection.colStart && cell.column <= selection.colEnd
      && cell.rowIndex >= selection.rowStart && cell.rowIndex <= selection.rowEnd;
    if (!insideSelection) {
      selectionAnchorRef.current = { column: cell.column, rowIndex: 0 };
      setSelection({ colStart: cell.column, colEnd: cell.column, rowStart: 0, rowEnd: Math.max(0, orderedRows.length - 1) });
    }
    setHoverCell(null);
    setContextMenu({ x: event.clientX, y: event.clientY, column: cell.column, rowId: cell.rowId });
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
    setSelection(null);
    selectionAnchorRef.current = null;
    const state: RowDragState = { id, fromIndex: index, overIndex: index, edge: 'before' };
    rowDragRef.current = state;
    setRowDrag(state);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is best-effort */ }
  };

  const updateRowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!rowDragRef.current) return;
    const node = document.elementFromPoint(event.clientX, event.clientY);
    const rowElement = node instanceof HTMLElement ? node.closest<HTMLElement>('[data-msa-row-index]') : null;
    if (!rowElement) return;
    const overIndex = Number(rowElement.dataset.msaRowIndex);
    if (!Number.isInteger(overIndex)) return;
    const rect = rowElement.getBoundingClientRect();
    const edge: 'before' | 'after' = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const prev = rowDragRef.current;
    if (prev.overIndex === overIndex && prev.edge === edge) return;
    const next = { ...prev, overIndex, edge };
    rowDragRef.current = next;
    setRowDrag(next);
  };

  const endRowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = rowDragRef.current;
    rowDragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setRowDrag(null);
    if (!state) return;
    // Convert the (over-row, edge) drop target into an insertion index against
    // the array with the dragged id removed.
    let insertion = state.overIndex + (state.edge === 'after' ? 1 : 0);
    if (state.fromIndex < insertion) insertion -= 1;
    if (insertion === state.fromIndex) return; // a plain click, or dropped in place
    const ids = orderedRows.map((row) => row.id);
    commitRowOrder(moveRowId(ids, state.id, insertion), state.id, orderedRows[state.fromIndex]?.name ?? 'Row');
  };

  const cancelRowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
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
    const target = Math.max(0, Math.min(ids.length - 1, from + delta));
    if (target === from) return;
    commitRowOrder(moveRowId(ids, id, target), id, orderedRows[from]?.name ?? 'Row');
  };

  const resetRowOrder = useCallback(() => {
    setManualOrder(null);
    setReorderStatus('Row order reset to the current sort.');
  }, []);

  useEffect(() => {
    setSelection(null);
    setHoverCell(null);
    setContextMenu(null);
    selectionAnchorRef.current = null;
    selectingRef.current = false;
    setManualOrder(null);
    setRowDrag(null);
    rowDragRef.current = null;
    setReorderStatus('');
  }, [alignment.id, resetToken]);

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
    if (!contextMenu) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (contextMenuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(null); };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!selection) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !contextMenu) clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clearSelection, contextMenu, selection]);

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

  const renderSymbols = (sequence: string, rowId: string, consensus = false) => (
    <div
      className="motif-cs-msa-symbol-window"
      style={{ left: labelWidth + (startColumn * cellWidth) }}
      aria-hidden="true"
    >
      {Array.from(sequence.slice(startColumn, endColumn)).map((symbol, offset) => {
        const column = startColumn + offset;
        const templateSymbol = template?.aligned[column] ?? '-';
        const isTemplate = rowId === template?.id;
        const matchesTemplate = symbol === templateSymbol;
        const quietMatch = !consensus && emphasis === 'differences' && !isTemplate && matchesTemplate && symbol !== '-';
        const display = quietMatch
          ? '·'
          : symbol;
        return (
          <span
            key={column}
            className="motif-cs-msa-symbol"
            data-alignment-column={column + 1}
            data-residue={symbol}
            data-tone={toneColored ? residueTone(symbol, alignment.molecule) : 'mono'}
            data-color-key={explicitScheme ? residueColorKey(symbol, alignment.molecule, colorScheme) || undefined : undefined}
            data-shade-bucket={!consensus && shadeByColumn
              ? msaShadeBucket(shadeMode === 'identity' ? (columnStats[column]?.identity ?? 0) : (columnStats[column]?.conservation ?? 0))
              : undefined}
            data-difference={!consensus && !matchesTemplate || undefined}
            data-quiet={quietMatch || undefined}
            data-conserved={alignment.conserved[column] || undefined}
            data-jump={jumpColumn === column || undefined}
            data-search-match={searchColumnsByRow.get(rowId)?.has(column) || undefined}
            data-search-active={(activeSearchRowId === rowId && activeSearchColumns.has(column)) || undefined}
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

  const selectionColumnLeft = selection ? labelWidth + (selection.colStart * cellWidth) : 0;
  const selectionColumnWidth = selection ? (selection.colEnd - selection.colStart + 1) * cellWidth : 0;
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
        onPointerDown={handleGridPointerDown}
        onPointerMove={handleGridPointerMove}
        onPointerUp={endSelectionDrag}
        onPointerCancel={endSelectionDrag}
        onPointerLeave={() => setHoverCell(null)}
        onContextMenu={handleGridContextMenu}
        tabIndex={0}
        role="region"
        aria-label={`Alignment matrix, ${alignment.rows.length} rows by ${alignment.alignmentLength} columns. Scroll horizontally to inspect columns.`}
        aria-describedby="motif-cs-msa-matrix-help"
        data-selecting={selection ? true : undefined}
      >
        <div
          className="motif-cs-msa-matrix"
          style={matrixStyle}
          role="table"
          aria-rowcount={tableRowCount}
          aria-colcount={alignment.alignmentLength}
          data-color-scheme={explicitScheme ? colorScheme : undefined}
          data-shade={shadeMode !== 'none' ? shadeMode : undefined}
          data-reordering={rowDrag ? true : undefined}
          data-blocks={blocks ? true : undefined}
        >
          {selection ? (
            <div className="motif-cs-msa-selection-band" style={{ left: selectionColumnLeft, width: selectionColumnWidth }} aria-hidden="true" />
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
                {renderSymbols(row.aligned, row.id)}
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
        <button type="button" className="motif-cs-mini-button" data-testid="msa-zoom-fit" onClick={fitZoom} title="Fit the whole alignment to the window width">Fit</button>
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
      <span id="motif-cs-msa-matrix-help" className="motif-cs-visually-hidden">Alignment positions count gapped columns. Template positions count non-gap residues in the chosen template; blank template-axis cells are gaps. Choose any row header button to make that row the template. Use the Columns slider, Shift plus wheel, or Left and Right arrow keys to pan. Switch to Text to read or copy the complete aligned sequences with assistive technology.</span>
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
        <div className="motif-cs-msa-hover-readout" style={{ left: hoverCell.clientX + 14, top: hoverCell.clientY + 16 }} aria-hidden="true">
          <b>{orderedRows[hoverCell.rowIndex]?.aligned[hoverCell.column] ?? '-'}</b>
          <span>col {hoverCell.column + 1}</span>
          <span>· {templateCoordinates[hoverCell.column] != null ? `tpl ${templateCoordinates[hoverCell.column]}` : 'tpl gap'}</span>
          <span className="motif-cs-msa-hover-readout-name">{orderedRows[hoverCell.rowIndex]?.name}</span>
        </div>
      ) : null}
      {contextMenu ? (
        <div ref={contextMenuRef} className="motif-cs-msa-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label="Alignment selection actions">
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
  const [searchIndex, setSearchIndex] = useState(-1);
  const [viewResetToken, setViewResetToken] = useState(0);
  const [coordinateSystem, setCoordinateSystem] = useState<CoordinateSystem>('alignment');
  const [columnDraft, setColumnDraft] = useState('');
  const [columnError, setColumnError] = useState<string | null>(null);
  const [columnStatus, setColumnStatus] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [intakeStatus, setIntakeStatus] = useState<{ message: string; tone: 'status' | 'error' } | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ label: string; message: string; tone: 'status' | 'error' } | null>(null);
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
  }, [activeAlignment]);

  // Reset the sequence search only when switching to a different alignment, not
  // when the same alignment yields a new object (e.g. a template change), so a
  // template switch keeps the active search.
  useEffect(() => {
    setSearchQuery('');
    setSearchIndex(-1);
  }, [activeAlignment?.id]);

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
  const searchResult = useMemo(
    () => (activeAlignment && searchQuery.trim()
      ? findMsaMotifMatches(activeAlignment.rows, searchQuery, { molecule: activeAlignment.molecule })
      : { matches: [], truncated: false }),
    [activeAlignment, searchQuery],
  );
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
  const comparisonRows = activeAlignment?.rows.filter((row) => row.id !== activeTemplate?.id) ?? [];
  const avgIdentity = activeTemplate && comparisonRows.length > 0
    ? comparisonRows.reduce((sum, row) => sum + pairwiseRowStats(row.aligned, activeTemplate.aligned).identity, 0) / comparisonRows.length
    : activeTemplate ? 100 : 0;
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
    if (differences.length === 0) return;
    const nextIndex = differenceIndex < 0
      ? direction > 0 ? 0 : differences.length - 1
      : (differenceIndex + direction + differences.length) % differences.length;
    setDifferenceIndex(nextIndex);
    setJumpColumn(differences[nextIndex]);
    setJumpRowId(null);
    setJumpToken((token) => token + 1);
  };

  const goToSearchMatch = useCallback((index: number) => {
    const count = searchMatches.length;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    const match = searchMatches[next];
    setSearchIndex(next);
    setDifferenceIndex(-1);
    // Centre on an actual matched residue column, not the midpoint between the
    // endpoints — a gap-spanning match's midpoint can be an unrelated column.
    setJumpColumn(match.columns[Math.floor(match.columns.length / 2)] ?? match.startColumn);
    setJumpRowId(match.rowId);
    setJumpToken((token) => token + 1);
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
                  ['showConservation', 'Conservation marks'],
                  ['showConservationHistogram', 'Conservation histogram'],
                  ['showOccupancy', 'Occupancy'],
                  ['showConsensus', 'Consensus'],
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
            <span><strong>{formatIdentity(avgIdentity)}%</strong> avg to template</span>
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
                  <select value={referenceRowId} onChange={(event) => selectTemplate(event.target.value)}>
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
                  </select>
                </label>
                <div className="motif-cs-msa-difference-nav" role="group" aria-label="Variable column navigation">
                  <button className="motif-cs-mini-button" type="button" disabled={differences.length === 0} onClick={() => jumpDifference(-1)} aria-label="Previous variable column"><ChevronLeft size={13} /></button>
                  <span>{differenceIndex >= 0 ? `Difference ${differenceIndex + 1} of ${differences.length}` : `${differences.length} differences`}</span>
                  <button className="motif-cs-mini-button" type="button" disabled={differences.length === 0} onClick={() => jumpDifference(1)} aria-label="Next variable column"><ChevronRight size={13} /></button>
                </div>
                <form
                  className="motif-cs-msa-search"
                  data-testid="msa-search"
                  role="search"
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
                      ? searchMatches.length === 0
                        ? 'No matches'
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
                sortMode={sortMode}
                visibility={matrixVisibility}
                resetToken={viewResetToken}
                onTemplateChange={selectTemplate}
                onCopy={copyFromViewer}
                onZoomChange={(next) => updateViewPreferences({ zoom: next })}
              />
            </>
          ) : displayMode === 'trace' ? (
            <>
              <div className="motif-cs-msa-view-controls motif-cs-msa-trace-controls">
                <label className="motif-cs-msa-reference-picker">
                  <span>Compare against</span>
                  <select value={referenceRowId} onChange={(event) => selectTemplate(event.target.value)}>
                    {activeAlignment.rows.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </label>
                <div className="motif-cs-msa-difference-nav" role="group" aria-label="Variable column navigation">
                  <button className="motif-cs-mini-button" type="button" disabled={differences.length === 0} onClick={() => jumpDifference(-1)} aria-label="Previous variable column"><ChevronLeft size={13} /></button>
                  <span>{differenceIndex >= 0 ? `Difference ${differenceIndex + 1} of ${differences.length}` : `${differences.length} differences`}</span>
                  <button className="motif-cs-mini-button" type="button" disabled={differences.length === 0} onClick={() => jumpDifference(1)} aria-label="Next variable column"><ChevronRight size={13} /></button>
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
