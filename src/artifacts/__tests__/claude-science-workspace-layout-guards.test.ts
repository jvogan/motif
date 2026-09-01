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
  it('offers four host-neutral themes and migrates legacy theme ids', () => {
    expect(artifactSource).toContain("type ArtifactThemeName = 'light' | 'dark' | 'warm-light' | 'warm-dark';");
    expect(artifactSource).toContain("{ id: 'light', palette: 'light', label: 'Light', description: 'Neutral surface · blue' }");
    expect(artifactSource).toContain("{ id: 'dark', palette: 'dark', label: 'Dark', description: 'Deep neutral · blue' }");
    expect(artifactSource).toContain("{ id: 'warm-light', palette: 'claude-light', label: 'Warm Light', description: 'Warm paper · terracotta' }");
    expect(artifactSource).toContain("{ id: 'warm-dark', palette: 'claude-dark', label: 'Warm Dark', description: 'Warm charcoal · coral' }");
    expect(artifactSource).toContain("if (value === 'claude-light' || value === 'claude') return 'warm-light';");
    expect(artifactSource).toContain("if (value === 'claude-dark' || value === 'tokyo') return 'warm-dark';");
    expect(artifactSource).toContain("const WORKSPACE_LAYOUT_STORAGE_KEY = 'motif.workspace-layout.v1';");
    expect(artifactSource).toContain("const LEGACY_WORKSPACE_LAYOUT_STORAGE_KEY = 'motif.claude-science.workspace-layout.v1';");
    expect(artifactSource).not.toContain("label: 'Claude Beige'");
    expect(artifactCss).toContain('html[data-theme="claude-light"]');
    expect(artifactCss).toContain('html[data-theme="claude-dark"]');
    expect(artifactCss).not.toContain('html[data-theme="tokyo"]');
    expect(artifactSource).toContain('data-map-mode={layout.mode}');
    expect(artifactSource).toContain('data-theme={mapTheme}');
    expect(artifactSource).toContain('applyArtifactTheme(loadWorkspaceLayoutPrefs().theme);');
    expect(artifactSource).toContain("document.querySelector<HTMLMetaElement>('meta[name=\"theme-color\"]')");
    expect(artifactSource).toContain("description: 'Warm paper · terracotta'");
    expect(artifactSource).toContain("description: 'Warm charcoal · coral'");
    expect(artifactCss).toContain('.motif-cs-theme-choice[data-theme-choice="claude-light"]');
    expect(artifactCss).toContain('--theme-preview-claude-light-surface: #f9f9f7;');
    expect(artifactCss).toContain('--theme-preview-claude-dark-surface: #1f1f1f;');
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

  it('lets "Reset display" reach every floating tool window, including one already open', () => {
    // The seven tool windows keep their geometry in plain state, deliberately: a
    // size dragged onto a corner survives closing and reopening that window. What
    // was missing is the way back — the button reset the panes and left every
    // window exactly as small as it found it, which is the state a user presses
    // it in.
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
    for (const tool of ['Translations', 'Primer', 'Alignment', 'Gel', 'Assembly', 'CloningDesign', 'ConstructVerification']) {
      expect(resetRects, `the ${tool} window is not restored by "Reset display"`)
        .toContain(`set${tool}Win(default${tool}WindowRect());`);
    }
    expect(resetRects).toContain('setWindowResetSignal((value) => value + 1);');

    // Resetting that state is only half of it. `initial` is read once, in a
    // useState initialiser, so a window that is already open when the button is
    // pressed never sees the new rect — measured on the live app, it sat at
    // 280x180 while only the NEXT open came up correct, which is the one moment
    // the user is guaranteed not to be watching. Every window must be handed the
    // signal or it is one of the ones that does not move.
    const windowElements = artifactSource.split('<FloatingWindow').slice(1)
      .map((chunk) => chunk.slice(0, chunk.search(/\n\s*>\n/)));
    expect(windowElements, 'expected seven floating tool windows').toHaveLength(7);
    for (const element of windowElements) {
      const rect = /initial=\{(\w+)\}/.exec(element)?.[1];
      expect(rect, 'a FloatingWindow is rendered without an initial rect').toBeTruthy();
      expect(element, `the ${rect} window is never told that a display reset happened`)
        .toContain('resetSignal={windowResetSignal}');
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
      "if (pane !== 'tools' && current[pane] && openContentCount <= 1) return current;",
    );
  });

  it('keeps the active record tab visible without scrolling the workspace', () => {
    expect(artifactSource).toContain('const recordTabsRef = useRef<HTMLElement | null>(null);');
    expect(artifactSource).toContain('ref={recordTabsRef}');
    expect(artifactSource).toContain("tabs?.querySelector<HTMLElement>('.motif-cs-record-tab[data-active=\"true\"]')");
    expect(artifactSource).toContain("tabs.scrollTo({ left: tabRight - tabs.clientWidth, behavior: 'auto' })");
  });

  it('makes every ORF count name the population it counted', () => {
    // Measured on the app's own pUC19 (2,578 bp, circular) with the real
    // detector. "221 ORFs" is true and points the wrong way: it is 221
    // start-to-stop intervals at a 10 aa floor over six frames, counting the
    // standard table's ATG/TTG/CTG starts — only 76 of the 221 begin ATG — and
    // findORFs emits one entry per START, so the 221 sit on just 159 distinct
    // (strand, stop) reading frames. Four of the eight rows the panel lists are
    // the same reverse-strand frame entered at four different starts.
    //
    // The sharper defect the filing did not have: the record summary reports
    // the SAME word for a 30 aa population — 96 on this record — so the app
    // published 221 and 96 as "ORFs" with nothing to tell them apart, because
    // only the summary's EMPTY branch named its floor. Both are legitimate
    // populations, so both now say which they are; unifying them would have
    // moved a number somebody may already be quoting.
    expect(artifactSource).toContain('const ANALYSIS_ORF_MIN_AA = 10;');
    expect(artifactSource).toContain('const SUMMARY_ORF_MIN_AA = 30;');

    // The floor in the label must be the floor that was scanned, so the two
    // cannot drift: both call sites take the constant, not a literal.
    expect(artifactSource).toContain('findORFs(record.sequence, ANALYSIS_ORF_MIN_AA, translationCode.table, { topology })');
    expect(artifactSource).toContain('findORFs(record.sequence, SUMMARY_ORF_MIN_AA, translationCode.table, { topology })');
    expect(artifactSource).not.toMatch(/findORFs\(record\.sequence,\s*\d/);

    // Chip and rail-popover meta both carry the floor.
    expect(
      artifactSource.match(/\$\{allOrfs\.length\} ORFs ≥\$\{ANALYSIS_ORF_MIN_AA\} aa/g),
      'both the summary chip and the popover meta must name the floor',
    ).toHaveLength(2);

    // The record summary names its floor in the non-empty branch too, not only
    // when the count is zero.
    expect(artifactSource).toContain('`ORFs: ${orfs.length} ≥${SUMMARY_ORF_MIN_AA} aa (longest ');
    expect(artifactSource).toContain('`ORFs: none ≥${SUMMARY_ORF_MIN_AA} aa`');
    // ...and the machine-readable copy carries it as data.
    expect(artifactSource).toContain('minAminoAcids: SUMMARY_ORF_MIN_AA,');

    // The panel states the definition next to the count, including the
    // denominator that explains the inflation. Derived from the SAME array the
    // rows render from so the two cannot disagree about one quantity.
    expect(artifactSource).toContain('new Set(allOrfs.map((orf) => `${orf.strand}:${orf.end}`)).size');
    expect(artifactSource).toContain('start-to-stop intervals ≥{ANALYSIS_ORF_MIN_AA} aa');
    expect(artifactSource).toContain('across {orfReadingFrameCount} distinct reading frames');
    // The start set comes from the table the scan used, because the panel has a
    // "Record genetic code" select and the tables disagree — standard initiates
    // at ATG/TTG/CTG, vertebrate mitochondrial at ATT/ATC/ATA/ATG/GTG. A fixed
    // list here would be one more readout true of some other configuration.
    expect(artifactSource).toContain('translationCode.table.starts');
    expect(artifactSource).toContain('starting at {orfStartCodons}');
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
    // The filing supposed the base rule had been added later and the
    // media-query one left behind as redundant; `git log -S` refutes that —
    // both, and the sequence-title rule, arrived in the initial commit.
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

    // ...and the rules that hid them are gone rather than left to hide markup
    // that no longer exists.
    expect(artifactCss).not.toContain('.motif-cs-topbar-meta > .motif-cs-chip');
    expect(artifactCss).not.toContain('.motif-cs-sequence-title .motif-cs-title-actions .motif-cs-chip');
    // This one never matched anything: the topbar's only children are
    // .motif-cs-brand and .motif-cs-topbar-meta, so a direct-child chip
    // selector had nothing to style even before the chips were removed.
    expect(artifactCss).not.toContain('.motif-cs-topbar > .motif-cs-chip');
  });

  it('gives the record tab strip a themed scrollbar and no inert webkit rules', () => {
    // Thirteen records need 1137px, so the strip scrolls from 1024 down: at
    // 1024 pCDFDuet-1 is entirely off-strip, at 900 pRSFDuet-1 goes with it.
    // The edge fades work (measured headed: 1.15:1 against the field, and the
    // shadow swaps ends with scroll position), but the bar is what says how
    // much is left, and with no colour it fell through to the platform default
    // at 1.72:1 in BOTH light themes and 2.66:1 in both dark ones — identical
    // rgb across themes, the tell that it was never themed at all. Now 4.30,
    // 5.38, 4.59 and 4.50, measured HEADED because headless Chromium paints no
    // scrollbar for a non-root scroller and would show nothing to measure.
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
    // pseudo-elements entirely. The pair that used to sit here declared a 5px
    // bar and a border-strong thumb and delivered neither — 11px, Chromium's
    // own thumb. Dead text that reads like live styling is worse than none.
    expect(artifactCss).not.toContain('.motif-cs-record-tabs::-webkit-scrollbar');
  });

  it('names each tool on the collapsed rail the moment it is hovered or focused', () => {
    // The collapsed rail is the default tools state and every head in it is a
    // 38x34 icon with its label clipped to 1px, so before this rule nothing on
    // the first screen said Primer Design, Guide RNA or Construct Verification.
    // The native title needed a ~1s hover and never fired on keyboard focus.
    const flyout = sliceBetween(
      artifactCss,
      '.motif-cs-inspector[data-tools-pinned="false"]\n  .motif-cs-panel:not([open])\n  > .motif-cs-panel-head:is(:hover, :focus-visible)::before {',
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
    // The empty alt text keeps generated content out of the accessible name,
    // which every rail head resolves from its own clipped label.
    expect(flyout).not.toMatch(/content: attr\(title\);/);
    // The head is the flyout's containing block.
    expect(artifactCss).toContain('.motif-cs-inspector[data-tools-pinned="false"] .motif-cs-panel-head {\n  position: relative;');
    // The base rule that this one overrides must still switch the marker off.
    expect(artifactCss).toContain('.motif-cs-inspector[data-tools-pinned="false"] .motif-cs-panel-head::before {\n  content: none;\n}');
    // A scrolling rail clips, so the flyout stands down rather than mislabel an
    // icon. That rule has to live inside the query that starts the scrolling.
    // Same specificity as the rule above, so only source order separates them:
    // the stand-down must come after the flyout or it never applies.
    const flyoutAt = artifactCss.indexOf('> .motif-cs-panel-head:is(:hover, :focus-visible)::before {\n  content: attr(title)');
    expect(flyoutAt).toBeGreaterThan(-1);
    const standDownAt = artifactCss.indexOf('@media (max-height: 731px) {', flyoutAt);
    expect(standDownAt).toBeGreaterThan(flyoutAt);
    expect(artifactCss.slice(standDownAt, standDownAt + 400))
      .toContain('> .motif-cs-panel-head:is(:hover, :focus-visible)::before {\n    content: none;');
  });

  it('paints the sequence edit toolbar as a scroll strip instead of hiding its bar', () => {
    // Measured `scrollWidth - clientWidth` on .motif-cs-edit-toolbar: 114px at
    // 320 wide, 74 at 360, 44 at 390, 4 at 430, 0 through 620, and 11 again at
    // exactly 640 where the layout crosses a breakpoint. The Complement switch is
    // what leaves the right edge, so the control that says which strand you are
    // reading was the one with no cue that it existed: `scrollbar-width: none`
    // plus a ::-webkit-scrollbar display:none removed the only cue the platform
    // gives, and nothing replaced it.
    const toolbar = sliceBetween(artifactCss, '.motif-cs-edit-toolbar {', '}');
    expect(toolbar).toContain('overflow-x: auto');
    expect(toolbar, 'the edit toolbar scrolls with its bar switched off').not.toContain('scrollbar-width: none');
    expect(toolbar).toContain('scrollbar-color:');

    // One scrollbar for the app: the same two tokens the record tabs use.
    const tabs = sliceBetween(artifactCss, '.motif-cs-record-tabs {', '}');
    const colourOf = (rule: string) => /scrollbar-color:\s*([^;]+);/.exec(rule)?.[1].replace(/\s+/g, ' ').trim();
    expect(colourOf(toolbar)).toBeTruthy();
    expect(colourOf(toolbar)).toBe(colourOf(tabs));

    // Edge fades on both ends, attached `local` so the shadow swaps sides with the
    // scroll position — the treatment .motif-cs-selection-actions already carries
    // in this same pane. Verified painted at 390px in all four themes; the thin
    // bar costs no height, the row stays 36px.
    expect(toolbar).toContain('background-attachment: local, local, scroll, scroll');
    expect(toolbar).toContain('linear-gradient(to right, var(--motif-cs-edit-toolbar-bg) 30%, transparent)');
    expect(toolbar).toContain('linear-gradient(to left, var(--motif-cs-edit-toolbar-bg) 30%, transparent)');

    // Naming a `scrollbar-color` makes Chromium ignore ::-webkit-scrollbar on the
    // same element, so the old display:none rule became dead text that reads like
    // live styling. It is deleted rather than overridden.
    expect(artifactCss).not.toContain('.motif-cs-edit-toolbar::-webkit-scrollbar');
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
    expect(artifactSource).toContain("sequence: { min: 240, max: 2000 }");
    expect(artifactSource).toContain("map: { min: 300, max: 2000 }");
    expect(artifactCss).toMatch(/\.motif-cs-resize-handle\[data-pane="sequence"\]\s*\{[\s\S]*?display:\s*block/);
    expect(artifactCss).toMatch(/@media \(min-width: 768px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="inventory"\],[\s\S]*?\.motif-cs-resize-handle\[data-pane="sequence"\][\s\S]*?display:\s*block/);
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
    expect(artifactCss).toMatch(/@media \(min-width: 640px\) and \(max-width: 1535px\)[\s\S]*?\.motif-cs-resize-handle\[data-pane="sequence"\]\s*\{[\s\S]*?display:\s*none/);
  });

  it('reflows a pinned compact workspace without overlaying or reserving a hidden map lane', () => {
    expect(artifactSource).toContain('data-tools-pinned={toolsDocked || undefined}');
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
    // One action, one name: the bar and the Translation panel both call
    // addTranslationLayer, so both say "Add AA track". The short pair survives
    // only as the narrow-width spelling, and aria-label keeps the accessible
    // name on the full form at every width.
    expect(artifactSource).toContain(
      `<span className="motif-cs-label-full">{selectedInlineTranslationTrack ? 'Remove AA track' : 'Add AA track'}</span>`,
    );
    expect(artifactSource).toContain(
      `<span className="motif-cs-label-short">{selectedInlineTranslationTrack ? 'Del AA' : 'Add AA'}</span>`,
    );
    expect(artifactSource).toContain(
      "aria-label={selectedInlineTranslationTrack ? 'Remove AA track' : 'Add AA track'}",
    );
    expect(artifactSource).toContain('disabled={!selectedInlineTranslationTrack && (!selectionActionTranslation || !canPinPreviewTranslation)}');
    expect(artifactSource).toContain('if (selectedInlineTranslationTrack) deleteTranslationLayer(selectedInlineTranslationTrack.id);');
    expect(artifactSource).toContain('addTranslationLayer();');
    expect(artifactSource).toContain('onTranslationTrackSelect={handleTranslationTrackSelectAndReveal}');
    expect(artifactSource).toMatch(/>\s*\+ Feature\s*<\/button>/);

    // Both controls in this bar that add a record to the inventory say so. They
    // used to be spelled like the "Copy" beside them, so pressing "Rev comp"
    // took a session from 13 records to 14 and opened a new Derived group with
    // nothing in the label to warn of it — and with no selection it is the only
    // enabled control here, so it was the one thing the resting bar invited.
    // "New" is the word the Export panel already uses to tell "Copy rev comp"
    // from "New rev comp"; reusing it keeps the two surfaces agreeing.
    expect(artifactSource).toContain('<span className="motif-cs-label-full">New rev comp</span>');
    expect(artifactSource).toContain('<span className="motif-cs-label-short">+ RC</span>');
    expect(artifactSource).toContain('<span className="motif-cs-label-full">New protein</span>');
    expect(artifactSource).toContain('<span className="motif-cs-label-short">+ Prot</span>');
    expect(artifactSource).toContain('aria-label="New rev comp record"');
    expect(artifactSource).toContain('aria-label="New protein record"');
    // The rule is decoration; the labels carry the meaning, so it stays hidden
    // from assistive tech and must never become the only signal.
    expect(artifactSource).toContain('<span className="motif-cs-selection-action-rule" aria-hidden="true" />');
    expect(artifactCss).toMatch(/\.motif-cs-selection-actions \.motif-cs-selection-action-rule\s*\{[\s\S]*?width:\s*1px/);
    // One switch, not a two-member segmented control: the same click both
    // enters and leaves Detail, so the row reads like the Complement switch
    // beside it. Guard the toggling call, which a split control cannot make.
    expect(artifactSource).toContain(
      "onClick={() => setSequenceViewMode(effectiveSequenceViewMode === 'detail' ? 'standard' : 'detail')}",
    );
    expect(artifactSource).toContain('className="motif-cs-mini-button motif-cs-display-switch motif-cs-detail-toggle"');
    expect(artifactSource).not.toContain('motif-cs-view-toggle');
    expect(artifactSource).not.toContain('aria-label="Standard sequence view"');
    expect(artifactSource).toContain('if (selectionSummary) {');
    expect(artifactSource).toContain('if (hasMaterializableSequenceSelection) addSelectionReverseComplementRecord();');
    expect(artifactSource).toContain('onClick={addContextReverseComplementRecord}');
    expect(artifactSource.match(/onClick=\{addContextReverseComplementRecord\}/g)).toHaveLength(1);
    expect(editToolbar).not.toContain('addContextReverseComplementRecord');
    expect(artifactSource).toContain('disabled={!isNucleotideRecord || (!!selectionSummary && !hasMaterializableSequenceSelection)} onClick={addContextReverseComplementRecord}');
    expect(artifactSource).toContain('className="motif-cs-edit-controls"');
    expect(artifactCss).toContain('.motif-cs-switch-track');
    expect(artifactCss).not.toContain('.motif-cs-view-toggle');
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
    // Features and restriction ticks used to veto the gesture entirely, which made
    // 25.5% of the disc's area impossible to start a range drag from. They now take
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
    expect(pointerCancel).toContain('if (event.pointerId !== mapPointerIdRef.current) return;');
    expect(pointerCancel).toContain('event.currentTarget.releasePointerCapture?.(event.pointerId);');
    expect(pointerCancel).toContain('mapPointerIdRef.current = null;');
    expect(pointerCancel).toContain('mapDragRef.current = null;');
    expect(pointerCancel).toContain('mapPressOnObjectRef.current = false;');
    expect(pointerCancel).not.toContain('handleMapPointerEnd();');
    expect(pointerCancel).not.toContain('suppressNextBackgroundClick');
    expect(pointerCancel).not.toContain('suppressNextMapObjectClick');
    expect(artifactSource).toContain('onPointerCancel={handleMapSurfacePointerCancel}');
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
    expect(artifactSource).toContain('rightInset={toolsRail ? TOOLS_RAIL_WIDTH : 0}');
    expect(artifactSource).toContain('clampWindowRect(raw, vw, vh, rightInset)');
    expect(artifactSource).toContain('vw - rightInset - drag.base.x - 8');
    expect(artifactCss).not.toContain('.motif-cs-window-resize {\n    right: 58px;');
  });

  it('keeps the window corner grip above anything the window body stacks', () => {
    // The grip used to declare no z-index, so it lost to the MSA toolbar's
    // sticky z-index: 10 wherever the two overlapped — which is the whole
    // bottom-right corner once the toolbar wraps taller than a short body. The
    // press then went to the toolbar and the window could not be mouse-resized.
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
    expect(artifactSource).toContain('resizeExportPanelTo(340)');
    expect(artifactCss).toContain('.motif-cs-sequence-preview');
  });

  it('copies reverse features in feature orientation from the keyboard path', () => {
    expect(artifactSource).toContain('text = sequenceForFeature(sequence, selectedFeature, sequenceType);');
    expect(artifactSource).toContain('[copyText, handleZoomIn, handleZoomOut, handleZoomReset, pendingDatabaseRestore, recordId, selectedFeature, selectedMapRange, sequence, sequenceType, topology]');
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
    // Stroked, not filled: the edge paths carry no area, so a fill renders nothing.
    expect(edgeRule).toContain('fill: none;');
    // The map hands its per-instance gradient id over as a custom property; the flat
    // accent stays as the fallback so a host without the gradient still draws a line.
    expect(edgeRule).toContain('stroke: var(--motif-pm-selection-edge-gradient, var(--accent));');
    expect(edgeRule).toContain('vector-effect: non-scaling-stroke;');
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
    expect(artifactCss).toMatch(/@media \(max-width: 840px\)[\s\S]*?\.motif-cs-window\s*\{\s*border-color:/);
    expect(artifactCss).toMatch(/@media \(max-width: 840px\)[\s\S]*?\.motif-cs-window\[data-collapsed\]\s*\{[\s\S]*?left:\s*8px !important;[\s\S]*?width:\s*calc\(100vw - 16px - var\(--motif-cs-floating-right-inset, 0px\)\) !important/);
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
    expect(exportPanel).toContain("panel.querySelectorAll<HTMLElement>('.motif-cs-export-row button')");
    expect(exportPanel).toContain('actionBottom - columnRect.bottom,');
    expect(exportPanel).toContain('top: column.scrollTop + scrollDelta,');
    expect(exportPanel).toContain('const observer = new ResizeObserver(() => {');
    expect(exportPanel).toContain('onDoubleClick={() => resizeExportPanelTo(340)}');
    expect(artifactCss).toMatch(/\.motif-cs-export-resize-handle\s*\{[\s\S]*?cursor:\s*ns-resize/);
    expect(artifactCss).toContain('var(--motif-cs-export-panel-height, 220px)');
    expect(artifactCss).toMatch(/\.motif-cs-sequence-tools-panel\[open\]\[data-resized="true"\] \.motif-cs-export-body\s*\{[\s\S]*?overscroll-behavior:\s*contain;[\s\S]*?scrollbar-gutter:\s*stable/);
    expect(artifactCss).toMatch(/\.motif-cs-sequence-preview\s*\{[\s\S]*?max-height:\s*min\(52vh, 520px\)[\s\S]*?overflow:\s*auto/);
  });

  it('previews the selected export payload instead of always showing raw sequence', () => {
    expect(artifactSource).toContain('const exportFallbackPreview = exportChoice?.id');
    expect(artifactSource).toContain('const exportPreview = exportChoice?.blocked');
    expect(artifactSource).toContain(': exportChoice?.content ?? exportFallbackPreview;');
    expect(artifactSource).toContain("exportChoice?.id === 'inventory-zip'");
    expect(artifactSource).toContain("exportChoice?.id === 'report-print'");
    expect(artifactSource).toContain('value={exportPreview} aria-label="Selected export preview"');
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
    // Below 695px of viewport the rail's tools do not fit and used to simply
    // leave the screen -- Settings and Alignment unreachable, with wheel,
    // touch-drag and 120 presses of Tab all measured as no-ops. Only page zoom
    // under 100% recovered them.
    const rule = sliceBetween(
      artifactCss,
      '@media (max-height: 731px) {',
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
    expect(artifactSource).toContain('title={`${feature.name} · ${feature.type} · ${featureRangeLabel(feature)} · Double-click to edit`}');
  });

  it('gives two small controls a 24px target without moving their rows', () => {
    // The Guide RNA toggle measured 47.9x19 and the record-title rename trigger
    // 48.8x18, both under 24px, both real click targets. Measured before and
    // after at 900x800, 1440x900, 1680x1050 and 1920x1080: each control goes to
    // 24px and neither row changes -- the toggle's flex line stays 44px because
    // its tallest item is a 32px field, and the title row stays 26px because of
    // the Export button beside it.
    expect(artifactCss).toMatch(/\.motif-cs-toggle-inline \{[^}]*min-height:\s*24px/);
    // Padding, not min-height, and still a block container: `text-overflow`
    // trims inline content, so a flex container here would drop the ellipsis
    // that keeps a long record name off the edge.
    expect(artifactCss).toMatch(/\.motif-cs-title-edit-trigger \{[^}]*display: block;[^}]*padding: 3px 0;/);
    expect(artifactCss).toMatch(/\.motif-cs-title-edit-trigger \{[^}]*text-overflow: ellipsis/);
  });

  it('does not report a guide count before guides are counted', () => {
    // findGuidesInRange runs on first open, which is the right call for a scan
    // this size -- but `guides` is empty until then, and the rail chip printed
    // that emptiness as a result. Measured on the built artifact at 1440x900:
    // pUC19's chip read "0" on first paint and "250" after the panel was
    // opened once; pBR322 reads 89. The zero was on screen in the default
    // state, for every record, and it was wrong.
    expect(artifactSource).toContain('() => hasOpened ? findGuidesInRange(sequence, sequenceType, nuclease, activeScopeRange, topology) : [],');
    expect(artifactSource).toMatch(/const guideChip = !isNucleotide\s*\?\s*'n\/a'\s*:\s*hasOpened\s*\?/);
    expect(artifactSource).toContain('{guideChip ? <span className="motif-cs-chip">{guideChip}</span> : null}');
    expect(artifactSource).not.toContain("const guideChip = isNucleotide ? `${guides.length}");
  });

  it('keeps every rail head to one line by not counting to zero', () => {
    // "0 reads" was the last zero counter in the rail, and it was also the
    // reason Construct Verification was the only two-line head in a list of 16.
    // Measured docked at 1280x800, 1440x900 and 1920x1080: 15 heads at 34px and
    // this one at 42.2px with a 28.2px label span. Removing the chip alone
    // drops it to 34px with the full 174px label on one line, so the count and
    // the ragged row are one defect, not two.
    expect(artifactSource).toContain('{constructVerificationReadCount ? (');
    expect(artifactSource).not.toMatch(/<span>Construct Verification<\/span>\s*<span className="motif-cs-chip">/);
    // The full label stays -- shortening it would have fixed the row and lost
    // the name.
    expect(artifactSource).toContain('<span>Construct Verification</span>');
    // And the count is still reachable from the head itself.
    expect(artifactSource).toContain('`Construct verification — ${constructVerificationReadCount} eligible Sanger read${constructVerificationReadCount === 1 ? \'\' : \'s\'}`');
  });

  it('keeps a disabled control readable in the light themes', () => {
    // Measured on the built artifact, rasterised over each control's real
    // backdrop (rasteriser checked first against #777 on white = 4.48):
    //   at 0.48/0.52  map 2.61 light, 2.37 claude-light; mini 2.56, 2.33
    //   at 0.62       map 3.74 light, 5.56 dark, 3.19 claude-light, 5.05 claude-dark
    //                 mini 3.64, 5.41, 3.12, 4.82
    // The dark themes already cleared 3:1 at the old values, so this was a
    // light-theme defect wearing a global declaration. Enabled controls of the
    // same class measure 8.17-12.70, so the state is still obvious.
    for (const sel of ['.motif-cs-map-button', '.motif-cs-pane-toggle', '.motif-cs-row', '.motif-cs-mini-button']) {
      expect(artifactCss).toMatch(new RegExp(`\\${sel}:disabled \\{[^}]*opacity: 0\\.62`));
    }
    // These four only. Fourteen selectors set a disabled opacity and the rest
    // run from 0.35 to 1 -- .motif-cs-assembly-part-actions button at 0.35,
    // .motif-cs-pane-placement-button at 0.40, .motif-cs-segmented button at
    // 0.45, .motif-cs-pane-collapse at 0.46, .motif-cs-restriction-site-row at
    // 0.55, .motif-cs-icon-button at 0.56. Several are almost certainly worse
    // than the two that were measured, but they were not measured, and an
    // unmeasured control is not a finding. Left for a pass that can put each of
    // them on screen in its disabled state.
    expect(artifactCss).not.toMatch(/\.motif-cs-map-button:disabled \{[^}]*opacity: 0\.48/);
    expect(artifactCss).not.toMatch(/\.motif-cs-mini-button:disabled \{[^}]*opacity: 0\.52/);
  });

  it('applies the stacked map floor at short heights too', () => {
    // The first version of this cap skipped workspaces under 620px, on the
    // reasoning that there was no height to redistribute there. Sweeping the
    // drag range refuted it: at 1100x650 the untouched default gave the
    // sequence pane 286px and the ring 117.4px, while dragging to 240px gave
    // the ring 145.3px -- 24% more map -- with one full block of sequence
    // either way. Measured after, at the default with nothing dragged:
    //   1100x650  top 240  ring 145.3  1 full block   (was 286 / 117.4)
    //   1100x600  top 240  ring 127.1  1 full block
    //   1280x720  top 240  ring 202.3  1 full block   (unchanged)
    //   1366x768  top 240  ring 256.2  1 full block   (unchanged)
    //   1440x800  top 251  ring 275.6  1 full block   (unchanged)
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
