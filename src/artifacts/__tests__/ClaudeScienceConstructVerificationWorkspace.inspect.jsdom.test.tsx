/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceConstructVerificationWorkspace,
  type ClaudeScienceConstructVerificationRecord,
  type ClaudeScienceConstructVerificationRequest,
} from '../ClaudeScienceConstructVerificationWorkspace';
import type { ConstructVerificationTraceTarget } from '../claude-science-construct-verification-traces';
import { verifyArtifactConstruct } from '../claude-science-construct-verification';
import { traceTemplateCoordinateLabel } from '../ClaudeScienceSangerTraceViewer';
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

const RECORDS: ClaudeScienceConstructVerificationRecord[] = [
  { id: 'ref', name: 'Predicted', sequence: REFERENCE, topology: 'linear', sha256: sha256HexSync(REFERENCE) },
  {
    id: 'read',
    name: 'read.ab1',
    sequence: READ,
    topology: 'linear',
    sha256: sha256HexSync(READ),
    sangerTrace: { baseCalls: READ, qualityScores: Array.from({ length: READ.length }, () => 40) },
    sangerEvidenceSha256: 'e'.repeat(64),
  },
];

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

describe('ClaudeScienceConstructVerificationWorkspace variant traces', () => {
  it('hands the host the alignment, column and read that a variant row opens', () => {
    const onInspectVariant = vi.fn<(target: ConstructVerificationTraceTarget) => void>();
    render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={RECORDS} initialReferenceId="ref" onVerify={verify} onSave={vi.fn()} onInspectVariant={onInspectVariant} />,
    );
    fireEvent.click(screen.getByTestId('construct-verification-run'));
    const table = screen.getByTestId('construct-verification-variant-table');
    fireEvent.click(within(table).getByRole('button', { name: 'Show the traces at reference position 18' }));

    expect(onInspectVariant).toHaveBeenCalledTimes(1);
    const { alignment, column, rowId } = onInspectVariant.mock.calls[0][0];
    const template = alignment.rows.find((row) => row.id === alignment.referenceRowId)!;
    const read = alignment.rows.find((row) => row.id === rowId)!;
    expect(read.sourceRecordId).toBe('read');
    expect(read.aligned.replace(/-/g, '')).toBe(READ);
    expect(template.aligned[column]).toBe(REFERENCE[17]);
    expect(read.aligned[column]).toBe(READ[17]);
    expect(traceTemplateCoordinateLabel(alignment, template, column)).toBe('Reference position 18');
    expect(screen.queryByTestId('construct-verification-error')).toBeNull();
  });

  it('keeps the rows plain when the host cannot open Alignment', () => {
    render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={RECORDS} initialReferenceId="ref" onVerify={verify} onSave={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('construct-verification-run'));
    const table = screen.getByTestId('construct-verification-variant-table');
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
  });

  it('says so in the window when the host refuses the alignment', () => {
    const onInspectVariant = vi.fn(() => { throw new Error('Saved alignments can contain at most 4,000,000 row-columns in total.'); });
    render(
      <ClaudeScienceConstructVerificationWorkspace embedded records={RECORDS} initialReferenceId="ref" onVerify={verify} onSave={vi.fn()} onInspectVariant={onInspectVariant} />,
    );
    fireEvent.click(screen.getByTestId('construct-verification-run'));
    fireEvent.click(within(screen.getByTestId('construct-verification-variant-table')).getByRole('button', { name: /reference position 18/ }));
    expect(screen.getByTestId('construct-verification-error').textContent).toBe('Saved alignments can contain at most 4,000,000 row-columns in total.');
    // The run stays on screen.
    expect(screen.getByTestId('construct-verification-panel')).toBeTruthy();
  });
});
