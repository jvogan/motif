/** @vitest-environment jsdom */

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QuickFeatureEditor,
  createArtifactDatabaseSnapshot,
  deleteArtifactFeature,
  normalizeRecord,
  prepareArtifactDatabaseRestore,
  prepareInventoryReplacement,
} from '../motif-artifact';

afterEach(() => cleanup());

const artifactState: Parameters<typeof createArtifactDatabaseSnapshot>[1] = {
  customEnzymes: [],
  translationLayersByRecord: {},
  enzymeSourcesByRecord: {},
  hiddenEnzymesByRecord: {},
  hiddenFeatureTranslationsByRecord: {},
  restrictionLabelsByRecord: {},
  motifsByRecord: {},
};

function proposalMetadata(status: 'proposed' | 'accepted' = 'proposed') {
  return {
    status,
    proposedBy: 'motif-auto-annotation',
    detector: 'motif-orf-detection',
    detectorVersion: 1,
    reason: 'A complete local ORF was found.',
    evidence: {
      frame: 1,
      strand: 1,
      aminoAcids: 29,
      startCodon: 'ATG',
      stopCodon: 'TAA',
      translationTableId: 1,
    },
  };
}

function proposedRecord(includeManualFeature = false) {
  const record = normalizeRecord({
    id: 'proposal-delete',
    name: 'Proposal deletion fixture',
    type: 'dna',
    sequence: `${'ATG'.repeat(29)}TAA`,
    features: [
      {
        id: 'proposed-orf',
        name: 'Proposed ORF',
        type: 'cds',
        start: 0,
        end: 90,
        strand: 1,
        metadata: { motifProposal: proposalMetadata() },
      },
      ...(includeManualFeature ? [{
        id: 'manual-feature',
        name: 'Manual feature',
        type: 'misc_feature' as const,
        start: 2,
        end: 8,
        strand: 1 as const,
      }] : []),
    ],
    provenance: {
      motifAutoAnnotation: {
        status: 'review_required',
        proposedBy: 'motif-auto-annotation',
        proposedCount: 1,
        pendingCount: 1,
        acceptedCount: 0,
        dismissedCount: 0,
      },
    },
  }, 0, false);
  if (!record) throw new Error('proposal deletion fixture did not normalize');
  return record;
}

function ProposedFeatureDeleteHarness({ onRecord }: { onRecord: (record: ReturnType<typeof proposedRecord>) => void }) {
  const [record, setRecord] = useState(() => proposedRecord());
  const [selectedId, setSelectedId] = useState('proposed-orf');
  const selectedFeature = record.features.find((feature) => feature.id === selectedId) ?? null;
  onRecord(record);

  return (
    <QuickFeatureEditor
      sequenceLength={record.sequence.length}
      sequenceType={record.type}
      topology={record.topology}
      recordTranslationTableId={record.translationTableId}
      featureCount={record.features.length}
      selectedFeature={selectedFeature}
      selectedMapRange={null}
      motifLength={0}
      onAddFeature={vi.fn()}
      onUpdateFeature={vi.fn()}
      onDeleteFeature={(featureId) => {
        setRecord((current) => deleteArtifactFeature(current, featureId));
        setSelectedId((current) => current === featureId ? '' : current);
      }}
      onAcceptProposedFeature={vi.fn()}
      onDismissProposedFeature={vi.fn()}
      onCreateRecord={vi.fn()}
    />
  );
}

describe('proposed feature deletion', () => {
  it('treats selected generic Delete as a dismissal and exports a completed checkpoint', async () => {
    let latestRecord = proposedRecord();
    render(<ProposedFeatureDeleteHarness onRecord={(record) => { latestRecord = record; }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected feature' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete selected feature' }));

    await waitFor(() => expect(latestRecord.features).toEqual([]));
    expect(screen.queryByTestId('proposed-annotation-review')).toBeNull();

    const basePayload = prepareInventoryReplacement([{ id: latestRecord.id, type: 'dna', sequence: latestRecord.sequence }], latestRecord.id, false);
    const checkpoint = createArtifactDatabaseSnapshot({ ...basePayload, records: [latestRecord] }, artifactState);
    const restored = prepareArtifactDatabaseRestore(JSON.parse(JSON.stringify(checkpoint))).payload.records[0];

    expect(restored.features).toEqual([]);
    expect(restored.provenance).toMatchObject({
      motifAutoAnnotation: {
        status: 'review_complete',
        pendingCount: 0,
        acceptedCount: 0,
        dismissedCount: 1,
      },
    });
  });

  it('keeps ordinary feature deletion immutable while preserving the pending review summary', () => {
    const before = proposedRecord(true);
    const after = deleteArtifactFeature(before, 'manual-feature');

    expect(after.features.map((feature) => feature.id)).toEqual(['proposed-orf']);
    expect(after.provenance).toMatchObject({
      motifAutoAnnotation: {
        status: 'review_required',
        pendingCount: 1,
        acceptedCount: 0,
        dismissedCount: 0,
      },
    });
    // History/undo callers retain the untouched record they captured before a
    // generic feature deletion.
    expect(before.features.map((feature) => feature.id)).toEqual(['proposed-orf', 'manual-feature']);
  });
});
