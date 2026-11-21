import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compactWorkspaceArrangement, defaultSideBySideSequenceShare, inventoryHiddenByDefault, paneCollapseDirection, popOutFloatingPaneRect, sideBySideSequenceShareAfterResize, singleColumnPaneOrder, stackedSequenceRowFloor } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

describe('compact workspace arrangement', () => {
  it('hides the Inventory by default for one record or a panel narrower than 900px', () => {
    expect(inventoryHiddenByDefault(1, 1600)).toBe(true);
    expect(inventoryHiddenByDefault(0, 1600)).toBe(true);
    expect(inventoryHiddenByDefault(2, 899)).toBe(true);
    expect(inventoryHiddenByDefault(3, 600)).toBe(true);
    expect(inventoryHiddenByDefault(2, 900)).toBe(false);
    expect(inventoryHiddenByDefault(13, 1600)).toBe(false);
    // The default only hides what is drawn: the saved visibility is what gets
    // persisted, and the top-bar toggle flips what is on screen.
    expect(artifactSource).toContain('paneVisibility: storedPaneVisibility,');
    expect(artifactSource).toContain("if (pane === 'inventory') setInventoryChosen(true);");
    expect(artifactSource).toContain('const current = inventoryAutoHidden ? { ...stored, inventory: false } : stored;');
    expect(artifactSource).toContain('return { ...stored, [pane]: !current[pane] };');
  });

  it('closes the Records list by default beside a side-by-side split narrower than 1100px', () => {
    // At 1040x860 an open 210px list leaves the Sequence 25 bases a line, and any split
    // that reaches 40 would cut the ring under 85% of its 328px, so the list starts closed.
    expect(inventoryHiddenByDefault(13, 1040, 860)).toBe(true);
    expect(inventoryHiddenByDefault(13, 1099, 860)).toBe(true);
    expect(inventoryHiddenByDefault(13, 1024, 768)).toBe(true);
    // Stacked at the same width (near-square), and from 1100px, the list stays open.
    expect(inventoryHiddenByDefault(13, 1040, 1000)).toBe(false);
    expect(inventoryHiddenByDefault(13, 900, 820)).toBe(false);
    expect(inventoryHiddenByDefault(13, 1100, 860)).toBe(false);
    expect(inventoryHiddenByDefault(13, 1180, 820)).toBe(false);
    expect(inventoryHiddenByDefault(13, 1280, 820)).toBe(false);
    expect(artifactSource).toContain('inventoryHiddenByDefault(payload.records.length, floatingViewport.width, floatingViewport.height)');
    // Sequence starts with 45% of the split there, 40% from 1100px; a moved divider wins.
    expect(defaultSideBySideSequenceShare(1040, false)).toBe(0.45);
    expect(defaultSideBySideSequenceShare(1099, false)).toBe(0.45);
    // With the list open the 40:60 split stands.
    expect(defaultSideBySideSequenceShare(1040, true)).toBe(0.4);
    expect(defaultSideBySideSequenceShare(1100, false)).toBe(0.4);
    expect(defaultSideBySideSequenceShare(1440, false)).toBe(0.4);
    expect(artifactSource).toContain('sideBySideSequenceShare ?? defaultSideBySideSequenceShare(floatingViewport.width, recordsDocked)');
    expect(artifactSource).not.toContain('sideBySideSequenceShare ?? SIDE_BY_SIDE_SEQUENCE_SHARE_DEFAULT');
  });

  it('sizes the single-column map frame from the window and gives the sequence the rest', () => {
    const block = (selectorStart: string) => {
      const at = artifactCss.indexOf(selectorStart);
      expect(at, selectorStart).toBeGreaterThanOrEqual(0);
      return artifactCss.slice(at, artifactCss.indexOf('}', at));
    };
    // Never below 250px: a smaller frame draws the map's labels under 12px. Half the
    // window from 788px tall keeps every name the full map names (700x860, 660x788).
    expect(block('  .motif-cs-map-frame[data-map-mode="circular"] {\n    height: clamp(260px')).toContain('height: clamp(260px, min(50vh, 200vh - 1100px, 85vw), 460px);');
    expect(artifactCss).not.toContain('height: clamp(260px, min(85vw, 50vh), 460px);\n    min-height: 260px;');
    expect(block('  .motif-cs-sequence-column:not([data-stacked-resized="true"]) {\n    flex: 1 0 auto')).toContain('height: auto !important;');
    // The column's own size is its chrome plus 160px of bases, never the whole sequence.
    expect(block('  .motif-cs-sequence-column:not([data-stacked-resized="true"]) .motif-cs-sequence-panel > .motif-cs-sequence {\n    flex: 1 1 auto;')).toMatch(/min-height: 160px;\s*max-height: none;\s*height: 160px;/);
    // A panel too short for any line of sequence keeps the frame it has.
    expect(artifactCss).toContain('@media (max-width: 559px) and (max-height: 690px), (min-width: 560px) and (max-width: 699px) and (max-height: 635px), (min-width: 700px) and (max-width: 899px) and (max-height: 580px) {\n  .motif-cs-map-frame[data-map-mode="circular"] {\n    height: clamp(260px, min(85vw, 50vh), 460px);');
  });

  it('points Collapse up or down where the panes stand one above another', () => {
    expect(paneCollapseDirection('map', ['map', 'sequence'], 'single-column')).toBe('up');
    expect(paneCollapseDirection('sequence', ['map', 'sequence'], 'single-column')).toBe('down');
    expect(paneCollapseDirection('inventory', ['inventory', 'map', 'sequence'], 'single-column')).toBe('up');
    expect(paneCollapseDirection('map', ['inventory', 'map', 'sequence'], 'single-column')).toBe('up');
    expect(paneCollapseDirection('sequence', ['inventory', 'map', 'sequence'], 'single-column')).toBe('down');
    // Two rows: Map under Records and Sequence; Records keeps its left edge.
    expect(paneCollapseDirection('map', ['inventory', 'sequence', 'map'], 'two-rows')).toBe('down');
    expect(paneCollapseDirection('sequence', ['inventory', 'sequence', 'map'], 'two-rows')).toBe('up');
    expect(paneCollapseDirection('inventory', ['inventory', 'sequence', 'map'], 'two-rows')).toBe('left');
    // Side by side, Collapse points left or right.
    expect(paneCollapseDirection('inventory', ['inventory', 'sequence', 'map'], 'columns')).toBe('left');
    expect(paneCollapseDirection('sequence', ['inventory', 'sequence', 'map'], 'columns')).toBe('left');
    expect(paneCollapseDirection('map', ['inventory', 'sequence', 'map'], 'columns')).toBe('right');
    for (const pane of ['inventory', 'map', 'sequence']) {
      expect(artifactSource).toContain(`<PaneCollapseChevron direction={collapseDirectionFor('${pane}')} />`);
    }
    expect(artifactSource).not.toContain('paneCollapsePointsRight');
  });

  it('draws Map just above Sequence in the single column without touching other panes', () => {
    expect(singleColumnPaneOrder(['inventory', 'sequence', 'map', 'tools'])).toEqual(['inventory', 'map', 'sequence', 'tools']);
    expect(singleColumnPaneOrder(['sequence', 'tools', 'inventory', 'map'])).toEqual(['map', 'sequence', 'tools', 'inventory']);
    const mapFirst = ['map', 'inventory', 'sequence', 'tools'] as const;
    expect(singleColumnPaneOrder(mapFirst)).toBe(mapFirst);
  });

  it('puts Sequence beside Map in landscape laptop windows and keeps narrow, portrait and near-square ones stacked', () => {
    // Measured: side by side these show 140-360 bp and a 235-474px ring. Stacked, the
    // four laptop windows would open with one row of bases or none (1535x864: 0 of 155)
    // under a 206-279px ring, and 1024x768 gets a 128px ring to fit its toolbar.
    for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1535, 864], [960, 800], [1024, 900], [900, 700], [959, 700], [900, 800]]) {
      expect(compactWorkspaceArrangement(width, height), `${width}x${height}`).toBe('side-by-side');
    }
    // Stacked keeps the larger ring, or side by side has no room: 820x1100 is 326px
    // stacked against 140px, 1024x1000 is 323 against 263. Below 900px the
    // workspace is one column, so the compact arrangement never applies there.
    for (const [width, height] of [[899, 700], [900, 820], [820, 1100], [1024, 1000], [1100, 1000], [1180, 1100], [600, 900]]) {
      expect(compactWorkspaceArrangement(width, height), `${width}x${height}`).toBe('stacked');
    }
  });

  it('moves the side-by-side divider exactly as far as the pointer, including each pane inset', () => {
    // A flex-basis-0 pane renders as its padding plus its share of the rest, so the
    // share has to be priced against the growable width. Pricing it against the
    // whole width drew the divider 4% short of the pointer and a 16px key step 23px.
    const start = { sequence: 407, map: 601, sequenceInset: 20, mapInset: 20 };
    const growable = start.sequence + start.map - start.sequenceInset - start.mapInset;
    for (const delta of [-120, -16, 0, 16, 120]) {
      const share = sideBySideSequenceShareAfterResize(start, delta);
      expect(start.sequenceInset + share * growable).toBeCloseTo(start.sequence + delta, 6);
    }
  });

  it('never takes Map below 300px or Sequence below 240px from the divider', () => {
    const start = { sequence: 407, map: 601, sequenceInset: 20, mapInset: 20 };
    const total = start.sequence + start.map;
    const growable = total - start.sequenceInset - start.mapInset;
    const widest = start.sequenceInset + sideBySideSequenceShareAfterResize(start, 5000) * growable;
    const narrowest = start.sequenceInset + sideBySideSequenceShareAfterResize(start, -5000) * growable;
    expect(total - widest).toBeCloseTo(300, 6);
    expect(narrowest).toBeCloseTo(240, 6);
  });

  it('lets the stylesheet follow the arrangement the script decided, never a media query of its own', () => {
    expect(artifactSource).toContain('data-workspace-arrangement={workspaceArrangement}');
    expect(artifactSource).toContain("const twoRowResizeActive = !toolsDocked && workspaceArrangement === 'stacked';");
    expect(artifactSource).toContain('const compactPinnedLayout = toolsDocked && stableCompactTopology && !compactSideBySide;');
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-workspace-arrangement="side-by-side"\] > \.motif-cs-sequence-column\[data-pane-placement="docked"\]\s*\{[\s\S]*?flex:\s*var\(--motif-cs-side-by-side-sequence-grow, 0\.4\) 1 0 !important/);
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-workspace-arrangement="side-by-side"\] > \.motif-cs-map-column\[data-pane-placement="docked"\]\s*\{[\s\S]*?flex:\s*var\(--motif-cs-side-by-side-map-grow, 0\.6\) 1 0 !important/);
    // The pinned band shows the row handle with a (0,4,0) selector; the side-by-side
    // hide has to match it or the handle takes a 249px slot between the panes.
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-workspace-arrangement="side-by-side"\] > \.motif-cs-stacked-resize-handle\[data-pane\]\s*\{\s*display:\s*none/);
  });

  it('keeps Sequence over Map when Inventory is hidden in the stacked arrangement', () => {
    expect(artifactCss).toMatch(/\.motif-cs-main\[data-workspace-arrangement="stacked"\]\[data-inventory-hidden="true"\] > \.motif-cs-sequence-column\s*\{\s*grid-column:\s*1 \/ 4/);
    // The exclusion must not raise specificity: one class more and these rules'
    // `!important` widths beat the floating-pane rule, so a popped-out pane opened
    // 232px wide instead of 680px.
    const twoPaneSelectors = artifactCss.match(/\.motif-cs-main\[data-content-pane-count="2"\][^,{]*/g) ?? [];
    expect(twoPaneSelectors.length).toBeGreaterThan(4);
    for (const selector of twoPaneSelectors) {
      if (!selector.includes('data-workspace-arrangement')) continue;
      expect(selector).toContain(':where(:not([data-workspace-arrangement="stacked"]))');
    }
  });
});

describe('stacked sequence row', () => {
  // Minimums measured on the built artifact with the Tools rail: the Sequence
  // column needs 402px, it keeps its edit toolbar in view from 314px (88px of
  // title and head sit above the toolbar), and the Map column needs 85px, or
  // 185px below 620px tall, where its frame has a 120px min-height.
  const minimums = (map: number) => ({ sequence: 402, toolbarKeep: 314, map });

  it('starts the row at the sequence column content minimum where the window has room', () => {
    // A flat 240px floor against that 402px made the column scroll inside its row
    // and carry the edit toolbar away with the bases. 900x820: workspace 750px,
    // top row at most 501px.
    expect(stackedSequenceRowFloor(minimums(85), 750, 501)).toBe(402);
    // 900x700: the row stops at its own 381px maximum, which still keeps the toolbar.
    expect(stackedSequenceRowFloor(minimums(85), 630, 381)).toBe(381);
    expect(stackedSequenceRowFloor({ sequence: 0, toolbarKeep: 0, map: 0 }, 750, 501)).toBe(0);
  });

  it('leaves the Map row its own minimum', () => {
    // 820x620: without this cap the row took 391px and left Map 150px, which cut the
    // bottom of the map frame and the whole dock strip.
    expect(stackedSequenceRowFloor(minimums(185), 550, 391)).toBe(356);
  });

  it('keeps the proportional default where no row can keep the toolbar in view', () => {
    // 900x500 and 900x360: the most Map can give leaves the column 166px and 288px
    // short, so the toolbar scrolls away at any row; taking the height anyway
    // shrank the ring from 102px to 71px and clipped the map frame by 31px.
    expect(stackedSequenceRowFloor(minimums(185), 430, 271)).toBe(0);
    expect(stackedSequenceRowFloor(minimums(167), 290, 161)).toBe(0);
  });

  it('holds each minimum for the window size, so a pane toggle cannot move the row', () => {
    // Tools pinned widens the column past the selection bar's two-line query, which
    // made the row 12px shorter than beside the rail and moved Map on every toggle.
    expect(artifactSource).toContain('next.sequence = Math.max(next.sequence, sequence);');
    expect(artifactSource).toContain('next.map = Math.max(next.map, Math.ceil(map));');
    expect(artifactSource).toContain('}, [workspaceArrangement, floatingViewport.width, floatingViewport.height]);');
    // Export opens inside the column and a dock panel inside the Map column; both
    // are meant to scroll, so neither counts toward the resting minimum.
    expect(artifactSource).toContain("if (panel && scroller && !column.querySelector(':scope > details[open]')) {");
    expect(artifactSource).toContain("if (frame && !mapColumn.querySelector('.motif-cs-map-dock-strip > details[open]')) {");
    expect(artifactSource).toContain('Math.max(compactRowMinHeight, sequenceRowFloor),');
  });
});

describe('map dock panels', () => {
  it('float an open panel over what is beside the heads, capped and scrolling, so nothing else moves', () => {
    // In flow, an open panel would push the Sequence pane down 682px at 700px and the
    // page would scroll after it; from 900px it would take half the column from the ring.
    // It floats on the product's popover surface, at most the measured room
    // or 60% of the window, and scrolls inside that.
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip > details\[open\]::details-content\s*\{\s*position:\s*absolute;\s*top:\s*100%;\s*right:\s*0;\s*left:\s*0;\s*grid-row:\s*auto;\s*grid-column:\s*auto;[^}]*max-height:\s*var\(--motif-cs-dock-room, 60vh\);\s*overflow-y:\s*auto;\s*overscroll-behavior:\s*contain;\s*scrollbar-gutter:\s*stable;\s*border:\s*1px solid var\(--border-strong\);[^}]*background:\s*var\(--bg-primary\);\s*box-shadow:\s*var\(--elevation-popover\);/);
    // Nothing clips the floating body, and the map frame does not change size for it.
    expect(artifactCss).not.toMatch(/\.motif-cs-map-dock-strip:has\(> details\[open\]\)\s*\{[^}]*overflow:\s*hidden/);
    expect(artifactCss).not.toMatch(/\.motif-cs-map-column:has\(> \.motif-cs-map-dock-strip > details\[open\]\) > \.motif-cs-map-frame/);
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip:has\(> details\[open\]\)\s*\{\s*z-index:\s*7;\s*\}/);
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip > details\s*\{\s*display:\s*contents;\s*\}/);
    // The head click measures the side and the room before the first frame, and
    // the page scrolls only for a head that is itself off screen.
    const handlerStart = artifactSource.indexOf('const handleMapDockOpen = useCallback(');
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    const handler = artifactSource.slice(handlerStart, artifactSource.indexOf('}, [closeOpenToolDetails]);', handlerStart));
    expect(handler).toContain("strip.setAttribute('data-dock-side', side);");
    expect(handler).toContain("strip.style.setProperty('--motif-cs-dock-room', `${Math.floor(room)}px`);");
    expect(handler).toContain('if (box.bottom <= 0 || box.top >= window.innerHeight) head.scrollIntoView(');
    expect(handler).not.toContain('mapColumnRef.current?.scrollTo(');
  });

  it('keep both heads in one row and open the body above them when there is no room below', () => {
    // Opening one panel does not restack the strip, so the head just pressed does not
    // jump to a new row. The heads keep their row; the body floats beside them.
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip > details > summary\.motif-cs-panel-head\s*\{\s*grid-row:\s*1;/);
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip > details::details-content\s*\{\s*grid-column:\s*1 \/ -1;\s*grid-row:\s*2;/);
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip\[data-dock-side="above"\] > details\[open\]::details-content\s*\{\s*top:\s*auto;\s*bottom:\s*100%;/);
    // From 900px the heads are the foot of a fixed-height column: above is the default.
    expect(artifactCss).toMatch(/@media \(min-width: 900px\)\s*\{\s*\.motif-cs-map-dock-strip:not\(\[data-dock-side\]\) > details\[open\]::details-content\s*\{\s*top:\s*auto;\s*bottom:\s*100%;/);
    // A closed body must not stretch over the open one and take its pointer.
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip > details:not\(\[open\]\)::details-content\s*\{\s*align-self:\s*start;\s*pointer-events:\s*none;/);
  });
});

describe('popping out a pane', () => {
  // A 1920x1080 window: 46px of header above the safe area, 8px elsewhere.
  const viewport = { width: 1920, height: 1080, insets: { top: 46, right: 8, bottom: 8, left: 8 } };
  const mapLimits = { minWidth: 340, minHeight: 320, maxWidth: 1200, maxHeight: 1200 };

  it('opens no smaller than the pane was docked, as far as the viewport allows', () => {
    // The map's saved 580x580 drew a 303px ring against 682px docked at 976x1042.
    const rect = popOutFloatingPaneRect({ x: 1300, y: 92, w: 580, h: 580 }, { width: 976, height: 1042 }, viewport, mapLimits);
    expect(rect).toEqual({ x: 1920 - 8 - 976, y: 46, w: 976, h: 1080 - 46 - 8 });
    // Each side grows on its own: a wide stacked map keeps its width.
    expect(popOutFloatingPaneRect({ x: 264, y: 92, w: 580, h: 580 }, { width: 852, height: 251 }, viewport, mapLimits))
      .toMatchObject({ w: 852, h: 580 });
    // The pane's own limits still cap it. The map's cap of 1200px is above its
    // docked 976x1042 at 1920x1080.
    expect(artifactSource).toContain('map: { minWidth: 340, minHeight: 320, maxWidth: 1200, maxHeight: 1200 },');
    expect(popOutFloatingPaneRect({ x: 24, y: 92, w: 580, h: 580 }, { width: 1444, height: 1402 }, { ...viewport, width: 2560, height: 1440 }, mapLimits))
      .toMatchObject({ w: 1200, h: 1200 });
  });

  it('keeps a floating size larger than the docked one, and the saved rect when there is no docked pane', () => {
    expect(popOutFloatingPaneRect({ x: 100, y: 100, w: 900, h: 900 }, { width: 447, height: 730 }, viewport, mapLimits))
      .toEqual({ x: 100, y: 100, w: 900, h: 900 });
    expect(popOutFloatingPaneRect({ x: 100, y: 100, w: 580, h: 580 }, null, viewport, mapLimits))
      .toEqual({ x: 100, y: 100, w: 580, h: 580 });
  });
});

describe('header controls', () => {
  it('lists the themes only in Settings; the top bar ends with one icon that flips them', () => {
    // Settings > Appearance holds the one list of themes. The top bar's last control is
    // an icon button that flips Light and Dark, in the pane headers' icon-button face.
    const header = artifactSource.slice(
      artifactSource.indexOf('<header ref={topbarRef} className="motif-cs-topbar"'),
      artifactSource.indexOf('</header>'),
    );
    expect(header).toContain('className="motif-cs-pane-switcher"');
    expect(header).not.toMatch(/<select|THEME_OPTIONS/);
    const toggle = header.slice(header.lastIndexOf('<button'));
    expect(toggle).toContain('className="motif-cs-pane-placement-button motif-cs-theme-toggle"');
    expect(toggle).toContain("aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}");
    expect(toggle).not.toContain('aria-pressed');
    // No width rule hides it: the script shows it wherever the row has room for it.
    expect(header).toContain('{themeToggleFits ? (');
    expect(artifactCss).not.toMatch(/\.motif-cs-theme-toggle \{\s*display: none;/);
    // It sits one row gap after the row's last control: the row stops at its controls
    // instead of filling the bar, and the button gives back the 4px the bar's 12px gap
    // has over the row's 8px.
    expect(artifactCss).toMatch(/\.motif-cs-topbar-meta \{\s*display: flex;\s*flex: 0 1 auto;/);
    expect(artifactCss).toMatch(/\.motif-cs-topbar > \.motif-cs-theme-toggle \{\s*margin-left: -4px;\s*\}/);
    expect(artifactSource).not.toContain('name="artifact-theme"');
    expect(artifactCss).not.toContain('motif-cs-theme-picker');
    // Settings lists every theme, and its choice is the one that is saved.
    expect(artifactSource).toMatch(/\{THEME_OPTIONS\.map\(\(option\) => \(\s*<label\s+key=\{option\.id\}\s+className="motif-cs-theme-choice"/);
    expect(artifactSource).toMatch(/name="settings-theme"[\s\S]{0,200}onChange=\{\(\) => \{\s*chooseTheme\(option\.id\);/);
  });

  it('never clips a top bar label, and moves the Translations toggle out below 681px', () => {
    // A label is shown whole or the control leaves the row; no character cap.
    expect(artifactCss).not.toMatch(/\.motif-cs-(?:pane|window)-toggle > span\s*\{[^}]*max-width:\s*\d+ch/);
    expect(artifactCss).toMatch(/@media \(max-width: 680px\) \{\s*\.motif-cs-window-toggle \{\s*display: none;\s*\}\s*\}/);
  });
});

describe('pane placement control', () => {
  it('draws pop out and dock as arrows out of and into a box, not maximize and minimize', () => {
    const control = artifactSource.slice(artifactSource.indexOf('function PanePlacementControl('), artifactSource.indexOf('function FloatingPaneResizeHandle('));
    expect(control).toContain('<SquareArrowOutUpRight size={14}');
    expect(control).toContain('<SquareArrowDownLeft size={14}');
    expect(control).not.toMatch(/<Maximize2|<Minimize2/);
  });
});
