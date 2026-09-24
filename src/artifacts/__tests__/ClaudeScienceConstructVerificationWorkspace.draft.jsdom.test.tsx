/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceConstructVerificationWorkspace,
  type ClaudeScienceConstructVerificationDraft,
  type ClaudeScienceConstructVerificationRecord,
  type ClaudeScienceConstructVerificationRequest,
} from '../ClaudeScienceConstructVerificationWorkspace';
import { verifyArtifactConstruct } from '../claude-science-construct-verification';
import { sha256HexSync } from '../claude-science-sha256';

function deterministicDna(length: number, seed: number): string {
  const bases = ['A', 'C', 'G', 'T'] as const;
  let state = seed >>> 0;
  let sequence = '';
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    sequence += bases[(state >>> 28) & 3];
  }
  return sequence;
}

const REFERENCE = deterministicDna(240, 0x1234);
const READ = Array.from(REFERENCE, (base, index) => (index === 17 ? (base === 'A' ? 'G' : 'A') : base)).join('');

function records(readSequence = READ): ClaudeScienceConstructVerificationRecord[] {
  return [
    { id: 'ref', name: 'Predicted', sequence: REFERENCE, topology: 'linear', sha256: sha256HexSync(REFERENCE), group: 'Clone' },
    {
      id: 'read',
      name: 'read.ab1',
      sequence: readSequence,
      topology: 'linear',
      sha256: sha256HexSync(readSequence),
      group: 'Clone',
      sangerTrace: { baseCalls: readSequence, qualityScores: Array.from({ length: readSequence.length }, () => 40) },
      sangerEvidenceSha256: 'e'.repeat(64),
    },
  ];
}

function verify(request: ClaudeScienceConstructVerificationRequest) {
  return verifyArtifactConstruct({
    reference: { id: request.reference.id, name: request.reference.name, sequence: request.reference.sequence, topology: request.reference.topology, sha256: request.reference.sha256 },
    reads: request.reads.map((read) => ({ id: read.id, name: read.name, baseCalls: read.sangerTrace.baseCalls, qualityScores: read.sangerTrace.qualityScores, sha256: read.sha256 })),
    requiredRegions: [{ id: 'full-reference', name: 'Full predicted construct', start: 0, end: request.reference.sequence.length, minDepth: request.minDepth, requireBothStrands: request.requireBothStrands }],
    expectedVariants: [],
    thresholds: { minCoverageFraction: 1, minDepth: request.minDepth, requireBothStrands: request.requireBothStrands },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceConstructVerificationWorkspace draft', () => {
  it('brings an unsaved run back after the window closes and reopens', () => {
    let kept = null as ClaudeScienceConstructVerificationDraft | null;
    const keep = (draft: ClaudeScienceConstructVerificationDraft) => { kept = draft; };
    const first = render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={records()} initialReferenceId="ref" onVerify={verify} onSave={vi.fn()} loadDraft={() => kept} onDraftChange={keep} />,
    );
    fireEvent.click(screen.getByTestId('construct-verification-run'));
    expect(screen.getByTestId('construct-verification-panel')).toBeTruthy();
    expect(kept?.completedRun?.result.state).toBe('inconsistent');
    // Closing the window unmounts the workspace; opening Alignment does the same.
    first.unmount();

    render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={records()} initialReferenceId="ref" onVerify={verify} onSave={vi.fn()} loadDraft={() => kept} onDraftChange={keep} />,
    );
    expect(screen.getByTestId('construct-verification-panel')).toBeTruthy();
    expect(screen.getByTestId('construct-verification-status').textContent).toBe('Your unsaved run is restored. Review it, then save it to keep it in Results.');
    expect((screen.getByTestId('construct-verification-save') as HTMLButtonElement).disabled).toBe(false);
  });

  it('drops a kept run whose records changed while the window was closed, and says so', () => {
    let kept = null as ClaudeScienceConstructVerificationDraft | null;
    const keep = (draft: ClaudeScienceConstructVerificationDraft) => { kept = draft; };
    const first = render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={records()} initialReferenceId="ref" onVerify={verify} onSave={vi.fn()} loadDraft={() => kept} onDraftChange={keep} />,
    );
    fireEvent.click(screen.getByTestId('construct-verification-run'));
    first.unmount();

    render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={records(REFERENCE)} initialReferenceId="ref" onVerify={verify} onSave={vi.fn()} loadDraft={() => kept} onDraftChange={keep} />,
    );
    expect(screen.queryByTestId('construct-verification-panel')).toBeNull();
    expect(screen.getByTestId('construct-verification-status').textContent).toBe('Your earlier run was discarded because its records changed. Run verification again.');
  });
});
