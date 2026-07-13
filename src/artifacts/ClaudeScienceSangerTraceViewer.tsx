/* eslint-disable react-refresh/only-export-components -- viewer exports a pure trace-link guard for its presentation switch */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { SangerBase, SangerTraceData } from '../bio/abi-import';
import type { ArtifactAlignment, ArtifactAlignmentRow } from './claude-science-msa';
import {
  sangerQualitySummary,
  traceOrientationForAlignedRow,
  type ArtifactTraceOrientation,
} from './claude-science-sanger';

const BASES = ['A', 'C', 'G', 'T'] as const;
const REVERSE_CHANNEL: Record<SangerBase, SangerBase> = { A: 'T', C: 'G', G: 'C', T: 'A' };
const TRACE_HEIGHT = 252;
const STACKED_TRACE_HEIGHT = 176;
const STACKED_LANE_HEIGHT = 216;
const MIN_CELL_WIDTH = 6;
const MAX_CELL_WIDTH = 30;
const DEFAULT_CELL_WIDTH = 12;
const SANGER_VIEW_PREFERENCES_KEY = 'motif.claude-science.sanger-view.v1';

type SangerViewMode = 'stacked' | 'single';

type SangerViewPreferences = {
  viewMode: SangerViewMode;
  showQuality: boolean;
};

type SangerTraceSessionState = {
  selectedRowId: string;
  selectedColumn: number | null;
  cellWidth: number;
  scrollLeft: number;
  scrollTop: number;
};

const sangerTraceSessionByAlignment = new Map<string, SangerTraceSessionState>();

export type SangerTraceViewerRecord = {
  id: string;
  name: string;
  sangerTrace?: SangerTraceData;
};

type LinkedTraceRow = {
  row: ArtifactAlignmentRow;
  record: SangerTraceViewerRecord;
  trace: SangerTraceData;
  orientation: Exclude<ArtifactTraceOrientation, 'unlinked'>;
};

function linkedTraceRows(
  alignment: ArtifactAlignment,
  records: readonly SangerTraceViewerRecord[],
): LinkedTraceRow[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  const byName = new Map<string, SangerTraceViewerRecord[]>();
  for (const record of records) {
    const matches = byName.get(record.name) ?? [];
    matches.push(record);
    byName.set(record.name, matches);
  }
  return alignment.rows.flatMap((row) => {
    if (row.sourceRecordId) {
      const record = byId.get(row.sourceRecordId);
      if (!record?.sangerTrace) return [];
      const orientation = traceOrientationForAlignedRow(record.sangerTrace, row.aligned);
      return orientation === 'unlinked' ? [] : [{ row, record, trace: record.sangerTrace, orientation }];
    }
    const candidates = (byName.get(row.name) ?? []).flatMap((record) => {
      if (!record.sangerTrace) return [];
      const orientation = traceOrientationForAlignedRow(record.sangerTrace, row.aligned);
      return orientation === 'unlinked' ? [] : [{ row, record, trace: record.sangerTrace, orientation }];
    });
    return candidates.length === 1 ? candidates : [];
  });
}

export function hasLinkedSangerTrace(
  alignment: ArtifactAlignment,
  records: readonly SangerTraceViewerRecord[],
): boolean {
  return linkedTraceRows(alignment, records).length > 0;
}

function rawIndexByColumn(row: ArtifactAlignmentRow, orientation: LinkedTraceRow['orientation']): number[] {
  const count = row.aligned.replace(/-/g, '').length;
  let ordinal = 0;
  return Array.from(row.aligned, (symbol) => {
    if (symbol === '-') return -1;
    const rawIndex = orientation === 'forward' ? ordinal : count - ordinal - 1;
    ordinal += 1;
    return rawIndex;
  });
}

function alignmentColumnByRawIndex(rawByColumn: readonly number[], baseCount: number): number[] {
  const result = Array.from({ length: baseCount }, () => -1);
  rawByColumn.forEach((rawIndex, column) => {
    if (rawIndex >= 0 && rawIndex < result.length) result[rawIndex] = column;
  });
  return result;
}

function cssColor(canvas: HTMLCanvasElement, name: string, fallback: string): string {
  return getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;
}

function nearestAnchorIndex(anchors: readonly { sample: number; x: number }[], sample: number): number {
  let low = 0;
  let high = anchors.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (anchors[mid].sample < sample) low = mid + 1;
    else high = mid;
  }
  return low;
}

function interpolatedX(anchors: readonly { sample: number; x: number }[], sample: number): number {
  if (anchors.length === 0) return 0;
  const upperIndex = nearestAnchorIndex(anchors, sample);
  if (upperIndex <= 0) return anchors[0].x;
  if (upperIndex >= anchors.length) return anchors[anchors.length - 1].x;
  const lower = anchors[upperIndex - 1];
  const upper = anchors[upperIndex];
  if (upper.sample === lower.sample) return upper.x;
  const fraction = (sample - lower.sample) / (upper.sample - lower.sample);
  return lower.x + ((upper.x - lower.x) * fraction);
}

function qLabel(value: number): string {
  return value > 0 ? `Q${Math.round(value)}` : 'not reported';
}

function loadSangerViewPreferences(): SangerViewPreferences | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SANGER_VIEW_PREFERENCES_KEY) ?? 'null') as Partial<SangerViewPreferences> | null;
    if (!parsed || (parsed.viewMode !== 'stacked' && parsed.viewMode !== 'single') || typeof parsed.showQuality !== 'boolean') return null;
    return { viewMode: parsed.viewMode, showQuality: parsed.showQuality };
  } catch {
    return null;
  }
}

function saveSangerViewPreferences(preferences: SangerViewPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SANGER_VIEW_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    // The viewer remains fully usable when a host blocks localStorage.
  }
}

type TracePairwiseStats = {
  mismatches: number;
  identity: number;
};

function traceCoverage(aligned: string): { first: number; last: number } | null {
  const first = aligned.search(/[^-]/);
  if (first < 0) return null;
  for (let last = aligned.length - 1; last >= first; last -= 1) {
    if (aligned[last] !== '-') return { first, last };
  }
  return null;
}

function tracePairwiseStats(aligned: string, template: string): TracePairwiseStats {
  const rowCoverage = traceCoverage(aligned);
  const templateCoverage = traceCoverage(template);
  if (!rowCoverage || !templateCoverage) return { mismatches: 0, identity: 0 };
  let comparable = 0;
  let matches = 0;
  let mismatches = 0;
  for (let column = 0; column < Math.max(aligned.length, template.length); column += 1) {
    if (column < rowCoverage.first || column > rowCoverage.last || column < templateCoverage.first || column > templateCoverage.last) continue;
    const symbol = aligned[column] ?? '-';
    const templateSymbol = template[column] ?? '-';
    if (symbol === '-' && templateSymbol === '-') continue;
    comparable += 1;
    if (symbol === templateSymbol) matches += 1;
    else mismatches += 1;
  }
  return {
    mismatches,
    identity: comparable > 0 ? Math.round((matches / comparable) * 10_000) / 100 : 0,
  };
}

function formatTraceIdentity(identity: number): string {
  return identity < 100 && identity >= 99.9 ? identity.toFixed(2) : identity.toFixed(1);
}

export function traceFitCellWidth(viewportWidth: number, alignmentLength: number): number {
  const safeViewportWidth = Number.isFinite(viewportWidth) ? Math.max(1, viewportWidth) : 1;
  const safeAlignmentLength = Number.isFinite(alignmentLength) ? Math.max(1, alignmentLength) : 1;
  return Math.min(DEFAULT_CELL_WIDTH, safeViewportWidth / safeAlignmentLength);
}

export function traceCenteredScrollLeft(
  centerColumn: number,
  nextCellWidth: number,
  viewportWidth: number,
  alignmentLength: number,
): number {
  const contentWidth = Math.max(0, alignmentLength * nextCellWidth);
  const maxScrollLeft = Math.max(0, contentWidth - viewportWidth);
  return Math.max(0, Math.min(maxScrollLeft, (centerColumn * nextCellWidth) - (viewportWidth / 2)));
}

function SangerStackedTraceCanvas({
  item,
  template,
  alignmentLength,
  cellWidth,
  scrollLeft,
  viewportWidth,
  selectedColumn,
  showQuality,
  themeRevision,
  onActivate,
  onChooseColumn,
  onNavigate,
}: {
  item: LinkedTraceRow;
  template: ArtifactAlignmentRow;
  alignmentLength: number;
  cellWidth: number;
  scrollLeft: number;
  viewportWidth: number;
  selectedColumn: number | null;
  showQuality: boolean;
  themeRevision: number;
  onActivate: () => void;
  onChooseColumn: (column: number) => void;
  onNavigate: (delta: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rawByColumn = useMemo(
    () => rawIndexByColumn(item.row, item.orientation),
    [item],
  );
  const columnByRaw = useMemo(
    () => alignmentColumnByRawIndex(rawByColumn, item.trace.baseCalls.length),
    [item.trace.baseCalls.length, rawByColumn],
  );
  const traceAnchors = useMemo(() => item.trace.peakPositions
    .map((sample, rawIndex) => ({
      sample,
      x: ((columnByRaw[rawIndex] + 0.5) * cellWidth),
    }))
    .filter((anchor) => anchor.x >= 0)
    .sort((left, right) => left.sample - right.sample), [cellWidth, columnByRaw, item.trace.peakPositions]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(viewportWidth * dpr);
    const pixelHeight = Math.round(STACKED_TRACE_HEIGHT * dpr);
    const cssWidth = `${viewportWidth}px`;
    const cssHeight = `${STACKED_TRACE_HEIGHT}px`;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
    if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewportWidth, STACKED_TRACE_HEIGHT);

    const background = cssColor(canvas, '--bg-primary', 'transparent');
    const ink = cssColor(canvas, '--text-primary', 'currentColor');
    const muted = cssColor(canvas, '--text-muted', 'currentColor');
    const border = cssColor(canvas, '--border-subtle', 'currentColor');
    const mismatch = cssColor(canvas, '--red', 'currentColor');
    const qualityColor = cssColor(canvas, '--amber', 'currentColor');
    const accent = cssColor(canvas, '--accent', ink);
    const monoFont = cssColor(canvas, '--font-mono', 'monospace');
    const channelColors: Record<SangerBase, string> = {
      A: cssColor(canvas, '--motif-cs-trace-a', cssColor(canvas, '--green', 'currentColor')),
      C: cssColor(canvas, '--motif-cs-trace-c', cssColor(canvas, '--accent', 'currentColor')),
      G: cssColor(canvas, '--motif-cs-trace-g', ink),
      T: cssColor(canvas, '--motif-cs-trace-t', mismatch),
    };
    context.fillStyle = background;
    context.fillRect(0, 0, viewportWidth, STACKED_TRACE_HEIGHT);
    context.font = `11px ${monoFont}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const visibleStart = Math.max(0, Math.floor(scrollLeft / cellWidth) - 2);
    const visibleEnd = Math.min(alignmentLength, Math.ceil((scrollLeft + viewportWidth) / cellWidth) + 2);
    const traceTop = 64;
    const baseline = STACKED_TRACE_HEIGHT - 24;

    context.strokeStyle = border;
    context.lineWidth = 1;
    for (const y of [27.5, 55.5, baseline + 0.5]) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(viewportWidth, y);
      context.stroke();
    }

    for (let column = visibleStart; column < visibleEnd; column += 1) {
      const localX = ((column + 0.5) * cellWidth) - scrollLeft;
      const rawIndex = rawByColumn[column];
      const readSymbol = item.row.aligned[column] ?? '-';
      const templateSymbol = template.aligned[column] ?? '-';
      const score = rawIndex >= 0 ? item.trace.qualityScores[rawIndex] : undefined;
      if (showQuality && score !== undefined) {
        context.globalAlpha = Math.max(0.035, Math.min(0.16, score / 280));
        context.fillStyle = qualityColor;
        context.fillRect(localX - (cellWidth / 2), 28, cellWidth, baseline - 28);
        context.globalAlpha = 1;
      }
      if (readSymbol !== '-' && templateSymbol !== '-' && readSymbol !== templateSymbol) {
        context.globalAlpha = 0.12;
        context.fillStyle = mismatch;
        context.fillRect(localX - (cellWidth / 2), 0, cellWidth, STACKED_TRACE_HEIGHT);
        context.globalAlpha = 1;
      }
      if (selectedColumn === column) {
        context.globalAlpha = 0.18;
        context.fillStyle = accent;
        context.fillRect(localX - (cellWidth / 2), 0, cellWidth, STACKED_TRACE_HEIGHT);
        context.globalAlpha = 1;
      }
      if (cellWidth >= 10) {
        context.fillStyle = templateSymbol === readSymbol ? muted : ink;
        context.fillText(templateSymbol, localX, 14);
        context.fillStyle = readSymbol === '-' ? muted : channelColors[readSymbol as SangerBase] ?? ink;
        context.fillText(readSymbol, localX, 42);
      }
    }

    if (traceAnchors.length < 2) {
      context.fillStyle = muted;
      context.textAlign = 'left';
      context.fillText('No signal channels in this AB1 file.', 12, 106);
      return;
    }

    const sampleValues = rawByColumn
      .slice(visibleStart, visibleEnd)
      .filter((rawIndex) => rawIndex >= 0)
      .map((rawIndex) => item.trace.peakPositions[rawIndex])
      .filter((sample): sample is number => Number.isFinite(sample));
    if (sampleValues.length === 0) return;
    const sampleStart = Math.max(0, Math.min(...sampleValues) - 80);
    const sampleEnd = Math.min(item.trace.sampleCount - 1, Math.max(...sampleValues) + 80);
    const stride = Math.max(1, Math.ceil((sampleEnd - sampleStart + 1) / 4_000));
    let amplitudeMax = 1;
    for (const base of BASES) {
      const channel = item.trace.channels[base];
      for (let sample = sampleStart; sample <= sampleEnd; sample += stride) {
        amplitudeMax = Math.max(amplitudeMax, Math.abs(channel[sample] ?? 0));
      }
    }
    const bandHeight = baseline - traceTop - 5;
    for (const rawBase of BASES) {
      const displayBase = item.orientation === 'reverse' ? REVERSE_CHANNEL[rawBase] : rawBase;
      const channel = item.trace.channels[rawBase];
      context.beginPath();
      context.strokeStyle = channelColors[displayBase];
      context.lineWidth = 1.2;
      let moved = false;
      const first = item.orientation === 'forward' ? sampleStart : sampleEnd;
      const last = item.orientation === 'forward' ? sampleEnd : sampleStart;
      const step = item.orientation === 'forward' ? stride : -stride;
      for (let sample = first; item.orientation === 'forward' ? sample <= last : sample >= last; sample += step) {
        const x = interpolatedX(traceAnchors, sample) - scrollLeft;
        if (x < -2 || x > viewportWidth + 2) continue;
        const value = Math.max(0, channel[sample] ?? 0);
        const y = baseline - ((value / amplitudeMax) * bandHeight);
        if (!moved) {
          context.moveTo(x, y);
          moved = true;
        } else context.lineTo(x, y);
      }
      context.stroke();
    }
  }, [alignmentLength, cellWidth, item, rawByColumn, scrollLeft, selectedColumn, showQuality, template.aligned, themeRevision, traceAnchors, viewportWidth]);

  const chooseColumn = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const column = Math.floor((scrollLeft + event.clientX - bounds.left) / cellWidth);
    onActivate();
    onChooseColumn(Math.max(0, Math.min(alignmentLength - 1, column)));
  };

  return (
    <canvas
      ref={canvasRef}
      className="motif-cs-sanger-canvas motif-cs-sanger-stack-canvas"
      role="img"
      tabIndex={0}
      aria-label={`${item.row.name} chromatogram aligned ${item.orientation} to template ${template.name}.`}
      onFocus={onActivate}
      onPointerDown={chooseColumn}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        onActivate();
        onNavigate(event.key === 'ArrowRight' ? 1 : -1);
      }}
    />
  );
}

export function ClaudeScienceSangerTraceViewer({
  alignment,
  records,
  templateRowId,
  jumpColumn,
  jumpToken,
}: {
  alignment: ArtifactAlignment;
  records: readonly SangerTraceViewerRecord[];
  templateRowId: string;
  jumpColumn: number | null;
  jumpToken: number;
}) {
  const linked = useMemo(() => linkedTraceRows(alignment, records), [alignment, records]);
  const initialPreferences = useMemo(() => loadSangerViewPreferences(), []);
  const initialSession = useMemo(() => sangerTraceSessionByAlignment.get(alignment.id), [alignment.id]);
  const [selectedRowId, setSelectedRowId] = useState(initialSession?.selectedRowId ?? linked[0]?.row.id ?? '');
  const [viewMode, setViewMode] = useState<SangerViewMode>(
    initialPreferences?.viewMode ?? (linked.length > 1 ? 'stacked' : 'single'),
  );
  const [showQuality, setShowQuality] = useState(initialPreferences?.showQuality ?? true);
  const [cellWidth, setCellWidth] = useState(initialSession?.cellWidth ?? DEFAULT_CELL_WIDTH);
  const [scrollLeft, setScrollLeft] = useState(initialSession?.scrollLeft ?? 0);
  const [stackScrollTop, setStackScrollTop] = useState(initialSession?.scrollTop ?? 0);
  const [viewportWidth, setViewportWidth] = useState(720);
  const [viewportHeight, setViewportHeight] = useState(420);
  const [selectedColumn, setSelectedColumn] = useState<number | null>(initialSession?.selectedColumn ?? null);
  const [themeRevision, setThemeRevision] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoPositionKeyRef = useRef(initialSession ? '__restored__' : '');
  const scrollFrameRef = useRef<number | null>(null);
  const pendingScrollLeftRef = useRef(initialSession?.scrollLeft ?? 0);
  const pendingScrollTopRef = useRef(initialSession?.scrollTop ?? 0);

  const effectiveViewMode: SangerViewMode = linked.length > 1 ? viewMode : 'single';

  useEffect(() => {
    if (!linked.some((item) => item.row.id === selectedRowId)) setSelectedRowId(linked[0]?.row.id ?? '');
  }, [linked, selectedRowId]);

  useEffect(() => {
    saveSangerViewPreferences({ viewMode, showQuality });
  }, [showQuality, viewMode]);

  useEffect(() => {
    sangerTraceSessionByAlignment.set(alignment.id, {
      selectedRowId,
      selectedColumn,
      cellWidth,
      scrollLeft,
      scrollTop: stackScrollTop,
    });
  }, [alignment.id, cellWidth, scrollLeft, selectedColumn, selectedRowId, stackScrollTop]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    scroller.scrollLeft = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, pendingScrollLeftRef.current));
    if (effectiveViewMode === 'stacked') {
      scroller.scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, pendingScrollTopRef.current));
    }
    const update = () => {
      setViewportWidth(Math.max(280, Math.floor(scroller.clientWidth)));
      setViewportHeight(Math.max(180, Math.floor(scroller.clientHeight)));
      setScrollLeft(scroller.scrollLeft);
      if (effectiveViewMode === 'stacked') setStackScrollTop(scroller.scrollTop);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [effectiveViewMode]);

  useEffect(() => {
    const root = document.documentElement;
    if (typeof MutationObserver === 'undefined') return undefined;
    const observer = new MutationObserver(() => setThemeRevision((revision) => revision + 1));
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const selected = linked.find((item) => item.row.id === selectedRowId) ?? linked[0];
  const template = alignment.rows.find((row) => row.id === templateRowId) ?? alignment.rows[0];
  const quality = selected ? sangerQualitySummary(selected.trace) : { mean: 0, q20Percent: 0 };
  const linkedStats = useMemo(() => new Map(linked.map((item) => [
    item.row.id,
    template ? tracePairwiseStats(item.row.aligned, template.aligned) : { mismatches: 0, identity: 0 },
  ])), [linked, template]);
  const linkedQuality = useMemo(() => new Map(linked.map((item) => [
    item.row.id,
    sangerQualitySummary(item.trace),
  ])), [linked]);
  const totalWidth = Math.max(viewportWidth, alignment.alignmentLength * cellWidth);
  const selectedRawByColumn = useMemo(
    () => selected ? rawIndexByColumn(selected.row, selected.orientation) : [],
    [selected],
  );
  const selectedColumnByRaw = useMemo(
    () => selected ? alignmentColumnByRawIndex(selectedRawByColumn, selected.trace.baseCalls.length) : [],
    [selected, selectedRawByColumn],
  );
  const traceAnchors = useMemo(() => {
    if (!selected) return [];
    return selected.trace.peakPositions
      .map((sample, rawIndex) => ({
        sample,
        x: ((selectedColumnByRaw[rawIndex] + 0.5) * cellWidth),
      }))
      .filter((anchor) => anchor.x >= 0)
      .sort((left, right) => left.sample - right.sample);
  }, [cellWidth, selected, selectedColumnByRaw]);

  const scrollColumnIntoView = useCallback((column: number, behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target = Math.max(0, Math.min(scroller.scrollWidth - scroller.clientWidth, ((column + 0.5) * cellWidth) - (scroller.clientWidth / 2)));
    const resolvedBehavior = behavior === 'smooth' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
      ? 'auto'
      : behavior;
    scroller.scrollTo({ left: target, behavior: resolvedBehavior });
    setSelectedColumn(Math.max(0, Math.min(alignment.alignmentLength - 1, column)));
  }, [alignment.alignmentLength, cellWidth]);

  useEffect(() => {
    if (jumpColumn === null) return;
    scrollColumnIntoView(jumpColumn);
  }, [jumpColumn, jumpToken, scrollColumnIntoView]);

  useEffect(() => {
    if (!selected) return;
    const key = alignment.id;
    if (autoPositionKeyRef.current === '__restored__') {
      autoPositionKeyRef.current = key;
      return;
    }
    if (autoPositionKeyRef.current === key) return;
    autoPositionKeyRef.current = key;
    const firstCoveredColumn = linked.reduce((earliest, item) => {
      const start = item.row.aligned.search(/[^-]/);
      return start < 0 ? earliest : Math.min(earliest, start);
    }, alignment.alignmentLength);
    if (firstCoveredColumn >= alignment.alignmentLength) return;
    const frame = window.requestAnimationFrame(() => scrollColumnIntoView(firstCoveredColumn, 'auto'));
    return () => window.cancelAnimationFrame(frame);
  }, [alignment.alignmentLength, alignment.id, linked, scrollColumnIntoView, selected]);

  const zoom = useCallback((nextWidth: number) => {
    const scroller = scrollerRef.current;
    const centerColumn = scroller
      ? (scroller.scrollLeft + (scroller.clientWidth / 2)) / cellWidth
      : alignment.centerIdx;
    const width = Math.max(MIN_CELL_WIDTH, Math.min(MAX_CELL_WIDTH, nextWidth));
    setCellWidth(width);
    window.requestAnimationFrame(() => {
      const currentScroller = scrollerRef.current;
      if (!currentScroller) return;
      currentScroller.scrollTo({
        left: traceCenteredScrollLeft(
          centerColumn,
          width,
          currentScroller.clientWidth,
          alignment.alignmentLength,
        ),
        behavior: 'auto',
      });
    });
  }, [alignment.alignmentLength, alignment.centerIdx, cellWidth]);

  const fitAlignment = useCallback(() => {
    const scroller = scrollerRef.current;
    const width = traceFitCellWidth(scroller?.clientWidth ?? viewportWidth, alignment.alignmentLength);
    setCellWidth(width);
    window.requestAnimationFrame(() => scrollerRef.current?.scrollTo({ left: 0, behavior: 'auto' }));
  }, [alignment.alignmentLength, viewportWidth]);

  const handleScroll = useCallback((nextScrollLeft: number, nextScrollTop?: number) => {
    pendingScrollLeftRef.current = nextScrollLeft;
    if (nextScrollTop !== undefined) pendingScrollTopRef.current = nextScrollTop;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollLeft(pendingScrollLeftRef.current);
      setStackScrollTop(pendingScrollTopRef.current);
    });
  }, []);

  const chainStackWheel = useCallback((event: WheelEvent) => {
    if (!event.deltaY || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const maxStackScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const stackCanContinue = event.deltaY < 0
      ? scroller.scrollTop > 0
      : scroller.scrollTop < maxStackScroll - 1;
    if (stackCanContinue) return;
    const windowBody = scroller.closest<HTMLElement>('.motif-cs-window-body');
    if (!windowBody || windowBody === scroller) return;
    const maxBodyScroll = Math.max(0, windowBody.scrollHeight - windowBody.clientHeight);
    const bodyCanContinue = event.deltaY < 0
      ? windowBody.scrollTop > 0
      : windowBody.scrollTop < maxBodyScroll - 1;
    if (!bodyCanContinue) return;
    event.preventDefault();
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? windowBody.clientHeight
        : 1;
    windowBody.scrollTop += event.deltaY * scale;
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || effectiveViewMode !== 'stacked') return undefined;
    scroller.addEventListener('wheel', chainStackWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', chainStackWheel);
  }, [chainStackWheel, effectiveViewMode]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selected || !template) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(viewportWidth * dpr);
    const pixelHeight = Math.round(TRACE_HEIGHT * dpr);
    const cssWidth = `${viewportWidth}px`;
    const cssHeight = `${TRACE_HEIGHT}px`;
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    if (canvas.style.width !== cssWidth) canvas.style.width = cssWidth;
    if (canvas.style.height !== cssHeight) canvas.style.height = cssHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, viewportWidth, TRACE_HEIGHT);

    const background = cssColor(canvas, '--bg-primary', 'transparent');
    const ink = cssColor(canvas, '--text-primary', 'currentColor');
    const muted = cssColor(canvas, '--text-muted', 'currentColor');
    const border = cssColor(canvas, '--border-subtle', 'currentColor');
    const mismatch = cssColor(canvas, '--red', 'currentColor');
    const qualityColor = cssColor(canvas, '--amber', 'currentColor');
    const accent = cssColor(canvas, '--accent', ink);
    const monoFont = cssColor(canvas, '--font-mono', 'monospace');
    const channelColors: Record<SangerBase, string> = {
      A: cssColor(canvas, '--motif-cs-trace-a', cssColor(canvas, '--green', 'currentColor')),
      C: cssColor(canvas, '--motif-cs-trace-c', cssColor(canvas, '--accent', 'currentColor')),
      G: cssColor(canvas, '--motif-cs-trace-g', ink),
      T: cssColor(canvas, '--motif-cs-trace-t', mismatch),
    };
    context.fillStyle = background;
    context.fillRect(0, 0, viewportWidth, TRACE_HEIGHT);
    context.font = `11px ${monoFont}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const drawScrollLeft = scrollerRef.current?.scrollLeft ?? scrollLeft;
    const visibleStart = Math.max(0, Math.floor(drawScrollLeft / cellWidth) - 2);
    const visibleEnd = Math.min(alignment.alignmentLength, Math.ceil((drawScrollLeft + viewportWidth) / cellWidth) + 2);

    context.strokeStyle = border;
    context.lineWidth = 1;
    for (const y of [28.5, 57.5, 86.5, TRACE_HEIGHT - 27.5]) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(viewportWidth, y);
      context.stroke();
    }

    for (let column = visibleStart; column < visibleEnd; column += 1) {
      const localX = ((column + 0.5) * cellWidth) - drawScrollLeft;
      const rawIndex = selectedRawByColumn[column];
      const readSymbol = selected.row.aligned[column] ?? '-';
      const templateSymbol = template.aligned[column] ?? '-';
      const score = rawIndex >= 0 ? selected.trace.qualityScores[rawIndex] : undefined;
      if (showQuality && score !== undefined) {
        context.globalAlpha = Math.max(0.035, Math.min(0.18, score / 260));
        context.fillStyle = qualityColor;
        context.fillRect(localX - (cellWidth / 2), 29, cellWidth, 57);
        context.globalAlpha = 1;
      }
      if (readSymbol !== '-' && templateSymbol !== '-' && readSymbol !== templateSymbol) {
        context.globalAlpha = 0.13;
        context.fillStyle = mismatch;
        context.fillRect(localX - (cellWidth / 2), 0, cellWidth, TRACE_HEIGHT);
        context.globalAlpha = 1;
      }
      if (selectedColumn === column) {
        context.globalAlpha = 0.25;
        context.fillStyle = accent;
        context.fillRect(localX - (cellWidth / 2), 0, cellWidth, TRACE_HEIGHT);
        context.globalAlpha = 1;
      }
      if (cellWidth >= 10) {
        context.fillStyle = templateSymbol === readSymbol ? muted : ink;
        context.fillText(templateSymbol, localX, 15);
        context.fillStyle = readSymbol === '-' ? muted : channelColors[readSymbol as SangerBase] ?? ink;
        context.fillText(readSymbol, localX, 44);
        if (showQuality && score !== undefined && cellWidth >= 16) {
          context.fillStyle = muted;
          context.font = `9px ${monoFont}`;
          context.fillText(String(score), localX, 72);
          context.font = `11px ${monoFont}`;
        }
      }
    }

    if (traceAnchors.length < 2) {
      context.fillStyle = muted;
      context.textAlign = 'left';
      context.fillText('Peak locations or trace channels were not present in this AB1 file.', 14, 128);
      return;
    }

    const sampleValues = selectedRawByColumn
      .slice(visibleStart, visibleEnd)
      .filter((rawIndex) => rawIndex >= 0)
      .map((rawIndex) => selected.trace.peakPositions[rawIndex])
      .filter((sample): sample is number => Number.isFinite(sample));
    if (sampleValues.length === 0) return;
    const sampleStart = Math.max(0, Math.min(...sampleValues) - 80);
    const sampleEnd = Math.min(selected.trace.sampleCount - 1, Math.max(...sampleValues) + 80);
    const stride = Math.max(1, Math.ceil((sampleEnd - sampleStart + 1) / 4_000));
    let amplitudeMax = 1;
    for (const base of BASES) {
      const channel = selected.trace.channels[base];
      for (let sample = sampleStart; sample <= sampleEnd; sample += stride) {
        amplitudeMax = Math.max(amplitudeMax, Math.abs(channel[sample] ?? 0));
      }
    }
    const bandTop = 92;
    const baseline = TRACE_HEIGHT - 28;
    const bandHeight = baseline - bandTop - 5;
    for (const rawBase of BASES) {
      const displayBase = selected.orientation === 'reverse' ? REVERSE_CHANNEL[rawBase] : rawBase;
      const channel = selected.trace.channels[rawBase];
      context.beginPath();
      context.strokeStyle = channelColors[displayBase];
      context.lineWidth = 1.35;
      let moved = false;
      const first = selected.orientation === 'forward' ? sampleStart : sampleEnd;
      const last = selected.orientation === 'forward' ? sampleEnd : sampleStart;
      const step = selected.orientation === 'forward' ? stride : -stride;
      for (let sample = first; selected.orientation === 'forward' ? sample <= last : sample >= last; sample += step) {
        const globalX = interpolatedX(traceAnchors, sample);
        const x = globalX - drawScrollLeft;
        if (x < -2 || x > viewportWidth + 2) continue;
        const value = Math.max(0, channel[sample] ?? 0);
        const y = baseline - ((value / amplitudeMax) * bandHeight);
        if (!moved) {
          context.moveTo(x, y);
          moved = true;
        } else context.lineTo(x, y);
      }
      context.stroke();
    }
  }, [alignment, cellWidth, effectiveViewMode, scrollLeft, selected, selectedColumn, selectedRawByColumn, showQuality, template, themeRevision, traceAnchors, viewportWidth]);

  if (!selected || !template) {
    return (
      <div className="motif-cs-sanger-empty" data-testid="sanger-trace-empty">
        <strong>No aligned chromatogram</strong>
        <span>Align an imported AB1 record with a template to review its calls, quality, and four dye channels.</span>
      </div>
    );
  }

  const selectedRawIndex = selectedColumn === null
    ? -1
    : selectedRawByColumn[selectedColumn] ?? -1;
  const selectedQuality = selectedRawIndex >= 0 ? selected.trace.qualityScores[selectedRawIndex] : undefined;
  const viewportCenterColumn = Math.round((scrollLeft + (viewportWidth / 2)) / cellWidth);
  const positionValue = Math.max(0, Math.min(
    alignment.alignmentLength - 1,
    selectedColumn ?? viewportCenterColumn,
  ));
  const firstVisibleLane = Math.max(0, Math.floor(stackScrollTop / STACKED_LANE_HEIGHT) - 1);
  const lastVisibleLane = Math.min(linked.length, Math.ceil((stackScrollTop + viewportHeight) / STACKED_LANE_HEIGHT) + 1);

  const chooseColumn = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const currentScrollLeft = scrollerRef.current?.scrollLeft ?? scrollLeft;
    const column = Math.floor((currentScrollLeft + event.clientX - bounds.left) / cellWidth);
    setSelectedColumn(Math.max(0, Math.min(alignment.alignmentLength - 1, column)));
  };

  const navigateColumn = (delta: number) => {
    const next = Math.max(0, Math.min(alignment.alignmentLength - 1, (selectedColumn ?? positionValue) + delta));
    setSelectedColumn(next);
    scrollColumnIntoView(next);
  };

  const focusTraceRow = (rowId: string) => {
    setSelectedRowId(rowId);
    if (effectiveViewMode !== 'stacked') return;
    const index = linked.findIndex((item) => item.row.id === rowId);
    if (index < 0) return;
    window.requestAnimationFrame(() => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      scroller.scrollTo({
        left: scroller.scrollLeft,
        top: index * STACKED_LANE_HEIGHT,
        behavior: 'auto',
      });
      window.requestAnimationFrame(() => {
        const lane = scroller.querySelectorAll<HTMLElement>('.motif-cs-sanger-lane')[index];
        const windowBody = scroller.closest<HTMLElement>('.motif-cs-window-body');
        const windowPanel = scroller.closest<HTMLElement>('.motif-cs-window');
        if (!lane || !windowBody || !windowPanel) return;
        const laneRect = lane.getBoundingClientRect();
        const bodyRect = windowBody.getBoundingClientRect();
        const windowRect = windowPanel.getBoundingClientRect();
        const visibleTop = Math.max(bodyRect.top, windowRect.top + 42);
        const visibleBottom = Math.min(bodyRect.bottom, windowRect.bottom - 12);
        if (laneRect.bottom > visibleBottom) windowBody.scrollTop += laneRect.bottom - visibleBottom + 8;
        else if (laneRect.top < visibleTop) windowBody.scrollTop -= visibleTop - laneRect.top + 8;
      });
    });
  };

  return (
    <section className="motif-cs-sanger-viewer" data-testid="sanger-trace-viewer" aria-label="Sanger chromatogram review">
      <div className="motif-cs-sanger-toolbar">
        <div className="motif-cs-segmented motif-cs-sanger-layout" role="group" aria-label="Chromatogram layout">
          <button
            type="button"
            data-active={effectiveViewMode === 'stacked' || undefined}
            aria-pressed={effectiveViewMode === 'stacked'}
            disabled={linked.length < 2}
            onClick={() => setViewMode('stacked')}
          >Stacked</button>
          <button
            type="button"
            data-active={effectiveViewMode === 'single' || undefined}
            aria-pressed={effectiveViewMode === 'single'}
            onClick={() => setViewMode('single')}
          >Single</button>
        </div>
        <label className="motif-cs-sanger-read-picker">
          <span>{effectiveViewMode === 'stacked' ? 'Focus' : 'Read'}</span>
          <select value={selected.row.id} onChange={(event) => focusTraceRow(event.target.value)}>
            {linked.map((item) => <option key={item.row.id} value={item.row.id}>{item.row.name}</option>)}
          </select>
        </label>
        <label className="motif-cs-sanger-quality-toggle" title="Show imported AB1 quality scores as restrained background shading">
          <input type="checkbox" checked={showQuality} onChange={(event) => setShowQuality(event.target.checked)} />
          <span>Quality</span>
        </label>
        <span className="motif-cs-chip">{selected.orientation}</span>
        <span><strong>{selected.trace.baseCalls.length.toLocaleString()}</strong> calls</span>
        <span><strong>{qLabel(quality.mean)}</strong> mean</span>
        <span><strong>{quality.q20Percent.toFixed(1)}%</strong> Q20+</span>
        <div className="motif-cs-sanger-toolbar-spacer" />
        <div className="motif-cs-sanger-zoom" role="group" aria-label="Chromatogram horizontal zoom">
          <button className="motif-cs-mini-button" type="button" disabled={cellWidth <= MIN_CELL_WIDTH} onClick={() => zoom(cellWidth - 2)} aria-label="Zoom chromatogram out">−</button>
          <button className="motif-cs-mini-button" type="button" onClick={fitAlignment}>Fit</button>
          <button className="motif-cs-mini-button" type="button" disabled={cellWidth >= MAX_CELL_WIDTH} onClick={() => zoom(cellWidth + 2)} aria-label="Zoom chromatogram in">+</button>
        </div>
      </div>

      <div className="motif-cs-sanger-column-labels" aria-hidden="true">
        <span>Template</span><span>Read</span><span>Quality</span><span>Trace intensity</span>
      </div>
      {effectiveViewMode === 'stacked' ? (
        <div
          ref={scrollerRef}
          className="motif-cs-sanger-scroll motif-cs-sanger-stack-scroll"
          onScroll={(event) => handleScroll(event.currentTarget.scrollLeft, event.currentTarget.scrollTop)}
          data-testid="sanger-trace-stack-scroll"
          role="region"
          aria-label={`${linked.length} aligned chromatograms with synchronized navigation`}
        >
          <div className="motif-cs-sanger-stack" data-testid="sanger-trace-stack">
            {linked.map((item, index) => {
              const stats = linkedStats.get(item.row.id) ?? { mismatches: 0, identity: 0 };
              const laneQuality = linkedQuality.get(item.row.id) ?? { mean: 0, q20Percent: 0 };
              const visible = index >= firstVisibleLane && index < lastVisibleLane;
              return (
                <article
                  key={item.row.id}
                  className="motif-cs-sanger-lane"
                  style={{ width: totalWidth, height: STACKED_LANE_HEIGHT } as CSSProperties}
                  data-active={item.row.id === selected.row.id || undefined}
                  data-testid="sanger-trace-lane"
                >
                  <div className="motif-cs-sanger-lane-header" style={{ width: viewportWidth }}>
                    <button
                      type="button"
                      className="motif-cs-sanger-lane-select"
                      aria-pressed={item.row.id === selected.row.id}
                      onClick={() => focusTraceRow(item.row.id)}
                      title={`Focus ${item.row.name}`}
                    >{item.row.name}</button>
                    <span className="motif-cs-chip">{item.orientation}</span>
                    <span>{item.trace.baseCalls.length.toLocaleString()} calls</span>
                    <span>{stats.mismatches.toLocaleString()} mismatches</span>
                    <span>{formatTraceIdentity(stats.identity)}% identity</span>
                    <span>{qLabel(laneQuality.mean)} mean</span>
                  </div>
                  {visible ? (
                    <SangerStackedTraceCanvas
                      item={item}
                      template={template}
                      alignmentLength={alignment.alignmentLength}
                      cellWidth={cellWidth}
                      scrollLeft={scrollLeft}
                      viewportWidth={viewportWidth}
                      selectedColumn={selectedColumn}
                      showQuality={showQuality}
                      themeRevision={themeRevision}
                      onActivate={() => setSelectedRowId(item.row.id)}
                      onChooseColumn={setSelectedColumn}
                      onNavigate={navigateColumn}
                    />
                  ) : <div className="motif-cs-sanger-lane-placeholder" aria-hidden="true" />}
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          ref={scrollerRef}
          className="motif-cs-sanger-scroll"
          onScroll={(event) => handleScroll(event.currentTarget.scrollLeft)}
          data-testid="sanger-trace-scroll"
        >
          <div className="motif-cs-sanger-scroll-width" style={{ width: totalWidth, height: TRACE_HEIGHT } as CSSProperties}>
            <canvas
              ref={canvasRef}
              className="motif-cs-sanger-canvas"
              role="img"
              tabIndex={0}
              aria-label={`${selected.row.name} chromatogram aligned ${selected.orientation} to template ${template.name}. Use the alignment position slider for navigation.`}
              onPointerDown={chooseColumn}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                event.preventDefault();
                navigateColumn(event.key === 'ArrowRight' ? 1 : -1);
              }}
            />
          </div>
        </div>
      )}

      <div className="motif-cs-sanger-navigation">
        <label>
          <span>Alignment position</span>
          <input
            type="range"
            min={0}
            max={Math.max(0, alignment.alignmentLength - 1)}
            value={positionValue}
            onChange={(event) => scrollColumnIntoView(Number(event.target.value), 'auto')}
          />
          <output>{positionValue + 1}</output>
        </label>
        <div className="motif-cs-sanger-legend" aria-label="Chromatogram channel colors">
          {BASES.map((base) => <span key={base} data-base={base}><i aria-hidden="true" />{base}</span>)}
        </div>
      </div>
      <p className="motif-cs-sanger-call-status" aria-live="polite">
        {selectedColumn === null
          ? 'Click a base or use the arrow keys to inspect a call.'
          : `Alignment position ${selectedColumn + 1} · read ${selected.row.aligned[selectedColumn] ?? '-'} · template ${template.aligned[selectedColumn] ?? '-'} · quality ${selectedQuality === undefined ? 'not reported' : `Q${selectedQuality}`}`}
      </p>
      {selected.trace.warnings.length > 0 ? (
        <details className="motif-cs-sanger-warnings">
          <summary>{selected.trace.warnings.length} import warning{selected.trace.warnings.length === 1 ? '' : 's'}</summary>
          <ul>{selected.trace.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
