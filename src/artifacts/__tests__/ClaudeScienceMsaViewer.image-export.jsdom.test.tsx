/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
import {
  normalizeArtifactAlignment,
  resolveResidueCellColor,
  type ArtifactAlignment,
} from '../claude-science-msa';
import {
  DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  type ClaudeScienceMsaViewPreferences,
} from '../claude-science-msa-view-preferences';

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

function alignment(rowCount: number, length: number): ArtifactAlignment {
  const sequence = 'ACGT'.repeat(Math.ceil(length / 4)).slice(0, length);
  return normalizeArtifactAlignment({
    id: `image-${rowCount}-${length}`,
    name: 'Image export fixture',
    molecule: 'dna',
    referenceRowId: 'row-0',
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `row-${index}`,
      name: `Row ${index + 1}`,
      aligned: sequence,
    })),
  });
}

function StatefulViewer({
  sourceAlignment,
  initialPreferences = DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
}: {
  sourceAlignment: ArtifactAlignment;
  initialPreferences?: ClaudeScienceMsaViewPreferences;
}) {
  const [viewPreferences, setViewPreferences] = useState(initialPreferences);
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [sourceAlignment],
    activeAlignmentId: sourceAlignment.id,
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

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read exported blob'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(blob);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreateObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevokeObjectUrl });
});

describe('ClaudeScienceMsaViewer image export', () => {
  it('uses the active theme palette in a self-contained SVG', async () => {
    let savedBlob: Blob | null = null;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        savedBlob = blob;
        return 'blob:motif-test';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<StatefulViewer
      sourceAlignment={alignment(2, 8)}
      initialPreferences={{
        ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
        colorMode: 'residue',
        colorScheme: 'nucleotide',
      }}
    />);

    const exportDetails = screen.getByTestId('msa-export-menu').closest('details');
    if (!exportDetails) throw new Error('Missing export details element');
    exportDetails.style.setProperty('--bg-primary', '#232323');
    exportDetails.style.setProperty('--bg-secondary', 'rgb(43, 43, 43)');
    exportDetails.style.setProperty('--text-primary', '#f5f5f4');
    exportDetails.style.setProperty('--text-muted', '#a7a3a0');

    fireEvent.click(screen.getByTestId('msa-export-svg'));
    await waitFor(() => expect(savedBlob).not.toBeNull());
    const exportedBlob = savedBlob;
    if (!exportedBlob) throw new Error('SVG export did not create a blob');
    const svg = await readBlob(exportedBlob);
    expect(svg).toContain('fill="#232323"');
    expect(svg).toContain('fill="#2b2b2b"');
    expect(svg).toContain('fill="#f5f5f4"');
    expect(svg).toContain('fill="#a7a3a0"');
    expect(svg).toContain(`fill="${resolveResidueCellColor('A', 'dna', 'nucleotide', '#232323')}"`);
  });

  it('rejects an oversized whole image without creating a partial download', async () => {
    const createObjectUrl = vi.fn(() => 'blob:should-not-exist');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

    render(<StatefulViewer sourceAlignment={alignment(9, 50_000)} />);
    fireEvent.change(screen.getByTestId('msa-export-image-scope'), { target: { value: 'all' } });
    fireEvent.click(screen.getByTestId('msa-export-svg'));

    await waitFor(() => expect(screen.getByTestId('msa-copy-status').textContent).toContain(
      'Whole-alignment image needs 450,000 row-cells; the image limit is 400,000. No file was saved.',
    ));
    expect(screen.getByTestId('msa-copy-status').textContent).toContain(
      'Choose Visible view, or download Alignment JSON, Aligned FASTA, or CLUSTAL for the complete alignment.',
    );
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
