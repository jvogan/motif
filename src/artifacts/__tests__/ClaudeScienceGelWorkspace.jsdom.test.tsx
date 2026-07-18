/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceGelWorkspace,
  createClaudeScienceGelLaneCandidates,
  type ClaudeScienceGelLaneCandidate,
  type ClaudeScienceGelRecord,
  type ClaudeScienceGelWorkspaceProps,
} from '../ClaudeScienceGelWorkspace';
import { sha256HexSync } from '../claude-science-sha256';
import type { ArtifactWorkflowResult } from '../claude-science-workspace-collections';

const CREATED_AT = '2026-07-12T20:00:00.000Z';

function record(
  id: string,
  patch: Partial<ClaudeScienceGelRecord> = {},
): ClaudeScienceGelRecord {
  return {
    id,
    name: id,
    type: 'dna',
    topology: 'linear',
    sequence: 'A'.repeat(2_000),
    ...patch,
  };
}

function digestResult(
  id = 'digest-1',
  patch: Partial<ArtifactWorkflowResult> = {},
): ArtifactWorkflowResult {
  return {
    id,
    kind: 'digest',
    name: 'EcoRI + BamHI digest',
    inputRecordIds: ['source-plasmid'],
    inputSha256s: [sha256HexSync('A'.repeat(4_500))],
    parameters: { topology: 'circular', outcome: 'fragmented', enzymes: ['EcoRI', 'BamHI'] },
    outputRecordIds: ['fragment-1', 'fragment-2', 'fragment-3'],
    result: {
      outcome: 'fragmented',
      fragments: [{ length: 3_000 }, { length: 1_000 }, { length: 500 }],
    },
    createdAt: CREATED_AT,
    provenance: { source: 'motif-artifact', operation: 'restriction_digest' },
    ...patch,
  };
}

function baseProps(
  candidates: readonly ClaudeScienceGelLaneCandidate[],
  patch: Partial<ClaudeScienceGelWorkspaceProps> = {},
): ClaudeScienceGelWorkspaceProps {
  return {
    candidates,
    selectedCandidateIds: candidates.slice(0, 2).map((candidate) => candidate.id),
    ladderPreset: '1kb',
    agarosePercent: 1,
    workflowName: 'Diagnostic digest gel',
    resultIdentity: {
      workflowResultId: 'gel-result-1',
      createdAt: CREATED_AT,
      provenance: { source: 'motif-artifact', actor: 'local-user' },
    },
    onSelectedCandidateIdsChange: vi.fn(),
    onLadderPresetChange: vi.fn(),
    onAgarosePercentChange: vi.fn(),
    onWorkflowNameChange: vi.fn(),
    onSaveResult: vi.fn(),
    onClose: vi.fn(),
    ...patch,
  };
}

afterEach(cleanup);

describe('createClaudeScienceGelLaneCandidates', () => {
  it('offers saved cut digests and linear DNA while excluding physically ambiguous sources', () => {
    const records = [
      record('source-plasmid', { name: 'Source plasmid', topology: 'circular', sequence: 'A'.repeat(4_500) }),
      record('linear-control', { name: 'Linear control', sequence: 'A'.repeat(750) }),
      record('circular-control', { topology: 'circular' }),
      record('rna-control', { type: 'rna' }),
      record('empty', { sequence: '' }),
    ];
    const results = [
      digestResult(),
      digestResult('uncut', {
        name: 'Uncut circular control',
        parameters: { topology: 'circular', outcome: 'uncut' },
        result: { outcome: 'uncut', fragments: [{ length: 4_500 }] },
      }),
      digestResult('broken', { result: { outcome: 'fragmented', fragments: [{ length: 0 }] } }),
      digestResult('ambiguous-legacy', {
        parameters: { topology: 'circular' },
        result: { fragments: [{ length: 4_500 }] },
      }),
      { ...digestResult('gel-result'), kind: 'gel' as const },
    ];

    const candidates = createClaudeScienceGelLaneCandidates(records, results);

    expect(candidates.map((candidate) => [candidate.id, candidate.sourceKind])).toEqual([
      ['digest:digest-1', 'digest'],
      ['record:linear-control', 'linear-record'],
    ]);
    expect(candidates[0].detail).toBe('3 fragments · 4,500 bp');
    expect(candidates[0].lane).toMatchObject({
      sourceKind: 'digest',
      recordId: 'source-plasmid',
      recordSha256: sha256HexSync('A'.repeat(4_500)),
      sourceTopology: 'circular',
      fragmentLengthsBp: [3_000, 1_000, 500],
      digestWorkflowResultId: 'digest-1',
    });
    expect(candidates[1].lane).toMatchObject({
      sourceKind: 'linear-record',
      recordId: 'linear-control',
      recordSha256: sha256HexSync('A'.repeat(750)),
      topology: 'linear',
      lengthBp: 750,
    });
  });

  it('rejects stale saved digests and accepts matching case-normalized provenance', () => {
    const source = record('source-plasmid', {
      topology: 'circular',
      sequence: 'ACGT',
    });
    const currentSha256 = sha256HexSync(source.sequence);
    const stale = digestResult('stale', {
      inputSha256s: [sha256HexSync('TGCA')],
      result: { outcome: 'fragmented', fragments: [{ length: 2 }, { length: 2 }] },
    });
    const matching = digestResult('matching', {
      inputSha256s: [currentSha256.toUpperCase()],
      result: { outcome: 'fragmented', fragments: [{ length: 2 }, { length: 2 }] },
    });

    const candidates = createClaudeScienceGelLaneCandidates([source], [stale, matching]);

    expect(candidates.map((candidate) => candidate.id)).toEqual(['digest:matching']);
    expect(candidates[0].lane).toMatchObject({ recordSha256: currentSha256 });
  });

  it('keeps legacy digest lanes hashless instead of attesting them to the current record', () => {
    const source = record('source-plasmid', {
      topology: 'linear',
      sequence: 'ACGT',
    });
    const legacy = digestResult('legacy', {
      inputSha256s: undefined,
      result: { outcome: 'fragmented', fragments: [{ length: 2 }, { length: 2 }] },
    });

    const candidates = createClaudeScienceGelLaneCandidates([source], [legacy]);
    const digestCandidate = candidates.find((candidate) => candidate.id === 'digest:legacy');

    expect(digestCandidate).toBeDefined();
    expect(digestCandidate?.lane).not.toHaveProperty('recordSha256');
  });

  it('omits stale and unverified workflow history when a scientific freshness map is supplied', () => {
    const source = record('source-plasmid', { topology: 'linear', sequence: 'ACGT' });
    const fresh = digestResult('fresh', {
      inputSha256s: [sha256HexSync(source.sequence)],
      parameters: { topology: 'linear', outcome: 'fragmented' },
      result: { outcome: 'fragmented', fragments: [{ length: 2 }, { length: 2 }] },
    });
    const stale = { ...fresh, id: 'stale' };
    const unverified = { ...fresh, id: 'unverified', inputSha256s: undefined };
    const freshness = new Map([
      ['fresh', { state: 'fresh' as const }],
      ['stale', { state: 'stale' as const }],
      ['unverified', { state: 'unverified' as const }],
    ]);

    expect(createClaudeScienceGelLaneCandidates([source], [fresh, stale, unverified], freshness)
      .filter((candidate) => candidate.sourceKind === 'digest')
      .map((candidate) => candidate.id)).toEqual(['digest:fresh']);
  });

  it('omits records whose declared digest is malformed or does not match their current sequence', () => {
    const mismatched = record('mismatched', {
      sequence: 'AAAA',
      sha256: sha256HexSync('CCCC'),
    });
    const malformed = record('malformed', {
      sequence: 'AAAA',
      sha256: 'not-a-sha',
    });

    expect(createClaudeScienceGelLaneCandidates([mismatched, malformed], [])).toEqual([]);
  });

  it('bounds durable ids and lane labels without losing the durable workflow reference', () => {
    const longId = `digest-${'x'.repeat(180)}`;
    const longName = `Long digest ${'n'.repeat(180)}`;
    const candidate = createClaudeScienceGelLaneCandidates([], [digestResult(longId, {
      name: longName,
      inputRecordIds: ['source-without-current-record'],
    })])[0];
    if (candidate.lane.sourceKind !== 'digest') throw new Error('Expected a digest lane.');

    expect(candidate.lane.id.length).toBeLessThanOrEqual(160);
    expect(candidate.lane.label.length).toBeLessThanOrEqual(128);
    expect(candidate.lane.label.endsWith('…')).toBe(true);
    expect(candidate.lane.digestWorkflowResultId).toBe(longId);
  });
});

describe('ClaudeScienceGelWorkspace', () => {
  const candidates = createClaudeScienceGelLaneCandidates(
    [
      record('source-plasmid', { name: 'Source plasmid', topology: 'circular', sequence: 'A'.repeat(4_500) }),
      record('linear-control', { name: 'Linear control', sequence: 'A'.repeat(750) }),
    ],
    [digestResult()],
  );

  it('renders a restrained, labelled gel and saves the exact model result', async () => {
    const user = userEvent.setup();
    const onSaveResult = vi.fn();
    const onLadderPresetChange = vi.fn();
    const onAgarosePercentChange = vi.fn();
    const onWorkflowNameChange = vi.fn();
    render(<ClaudeScienceGelWorkspace {...baseProps(candidates, {
      onSaveResult,
      onLadderPresetChange,
      onAgarosePercentChange,
      onWorkflowNameChange,
    })} />);

    expect(screen.getByTestId('gel-plate')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Qualitative gel lanes' }).children).toHaveLength(3);
    expect(screen.getByText('1 kb ladder')).toBeTruthy();
    expect(screen.getAllByText('EcoRI + BamHI digest')).toHaveLength(2);
    expect(screen.getAllByText('Linear control')).toHaveLength(2);
    expect(screen.getByRole('note').textContent).toContain('Qualitative preview only');
    expect(screen.getByRole('note').textContent).toContain('do not predict measured distance');

    const firstSampleBand = screen.getByTestId('gel-band-digest:digest-1-0');
    expect(firstSampleBand.getAttribute('title')).toContain('3,000 bp');
    expect(firstSampleBand.getAttribute('tabindex')).toBe('0');
    firstSampleBand.focus();
    expect(document.activeElement).toBe(firstSampleBand);
    const secondSampleBand = screen.getByTestId('gel-band-digest:digest-1-1');
    expect(secondSampleBand.getAttribute('tabindex')).toBe('-1');
    fireEvent.keyDown(firstSampleBand, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(secondSampleBand);

    await user.click(screen.getByRole('radio', { name: '100 bp' }));
    expect(onLadderPresetChange).toHaveBeenCalledWith('100bp');
    fireEvent.change(screen.getByTestId('gel-agarose-range'), { target: { value: '1.6' } });
    expect(onAgarosePercentChange).toHaveBeenCalledWith(1.6);
    await user.clear(screen.getByRole('textbox', { name: 'Result name' }));
    await user.type(screen.getByRole('textbox', { name: 'Result name' }), 'Saved gel');
    expect(onWorkflowNameChange).toHaveBeenCalled();

    await user.click(screen.getByTestId('gel-save-result'));
    expect(onSaveResult).toHaveBeenCalledTimes(1);
    expect(onSaveResult.mock.calls[0][0]).toMatchObject({
      ladderPreset: '1kb',
      agarosePercent: 1,
      sampleLaneCount: 2,
      workflowResult: {
        id: 'gel-result-1',
        kind: 'gel',
        name: 'Diagnostic digest gel',
        inputRecordIds: ['source-plasmid', 'linear-control'],
        inputSha256s: [
          sha256HexSync('A'.repeat(4_500)),
          sha256HexSync('A'.repeat(750)),
        ],
        parameters: { ladderPreset: '1kb', agarosePercent: 1, qualitativeOnly: true },
        provenance: {
          source: 'motif-artifact',
          actor: 'local-user',
          operation: 'gel_preview',
          engine: 'artifact-qualitative-gel',
          parentIds: ['digest-1'],
        },
      },
    });
  });

  it('keeps lane selection controlled and enforces the 12-sample bound', async () => {
    const user = userEvent.setup();
    const many = createClaudeScienceGelLaneCandidates(
      Array.from({ length: 13 }, (_, index) => record(`record-${index + 1}`, { name: `Record ${index + 1}` })),
      [],
    );
    const selectedCandidateIds = many.slice(0, 12).map((candidate) => candidate.id);
    const onSelectedCandidateIdsChange = vi.fn();
    render(<ClaudeScienceGelWorkspace {...baseProps(many, {
      selectedCandidateIds,
      onSelectedCandidateIdsChange,
    })} />);

    expect(screen.getByText('12 of 12 lanes')).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: 'Record 13, Linear DNA · 2,000 bp' }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Record 1, Linear DNA · 2,000 bp' }) as HTMLInputElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSelectedCandidateIdsChange).toHaveBeenCalledWith([]);
  });

  it('provides actionable empty and invalid states and closes from buttons or Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const empty = render(<ClaudeScienceGelWorkspace {...baseProps([], {
      selectedCandidateIds: [],
      onClose,
    })} />);
    expect(screen.getByTestId('gel-no-sources').textContent).toMatch(/Save a restriction digest/);
    expect(screen.getByTestId('gel-empty-preview').textContent).toMatch(/Choose at least one sample lane/);
    expect((screen.getByTestId('gel-save-result') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Close gel workspace' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    empty.unmount();

    render(<ClaudeScienceGelWorkspace {...baseProps(candidates, { onClose })} />);
    const workspace = screen.getByTestId('gel-workspace');
    workspace.focus();
    fireEvent.keyDown(workspace, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the physical preview visible while the controlled result name is invalid', () => {
    render(<ClaudeScienceGelWorkspace {...baseProps(candidates, { workflowName: '' })} />);

    expect(screen.getByTestId('gel-plate')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Enter a result name');
    expect((screen.getByTestId('gel-save-result') as HTMLButtonElement).disabled).toBe(true);
  });

  it('exposes source groups and controlled checkbox changes without rendering HTML from labels', async () => {
    const user = userEvent.setup();
    const unsafeCandidates = createClaudeScienceGelLaneCandidates(
      [record('linear-control', { name: '<img src=x onerror=alert(1)>' })],
      [digestResult()],
    );
    const onSelectedCandidateIdsChange = vi.fn();
    const view = render(<ClaudeScienceGelWorkspace {...baseProps(unsafeCandidates, {
      selectedCandidateIds: [],
      onSelectedCandidateIdsChange,
    })} />);

    expect(screen.getByTestId('gel-digest-sources')).toBeTruthy();
    expect(screen.getByTestId('gel-record-sources')).toBeTruthy();
    expect(view.container.querySelector('img')).toBeNull();
    const digestGroup = screen.getByTestId('gel-digest-sources');
    await user.click(within(digestGroup).getByRole('checkbox', { name: /EcoRI \+ BamHI digest/ }));
    expect(onSelectedCandidateIdsChange).toHaveBeenCalledWith(['digest:digest-1']);
  });
});
