import { getTranslationTable } from './codon-tables';
import { resolveFeatureColor } from './feature-palette';
import { findORFs } from './orf-detection';
import type { Feature, SequenceType, Topology } from './types';

export const PROPOSED_ANNOTATION_CAPS = Object.freeze({
  maxAnnotations: 8,
  maxSequenceResidues: 100_000,
  maxScanWorkUnits: 200_000,
  minOrfAminoAcids: 50,
});

export const MOTIF_PROPOSAL_METADATA_KEY = 'motifProposal';

export type ProposedAnnotationRecord = {
  sequence: string;
  type: SequenceType;
  topology: Topology;
  translationTableId?: number;
  features: readonly Feature[];
  proposeAnnotations?: boolean;
};

export type ProposedAnnotationResult = {
  features: Feature[];
  status: 'proposed' | 'skipped';
  reason: 'ready' | 'caller_opt_out' | 'explicit_features' | 'unsupported_molecule' | 'ambiguous_sequence' | 'sequence_limit' | 'no_complete_orfs';
  workUnits: number;
  capped: boolean;
};

type ProposalMetadata = {
  status: 'proposed' | 'accepted';
  proposedBy: 'motif-auto-annotation';
  detector: 'motif-orf-detection';
  detectorVersion: 1;
  reason: string;
  evidence: {
    frame: 1 | 2 | 3;
    strand: 1 | -1;
    aminoAcids: number;
    startCodon: string;
    stopCodon: string;
    translationTableId: number;
  };
};

function proposalMetadata(feature: Pick<Feature, 'metadata'>): ProposalMetadata | null {
  const value = feature.metadata[MOTIF_PROPOSAL_METADATA_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proposal = value as Partial<ProposalMetadata>;
  return proposal.proposedBy === 'motif-auto-annotation'
    && proposal.detector === 'motif-orf-detection'
    && (proposal.status === 'proposed' || proposal.status === 'accepted')
    ? proposal as ProposalMetadata
    : null;
}

export function isProposedAnnotation(feature: Pick<Feature, 'metadata'>): boolean {
  return proposalMetadata(feature)?.status === 'proposed';
}

export function acceptProposedAnnotation(feature: Feature): Feature {
  const proposal = proposalMetadata(feature);
  if (!proposal || proposal.status !== 'proposed') return feature;
  return {
    ...feature,
    name: feature.name.replace(/^Proposed\s+/u, ''),
    metadata: {
      ...feature.metadata,
      [MOTIF_PROPOSAL_METADATA_KEY]: { ...proposal, status: 'accepted' },
    },
  };
}

/**
 * Reuse the bounded ORF detector to suggest only complete, non-wrapping ORFs.
 * The caller schedules this pure pass after paint and owns durable accept /
 * dismiss state; this function never mutates the supplied record.
 */
export function proposeDefaultAnnotations(record: ProposedAnnotationRecord): ProposedAnnotationResult {
  if (record.proposeAnnotations === false) {
    return { features: [], status: 'skipped', reason: 'caller_opt_out', workUnits: 0, capped: false };
  }
  if (record.features.length > 0) {
    return { features: [], status: 'skipped', reason: 'explicit_features', workUnits: 0, capped: false };
  }
  if (record.type !== 'dna' && record.type !== 'rna') {
    return { features: [], status: 'skipped', reason: 'unsupported_molecule', workUnits: 0, capped: false };
  }
  const sequenceLength = record.sequence.length;
  if (sequenceLength > PROPOSED_ANNOTATION_CAPS.maxSequenceResidues) {
    return { features: [], status: 'skipped', reason: 'sequence_limit', workUnits: 0, capped: false };
  }

  // findORFs preserves IUPAC ambiguity and emits per-candidate warnings. That
  // is valuable interactively, but a dense ambiguous sequence can make warning
  // construction exceed a linear background-pass budget. Leave such records
  // bare for explicit review instead of pretending the proactive pass is cheap.
  if (/[^ACGTU]/iu.test(record.sequence)) {
    return { features: [], status: 'skipped', reason: 'ambiguous_sequence', workUnits: 0, capped: false };
  }

  const workUnits = sequenceLength * (record.topology === 'circular' ? 4 : 2);
  if (workUnits > PROPOSED_ANNOTATION_CAPS.maxScanWorkUnits) {
    return { features: [], status: 'skipped', reason: 'sequence_limit', workUnits: 0, capped: false };
  }
  const table = getTranslationTable(record.translationTableId);
  const candidates = findORFs(
    record.sequence,
    PROPOSED_ANNOTATION_CAPS.minOrfAminoAcids,
    table,
    { topology: record.topology },
  ).filter((orf) => (
    orf.status === 'complete'
    && orf.start >= 0
    && orf.end <= sequenceLength
  ));
  const selected = candidates.slice(0, PROPOSED_ANNOTATION_CAPS.maxAnnotations);
  const features = selected.map<Feature>((orf, index) => {
    const direction = orf.strand === 1 ? '+' : '−';
    const name = `Proposed ORF ${direction}${orf.frame} · ${orf.aminoAcids} aa`;
    const feature: Feature = {
      id: `proposed-orf-${orf.strand === 1 ? 'f' : 'r'}-${orf.start}-${orf.end}-${index + 1}`,
      name,
      type: 'orf',
      start: orf.start,
      end: orf.end,
      strand: orf.strand,
      color: '',
      metadata: {
        [MOTIF_PROPOSAL_METADATA_KEY]: {
          status: 'proposed',
          proposedBy: 'motif-auto-annotation',
          detector: 'motif-orf-detection',
          detectorVersion: 1,
          reason: `Complete ORF of at least ${PROPOSED_ANNOTATION_CAPS.minOrfAminoAcids} amino acids detected on the ${orf.strand === 1 ? 'forward' : 'reverse'} strand.`,
          evidence: {
            frame: orf.frame,
            strand: orf.strand,
            aminoAcids: orf.aminoAcids,
            startCodon: orf.startCodon,
            stopCodon: orf.stopCodon,
            translationTableId: table.id,
          },
        } satisfies ProposalMetadata,
      },
    };
    return { ...feature, color: resolveFeatureColor(feature) };
  });

  return {
    features,
    status: features.length > 0 ? 'proposed' : 'skipped',
    reason: features.length > 0 ? 'ready' : 'no_complete_orfs',
    workUnits,
    capped: candidates.length > features.length,
  };
}
