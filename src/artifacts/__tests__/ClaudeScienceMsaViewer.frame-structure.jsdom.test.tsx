// @vitest-environment jsdom

/**
 * The matrix frame clips (`overflow: hidden`) and the window body no longer
 * overflows, so anything squeezed out of the frame used to be unreachable — there
 * was no scrollbar anywhere that led to it. On a 300px-tall panel that was the pan
 * slider, the zoom line and the selection readout: present in the DOM, drawn at a
 * real size, and impossible to get to.
 *
 * The fix is structural, so the guard has to be structural too: only the overview
 * and the residue viewport may live inside the clipped box. Everything that does not
 * scroll is a sibling, held by a shell that can grow and push the body into
 * scrolling. jsdom has no layout, so these tests pin the STRUCTURE and the token
 * plumbing that the structure depends on; the pixel behaviour is measured on the
 * live app (bodyOverflow 106 -> 118 at 1100x420 with the pan row reachable after
 * scrolling, and 0 at 1024x768 and 1280x900 with 9/9 rows).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

const here = dirname(fileURLToPath(import.meta.url));
const viewerSource = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');
const msaCss = readFileSync(resolve(here, '..', 'claude-science-msa.css'), 'utf8');
/**
 * BOTH stylesheets that style the frame. motif-artifact.css carries its own bare
 * `.motif-cs-msa-matrix-frame` rule, and a guard that reads only the file it was
 * written beside is the failure this branch has already hit once — a value declared
 * twice, one copy fixed, the guard watching the fixed copy.
 */
const hostCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule block, in either sheet, whose selector targets the frame. */
function frameRules(): { sheet: string; selector: string; body: string }[] {
  const out: { sheet: string; selector: string; body: string }[] = [];
  for (const [sheet, css] of [['claude-science-msa.css', msaCss], ['motif-artifact.css', hostCss]] as const) {
    for (const match of stripComments(css).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const selector = match[1].trim();
      if (/\.motif-cs-msa-matrix-frame\b/.test(selector)) out.push({ sheet, selector, body: match[2] });
    }
  }
  return out;
}

/**
 * Rendered, not read from source. A first cut of this file sliced the JSX from the
 * frame's opening tag to the pan row's comment and asserted on the text between —
 * which cannot see where the frame actually CLOSES. Deleting the frame's closing tag
 * put every row back inside the clipped box and all six tests still passed. Only the
 * DOM knows what contains what.
 */
function renderViewer() {
  const alignment = normalizeArtifactAlignment({
    id: 'frame-structure',
    name: 'Frame structure',
    molecule: 'dna',
    referenceRowId: 'reference',
    rows: [
      { id: 'reference', name: 'Reference', aligned: 'ACGTACGT' },
      { id: 'second', name: 'Second', aligned: 'ACGAACGT' },
      { id: 'third', name: 'Third', aligned: 'ACGGACGT' },
    ],
  });
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [alignment],
    activeAlignmentId: alignment.id,
    viewPreferences: DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
    onActiveAlignmentChange: vi.fn(),
    onViewPreferencesChange: vi.fn(),
    onSaveAlignment: (next) => next,
    onUpdateAlignmentTemplate: () => null,
    onDeleteAlignment: vi.fn(),
    onImportRecords: async () => ({ records: [], message: '', tone: 'status' }),
    onCopy: async () => true,
    onDownload: vi.fn(),
  };
  return render(<ClaudeScienceMsaViewer {...props} />);
}

/**
 * jsdom has no layout and no ResizeObserver, so the measured chrome height stays at its
 * fallback and the readout never floats — the float is gated on the strip being tall
 * enough to hold it. Stub both, so the tests exercise the real gate instead of a
 * degenerate "no measurement, therefore no float" path.
 */
function stubChromeHeight(container: HTMLElement, height: number): void {
  const chrome = container.querySelector<HTMLElement>('.motif-cs-msa-matrix-chrome');
  if (!chrome) throw new Error('chrome strip missing');
  vi.spyOn(chrome, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: height, width: 800, height,
    toJSON: () => ({}),
  } as DOMRect);
}

/**
 * Records its callbacks instead of firing on observe. The viewer runs more than one
 * ResizeObserver, and another reads `entry.contentRect` — a stub that fires with an
 * empty entry list crashes THAT one, which is how the first version of this helper
 * broke two unrelated tests.
 */
const resizeCallbacks: ResizeObserverCallback[] = [];
class StubResizeObserver {
  constructor(cb: ResizeObserverCallback) { resizeCallbacks.push(cb); }
  observe() {}
  unobserve() {}
  disconnect() {}
}
/** Re-runs every observer with a well-formed entry, after the rects are stubbed. */
function flushResizeObservers(width = 800, height = 60): void {
  const entry = { contentRect: { width, height } } as ResizeObserverEntry;
  for (const cb of resizeCallbacks) cb([entry], {} as ResizeObserver);
}

afterEach(() => {
  resizeCallbacks.length = 0;
  vi.unstubAllGlobals();
  cleanup();
  vi.restoreAllMocks();
});

describe('only scrolling content lives inside the clipped matrix frame', () => {
  it('keeps the overview and the residue viewport inside the frame', () => {
    renderViewer();
    const frame = screen.getByTestId('msa-alignment-view');

    // Both must stay: the cursor channel is declared on the frame precisely because
    // the overview viewport is the matrix's sibling and has to inherit it too.
    expect(frame.querySelector('.motif-cs-msa-overview-row')).not.toBeNull();
    expect(frame.querySelector('.motif-cs-msa-matrix')).not.toBeNull();
    expect(frame.closest('.motif-cs-msa-matrix-shell')).not.toBeNull();
  });

  it('holds every non-scrolling row outside the frame, as a sibling', () => {
    renderViewer();
    const frame = screen.getByTestId('msa-alignment-view');
    const shell = frame.closest('.motif-cs-msa-matrix-shell');
    expect(shell).not.toBeNull();

    // The statusbar always mounts, and every row moved out of the frame shares the
    // frame's single closing tag — so this one assertion is what catches the boundary
    // moving back. The pan slider only mounts when there is something to scroll,
    // which needs real layout; its position is measured on the live app instead.
    const statusbar = shell!.querySelector('.motif-cs-msa-statusbar');
    expect(statusbar, 'statusbar is missing entirely').not.toBeNull();
    expect(frame.contains(statusbar), 'statusbar is still inside the clipped frame').toBe(false);

    const panRow = shell!.querySelector('[data-testid="msa-horizontal-scroll-row"]');
    if (panRow) expect(frame.contains(panRow), 'pan row is still inside the frame').toBe(false);
  });

  it('floats the readout on BOTH drag paths, not just the grid', () => {
    // The ruler drag is a second, independent route into a selection, and it used to
    // set only its own ref — never `isSelecting` — so the readout mounted as a row
    // mid-gesture and took 46px out of the residue viewport. Measured at 1100x640:
    // scroller 195 -> 149 with the pointer still down and one row lost, where the grid
    // path held at 195. A ruler drag selects EVERY row, so it is the worst case.
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    const { container } = renderViewer();
    stubChromeHeight(container, 60);   // pan row + status line: room for the float
    act(() => flushResizeObservers());
    const frame = screen.getByTestId('msa-alignment-view');
    const ruler = frame.querySelector<HTMLElement>('.motif-cs-msa-ruler-window-clickable');
    expect(ruler, 'ruler drag target missing').not.toBeNull();

    const labelWidth = Number.parseFloat(frame.style.getPropertyValue('--motif-cs-msa-label-width'));
    const cellWidth = Number.parseFloat(frame.style.getPropertyValue('--motif-cs-msa-cell-width'));
    expect(Number.isFinite(labelWidth) && Number.isFinite(cellWidth)).toBe(true);

    // jsdom hands back a zero rect for everything, and the column is resolved against
    // the scroller's box — so without this the press lands on no column and makes no
    // selection. Same stub the overlays suite uses to drive this element.
    const viewport = frame.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll')!;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(ruler!, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(ruler!, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
    // The press bubbles to the grid's own pointerdown handler, which calls
    // document.elementFromPoint — absent in jsdom, and it throws OUTSIDE the
    // assertions, so vitest reports "11 passed, 1 error" and exits non-zero.
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });

    fireEvent.pointerDown(ruler!, {
      button: 0,
      buttons: 1,
      clientX: labelWidth + (cellWidth * 1.5),
      clientY: 10,
      pointerId: 3,
    });

    const shell = frame.closest('.motif-cs-msa-matrix-shell')!;
    const readout = shell.querySelector('[data-testid="msa-selection-readout"]');
    // Guard against the false pass: no selection means the press missed, and "no
    // readout in the flow" would then be true for the wrong reason.
    expect(readout, 'the ruler press produced no selection — the path was not exercised').not.toBeNull();
    expect(readout!.getAttribute('data-live'), 'ruler drag left the readout in the flow').toBe('true');
  });

  it('keeps the rows that mount later outside the frame too', () => {
    renderViewer();
    const frame = screen.getByTestId('msa-alignment-view');
    const shell = frame.closest('.motif-cs-msa-matrix-shell')!;

    // The selection readout only exists once there is a selection; it is the child
    // whose arrival used to shrink the residue viewport mid-drag.
    fireEvent.keyDown(screen.getByTestId('msa-alignment-view'), { key: 'ArrowRight' });
    const grid = shell.querySelector('.motif-cs-msa-matrix-scroll') ?? shell;
    fireEvent.keyDown(grid, { key: ' ' });
    const readout = shell.querySelector('[data-testid="msa-selection-readout"]');
    if (readout) expect(frame.contains(readout)).toBe(false);
    // Not asserting the readout exists: the point is only that if it does, it is a
    // sibling. Its mounting path is covered by the correctness suite.
  });

  it('gives the shell a floor to grow against, not min-content, in either sheet', () => {
    const rules = frameRules();
    const shellScoped = rules.find((r) => r.selector.includes('.motif-cs-msa-matrix-shell >'));
    expect(shellScoped, 'no shell-scoped frame rule in either stylesheet').toBeTruthy();

    // The floor is derived in the viewer and passed down; the literal is the fallback.
    expect(shellScoped!.body).toMatch(/min-height:\s*var\(--motif-cs-msa-frame-min-height,\s*\d+px\)/);

    // Neither rejected approach may appear on the frame in EITHER sheet. min-content
    // computes to ~469px and forces whole-UI scrolling at 1024x768; flex-shrink:0
    // fixes the mid-drag shrink but costs 39px of the same at the same size.
    for (const rule of rules) {
      expect(rule.body, `${rule.sheet} ${rule.selector} uses min-content`).not.toContain('min-content');
      expect(rule.body, `${rule.sheet} ${rule.selector} pins flex-shrink to 0`).not.toMatch(/flex-shrink:\s*0/);
    }
  });

  it('stops the shell being shorter than the box it draws a border around', () => {
    // A border wraps the border box, not the overflow. With `min-height: 0` the shell
    // measured 97px against 233px of content on a 300px panel, so its bottom border
    // painted a hairline across the residue grid, 8px into row 2.
    const code = stripComments(msaCss);
    const at = code.indexOf('.motif-cs-msa-matrix-shell {');
    const shellRule = code.slice(at, code.indexOf('}', at));

    expect(shellRule).toMatch(/min-height:\s*var\(--motif-cs-msa-shell-min-height,\s*\d+px\)/);
    expect(shellRule, 'a zero floor is what let the border cut the grid').not.toMatch(/min-height:\s*0/);
    // auto / min-content / fit-content all measure 469px here and take 1024x768 from
    // 0 to 40px of body overflow, so none may stand in for the derived floor.
    expect(shellRule).not.toMatch(/min-height:\s*(auto|min-content|fit-content)/);
  });

  it('derives both floors from the row constants rather than hard-coding them', () => {
    // The frame's floor is the sum of its own children's floors; the shell's is the
    // frame's plus the rows beneath it. Both are computed in the viewer and passed
    // down, so changing a row height cannot leave a floor behind.
    expect(viewerSource).toContain(
      'const MSA_MATRIX_FRAME_MIN_HEIGHT = MSA_OVERVIEW_ROW_HEIGHT + MSA_MATRIX_SCROLL_MIN_HEIGHT;',
    );
    expect(viewerSource).toContain("'--motif-cs-msa-frame-min-height': `${MSA_MATRIX_FRAME_MIN_HEIGHT}px`");

    // The shell's floor is COMPUTED from what is mounted, not constant: three of its
    // four rows are conditional, and a constant left it 45px short once a selection
    // settled and 77px short with the order note too.
    expect(viewerSource).toContain('function msaMatrixShellMinHeight(');
    // The chrome strip is MEASURED, not summed from constants — it wraps at narrow
    // widths, and an existing e2e expectation already has the zoom row past 40px.
    for (const term of [
      '+ rows.chromeHeight',
      '(rows.readoutInFlow ? MSA_SELECTION_READOUT_HEIGHT : 0)',
      'new ResizeObserver(sync)',
    ]) expect(viewerSource).toContain(term);
    // ...and the readout counts only in flow — floating, it takes no layout height.
    expect(viewerSource).toContain("readoutInFlow: readoutPlacement === 'flow'");
  });

  it('keeps the enclosure on the shell, so the two sheets cannot both draw it', () => {
    // motif-artifact.css still declares the old border/background on the bare
    // selector as the unwrapped fallback. What must hold is that the shell-scoped
    // rule cancels them, or the frame paints a second border inside the shell's.
    const shellScoped = frameRules().find((r) => r.selector.includes('.motif-cs-msa-matrix-shell >'))!;

    expect(shellScoped.body).toMatch(/border:\s*0/);
    expect(shellScoped.body).toMatch(/background:\s*transparent/);
    // Specificity, not source order, is what makes that reliable: 0,2,0 vs 0,1,0.
    const bare = frameRules().filter((r) => r.selector === '.motif-cs-msa-matrix-frame');
    expect(bare.length, 'expected the bare frame rules to still exist as fallbacks').toBeGreaterThan(0);
    for (const rule of bare) expect(rule.selector.split(/\s+/).length).toBeLessThan(shellScoped.selector.split(/\s+/).length);
  });

  it('passes the column geometry to the rows that moved out of the frame', () => {
    // The pan row's grid is sized by --motif-cs-msa-label-width. As a sibling it can
    // only inherit that from the shell; left on the frame alone the slider falls back
    // to 180px and stops lining up with the residue columns it scrolls.
    const shellOpen = viewerSource.indexOf('className="motif-cs-msa-matrix-shell"');
    expect(shellOpen).toBeGreaterThan(-1);
    expect(viewerSource.slice(shellOpen, shellOpen + 200)).toContain('style={frameStyle}');
  });

  it('floats the selection readout while the pointer is still down', () => {
    // Claiming a row mid-drag shrinks the residue viewport by 46px and cuts 1-2 rows
    // off the bottom — the rows being dragged toward.
    expect(viewerSource).toContain("data-live={readoutPlacement === 'float' || undefined}");
    // The float is declined when the strip below cannot hold it: anchored to the
    // shell's bottom it would otherwise overhang into the last residue row (7px,
    // measured, whenever the alignment fits horizontally and no pan row mounts).
    // Measured against measured, not against a constant: BOTH the chrome strip and the
    // readout wrap at narrow widths (44px and 61px at 520), and a constant-40 gate let
    // it float over a strip too short for it and cover a residue row by 17px.
    expect(viewerSource).toContain('chromeHeight >= readoutHeight');
    expect(viewerSource).toContain('const [readoutHeight, setReadoutHeight]');
    const liveRule = msaCss.slice(
      msaCss.indexOf('.motif-cs-msa-selection-readout[data-live]'),
      msaCss.indexOf('}', msaCss.indexOf('.motif-cs-msa-selection-readout[data-live]')),
    );
    expect(liveRule).toContain('position: absolute;');
    expect(msaCss).toMatch(/\.motif-cs-msa-matrix-shell\s*\{[^}]*position:\s*relative/);
  });

  it('leaves the cursor channel on the element both widgets sit inside', () => {
    // 517db34's coupling, restated here because this change moves the boundary it
    // depends on: the channel must stay on the frame, and the frame must stay the
    // alignment view. A new wrapper redeclaring these names would silently break the
    // accent/ink split with nothing rendering differently.
    const owner = /(\.[a-zA-Z0-9_-]+)\s*\{[^}]*--motif-cs-msa-cursor-rule:/.exec(msaCss)?.[1];
    expect(owner).toBe('.motif-cs-msa-matrix-frame');
    expect(msaCss).not.toMatch(/\.motif-cs-msa-matrix-shell\s*\{[^}]*--motif-cs-msa-cursor-rule/);
  });
});
