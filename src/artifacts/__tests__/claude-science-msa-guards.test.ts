import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const viewerSource = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');
const viewPreferencesSource = readFileSync(resolve(here, '..', 'claude-science-msa-view-preferences.ts'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start);
  expect(end, `missing end marker after ${startNeedle}: ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Claude Science MSA integration guards', () => {
  it('keeps Alignment discoverable as a Tools workspace and a movable, focus-restoring window', () => {
    expect(artifactSource).toContain("import { ClaudeScienceMsaViewer } from './ClaudeScienceMsaViewer';");
    expect(artifactSource).toContain('function defaultAlignmentWindowRect(): WindowRect');
    expect(artifactSource).toContain('const [showAlignment, setShowAlignment] = useState(false);');
    expect(artifactSource).toContain('const [alignmentWin, setAlignmentWin] = useState<WindowRect>(defaultAlignmentWindowRect);');
    expect(artifactSource).toContain('data-rail-tool="alignment"');
    expect(artifactSource).toContain('data-testid="msa-open-button"');
    expect(artifactSource).toContain('aria-label="Open alignment workspace"');
    expect(artifactSource).toContain('className="motif-cs-alignment-launch-copy"');
    expect(artifactSource).toContain('className="motif-cs-alignment-boundary" role="note"');
    expect(artifactSource).toContain('title="Multiple Sequence Alignment"');
    expect(artifactSource).toContain('onCommit={setAlignmentWin}');
    expect(artifactSource).toContain('returnFocusRef={alignmentToggleRef}');
    expect(artifactSource).toContain('maximizable');
    expect(artifactSource).toContain('aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`}');
    expect(artifactSource).toContain('data-maximized={maximized || undefined}');
    expect(artifactSource).toContain('const restoreRectRef = useRef(initial);');
    expect(artifactSource).toContain(': clampWindowRect(restoreRectRef.current);');
    expect(artifactSource).toContain('<ClaudeScienceMsaViewer');
    expect(artifactCss).toMatch(/\.motif-cs-alignment-tool-body\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*10px;[\s\S]*?padding:\s*12px;/);
    expect(artifactCss).toMatch(/\.motif-cs-alignment-launch\s*\{[\s\S]*?width:\s*100%;[\s\S]*?white-space:\s*normal;/);
    const floatingWindow = sliceBetween(artifactCss, '.motif-cs-window {', '.motif-cs-window-head {');
    expect(artifactCss).toContain('--shadow-ink: #000000;');
    expect(floatingWindow).toContain('var(--shadow-ink)');
    expect(floatingWindow).not.toContain('var(--text-secondary)');
  });

  it('publishes transactional runtime APIs and honest external-engine guidance', () => {
    expect(artifactSource).toContain('motifAddAlignments?: (alignmentOrAlignments: ArtifactAlignmentInput | ArtifactAlignmentInput[]) => number;');
    expect(artifactSource).toContain('motifGetAlignments?: () => ArtifactAlignmentInput[];');
    expect(artifactSource).toContain("'motifAddAlignments(alignmentOrAlignments)':");
    expect(artifactSource).toContain('window.motifAddAlignments = (alignmentOrAlignments) => {');
    expect(artifactSource).toContain("'MOTIF_INVALID_ALIGNMENT_INPUT'");
    expect(artifactSource).toContain("{ operation: 'motifAddAlignments', inputCount: raw.length, mutated: false }");
    expect(artifactSource).toContain('window.motifGetAlignments = () => payloadRef.current.alignments.map(serializeArtifactAlignment);');
    expect(artifactSource).toContain('Never claim the browser artifact executed MAFFT, MUSCLE, or Clustal Omega');
    expect(artifactSource).toContain('<span><strong>External engines</strong> run outside this HTML; imported results retain their actual provenance.</span>');
  });

  it('round-trips alignments through payload loading, recovery, dirty-state, database JSON, and ZIP exports', () => {
    expect(artifactSource).toContain('alignment?: ArtifactAlignmentInput;');
    expect(artifactSource).toContain('alignments?: ArtifactAlignmentInput[];');
    expect(artifactSource).toContain('const alignments = normalizeArtifactAlignments(payload.alignments ?? payload.alignment);');

    const recovery = sliceBetween(
      artifactSource,
      'function rememberLastGoodRuntimePayload(',
      'type RecordSummary =',
    );
    expect(recovery).toContain('alignments: payload.alignments.map(serializeArtifactAlignment),');
    expect(recovery).toContain('artifactState: normalizeArtifactDurableState(');

    const fingerprint = sliceBetween(
      artifactSource,
      'function artifactDurableFingerprint(',
      'function cleanMotif(',
    );
    expect(fingerprint).toContain('alignments: payload.alignments.map(serializeArtifactAlignment),');

    expect(artifactSource).toContain('alignments: payload.alignments.map(serializeArtifactAlignment),');
    expect(artifactSource).toContain('createArtifactDatabaseSnapshot({');
    expect(artifactSource).toContain("file(`alignments/${safeAlignmentFilename(alignment, 'aligned.fasta')}`, formatAlignedFasta(alignment))");
    expect(artifactSource).toContain("file(`alignments/${safeAlignmentFilename(alignment, 'aln')}`, formatClustal(alignment))");
    expect(artifactSource).toContain('const updateAlignmentTemplate = useCallback((alignmentId: string, rowId: string): ArtifactAlignment | null => {');
    expect(artifactSource).toContain('serializeArtifactAlignment({ ...alignment, referenceRowId: rowId })');
    expect(artifactSource).toContain('onUpdateAlignmentTemplate={updateAlignmentTemplate}');
    expect(viewerSource).toContain('export a workspace backup to keep it after reload.');
    expect(artifactSource).not.toContain('Added alignment to this session');
    expect(artifactSource).toContain('function uniqueAlignmentName(base: string, alignments: readonly ArtifactAlignment[]): string');
    expect(artifactSource).toContain('name: uniqueAlignmentName(alignment.name, current.alignments),');
  });
});

describe('Claude Science MSA interaction and rendering guards', () => {
  it('never auto-pairs the active record with an unrelated hidden workspace record', () => {
    const defaults = sliceBetween(viewerSource, 'function compatibleDefaultIds(', 'function engineMetadata(');
    expect(defaults).toContain("const activeGroup = active.group?.trim().toLocaleLowerCase();");
    expect(defaults).toContain('if (!activeGroup) return new Set([active.id]);');
    expect(defaults).toContain("record.group?.trim().toLocaleLowerCase() === activeGroup");
    expect(defaults).toContain('return new Set(partner ? [active.id, partner.id] : [active.id]);');
  });

  it('pins selected records above filtering and provides explicit selected-only and clear actions', () => {
    const filtering = sliceBetween(viewerSource, 'const filteredRecords = useMemo(() => {', 'const workEstimate = useMemo');
    expect(filtering).toContain('const selected = records.filter((record) => selectedIds.has(record.id));');
    expect(filtering).toContain('if (selectedOnly) return selected;');
    expect(filtering).toContain('!selectedIds.has(record.id)');
    expect(filtering).toContain('return [...selected, ...matchingUnselected];');
    expect(viewerSource).toContain('data-testid="msa-selected-only"');
    expect(viewerSource).toContain('aria-pressed={selectedOnly}');
    expect(viewerSource).toContain('data-testid="msa-clear-selection"');
    expect(viewerSource).toContain('onClick={clearSelectedRecords}');
    expect(viewerSource).toContain('<em>preview limit reached</em>');
  });

  it('owns file drops inside the MSA window and provides file-picker parity for records and aligned files', () => {
    expect(viewerSource).toContain('event.stopPropagation();');
    expect(viewerSource).toContain('data-testid="msa-drop-overlay"');
    expect(viewerSource).toContain('data-testid="msa-record-dropzone"');
    expect(viewerSource).toContain('aria-label="Choose sequence files for alignment"');
    expect(viewerSource).toContain('multiple');
    expect(viewerSource).toContain('data-testid="msa-alignment-dropzone"');
    expect(viewerSource).toContain('aria-label="Choose a pre-aligned sequence file"');
    expect(viewerSource).toContain('void importRecordFiles(files);');
    expect(artifactSource).toContain('onImportRecords={importMsaRecords}');
    expect(artifactCss).toMatch(/\.motif-cs-msa-drop-overlay\s*\{[\s\S]*?pointer-events:\s*none/);
  });

  it('treats terminal gaps as uncovered flanks while retaining covered indels and substitutions', () => {
    const coverageHelpers = sliceBetween(viewerSource, 'type AlignmentCoverage =', 'function useObservedWidth');
    expect(coverageHelpers).toContain("const first = aligned.search(/[^-]/);");
    expect(coverageHelpers).toContain('column >= coverage.first && column <= coverage.last');
    expect(coverageHelpers).toContain('export function classifyMsaCell(');
    expect(coverageHelpers).toContain("if (rowResidue === '-' && !isColumnCoveredByRow) return 'uncovered';");
    expect(coverageHelpers).toContain('!coversColumn(referenceCoverage, column)');
    expect(coverageHelpers).toContain('coversColumn(rowCoverage.get(row.id) ?? null, column)');
    expect(coverageHelpers).toContain('classifyMsaCell(templateSymbol, symbol, coversColumn(rowCoverage, column))');
    expect(coverageHelpers).toContain('classifyMsaCell(templateSymbol, symbol, coversColumn(rowCoverage[rowIndex], column))');
  });

  it('runs browser alignment only from an explicit bounded action', () => {
    const runHandler = sliceBetween(viewerSource, 'const runLocalAlignment = () => {', 'const importAlignment = () => {');
    expect(runHandler).toContain('createLocalArtifactAlignment(alignmentRecords');
    expect(runHandler).toContain('setRunning(true);');
    expect(runHandler).toContain('setRunning(false);');
    expect(viewerSource).toContain('data-testid="msa-run-button"');
    expect(viewerSource).toContain('disabled={selectedRecords.length < 2 || exceedsLocalBudget || running}');
    expect(viewerSource).toContain('onClick={runLocalAlignment}');
    expect(viewerSource).toContain("{running ? 'Aligning…' : activeAlignment ? 'Align as new result' : 'Align in browser'}");
  });

  it('makes result reconfiguration explicit while preserving the current alignment', () => {
    expect(viewerSource).toContain('<strong>Inputs &amp; alignment settings</strong>');
    expect(viewerSource).toContain("activeAlignment ? <p className=\"motif-cs-msa-source-guide\">Changes create a new alignment; the current result stays available in this session.</p>");
    expect(viewerSource).toContain('data-testid="msa-edit-inputs"');
    expect(viewerSource).not.toContain('aria-expanded={sourceOpen}');
    expect(viewerSource).toContain('aria-controls="motif-cs-msa-source-body"');
    expect(viewerSource).toContain('sourceSummaryRef.current?.focus({ preventScroll: true });');
    expect(viewerSource).toContain("activeAlignment ? 'Import as new alignment' : 'Import alignment'");
    expect(artifactCss).toMatch(/\.motif-cs-msa-source > summary\s*\{[\s\S]*?min-height:\s*44px/);
    expect(artifactCss).toMatch(/\.motif-cs-msa-source-chevron\s*\{[\s\S]*?transition:/);
  });

  it('lets Sanger users choose a template and explicitly auto-orient linked AB1 reads', () => {
    expect(viewerSource).toContain("const [localTemplateId, setLocalTemplateId] = useState(activeRecordId ?? '');");
    expect(viewerSource).toContain('const [autoOrientTraces, setAutoOrientTraces] = useState(true);');
    expect(viewerSource).toContain('<span>Auto-orient AB1 reads</span>');
    expect(viewerSource).toContain('preferredTraceOrientation(record.sequence, templateRecord.sequence)');
    expect(viewerSource).toContain('return { ...record, sequence: reverseComplement(record.sequence) };');
    expect(viewerSource).toContain('referenceRowId: templateRow?.id ?? alignment.referenceRowId');
    expect(viewerSource).toContain('bounded k-mer strand check');
  });

  it('captures imported engine provenance while stating that the viewer did not run it', () => {
    const importHandler = sliceBetween(viewerSource, 'const importAlignment = () => {', 'const loadAlignmentFile = async');
    expect(viewerSource).toContain("const [importEngine, setImportEngine] = useState('imported');");
    expect(importHandler).toContain('saveAlignment(parseAlignmentText(alignedFasta, {');
    expect(importHandler).toContain('engine: engineMetadata(importEngine, importVersion),');
    expect(importHandler).toContain("note: 'Imported from pre-aligned FASTA or CLUSTAL text; the artifact did not execute the external alignment engine.'");
    expect(viewerSource).toContain('<span>Created with</span>');
    expect(viewerSource).toContain('<option value="mafft">MAFFT</option>');
    expect(viewerSource).toContain('<option value="muscle">MUSCLE</option>');
    expect(viewerSource).toContain('<option value="clustal-omega">Clustal Omega</option>');
    expect(viewerSource).toContain('This label records the engine you used; it is never a silent fallback.');
    expect(viewerSource).toContain('if (file.size > ARTIFACT_MSA_MAX_IMPORT_BYTES)');
    expect(viewerSource).toContain('function formatInputFasta(records: readonly ViewerRecord[]): string');
    expect(viewerSource).toContain('.slice(0, INPUT_FASTA_HEADER_MAX_LENGTH);');
    expect(viewerSource).toContain('usedHeaders.has(header.toLowerCase())');
    expect(viewerSource).toContain('data-testid="msa-copy-input-fasta"');
    expect(viewerSource).toContain('data-testid="msa-download-input-fasta"');
    expect(viewerSource).toContain("selectedType === 'rna'");
    expect(viewerSource).toContain('Unaligned RNA FASTA for MAFFT, MUSCLE, or Clustal Omega');
    expect(viewerSource).toContain('Unaligned FASTA for run-msa.mjs, MAFFT, MUSCLE, or Clustal Omega');
  });

  it('requires a second explicit action before deleting an alignment from the session', () => {
    expect(viewerSource).toContain('const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);');
    expect(viewerSource).toContain('pendingDeleteId === activeAlignment.id');
    expect(viewerSource).toContain('aria-label="Confirm alignment deletion"');
    expect(viewerSource).toContain('data-testid="msa-confirm-delete"');
  });

  it('exposes selected state to assistive technology for every segmented presentation control', () => {
    expect(viewerSource).toContain("aria-pressed={sourceMode === 'records'}");
    expect(viewerSource).toContain("aria-pressed={sourceMode === 'import'}");
    expect(viewerSource).toContain("aria-pressed={displayMode === 'viewer'}");
    expect(viewerSource).toContain("aria-pressed={displayMode === 'text'}");
    expect(viewerSource).toContain("aria-pressed={emphasis === 'differences'}");
    expect(viewerSource).toContain("aria-pressed={emphasis === 'letters'}");
    expect(viewerSource).toContain("checked={colorMode === 'residue'}");
    expect(viewerSource).toContain('aria-label={`Use ${row.name} as template`}');
    expect(viewerSource).toContain('aria-pressed={isTemplate}');
    expect(viewerSource).toContain('role="region"');
    expect(viewerSource).toContain('aria-label={`Alignment matrix, ${alignment.rows.length} rows by ${alignment.alignmentLength} columns. Scroll horizontally to inspect columns.`}');
    expect(viewerSource).toContain('Use the Columns slider, Shift plus wheel, or Left and Right arrow keys to pan.');
    expect(viewerSource).toContain('Switch to Text to read or copy the complete aligned sequences with assistive technology.');
    expect(viewerSource).toContain('aria-live="polite"');
  });

  it('restores dense matrix review position after switching through Text or Traces', () => {
    expect(viewerSource).toContain('const msaMatrixViewportSession = new Map');
    expect(viewerSource).toContain('const initialViewport = useMemo(() => msaMatrixViewportSession.get(alignment.id)');
    expect(viewerSource).toContain('viewport.scrollLeft = saved?.left ?? 0;');
    expect(viewerSource).toContain('viewport.scrollTop = saved?.top ?? 0;');
    expect(viewerSource).toContain('msaMatrixViewportSession.set(alignment.id, { left, top });');
    expect(viewerSource).toContain('msaMatrixViewportSession.delete(alignment.id);');
  });

  it('uses explicit template vocabulary, pairwise stats, stable sorting, and distinguishing name suffixes', () => {
    expect(viewerSource).toContain('<span>Compare against</span>');
    expect(viewerSource).toContain('Alignment position');
    expect(viewerSource).toContain('data-template={isTemplate || undefined}');
    expect(viewerSource).toContain('return template ? [template, ...nonTemplateRows] : nonTemplateRows;');
    expect(viewPreferencesSource).toContain("export type ClaudeScienceMsaRowSortMode = 'original' | 'name' | 'identity' | 'mismatches';");
    expect(viewerSource).toContain('<option value="mismatches">Mismatches</option>');
    expect(viewerSource).toContain('pairwiseRowStats(row.aligned, template?.aligned ?? \'\')');
    expect(viewerSource).toContain('{stats.mismatches.toLocaleString()}Δ');
    expect(viewerSource).toContain('{stats.ungappedLength.toLocaleString()} {sequenceUnit(alignment.molecule)}');
    expect(viewerSource).toContain("Array.from(name.matchAll(/[^\\s_./-]+/g))");
    expect(artifactCss).toMatch(/\.motif-cs-msa-matrix-row\[data-template="true"\][\s\S]*?background:\s*color-mix\(in srgb, var\(--accent\) 7%, var\(--bg-primary\)\)[\s\S]*?box-shadow:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-msa-row-name-leading\s*\{[\s\S]*?flex:\s*0 1 auto/);
    expect(artifactCss).toMatch(/\.motif-cs-msa-row-name-trailing\s*\{[\s\S]*?flex:\s*0 0 auto/);
  });

  it('adds exact dual-coordinate navigation and a gap-correct virtualized template axis', () => {
    const matrix = sliceBetween(viewerSource, 'function AlignmentMatrix({', 'export function ClaudeScienceMsaViewer({');
    expect(viewerSource).toContain('function templatePositionCoordinates(aligned: string): Array<number | null>');
    expect(viewerSource).toContain("if (aligned[column] === '-') coordinates[column] = null;");
    expect(viewerSource).toContain('position += 1;');
    expect(matrix).toContain("() => templatePositionCoordinates(template?.aligned ?? '')");
    expect(matrix).toContain('templateCoordinates.slice(startColumn, endColumn)');
    expect(matrix).toContain("data-template-position={position === null ? 'gap' : String(position)}");
    expect(matrix).toContain('aria-rowcount={tableRowCount}');
    expect(matrix).toContain('aria-rowindex={firstSequenceRow + rowIndex}');
    expect(matrix).toContain('Alignment positions count gapped columns. Template positions count non-gap residues');
    expect(viewerSource).toContain('data-testid="msa-coordinate-system"');
    expect(viewerSource).toContain('data-testid="msa-coordinate-input"');
    expect(viewerSource).toContain("coordinateSystem === 'alignment' ? 'Go to alignment column' : 'Go to template position'");
    expect(viewerSource).toContain('min={1}');
    expect(viewerSource).toContain("templatePositionCoordinates(template?.aligned ?? '').findIndex((position) => position === requested)");
    expect(viewerSource).toContain('setJumpColumn(column);');
    expect(viewerSource).toContain('setJumpToken((token) => token + 1);');
    expect(viewerSource).toContain('role="status" aria-live="polite"');
    expect(artifactCss).toMatch(/\.motif-cs-msa-template-ruler-row\s*\{[\s\S]*?top:\s*27px/);
  });

  it('persists a lean, resettable view menu and computes dynamic table rows', () => {
    expect(viewPreferencesSource).toContain('showOverview: boolean;');
    expect(viewPreferencesSource).toContain('showConsensus: boolean;');
    expect(viewPreferencesSource).toContain('DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES');
    expect(viewerSource).toContain('data-testid="msa-view-menu-button"');
    expect(viewerSource).toContain('data-testid="msa-view-menu-status"');
    expect(viewerSource).toContain('Reset alignment view');
    expect(viewerSource).toContain('const axisRows = Number(visibility.showAlignmentAxis) + Number(visibility.showTemplateAxis);');
    expect(viewerSource).toContain('const tableRowCount = axisRows');
    expect(viewerSource).toContain('Number(visibility.showConservation)');
    expect(viewerSource).toContain('Number(visibility.showConsensus)');
    expect(artifactSource).toContain("const MSA_VIEW_STORAGE_KEY = 'motif.claude-science.msa-view.v1';");
    expect(artifactCss).toMatch(/\.motif-cs-msa-toolbar\s*\{[\s\S]*?position:\s*sticky/);
  });

  it('offers a bounded mismatch overview with viewport, pointer drag, and keyboard navigation', () => {
    const overview = sliceBetween(viewerSource, 'const overviewBinCount =', 'const renderSymbols =');
    expect(overview).toContain('Math.min(512, Math.max(1, alignment.alignmentLength))');
    expect(overview).toContain('mismatchOverviewBins(alignment');
    expect(viewerSource).toContain('data-testid="msa-overview"');
    expect(viewerSource).toContain('role="slider"');
    expect(viewerSource).toContain('onPointerMove={(event) => {');
    expect(viewerSource).toContain('setPointerCapture(event.pointerId)');
    expect(viewerSource).toContain("event.key === 'PageDown'");
    expect(viewerSource).toContain("event.key === 'Home'");
    expect(viewerSource).toContain("event.key === 'End'");
    expect(viewerSource).toContain('data-testid="msa-overview-viewport"');
    expect(artifactCss).toMatch(/\.motif-cs-msa-overview\s*\{[\s\S]*?touch-action:\s*none/);
  });

  it('renders only a scroll-windowed symbol slice while retaining full logical dimensions', () => {
    const matrix = sliceBetween(viewerSource, 'function AlignmentMatrix({', 'export function ClaudeScienceMsaViewer({');
    expect(matrix).toContain('const overscan = 24;');
    expect(matrix).toContain('Math.floor(scrollLeft / cellWidth),');
    expect(matrix).toContain('const startColumn = Math.max(0, visibleStartColumn - overscan);');
    expect(matrix).toContain('const endColumn = Math.min(alignment.alignmentLength, visibleEndColumn + overscan);');
    expect(matrix).toContain('Array.from(sequence.slice(startColumn, endColumn))');
    expect(matrix).toContain('alignment.conserved.slice(startColumn, endColumn)');
    expect(matrix).toContain('aria-colcount={alignment.alignmentLength}');
    expect(matrix).not.toContain('Array.from(sequence).map');
    expect(artifactCss).toMatch(/\.motif-cs-msa-matrix-scroll\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-msa-matrix-scroll\s*\{[\s\S]*?overscroll-behavior-x:\s*contain;[\s\S]*?overscroll-behavior-y:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-msa-sticky-label\s*\{[\s\S]*?position:\s*sticky/);
    expect(viewerSource).toContain('className="motif-cs-msa-row-name-trailing"');
  });

  it('provides a persistent sequence-aligned pan lane plus explicit wheel and keyboard navigation', () => {
    const matrix = sliceBetween(viewerSource, 'function AlignmentMatrix({', 'export function ClaudeScienceMsaViewer({');
    expect(matrix).toContain('data-testid="msa-horizontal-scroll-row"');
    expect(matrix).toContain('data-testid="msa-horizontal-scroll"');
    expect(matrix).toContain('aria-label="Horizontal alignment scroll"');
    expect(matrix).toContain('const handleMatrixWheel = useCallback((event: WheelEvent) => {');
    expect(matrix).toContain('event.deltaMode === WheelEvent.DOM_DELTA_LINE');
    expect(matrix).toContain('const horizontalDelta = (event.shiftKey ? event.deltaY : event.deltaX) * deltaScale;');
    expect(matrix).toContain("const windowBody = viewport.closest<HTMLElement>('.motif-cs-window-body');");
    expect(matrix).toContain("viewport.addEventListener('wheel', handleMatrixWheel, { passive: false });");
    expect(matrix).toContain('const handleMatrixKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {');
    expect(matrix).toContain("else if (event.key === 'PageDown') target = viewport.scrollLeft + sequenceViewportWidth;");
    expect(artifactCss).toMatch(/\.motif-cs-msa-pan-row\s*\{[\s\S]*?grid-template-columns:\s*var\(--motif-cs-msa-label-width, 180px\) minmax\(0, 1fr\)/);
    expect(artifactCss).toMatch(/\.motif-cs-msa-pan-range\s*\{[\s\S]*?height:\s*24px/);
    expect(artifactCss).toContain('var(--motif-cs-msa-pan-thumb-width, 36px)');
  });
});
