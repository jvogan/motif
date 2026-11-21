// @vitest-environment jsdom

/**
 * On a narrow panel the alignment toolbar does not wrap into five rows. Below 560px
 * of workspace width it keeps two: picker, presentation switch and View on the
 * first, emphasis, Differing only and Find on the second. Edit inputs, the row and
 * column counts, Go to, Export, Delete and the comparison template move behind one
 * More menu. From 560px to 1000px the toolbar keeps two rows too: Go to and Export
 * stay on the first row and Edit inputs, the counts and Delete go behind More;
 * from 880px Edit inputs and the counts stay too and only Delete goes behind More.
 * Wider, nothing moves: every control is inline and there is no More.
 *
 * jsdom has no layout, so the width arrives through a ResizeObserver stub; with no
 * measurement at all (no observer) the viewer must show the full toolbar.
 */
import { act } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

function renderViewer() {
  const alignment = normalizeArtifactAlignment({
    id: 'compact-toolbar',
    name: 'Compact toolbar',
    molecule: 'dna',
    referenceRowId: 'reference',
    rows: [
      { id: 'reference', name: 'Reference', aligned: 'ACGTACGT' },
      { id: 'second', name: 'Second', aligned: 'ACGAACGT' },
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

const resizeCallbacks: ResizeObserverCallback[] = [];
class StubResizeObserver {
  constructor(cb: ResizeObserverCallback) { resizeCallbacks.push(cb); }
  observe() {}
  unobserve() {}
  disconnect() {}
}
function setWorkspaceWidth(width: number): void {
  const entry = { contentRect: { width, height: 60 } } as ResizeObserverEntry;
  act(() => { for (const cb of resizeCallbacks) cb([entry], {} as ResizeObserver); });
}

afterEach(() => {
  resizeCallbacks.length = 0;
  vi.unstubAllGlobals();
  cleanup();
});

describe('alignment toolbar on a narrow workspace', () => {
  it('shows every control inline when nothing can be measured', () => {
    renderViewer();
    expect(screen.queryByTestId('msa-more-menu-button')).toBeNull();
    const toolbar = screen.getByTestId('msa-result-toolbar');
    for (const id of ['msa-edit-inputs', 'msa-goto-menu-button', 'msa-view-menu-button', 'msa-export-menu-button', 'msa-stats-bar']) {
      expect(within(toolbar).getByTestId(id), id).toBeTruthy();
    }
  });

  it('shows every control inline at 1000px', () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    renderViewer();
    setWorkspaceWidth(1000);
    expect(screen.queryByTestId('msa-more-menu-button')).toBeNull();
    const toolbar = screen.getByTestId('msa-result-toolbar');
    for (const id of ['msa-edit-inputs', 'msa-goto-menu-button', 'msa-view-menu-button', 'msa-export-menu-button', 'msa-stats-bar']) {
      expect(within(toolbar).getByTestId(id), id).toBeTruthy();
    }
  });

  it('keeps Edit inputs, the counts, Go to and Export inline at 900px and moves only Delete into More', () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    renderViewer();
    setWorkspaceWidth(900);
    const toolbar = screen.getByTestId('msa-result-toolbar');
    expect(within(toolbar).getByTestId('msa-more-menu-button').getAttribute('aria-label')).toBe('More alignment actions');
    for (const id of ['msa-edit-inputs', 'msa-stats-bar']) {
      expect(toolbar.querySelector(`:scope > [data-testid="${id}"]`), `${id} stays on the first row`).not.toBeNull();
    }
    for (const id of ['msa-goto-menu-button', 'msa-export-menu-button']) {
      expect(toolbar.querySelector(`:scope > details > [data-testid="${id}"]`), `${id} stays on the first row`).not.toBeNull();
    }
    const panel = screen.getByTestId('msa-more-menu');
    expect(within(panel).getByRole('button', { name: 'Delete alignment' })).toBeTruthy();
    for (const id of ['msa-edit-inputs', 'msa-stats-bar', 'msa-goto-menu-button', 'msa-export-menu-button']) {
      expect(within(panel).queryByTestId(id), `${id} must not also sit in More`).toBeNull();
    }
  });

  it.each([700, 879])('keeps Go to and Export inline at %ipx and moves Edit inputs, the counts and Delete into More', (width) => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    renderViewer();
    setWorkspaceWidth(width);
    const toolbar = screen.getByTestId('msa-result-toolbar');
    const more = within(toolbar).getByTestId('msa-more-menu-button');
    expect(more.getAttribute('aria-label')).toBe('More alignment actions');
    for (const id of ['msa-goto-menu-button', 'msa-export-menu-button']) {
      expect(toolbar.querySelector(`:scope > details > [data-testid="${id}"]`), `${id} stays on the first row`).not.toBeNull();
    }
    expect(toolbar.querySelector(':scope > details.motif-cs-msa-view-menu')).not.toBeNull();
    const panel = screen.getByTestId('msa-more-menu');
    for (const id of ['msa-edit-inputs', 'msa-stats-bar']) {
      expect(within(panel).getByTestId(id), id).toBeTruthy();
      expect(toolbar.querySelector(`:scope > [data-testid="${id}"]`), `${id} must not also sit inline`).toBeNull();
    }
    expect(within(panel).getByRole('button', { name: 'Delete alignment' })).toBeTruthy();
    expect(within(panel).queryByTestId('msa-export-menu-button')).toBeNull();
    expect(within(panel).queryByTestId('msa-goto-menu-button')).toBeNull();
    // The template picker stays on the second row, never in More.
    expect(within(panel).queryByText('Comparison template')).toBeNull();
    expect(screen.getAllByText('Comparison template')).toHaveLength(1);
  });

  it('folds the secondary group into one More menu at 400px and keeps every control reachable', () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    renderViewer();
    setWorkspaceWidth(400);
    const toolbar = screen.getByTestId('msa-result-toolbar');
    const more = within(toolbar).getByTestId('msa-more-menu-button');
    expect(more.textContent).toContain('More');
    expect(more.getAttribute('aria-label')).toBe('More alignment actions');

    // Still on the first row: the picker, the presentation switch and View.
    const direct = [...toolbar.children].map((child) => child.className + (child.getAttribute('aria-label') ?? ''));
    expect(direct.some((name) => name.includes('motif-cs-msa-alignment-picker'))).toBe(true);
    expect(direct.some((name) => name.includes('Alignment presentation'))).toBe(true);
    expect(toolbar.querySelector(':scope > details.motif-cs-msa-view-menu')).not.toBeNull();

    // Everything else is inside More, with its test ids and accessible names unchanged.
    const panel = screen.getByTestId('msa-more-menu');
    for (const id of ['msa-edit-inputs', 'msa-goto-menu-button', 'msa-export-menu-button', 'msa-stats-bar']) {
      expect(within(panel).getByTestId(id), id).toBeTruthy();
      expect(toolbar.querySelector(`:scope > [data-testid="${id}"]`), `${id} must not also sit inline`).toBeNull();
    }
    expect(within(panel).getByRole('button', { name: 'Delete alignment' })).toBeTruthy();
    expect(within(panel).getByText('Comparison template')).toBeTruthy();
    // The template picker is in More only, never twice.
    expect(screen.getAllByText('Comparison template')).toHaveLength(1);
  });

  it('closes More on Escape and closes the menus inside it with it', () => {
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    renderViewer();
    setWorkspaceWidth(400);
    const more = screen.getByTestId('msa-more-menu-button').closest('details')!;
    more.open = true;
    fireEvent(more, new Event('toggle'));
    const exportMenu = screen.getByTestId('msa-export-menu-button').closest('details')!;
    exportMenu.open = true;
    fireEvent.keyDown(more, { key: 'Escape' });
    expect(more.open).toBe(false);
    expect(more.getAttribute('data-motif-cs-escape-scope-when-open')).toBe('true');
  });
});
