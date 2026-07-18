/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceConstructVerificationWorkspace,
  type ClaudeScienceConstructVerificationRecord,
  type ClaudeScienceConstructVerificationRequest,
  type ClaudeScienceConstructVerificationResult,
} from '../ClaudeScienceConstructVerificationWorkspace';
import { ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS } from '../claude-science-construct-verification';

const DEFAULT_THRESHOLDS = {
  trimQuality: 20,
  trimWindow: 12,
  minTrimmedReadLength: 40,
  minMappingIdentity: 0.82,
  minMappingMargin: 0.03,
  maxIndelFraction: 0.12,
  minCoverageFraction: 1,
  minDepth: 1,
  requireBothStrands: false,
  minConsensusFraction: 0.7,
  minVariantQuality: 20,
  minVariantFraction: 0.6,
} as const;

function referenceRecord(
  override: Partial<ClaudeScienceConstructVerificationRecord> = {},
): ClaudeScienceConstructVerificationRecord {
  return {
    id: 'predicted-reference',
    name: 'Predicted pTarget',
    sequence: 'ACGT'.repeat(300),
    topology: 'circular',
    sha256: 'a'.repeat(64),
    ...override,
  };
}

function traceRecord(
  id: string,
  override: Partial<ClaudeScienceConstructVerificationRecord> = {},
): ClaudeScienceConstructVerificationRecord {
  return {
    id,
    name: `Sanger ${id}`,
    sequence: 'ACGT'.repeat(120),
    topology: 'linear',
    sha256: id === 'read-a' ? 'b'.repeat(64) : 'c'.repeat(64),
    sangerTrace: {
      baseCalls: 'ACGT'.repeat(120),
      qualityScores: Array.from({ length: 480 }, () => 36),
    },
    sangerEvidenceSha256: id === 'read-a' ? 'd'.repeat(64) : 'e'.repeat(64),
    ...override,
  };
}

function verificationResult(
  request?: ClaudeScienceConstructVerificationRequest,
): ClaudeScienceConstructVerificationResult {
  const reference = request?.reference ?? referenceRecord();
  const reads = request?.reads ?? [traceRecord('read-a') as ClaudeScienceConstructVerificationRecord & { sangerTrace: { baseCalls: string; qualityScores?: readonly number[] } }];
  return {
    schema: 'motif.construct-verification.v1',
    version: 1,
    state: 'consistent',
    reasons: [],
    reference: {
      id: reference.id,
      name: reference.name,
      sequence: reference.sequence,
      length: reference.sequence.length,
      topology: reference.topology,
      sha256: reference.sha256,
    },
    thresholds: {
      ...DEFAULT_THRESHOLDS,
      minDepth: request?.minDepth ?? DEFAULT_THRESHOLDS.minDepth,
      requireBothStrands: request?.requireBothStrands ?? DEFAULT_THRESHOLDS.requireBothStrands,
    },
    reads: reads.map((read) => ({
      id: read.id,
      name: read.name,
      sha256: read.sha256,
      rawLength: read.sangerTrace.baseCalls.length,
      qualityProvided: true,
      meanQuality: 36,
      status: 'mapped',
      trim: {
        method: 'quality_window',
        rawStart: 0,
        rawEnd: read.sangerTrace.baseCalls.length,
        trimmedLength: read.sangerTrace.baseCalls.length,
        removedFromStart: 0,
        removedFromEnd: 0,
      },
      mapping: {
        orientation: read.id === 'read-b' ? 'reverse' : 'forward',
        referenceStart: 0,
        referenceEnd: read.sangerTrace.baseCalls.length,
        wraps: false,
        referenceSpan: read.sangerTrace.baseCalls.length,
        score: read.sangerTrace.baseCalls.length * 2,
        secondBestScore: null,
        mappingMargin: null,
        alignedLength: read.sangerTrace.baseCalls.length,
        identity: 1,
        matches: read.sangerTrace.baseCalls.length,
        substitutions: 0,
        insertions: 0,
        deletions: 0,
        indelFraction: 0,
        coordinateMap: {
          columns: [],
          referencePositions: [],
          rawCallIndices: [],
        },
      },
    })),
    coverage: {
      depth: Array.from({ length: reference.sequence.length }, () => 1),
      forward: Array.from({ length: reference.sequence.length }, () => 1),
      reverse: Array.from({ length: reference.sequence.length }, () => 0),
      coveredBases: reference.sequence.length,
      basesMeetingMinDepth: reference.sequence.length,
      coveredFraction: 1,
      minimumDepth: 1,
      maximumDepth: 1,
      meanDepth: 1,
      requiredRegions: [{
        id: 'full-reference',
        name: 'Full predicted construct',
        start: 0,
        end: reference.sequence.length,
        wraps: false,
        length: reference.sequence.length,
        minDepth: request?.minDepth ?? 1,
        requireBothStrands: request?.requireBothStrands ?? false,
        coveredBases: reference.sequence.length,
        basesMeetingMinDepth: reference.sequence.length,
        coveredFraction: 1,
        minimumDepth: 1,
        maximumDepth: 1,
        meanDepth: 1,
        forwardCoveredBases: reference.sequence.length,
        reverseCoveredBases: 0,
        bothStrandsCoveredBases: 0,
        status: 'covered',
      }],
    },
    consensus: { sequence: reference.sequence, calls: [], variants: [] },
    variants: { observed: [], expected: [], unexpected: [], missingExpected: [] },
    provenance: {
      engine: 'motif-construct-verification',
      engineVersion: '1',
      referenceSha256: reference.sha256,
      readSha256s: reads.map((read) => read.sha256),
      requestSha256: 'f'.repeat(64),
      workUnits: 1_200,
      limits: ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS,
    },
  };
}

afterEach(cleanup);

describe('ClaudeScienceConstructVerificationWorkspace', () => {
  it('explains missing evidence and cannot run without an eligible trace-backed read', () => {
    const onVerify = vi.fn(verificationResult);
    render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[referenceRecord()]}
        onVerify={onVerify}
        onSave={vi.fn()}
        embedded
      />,
    );

    expect(screen.getByText(/No trace-backed DNA records are available/)).toBeTruthy();
    expect((screen.getByTestId('construct-verification-run') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('construct-verification-save') as HTMLButtonElement).disabled).toBe(true);
    expect(onVerify).not.toHaveBeenCalled();
  });

  it('never offers or accepts trace-backed records as predicted references', async () => {
    const user = userEvent.setup();
    const reference = referenceRecord();
    const readA = traceRecord('read-a');
    const readB = traceRecord('read-b');
    const onVerify = vi.fn((request: ClaudeScienceConstructVerificationRequest) => verificationResult(request));
    render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[readA, reference, readB]}
        initialReferenceId={readA.id}
        onVerify={onVerify}
        onSave={vi.fn()}
        embedded
      />,
    );

    const referenceSelect = screen.getByTestId('construct-verification-reference') as HTMLSelectElement;
    expect(referenceSelect.value).toBe(reference.id);
    expect(Array.from(referenceSelect.options).map((option) => option.value)).toEqual([reference.id]);

    fireEvent.change(referenceSelect, { target: { value: readB.id } });
    expect(referenceSelect.value).toBe(reference.id);
    await user.click(screen.getByTestId('construct-verification-run'));
    expect(onVerify).toHaveBeenCalledTimes(1);
    expect(onVerify.mock.calls[0][0].reference).toBe(reference);
    expect(onVerify.mock.calls[0][0].reads.map((read) => read.id)).toEqual([readA.id, readB.id]);
  });

  it('does not treat trace-only evidence as a predicted-reference candidate', () => {
    render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[traceRecord('read-a'), traceRecord('read-b')]}
        initialReferenceId="read-a"
        onVerify={vi.fn(verificationResult)}
        onSave={vi.fn()}
        embedded
      />,
    );

    const referenceSelect = screen.getByTestId('construct-verification-reference') as HTMLSelectElement;
    expect(referenceSelect.disabled).toBe(true);
    expect(Array.from(referenceSelect.options).map((option) => option.textContent)).toEqual([
      'No predicted DNA references',
    ]);
    expect((screen.getByTestId('construct-verification-run') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows every eligible read while letting any read replace a default selection at the run cap', async () => {
    const user = userEvent.setup();
    const reads = Array.from(
      { length: ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads + 1 },
      (_, index) => traceRecord(`read-${String(index + 1).padStart(3, '0')}`),
    );
    let capturedRequest: ClaudeScienceConstructVerificationRequest | undefined;
    render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[referenceRecord(), ...reads]}
        onVerify={(request) => {
          capturedRequest = request;
          return verificationResult(request);
        }}
        onSave={vi.fn()}
        embedded
      />,
    );

    const readList = screen.getByTestId('construct-verification-read-list');
    const checkboxes = within(readList).getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads + 1);
    expect(checkboxes.filter((checkbox) => checkbox.checked)).toHaveLength(
      ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads,
    );
    expect(screen.getByText(/96 of 97 reads selected · maximum 96 per run/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'First 96' }) as HTMLButtonElement).disabled).toBe(true);

    const firstRead = within(readList).getByLabelText(/Sanger read-001/) as HTMLInputElement;
    const alternativeRead = within(readList).getByLabelText(/Sanger read-097/) as HTMLInputElement;
    expect(alternativeRead.checked).toBe(false);
    expect(alternativeRead.disabled).toBe(true);
    expect(alternativeRead.title).toMatch(/Deselect another read/);

    await user.click(firstRead);
    expect(alternativeRead.disabled).toBe(false);
    await user.click(alternativeRead);
    expect(firstRead.checked).toBe(false);
    expect(firstRead.disabled).toBe(true);
    expect(alternativeRead.checked).toBe(true);

    await user.click(screen.getByTestId('construct-verification-run'));
    expect(capturedRequest?.reads).toHaveLength(ARTIFACT_CONSTRUCT_VERIFICATION_LIMITS.maxReads);
    expect(capturedRequest?.reads.some((read) => read.id === 'read-001')).toBe(false);
    expect(capturedRequest?.reads.some((read) => read.id === 'read-097')).toBe(true);
  });

  it('passes the exact ordered request and a deeply frozen evidence snapshot', async () => {
    const user = userEvent.setup();
    const reference = referenceRecord();
    const readB = traceRecord('read-b');
    const readA = traceRecord('read-a');
    let capturedRequest: ClaudeScienceConstructVerificationRequest | undefined;
    const onVerify = vi.fn((request: ClaudeScienceConstructVerificationRequest) => {
      capturedRequest = request;
      return verificationResult(request);
    });
    const onSave = vi.fn();

    render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[readB, reference, readA]}
        initialReferenceId={reference.id}
        onVerify={onVerify}
        onSave={onSave}
        embedded
      />,
    );

    expect((screen.getByTestId('construct-verification-reference') as HTMLSelectElement).value).toBe(reference.id);
    await user.tripleClick(screen.getByLabelText('Minimum read depth'));
    await user.keyboard('3');
    await user.click(screen.getByLabelText(/Require both strands/));
    await user.click(screen.getByTestId('construct-verification-run'));

    expect(onVerify).toHaveBeenCalledTimes(1);
    expect(capturedRequest).toEqual({
      reference,
      reads: [readB, readA],
      minDepth: 3,
      requireBothStrands: true,
    });
    expect(capturedRequest?.reference).toBe(reference);
    expect(capturedRequest?.reads[0]).toBe(readB);
    expect(capturedRequest?.reads[1]).toBe(readA);
    expect(Object.isFrozen(capturedRequest)).toBe(true);
    expect(Object.isFrozen(capturedRequest?.reads)).toBe(true);

    await user.click(screen.getByTestId('construct-verification-save'));
    const payload = onSave.mock.calls[0][0];
    expect(payload.snapshot).toEqual({
      reference: {
        id: reference.id,
        sequenceSha256: reference.sha256,
        topology: reference.topology,
      },
      reads: [{
        id: readB.id,
        sequenceSha256: readB.sha256,
        sangerEvidenceSha256: readB.sangerEvidenceSha256,
      }, {
        id: readA.id,
        sequenceSha256: readA.sha256,
        sangerEvidenceSha256: readA.sangerEvidenceSha256,
      }],
      minDepth: 3,
      requireBothStrands: true,
    });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen(payload.snapshot)).toBe(true);
    expect(Object.isFrozen(payload.snapshot.reference)).toBe(true);
    expect(Object.isFrozen(payload.snapshot.reads)).toBe(true);
    expect(Object.isFrozen(payload.snapshot.reads[0])).toBe(true);
  });

  it('clears a live result and disables Save when any acceptance control changes', async () => {
    const user = userEvent.setup();
    render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[referenceRecord(), traceRecord('read-a'), traceRecord('read-b')]}
        onVerify={(request) => verificationResult(request)}
        onSave={vi.fn()}
        embedded
      />,
    );

    await user.click(screen.getByTestId('construct-verification-run'));
    expect(screen.getByTestId('construct-verification-panel')).toBeTruthy();
    expect((screen.getByTestId('construct-verification-save') as HTMLButtonElement).disabled).toBe(false);

    await user.click(screen.getByLabelText(/Sanger read-a/));
    expect(screen.queryByTestId('construct-verification-panel')).toBeNull();
    expect(screen.getByTestId('construct-verification-awaiting')).toBeTruthy();
    expect((screen.getByTestId('construct-verification-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('construct-verification-status')).toBeNull();
  });

  it('saves the exact local result and the snapshot from that run', async () => {
    const user = userEvent.setup();
    const result = verificationResult();
    const onSave = vi.fn();
    render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[referenceRecord(), traceRecord('read-a')]}
        onVerify={() => result}
        onSave={onSave}
        embedded
      />,
    );

    expect((screen.getByTestId('construct-verification-save') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTestId('construct-verification-run'));
    await user.click(screen.getByTestId('construct-verification-save'));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].result).toBe(result);
    expect(onSave.mock.calls[0][0].snapshot.reads.map((read: { id: string }) => read.id)).toEqual(['read-a']);
    expect((screen.getByTestId('construct-verification-save') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Verification saved to Results/)).toBeTruthy();
  });

  it('renders callback failures as inert bounded text', async () => {
    const user = userEvent.setup();
    const malicious = '<img src=x onerror=alert(1)> evidence engine failed';
    const view = render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[referenceRecord(), traceRecord('read-a')]}
        onVerify={() => { throw new Error(malicious); }}
        onSave={vi.fn()}
        embedded
      />,
    );

    await user.click(screen.getByTestId('construct-verification-run'));
    expect(screen.getByRole('alert').textContent).toContain(malicious);
    expect(view.container.querySelector('img')).toBeNull();
    expect(screen.queryByTestId('construct-verification-panel')).toBeNull();
  });

  it('reconciles removed evidence and clears stale results when record props change', async () => {
    const user = userEvent.setup();
    const reference = referenceRecord();
    const readA = traceRecord('read-a');
    const readB = traceRecord('read-b');
    const view = render(
      <ClaudeScienceConstructVerificationWorkspace
        records={[reference, readA, readB]}
        onVerify={(request) => verificationResult(request)}
        onSave={vi.fn()}
        embedded
      />,
    );

    await user.click(screen.getByTestId('construct-verification-run'));
    expect(screen.getByTestId('construct-verification-panel')).toBeTruthy();

    view.rerender(
      <ClaudeScienceConstructVerificationWorkspace
        records={[reference, { ...readB, sha256: '9'.repeat(64) }]}
        onVerify={(request) => verificationResult(request)}
        onSave={vi.fn()}
        embedded
      />,
    );

    await waitFor(() => expect(screen.queryByTestId('construct-verification-panel')).toBeNull());
    const readList = screen.getByTestId('construct-verification-read-list');
    expect(within(readList).queryByLabelText(/Sanger read-a/)).toBeNull();
    expect((within(readList).getByLabelText(/Sanger read-b/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('construct-verification-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('never mutates frozen record, trace, or quality-score inputs', async () => {
    const user = userEvent.setup();
    const qualityScores = Object.freeze(Array.from({ length: 480 }, () => 35));
    const reference = Object.freeze(referenceRecord());
    const read = Object.freeze(traceRecord('read-a', {
      sangerTrace: Object.freeze({
        baseCalls: 'ACGT'.repeat(120),
        qualityScores,
      }),
    }));
    const records = Object.freeze([reference, read]);
    const before = JSON.stringify(records);

    render(
      <ClaudeScienceConstructVerificationWorkspace
        records={records}
        onVerify={(request) => verificationResult(request)}
        onSave={vi.fn()}
        embedded
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getByTestId('construct-verification-run'));
    expect(JSON.stringify(records)).toBe(before);
    expect(Object.isFrozen(qualityScores)).toBe(true);
  });
});
