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

describe('workspace layout guards', () => {
  it('offers two host-neutral themes and migrates legacy theme ids', () => {
    expect(artifactSource).toContain("type ArtifactThemeName = 'light' | 'dark';");
    expect(artifactSource).toContain("{ id: 'light', label: 'Light', description: 'Neutral surface · blue' }");
    expect(artifactSource).toContain("{ id: 'dark', label: 'Dark', description: 'Deep neutral · blue' }");
    expect(artifactSource).toContain("if (value === 'warm-light' || value === 'claude-light' || value === 'claude') return 'light';");
    expect(artifactSource).toContain("if (value === 'warm-dark' || value === 'claude-dark' || value === 'tokyo') return 'dark';");
    expect(artifactSource).toContain("const WORKSPACE_LAYOUT_STORAGE_KEY = 'motif.workspace-layout.v1';");
    expect(artifactSource).toContain("const LEGACY_WORKSPACE_LAYOUT_STORAGE_KEY = 'motif.claude-science.workspace-layout.v1';");
    expect(artifactSource).not.toContain("label: 'Claude Beige'");
    expect(artifactSource).not.toContain("label: 'Warm Light'");
    expect(artifactSource).not.toContain("label: 'Warm Dark'");
    expect(artifactSource).not.toContain('ArtifactThemePaletteName');
    expect(artifactCss).not.toContain('data-theme="claude-light"');
    expect(artifactCss).not.toContain('data-theme="claude-dark"');
    expect(artifactCss).not.toContain('html[data-theme="tokyo"]');
    expect(artifactSource).toContain('data-map-mode={layout.mode}');
    expect(artifactSource).toContain('data-theme={mapTheme}');
    expect(artifactSource).toContain('applyArtifactTheme(loadWorkspaceLayoutPrefs().theme);');
    expect(artifactSource).toContain("document.querySelector<HTMLMetaElement>('meta[name=\"theme-color\"]')");
    expect(artifactCss).toContain('.motif-cs-theme-choice[data-theme-choice="light"]');
    expect(artifactCss).toContain('.motif-cs-theme-choice[data-theme-choice="dark"]');
    expect(artifactCss).toContain('--theme-preview-light-surface: #ffffff;');
    expect(artifactCss).toContain('--theme-preview-dark-surface: #181818;');
    expect(artifactCss).not.toContain('theme-preview-claude');
  });

  it('resets pane geometry without silently changing the selected appearance', () => {
    const resetLayout = sliceBetween(
      artifactSource,
      'const resetWorkspaceLayout = useCallback',
      'const toggleToolsPinned = useCallback',
    );
    expect(resetLayout).toContain('if (!clearWorkspaceLayoutPrefs()) reportPreferenceStorageFailure();');
    expect(resetLayout).toContain('setPreferredPaneWidths({ ...DEFAULT_WORKSPACE_LAYOUT.paneWidths });');
    expect(resetLayout).not.toContain('setTheme(');
    expect(artifactSource).toContain('onResetDisplayPreferences={resetDisplayPreferences}');
    expect(dataSettingsSource).toContain('Reset display');
  });

  it('lets "Reset display" reach every floating tool window, including one already open', () => {
    // The seven tool windows keep their geometry in plain state, deliberately: a
    // size dragged onto a corner survives closing and reopening that window. The
    // way back is Reset display, which resets every window as well as the panes: a
    // user presses it when the windows are badly sized.
    const resetRects = sliceBetween(
      artifactSource,
      'const resetToolWindowRects = useCallback',
      'const resetDisplayPreferences = useCallback',
    );
    const resetDisplay = sliceBetween(
      artifactSource,
      'const resetDisplayPreferences = useCallback',
      'const downloadWorkspaceBackup',
    );
    expect(resetDisplay).toContain('resetToolWindowRects();');

    // Named one at a time. A window left off this list is not reset and says
    // nothing about it; the entire failure mode here is a silent omission.
    for (const tool of ['Primer', 'Alignment', 'Gel', 'Assembly', 'CloningDesign', 'ConstructVerification']) {
      expect(resetRects, `the ${tool} window is not restored by "Reset display"`)
        .toContain(`set${tool}Win(default${tool}WindowRect());`);
    }
    // Translation's rect is null until the user moves the window; null opens it at
    // its default, worked out at that moment so a pinned Tools pane stays clear.
    expect(resetRects, 'the Translations window is not restored by "Reset display"')
      .toContain('setTranslationsWin(null);');
    // Worked out at that moment: the default, or, when the panes have no room for it
    // to dock, the same window over the Map pane.
    expect(artifactSource).toContain('const translationsDefaultRect = defaultTranslationsWindowRect(');
    expect(artifactSource).toContain('const translationsInitialRect = translationsWin ?? (');
    expect(sliceBetween(artifactSource, 'const translationsInitialRect = translationsWin ?? (', 'const translationDocked ='))
      .toMatch(/translationOverMapRect\(\s*translationsDefaultRect,[\s\S]*: translationsDefaultRect\s*\);/);
    expect(resetRects).toContain('setWindowResetSignal((value) => value + 1);');

    // Resetting that state is only half of it. `initial` is read once, in a
    // useState initialiser, so a window that is already open when the button is
    // pressed never sees the new rect and keeps its size and place until the next
    // open. Every window must be handed the signal, or it does not move.
    const windowElements = artifactSource.split('<FloatingWindow').slice(1)
      .map((chunk) => chunk.slice(0, chunk.search(/\n\s*>\n/)));
    expect(windowElements, 'expected seven floating tool windows').toHaveLength(7);
    for (const element of windowElements) {
      const rect = /initial=\{(\w+)\}/.exec(element)?.[1];
      expect(rect, 'a FloatingWindow is rendered without an initial rect').toBeTruthy();
      expect(element, `the ${rect} window is never told that a display reset happened`)
        .toContain(rect === 'translationsInitialRect'
          // Translation is also placed again, while unmoved, when the Tools drawer opens or shuts.
          ? 'resetSignal={windowResetSignal + translationPlaceSignal}'
          : 'resetSignal={windowResetSignal}');
    }

    // And the receiving end adopts it. Keyed on the counter rather than on
    // `initial` changing identity, because `onCommit` writes every finished drag
    // back into that same prop: adopting on identity would fire against the very
    // gesture that produced it.
    const adopt = sliceBetween(
      artifactSource,
      'const lastResetSignalRef = useRef(resetSignal);',
      'const restoreWindow = useCallback',
    );
    expect(adopt).toContain('if (resetSignal === lastResetSignalRef.current) return;');
    expect(adopt).toContain('clampWindowRect(initial, window.innerWidth, window.innerHeight, rightInset)');
    expect(adopt).toContain('setRect(next);');
    // A reset that restored the size but left the window maximized would not
    // show the user the thing it had just fixed.
    expect(adopt).toContain('setMaximized(false);');
    expect(adopt).toContain('setCollapsed(false);');
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
      "if (pane !== 'tools' && current[pane] && openContentCount <= 1) return stored;",
    );
  });

  it('keeps the active record tab visible without scrolling the workspace', () => {
    expect(artifactSource).toContain('const recordTabsRef = useRef<HTMLElement | null>(null);');
    expect(artifactSource).toContain('ref={recordTabsRef}');
    expect(artifactSource).toContain("tabs?.querySelector<HTMLElement>('.motif-cs-record-tab[data-active=\"true\"]')");
    expect(artifactSource).toContain("tabs.scrollTo({ left: tabRight - tabs.clientWidth, behavior: 'auto' })");
  });

  it('makes every ORF count name the population it counted', () => {
    // Measured on the synthetic pUC19 the app once bundled (2,578 bp, circular) with the real
    // detector. "221 ORFs" is true and points the wrong way: it is 221
    // start-to-stop intervals at a 10 aa floor over six frames, counting the
    // standard table's ATG/TTG/CTG starts — only 76 of the 221 begin ATG — and
    // findORFs emits one entry per START, so the 221 sit on just 159 distinct
    // (strand, stop) reading frames. Four of the eight rows the panel lists are
    // the same reverse-strand frame entered at four different starts.
    //
    // A second ambiguity: the record summary reports the SAME word for a 30 aa
    // population — 96 on this record — so 221 and 96 would both read as "ORFs"
    // with nothing to tell them apart. Both are legitimate populations, so both
    // say which they are; unifying them would move a number somebody may
    // already be quoting.
    expect(artifactSource).toContain('const ANALYSIS_ORF_MIN_AA = 10;');
    expect(artifactSource).toContain('const SUMMARY_ORF_MIN_AA = 30;');

    // The floor in the label must be the floor that was scanned, so the two
    // cannot drift: both call sites take the constant, not a literal.
    expect(artifactSource).toContain('findORFs(record.sequence, ANALYSIS_ORF_MIN_AA, translationCode.table, { topology })');
    expect(artifactSource).toContain('findORFs(record.sequence, SUMMARY_ORF_MIN_AA, translationCode.table, { topology })');
    expect(artifactSource).not.toMatch(/findORFs\(record\.sequence,\s*\d/);

    // Chip and rail-popover meta both carry the floor.
    expect(
      artifactSource.match(/\$\{stopOrfs\.length\} ORFs ≥\$\{ANALYSIS_ORF_MIN_AA\} aa/g),
      'both the summary chip and the popover meta must name the floor',
    ).toHaveLength(2);

    // The record summary names its floor in the non-empty branch too, not only
    // when the count is zero.
    expect(artifactSource).toContain('`ORFs: ${orfs.length} ≥${SUMMARY_ORF_MIN_AA} aa (longest ');
    expect(artifactSource).toContain('`ORFs: none ≥${SUMMARY_ORF_MIN_AA} aa`');
    // ...and the machine-readable copy carries it as data.
    expect(artifactSource).toContain('minAminoAcids: SUMMARY_ORF_MIN_AA,');

    // The panel lists and counts one ORF per strand and stop (80 on pUC19),
    // not one per start (216), so the rows do not repeat a frame and the
    // note is one line. Chip, note and rows read the SAME per-stop array.
    expect(artifactSource).toContain('const stopOrfs = useMemo(() => longestOrfPerStop(allOrfs, record.sequence.length)');
    expect(artifactSource).toContain('Showing {visibleOrfs.length} of {stopOrfs.length}: the longest ORF per stop.');
    expect(artifactSource).toContain('All {stopOrfs.length}: the longest ORF per stop.');
    // The start set comes from the table the scan used, because the panel has a
    // "Record genetic code" select and the tables disagree — standard initiates
    // at ATG/TTG/CTG, vertebrate mitochondrial at ATT/ATC/ATA/ATG/GTG. A fixed
    // list here would be one more readout true of some other configuration.
    expect(artifactSource).toContain('translationCode.table.starts');
    expect(artifactSource).toContain('from the farthest in-frame start (${orfStartCodons})');
    // The bare noun is what misled; it must not come back.
    expect(artifactSource).not.toContain('detected ORFs.');
  });

  it('renders no chip that the stylesheet unconditionally hides', () => {
    // Four chips — a record count and a length in the topbar, a type and a
    // length in the sequence title — were rendered on every load and hidden by
    // BASE-block rules, so no viewport, record type, pane placement or media
    // mode could reveal them. Measured at 225 widths from 320 to 2560 and across
    // 0/1/13 records, protein records, every pane toggled and print /
    // forced-colors / prefers-contrast / dark: `display: none`, 0x0, every time.
    // Deleting them changed 0 of 462 element rects across 7 widths.
    //
    // The base-block rule and the media-query rule hide them alike, so no
    // condition reveals them.
    const topbarMeta = sliceBetween(
      artifactSource,
      '<div className="motif-cs-topbar-meta">',
      '</header>',
    );
    expect(topbarMeta, 'topbar chip is hidden by the stylesheet; do not render it').not.toContain('motif-cs-chip');

    const titleActions = sliceBetween(
      artifactSource,
      '<div className="motif-cs-title-actions">',
      '</div>',
    );
    expect(titleActions, 'sequence-title chip is hidden by the stylesheet; do not render it').not.toContain('motif-cs-chip');

    // ...and no rule remains to hide markup that does not exist.
    expect(artifactCss).not.toContain('.motif-cs-topbar-meta > .motif-cs-chip');
    expect(artifactCss).not.toContain('.motif-cs-sequence-title .motif-cs-title-actions .motif-cs-chip');
    // This one would match nothing: the topbar's only children are
    // .motif-cs-brand, .motif-cs-topbar-meta and the theme button, so a direct-child chip
    // selector has nothing to style.
    expect(artifactCss).not.toContain('.motif-cs-topbar > .motif-cs-chip');
  });

  it('gives the record tab strip a themed scrollbar and no inert webkit rules', () => {
    // Thirteen records need 1137px, so the strip scrolls from 1024 down: at
    // 1024 pCDFDuet-1 is entirely off-strip, at 900 pRSFDuet-1 goes with it.
    // The edge fades work (measured headed: 1.15:1 against the field, and the
    // shadow swaps ends with scroll position), but the bar is what says how
    // much is left, and with no colour it falls through to the platform default
    // at 1.72:1 in light and 2.66:1 in dark. Themed, it measures 4.30 or more,
    // measured HEADED because headless Chromium paints no scrollbar for a
    // non-root scroller and would show nothing to measure.
    const strip = sliceBetween(artifactCss, '.motif-cs-record-tabs {', '}');
    expect(strip).toContain('overflow-x: auto');
    expect(strip, 'record tab strip left on the platform default scrollbar').toContain('scrollbar-color:');

    // One scrollbar for the app: the same two tokens the inventory list and the
    // alignment matrix already use.
    const inventory = sliceBetween(artifactCss, '.motif-cs-inventory-groups {', '}');
    const colourOf = (rule: string) => /scrollbar-color:\s*([^;]+);/.exec(rule)?.[1].replace(/\s+/g, ' ').trim();
    expect(colourOf(strip)).toBeTruthy();
    expect(colourOf(strip)).toBe(colourOf(inventory));

    // `scrollbar-width` above is a standard property, so Chromium ignores these
    // pseudo-elements entirely: rules for them would declare a bar Chromium never
    // draws. Dead text that reads like live styling is worse than none.
    expect(artifactCss).not.toContain('.motif-cs-record-tabs::-webkit-scrollbar');
  });

  it('names each tool on the collapsed rail the moment it is hovered or focused', () => {
    // The collapsed rail is the default tools state and every head in it is a
    // 38x34 icon with its label clipped to 1px, so before this rule nothing on
    // the first screen said Primer Design, Guide RNA or Construct Verification.
    // The native title needed a ~1s hover and never fired on keyboard focus.
    const flyout = sliceBetween(
      artifactCss,
      '.motif-cs-inspector[data-tools-pinned="false"]\n  :is(.motif-cs-panel:not([open]) > .motif-cs-panel-head, .motif-cs-pane-title > .motif-cs-pane-collapse):is(:hover, :focus-visible)::before {',
      '\n}',
    );
    expect(flyout).toContain('content: attr(title) / "";');
    // Absolute, so the name tracks its icon when the rail scrolls. Fixed put it
    // 33px adrift at 1440x700, because a fixed box takes its static position
    // from the unscrolled layout.
    expect(flyout).toContain('position: absolute;');
    expect(flyout).toContain('top: 50%;');
    expect(flyout).toContain('transform: translateY(-50%);');
    expect(flyout).not.toContain('position: fixed;');
    expect(flyout).toContain('pointer-events: none;');
    expect(flyout).toContain('text-transform: none;');
    // Its own compositor layer. Painted into the page's layer, showing the name
    // would re-raster the map drawing under the rail, shifting pixels above the
    // last icon on hover.
    expect(flyout).toContain('will-change: transform;');
    // The empty alt text keeps generated content out of the accessible name,
    // which every rail head resolves from its own clipped label.
    expect(flyout).not.toMatch(/content: attr\(title\);/);
    // The head is the flyout's containing block.
    expect(artifactCss).toContain('.motif-cs-inspector[data-tools-pinned="false"] .motif-cs-panel-head {\n  position: relative;');
    // The base rule that this one overrides must still switch the marker off.
    expect(artifactCss).toContain('.motif-cs-inspector[data-tools-pinned="false"] .motif-cs-panel-head::before {\n  content: none;\n}');
    // A scrolling rail clips the absolute box, so inside the query that starts
    // the scrolling the flyout is fixed at the point placeRailFlyout measured,
    // and a head it has not measured (or a scroll has invalidated) shows none
    // rather than a name beside the wrong icon. Both must follow the flyout.
    const flyoutAt = artifactCss.indexOf('.motif-cs-pane-collapse):is(:hover, :focus-visible)::before {\n  content: attr(title)');
    expect(flyoutAt).toBeGreaterThan(-1);
    const scrollingAt = artifactCss.indexOf('@media (max-height: 709px) {', flyoutAt);
    expect(scrollingAt).toBeGreaterThan(flyoutAt);
    const scrolling = artifactCss.slice(scrollingAt, artifactCss.indexOf('\n}\n', scrollingAt));
    expect(scrolling).toMatch(/\[data-rail-flyout\]:is\(:hover, :focus-visible\)::before \{\s*position: fixed;\s*top: var\(--motif-cs-rail-flyout-top\);\s*right: var\(--motif-cs-rail-flyout-right\);/);
    expect(scrolling).toMatch(/:not\(\[data-rail-flyout\]\):is\(:hover, :focus-visible\)::before \{\s*content: none;/);
    expect(artifactSource).toContain('onPointerOver={placeRailFlyout}');
    expect(artifactSource).toContain('onFocus={placeRailFlyout}');
    expect(artifactSource).toContain('onScroll={clearRailFlyouts}');
  });

  it('wraps the sequence edit toolbar instead of scrolling a control away', () => {
    // A scrolling strip would hide 74px at 360 wide and cut "Complement" off, and
    // a scroll strip with its bar painted would still leave the switch that
    // says which strand you read behind a drag. The toolbar is two groups, the
    // edit controls and the display switches; a pane too narrow for both puts
    // the second group on a row of its own.
    const toolbar = sliceBetween(artifactCss, '.motif-cs-edit-toolbar {', '}');
    expect(toolbar).toContain('flex-wrap: wrap');
    expect(toolbar, 'the toolbar must not scroll').not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(toolbar).not.toContain('scrollbar-color');
    expect(toolbar).not.toContain('background-attachment');
    // One 32px row: 28px controls and 2px above and below.
    expect(toolbar).toContain('min-height: 32px');
    // Its controls are 28px, the small control height.
    expect(artifactCss).toMatch(/\.motif-cs-sequence-panel \.motif-cs-edit-toolbar button\s*\{[^}]*height:\s*var\(--control-h-sm\)/);
    const groups = sliceBetween(artifactCss, '.motif-cs-edit-controls,\n.motif-cs-display-toggles {', '}');
    expect(groups).toContain('flex-wrap: wrap');
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
    // Focus returns to the sequence view when the window opened while the user was typing
    // there, otherwise to the control that launched it while that control is on screen...
    expect(floatingWindow).toContain('captureFocusOrigin()');
    expect(floatingWindow).toContain('const target = returnFocusRef?.current;');
    expect(floatingWindow).toContain('target.getClientRects().length > 0');
    expect(floatingWindow).toContain('if (restoreFocusOrigin(origin, target && target.isConnected && target.getClientRects().length > 0 ? target : null)) return;');
    // ...and to the top-bar Tools button when it is not (a tool opened from the drawer shuts the drawer).
    expect(floatingWindow).toContain("document.querySelector<HTMLElement>('[data-pane-toggle=\"tools\"]')?.focus({ preventScroll: true });");
    expect(floatingWindow).toContain('onClick={closeWindow}');
    expect(artifactSource).toContain('returnFocusRef={translationsToggleRef}');
  });

  it('keeps sequence scrolling local to each open record', () => {
    expect(artifactSource).toContain('const sequenceScrollByRecordRef = useRef<Record<string, number>>(createRecordMap());');
    expect(artifactSource).toContain('const rememberActiveSequenceScroll = useCallback(() => {');
    expect(artifactSource).toContain('sequenceScrollByRecordRef.current[activeRecordId] = effectiveSequenceScroller(sequenceElement).scrollTop;');
    expect(artifactSource).toContain('effectiveSequenceScroller(sequenceElement).scrollTop = sequenceScrollByRecordRef.current[recordId] ?? 0;');
    expect(artifactSource).toContain("sequenceElement.closest<HTMLElement>('.motif-cs-sequence-column')");
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

    // A switch never carries the previous record's selection over: it selects
    // what the arriving record had selected when the reader left it, or nothing.
    expect(selectRecord).toContain('recallRecordSelection(nextRecordId);');
    const recallRecordSelection = sliceBetween(
      artifactSource,
      'const recallRecordSelection = useCallback',
      'const selectRecord = useCallback',
    );
    expect(recallRecordSelection).toContain('restoreRecordSelection(rememberedSelectionsRef.current[nextRecordId], record)');
    expect(recallRecordSelection).toContain('setSelection(restored.selection);');
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
    expect(artifactSource).toContain("if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;");
    expect(artifactSource).toContain('aria-valuenow={Math.round(width)}');
    expect(artifactSource).toContain('data-pane={pane}');
    expect(artifactSource).toContain('onKeyDown={(event) => onKeyDown(pane, event, edge)}');
    expect(artifactSource).toContain('const totalSlack = shrinkable.reduce(');
    expect(artifactSource).toContain('deficit * (slack / totalSlack)');
    expect(artifactSource).toContain('const COMPACT_LAYOUT_MIN_WIDTH = 900;');
    expect(artifactSource).toContain("const STACKED_LAYOUT_MEDIA = '(max-width: 899px)';");
    expect(artifactSource).toContain("const TWO_ROW_LAYOUT_MEDIA = '(min-width: 900px) and (max-width: 1535px)';");
    expect(artifactSource).toContain('const stableCompactTopology = workspaceMainSize.width >= COMPACT_LAYOUT_MIN_WIDTH && workspaceMainSize.width <= 1535;');
    expect(artifactSource).toContain("const OVERLAY_TOOLS_LAYOUT_MEDIA = '(max-width: 1535px)';");
    expect(artifactSource).toContain("sequence: { min: 240, max: 2000 }");
    expect(artifactSource).toContain("map: { min: 300, max: 2000 }");
    expect(artifactCss).toMatch(/\.motif-cs-resize-handle\[data-pane="sequence"\]\s*\{[\s\S]*?display:\s*block/);
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="inventory"\],[\s\S]*?\.motif-cs-resize-handle\[data-pane="sequence"\][\s\S]*?display:\s*block/);
    expect(artifactCss).toMatch(/@media \(min-width: 1536px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="tools"\][\s\S]*?display:\s*block/);
    expect(artifactSource).toContain("const overlayTools = pane === 'tools' && overlayLayout;");
    expect(artifactSource).toContain("visibleResizablePanes.filter((pane) => pane !== 'tools')");
    expect(artifactSource).toContain("visibleResizablePanes.filter((pane) => pane === 'inventory' || pane === 'sequence')");
    expect(artifactSource).toContain('saveWorkspaceLayoutPrefs({');
    expect(artifactSource).toContain('floatingPaneRects,');
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
    expect(artifactSource).toContain("window.addEventListener('pointercancel', handlePointerEnd);");
    expect(artifactSource).toContain("window.addEventListener('blur', handleWindowBlur);");
    expect(artifactSource).toContain("resizeHandle.addEventListener('lostpointercapture', handleLostPointerCapture);");
    expect(artifactSource).toContain('stopPaneResize();');
    expect(artifactSource).toContain('stopStackedPaneResize();');
    expect(artifactCss).toContain('var(--motif-cs-tools-pane-width, 280px)');
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="sequence"\]\s*\{[\s\S]*?display:\s*none/);
  });

  it('reflows a pinned compact workspace without overlaying or reserving a hidden map lane', () => {
    expect(artifactSource).toContain('data-tools-pinned={toolsDocked || undefined}');
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-main\[data-tools-pinned="true"\]\s*\{[\s\S]*?display:\s*grid/);
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
    expect(artifactSource).toContain('limits={separatorWidthLimits(\'inventory\', \'after\')}');
    expect(artifactSource).toContain('limits={separatorWidthLimits(\'tools\', \'before\')}');
    expect(artifactSource).toContain('if (!neighbor) return paneWidthLimitsForCurrentLayout(pane);');
    expect(artifactSource).toContain('const workspaceRowResizeActive = compactRowResizeActive || twoRowResizeActive;');
    expect(artifactSource).toContain('const TWO_ROW_VERY_SHORT_MIN_HEIGHT = 120;');
    expect(artifactSource).toContain('if (total <= mainWidth) return widths;');
    expect(artifactSource).not.toContain('let spare = mainWidth - total;');
    // Side by side, Inventory and a pinned Tools panel are capped by their own
    // limits; Sequence and Map below them split by share and have no width to give.
    expect(artifactSource).toContain("const compactRowMaxWidth = compactSideBySide && (pane === 'inventory' || pane === 'tools')");
    expect(artifactSource).toContain(": compactPinnedLayout && pane === 'inventory'");
    expect(artifactSource).toContain('mainWidth - resizeHandleWidth - PANE_WIDTH_LIMITS.sequence.min');
    expect(artifactSource).toContain('mainWidth - resizeHandleWidth - PANE_WIDTH_LIMITS.map.min');
  });

  it('keeps the short two-row workbench internally scrollable with a persistent rail', () => {
    expect(artifactSource).toContain('|| window.matchMedia(TWO_ROW_LAYOUT_MEDIA).matches');
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\)[\s\S]*?grid-template-rows:[\s\S]*?9px/);
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-stacked-resize-handle\[data-pane="sequence"\]\s*\{[\s\S]*?display:\s*block/);
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-main > \.motif-cs-sequence-column\s*\{[\s\S]*?overflow-y:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-main > \.motif-cs-sequence-column > \.motif-cs-sequence-panel\s*\{[\s\S]*?min-height:\s*280px/);
  });

  it('contains narrow grid panes and preserves a usable short map canvas', () => {
    // The single column ends at 899px and the grid starts at 900px, so no width
    // runs both rule sets and needs a strip of overrides between them.
    expect(artifactCss).not.toContain('(min-width: 640px) and (max-width: 767px)');
    expect(artifactCss).not.toContain('@media (max-width: 767px)');
    expect(artifactCss).not.toContain('(min-width: 640px) and (max-width: 1535px)');
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\) and \(max-height: 620px\)[\s\S]*?\.motif-cs-map-frame\s*\{[\s\S]*?min-height:\s*120px/);
  });

  it('anchors the phone Tools rail and drawer below the visible top bar', () => {
    expect(artifactSource).toContain('const topbarRef = useRef<HTMLElement | null>(null);');
    expect(artifactSource).toContain("'--motif-cs-topbar-height': `${topbarHeight}px`");
    expect(artifactSource).toContain('<header ref={topbarRef}');
    expect(artifactCss).toMatch(/@media \(max-width: 899px\)[\s\S]*?\.motif-cs-inspector\[data-tools-pinned="false"\],[\s\S]*?\.motif-cs-inspector\[data-tools-pinned="true"\]\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(--motif-cs-topbar-height,\s*38px\);[\s\S]*?bottom:\s*0/);
    expect(artifactCss).toMatch(/@media \(max-width: 899px\)[\s\S]*?\.motif-cs-inspector\[data-tools-pinned="true"\]\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?overscroll-behavior:\s*contain/);
    expect(artifactCss).toMatch(/@media \(max-width: 899px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="tools"\]\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?top:\s*var\(--motif-cs-topbar-height,\s*38px\)/);
  });

  it('uses a roomy four-column bridge before pane reordering becomes available', () => {
    expect(artifactCss).toMatch(/@media \(min-width: 1536px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="tools"\]/);
    expect(artifactCss).not.toContain('@media (max-width: 1599px) {');
    expect(artifactSource).toContain('const paneReorderAvailable = workspaceMainSize.width >= 1536;');
  });

  it('keeps large sequence rendering local and skippable off screen', () => {
    expect(artifactCss).toMatch(/\.motif-cs-seq-block\s*\{[\s\S]*?content-visibility:\s*auto/);
    expect(artifactCss).toMatch(/\.motif-cs-seq-block\[data-seq-focus="true"\]\s*\{[\s\S]*?content-visibility:\s*visible/);
    expect(artifactCss).toMatch(/\.motif-cs-large-sequence\s*\{[\s\S]*?overflow:\s*auto[\s\S]*?font:\s*var\(--fs-sm\)\/1\.7 var\(--font-mono\)/);
    expect(artifactCss).toMatch(/\.motif-cs-large-sequence-notice\s*\{[\s\S]*?overflow-wrap:\s*anywhere/);
    expect(artifactCss).toMatch(/\.motif-cs-large-sequence-value\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?font:\s*var\(--fs-sm\)\/1\.7 var\(--font-mono\)[\s\S]*?resize:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-large-sequence-value:focus-visible\s*\{[\s\S]*?outline:\s*2px solid var\(--focus-ring\)/);
  });

  it('keeps compact sequence content scrollable and short workspaces escapable', () => {
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-tools-pinned="true"\] \.motif-cs-sequence-panel > \.motif-cs-sequence\s*\{[\s\S]*?min-height:\s*0/);
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\) and \(max-height: 620px\)[\s\S]*?minmax\(var\(--motif-cs-compact-bottom-row-min, 120px\), 1fr\)/);
    expect(artifactCss).toMatch(/@media \(min-width: 900px\) and \(max-width: 1535px\) and \(max-height: 330px\)[\s\S]*?data-content-pane-count="3"[\s\S]*?overflow-y:\s*auto/);
    expect(artifactCss).toMatch(/data-inventory-hidden="true"\][\s\S]*?motif-cs-stacked-resize-handle\[data-pane="sequence"\][\s\S]*?grid-column:\s*1 \/ 4/);
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
    expect(artifactCss).toMatch(/@media \(max-width: 899px\)[\s\S]*?\.motif-cs-stacked-resize-handle\s*\{[\s\S]*?cursor:\s*ns-resize/);
    expect(artifactCss).toContain('var(--motif-cs-stacked-inventory-pane-height, min(176px, 20vh))');
    expect(artifactCss).toContain('var(--motif-cs-stacked-sequence-pane-height, clamp(360px, 47vh, 420px))');
    expect(artifactCss).toMatch(/\.motif-cs-sidebar\[data-stacked-resized="true"\][\s\S]*?max-height:\s*520px/);
    expect(artifactCss).toMatch(/\.motif-cs-sequence-column\[data-stacked-resized="true"\][\s\S]*?\.motif-cs-sequence-panel > \.motif-cs-sequence\s*\{[\s\S]*?max-height:\s*none/);
    // The single column draws Map above Sequence, and the DOM follows so Tab
    // matches the screen; the saved pane order is left alone.
    expect(artifactSource).toContain('const singleColumnLayout = workspaceMainSize.width < COMPACT_LAYOUT_MIN_WIDTH;');
    expect(artifactSource).toContain('() => singleColumnLayout ? singleColumnPaneOrder(paneOrder) : paneOrder,');
    expect(artifactSource).toContain('{orderPaneSlots(drawnPaneOrder, {');
  });

  it('lets split sequence and map canvases consume the available height', () => {
    expect(artifactCss).toMatch(/@media \(min-width: 900px\)[\s\S]*?\.motif-cs-sequence-panel\s*\{[\s\S]*?flex:\s*1 1 auto/);
    expect(artifactCss).toMatch(/\.motif-cs-sequence-panel > \.motif-cs-sequence\s*\{[\s\S]*?max-height:\s*none/);
    expect(artifactCss).toMatch(/@media \(min-width: 900px\)[\s\S]*?\.motif-cs-map-frame\s*\{[\s\S]*?flex:\s*1 1 auto/);
    expect(artifactSource).toContain('Math.floor(fit / 5) * 5');
  });

  it('reserves no workspace width for Tools below 1536px', () => {
    // Tools opens over the workspace there, so a closed Tools pane costs no width.
    expect(artifactCss).toMatch(/@media \(max-width: 1535px\) \{\s*\/\* No width is reserved for Tools below 1536px[^*]*\*\/\s*\.motif-cs-main \{\s*position: relative;\s*\}/);
    expect(artifactCss).not.toContain('padding-right: 48px');
    expect(artifactSource).toContain('const toolsWidth = toolsDocked ? next.tools + 7 : 0;');
    expect(artifactSource).toContain('const effectiveToolsRailWidth = overlayTools ? 0 : toolsRailWidth;');
    expect(artifactSource).toContain('const effectiveToolsRailWidth = overlayLayout ? 0 : toolsRailWidth;');
  });

  it('avoids duplicate scroll tracks behind the narrow Tools overlay', () => {
    expect(artifactCss).toMatch(/@media \(max-width: 1535px\)[\s\S]*?\.motif-cs-main:has\(> \.motif-cs-inspector\[data-tools-pinned="true"\]\)\s*\{[\s\S]*?scrollbar-width:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-main:has\(> \.motif-cs-inspector\[data-tools-pinned="true"\]\)::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none/);
  });

  it('separates persistent sequence states from record-creation actions', () => {
    const editToolbar = sliceBetween(
      artifactSource,
      '<div className="motif-cs-edit-toolbar"',
      'className="motif-cs-selection-bar"',
    );
    expect(artifactSource).toContain('className="motif-cs-mini-button motif-cs-edit-mode-toggle"');
    expect(artifactSource).toContain("aria-label={insertMode ? 'Typing mode: Insert. Switch to Replace' : 'Typing mode: Replace. Switch to Insert'}");
    expect(artifactSource).toContain("data-mode={insertMode ? 'insert' : 'replace'}");
    expect(artifactSource).toContain('className="motif-cs-mini-button motif-cs-display-switch motif-cs-ds-toggle"');
    // The switch label carries its own text for the width it reserves when on.
    expect(artifactSource).toContain('<span className="motif-cs-toolbar-label" data-label="Complement">Complement</span>');
    // With the words dropped, Complement must not wear the arrows the
    // Replace and Insert button already has.
    const complementSwitch = sliceBetween(artifactSource, 'motif-cs-display-switch motif-cs-ds-toggle', 'data-label="Complement"');
    // A double helix for the second strand; mirrored triangles read as an hourglass.
    expect(complementSwitch).toContain('<Dna className="motif-cs-switch-icon"');
    expect(complementSwitch).not.toContain('FlipVertical');
    expect(complementSwitch).not.toContain('ArrowRightLeft');
    expect(editToolbar.match(/<ArrowRightLeft /g)).toHaveLength(1);
    // The Create menu spells the action out: "Pin translation" shows the
    // translation under the sequence and "Remove translation" takes it away.
    expect(artifactSource).toContain(
      "label: selectedInlineTranslationTrack ? 'Remove translation' : 'Pin translation',",
    );
    expect(artifactSource).not.toContain('motif-cs-label-short');
    expect(artifactSource).toContain('disabled: !selectedInlineTranslationTrack && (!selectionActionTranslation || !canPinPreviewTranslation),');
    expect(artifactSource).toContain('if (selectedInlineTranslationTrack) deleteTranslationLayer(selectedInlineTranslationTrack.id);');
    expect(artifactSource).toContain('addTranslationLayer();');
    expect(artifactSource).toContain('onTranslationTrackSelect={handleTranslationTrackSelectAndReveal}');
    expect(artifactSource).toMatch(/>\s*Add feature\s*<\/button>/);

    // Both controls in this bar that add a record to the inventory say so.
    // Spelled like the "Copy" beside them, "Rev comp" would add a record and open
    // a new Derived group with nothing in the label to warn of it — and with no
    // selection it is the only enabled control here.
    // "New" tells the record-making entry from Export's "Copy reverse complement".
    // In the Create menu they are spelled out: "rev comp" was the one
    // abbreviation left, and "record" says what lands in the inventory.
    expect(artifactSource).toContain("label: 'New reverse complement record',");
    expect(artifactSource).toContain("label: 'New protein record',");
    // A separator marks where the menu stops acting on this record and starts
    // adding new ones. The labels carry the meaning; the rule only groups them.
    expect(artifactSource).toContain('separatorBefore: true,');
    expect(artifactSource).toContain('className="motif-cs-action-menu-separator" role="separator"');
    expect(artifactCss).toMatch(/\.motif-cs-action-menu-separator\s*\{[\s\S]*?height:\s*1px/);
    // One switch, not a two-member segmented control: the same click both
    // enters and leaves Detail, so the row reads like the Complement switch
    // beside it. Guard the toggling call, which a split control cannot make.
    expect(artifactSource).toContain(
      "setSequenceViewMode(effectiveSequenceViewMode === 'detail' ? 'standard' : 'detail');",
    );
    expect(artifactSource).toContain('className="motif-cs-mini-button motif-cs-display-switch motif-cs-detail-toggle"');
    expect(artifactSource).not.toContain('motif-cs-view-toggle');
    expect(artifactSource).not.toContain('aria-label="Standard sequence view"');
    expect(artifactSource).toContain('if (selectionSummary) {');
    expect(artifactSource).toContain('if (hasMaterializableSequenceSelection) addSelectionReverseComplementRecord();');
    expect(artifactSource).toContain('onSelect: addContextReverseComplementRecord,');
    expect(artifactSource.match(/onSelect: addContextReverseComplementRecord,/g)).toHaveLength(1);
    expect(editToolbar).not.toContain('addContextReverseComplementRecord');
    // The menu is mounted only for nucleotide records, so the item's own test
    // needs no molecule clause.
    expect(artifactSource).toContain('disabled: !!selectionSummary && !hasMaterializableSequenceSelection,\n');
    expect(artifactSource).toContain('className="motif-cs-edit-controls"');
    expect(artifactCss).toContain('.motif-cs-switch-track');
    expect(artifactCss).not.toContain('.motif-cs-view-toggle');
    // Nothing selected: the bar is one hint, with Copy, Add feature and Create
    // beside it, disabled where they have nothing to act on. Nothing in the dock
    // is hidden by state, and the row keeps one height either way, so selecting
    // never moves the bases or a control.
    expect(artifactCss).not.toMatch(/\.motif-cs-selection-bar\[data-empty\][^{]*\{[^}]*display:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-selection-bar\s*\{[\s\S]*?min-height:\s*32px/);
    // The dock wraps instead of scrolling. Where the readout and the three
    // controls cannot share a row (under 560px of pane, with the readout at
    // 12px) it is two rows tall in every state, readout on top, so a selection
    // never grows it mid-drag.
    expect(artifactCss).toMatch(/\.motif-cs-selection-bar\s*\{[\s\S]*?flex-wrap:\s*wrap/);
    // Under 560px of pane one row would cut a feature's position and length.
    expect(artifactCss).toMatch(/@container \(max-width: 559px\) \{\s*\.motif-cs-selection-bar\s*\{[\s\S]*?min-height:\s*56px[\s\S]*?\.motif-cs-selection-label\s*\{\s*flex-basis:\s*100%/);
    // A long feature name takes the ellipsis; the facts after it never do.
    expect(artifactCss).toMatch(/\.motif-cs-selection-name-tail\s*\{\s*flex:\s*0 0 auto;/);
    expect(artifactSource).toContain('<span className="motif-cs-selection-name-head">{selectedFeature.name || selectedFeature.type}</span>');
  });

  it('supports platform-standard map wheel modifiers', () => {
    expect(artifactSource).toContain('const handlePaneWheel = (event: globalThis.WheelEvent) => {');
    expect(artifactSource).toContain('handleMapWheel(point, event.deltaX, event.deltaY, event.deltaMode, event.ctrlKey || event.metaKey, event.shiftKey);');
    expect(artifactSource).toContain("pane.addEventListener('wheel', handlePaneWheel, { passive: false, capture: true })");
    expect(artifactSource).toContain('Ctrl/Command-wheel zooms');
    // Ctrl or Command zooms at any scale; the plain wheel pans at every zoom, Fit
    // included (see mapWheelIntent and its behavioural test).
    expect(artifactSource).toContain("return ctrlKey ? 'zoom' : 'pan';");
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
    // A clicked codon and a run of selected residues lock the target in the track's strand and code.
    expect(artifactSource).toContain('onTranslationCodonSelect(\n      range.start,\n      range.end,\n      entry.track.strand,\n      entry.track.translationTableId,\n      entry.track.featureId,\n      entry.track.source,\n');
    // The target keeps the residues as the track drew them (an initiator GTG reads V alone),
    // and the code it drew them under, so a later code change reads the bases again.
    expect(selectTranslationCodon).toContain('      protein,\n      proteinTranslationTableId: protein ? translationTableId : undefined,\n      pickStrand,\n      segments,\n    };');
    // An ORF row and a find match lock the target in their own strand, read from their 5' end.
    expect(artifactSource).toContain('onClick={() => onSelectOrf(orf.start, orf.end, orf.strand, true)}');
    expect(artifactSource).toContain('selectStrandedRangeAndReveal(match.start, match.end, match.strand, false);');
    expect(artifactSource).toContain('selectTranslationCodon(start, end, strand, undefined, undefined, undefined, 0, completeCds || undefined, undefined, undefined, strand);');
  });

  it('keeps genetic-code context synchronized across feature, pinned-track, and PCR flows', () => {
    expect(artifactSource).toContain("const TRANSLATION_CODE_FEATURE_TYPES: ReadonlySet<FeatureType> = new Set<FeatureType>(['cds', 'orf']);");
    expect(sliceBetween(artifactSource, 'export function drawsDefaultTranslationTrack(', '// INSDC /transl_table is meaningful'))
      .toContain('if (feature.strand !== 1 && feature.strand !== -1) return false;');
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
    const controls = sliceBetween(artifactSource, 'const translationControlTarget = useMemo', 'const previewTrack = useMemo');
    expect(controls).toContain('[recordId, translateTargetKey, translateTarget.defaultStrand, translateTarget.defaultFrame]');
    expect(controls).toContain('translationOverride?.target === translationControlTarget ? translationOverride : null');
    expect(controls).toContain('activeTranslationOverride?.strand ?? translationControlTarget.strand');
    expect(controls).toContain('activeTranslationOverride?.frame ?? translationControlTarget.frame');
    expect(artifactSource).not.toContain('// eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on target change');
  });

  it('keeps sequence dragging for range selection and blank-canvas dragging for pan', () => {
    const pointerStart = sliceBetween(
      artifactSource,
      'const handleMapPointerStart = useCallback',
      'const handleMapPointerMove = useCallback',
    );
    expect(pointerStart).toContain('mapPointerActionAtPoint(contentPoint, layout, mapViewport.k)');
    expect(artifactSource).toContain('MAP_CIRCULAR_RANGE_HIT_MAX) / contentScale');
    expect(artifactSource).toContain('MAP_LINEAR_RANGE_HIT_TOP_Y / contentScale');
    expect(artifactSource).toContain('MAP_LINEAR_RANGE_HIT_BOTTOM_Y / (contentScale * Math.pow(contentScale, 0.75))');
    expect(artifactSource).toContain('Math.min(layout.bg.y + layout.bg.height, axis.y + hitBottomY)');
    expect(pointerStart).toContain("mode: 'range'");
    expect(pointerStart).toContain("mode: 'pan'");
    expect(pointerStart).not.toContain('mapViewport.k >');
    expect(artifactSource).toContain('data-map-interaction-surface');
    expect(artifactSource).toContain('data-map-pointer-action={mapPointerAction}');
    // Features and restriction ticks do not veto the gesture, which would leave
    // about a quarter of the disc's area unable to start a range drag. They take
    // part like any other surface and are told apart from a drag by whether the
    // pointer moved. Workflow range overlays keep their veto.
    expect(artifactSource).toContain("target.closest('.motif-pm-range-overlay[data-interactive=\"true\"]')");
    expect(artifactSource).toContain("mapPressOnObjectRef.current = !!target.closest('.motif-pm-feature, .motif-pm-restriction')");
    expect(artifactSource).toContain('onPointerDown={handleMapSurfacePointerDown}');
    const pointerCancel = sliceBetween(
      artifactSource,
      'const handleMapSurfacePointerCancel = useCallback',
      'const handleMapBackgroundClick = useCallback',
    );
    const cancelDrag = sliceBetween(
      artifactSource,
      'const cancelMapDrag = useCallback',
      'useEffect(() => {\n    cancelMapDrag();',
    );
    expect(pointerCancel).toContain('if (event.pointerId !== mapPointerRef.current?.id) return;');
    expect(pointerCancel).toContain('cancelMapDrag();');
    expect(cancelDrag).toContain('pointer.surface.releasePointerCapture(pointer.id);');
    expect(cancelDrag).toContain('mapPointerRef.current = null;');
    expect(cancelDrag).toContain('mapDragRef.current = null;');
    expect(cancelDrag).toContain('mapPressOnObjectRef.current = false;');
    for (const path of [pointerCancel, cancelDrag]) {
      expect(path).not.toContain('handleMapPointerEnd();');
      expect(path).not.toContain('suppressNextBackgroundClick');
      expect(path).not.toContain('suppressNextMapObjectClick');
    }
    expect(artifactSource).toContain('onPointerCancel={handleMapSurfacePointerCancel}');
    expect(artifactSource).toContain('onLostPointerCapture={handleMapSurfacePointerCancel}');
    expect(artifactCss).toMatch(/\.motif-cs-map-frame \.motif-pm-backbone\s*\{[\s\S]*?pointer-events:\s*none/);
    expect(artifactCss).toMatch(/\[data-map-pointer-action="pan"\] \.motif-pm-bg\s*\{[\s\S]*?cursor:\s*grab/);
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
    expect(artifactSource).toContain('onFocus={() => {');
    expect(artifactSource).toContain('setRovingRestrictionKey(label.key);');
    expect(artifactSource).toContain('setHoveredRestrictionTickIds(label.sites.map(restrictionSiteTickId));');
    expect(artifactSource).toContain('data-cut-bond={senseCut}');
    expect(artifactSource).toContain('data-cut-bond={antisenseCut}');
  });

  it('uses the validated full enzyme catalog without coupling digest recipes to map-source changes', () => {
    expect(artifactSource).toContain('const recipe = useMemo(() => buildDigestRecipe({');
    expect(artifactSource).toContain("() => restrictionEnzymesForSources(['all'], customEnzymes)");
    expect(artifactSource).toContain('if (previousRecordIdRef.current === record.id) return;');
    expect(artifactSource).toContain('Use visible cutters');
    expect(artifactSource).toContain('const targetRecordId = selectedRecordIdRef.current ?? recordId;');
    expect(artifactSource).toContain('setEnzymeSourcesByRecord((current) => createRecordMap(current, { [targetRecordId]: next }));');
  });

  it('makes floating tools focusable and keyboard movable and resizable', () => {
    expect(artifactSource).toContain('if (!node || node.contains(document.activeElement)) return;');
    expect(artifactSource).toContain('node.focus({ preventScroll: true });');
    expect(artifactSource).toContain('return () => window.cancelAnimationFrame(frame);');
    expect(artifactSource).toContain('const moveFromKeyboard = useCallback');
    expect(artifactSource).toContain('const resizeFromKeyboard = useCallback');
    expect(artifactSource).toContain('aria-label={`Resize ${title} window in 2 dimensions. Left and Right Arrow change width; Up and Down Arrow change height.`}');
    expect(artifactSource).toContain('aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"');
    expect(artifactCss).toContain('.motif-cs-window-resize:focus-visible');
    expect(artifactCss).toMatch(/\.motif-cs-window-resize\s*\{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px/);
    expect(artifactSource).toContain('rightInset={windowRightInset}');
    // Only the wide layout has a rail; below 1536px a window keeps no inset for it.
    expect(artifactSource).toContain('const windowRightInset = toolsRail && !toolsDrawer ? TOOLS_RAIL_WIDTH : 0;');
    expect(artifactSource).not.toContain('rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}');
    expect(artifactSource).toContain('clampWindowRect(raw, vw, vh, rightInset)');
    expect(artifactSource).toContain('vw - rightInset - drag.base.x - 8');
    expect(artifactCss).not.toContain('.motif-cs-window-resize {\n    right: 58px;');
  });

  it('keeps the window corner grip above anything the window body stacks', () => {
    // Without its own z-index the grip loses to the MSA toolbar's sticky
    // z-index: 10 wherever the two overlap — which is the whole bottom-right
    // corner once the toolbar wraps taller than a short body. The press would
    // then go to the toolbar and the window could not be mouse-resized.
    const declared = (selector: string) => {
      const rule = artifactCss.match(new RegExp(`\\n${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`));
      const found = rule?.[1].match(/\n\s*z-index:\s*(\d+);/);
      return found ? Number(found[1]) : null;
    };
    const grip = declared('.motif-cs-window-resize');
    const toolbar = declared('.motif-cs-msa-toolbar');
    const dropOverlay = declared('.motif-cs-msa-drop-overlay');
    // Absolute floors as well as the comparison: a guard that only checks
    // "higher than the others" still passes if every number drifts together.
    expect(grip).toBe(20);
    expect(toolbar).toBe(10);
    expect(dropOverlay).toBe(12);
    expect(grip!).toBeGreaterThan(Math.max(toolbar!, dropOverlay!));
    // Scoped to the window, so the raised value cannot reorder anything outside it.
    expect(artifactCss).toMatch(/\.motif-cs-window\s*\{[\s\S]*?isolation:\s*isolate;/);
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
    // The popover sizes to its content up to the room the viewport has, so the
    // preview keeps its own height instead of a resized panel's leftover.
    expect(artifactCss).toMatch(/\.motif-cs-sequence-preview\s*\{[\s\S]*?height:\s*clamp\(96px, 18vh, 260px\)/);
    expect(artifactSource).toContain('const natural = body.scrollHeight;');
  });

  it('copies reverse features in feature orientation from the keyboard path', () => {
    expect(artifactSource).toContain('materializeFeatureSequence(sequence, selectedFeatureProjection, sequenceType)');
    expect(artifactSource).toContain('text = inspectorSelectionSeq;');
    // The shortcut effect must re-run when anything the copy path reads changes.
    const shortcutDependencies = artifactSource
      .match(/\}, \[(copyText, handleZoomIn, [^\]]*)\]\);/)?.[1]
      .split(', ') ?? [];
    expect(shortcutDependencies).toEqual(expect.arrayContaining([
      'copyText',
      'inspectorSelectionSeq',
      'recordId',
      'selectedFeature',
      'selectedMapRange',
      'selectedSiteCopy',
      'sequence',
      'topology',
    ]));
  });

  it('serializes native mouse-selected bases without embedded annotation text', () => {
    expect(artifactSource).toContain('const selectionIsInsideSequence = Boolean(');
    expect(artifactSource).toContain("event.clipboardData.setData('text/plain', sequenceForRange(sequence, selectedMapRange, topology));");
    expect(artifactSource).toContain('[selectedAaTrackText, selectedMapRange, sequence, topology, writeSelectedAaToClipboard]');
  });

  it('draws radial start and end edges as lines without outlining circular selection arcs', () => {
    expect(artifactSource).toContain('function artifactSelectionOverlayPaths(');
    expect(artifactSource).toContain('circularSelectionEdgePath(layout, span.start)');
    expect(artifactSource).toContain('circularSelectionEdgePath(layout, span.end)');
    expect(artifactSource).toContain('artifactSelectionOverlayPaths(layout, visibleMapRanges)');
    const edgeRule = sliceBetween(
      artifactCss,
      '.motif-cs-map-frame[data-map-mode="circular"] .motif-pm-selection-layer .motif-pm-selection:nth-child(3n + 2)',
      '}',
    );
    // Stroked and filled in the text colour: the line carries no area, so the fill
    // paints only the triangle marker at its outer end.
    expect(edgeRule).toContain('fill: var(--text-primary);');
    // One thin text-colour line that fades toward the centre: the paint server
    // comes in through a variable, with the solid text colour as its fallback,
    // and its stops are the text colour.
    expect(edgeRule).toContain('stroke: var(--motif-selection-edge-paint, var(--text-primary));');
    expect(sliceBetween(artifactCss, '.motif-cs-selection-fade [data-role="edge"] stop {', '}')).toContain('stop-color: var(--text-primary);');
    expect(edgeRule).toContain('stroke-width: 1.5;');
    expect(edgeRule).not.toContain('gradient');
    expect(edgeRule).toContain('vector-effect: non-scaling-stroke;');
    // Line view's boundary lines and their backbone triangles share the rule,
    // antialiased: a 1.5px line under crispEdges paints 1 column at some x, 2 at others.
    const lineRule = sliceBetween(artifactCss, '.motif-pm-selection:nth-child(3n + 3),', '}');
    expect(lineRule).toContain('.motif-cs-map-frame .motif-pm-selection-edges .motif-pm-selection-edge {');
    expect(lineRule).toContain('shape-rendering: auto;');
  });

  it('draws a Line view selection wash over the boundary lines\' extent, a selected feature\'s at the band', () => {
    expect(artifactSource).toContain("const linearReach = selectedFeatureId ? 'band' : 'grid';");
    expect(artifactSource).toContain('.map((d) => linearSelectionColumnPath(layout, d, linearReach))');
    expect(artifactSource).toContain('visibleMapRanges={visibleMapRanges} selectedFeatureId={selectedFeatureId}>');
  });

  it('hands the map the selection fade gradients under ids unique to its drawing', () => {
    expect(artifactSource).toContain("const fadeId = `motif-map-selection-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;");
    expect(artifactSource).toContain("'--motif-selection-edge-paint': `url(#${fadeId}-edge)`, '--motif-selection-wash-paint': `url(#${fadeId}-wash)`");
    expect(artifactSource).toContain('className="motif-pm-container"\n                  style={selectionPaint}');
    expect(artifactSource).toContain('<svg className="motif-cs-selection-fade" width="0" height="0" aria-hidden="true" focusable="false">');
    // Forced colours: solid lines (above) and a flat wash, no gradient.
    const forcedAt = artifactCss.indexOf('Lines and wash are solid here: no fade gradient.');
    expect(forcedAt).toBeGreaterThan(-1);
    const block = artifactCss.slice(forcedAt, artifactCss.indexOf('\n}\n', forcedAt)).replace(/\s+/g, ' ');
    expect(block).toContain('.motif-cs-map-frame .motif-pm-selection-layer .motif-pm-selection { fill: var(--accent); }');
  });

  it('paints the selection end lines and triangles of both map views in Highlight under forced colours', () => {
    // The frame-scoped rule above outranks plasmid-map.css's own forced-colours
    // Highlight, so a later rule with the very same selectors must restate it.
    const themedAt = artifactCss.indexOf('.motif-cs-map-frame .motif-pm-selection-edges .motif-pm-selection-edge {');
    expect(themedAt).toBeGreaterThan(-1);
    const head = artifactCss.slice(artifactCss.lastIndexOf('}', themedAt) + 1, artifactCss.indexOf('{', themedAt));
    const selectors = head.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    expect(selectors).toEqual([
      '.motif-cs-map-frame[data-map-mode="circular"] .motif-pm-selection-layer .motif-pm-selection:nth-child(3n + 2)',
      '.motif-cs-map-frame[data-map-mode="circular"] .motif-pm-selection-layer .motif-pm-selection:nth-child(3n + 3)',
      '.motif-cs-map-frame .motif-pm-selection-edges .motif-pm-selection-edge',
    ]);
    const wanted = `${selectors.join(', ')} {`;
    const bodies: string[] = [];
    const media = '@media (forced-colors: active) {';
    for (let at = artifactCss.indexOf(media, themedAt); at > -1; at = artifactCss.indexOf(media, at + 1)) {
      const block = artifactCss.slice(at, artifactCss.indexOf('\n}\n', at)).replace(/\s+/g, ' ');
      const ruleAt = block.indexOf(wanted);
      if (ruleAt > -1) bodies.push(block.slice(ruleAt + wanted.length, block.indexOf('}', ruleAt)));
    }
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatch(/fill:\s*Highlight;/);
    expect(bodies[0]).toMatch(/stroke:\s*Highlight;/);
  });

  it('draws one edge line, not two, for a circular span too narrow to tell them apart', () => {
    // A span this narrow (a find match a degree wide) draws one line: two edges 3px apart read as one thick bar.
    expect(artifactSource).toContain('const CIRCULAR_SELECTION_SINGLE_EDGE_UNITS = 5;');
    expect(artifactSource).toContain('const arc = (circularSelectionRadii(layout).outer * 2 * Math.PI * (span.end - span.start)) / Math.max(1, layout.length);');
    expect(artifactSource).toContain('result.push(fill, circularSelectionEdgePath(layout, (span.start + span.end) / 2), seam);');
  });

  it('suppresses the radial edge a wrapping selection would draw down the origin', () => {
    expect(artifactSource).toContain('const wrapsOrigin = allSpans.some((span) => span.start === 0)');
    expect(artifactSource).toContain('&& allSpans.some((span) => span.end === layout.length);');
    expect(artifactSource).toContain('wrapsOrigin && span.start === 0 ? seam : circularSelectionEdgePath(layout, span.start)');
    expect(artifactSource).toContain('wrapsOrigin && span.end === layout.length ? seam : circularSelectionEdgePath(layout, span.end)');
  });

  it('keeps expanded floating tools movable and resizable at Claude Science widths', () => {
    expect(artifactSource).toContain('const minW = Math.min(280');
    expect(artifactSource).toContain('const minH = Math.min(180');
    expect(artifactSource).toContain('w: clamp(drag.base.w + dx, 280');
    expect(artifactSource).toContain('h: clamp(drag.base.h + dy, 180');
    // Below 900px an unplaced window is a bottom sheet; once moved or resized it is drawn where the user put it.
    expect(artifactCss).toMatch(/@media \(max-width: 899\.98px\) \{\s*\.motif-cs-window\[data-sheet\]:not\(\[data-placed\]\):not\(\[data-collapsed\]\):not\(\[data-maximized\]\) \{\s*top: auto !important;/);
    // A window or sheet is told apart from the work by the popover shadow plus the
    // app's one hairline (--border-subtle) at every width, with no narrower rule that
    // restates both. The e2e overlays spec measures both at 700 and 500px, and the
    // system-colour edge in forced colours.
    const frame = artifactCss.match(/\n\.motif-cs-window \{([^}]*)\}/)?.[1] ?? '';
    expect(frame).toContain('border: 1px solid var(--border-subtle);');
    expect(frame).toContain('box-shadow: var(--elevation-popover);');
    expect(artifactCss).toMatch(/\n {2}--elevation-popover: 0 8px 24px color-mix\(in srgb, var\(--shadow-ink\) 12%, transparent\), 0 1px 3px color-mix\(in srgb, var\(--shadow-ink\) 8%, transparent\), 0 0 0 1px var\(--elevation-edge\);/);
    const sheetRules = [
      ...artifactCss.matchAll(/\n\s*\.motif-cs-window\[(?:data-fit\]\[)?(?:data-fill\]\[)?data-sheet\][^{]*\{([^}]*)\}/g),
    ].map((match) => match[1]);
    expect(sheetRules.length).toBeGreaterThanOrEqual(3);
    for (const sheet of sheetRules) {
      expect(sheet).not.toMatch(/box-shadow|border(?:-top)?(?:-width)?:\s*(?:0|none)\b|border-color/);
    }
    // Edge to edge below 600px, the sheet keeps its top hairline.
    expect(artifactCss).toMatch(/\n\.motif-cs-window\[data-fill\]\[data-sheet\]:not\(\[data-placed\]\):not\(\[data-collapsed\]\):not\(\[data-maximized\]\) \{[^}]*border-width: 1px 0 0;/);
    expect(artifactCss).toMatch(/@media \(max-width: 840px\)[\s\S]*?\.motif-cs-window\[data-collapsed\]\s*\{[\s\S]*?left:\s*8px !important;[\s\S]*?width:\s*calc\(100vw - 16px - var\(--motif-cs-floating-right-inset, 0px\)\) !important/);
    expect(artifactCss).not.toMatch(/@media \(max-width: 840px\)[\s\S]*?\.motif-cs-window\s*\{[\s\S]*?height:\s*min\(30vh, 240px\) !important/);
  });

  it('opens Export as a popover that never scrolls the sequence column, and closes it on Escape', () => {
    const exportPanel = sliceBetween(
      artifactSource,
      'function SequenceToolsPanel({',
      '/**\n * A floating, draggable, resizable, closable window',
    );
    const reveal = sliceBetween(artifactSource, 'const revealExportPanel = useCallback', '}, [exportOpenedFrom]);');

    // Opening does not move the column: an in-flow panel would scroll it
    // 339px at 1024x768, 1280x720 and 1440x900.
    expect(reveal).not.toContain('scrollIntoView');
    expect(reveal).not.toContain('scrollTop');
    expect(exportPanel).not.toContain('column.scrollTo');
    expect(artifactSource).not.toContain('exportReturnScrollRef');
    expect(artifactCss).toMatch(/\.motif-cs-sequence-tools-panel\[open\] > \.motif-cs-export-body\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?overflow:\s*auto;[\s\S]*?container-type:\s*inline-size/);
    // Anchored to the title-row button, or above the summary that opened it,
    // and bounded by the room the viewport has.
    expect(exportPanel).toContain("const anchor = triggerOnScreen ? triggerRect : summary.getBoundingClientRect();");
    // A summary that a resize left off screen does not take the popover with it,
    // and the popover is never taller than the window.
    expect(exportPanel).toContain('const anchorTop = clamp(anchor.top, ceiling, window.innerHeight - margin);');
    expect(exportPanel).toContain('const anchorBottom = clamp(anchor.bottom, ceiling, window.innerHeight - margin);');
    expect(exportPanel).toContain("body.style.maxHeight = `${Math.max(0, Math.floor(Math.min(Math.max(120, below ? roomBelow : roomAbove), reach)))}px`;");

    // Escape closes it and hands focus back to whatever opened it, without
    // reaching the document handler that clears the selection.
    expect(exportPanel).toMatch(/if \(event\.key !== 'Escape' \|\| !exportPanelRef\.current\?\.open\) return;\s*[\s\S]*?event\.stopPropagation\(\);\s*closeExportPanel\(\);/);
    expect(exportPanel).toContain("const returnTo = openedFrom === 'header' && trigger?.isConnected");
    expect(exportPanel).toContain('aria-label="Close export"');

    // There is no resizable in-flow viewport, since nothing scrolls for it to serve.
    expect(artifactSource).not.toContain('Resize Export and Copy panel');
    expect(artifactCss).not.toContain('motif-cs-export-resize-handle');
    expect(artifactCss).not.toContain('data-resized');
    expect(artifactCss).toMatch(/\.motif-cs-sequence-preview\s*\{[\s\S]*?max-height:\s*min\(52vh, 520px\)[\s\S]*?overflow:\s*auto/);
  });

  it('says what each Complement does: the toolbar shows a strand, Export copies one', () => {
    expect(artifactSource).toContain('>Copy complement</button>');
    expect(artifactSource).not.toMatch(/onCopy\('Complement', complementSequence\)[^>]*>Complement<\/button>/);
    expect(artifactSource).toContain('aria-label="Complement strand"');
  });

  it('previews the selected export payload instead of always showing raw sequence', () => {
    expect(artifactSource).toContain('const exportFallbackPreview = exportChoice?.id');
    expect(artifactSource).toContain('const exportPreview = exportChoice?.blocked');
    expect(artifactSource).toContain(': exportChoice?.content ?? exportFallbackPreview;');
    expect(artifactSource).toContain("exportChoice?.id === 'inventory-zip'");
    expect(artifactSource).toContain("exportChoice?.id === 'report-print'");
    expect(artifactSource).toContain('value={exportPreview} aria-label="Export preview"');
    expect(artifactSource).not.toContain('value={preview} aria-label="Copyable sequence preview"');
  });

  it('exports each record with its own restriction-enzyme source settings', () => {
    expect(artifactSource).toContain('const itemSources = enzymeSourcesByRecord[item.id] ?? DEFAULT_ENZYME_SOURCES;');
    expect(artifactSource).toContain('restrictionEnzymesForSources(itemSources, customEnzymes)');
    expect(artifactSource).toContain('[customEnzymes, enzymeSourcesByRecord, exportRecords, needsInventoryExport]');
    expect(artifactSource).not.toContain('recordSitesForExport(item, scanEnzymes)');
    // Resolve through the shared helper, never a second inline union. Calling
    // resolveEnzymeUnion directly skips the empty-source check the helper
    // carries, and it answers an empty list with the Common working set — so
    // the export listed sites for enzymes every other surface reported as not
    // selected.
    expect(artifactSource).not.toContain('resolveEnzymeUnion(itemSources)');
  });

  it('collapses absent intermediate-width pane tracks and preserves wider-layout preferences', () => {
    expect(artifactSource).toContain('data-content-pane-count={dockedContentPaneCount}');
    expect(artifactSource).toContain("&& visibleContentPanes.length === 3");
    expect(artifactSource).toContain("if (twoRowLayout && pane === 'inventory') return 'sequence';");
    expect(artifactSource).toContain('const startPreferredWidths = { ...preferredPaneWidths };');
    expect(artifactCss).toContain('.motif-cs-main[data-content-pane-count="2"]');
    expect(artifactCss).toContain('.motif-cs-main[data-content-pane-count="1"]');
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-import-slot\s*\{\s*min-height:\s*0/);
    expect(artifactCss).toContain('clamp(160px, var(--motif-cs-inventory-pane-width, 210px), 38vw)');
  });

  it('lets the collapsed Tools rail scroll once its fifteen tools stop fitting', () => {
    // Below 695px of viewport the rail's tools do not fit. Without a scroll they
    // would leave the screen, with Settings and Alignment unreachable by wheel,
    // touch-drag or Tab.
    const rule = sliceBetween(
      artifactCss,
      '@media (max-height: 709px) {',
      '\n}',
    );
    expect(rule).toContain('.motif-cs-inspector[data-tools-pinned="false"]');
    expect(rule).toContain('overflow-y: auto');
    // pointer-events must be restored INSIDE the query. Without it the wheel
    // targets whatever sits beneath the rail, so scrolling works only while the
    // pointer is over an icon and is dead in the 3px gaps between them, and the
    // thumb cannot be dragged at all. Measured: 103 over an icon, 0 in a gap.
    expect(rule, 'scroll without pointer-events is a mirage -- dead in the gaps').toContain('pointer-events: auto');
    // One scrollbar for the app: same pair as the matrix and the inventory.
    expect(rule).toMatch(/scrollbar-color:\s*color-mix\(in srgb, var\(--text-muted\) 68%, var\(--border-strong\)\)\s*color-mix\(in srgb, var\(--bg-secondary\) 78%, var\(--bg-primary\)\)/);

    // The rail must stay pointer-events:none OUTSIDE the query, because above
    // this height there IS empty rail space and it must keep passing clicks
    // through to a floating workspace underneath (measured empty space: 205px
    // at 900, 65px at 760, 5px at 700, 0px at 694 and below).
    const collapsed = sliceBetween(artifactCss, '.motif-cs-inspector[data-tools-pinned="false"] {', '}');
    expect(collapsed).toContain('pointer-events: none');

    // 731 is derived, not chosen: 16 heads x 34px + 15 gaps x 3px + title and
    // 8px padding = 662px of content under a 70px top bar, so 732 is the last
    // height that fits. These are the inputs -- if any moves, re-derive.
    expect(collapsed).toContain('padding: 8px 5px');
    expect(collapsed).toContain('gap: 3px');
    expect(artifactCss).toMatch(/\.motif-cs-inspector\[data-tools-pinned="false"\] \.motif-cs-panel-head\s*\{[\s\S]*?min-height:\s*34px/);
    // Tool count is the other input. 17 rail labels exist in the artifact, 16 of
    // them in this rail; adding one moves the breakpoint and must fail here.
    expect((artifactSource.match(/data-rail-label="/g) ?? []).length,
      'rail tool count changed -- re-derive the 731px breakpoint').toBe(17);
  });

  it('does not paint a feature label that can only be an ellipsis', () => {
    // Feature blocks are sized in `ch` from the bases they cover and a feature
    // that wraps is drawn once per line, so a line break can leave a 12px
    // fragment. Below ~34px there is no room for one character and an
    // ellipsis, so the label resolved to the ellipsis alone: 6.2px of ink
    // saying nothing. Measured on the built artifact, blocks painting one
    // character or fewer: 1 at 900x800, 0 at 1100-1440, 2 at 1680x1050, 2 at
    // 1920x1080. After: 0 everywhere, with no block that could show two or
    // more characters losing its label, no block resized, and all 8 arrowhead
    // blocks still clipped.
    // Bounded to the rule body with [^}] on purpose: a lazy [\s\S]*? happily
    // runs past the closing brace and matches a container-type declared on some
    // other selector, which is exactly how this assertion first passed against
    // a build with the declaration deleted.
    expect(artifactCss).toMatch(/\.motif-cs-feature-block \{[^}]*container-type:\s*inline-size/);
    expect(artifactCss).toMatch(/@container \(max-width: 34px\) \{\s*\.motif-cs-feature-block span \{\s*display: none/);
    // The width comes from an inline style and never from the label, which is
    // what makes inline-size containment safe on this element.
    expect(artifactSource).toContain("style={{ left: `${leftCh}ch`, width: `${widthCh}ch`");
    // The name is still reachable without the label.
    expect(artifactSource).toContain('title={`${feature.name} · ${featureTypeDisplay(feature)} · ${featureRangeLabel(feature)} · Double-click to edit`}');
  });

  it('gives two small controls a 24px target without moving their rows', () => {
    // The Guide RNA toggle measured 47.9x19 and the record-title rename trigger
    // 48.8x18, both under 24px, both real click targets. Measured before and
    // after at 900x800, 1440x900, 1680x1050 and 1920x1080: each control goes to
    // 24px and neither row changes -- the toggle's flex line stays 44px because
    // its tallest item is a 32px field, and the title row stays 26px because of
    // the Export button beside it.
    expect(artifactCss).toMatch(/\.motif-cs-toggle-inline \{[^}]*min-height:\s*24px/);
    // Still a block container: `text-overflow` trims inline content, so a flex
    // container here would drop the ellipsis that keeps a long record name off
    // the edge. The trigger is a 28px control, through min-height on that block
    // with 4px of padding; the title row is 28px because of the Export and pane
    // buttons beside it.
    expect(artifactCss).toMatch(/\.motif-cs-title-edit-trigger \{[^}]*display: block;[^}]*min-height: var\(--control-h-sm\);[^}]*padding: 4px 0;/);
    expect(artifactCss).toMatch(/\.motif-cs-title-edit-trigger \{[^}]*text-overflow: ellipsis/);
  });

  it('does not report a guide count before guides are counted', () => {
    // findGuidesInRange runs on first open, which is the right call for a scan
    // this size -- but `guides` is empty until then, and the rail chip must not
    // print that emptiness as a result. The chip does not read "0" on first paint
    // and a real count after the panel is opened.
    expect(artifactSource).toContain('() => hasOpened ? findGuidesInRange(sequence, sequenceType, nuclease, activeScopeRange, topology) : [],');
    // With no record at all there is nothing to count either, so no chip.
    expect(artifactSource).toMatch(/const guideChip = !hasRecord\s*\?\s*undefined\s*:\s*!isNucleotide\s*\?\s*'n\/a'\s*:\s*hasOpened\s*\?/);
    expect(artifactSource).toContain('{guideChip ? <span className="motif-cs-chip">{guideChip}</span> : null}');
    expect(artifactSource).not.toContain("const guideChip = isNucleotide ? `${guides.length}");
  });

  it('keeps every rail head to one line by not counting to zero', () => {
    // A "0 reads" chip would be the rail's only zero counter, and it would make
    // Construct Verification the only two-line head in a list of 16.
    // Measured docked at 1280x800, 1440x900 and 1920x1080: 15 heads at 34px and
    // this one at 42.2px with a 28.2px label span with the chip. Without it the head
    // is 34px with the full 174px label on one line, so the count and
    // the ragged row are one defect, not two.
    expect(artifactSource).toContain('{constructVerificationReadCount ? (');
    expect(artifactSource).not.toMatch(/<span>Construct verification<\/span>\s*<span className="motif-cs-chip">/);
    // The full label stays -- shortening it would fix the row and lose the name.
    expect(artifactSource).toContain('<span>Construct verification</span>');
    // And the count is still reachable from the head itself.
    expect(artifactSource).toContain('`Construct verification — ${constructVerificationReadCount} eligible Sanger read${constructVerificationReadCount === 1 ? \'\' : \'s\'}`');
  });

  it('keeps a disabled control readable against its backdrop', () => {
    // Measured on the built artifact, rasterised over each control's real
    // backdrop (rasteriser checked first against #777 on white = 4.48):
    //   at 0.48/0.52  map 2.61 light; mini 2.56
    //   at 0.62       map 3.74 light, 5.56 dark; mini 3.64, 5.41
    // Dark clears 3:1 at either value, so the opacity is a light-theme matter
    // wearing a global declaration. Enabled controls of the same class measure
    // 8.17-12.70, so the state is still obvious.
    for (const sel of ['.motif-cs-map-button', '.motif-cs-pane-toggle', '.motif-cs-row', '.motif-cs-mini-button']) {
      expect(artifactCss).toMatch(new RegExp(`\\${sel}:disabled \\{[^}]*opacity: 0\\.62`));
    }
    // These four only. Fourteen selectors set a disabled opacity and the rest
    // run from 0.35 to 1 -- .motif-cs-assembly-part-actions button at 0.35,
    // .motif-cs-pane-placement-button at 0.40, .motif-cs-segmented button at
    // 0.45, .motif-cs-pane-collapse at 0.46, .motif-cs-restriction-site-row at
    // 0.55, .motif-cs-icon-button at 0.56. Those are not measured here, and an
    // unmeasured control is not a finding.
    expect(artifactCss).not.toMatch(/\.motif-cs-map-button:disabled \{[^}]*opacity: 0\.48/);
    expect(artifactCss).not.toMatch(/\.motif-cs-mini-button:disabled \{[^}]*opacity: 0\.52/);
  });

  it('applies the stacked map floor at short heights too', () => {
    // The cap applies to workspaces under 620px as well: sweeping the drag range
    // shows there is height to redistribute there. At 1100x650 an uncapped default
    // would give the sequence pane 286px and the ring 117.4px, while 240px gives the
    // ring 145.3px -- 24% more map -- with one full block of sequence either way. At
    // the default with nothing dragged:
    //   1100x650  top 240  ring 145.3  1 full block
    //   1100x600  top 240  ring 127.1  1 full block
    //   1280x720  top 240  ring 202.3  1 full block
    //   1366x768  top 240  ring 256.2  1 full block
    //   1440x800  top 251  ring 275.6  1 full block
    // The floor is COMPACT_ROW_MIN_HEIGHT, not compactRowMinHeight, because
    // the latter drops to 150 below 620 and 150px of sequence pane is chrome
    // with no block under it.
    expect(artifactSource).toContain('const defaultCompactTopRowFloor = Math.min(COMPACT_ROW_MIN_HEIGHT, compactTopRowMaxHeight);');
    expect(artifactSource).not.toMatch(/const defaultCompactTopRowMaxHeight = workspaceMainSize\.height <= 620/);
    // The resize bound is untouched: this caps where the divider starts, never
    // where it can go.
    expect(artifactSource).toContain('return { min: compactRowMinHeight, max: compactTopRowMaxHeight };');
    expect(artifactSource).toContain('const compactBottomRowMinHeight = compactRowMinHeight;');
  });
});
