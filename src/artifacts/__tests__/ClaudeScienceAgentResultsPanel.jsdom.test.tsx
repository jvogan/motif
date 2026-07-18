/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceAgentResultsPanel } from '../ClaudeScienceAgentResultsPanel';
import type { ArtifactAnalysisAsset, ArtifactAnalysisResult } from '../claude-science-analysis-results';

const CREATED_AT = '2026-07-12T20:00:00.000Z';
const provenance = {
  source: 'claude-science',
  actor: 'Claude',
  engine: 'motif-primer-design',
  engineVersion: '1',
};

const primerResult: ArtifactAnalysisResult = {
  id: 'primer-1',
  kind: 'primer_design',
  name: 'pUC19 verification primers',
  status: 'complete',
  summary: 'Two ranked pairs passed the requested constraints.',
  inputRecordIds: ['puc19'],
  inputSha256s: ['a'.repeat(64)],
  dependsOnResultIds: [],
  assetIds: [],
  parameters: { targetTm: 60 },
  data: {
    targetRecordId: 'puc19',
    pairs: [{
      id: 'pair-1',
      forward: { sequence: 'ACGTACGTACGTACGTACGT', tmC: 60, gcPercent: 50 },
      reverse: { sequence: 'TGCATGCATGCATGCATGCA', tmC: 61, gcPercent: 50 },
      productLengthBp: 420,
    }],
    selectedPairId: 'pair-1',
  },
  createdAt: CREATED_AT,
  provenance,
};

const blastResult: ArtifactAnalysisResult = {
  id: 'blast-1',
  kind: 'blast_search',
  name: 'pUC19 nucleotide search',
  status: 'partial',
  inputRecordIds: ['puc19'],
  inputSha256s: ['a'.repeat(64)],
  dependsOnResultIds: [],
  assetIds: [],
  parameters: {},
  data: {
    program: 'blastn',
    database: 'nt',
    queryRecordId: 'puc19',
    hits: [
      {
        accession: 'TEST.1',
        title: '<img src=x onerror=alert(1)>',
        identityPercent: 99.2,
        queryCoveragePercent: 95,
        eValue: 1e-40,
        bitScore: 300,
        queryStart: 1,
        queryEnd: 95,
        subjectStart: 200,
        subjectEnd: 106,
        alignmentAssetId: 'blast-alignment',
      },
      {
        accession: 'ZERO.1',
        title: 'Zero E-value hit',
        identityPercent: 97,
        queryCoveragePercent: 100,
        eValue: 0,
        bitScore: 450,
      },
      {
        accession: 'IDENTITY.1',
        title: 'Highest identity hit',
        identityPercent: 100,
        queryCoveragePercent: 80,
        eValue: 1e-10,
        bitScore: 250,
      },
    ],
  },
  createdAt: CREATED_AT,
  provenance: { ...provenance, engine: 'blastn' },
};

const alignmentContent = `<script>globalThis.pwned=true</script>\n${'A'.repeat(13_000)}`;
const blastAlignmentAsset: ArtifactAnalysisAsset = {
  id: 'blast-alignment',
  name: '../unsafe alignment.txt',
  mediaType: 'text/plain',
  content: alignmentContent,
  createdAt: CREATED_AT,
  provenance,
};

const reportText = `<img src=x onerror=alert(1)>\n${'R'.repeat(20_100)}\nREPORT TAIL`;
const reportResult: ArtifactAnalysisResult = {
  id: 'report-1',
  kind: 'report',
  name: 'Agent safety report',
  status: 'complete',
  inputRecordIds: ['puc19'],
  inputSha256s: ['a'.repeat(64)],
  dependsOnResultIds: [],
  assetIds: [],
  parameters: {},
  data: { format: 'markdown', body: reportText },
  createdAt: CREATED_AT,
  provenance,
};

const tableResult: ArtifactAnalysisResult = {
  id: 'table-1',
  kind: 'table',
  name: 'QC measurements',
  status: 'complete',
  inputRecordIds: ['puc19'],
  dependsOnResultIds: [],
  assetIds: [],
  parameters: {},
  data: {
    columns: [
      { id: 'sample', label: 'Sample', type: 'string' },
      { id: 'value', label: 'Value', type: 'mixed' },
      { id: 'accepted', label: 'Accepted', type: 'boolean' },
    ],
    rows: Array.from({ length: 55 }, (_, index) => [
      index === 54 ? '<img src=x onerror=alert(1)>' : `Sample ${index + 1}`,
      index === 1 ? null : index,
      index % 2 === 0,
    ]),
  },
  createdAt: CREATED_AT,
  provenance,
};

afterEach(cleanup);

describe('ClaudeScienceAgentResultsPanel', () => {
  it('renders typed facts, provenance, and previews as inert text', async () => {
    const user = userEvent.setup();
    const view = render(
      <ClaudeScienceAgentResultsPanel
        results={[primerResult, blastResult]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('pUC19 verification primers')).toBeTruthy();
    expect(screen.getByText('420 bp')).toBeTruthy();
    expect(screen.getByText('pUC19 nucleotide search')).toBeTruthy();
    expect(view.container.querySelector('img')).toBeNull();
    const blastRow = screen.getByTestId('analysis-result-blast-1');
    await user.click(within(blastRow).getByText('Provenance & Data'));
    expect(within(blastRow).getByLabelText('pUC19 nucleotide search safe text preview').textContent).toContain('TEST.1');
  });

  it('filters result groups without discarding saved results', () => {
    render(
      <ClaudeScienceAgentResultsPanel
        results={[primerResult, blastResult]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'design' } });
    expect(screen.getByText('pUC19 verification primers')).toBeTruthy();
    expect(screen.queryByText('pUC19 nucleotide search')).toBeNull();
    expect(screen.getByText('1 shown')).toBeTruthy();
  });

  it('pages and copies a complete report while keeping Markdown and HTML-looking text inert', async () => {
    const user = userEvent.setup();
    const onCopyText = vi.fn();
    const onDownloadText = vi.fn();
    const view = render(
      <ClaudeScienceAgentResultsPanel
        results={[reportResult]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
        onCopyText={onCopyText}
        onDownloadText={onDownloadText}
      />,
    );
    const row = screen.getByTestId('analysis-result-report-1');
    expect(within(row).queryByLabelText('Agent safety report safe text preview')).toBeNull();
    await user.click(within(row).getByText('Provenance & Data'));

    const firstPage = within(row).getByLabelText('Agent safety report safe text preview');
    expect(firstPage.tabIndex).toBe(0);
    expect(firstPage.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(firstPage.textContent).not.toContain('REPORT TAIL');
    expect(view.container.querySelector('img')).toBeNull();
    expect(view.container.querySelector('script')).toBeNull();

    await user.click(within(row).getByRole('button', { name: 'Next pages for agent safety report safe text preview' }));
    expect(within(row).getByLabelText('Agent safety report safe text preview').textContent).toContain('REPORT TAIL');
    await user.click(within(row).getByRole('button', { name: 'Copy report Agent safety report' }));
    expect(onCopyText).toHaveBeenCalledWith('Report Agent safety report', reportText);
    await user.click(within(row).getByRole('button', { name: 'Download report Agent safety report' }));
    expect(onDownloadText).toHaveBeenCalledWith('Agent safety report.md', reportText, 'text/markdown');
    expect(screen.getByRole('status').textContent).toBe(
      'Download requested for Agent safety report.md. Verify the file before relying on it.',
    );
  });

  it('resolves a report body asset even when it is not repeated in generic assetIds', async () => {
    const user = userEvent.setup();
    const onCopyText = vi.fn();
    const bodyAsset: ArtifactAnalysisAsset = {
      id: 'report-body',
      name: '<body>.txt',
      mediaType: 'text/plain',
      content: '<script>alert(1)</script>\nasset-backed report',
      createdAt: CREATED_AT,
      provenance,
    };
    const assetReport: ArtifactAnalysisResult = {
      ...reportResult,
      id: 'report-asset',
      name: 'Asset-backed report',
      assetIds: [],
      data: { format: 'plain', bodyAssetId: bodyAsset.id },
    };
    const view = render(
      <ClaudeScienceAgentResultsPanel
        results={[assetReport]}
        assets={[bodyAsset]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
        onCopyText={onCopyText}
      />,
    );
    const row = screen.getByTestId('analysis-result-report-asset');
    await user.click(within(row).getByText('Provenance & Data'));
    expect(within(row).getByLabelText('Asset-backed report safe text preview').textContent).toContain('asset-backed report');
    expect(within(row).getAllByText(/<body>.txt/).length).toBeGreaterThan(0);
    expect(view.container.querySelector('script')).toBeNull();
    await user.click(within(row).getByText('<body>.txt', { selector: 'summary span' }));
    await user.click(within(row).getByRole('button', { name: 'Copy full asset <body>.txt' }));
    expect(onCopyText).toHaveBeenCalledWith('Asset <body>.txt', bodyAsset.content);
  });

  it('pages large linked-asset sets and keeps the provenance summary bounded', async () => {
    const user = userEvent.setup();
    const assets = Array.from({ length: 30 }, (_, index): ArtifactAnalysisAsset => ({
      id: `asset-${index + 1}`,
      name: `asset-${index + 1}.txt`,
      mediaType: 'text/plain',
      content: `asset content ${index + 1}`,
      createdAt: CREATED_AT,
      provenance,
    }));
    const result: ArtifactAnalysisResult = {
      ...primerResult,
      id: 'primer-assets',
      name: 'Asset-heavy primer result',
      assetIds: assets.map((asset) => asset.id),
    };
    render(
      <ClaudeScienceAgentResultsPanel
        results={[result]}
        assets={assets}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const row = screen.getByTestId('analysis-result-primer-assets');
    await user.click(within(row).getByText('Provenance & Data'));
    expect(within(row).getByText(/\+ 27 more/)).toBeTruthy();
    expect(row.querySelectorAll('.motif-cs-agent-asset')).toHaveLength(25);
    expect(within(row).queryByText('asset-30.txt', { selector: 'summary span' })).toBeNull();

    await user.click(within(row).getByRole('button', { name: /Next linked asset pages for asset-heavy primer result/i }));
    expect(row.querySelectorAll('.motif-cs-agent-asset')).toHaveLength(5);
    expect(within(row).getByText('asset-30.txt', { selector: 'summary span' })).toBeTruthy();
    expect(within(row).queryByText('asset-1.txt', { selector: 'summary span' })).toBeNull();
  });

  it('falls back to inert textarea copying when the Clipboard API is denied', async () => {
    const user = userEvent.setup();
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const execCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const writeText = vi.fn().mockRejectedValue(new Error('sandbox denied'));
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    try {
      render(
        <ClaudeScienceAgentResultsPanel
          results={[reportResult]}
          assets={[]}
          recordNames={{ puc19: 'pUC19' }}
          onRevealRecord={vi.fn()}
          onRemove={vi.fn()}
        />,
      );
      const row = screen.getByTestId('analysis-result-report-1');
      await user.click(within(row).getByText('Provenance & Data'));
      await user.click(within(row).getByRole('button', { name: 'Copy report Agent safety report' }));

      expect(writeText).toHaveBeenCalledWith(reportText);
      expect(execCommand).toHaveBeenCalledWith('copy');
      expect(document.querySelector('textarea')).toBeNull();
      expect(screen.getByRole('status').textContent).toBe('Report Agent safety report copied.');
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
      if (execCommandDescriptor) Object.defineProperty(document, 'execCommand', execCommandDescriptor);
      else Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('renders every table row through semantic pages and exports the complete TSV', async () => {
    const user = userEvent.setup();
    const onCopyText = vi.fn();
    const onDownloadText = vi.fn();
    const view = render(
      <ClaudeScienceAgentResultsPanel
        results={[tableResult]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
        onCopyText={onCopyText}
        onDownloadText={onDownloadText}
      />,
    );
    const row = screen.getByTestId('analysis-result-table-1');
    await user.click(within(row).getByText('Provenance & Data'));
    const table = within(row).getByRole('table');
    expect(within(table).getAllByRole('columnheader')).toHaveLength(3);
    expect(within(table).getAllByRole('row')).toHaveLength(51);
    expect(within(row).getByText('Sample 1')).toBeTruthy();
    expect(within(row).queryByText('<img src=x onerror=alert(1)>')).toBeNull();

    await user.click(within(row).getByRole('button', { name: 'Next table pages for qc measurements' }));
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(row).getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(view.container.querySelector('img')).toBeNull();
    await user.click(within(row).getByRole('button', { name: 'Copy table QC measurements as TSV' }));
    expect(onCopyText.mock.calls[0]?.[0]).toBe('Table QC measurements');
    expect(onCopyText.mock.calls[0]?.[1]).toContain('<img src=x onerror=alert(1)>\t54\ttrue');
    await user.click(within(row).getByRole('button', { name: 'Download table QC measurements as TSV' }));
    expect(onDownloadText.mock.calls[0]?.[0]).toBe('QC measurements.tsv');
    expect(onDownloadText.mock.calls[0]?.[2]).toBe('text/tab-separated-values');

    view.rerender(
      <ClaudeScienceAgentResultsPanel
        results={[{ ...tableResult, data: { ...tableResult.data, rows: tableResult.data.rows.slice(0, 10) } }]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
        onCopyText={onCopyText}
        onDownloadText={onDownloadText}
      />,
    );
    expect(within(row).getByText('Sample 1')).toBeTruthy();
    view.rerender(
      <ClaudeScienceAgentResultsPanel
        results={[tableResult]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
        onCopyText={onCopyText}
        onDownloadText={onDownloadText}
      />,
    );
    expect(within(row).getByText('Sample 1')).toBeTruthy();
    expect(within(row).queryByText('<img src=x onerror=alert(1)>')).toBeNull();
  });

  it('bounds maximum-width table pages and cell previews while preserving complete export data', async () => {
    const user = userEvent.setup();
    const onCopyText = vi.fn();
    const longCell = `${'L'.repeat(600)}TABLE TAIL`;
    const columns = Array.from({ length: 256 }, (_, index) => ({
      id: `column-${index}`,
      label: `Column ${index + 1}`,
      type: 'string' as const,
    }));
    const wideTable: ArtifactAnalysisResult = {
      ...tableResult,
      id: 'table-wide',
      name: 'Wide measurements',
      data: {
        columns,
        rows: Array.from({ length: 8 }, (_, rowIndex) => (
          columns.map((_, columnIndex) => rowIndex === 0 && columnIndex === 0 ? longCell : `r${rowIndex}c${columnIndex}`)
        )),
      },
    };
    render(
      <ClaudeScienceAgentResultsPanel
        results={[wideTable]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
        onCopyText={onCopyText}
      />,
    );

    const row = screen.getByTestId('analysis-result-table-wide');
    await user.click(within(row).getByText('Provenance & Data'));
    const table = within(row).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getAllByRole('cell')).toHaveLength(768);
    expect(within(row).getByText(/Cell previews are limited to 512 characters/)).toBeTruthy();
    expect(within(table).queryByText(/TABLE TAIL/)).toBeNull();
    await user.click(within(row).getByRole('button', { name: 'Next table pages for wide measurements' }));
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    await user.click(within(row).getByRole('button', { name: 'Copy table Wide measurements as TSV' }));
    expect(onCopyText.mock.calls[0]?.[1]).toContain('TABLE TAIL');
  });

  it('sorts BLAST hits and exposes only bounded inert alignment evidence while copying the full asset', async () => {
    const user = userEvent.setup();
    const onCopyText = vi.fn();
    const onDownloadText = vi.fn();
    const view = render(
      <ClaudeScienceAgentResultsPanel
        results={[blastResult]}
        assets={[blastAlignmentAsset]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
        onCopyText={onCopyText}
        onDownloadText={onDownloadText}
      />,
    );
    const row = screen.getByTestId('analysis-result-blast-1');
    await user.click(within(row).getByText('Provenance & Data'));
    const hitTable = within(row).getByRole('table');
    const accessions = () => within(hitTable).getAllByRole('row').slice(1).map((tableRow) => (
      within(tableRow).getAllByRole('cell')[0]?.textContent
    ));
    expect(accessions()).toEqual(['ZERO.1', 'TEST.1', 'IDENTITY.1']);
    await user.selectOptions(within(row).getByLabelText('Sort hits'), 'identity');
    expect(accessions()).toEqual(['IDENTITY.1', 'TEST.1', 'ZERO.1']);

    const testHitRow = within(hitTable).getByText('TEST.1').closest('tr');
    expect(testHitRow).not.toBeNull();
    const alignmentDisclosure = within(testHitRow as HTMLTableRowElement).getByRole('button', { name: 'Show alignment TEST.1' });
    const evidenceId = alignmentDisclosure.getAttribute('aria-controls');
    expect(evidenceId).toBeTruthy();
    await user.click(alignmentDisclosure);
    const evidence = within(testHitRow as HTMLTableRowElement).getByLabelText('TEST.1 bounded alignment evidence');
    expect(document.getElementById(evidenceId as string)?.contains(evidence)).toBe(true);
    expect(evidence.tabIndex).toBe(0);
    expect(evidence.textContent?.length).toBe(12_000);
    expect(evidence.textContent).toContain('<script>globalThis.pwned=true</script>');
    expect(view.container.querySelector('script')).toBeNull();
    await user.click(within(testHitRow as HTMLTableRowElement).getByRole('button', { name: 'Copy full evidence TEST.1' }));
    expect(onCopyText).toHaveBeenCalledWith('BLAST alignment TEST.1', alignmentContent);
    await user.click(within(testHitRow as HTMLTableRowElement).getByRole('button', { name: 'Download alignment TEST.1' }));
    expect(onDownloadText).toHaveBeenCalledWith('-unsafe alignment.txt', alignmentContent, 'text/plain');
  });

  it('pages more than 25 BLAST hits and resets to the first page when sorting changes', async () => {
    const user = userEvent.setup();
    const pagedBlast: ArtifactAnalysisResult = {
      ...blastResult,
      id: 'blast-paged',
      name: 'Paged nucleotide search',
      data: {
        ...blastResult.data,
        hits: Array.from({ length: 30 }, (_, index) => ({
          accession: `HIT.${String(index + 1).padStart(2, '0')}`,
          title: `Saved hit ${index + 1}`,
          identityPercent: 60 + index,
          queryCoveragePercent: 100 - index,
          eValue: index + 1,
          bitScore: 300 - index,
        })),
      },
    };
    render(
      <ClaudeScienceAgentResultsPanel
        results={[pagedBlast]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    const row = screen.getByTestId('analysis-result-blast-paged');
    await user.click(within(row).getByText('Provenance & Data'));
    const table = within(row).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(26);
    expect(within(table).getByText('HIT.01')).toBeTruthy();
    expect(within(table).queryByText('HIT.26')).toBeNull();

    await user.click(within(row).getByRole('button', { name: 'Next blast hit pages for paged nucleotide search' }));
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    expect(within(table).getByText('HIT.26')).toBeTruthy();
    await user.selectOptions(within(row).getByLabelText('Sort hits'), 'identity');
    expect(within(table).getAllByRole('row')).toHaveLength(26);
    expect(within(table).getByText('HIT.30')).toBeTruthy();
    expect(within(row).getByText('1–25 of 30')).toBeTruthy();
  });

  it('progressively renders large result lists and collapses back to the first page', async () => {
    const user = userEvent.setup();
    const results = Array.from({ length: 60 }, (_, index): ArtifactAnalysisResult => ({
      ...primerResult,
      id: `primer-${String(index).padStart(3, '0')}`,
      name: `Primer result ${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 6, 12, 20, 0, index)).toISOString(),
    }));
    const view = render(
      <ClaudeScienceAgentResultsPanel
        results={results}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId(/^analysis-result-primer-/)).toHaveLength(25);
    expect(screen.getByText('Showing 25 of 60')).toBeTruthy();
    expect(screen.getByText('25 of 60 shown')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show 25 more' }));
    expect(screen.getAllByTestId(/^analysis-result-primer-/)).toHaveLength(50);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show 10 more' }));
    await user.click(screen.getByRole('button', { name: 'Show 10 more' }));
    expect(screen.getAllByTestId(/^analysis-result-primer-/)).toHaveLength(60);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show first 25' }));
    await user.click(screen.getByRole('button', { name: 'Show first 25' }));
    expect(screen.getAllByTestId(/^analysis-result-primer-/)).toHaveLength(25);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show 25 more' }));

    await user.click(screen.getByRole('button', { name: 'Show 25 more' }));
    expect(screen.getAllByTestId(/^analysis-result-primer-/)).toHaveLength(50);
    view.rerender(
      <ClaudeScienceAgentResultsPanel
        results={results.slice(0, 10)}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId(/^analysis-result-primer-/)).toHaveLength(10);
    view.rerender(
      <ClaudeScienceAgentResultsPanel
        results={results}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId(/^analysis-result-primer-/)).toHaveLength(25);
  });

  it('shows saved-input freshness and its reason without changing the result status', async () => {
    const user = userEvent.setup();
    render(
      <ClaudeScienceAgentResultsPanel
        results={[primerResult]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        freshnessByResultId={new Map([[
          'primer-1',
          { state: 'stale', reasons: [{ code: 'sequence_changed', recordId: 'puc19' }] },
        ]])}
        onRevealRecord={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('complete')).toBeTruthy();
    expect(screen.getAllByText('Stale')).toHaveLength(1);
    await user.click(screen.getByText('Provenance & Data'));
    expect(screen.getAllByText('Stale')).toHaveLength(2);
    expect(screen.getByText(/pUC19's sequence has changed/)).toBeTruthy();
  });

  it('reveals linked records and confirms removal with focus restoration', async () => {
    const onRevealRecord = vi.fn();
    const onRemove = vi.fn(() => true);
    render(
      <ClaudeScienceAgentResultsPanel
        results={[primerResult]}
        assets={[]}
        recordNames={{ puc19: 'pUC19' }}
        onRevealRecord={onRevealRecord}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reveal Input' }));
    expect(onRevealRecord).toHaveBeenCalledWith('puc19');
    fireEvent.click(screen.getByRole('button', { name: 'Remove pUC19 verification primers' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Result' }));
    expect(onRemove).toHaveBeenCalledWith('primer-1');
    expect(screen.getByRole('status').textContent).toBe('Analysis result removed.');
  });
});
