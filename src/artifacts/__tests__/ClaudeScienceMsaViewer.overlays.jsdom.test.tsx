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

    const secondColumnX = 232;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => null) });
    fireEvent.pointerDown(ruler, { button: 0, clientX: secondColumnX, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(ruler, { button: 0, clientX: secondColumnX, clientY: 20, pointerId: 1 });

    const selection = view.querySelector<HTMLElement>('.motif-cs-msa-selection-band');
    expect(selection?.style.top).toBe('54px');
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
    expect(overlayCss).toMatch(/\.motif-cs-msa-symbol\[data-jump='true'\]::after[\s\S]*?width:\s*3px;[\s\S]*?background:\s*var\(--motif-cs-msa-jump-rule\)/);
  });
});
