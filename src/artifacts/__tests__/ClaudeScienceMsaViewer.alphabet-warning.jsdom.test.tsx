/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment, type ArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

function proteinAlignment(nucleotideLike: boolean): ArtifactAlignment {
  return normalizeArtifactAlignment({
    id: nucleotideLike ? 'nucleotide-like-protein' : 'protein',
    name: 'Protein alignment',
    molecule: 'protein',
    rows: [
      { id: 'first', name: 'First sequence', aligned: nucleotideLike ? 'ACGTUNACGTUN' : 'MKWVTFISLLFL' },
      { id: 'second', name: 'Second sequence', aligned: 'MKYVTFISLLFL' },
    ],
  });
}

function renderViewer(alignment: ArtifactAlignment) {
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [alignment],
    activeAlignmentId: alignment.id,
    viewPreferences: DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
    onActiveAlignmentChange: vi.fn(),
    onViewPreferencesChange: vi.fn(),
    onSaveAlignment: (nextAlignment) => nextAlignment,
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

describe('ClaudeScienceMsaViewer alphabet warning', () => {
  it('renders a non-fatal warning for nucleotide-like protein rows and dismisses it', () => {
    renderViewer(proteinAlignment(true));

    const warning = screen.getByTestId('msa-alphabet-warning');
    expect(warning.getAttribute('role')).toBe('status');
    expect(warning.textContent).toContain('1 of 2 sequences contain only nucleotide letters but are displayed as protein.');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss molecule type warning' }));
    expect(screen.queryByTestId('msa-alphabet-warning')).toBeNull();
  });

  it('does not render the warning for ordinary protein content', () => {
    renderViewer(proteinAlignment(false));
    expect(screen.queryByTestId('msa-alphabet-warning')).toBeNull();
  });
});
