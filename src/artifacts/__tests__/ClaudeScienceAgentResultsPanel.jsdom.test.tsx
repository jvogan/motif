/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeScienceAgentResultsPanel } from '../ClaudeScienceAgentResultsPanel';
import type { ArtifactAnalysisResult } from '../claude-science-analysis-results';

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
    hits: [{
      accession: 'TEST.1',
      title: '<img src=x onerror=alert(1)>',
      identityPercent: 99.2,
      queryCoveragePercent: 95,
      eValue: 1e-40,
      bitScore: 300,
    }],
  },
  createdAt: CREATED_AT,
  provenance: { ...provenance, engine: 'blastn' },
};

afterEach(cleanup);

describe('ClaudeScienceAgentResultsPanel', () => {
  it('renders typed facts, provenance, and previews as inert text', () => {
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
    fireEvent.click(screen.getAllByText('Provenance & Data')[1]);
    expect(screen.getByLabelText('pUC19 nucleotide search safe text preview').textContent).toContain('TEST.1');
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

  it('shows saved-input freshness and its reason without changing the result status', () => {
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
    expect(screen.getAllByText('Stale')).toHaveLength(2);
    fireEvent.click(screen.getByText('Provenance & Data'));
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
