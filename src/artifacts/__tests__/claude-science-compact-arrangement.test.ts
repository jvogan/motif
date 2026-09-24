import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compactWorkspaceArrangement, popOutFloatingPaneRect, sideBySideSequenceShareAfterResize, stackedSequenceRowFloor } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

describe('compact workspace arrangement', () => {
  it('puts Sequence beside Map in landscape laptop windows and keeps narrow, portrait and near-square ones stacked', () => {
    // Measured: side by side these show 140-360 bp and a 235-474px ring. Stacked, the
    // four laptop windows opened with one row of bases or none (1535x864: 0 of 155)
    // under a 206-279px ring, and 1024x768 now gets a 128px ring to fit its toolbar.
    for (const [width, height] of [[1024, 768], [1280, 720], [1366, 768], [1440, 900], [1535, 864], [960, 800], [1024, 900]]) {
      expect(compactWorkspaceArrangement(width, height), `${width}x${height}`).toBe('side-by-side');
    }
    // Stacked keeps the larger ring, or side by side has no room: 820x1100 is 326px
    // stacked against 140px, 1024x1000 is 323 against 263, and below 960px wide the
    // sequence column sits on its 240px floor.
    for (const [width, height] of [[959, 700], [900, 700], [820, 1100], [1024, 1000], [1100, 1000], [1180, 1100], [600, 900]]) {
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
  it('keep half the map column for the circular map while a panel is open, and scroll the panel instead', () => {
    // Sized to its content with no cap, an open panel took the whole column: the
    // ring measured 0px with Map Visibility open at every width up to 1536.
    expect(artifactCss).toMatch(/@media \(min-width: 640px\)\s*\{\s*\.motif-cs-map-column:has\(> \.motif-cs-map-dock-strip > details\[open\]\) > \.motif-cs-map-frame\[data-map-mode="circular"\]\s*\{\s*min-height:\s*50%;/);
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip:has\(> details\[open\]\)\s*\{\s*display:\s*flex;\s*flex:\s*0 1 auto;\s*flex-direction:\s*column;\s*min-height:\s*0;/);
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip > details\[open\]\s*\{\s*flex:\s*0 1 auto;\s*min-height:\s*0;\s*overflow-y:\s*auto;/);
    expect(artifactCss).toMatch(/\.motif-cs-map-dock-strip > details\[open\] > summary\.motif-cs-panel-head\s*\{\s*position:\s*sticky;/);
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
    // The pane's own limits still cap it. They were 900px for the map, under its
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
  it('sizes the theme select by its longest option', () => {
    const rule = artifactCss.match(/\.motif-cs-theme-picker select\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rule).toContain('height: 26px;');
    expect(artifactCss).not.toMatch(/\.motif-cs-theme-picker select\s*\{[^}]*min-width/);
  });

  it('shows the whole "Translations" label up to 840px', () => {
    // The pane toggles keep their 8ch cap; the Translations window toggle, a
    // later rule of equal specificity, lifts it.
    expect(artifactCss).toMatch(/max-width: 8ch;[^}]*\}\s*(?:\/\*[^*]*\*\/\s*)?\.motif-cs-window-toggle > span\s*\{\s*max-width:\s*none;\s*\}/);
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
