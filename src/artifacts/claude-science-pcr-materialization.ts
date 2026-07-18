import {
  primerToFeature,
  type PrimerCandidate,
  type PrimerDesignParams,
  type PrimerPair,
} from '../bio/primer-design';
import { simulatePCR, type PCRResult } from '../bio/pcr';
import { reverseComplement } from '../bio/reverse-complement';
import type { Feature, Topology } from '../bio/types';
import type { ArtifactAnalysisResult } from './claude-science-analysis-results';
import { sha256HexSync } from './claude-science-sha256';
import type { ArtifactJsonObject } from './claude-science-workspace-collections';

const DNA_ALPHABET = /^[ACGT]+$/i;
const PCR_ENGINE_VERSION = '1';

export class PcrMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PcrMaterializationError';
  }
}

/** Structural subset of the standalone artifact's private record type. */
export type PcrMaterializationSourceRecord = {
  id: string;
  name: string;
  sequence: string;
  type: 'dna';
  topology: Topology;
  active: boolean;
  features?: readonly Feature[];
  description?: string;
  organism?: string;
  source?: string;
  group?: string;
  tags?: readonly string[];
};

export type PcrMaterializationSelection = {
  pair: PrimerPair;
  pairNumber: number;
  target: { start: number; end: number };
  parameters?: PrimerDesignParams;
};

export type PcrMaterializationIdentity = {
  recordId: string;
  resultId: string;
  productId: string;
  createdAt: string;
  recordName?: string;
};

export type PcrMaterializationPreparation = {
  requestSha256: string;
  actionId: string;
  actionKind: string;
  method: 'golden_gate' | 'gibson';
  orientation: 'forward' | 'reverse';
};

export type PcrDerivedRecordProvenance = ArtifactJsonObject & {
  source: 'motif-for-claude-science-artifact';
  operation: 'pcr_materialization';
  actor: 'user';
  engine: 'motif-pcr';
  engineVersion: typeof PCR_ENGINE_VERSION;
  parentRecordId: string;
  primerDesignResultId: string;
  templateSha256: string;
  productSha256: string;
  primerDesignSha256: string;
  materializationKey: string;
  wrapsOrigin: boolean;
};

/** Compatible with the artifact's private ArtifactRecordInput contract. */
export type PcrDerivedRecordInput = {
  id: string;
  name: string;
  description: string;
  molecule: 'dna';
  topology: 'linear';
  seq: string;
  length: number;
  annotations: Feature[];
  organism?: string;
  source: string;
  group?: string;
  dateAdded: string;
  tags?: string[];
  active: true;
  provenance: PcrDerivedRecordProvenance;
};

export type MaterializedPcrAmplicon = {
  record: PcrDerivedRecordInput;
  analysisResult: ArtifactAnalysisResult & { kind: 'pcr' };
  simulation: PCRResult;
  templateSha256: string;
  productSha256: string;
  primerDesignSha256: string;
  materializationKey: string;
};

export type ExistingPcrMaterializationRecord = {
  id: string;
  name: string;
  sequence: string;
  provenance?: Record<string, unknown>;
};

function validateExactPrimerCandidate(
  primer: PrimerCandidate,
  role: 'forward' | 'reverse',
): void {
  const label = role === 'forward' ? 'Forward' : 'Reverse';
  if (primer.direction !== role) {
    throw new PcrMaterializationError(`${label} primer direction does not match its selected-pair role.`);
  }
  if (
    !DNA_ALPHABET.test(primer.sequence)
    || !DNA_ALPHABET.test(primer.fullSequence)
    || (primer.tail.length > 0 && !DNA_ALPHABET.test(primer.tail))
  ) {
    throw new PcrMaterializationError(
      `${label} primer materialization requires unambiguous A/C/G/T binding and full sequences.`,
    );
  }
  if (primer.fullSequence.toUpperCase() !== `${primer.tail}${primer.sequence}`.toUpperCase()) {
    throw new PcrMaterializationError(
      `${label} primer fullSequence must equal its 5′ tail followed by its binding sequence.`,
    );
  }
  if (
    primer.length !== primer.sequence.length
    || primer.fullLength !== primer.fullSequence.length
    || primer.end - primer.start !== primer.sequence.length
  ) {
    throw new PcrMaterializationError(`${label} primer lengths do not match its sequence fields and binding range.`);
  }
}

function primerDesignIdentity(selection: PcrMaterializationSelection): string {
  const { forward, reverse } = selection.pair;
  return JSON.stringify([
    forward.fullSequence.toUpperCase(),
    forward.start,
    forward.end,
    reverse.fullSequence.toUpperCase(),
    reverse.start,
    reverse.end,
    selection.target.start,
    selection.target.end,
  ]);
}

export function createPcrMaterializationKey(
  templateSha256: string,
  primerDesignSha256: string,
  productSha256: string,
): string {
  return sha256HexSync(JSON.stringify([templateSha256, primerDesignSha256, productSha256]));
}

export function findPcrMaterializationDuplicate(
  records: readonly ExistingPcrMaterializationRecord[],
  materializationKey: string,
): ExistingPcrMaterializationRecord | null {
  return records.find((record) => {
    const provenance = record.provenance;
    if (
      provenance?.operation !== 'pcr_materialization'
      || provenance.materializationKey !== materializationKey
      || typeof provenance.templateSha256 !== 'string'
      || typeof provenance.primerDesignSha256 !== 'string'
      || typeof provenance.productSha256 !== 'string'
      || sha256HexSync(record.sequence) !== provenance.productSha256
    ) return false;
    return createPcrMaterializationKey(
      provenance.templateSha256,
      provenance.primerDesignSha256,
      provenance.productSha256,
    ) === materializationKey;
  }) ?? null;
}

export function simulateSelectedPrimerPair(
  sourceRecord: PcrMaterializationSourceRecord,
  selection: PcrMaterializationSelection,
): PCRResult {
  if (!sourceRecord.active) throw new PcrMaterializationError('PCR requires an active template record.');
  if (!sourceRecord.sequence || !DNA_ALPHABET.test(sourceRecord.sequence)) {
    throw new PcrMaterializationError('Exact PCR materialization requires an unambiguous A/C/G/T DNA template.');
  }
  validateExactPrimerCandidate(selection.pair.forward, 'forward');
  validateExactPrimerCandidate(selection.pair.reverse, 'reverse');
  const simulation = simulatePCR(
    sourceRecord.sequence,
    selection.pair.forward.fullSequence,
    selection.pair.reverse.fullSequence,
    [...(sourceRecord.features ?? [])],
    sourceRecord.topology,
    {
      forward: { start: selection.pair.forward.start, end: selection.pair.forward.end },
      reverse: { start: selection.pair.reverse.start, end: selection.pair.reverse.end },
    },
  );
  if (!simulation) {
    throw new PcrMaterializationError('The selected primer pair does not produce an exact amplicon on this template.');
  }
  return simulation;
}

function primerFeature(
  id: string,
  name: string,
  start: number,
  end: number,
  strand: 1 | -1,
  primer: PrimerCandidate,
  bindingSequence: string,
  tail: string,
  sourceStart: number,
  sourceEnd: number,
): Feature {
  const base = primerToFeature(primer, name);
  return {
    ...base,
    id,
    start,
    end,
    strand,
    metadata: {
      ...base.metadata,
      generatedBy: 'motif-pcr',
      primerSequence5to3: primer.fullSequence,
      productPlusStrandSequence: strand === 1
        ? primer.fullSequence
        : reverseComplement(primer.fullSequence),
      bindingSequence5to3: bindingSequence,
      tail5: tail,
      sourceBindStart: sourceStart,
      sourceBindEnd: sourceEnd,
    },
  };
}

function uniqueTags(tags: readonly string[] | undefined): string[] {
  const normalized = [...new Set(tags ?? [])];
  if (normalized.length < 100 && !normalized.includes('PCR amplicon')) normalized.push('PCR amplicon');
  return normalized;
}

export function materializePcrAmplicon(input: {
  sourceRecord: PcrMaterializationSourceRecord;
  selection: PcrMaterializationSelection;
  identity: PcrMaterializationIdentity;
  primerDesignResultId: string;
  preparation?: PcrMaterializationPreparation;
}): MaterializedPcrAmplicon {
  const { sourceRecord, selection, identity, primerDesignResultId, preparation } = input;
  const simulation = simulateSelectedPrimerPair(sourceRecord, selection);
  const templateSha256 = sha256HexSync(sourceRecord.sequence.toUpperCase());
  const productSha256 = sha256HexSync(simulation.product);
  const primerDesignSha256 = sha256HexSync(primerDesignIdentity(selection));
  const materializationKey = createPcrMaterializationKey(
    templateSha256,
    primerDesignSha256,
    productSha256,
  );
  const forwardEnd = selection.pair.forward.fullSequence.length;
  const reverseStart = simulation.product.length - selection.pair.reverse.fullSequence.length;
  if (reverseStart < 0 || forwardEnd > simulation.product.length) {
    throw new PcrMaterializationError('Primer annotations do not fit inside the simulated amplicon.');
  }
  const annotations = [
    ...simulation.features,
    primerFeature(
      `${identity.recordId}-primer-forward`,
      `PCR forward primer · pair ${selection.pairNumber}`,
      0,
      forwardEnd,
      1,
      selection.pair.forward,
      simulation.forward.bindingSequence,
      simulation.forward.tail,
      simulation.forward.bindStart,
      simulation.forward.bindEnd,
    ),
    primerFeature(
      `${identity.recordId}-primer-reverse`,
      `PCR reverse primer · pair ${selection.pairNumber}`,
      reverseStart,
      simulation.product.length,
      -1,
      selection.pair.reverse,
      simulation.reverse.bindingSequence,
      simulation.reverse.tail,
      simulation.reverse.bindStart,
      simulation.reverse.bindEnd,
    ),
  ];

  const recordName = (identity.recordName?.trim() || `${sourceRecord.name} · PCR amplicon`).slice(0, 1_024);
  const preparationMetadata: ArtifactJsonObject = {};
  if (preparation) {
    preparationMetadata.cloningPreparation = {
      requestSha256: preparation.requestSha256,
      actionId: preparation.actionId,
      actionKind: preparation.actionKind,
      method: preparation.method,
      orientation: preparation.orientation,
    };
  }
  const provenance: PcrDerivedRecordProvenance = {
    source: 'motif-for-claude-science-artifact',
    operation: 'pcr_materialization',
    actor: 'user',
    engine: 'motif-pcr',
    engineVersion: PCR_ENGINE_VERSION,
    parentRecordId: sourceRecord.id,
    primerDesignResultId,
    templateSha256,
    productSha256,
    primerDesignSha256,
    materializationKey,
    wrapsOrigin: simulation.wrapsOrigin,
    forwardPrimer5to3: selection.pair.forward.fullSequence,
    reversePrimer5to3: selection.pair.reverse.fullSequence,
    forwardBindStart: simulation.forward.bindStart,
    forwardBindEnd: simulation.forward.bindEnd,
    reverseBindStart: simulation.reverse.bindStart,
    reverseBindEnd: simulation.reverse.bindEnd,
    ...preparationMetadata,
  };
  const record: PcrDerivedRecordInput = {
    id: identity.recordId,
    name: recordName,
    description: `Exact in-silico PCR product from ${sourceRecord.name}; includes both 5′ primer tails.`,
    molecule: 'dna',
    topology: 'linear',
    seq: simulation.product,
    length: simulation.product.length,
    annotations,
    ...(sourceRecord.organism ? { organism: sourceRecord.organism } : {}),
    source: 'Motif PCR materialization',
    ...(sourceRecord.group ? { group: sourceRecord.group } : {}),
    dateAdded: identity.createdAt,
    tags: uniqueTags(sourceRecord.tags),
    active: true,
    provenance,
  };

  const analysisResult: ArtifactAnalysisResult & { kind: 'pcr' } = {
    id: identity.resultId,
    kind: 'pcr',
    name: `${sourceRecord.name} · PCR product`,
    status: 'complete',
    summary: `Created one exact ${simulation.product.length.toLocaleString()} bp linear amplicon record, including primer tails.`,
    inputRecordIds: [sourceRecord.id],
    inputSha256s: [templateSha256],
    dependsOnResultIds: [primerDesignResultId],
    assetIds: [],
    parameters: {
      forwardPrimer: selection.pair.forward.fullSequence,
      reversePrimer: selection.pair.reverse.fullSequence,
      forwardBindingStart: simulation.forward.bindStart,
      forwardBindingEnd: simulation.forward.bindEnd,
      reverseBindingStart: simulation.reverse.bindStart,
      reverseBindingEnd: simulation.reverse.bindEnd,
      topology: sourceRecord.topology,
      primerDesignSha256,
      materializationKey,
    },
    data: {
      templateRecordId: sourceRecord.id,
      primerDesignResultId,
      products: [{
        id: identity.productId,
        lengthBp: simulation.product.length,
        recordId: identity.recordId,
        ...(!simulation.wrapsOrigin ? {
          templateRange: {
            start: simulation.forward.bindStart,
            end: simulation.reverse.bindEnd,
          },
        } : {}),
      }],
    },
    createdAt: identity.createdAt,
    provenance: {
      source: 'motif-for-claude-science-artifact',
      operation: 'pcr_materialization',
      actor: 'user',
      engine: 'motif-pcr',
      engineVersion: PCR_ENGINE_VERSION,
      parentIds: [sourceRecord.id, primerDesignResultId],
      metadata: {
        templateSha256,
        productSha256,
        primerDesignSha256,
        materializationKey,
        wrapsOrigin: simulation.wrapsOrigin,
        ...preparationMetadata,
      },
    },
  };

  return {
    record,
    analysisResult,
    simulation,
    templateSha256,
    productSha256,
    primerDesignSha256,
    materializationKey,
  };
}
