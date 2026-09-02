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
const originalElementScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

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

function overImageCellLimitAlignment(): ArtifactAlignment {
  // This is an accepted Motif alignment (9 × 50,000 = 450,000 cells), but it
  // exceeds the image-specific 400,000-cell budget.
  return alignment(9, 50_000);
}

function StatefulViewer({
  sourceAlignment,
  initialPreferences = DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
  records = [],
}: {
  sourceAlignment: ArtifactAlignment;
  initialPreferences?: ClaudeScienceMsaViewPreferences;
  records?: ClaudeScienceMsaViewerProps['records'];
}) {
  const [viewPreferences, setViewPreferences] = useState(initialPreferences);
  const props: ClaudeScienceMsaViewerProps = {
    records,
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

function linkedTraceRecord(id: string, sequence: string): ClaudeScienceMsaViewerProps['records'][number] {
  return {
    id,
    name: 'Row 1',
    type: 'dna',
    sequence,
    sangerTrace: {
      schema: 'motif.sanger-trace.v1',
      version: 1,
      baseCalls: sequence,
      sequence,
      qualityScores: [],
      peakPositions: [],
      channels: { A: [], C: [], G: [], T: [] },
      sampleCount: 0,
      dyeOrder: null,
      storedReverseComplement: false,
      warnings: [],
      metadata: {
        format: 'ABIF',
        abifVersion: 101,
        baseCallsTag: 'PBAS2',
        qualityScoresTag: null,
        peakPositionsTag: null,
        channelTags: {},
        sampleName: id,
      },
    },
  };
}

function rejectFullWidthArrayMaterialization(): ReturnType<typeof vi.spyOn> {
  const originalArrayFrom = Array.from;
  return vi.spyOn(Array, 'from').mockImplementation((...args) => {
    const source = args[0] as { length?: unknown } | null | undefined;
    if (typeof source === 'object' && source !== null && !Array.isArray(source) && source.length === 50_000) {
      throw new Error('Attempted to materialize every image column before preflight.');
    }
    return Reflect.apply(originalArrayFrom, Array, args);
  });
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
  if (originalElementScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalElementScrollTo);
  else delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
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

  it.each([
    ['Text', 'text' as const, undefined],
    ['Traces', 'trace' as const, 'trace-row-0'],
  ])('preflights the missing visible window before materializing columns from %s', async (presentation, displayMode, traceRecordId) => {
    const createObjectUrl = vi.fn(() => 'blob:should-not-exist');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });

    const huge = overImageCellLimitAlignment();
    const records = traceRecordId ? [linkedTraceRecord(traceRecordId, huge.rows[0].aligned)] : [];
    if (traceRecordId) huge.rows[0].sourceRecordId = traceRecordId;
    if (traceRecordId) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    }
    render(<StatefulViewer
      sourceAlignment={huge}
      records={records}
      initialPreferences={{ ...DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES, displayMode }}
    />);

    expect(screen.getByRole('button', { name: presentation }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('msa-export-image-scope') as HTMLSelectElement).value).toBe('view');

    const materialization = rejectFullWidthArrayMaterialization();
    fireEvent.click(screen.getByTestId('msa-export-svg'));

    await waitFor(() => expect(screen.getByTestId('msa-copy-status').textContent).toContain(
      'Visible-view image needs 450,000 row-cells; the image limit is 400,000. No file was saved.',
    ));
    expect(materialization).not.toHaveBeenCalledWith(
      expect.objectContaining({ length: 50_000 }),
      expect.any(Function),
    );
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
