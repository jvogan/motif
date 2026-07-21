/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

const here = dirname(fileURLToPath(import.meta.url));
const overlayCss = readFileSync(resolve(here, '..', 'claude-science-msa.css'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');
const viewerSource = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');

/** Body of the rule block for `selector` that carries `needle`. */
function ruleBlockContaining(css: string, selector: string, needle: string): string | null {
  const re = new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g');
  for (const match of css.matchAll(re)) if (match[1].includes(needle)) return match[1];
  return null;
}

function renderViewer() {
  const alignment = normalizeArtifactAlignment({
    id: 'overlay-states',
    name: 'Overlay states',
    molecule: 'dna',
    referenceRowId: 'reference',
    rows: [
      { id: 'reference', name: 'Reference', aligned: 'AAAA' },
      { id: 'search-hit', name: 'Search hit', aligned: 'ATAA' },
      { id: 'other', name: 'Other', aligned: 'AGAA' },
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer interaction-state overlays', () => {
  it('keeps search, active search, jump, selection, and hover hooks stacked', () => {
    renderViewer();
    const view = screen.getByTestId('msa-alignment-view');
    const viewport = view.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
    const ruler = view.querySelector<HTMLElement>('.motif-cs-msa-ruler-window-clickable');
    const searchRow = view.querySelector<HTMLElement>('[data-msa-row-id="search-hit"]');
    if (!viewport || !ruler || !searchRow) throw new Error('Expected alignment overlay fixtures.');

    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 800,
      bottom: 400,
      width: 800,
      height: 400,
      toJSON: () => ({}),
    });
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: vi.fn() });
    Object.defineProperty(searchRow, 'scrollIntoView', { configurable: true, value: vi.fn() });
    Object.defineProperty(ruler, 'setPointerCapture', { configurable: true, value: vi.fn() });
    Object.defineProperty(ruler, 'hasPointerCapture', { configurable: true, value: vi.fn(() => false) });
    Object.defineProperty(window, 'CSS', {
      configurable: true,
      value: { escape: (value: string) => value },
    });

    fireEvent.change(screen.getByTestId('msa-search-input'), { target: { value: 'T' } });
    fireEvent.click(screen.getByTestId('msa-search-next'));

    const stackedCell = searchRow.querySelector<HTMLElement>('[data-alignment-column="2"]');
    if (!stackedCell) throw new Error('Expected the active search-hit cell.');
    expect(stackedCell.dataset.searchMatch).toBe('true');
    expect(stackedCell.dataset.searchActive).toBe('true');
    expect(stackedCell.dataset.jump).toBe('true');

    // Centre of the second residue column, derived from the geometry the frame
    // actually rendered, so resizing the row-label gutter or the cells cannot
    // silently move this click into a different column.
    const labelWidth = Number.parseFloat(view.style.getPropertyValue('--motif-cs-msa-label-width'));
    const cellWidth = Number.parseFloat(view.style.getPropertyValue('--motif-cs-msa-cell-width'));
    const secondColumnX = labelWidth + (cellWidth * 1.5);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
    fireEvent.pointerDown(ruler, { button: 0, clientX: secondColumnX, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(ruler, { button: 0, clientX: secondColumnX, clientY: 20, pointerId: 1 });

    const selection = view.querySelector<HTMLElement>('.motif-cs-msa-selection-band');
    // ONE ruler row, so one row's offset. This fixture's reference is ungapped,
    // which makes the template axis identical to the alignment axis and merges
    // the two into a single row. Reserving 54px here reserved space for a ruler
    // that is not rendered and drew the band a full row below its columns.
    expect(selection?.style.top).toBe('27px');
    expect(selection?.style.height).toBe('90px');

    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => stackedCell) });
    fireEvent.pointerMove(viewport, { clientX: secondColumnX, clientY: 90, pointerId: 2 });
    expect(view.querySelector('.motif-cs-msa-hover-column')).toBeTruthy();
    expect(searchRow.dataset.hover).toBe('true');
  });

  it('assigns a separate token and geometry to every state', () => {
    expect(overlayCss).toMatch(/\.motif-cs-msa-selection-band\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?border:\s*2px solid var\(--motif-cs-msa-selection-rule\)/);
    expect(overlayCss).toMatch(/\.motif-cs-msa-hover-column\s*\{[\s\S]*?background:\s*transparent;[\s\S]*?outline:\s*1px dashed var\(--motif-cs-msa-hover-rule\)/);
    expect(overlayCss).toMatch(/\.motif-cs-msa-symbol\[data-search-match\][\s\S]*?inset 0 -3px 0 var\(--amber\)/);
    expect(overlayCss).toMatch(/\.motif-cs-msa-symbol\[data-search-active\][\s\S]*?inset 0 0 0 2px var\(--amber\)/);
    expect(overlayCss).toContain('--motif-cs-msa-jump-rule: var(--purple);');
    // Width is capped at 3px but shrinks with the cell, so zooming out cannot
    // leave the tick wider than the column it marks.
    expect(overlayCss).toMatch(/\.motif-cs-msa-symbol\[data-jump='true'\]::after[\s\S]*?width:\s*min\(3px,[\s\S]*?background:\s*var\(--motif-cs-msa-jump-rule\)/);
    // The roving cursor used to be the one state this test's own title excludes:
    // raw var(--accent), no token, which put it within 1.2:1 of the selection
    // rule it sits on top of by default.
    expect(overlayCss).toContain('--motif-cs-msa-cursor-rule: var(--text-primary);');
    expect(overlayCss).toContain('--motif-cs-msa-cursor-keyline: var(--bg-primary);');
    expect(overlayCss).toMatch(/\.motif-cs-msa-symbol\[data-active-cell='true'\]\s*\{[\s\S]*?outline:\s*2px solid var\(--motif-cs-msa-cursor-rule\)/);
    // Geometry channels stay disjoint: the cursor may never take box-shadow or
    // ::after, because search and the jump tick own those and one cell can
    // legitimately be all three at once.
    expect(overlayCss).toMatch(/\.motif-cs-msa-symbol\[data-active-cell='true'\]::before\s*\{[\s\S]*?border:\s*1px solid var\(--motif-cs-msa-cursor-keyline\)/);
  });

  it('keeps the overview viewport off the selection colour', () => {
    // The viewport rectangle and the selection band are the viewer's only two
    // region outlines, one strip apart. While both were accent-derived they
    // measured ΔE 1.9-3.3 apart in all four themes — one colour saying two
    // things. The viewport marks where the system is looking, which is the
    // cursor's statement, so it takes the cursor's channel; accent is then left
    // to mean the selection and nothing else.
    const viewport = ruleBlockContaining(artifactCss, '.motif-cs-msa-overview-viewport', 'min-width');
    expect(viewport).toBeTruthy();
    expect(viewport).toMatch(/border:[^;]*var\(--motif-cs-msa-cursor-rule/);
    expect(viewport).not.toMatch(/border[^;]*var\(--accent\)/);
    // The other half of the split: the selection rule stays accent-derived, so
    // the two cannot converge again from the opposite direction. It is the
    // theme's accent UNDILUTED — the invariant, not a byte string. Any mix
    // toward ink drags the band back onto the cursor's own channel, which is
    // exactly what this test exists to prevent; see
    // claude-science-msa-colour-guards.test.ts for the shape guard.
    expect(overlayCss).toMatch(/--motif-cs-msa-selection-rule:\s*var\(--accent\)\s*;/);
  });

  it('declares the cursor channel on an element both widgets sit inside', () => {
    // The overview viewport is the matrix's SIBLING, not its child, so a token
    // scoped to .motif-cs-msa-matrix never reaches it. Whichever class owns the
    // channel has to be the alignment view itself.
    const owner = /(\.[a-zA-Z0-9_-]+)\s*\{[^}]*--motif-cs-msa-cursor-rule:/.exec(overlayCss)?.[1];
    expect(owner).toBeTruthy();
    const mount = viewerSource.indexOf(`className="${(owner as string).slice(1)}"`);
    expect(mount).toBeGreaterThan(-1);
    expect(viewerSource.slice(mount, mount + 200)).toContain('data-testid="msa-alignment-view"');
  });
});
