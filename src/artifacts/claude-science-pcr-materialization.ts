import {
  designPrimerPairWithDiagnostics,
  normalizePrimerDesignParams,
  primerToFeature,
  type PrimerCandidate,
  type PrimerDesignParams,
  type PrimerPair,
  type PrimerTmEvidence,
} from '../bio/primer-design';
import {
  DEFAULT_MAX_DIMER_DG,
  predictHairpin,
  predictPrimerDimer,
  predictSelfDimer,
} from '../bio/primer-thermodynamics';
import { PCR_ENGINE_VERSION, simulatePCR, type PCRResult } from '../bio/pcr';
import { reverseComplement } from '../bio/reverse-complement';
import type { Feature, Topology } from '../bio/types';
import type { ArtifactAnalysisResult } from './claude-science-analysis-results';
import { sha256HexSync } from './claude-science-sha256';
import type { ArtifactJsonObject } from './claude-science-workspace-collections';

const DNA_ALPHABET = /^[ACGT]+$/i;
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
  translationTableId?: number;
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
  /** Exact Tm calculator model, engine, version, and conditions used. */
  tmEvidence?: ArtifactJsonObject;
  /** Explicit review receipt for any ambiguous or work-limited evidence. */
  evidenceReview?: ArtifactJsonObject;
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
  /** Product construction method copied from the simulation receipt. */
  productAssembly: PCRResult['provenance']['productAssembly'];
  parentRecordId: string;
  primerDesignResultId: string;
  templateSha256: string;
  productSha256: string;
  primerDesignSha256: string;
  materializationKey: string;
  wrapsOrigin: boolean;
  translationTableId?: number;
  tmEvidence?: ArtifactJsonObject;
  evidenceReview?: ArtifactJsonObject;
};

/** Compatible with the artifact's private ArtifactRecordInput contract. */
export type PcrDerivedRecordInput = {
  id: string;
  name: string;
  description: string;
  molecule: 'dna';
  topology: 'linear';
  translationTableId?: number;
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
    selection.parameters ?? null,
  ]);
}

const REVIEW_SCHEMA = 'motif.primer.evidence-review.v1' as const;
const ACKNOWLEDGMENT_SCHEMA = 'motif.primer.evidence-acknowledgment.v1' as const;
const MAX_EVIDENCE_REVIEW_KEYS = 5;
const MAX_EVIDENCE_REVIEW_REASON_CODES = 64;

const EVIDENCE_REVIEW_KEYS = new Set([
  'schema',
  'required',
  'acknowledged',
  'reasonCodes',
  'acknowledgedAt',
]);

const MISSING_OWN_DATA_PROPERTY = Symbol('missing-own-data-property');
const INVALID_OWN_DATA_PROPERTY = Symbol('invalid-own-data-property');

function isPlainEvidenceReviewObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownEvidenceReviewDataProperty(
  value: object,
  key: string,
): unknown | typeof MISSING_OWN_DATA_PROPERTY | typeof INVALID_OWN_DATA_PROPERTY {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return MISSING_OWN_DATA_PROPERTY;
    return Object.hasOwn(descriptor, 'value') ? descriptor.value : INVALID_OWN_DATA_PROPERTY;
  } catch {
    return INVALID_OWN_DATA_PROPERTY;
  }
}

/**
 * Snapshot the small review receipt without allocating an unbounded key list.
 * A bounded for-in walk lets ordinary objects stop at the first excess
 * enumerable field; known non-enumerable fields are read by descriptor without
 * invoking accessors. Proxy traps can still throw, so callers receive a typed
 * materialization error rather than a raw exception.
 */
function boundedEvidenceReviewFields(assertion: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  let enumerableOwnKeyCount = 0;
  try {
    for (const key in assertion) {
      const descriptor = Object.getOwnPropertyDescriptor(assertion, key);
      if (!descriptor) continue;
      enumerableOwnKeyCount += 1;
      if (enumerableOwnKeyCount > MAX_EVIDENCE_REVIEW_KEYS) {
        throw new PcrMaterializationError('Evidence review contains too many fields.');
      }
      if (!EVIDENCE_REVIEW_KEYS.has(key)) {
        throw new PcrMaterializationError('Evidence review contains an unknown field.');
      }
      if (!Object.hasOwn(descriptor, 'value')) {
        throw new PcrMaterializationError('Evidence review fields must be own data properties.');
      }
      fields[key] = descriptor.value;
    }

    // A receipt normally arrives as JSON, but inspect the known keys directly
    // so non-enumerable inputs cannot hide accessor fields or alter semantics.
    for (const key of EVIDENCE_REVIEW_KEYS) {
      if (Object.hasOwn(fields, key)) continue;
      const value = ownEvidenceReviewDataProperty(assertion, key);
      if (value === MISSING_OWN_DATA_PROPERTY) continue;
      if (value === INVALID_OWN_DATA_PROPERTY) {
        throw new PcrMaterializationError('Evidence review fields must be own data properties.');
      }
      fields[key] = value;
    }
  } catch (error) {
    if (error instanceof PcrMaterializationError) throw error;
    throw new PcrMaterializationError('Evidence review could not be inspected safely.');
  }
  return fields;
}

function boundedEvidenceReasonCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const lengthValue = ownEvidenceReviewDataProperty(value, 'length');
  if (lengthValue === MISSING_OWN_DATA_PROPERTY || lengthValue === INVALID_OWN_DATA_PROPERTY) return null;
  if (typeof lengthValue !== 'number' || !Number.isSafeInteger(lengthValue) || lengthValue > MAX_EVIDENCE_REVIEW_REASON_CODES) return null;
  const reasonCodes: string[] = [];
  for (let index = 0; index < lengthValue; index += 1) {
    const item = ownEvidenceReviewDataProperty(value, String(index));
    if (item === MISSING_OWN_DATA_PROPERTY || item === INVALID_OWN_DATA_PROPERTY) return null;
    if (typeof item !== 'string' || item.length === 0 || item.length > 64) return null;
    reasonCodes.push(item);
  }
  return reasonCodes;
}

function derivedTmEvidence(
  sourceRecord: PcrMaterializationSourceRecord,
  selection: PcrMaterializationSelection,
): PrimerTmEvidence | null {
  if (!selection.parameters) {
    if (selection.tmEvidence) {
      throw new PcrMaterializationError('Tm evidence requires normalized primer-design parameters.');
    }
    return null;
  }
  const forward = normalizePrimerDesignParams(sourceRecord.sequence.length, selection.parameters, 'forward');
  const reverse = normalizePrimerDesignParams(sourceRecord.sequence.length, selection.parameters, 'reverse');
  if (!forward || !reverse || JSON.stringify(forward.tmEvidence) !== JSON.stringify(reverse.tmEvidence)) {
    throw new PcrMaterializationError('Primer-design parameters do not produce valid, consistent Tm evidence.');
  }
  return forward.tmEvidence;
}

function derivedEvidenceReview(
  sourceRecord: PcrMaterializationSourceRecord,
  selection: PcrMaterializationSelection,
): ArtifactJsonObject {
  const diagnostics = [
    predictHairpin(selection.pair.forward.fullSequence),
    predictHairpin(selection.pair.reverse.fullSequence),
    predictSelfDimer(selection.pair.forward.fullSequence),
    predictSelfDimer(selection.pair.reverse.fullSequence),
  ];
  const crossDimer = predictPrimerDimer(
    selection.pair.forward.fullSequence,
    selection.pair.reverse.fullSequence,
  );
  const reasonCodes: string[] = [];
  if (crossDimer.status === 'exact' && crossDimer.deltaG < DEFAULT_MAX_DIMER_DG) reasonCodes.push('cross-dimer-cutoff');
  if (crossDimer.threePrimeParticipation !== 'none') reasonCodes.push('cross-dimer-3-prime');
  if (crossDimer.status === 'ambiguous') reasonCodes.push('cross-dimer-ambiguous');
  if (crossDimer.status === 'work-limit') reasonCodes.push('cross-dimer-work-limit');
  if (diagnostics.some((diagnostic) => diagnostic.status === 'ambiguous')) reasonCodes.push('secondary-structure-ambiguous');
  if (diagnostics.some((diagnostic) => diagnostic.status === 'work-limit')) reasonCodes.push('secondary-structure-work-limit');

  if (selection.parameters) {
    const design = designPrimerPairWithDiagnostics(
      sourceRecord.sequence,
      selection.parameters,
    );
    const selectedPairWasRecomputed = design.pairs.some((pair) => (
      pair.forward.start === selection.pair.forward.start
      && pair.forward.end === selection.pair.forward.end
      && pair.forward.fullSequence.toUpperCase() === selection.pair.forward.fullSequence.toUpperCase()
      && pair.reverse.start === selection.pair.reverse.start
      && pair.reverse.end === selection.pair.reverse.end
      && pair.reverse.fullSequence.toUpperCase() === selection.pair.reverse.fullSequence.toUpperCase()
    ));
    if (!selectedPairWasRecomputed) {
      throw new PcrMaterializationError('Selected primer pair is not present in the bounded recomputed design result.');
    }
    if ((design.warnings ?? []).some((warning) => /work units|incomplete|not exhaustive/iu.test(warning))) {
      reasonCodes.push('search-evidence-incomplete');
    }
  }

  const assertion = selection.evidenceReview;
  let reviewAcknowledged = false;
  let reviewAcknowledgedAt: unknown;
  if (assertion !== undefined) {
    if (!isPlainEvidenceReviewObject(assertion)) {
      throw new PcrMaterializationError('Evidence review must be a versioned plain-object assertion.');
    }
    const fields = boundedEvidenceReviewFields(assertion);
    const schema = fields.schema;
    const required = fields.required;
    const acknowledged = fields.acknowledged;
    const suppliedReasonCodes = boundedEvidenceReasonCodes(fields.reasonCodes);
    if (
      schema !== REVIEW_SCHEMA
      || typeof required !== 'boolean'
      || typeof acknowledged !== 'boolean'
      || suppliedReasonCodes === null
    ) {
      throw new PcrMaterializationError('Evidence review does not match motif.primer.evidence-review.v1.');
    }
    reviewAcknowledged = acknowledged;
    reviewAcknowledgedAt = fields.acknowledgedAt;
  }
  if (!reviewAcknowledged && reviewAcknowledgedAt !== undefined) {
    throw new PcrMaterializationError('Evidence acknowledgment timestamp is allowed only when the review is acknowledged.');
  }
  if (reviewAcknowledged && (
    typeof reviewAcknowledgedAt !== 'string'
    || !Number.isFinite(Date.parse(reviewAcknowledgedAt))
    || new Date(reviewAcknowledgedAt).toISOString() !== reviewAcknowledgedAt
  )) {
    throw new PcrMaterializationError('Evidence acknowledgment requires a valid timestamp.');
  }
  if (reasonCodes.length > 0 && !reviewAcknowledged) {
    throw new PcrMaterializationError('Selected primer evidence requires an explicit acknowledgment before materialization.');
  }
  return {
    schema: REVIEW_SCHEMA,
    required: reasonCodes.length > 0,
    reasonCodes,
    assertion: {
      schema: ACKNOWLEDGMENT_SCHEMA,
      acknowledged: reviewAcknowledged,
      ...(reviewAcknowledged ? { acknowledgedAt: reviewAcknowledgedAt as string } : {}),
    },
  };
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
  if (!simulation.materializable) {
    throw new PcrMaterializationError('The selected primer pair has conflicting overlapping edits and cannot be materialized safely.');
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
  const tmEvidence = derivedTmEvidence(sourceRecord, selection);
  const evidenceReview = derivedEvidenceReview(sourceRecord, selection);
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
    engineVersion: simulation.provenance.engineVersion,
    productAssembly: simulation.provenance.productAssembly,
    parentRecordId: sourceRecord.id,
    primerDesignResultId,
    templateSha256,
    productSha256,
    primerDesignSha256,
    materializationKey,
    wrapsOrigin: simulation.wrapsOrigin,
    ...(sourceRecord.translationTableId === undefined ? {} : { translationTableId: sourceRecord.translationTableId }),
    forwardPrimer5to3: selection.pair.forward.fullSequence,
    reversePrimer5to3: selection.pair.reverse.fullSequence,
    forwardBindStart: simulation.forward.bindStart,
    forwardBindEnd: simulation.forward.bindEnd,
    reverseBindStart: simulation.reverse.bindStart,
    reverseBindEnd: simulation.reverse.bindEnd,
    ...(tmEvidence ? { tmEvidence: tmEvidence as unknown as ArtifactJsonObject } : {}),
    evidenceReview,
    ...preparationMetadata,
    metadata: {
      productAssembly: simulation.provenance.productAssembly,
      tailPolicy: simulation.provenance.tailPolicy,
      implicitTails: simulation.provenance.implicitTails,
      ...(tmEvidence ? { tmEvidence: tmEvidence as unknown as ArtifactJsonObject } : {}),
      evidenceReview,
    },
  };
  const record: PcrDerivedRecordInput = {
    id: identity.recordId,
    name: recordName,
    description: `Exact in-silico PCR product from ${sourceRecord.name}; includes both 5′ primer tails.`,
    molecule: 'dna',
    topology: 'linear',
    ...(sourceRecord.translationTableId === undefined ? {} : { translationTableId: sourceRecord.translationTableId }),
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
      ...(tmEvidence ? { tmEvidence: tmEvidence as unknown as ArtifactJsonObject } : {}),
      evidenceReview,
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
      engineVersion: simulation.provenance.engineVersion,
      parentIds: [sourceRecord.id, primerDesignResultId],
      metadata: {
        templateSha256,
        productSha256,
        primerDesignSha256,
        materializationKey,
        wrapsOrigin: simulation.wrapsOrigin,
        productAssembly: simulation.provenance.productAssembly,
        tailPolicy: simulation.provenance.tailPolicy,
        implicitTails: simulation.provenance.implicitTails,
        ...(tmEvidence ? { tmEvidence: tmEvidence as unknown as ArtifactJsonObject } : {}),
        evidenceReview,
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
