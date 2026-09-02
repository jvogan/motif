import { describe, expect, it } from 'vitest';

import {
  acceptProposedAnnotation,
  isProposedAnnotation,
  PROPOSED_ANNOTATION_CAPS,
  proposeDefaultAnnotations,
} from '../proposed-annotations';
import type { Feature } from '../types';

const completeOrf = `ATG${'AAA'.repeat(PROPOSED_ANNOTATION_CAPS.minOrfAminoAcids)}TAA`;

function emptyDna(overrides: Partial<Parameters<typeof proposeDefaultAnnotations>[0]> = {}) {
  return {
    sequence: completeOrf,
    type: 'dna' as const,
    topology: 'linear' as const,
    features: [] as Feature[],
    ...overrides,
  };
}

describe('proactive default annotations', () => {
  it('honors an explicit caller opt-out', () => {
    const result = proposeDefaultAnnotations(emptyDna({ proposeAnnotations: false }));
    expect(result).toMatchObject({ status: 'skipped', reason: 'caller_opt_out', features: [], workUnits: 0 });
  });

  it('does not propose onto a record that already carries a feature', () => {
    const supplied: Feature = {
      id: 'caller-feature',
      name: 'caller feature',
      type: 'gene',
      start: 0,
      end: 3,
      strand: 1,
      color: '#123456',
      metadata: {},
    };
    const result = proposeDefaultAnnotations(emptyDna({ features: [supplied] }));
    expect(result).toMatchObject({ status: 'skipped', reason: 'explicit_features', features: [], workUnits: 0 });
  });

  it('marks proposals with review provenance and supports acceptance', () => {
    const result = proposeDefaultAnnotations(emptyDna());
    expect(result.features.length).toBeGreaterThan(0);
    const feature = result.features[0];
    expect(isProposedAnnotation(feature)).toBe(true);
    expect(feature.metadata.motifProposal).toMatchObject({
      status: 'proposed',
      proposedBy: 'motif-auto-annotation',
      detector: 'motif-orf-detection',
      reason: expect.stringContaining('Complete ORF'),
    });
    const accepted = acceptProposedAnnotation(feature);
    expect(isProposedAnnotation(accepted)).toBe(false);
    expect(accepted.name).not.toMatch(/^Proposed\s/u);
    expect(accepted.metadata.motifProposal).toMatchObject({ status: 'accepted' });
  });

  it('preserves RNA codon spelling in proposal evidence', () => {
    const result = proposeDefaultAnnotations(emptyDna({
      sequence: completeOrf.replaceAll('T', 'U'),
      type: 'rna',
    }));

    expect(result.features).toHaveLength(1);
    expect(result.features[0].metadata.motifProposal).toMatchObject({
      evidence: {
        startCodon: 'AUG',
        stopCodon: 'UAA',
      },
    });
  });

  it('enforces annotation-count and work caps', () => {
    const result = proposeDefaultAnnotations(emptyDna({
      sequence: completeOrf.repeat(PROPOSED_ANNOTATION_CAPS.maxAnnotations + 4),
    }));
    expect(result.features).toHaveLength(PROPOSED_ANNOTATION_CAPS.maxAnnotations);
    expect(result.capped).toBe(true);
    expect(result.workUnits).toBeLessThanOrEqual(PROPOSED_ANNOTATION_CAPS.maxScanWorkUnits);

    const oversized = proposeDefaultAnnotations(emptyDna({
      sequence: 'A'.repeat(PROPOSED_ANNOTATION_CAPS.maxSequenceResidues + 1),
    }));
    expect(oversized).toMatchObject({ status: 'skipped', reason: 'sequence_limit', features: [], workUnits: 0 });
  });
});
