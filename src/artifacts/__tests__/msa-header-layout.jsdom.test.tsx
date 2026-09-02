/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  type ClaudeScienceMsaViewPreferences,
} from '../claude-science-msa-view-preferences';

const here = dirname(fileURLToPath(import.meta.url));
const msaCss = readFileSync(resolve(here, '..', 'claude-science-msa.css'), 'utf8');

const alignment = normalizeArtifactAlignment({
  id: 'msa-header-layout',
  name: 'Header layout',
  molecule: 'dna',
  referenceRowId: 'reference',
  rows: [
    { id: 'reference', name: 'Reference', aligned: 'ACGTACGTACGT' },
    { id: 'variant', name: 'Variant', aligned: 'ACGTTCGTACGA' },
  ],
});

function StatefulViewer() {
  const [viewPreferences, setViewPreferences] = useState<ClaudeScienceMsaViewPreferences>(
    DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  );
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [alignment],
    activeAlignmentId: alignment.id,
    viewPreferences,
    onActiveAlignmentChange: vi.fn(),
    onViewPreferencesChange: setViewPreferences,
    onSaveAlignment: (next) => next,
    onUpdateAlignmentTemplate: vi.fn(),
    onDeleteAlignment: vi.fn(),
    onImportRecords: async () => ({ records: [], message: '', tone: 'status' }),
    onCopy: async () => true,
    onDownload: vi.fn(),
  };
  return <ClaudeScienceMsaViewer {...props} />;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('compact MSA header contracts', () => {
  it('uses two header bands and keeps comparison navigation in the matrix footer', () => {
    render(<StatefulViewer />);
    const workspace = screen.getByTestId('msa-workspace');
    const toolbar = screen.getByTestId('msa-result-toolbar');
    const controls = workspace.querySelector('.motif-cs-msa-view-controls');
    expect(controls).not.toBeNull();
    expect(workspace.querySelector('.motif-cs-msa-meta-row')).toBeNull();
    expect(screen.getByTestId('msa-stats-bar').parentElement).toBe(toolbar);
    expect(screen.getByTestId('msa-search').parentElement).toBe(controls);
    expect(screen.getByTestId('msa-search').getAttribute('role')).toBe('search');

    const navigation = screen.getByRole('group', { name: 'Variable column navigation' });
    expect(navigation.parentElement?.classList.contains('motif-cs-msa-statusbar')).toBe(true);
    expect(screen.getByTestId('msa-differences-toggle').getAttribute('aria-controls')).toBe('motif-cs-msa-differences-pane');
  });

  it('keeps moved control IDs and accessible relationships on their surviving controls', () => {
    render(<StatefulViewer />);
    const edit = screen.getByTestId('msa-edit-inputs');
    expect(edit.getAttribute('aria-label')).toBe('Edit inputs');
    expect(edit.getAttribute('aria-controls')).toBe('motif-cs-msa-source-body');
    expect(document.getElementById('motif-cs-msa-source-body')).not.toBeNull();

    const provenance = screen.getByTestId('msa-provenance');
    expect(provenance.querySelector('summary')?.getAttribute('aria-label')).toMatch(/^Provenance:/);
    expect(screen.getByTestId('msa-stats-bar').textContent).toContain('rows');
    expect(screen.getByTestId('msa-stats-bar').textContent).toContain('columns');

    fireEvent.click(screen.getByTestId('msa-view-menu-button'));
    const viewMenu = screen.getByTestId('msa-view-menu');
    expect(screen.getByTestId('msa-row-sort-toolbar').closest('[data-testid="msa-view-menu"]')).toBe(viewMenu);
    expect(screen.getByTestId('msa-residue-colors-toolbar').closest('[data-testid="msa-view-menu"]')).toBe(viewMenu);
  });

  it('groups the requested column summaries inside the vertical scroller', () => {
    render(<StatefulViewer />);
    const pinned = screen.getByTestId('msa-pinned-tracks');
    expect(pinned.parentElement?.classList.contains('motif-cs-msa-matrix')).toBe(true);
    expect(pinned.closest('.motif-cs-msa-matrix-scroll')).not.toBeNull();
    expect(within(pinned).getByRole('row', { name: /Conservation; asterisks/ })).toBeTruthy();
    expect(within(pinned).getByRole('row', { name: 'Majority consensus row' })).toBeTruthy();
    expect(within(pinned).getByRole('row', { name: 'Per-column conservation histogram' })).toBeTruthy();
    expect(pinned.querySelector('.motif-cs-msa-conservation-mark[data-alignment-column="1"]')).not.toBeNull();
  });

  // The search-count slot moved to claude-science-msa-control-row-guards: it is
  // no longer fixed, because a fixed slot clipped its own text while the form
  // around it stayed blank.
  it('pins the track group', () => {
    expect(msaCss).toMatch(/\.motif-cs-msa-pinned-tracks\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?bottom:\s*0;/);
    // `nowrap` held the band to one line by moving what did not fit off the
    // panel: at 390px the Text toggle rendered at x = 408 and the export trigger
    // left the viewport. The band wraps instead, which changes nothing wherever
    // it already fits - the two-band e2e check still pins 1440x900 and 900x680.
    expect(msaCss).toMatch(/\.motif-cs-msa-toolbar,[\s\S]*?\.motif-cs-msa-view-controls\s*\{[\s\S]*?flex-wrap:\s*wrap;/);
  });
});
