/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceMsaViewer, type ClaudeScienceMsaViewerProps } from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';
import {
  requestBrowserBlobDownload,
  SANDBOX_BLOCKED_DOWNLOAD_MESSAGE,
  type BrowserDownloadReceipt,
} from '../claude-science-download';

vi.mock('../claude-science-download', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../claude-science-download')>()),
  requestBrowserBlobDownload: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const viewerSource = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');

const sourceAlignment = normalizeArtifactAlignment({
  id: 'download-check',
  name: 'download-check',
  molecule: 'dna',
  referenceRowId: 'reference',
  rows: [
    { id: 'reference', name: 'ref', aligned: 'ACGTACGTAC' },
    { id: 'observed', name: 'variant', aligned: 'ACGTACGAAC' },
  ],
});

function Viewer({ onDownload }: { onDownload: ClaudeScienceMsaViewerProps['onDownload'] }) {
  const [viewPreferences, setViewPreferences] = useState(DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES);
  return (
    <ClaudeScienceMsaViewer
      records={[]}
      alignments={[sourceAlignment]}
      activeAlignmentId={sourceAlignment.id}
      viewPreferences={viewPreferences}
      onActiveAlignmentChange={vi.fn()}
      onViewPreferencesChange={setViewPreferences}
      onSaveAlignment={(next) => next}
      onUpdateAlignmentTemplate={vi.fn()}
      onDeleteAlignment={vi.fn()}
      onImportRecords={async () => ({ records: [], message: '', tone: 'status' })}
      onCopy={async () => true}
      onDownload={onDownload}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(requestBrowserBlobDownload).mockReset();
});

describe('alignment image export download', () => {
  it('uses the shared download helper instead of its own anchor click', () => {
    expect(viewerSource).toContain("from './claude-science-download'");
    expect(viewerSource).not.toContain('function downloadBlobFile');
    expect(viewerSource).not.toContain('createObjectURL');
  });

  it('reports a blocked download as a failure, not as saved', async () => {
    const blocked: BrowserDownloadReceipt = {
      status: 'failed',
      channel: 'browser',
      filename: 'download-check.svg',
      message: SANDBOX_BLOCKED_DOWNLOAD_MESSAGE,
    };
    vi.mocked(requestBrowserBlobDownload).mockReturnValue(blocked);
    render(<Viewer onDownload={vi.fn()} />);

    fireEvent.click(screen.getByTestId('msa-export-svg'));

    await waitFor(() => expect(screen.getAllByText(SANDBOX_BLOCKED_DOWNLOAD_MESSAGE).length).toBeGreaterThan(0));
    expect(requestBrowserBlobDownload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/^Saved /)).toBeNull();
  });

  it('reports saved once the helper dispatches the request', async () => {
    vi.mocked(requestBrowserBlobDownload).mockReturnValue({
      status: 'requested',
      channel: 'browser',
      filename: 'download-check.svg',
      message: 'Download requested for download-check.svg.',
    });
    render(<Viewer onDownload={vi.fn()} />);

    fireEvent.click(screen.getByTestId('msa-export-svg'));

    await waitFor(() => expect(screen.getAllByText(/Saved .*\.svg/).length).toBeGreaterThan(0));
  });
});

describe('alignment text download', () => {
  it('shows a failed text download receipt where the differences list reports it', async () => {
    const onDownload = vi.fn<ClaudeScienceMsaViewerProps['onDownload']>(() => ({
      status: 'failed',
      channel: 'browser',
      filename: 'download-check-differences.tsv',
      message: SANDBOX_BLOCKED_DOWNLOAD_MESSAGE,
    }));
    render(<Viewer onDownload={onDownload} />);

    fireEvent.click(screen.getByTestId('msa-differences-toggle'));
    fireEvent.click(screen.getByTestId('msa-differences-download-tsv'));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(SANDBOX_BLOCKED_DOWNLOAD_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/Download requested for/)).toBeNull();
  });
});
