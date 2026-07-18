import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const dataSettingsSource = readFileSync(resolve(here, '..', 'ClaudeScienceDataSettings.tsx'), 'utf8');

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start);
  expect(end, `missing end marker after ${startNeedle}: ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Claude Science workspace layout guards', () => {
  it('offers four canonical themes and migrates the two legacy theme ids', () => {
    expect(artifactSource).toContain("type ArtifactThemeName = 'light' | 'dark' | 'claude-light' | 'claude-dark';");
    expect(artifactSource).toContain("{ id: 'light', label: 'Light', description: 'Neutral surface · blue' }");
    expect(artifactSource).toContain("{ id: 'dark', label: 'Dark', description: 'Deep neutral · blue' }");
    expect(artifactSource).toContain("{ id: 'claude-light', label: 'Claude Light', description: 'Warm paper · coral' }");
    expect(artifactSource).toContain("{ id: 'claude-dark', label: 'Claude Dark', description: 'Warm charcoal · coral' }");
    expect(artifactSource).toContain("if (value === 'claude') return 'claude-light';");
    expect(artifactSource).toContain("if (value === 'tokyo') return 'claude-dark';");
    expect(artifactSource).not.toContain("label: 'Claude Beige'");
    expect(artifactCss).toContain('html[data-theme="claude-light"]');
    expect(artifactCss).toContain('html[data-theme="claude-dark"]');
    expect(artifactCss).not.toContain('html[data-theme="tokyo"]');
    expect(artifactSource).toContain('data-map-mode={layout.mode}');
    expect(artifactSource).toContain('data-theme={mapTheme}');
    expect(artifactSource).toContain('applyArtifactTheme(loadWorkspaceLayoutPrefs().theme);');
    expect(artifactSource).toContain("document.querySelector<HTMLMetaElement>('meta[name=\"theme-color\"]')");
    expect(artifactSource).toContain("description: 'Warm paper · coral'");
    expect(artifactSource).toContain("description: 'Warm charcoal · coral'");
    expect(artifactCss).toContain('.motif-cs-theme-choice[data-theme-choice="claude-light"]');
    expect(artifactCss).toContain('--theme-preview-claude-light-surface: #f9f9f7;');
    expect(artifactCss).toContain('--theme-preview-claude-dark-surface: #2d2d2b;');
    expect(artifactCss).toContain('--choice-accent: var(--theme-preview-claude-accent);');
  });

  it('resets pane geometry without silently changing the selected appearance', () => {
    const resetLayout = sliceBetween(
      artifactSource,
      'const resetWorkspaceLayout = useCallback',
      'const toggleToolsPinned = useCallback',
    );
    expect(resetLayout).toContain('clearWorkspaceLayoutPrefs();');
    expect(resetLayout).toContain('setPreferredPaneWidths({ ...DEFAULT_WORKSPACE_LAYOUT.paneWidths });');
    expect(resetLayout).not.toContain('setTheme(');
    expect(artifactSource).toContain('onResetDisplayPreferences={resetDisplayPreferences}');
    expect(dataSettingsSource).toContain('Reset display');
  });

  it('does not count the permanent Tools rail as workspace content', () => {
    expect(artifactSource).toContain(
      "const CONTENT_PANE_KEYS: readonly Exclude<PaneKey, 'tools'>[] = ['inventory', 'sequence', 'map'];",
    );

    const normalizeVisibility = sliceBetween(
      artifactSource,
      'function normalizePaneVisibility(',
      'function normalizePaneOrder(',
    );
    expect(normalizeVisibility).toContain(
      'if (!CONTENT_PANE_KEYS.some((key) => next[key])) next.sequence = true;',
    );

    const togglePane = sliceBetween(
      artifactSource,
      'const togglePane = useCallback(',
      'const reorderPane = useCallback(',
    );
    expect(togglePane).toContain(
      'const openContentCount = CONTENT_PANE_KEYS.filter((key) => current[key]).length;',
    );
    expect(togglePane).toContain(
      "if (pane !== 'tools' && current[pane] && openContentCount <= 1) return current;",
    );
  });

  it('keeps the active record tab visible without scrolling the workspace', () => {
    expect(artifactSource).toContain('const recordTabsRef = useRef<HTMLElement | null>(null);');
    expect(artifactSource).toContain('ref={recordTabsRef}');
    expect(artifactSource).toContain("tabs?.querySelector<HTMLElement>('.motif-cs-record-tab[data-active=\"true\"]')");
    expect(artifactSource).toContain("tabs.scrollTo({ left: tabRight - tabs.clientWidth, behavior: 'auto' })");
  });

  it('only advertises pane reordering where the rendered layout can honor it', () => {
    expect(artifactSource).toContain('const paneReorderAvailable = workspaceMainSize.width >= 1536;');
    expect(artifactSource).toContain('draggable={paneReorderAvailable}');
    expect(artifactSource).toContain("'Pane visibility controls. Compact layouts use a stable workspace arrangement.'");
    expect(artifactSource).toContain("paneReorderAvailable ? '; drag or use Alt+Shift+Left/Right Arrow to reorder' : ''");
    expect(artifactSource).toContain('onKeyDown={(event) => handlePaneToggleKeyDown(pane, event)}');
  });

  it('uses roving keyboard focus for the record tablist', () => {
    expect(artifactSource).toContain('const handleRecordTabKeyDown = useCallback');
    expect(artifactSource).toContain("if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;");
    expect(artifactSource).toContain('tabIndex={active ? 0 : -1}');
    expect(artifactSource).toContain('onKeyDown={(event) => handleRecordTabKeyDown(event, index)}');
  });

  it('lets Escape close the floating window and returns focus to its trigger', () => {
    const floatingWindow = sliceBetween(
      artifactSource,
      'function FloatingWindow({',
      '// One stable Translate panel:',
    );

    expect(floatingWindow).toContain("window.addEventListener('keydown', closeFromEscape, true)");
    expect(floatingWindow).toContain("if (event.key !== 'Escape') return;");
    expect(floatingWindow).toContain('returnFocusRef?.current?.focus({ preventScroll: true })');
    expect(floatingWindow).toContain('onClick={closeWindow}');
    expect(artifactSource).toContain('returnFocusRef={translationsToggleRef}');
  });

  it('keeps sequence scrolling local to each open record', () => {
    expect(artifactSource).toContain('const sequenceScrollByRecordRef = useRef<Record<string, number>>({});');
    expect(artifactSource).toContain('const rememberActiveSequenceScroll = useCallback(() => {');
    expect(artifactSource).toContain('sequenceScrollByRecordRef.current[activeRecordId] = sequenceScroller.scrollTop;');
    expect(artifactSource).toContain('sequenceScroller.scrollTop = sequenceScrollByRecordRef.current[recordId] ?? 0;');
    expect(artifactSource).toContain('window.motifAddRecords = (recordOrRecords) => {');
    expect(artifactSource).toContain('const addRecord = useCallback((recordInput: ArtifactRecordInput): boolean => (');
    expect(artifactSource).toContain('onClick={() => selectRecord(record.id)}');
    expect(artifactSource).toContain('onSelect={selectRecord}');
  });

  it('starts switched and newly created records without a queued feature focus', () => {
    const selectRecord = sliceBetween(
      artifactSource,
      'const selectRecord = useCallback',
      'useLayoutEffect(() => {',
    );
    const addRecords = sliceBetween(
      artifactSource,
      'const addRecords = useCallback',
      'const addRecord = useCallback',
    );
    const addRecord = sliceBetween(
      artifactSource,
      'const addRecord = useCallback',
      'const updateRecordDetails = useCallback',
    );

    expect(selectRecord).toContain('setSelection(null);');
    expect(addRecords).toContain('setSelection(null);');
    expect(addRecord).not.toContain('nextRecord.features[0]');
    expect(artifactSource).toMatch(/window\.motifRenderInventory = \(entriesOrPayload\) => \{[\s\S]*?setSelection\(null\);/);
    expect(artifactSource).toMatch(/window\.motifAddRecords = \(recordOrRecords\) => \{[\s\S]*?setSelection\(null\);/);
  });

  it('keeps stacked-workspace position fixed while revealing a sequence selection', () => {
    const revealSequencePane = sliceBetween(
      artifactSource,
      'const revealSequencePaneIfStacked = useCallback',
      'const selectSequenceRangeAndReveal = useCallback',
    );

    expect(revealSequencePane).toContain("ensurePaneVisible('sequence');");
    expect(revealSequencePane).not.toContain('scrollIntoView');
  });

  it('keeps dense sequence annotations out of the sequential tab order', () => {
    expect(artifactSource).toContain('tabIndex={isStart && start === segmentStart ? 0 : -1}');
    expect(artifactSource).toContain('tabIndex={keyboardAnchorOnLine ? 0 : -1}');
    expect(artifactSource).toContain('tabIndex={residue.start === keyboardAnchorStart ? 0 : -1}');
    expect(artifactSource).toContain("if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return false;");
    expect(artifactSource).toContain('data-aa-track-id={trackId}');
  });

  it('supports keyboard resizing on workspace separators', () => {
    expect(artifactSource).toContain('const resizePaneFromKeyboard = useCallback');
    expect(artifactSource).toContain("if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;");
    expect(artifactSource).toContain('aria-valuenow={Math.round(width)}');
    expect(artifactSource).toContain('data-pane={pane}');
    expect(artifactSource).toContain('onKeyDown={(event) => onKeyDown(pane, event, edge)}');
    expect(artifactSource).toContain('const totalSlack = shrinkable.reduce(');
    expect(artifactSource).toContain('deficit * (slack / totalSlack)');
    expect(artifactSource).toContain("const STACKED_LAYOUT_MEDIA = '(max-width: 767px)';");
    expect(artifactSource).toContain("const TWO_ROW_LAYOUT_MEDIA = '(min-width: 640px) and (max-width: 1535px)';");
    expect(artifactSource).toContain("const OVERLAY_TOOLS_LAYOUT_MEDIA = '(max-width: 1535px)';");
    expect(artifactSource).toContain("sequence: { min: 240, max: 760 }");
    expect(artifactSource).toContain("map: { min: 300, max: 900 }");
    expect(artifactCss).toMatch(/\.motif-cs-resize-handle\[data-pane="sequence"\]\s*\{[\s\S]*?display:\s*block/);
    expect(artifactCss).toMatch(/@media \(min-width: 768px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="inventory"\],[\s\S]*?\.motif-cs-resize-handle\[data-pane="sequence"\][\s\S]*?display:\s*block/);
    expect(artifactCss).toMatch(/@media \(min-width: 1536px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="tools"\][\s\S]*?display:\s*block/);
    expect(artifactSource).toContain("const overlayTools = pane === 'tools' && overlayLayout;");
    expect(artifactSource).toContain("visibleResizablePanes.filter((pane) => pane !== 'tools')");
    expect(artifactSource).toContain("visibleResizablePanes.filter((pane) => pane === 'inventory' || pane === 'sequence')");
    expect(artifactSource).toContain('saveWorkspaceLayoutPrefs({ theme, paneWidths: preferredPaneWidths');
    expect(artifactSource).toContain('const next = clampPaneWidthsForViewport(preferredPaneWidths);');
    expect(artifactSource).toContain("'--motif-cs-inventory-pane-width': `${paneWidths.inventory}px`");
    expect(artifactSource).toContain("'--motif-cs-sequence-pane-width': `${paneWidths.sequence}px`");
    expect(artifactSource).toContain("'--motif-cs-map-pane-width': `${paneWidths.map}px`");
    expect(artifactSource).toContain('const paneResizeNeighbor = useCallback');
    expect(artifactSource).toContain('const resizePanePair = useCallback');
    expect(artifactSource).toContain('startWidths[neighbor] - neighborLimits.max');
    expect(artifactSource).toContain('startWidths[neighbor] - neighborLimits.min');
    expect(artifactSource).toContain('[neighbor]: startWidths[neighbor] - appliedDelta');
    expect(artifactSource).toContain('if (moveEvent.pointerId !== pointerId) return;');
    expect(artifactSource).toContain('if (endEvent.pointerId !== pointerId) return;');
    expect(artifactSource).toContain("window.addEventListener('pointercancel', handlePointerUp);");
    expect(artifactCss).toContain('var(--motif-cs-tools-pane-width, 280px)');
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="sequence"\]\s*\{[\s\S]*?display:\s*none/);
  });

  it('reflows a pinned compact workspace without overlaying or reserving a hidden map lane', () => {
    expect(artifactSource).toContain('data-tools-pinned={toolsPinned || undefined}');
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-main\[data-tools-pinned="true"\]\s*\{[\s\S]*?display:\s*grid/);
    expect(artifactCss).toContain('.motif-cs-main[data-tools-pinned="true"] > .motif-cs-stacked-resize-handle[data-pane="sequence"]');
    expect(artifactSource).toContain('COMPACT_PINNED_LAYOUT_MEDIA');
    expect(artifactSource).toContain("'--motif-cs-compact-top-row-height'");
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-tools-pinned="true"\] > \.motif-cs-sequence-column\s*\{[\s\S]*?grid-column:\s*3 \/ 6/);
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-tools-pinned="true"\] > \.motif-cs-map-column\s*\{[\s\S]*?grid-column:\s*1 \/ 4/);
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-tools-pinned="true"\] > \.motif-cs-inspector\[data-tools-pinned="true"\]\s*\{[\s\S]*?position:\s*relative/);
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-tools-pinned="true"\]\[data-map-hidden="true"\]\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\)/);
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-map-hidden="true"\] > \.motif-cs-sequence-column\s*\{[\s\S]*?flex-grow:\s*1/);
  });

  it('keeps compact resize limits synchronized with rendered grid caps', () => {
    expect(artifactSource).toContain("inventory: { min: 160, max: 280 }");
    expect(artifactSource).toContain("tools: { min: 240, max: 320 }");
    expect(artifactSource).toContain('const paneWidthLimitsForCurrentLayout = useCallback');
    expect(artifactSource).toContain("stableCompactTopology && visibleContentPanes.length === 3 && pane === 'inventory'");
    expect(artifactSource).toContain('Math.floor(workspaceMainSize.width * 0.38)');
    expect(artifactSource).toContain("const limits = paneWidthLimitsForCurrentLayout('inventory');");
    expect(artifactSource).toContain('limits={paneWidthLimitsForCurrentLayout(\'inventory\')}');
    expect(artifactSource).toContain('limits={paneWidthLimitsForCurrentLayout(\'tools\')}');
    expect(artifactSource).toContain('const workspaceRowResizeActive = compactRowResizeActive || twoRowResizeActive;');
    expect(artifactSource).toContain('const TWO_ROW_VERY_SHORT_MIN_HEIGHT = 120;');
    expect(artifactSource).toContain('if (total <= mainWidth) return widths;');
    expect(artifactSource).not.toContain('let spare = mainWidth - total;');
    expect(artifactSource).toContain("const compactRowMaxWidth = compactPinnedLayout && pane === 'inventory'");
    expect(artifactSource).toContain('mainWidth - resizeHandleWidth - PANE_WIDTH_LIMITS.sequence.min');
    expect(artifactSource).toContain('mainWidth - resizeHandleWidth - PANE_WIDTH_LIMITS.map.min');
  });

  it('keeps the short two-row workbench internally scrollable with a persistent rail', () => {
    expect(artifactSource).toContain('|| window.matchMedia(TWO_ROW_LAYOUT_MEDIA).matches');
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\)[\s\S]*?grid-template-rows:[\s\S]*?9px/);
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-stacked-resize-handle\[data-pane="sequence"\]\s*\{[\s\S]*?display:\s*block/);
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-main > \.motif-cs-sequence-column\s*\{[\s\S]*?overflow-y:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-main > \.motif-cs-sequence-column > \.motif-cs-sequence-panel\s*\{[\s\S]*?min-height:\s*280px/);
  });

  it('contains narrow grid panes and preserves a usable short map canvas', () => {
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 767px\)[\s\S]*?\.motif-cs-main\[data-content-pane-count="3"\] > \.motif-cs-sequence-column,[\s\S]*?height:\s*100% !important/);
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-content-pane-count="3"\] > \.motif-cs-sequence-column,[\s\S]*?\.motif-cs-main\[data-content-pane-count="3"\] > \.motif-cs-map-column\s*\{[\s\S]*?overflow-y:\s*auto/);
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\) and \(max-height: 620px\)[\s\S]*?\.motif-cs-map-frame\s*\{[\s\S]*?min-height:\s*120px/);
  });

  it('anchors the phone Tools rail and drawer below the visible top bar', () => {
    expect(artifactSource).toContain('const topbarRef = useRef<HTMLElement | null>(null);');
    expect(artifactSource).toContain("'--motif-cs-topbar-height': `${topbarHeight}px`");
    expect(artifactSource).toContain('<header ref={topbarRef}');
    expect(artifactCss).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.motif-cs-inspector\[data-tools-pinned="false"\],[\s\S]*?\.motif-cs-inspector\[data-tools-pinned="true"\]\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(--motif-cs-topbar-height,\s*38px\);[\s\S]*?bottom:\s*0/);
    expect(artifactCss).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.motif-cs-inspector\[data-tools-pinned="true"\]\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?overscroll-behavior:\s*contain/);
    expect(artifactCss).toMatch(/@media \(max-width: 639px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="tools"\]\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(--motif-cs-topbar-height,\s*38px\)/);
  });

  it('uses a roomy four-column bridge before pane reordering becomes available', () => {
    expect(artifactCss).toMatch(/@media \(min-width: 1536px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="tools"\]/);
    expect(artifactCss).not.toContain('@media (max-width: 1599px) {');
    expect(artifactSource).toContain('const paneReorderAvailable = workspaceMainSize.width >= 1536;');
  });

  it('keeps large sequence rendering local and skippable off screen', () => {
    expect(artifactCss).toMatch(/\.motif-cs-seq-block\s*\{[\s\S]*?content-visibility:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-seq-block\[data-seq-focus="true"\]\s*\{[\s\S]*?content-visibility:\s*visible/);
    expect(artifactCss).toMatch(/\.motif-cs-large-sequence\s*\{[\s\S]*?overflow:\s*auto[\s\S]*?font:\s*12px\/1\.65 var\(--font-mono\)/);
    expect(artifactCss).toMatch(/\.motif-cs-large-sequence-notice\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
    expect(artifactCss).toMatch(/\.motif-cs-large-sequence-value\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?font:\s*12px\/1\.65 var\(--font-mono\)[\s\S]*?resize:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-large-sequence-value:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--focus-ring\)/);
  });

  it('keeps compact sequence content scrollable and short workspaces escapable', () => {
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-tools-pinned="true"\] \.motif-cs-sequence-panel > \.motif-cs-sequence\s*\{[\s\S]*?min-height:\s*0/);
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\) and \(max-height: 620px\)[\s\S]*?minmax\(var\(--motif-cs-compact-bottom-row-min, 120px\), 1fr\)/);
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\) and \(max-height: 330px\)[\s\S]*?data-content-pane-count="3"[\s\S]*?overflow-y:\s*auto/);
    expect(artifactCss).toMatch(/data-inventory-hidden="true"\][\s\S]*?motif-cs-stacked-resize-handle\[data-pane="sequence"\][\s\S]*?grid-column:\s*1 \/ 4/);
    expect(artifactCss).toMatch(/\.motif-cs-sequence-tools-panel\[open\]\[data-resized="true"\] \.motif-cs-export-row,[\s\S]*?flex:\s*0 0 auto/);
  });

  it('supports vertical inventory and sequence resizing in the stacked Claude Science layout', () => {
    expect(artifactSource).toContain("type StackedResizablePaneKey = 'inventory' | 'sequence';");
    expect(artifactSource).toContain('const startStackedPaneResize = useCallback');
    expect(artifactSource).toContain("if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;");
    expect(artifactSource).toContain('aria-label={`Resize stacked ${label.toLowerCase()} pane`}');
    expect(artifactSource).toContain('aria-orientation="horizontal"');
    expect(artifactSource).toContain('onDoubleClick={() => onReset(pane)}');
    expect(artifactSource).toContain('stackedPaneHeights: normalizeStackedPaneHeights(source.stackedPaneHeights)');
    expect(artifactSource).toContain("pane=\"inventory\"");
    expect(artifactSource).toContain("pane=\"sequence\"");
    expect(artifactCss).toMatch(/@media \(max-width: 767px\)[\s\S]*?\.motif-cs-stacked-resize-handle\s*\{[\s\S]*?cursor:\s*ns-resize/);
    expect(artifactCss).toContain('var(--motif-cs-stacked-inventory-pane-height, min(176px, 20vh))');
    expect(artifactCss).toContain('var(--motif-cs-stacked-sequence-pane-height, clamp(360px, 47vh, 420px))');
    expect(artifactCss).toMatch(/\.motif-cs-sidebar\[data-stacked-resized="true"\][\s\S]*?max-height:\s*520px/);
    expect(artifactCss).toMatch(/\.motif-cs-sequence-column\[data-stacked-resized="true"\][\s\S]*?\.motif-cs-sequence-panel > \.motif-cs-sequence\s*\{[\s\S]*?max-height:\s*none/);
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 767px\)[\s\S]*?\.motif-cs-main > \.motif-cs-stacked-resize-handle\[data-pane="inventory"\]\s*\{[\s\S]*?display:\s*none/);
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 767px\)[\s\S]*?data-content-pane-count="3"[\s\S]*?\.motif-cs-resize-handle\[data-pane="inventory"\]\s*\{[\s\S]*?display:\s*block/);
  });

  it('lets split sequence and map canvases consume the available height', () => {
    expect(artifactCss).toMatch(/@media \(min-width: 768px\)[\s\S]*?\.motif-cs-sequence-panel\s*\{[\s\S]*?flex:\s*1 1 auto/);
    expect(artifactCss).toMatch(/\.motif-cs-sequence-panel > \.motif-cs-sequence\s*\{[\s\S]*?max-height:\s*none/);
    expect(artifactCss).toMatch(/@media \(min-width: 768px\)[\s\S]*?\.motif-cs-map-frame\s*\{[\s\S]*?flex:\s*1 1 auto/);
    expect(artifactSource).toContain('Math.floor(fit / 5) * 5');
  });

  it('avoids duplicate scroll tracks behind the narrow Tools overlay', () => {
    expect(artifactCss).toMatch(/@media \(max-width: 1535px\)[\s\S]*?\.motif-cs-main:has\(> \.motif-cs-inspector\[data-tools-pinned="true"\]\)\s*\{[\s\S]*?scrollbar-width:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-main:has\(> \.motif-cs-inspector\[data-tools-pinned="true"\]\)::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none/);
  });

  it('separates persistent sequence states from record-creation actions', () => {
    const editToolbar = sliceBetween(
      artifactSource,
      '<div className="motif-cs-edit-toolbar"',
      '{/* Always mounted so range-selection actions have a stable dock;',
    );
    expect(artifactSource).toContain('className="motif-cs-segmented motif-cs-edit-mode-toggle"');
    expect(artifactSource).toContain('aria-label="Typing mode"');
    expect(artifactSource).toContain('className="motif-cs-mini-button motif-cs-display-switch motif-cs-ds-toggle"');
    expect(artifactSource).toContain('<span className="motif-cs-label-full">Complement</span>');
    expect(artifactSource).toContain("{selectedInlineTranslationTrack ? 'Del AA' : 'Add AA'}");
    expect(artifactSource).toContain('disabled={!selectedInlineTranslationTrack && (!selectionActionTranslation || !canPinPreviewTranslation)}');
    expect(artifactSource).toContain('if (selectedInlineTranslationTrack) deleteTranslationLayer(selectedInlineTranslationTrack.id);');
    expect(artifactSource).toContain('addTranslationLayer();');
    expect(artifactSource).toContain('onTranslationTrackSelect={handleTranslationTrackSelectAndReveal}');
    expect(artifactSource).toMatch(/>\s*\+ Feature\s*<\/button>/);
    expect(artifactSource).toContain('<span className="motif-cs-label-full">Rev comp</span>');
    expect(artifactSource).toContain('<span className="motif-cs-label-short">RC</span>');
    expect(artifactSource).toMatch(/>\s*Protein\s*<\/button>/);
    expect(artifactSource).toContain("onClick={() => setSequenceViewMode('standard')}");
    expect(artifactSource).toContain("onClick={() => setSequenceViewMode('detail')}");
    expect(artifactSource).toContain('if (selectionSummary) {');
    expect(artifactSource).toContain('if (hasMaterializableSequenceSelection) addSelectionReverseComplementRecord();');
    expect(artifactSource).toContain('onClick={addContextReverseComplementRecord}');
    expect(artifactSource.match(/onClick=\{addContextReverseComplementRecord\}/g)).toHaveLength(1);
    expect(editToolbar).not.toContain('addContextReverseComplementRecord');
    expect(artifactSource).toContain('disabled={!isNucleotideRecord || (!!selectionSummary && !hasMaterializableSequenceSelection)} onClick={addContextReverseComplementRecord}');
    expect(artifactSource).toContain('className="motif-cs-edit-controls"');
    expect(artifactCss).toContain('.motif-cs-switch-track');
    expect(artifactCss).toContain('.motif-cs-view-toggle button[data-active]');
    expect(artifactCss).not.toMatch(/\.motif-cs-selection-bar\[data-empty\] \.motif-cs-selection-actions\s*\{[\s\S]*?display:\s*none/);
    expect(artifactCss).toMatch(/@container \(max-width: 560px\)[\s\S]*?\.motif-cs-selection-bar\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?min-height:\s*62px/);
    expect(artifactCss).toMatch(/@container \(max-width: 560px\)[\s\S]*?\.motif-cs-selection-bar\[data-empty\]\s*\{[\s\S]*?min-height:\s*62px/);
  });

  it('supports platform-standard map wheel modifiers', () => {
    expect(artifactSource).toContain('const handleCommandWheel = (event: globalThis.WheelEvent) => {');
    expect(artifactSource).toContain('if (!event.metaKey || event.ctrlKey) return;');
    expect(artifactSource).toContain("mapFrame.addEventListener('wheel', handleCommandWheel, { passive: false, capture: true })");
    expect(artifactSource).toContain('Ctrl/Command-wheel zooms');
    expect(artifactSource).toContain('if (ctrlKey) {');
    expect(artifactSource).toContain('const panX = (shiftKey && Math.abs(normalizedX) < 0.5 ? normalizedY : normalizedX) * panScale;');
  });

  it('uses a clicked amino acid codon as the next translation action target', () => {
    const selectTranslationCodon = sliceBetween(
      artifactSource,
      'const selectTranslationCodon = useCallback',
      'const copyText = useCallback',
    );

    expect(selectTranslationCodon).toContain('const target: TranslateTarget = {');
    expect(selectTranslationCodon).toContain('start: rangeStart,');
    expect(selectTranslationCodon).toContain('end: rangeEnd,');
    expect(selectTranslationCodon).toContain("defaultStrand: strand === -1 ? 'antisense' : strand === 1 ? 'sense' : translateStrand,");
    expect(selectTranslationCodon).toContain('setLockedTranslateTarget({ recordId, target });');
    expect(selectTranslationCodon).not.toContain('target: translateTarget');
    expect(selectTranslationCodon).toContain('setSelectedTranslationLayerByRecord');
    expect(artifactSource).toContain('onTranslationCodonSelect(\n                start,\n                end,\n                track.strand,\n                track.translationTableId,\n                track.featureId,\n                track.source,\n              );');
  });

  it('keeps genetic-code context synchronized across feature, pinned-track, and PCR flows', () => {
    expect(artifactSource).toContain("const TRANSLATION_CODE_FEATURE_TYPES: ReadonlySet<FeatureType> = new Set<FeatureType>(['cds', 'orf']);");
    expect(artifactSource).toContain('&& (feature.strand === 1 || feature.strand === -1)');
    expect(artifactSource).toContain('track.frame,\n      track.completeCds,\n      track.label,');
    expect(artifactSource).toContain("const translateTargetSemanticFeature = translateTarget.translationSource === 'layer'\n    ? null\n    : translateTargetFeature;");
    expect(artifactSource).toContain('const resetCapturedFeatureSemantics = track.needsReview || translationAnchorChanged;');
    expect(artifactSource).toContain('...(resetCapturedFeatureSemantics ? { completeCds: false, featureId: undefined } : {})');
    expect(artifactSource).toContain("if (track.needsReview) {\n      showWorkbenchNotice('Review and update this pinned translation before creating a protein.', 'error');");
    expect(artifactSource).toContain('const sourceRecord: PcrMaterializationSourceRecord = {\n      id: template.id,\n      name: template.name,\n      sequence: template.sequence,\n      type: \'dna\',\n      topology: template.topology,\n      translationTableId: template.translationTableId,');
    expect(artifactSource).toContain("generatedBy: 'reverse_complement_selection'");
    expect(artifactSource).toContain('metadata: selectedFeatureMetadata ?? {},');
    expect(artifactSource).toContain('selectedFeatureMetadata.partial = true;');
    expect(artifactSource).toContain('selectedFeatureMetadata.sourceMotifOriginalLocation = sourceOriginalLocation;');
    expect(artifactSource).toContain('? { ...layer, translationTableId }');
    expect(artifactSource).toContain("translationTableSource: translateTarget.translationSource === 'layer'");
    expect(artifactSource).toContain("translationTablePolicy: singleParentRecord\n            ? 'single-parent-inherited'\n            : 'unset-for-multi-parent-product'");
    expect(artifactSource).not.toContain("'shared-input-code'");
    expect(artifactCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(artifactCss).not.toContain('grid-template-columns: minmax(170px, 1fr) minmax(120px, auto);');
  });

  it('resets translation controls for record, target, and natural strand changes', () => {
    expect(artifactSource).toContain('[recordId, translateTarget.defaultFrame, translateTarget.defaultStrand, translateTargetKey]');
    expect(artifactSource).not.toContain('// eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on target change');
  });

  it('keeps plain map dragging available for range selection after zooming', () => {
    const pointerStart = sliceBetween(
      artifactSource,
      'const handleMapPointerStart = useCallback',
      'const handleMapPointerMove = useCallback',
    );
    expect(pointerStart).toContain("mode: 'range'");
    expect(pointerStart).not.toContain("mode: 'pan'");
    expect(pointerStart).not.toContain('mapViewport.k >');
    expect(artifactSource).toContain('data-map-interaction-surface');
    expect(artifactSource).toContain("target.closest('.motif-pm-feature, .motif-pm-restriction, .motif-pm-range-overlay[data-interactive=\"true\"]')");
    expect(artifactSource).toContain('onPointerDown={handleMapSurfacePointerDown}');
    expect(artifactCss).toMatch(/\.motif-cs-map-frame \.motif-pm-backbone\s*\{[\s\S]*?pointer-events:\s*none/);
  });

  it('accepts extended protein symbols and classifies Type IIS from enzyme geometry', () => {
    expect(artifactSource).toContain('/^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/');
    expect(artifactSource).toContain('function restrictionEnzymeIsTypeIIS(enzyme: RestrictionEnzyme | undefined)');
    expect(artifactSource).toContain('Math.max(enzyme.cutOffset, enzyme.complementCutOffset) > recognitionLength');
    expect(artifactSource).not.toContain('function restrictionSiteIsTypeIIS');
  });

  it('reveals restriction cut geometry contextually and exposes exact staggered bonds', () => {
    expect(artifactSource).toContain('const [hoveredRestrictionTickIds, setHoveredRestrictionTickIds]');
    expect(artifactSource).toContain('restrictionSelectionHasSite(activeRestrictionTickSet, site)');
    expect(artifactSource).toContain('onPointerEnter={() => setHoveredRestrictionTickIds(label.sites.map(restrictionSiteTickId))}');
    expect(artifactSource).toContain('onFocus={() => setHoveredRestrictionTickIds(label.sites.map(restrictionSiteTickId))}');
    expect(artifactSource).toContain('data-cut-bond={senseCut}');
    expect(artifactSource).toContain('data-cut-bond={antisenseCut}');
  });

  it('uses the validated full enzyme catalog without coupling digest recipes to map-source changes', () => {
    expect(artifactSource).toContain('const recipe = useMemo(() => buildDigestRecipe({');
    expect(artifactSource).toContain("() => restrictionEnzymesForSources(['all'], customEnzymes)");
    expect(artifactSource).toContain('if (previousRecordIdRef.current === record.id) return;');
    expect(artifactSource).toContain('Use visible cutters');
    expect(artifactSource).toContain('const targetRecordId = selectedRecordIdRef.current ?? recordId;');
    expect(artifactSource).toContain('setEnzymeSourcesByRecord((current) => ({ ...current, [targetRecordId]: next }));');
  });

  it('makes floating tools focusable and keyboard movable and resizable', () => {
    expect(artifactSource).toContain('windowRef.current?.focus({ preventScroll: true })');
    expect(artifactSource).toContain('const moveFromKeyboard = useCallback');
    expect(artifactSource).toContain('const resizeFromKeyboard = useCallback');
    expect(artifactSource).toContain('aria-label={`Resize ${title} window in 2 dimensions. Left and Right Arrow change width; Up and Down Arrow change height.`}');
    expect(artifactSource).toContain('aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"');
    expect(artifactCss).toContain('.motif-cs-window-resize:focus-visible');
    expect(artifactCss).toMatch(/\.motif-cs-window-resize\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px/);
    expect(artifactCss).toContain('.motif-cs-shell:has(.motif-cs-inspector[data-tools-pinned="false"]) .motif-cs-window-resize {\n    right: 58px;');
  });

  it('limits floating-window drags to the initiating primary pointer', () => {
    expect(artifactSource).toContain('if (!event.isPrimary || event.button !== 0) return;');
    expect(artifactSource).toContain('pointerId: event.pointerId,');
    expect(artifactSource).toContain('if (moveEvent.pointerId !== dragRef.current?.pointerId) return;');
    expect(artifactSource).toContain('if (endEvent.pointerId !== dragRef.current?.pointerId) return;');
    expect(artifactSource).toContain("window.addEventListener('pointerup', endDrag);");
    expect(artifactSource).not.toContain("window.addEventListener('pointerup', endDrag, { once: true });");
  });

  it('opens wide-desktop Export and Copy tall enough to show its sequence preview', () => {
    expect(artifactSource).toContain('resizeExportPanelTo(340)');
    expect(artifactCss).toContain('.motif-cs-sequence-preview');
  });

  it('copies reverse features in feature orientation from the keyboard path', () => {
    expect(artifactSource).toContain('text = sequenceForFeature(sequence, selectedFeature, sequenceType);');
    expect(artifactSource).toContain('[selectedFeature, selectedMapRange, sequence, sequenceType, topology');
  });

  it('serializes native mouse-selected bases without embedded annotation text', () => {
    expect(artifactSource).toContain('const selectionIsInsideSequence = Boolean(');
    expect(artifactSource).toContain("event.clipboardData.setData('text/plain', sequenceForRange(sequence, selectedMapRange, topology));");
    expect(artifactSource).toContain('[selectedAaTrackText, selectedMapRange, sequence, topology, writeSelectedAaToClipboard]');
  });

  it('adds fading radial start and end edges without outlining circular selection arcs', () => {
    expect(artifactSource).toContain('function artifactSelectionOverlayPaths(');
    expect(artifactSource).toContain('const radialBoundary = (bp: number) =>');
    expect(artifactSource).toContain('artifactSelectionOverlayPaths(layout, visibleMapRanges)');
    expect(artifactCss).toMatch(/\.motif-cs-map-frame\[data-map-mode="circular"\][\s\S]*?\.motif-pm-selection:nth-child\(3n \+ 2\)/);
    expect(artifactCss).toContain('fill-opacity: 0.9;');
    expect(artifactCss).toContain('stroke: none;');
  });

  it('keeps expanded floating tools movable and resizable at Claude Science widths', () => {
    expect(artifactSource).toContain('const minW = Math.min(280');
    expect(artifactSource).toContain('const minH = Math.min(180');
    expect(artifactSource).toContain('w: clamp(drag.base.w + dx, 280');
    expect(artifactSource).toContain('h: clamp(drag.base.h + dy, 180');
    expect(artifactCss).toMatch(/@media \(max-width: 840px\)[\s\S]*?\.motif-cs-window\s*\{\s*border-color:/);
    expect(artifactCss).toMatch(/@media \(max-width: 840px\)[\s\S]*?\.motif-cs-window\[data-collapsed\]\s*\{[\s\S]*?left:\s*8px !important;[\s\S]*?width:\s*calc\(100vw - 16px\) !important/);
    expect(artifactCss).not.toMatch(/@media \(max-width: 840px\)[\s\S]*?\.motif-cs-window\s*\{[\s\S]*?height:\s*min\(30vh, 240px\) !important/);
  });

  it('uses one compact Export scroll owner and retains wide-desktop resizing', () => {
    const exportPanel = sliceBetween(
      artifactSource,
      'function SequenceToolsPanel({',
      '/**\n * A floating, draggable, resizable, closable window',
    );

    expect(exportPanel).toContain('startExportPanelResize');
    expect(exportPanel).toContain("event.key !== 'ArrowUp' && event.key !== 'ArrowDown'");
    expect(exportPanel).toContain('const sequenceChromeHeight = Math.max(0, sequenceViewportRect.top - sequencePanelRect.top);');
    expect(exportPanel).toContain('const available = columnRect.height - topReserve - bottomReserve - sequenceChromeHeight - 160;');
    expect(exportPanel).toContain('aria-label="Resize Export and Copy panel"');
    expect(exportPanel).toContain('if (window.matchMedia(OVERLAY_TOOLS_LAYOUT_MEDIA).matches) return null;');
    expect(exportPanel).toContain("window.addEventListener('resize', syncExportPanelHeight);");
    expect(exportPanel).toContain('if (exportPanelHeight === null) {');
    expect(exportPanel).toContain('top: column.scrollTop + panelRect.top - columnRect.top,');
    expect(exportPanel).toContain('onDoubleClick={() => resizeExportPanelTo(340)}');
    expect(artifactCss).toMatch(/\.motif-cs-export-resize-handle\s*\{[\s\S]*?cursor:\s*ns-resize/);
    expect(artifactCss).toContain('var(--motif-cs-export-panel-height, 220px)');
    expect(artifactCss).toMatch(/\.motif-cs-sequence-tools-panel\[open\]\[data-resized="true"\] \.motif-cs-export-body\s*\{[\s\S]*?overscroll-behavior:\s*contain;[\s\S]*?scrollbar-gutter:\s*stable/);
    expect(artifactCss).toMatch(/\.motif-cs-sequence-preview\s*\{[\s\S]*?max-height:\s*min\(52vh, 520px\)[\s\S]*?overflow:\s*auto/);
  });

  it('previews the selected export payload instead of always showing raw sequence', () => {
    expect(artifactSource).toContain('const exportPreview = exportChoice?.content');
    expect(artifactSource).toContain("exportChoice?.id === 'inventory-zip'");
    expect(artifactSource).toContain("exportChoice?.id === 'report-print'");
    expect(artifactSource).toContain('value={exportPreview} aria-label="Selected export preview"');
    expect(artifactSource).not.toContain('value={preview} aria-label="Copyable sequence preview"');
  });

  it('exports each record with its own restriction-enzyme source settings', () => {
    expect(artifactSource).toContain('const itemSources = enzymeSourcesByRecord[item.id] ?? DEFAULT_ENZYME_SOURCES;');
    expect(artifactSource).toContain('resolveEnzymeUnion(itemSources)');
    expect(artifactSource).toContain('[customEnzymes, enzymeSourcesByRecord, exportRecords, needsInventoryExport]');
    expect(artifactSource).not.toContain('recordSitesForExport(item, scanEnzymes)');
  });

  it('collapses absent intermediate-width pane tracks and preserves wider-layout preferences', () => {
    expect(artifactSource).toContain('data-content-pane-count={visibleContentPaneCount}');
    expect(artifactSource).toContain("&& visibleContentPanes.length === 3");
    expect(artifactSource).toContain("if (twoRowLayout && pane === 'inventory') return 'sequence';");
    expect(artifactSource).toContain('const startPreferredWidths = { ...preferredPaneWidths };');
    expect(artifactCss).toContain('.motif-cs-main[data-content-pane-count="2"]');
    expect(artifactCss).toContain('.motif-cs-main[data-content-pane-count="1"]');
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-import-slot\s*\{\s*min-height:\s*0/);
    expect(artifactCss).toContain('clamp(160px, var(--motif-cs-inventory-pane-width, 210px), 38vw)');
  });
});
