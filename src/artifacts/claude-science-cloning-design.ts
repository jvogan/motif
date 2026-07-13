import {
  GOLDEN_GATE_ENZYME_NAMES,
  getGoldenGatePartBoundary,
  goldenGateAssemble,
  type GoldenGateEnzymeName,
} from '../bio/golden-gate';
import {
  buildGoldenGateOrganizationPlan,
  type GoldenGateOrganizationMode,
} from '../bio/golden-braid';
import {
  checkPartAgainstKit,
  getGoldenGateKit,
  type GoldenGateKit,
} from '../bio/golden-gate-kits';
import { findOverlap, gibsonAssemble } from '../bio/gibson-assembly';
import { reverseComplement } from '../bio/reverse-complement';
import { sha256HexSync } from './claude-science-sha256';

/**
 * Store-free cloning adapters for the standalone Claude Science artifact.
 *
 * These adapters deliberately expose deterministic, serializable plans rather
 * than the bio engines' UI/store-oriented feature objects. Every accepted
 * sequence is normalized once, hashed, and represented in `provenance`, so a
 * later save/review surface can detect stale inputs before materializing a
 * product. No ids, timestamps, or optimistic biological claims are invented.
 */

export const MAX_ARTIFACT_CLONING_INPUTS = 10;
export const MAX_ARTIFACT_CLONING_SEQUENCE_LENGTH = 250_000;
export const MAX_ARTIFACT_CLONING_PRODUCT_LENGTH = 250_000;
export const ARTIFACT_CLONING_ADAPTER_VERSION = 3 as const;

const MAX_ID_LENGTH = 160;
const MAX_NAME_LENGTH = 256;
const DNA_PATTERN = /^[ACGTRYSWKMBDHVN]+$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const ORGANIZATION_MODES: readonly GoldenGateOrganizationMode[] = [
  'freeform',
  'golden_braid_tu',
  'golden_braid_binary',
];

export type ArtifactCloningIssueSeverity = 'error' | 'warning';

export type ArtifactCloningIssue = {
  code: string;
  message: string;
  severity: ArtifactCloningIssueSeverity;
  recordId?: string;
  junctionIndex?: number;
};

export type ArtifactCloningInput = {
  recordId: string;
  name: string;
  sequence: string;
  molecule: 'dna';
  /**
   * Orientation applied after validating `sha256` against the normalized source
   * record. Omitted legacy inputs remain forward for compatibility.
   */
  orientation?: 'forward' | 'reverse';
  /** Optional digest of the normalized source record, never the oriented copy. */
  sha256?: string;
};

export type ArtifactGoldenBraidLevel = 'entry' | 'alpha' | 'omega';
export type ArtifactGoldenBraidDirection = 'alpha_to_omega' | 'omega_to_alpha';
export type ArtifactGoldenBraidPartRole = 'source_module' | 'destination_vector';
export type ArtifactGoldenBraidSlot = '1' | '2' | '1R' | '2R';

/**
 * GoldenBraid recursive assembly requires identity that bare DNA cannot prove:
 * two source-level modules and the opposite-level destination vector. These
 * fields are intentionally explicit so a compatible overhang chain alone is
 * never presented as a validated GoldenBraid product.
 */
export type ArtifactGoldenGatePartInput = ArtifactCloningInput & {
  goldenBraidLevel?: ArtifactGoldenBraidLevel;
  goldenBraidRole?: ArtifactGoldenBraidPartRole;
  /** Complementary pDGB identity. Required for recursive modules and destinations. */
  goldenBraidSlot?: ArtifactGoldenBraidSlot;
  /** Optional desired released-insert fusion boundaries for primer planning. */
  requestedLeftOverhang?: string;
  requestedRightOverhang?: string;
};

export type ArtifactCloningInputProvenance = {
  recordId: string;
  name: string;
  normalizedLength: number;
  orientation: 'forward' | 'reverse';
  sourceSha256: string;
  effectiveSha256: string;
  /** Source-record hash retained for existing stale-record consumers. */
  inputSha256: string;
};

export type ArtifactCloningPlanProvenance = {
  adapter: 'motif-for-claude-science-cloning';
  adapterVersion: typeof ARTIFACT_CLONING_ADAPTER_VERSION;
  engine: 'motif-bio/golden-gate' | 'motif-bio/gibson-assembly';
  inputRecordIds: string[];
  inputOrientations: Array<'forward' | 'reverse'>;
  /** Hashes of source workspace records, aligned with `inputRecordIds`. */
  inputSha256s: string[];
  /** Hashes after applying each requested orientation. */
  effectiveInputSha256s: string[];
  /** SHA-256 of the normalized inputs and all engine-affecting parameters. */
  requestSha256: string;
};

export type ArtifactPreparationAction = {
  id: string;
  status: 'required' | 'recommended' | 'complete';
  kind:
    | 'add_type_iis_flanks'
    | 'domesticate'
    | 'review_fusion_site'
    | 'reorder_parts'
    | 'add_destination_vector'
    | 'validate_golden_braid_identity'
    | 'add_homology'
    | 'review_overlap_tm'
    | 'review_overlap_uniqueness';
  label: string;
  detail: string;
  recordIds: string[];
  junctionIndex?: number;
};

type NormalizedCloningInput = ArtifactCloningInputProvenance & {
  sourceSequence: string;
  /** Effective 5′→3′ sequence supplied to the biological engine. */
  sequence: string;
};

export type ArtifactGoldenGateProfileInput = {
  parts: readonly ArtifactGoldenGatePartInput[];
  /** Omit for freeform work. GoldenBraid modes default to goldenbraid-3. */
  kitId?: string;
  organizationMode?: GoldenGateOrganizationMode;
  /**
   * Omit to use BsaI in freeform work, the profile's primary enzyme for a
   * GoldenBraid TU, or its upper-level enzyme for a GoldenBraid binary stack.
   */
  enzyme?: GoldenGateEnzymeName;
  /**
   * Required for recursive GoldenBraid assembly. alpha_to_omega uses BsmBI
   * (Esp3I-compatible); omega_to_alpha uses BsaI. TU assembly does not use it.
   */
  goldenBraidDirection?: ArtifactGoldenBraidDirection;
  /**
   * Record id of the destination vector in `parts`: alpha for TU assembly,
   * or the opposite level selected by a recursive direction.
   */
  destinationRecordId?: string;
};

export type ArtifactGoldenGateProfileSummary = {
  id: string;
  name: string;
  description: string;
  enzyme: GoldenGateEnzymeName;
  upperLevelEnzyme?: GoldenGateEnzymeName;
  fusionSiteLength: 3 | 4;
  fusionSites: string[];
  prototype: Array<{ role: string; left: string; right: string }>;
  citation: string;
  citationUrl: string;
};

export type ArtifactGoldenGatePartPreparation = ArtifactCloningInputProvenance & {
  status: 'ready' | 'needs_flanks' | 'needs_domestication';
  leftOverhang: string | null;
  rightOverhang: string | null;
  insertStart: number | null;
  insertEnd: number | null;
  internalSiteCount: number;
  role: string;
  roleLabel: string;
  goldenBraidLevel: ArtifactGoldenBraidLevel | null;
  goldenBraidRole: ArtifactGoldenBraidPartRole | null;
  goldenBraidSlot: ArtifactGoldenBraidSlot | null;
  /** Normalized planning intent; never substituted for measured boundaries. */
  requestedLeftOverhang: string | null;
  requestedRightOverhang: string | null;
  kitFusionSiteStatus: 'not_checked' | 'consistent' | 'nonstandard' | 'not_evaluable';
  kitMatchedOverhangs: string[];
  kitUnmatchedOverhangs: string[];
  issues: ArtifactCloningIssue[];
};

export type ArtifactGoldenGateDesignPlan = {
  kind: 'golden_gate_design';
  status: 'ready' | 'needs_preparation' | 'blocked';
  organizationMode: GoldenGateOrganizationMode;
  goldenBraidDirection: ArtifactGoldenBraidDirection | null;
  sourceLevel: ArtifactGoldenBraidLevel | null;
  destinationLevel: ArtifactGoldenBraidLevel | null;
  destinationRecordId: string | null;
  goldenBraidIdentityValidated: boolean;
  enzyme: GoldenGateEnzymeName | null;
  profile: ArtifactGoldenGateProfileSummary | null;
  inputs: ArtifactCloningInputProvenance[];
  parts: ArtifactGoldenGatePartPreparation[];
  suggestedOrderRecordIds: string[];
  nextLevel: 'none' | 'alpha' | 'omega';
  nextLevelLabel: string;
  recommendedNextLevelEnzyme: GoldenGateEnzymeName | null;
  preparation: ArtifactPreparationAction[];
  product: {
    sequence: string;
    sha256: string;
    length: number;
    topology: 'circular';
    orderedRecordIds: string[];
    overhangs: string[];
  } | null;
  errors: ArtifactCloningIssue[];
  warnings: ArtifactCloningIssue[];
  provenance: ArtifactCloningPlanProvenance | null;
};

export type ArtifactGibsonDesignInput = {
  fragments: readonly ArtifactCloningInput[];
  topology: 'linear' | 'circular';
  minOverlap?: number;
  maxOverlap?: number;
};

export type ArtifactGibsonJunctionPlan = {
  index: number;
  leftRecordId: string;
  rightRecordId: string;
  closing: boolean;
  status: 'ready' | 'missing_overlap' | 'low_tm';
  overlapSequence: string | null;
  overlapLength: number;
  overlapTm: number | null;
  issues: ArtifactCloningIssue[];
};

export type ArtifactGibsonDesignPlan = {
  kind: 'gibson_design';
  status: 'ready' | 'needs_preparation' | 'blocked';
  topology: 'linear' | 'circular';
  minOverlap: number;
  maxOverlap: number;
  inputs: ArtifactCloningInputProvenance[];
  junctions: ArtifactGibsonJunctionPlan[];
  preparation: ArtifactPreparationAction[];
  product: {
    sequence: string;
    sha256: string;
    length: number;
    topology: 'linear' | 'circular';
    orderedRecordIds: string[];
  } | null;
  errors: ArtifactCloningIssue[];
  warnings: ArtifactCloningIssue[];
  provenance: ArtifactCloningPlanProvenance | null;
};

function issue(
  severity: ArtifactCloningIssueSeverity,
  code: string,
  message: string,
  context: Pick<ArtifactCloningIssue, 'recordId' | 'junctionIndex'> = {},
): ArtifactCloningIssue {
  return {
    severity,
    code,
    message,
    ...(context.recordId === undefined ? {} : { recordId: context.recordId }),
    ...(context.junctionIndex === undefined ? {} : { junctionIndex: context.junctionIndex }),
  };
}

function normalizeInputs(raw: readonly ArtifactCloningInput[]): {
  inputs: NormalizedCloningInput[];
  errors: ArtifactCloningIssue[];
} {
  const inputs: NormalizedCloningInput[] = [];
  const errors: ArtifactCloningIssue[] = [];
  const seenIds = new Set<string>();

  if (!Array.isArray(raw) || raw.length < 2) {
    errors.push(issue('error', 'too_few_inputs', 'Cloning design requires at least two ordered DNA inputs.'));
  } else if (raw.length > MAX_ARTIFACT_CLONING_INPUTS) {
    errors.push(issue('error', 'too_many_inputs', `Cloning design supports at most ${MAX_ARTIFACT_CLONING_INPUTS} inputs.`));
  }

  (Array.isArray(raw) ? raw : []).forEach((value, index) => {
    const recordId = typeof value?.recordId === 'string' ? value.recordId.trim() : '';
    const name = typeof value?.name === 'string' ? value.name.trim() : '';
    const sourceSequence = typeof value?.sequence === 'string'
      ? value.sequence.replace(/\s+/g, '').toUpperCase()
      : '';
    const orientation = value?.orientation ?? 'forward';
    const validOrientation = orientation === 'forward' || orientation === 'reverse';
    const context = recordId ? { recordId } : {};

    if (!recordId || recordId.length > MAX_ID_LENGTH) {
      errors.push(issue('error', 'invalid_record_id', `Input ${index + 1} requires a nonblank record id of at most ${MAX_ID_LENGTH} characters.`));
    } else if (seenIds.has(recordId)) {
      errors.push(issue('error', 'duplicate_record_id', `Input record id "${recordId}" is duplicated.`, context));
    } else {
      seenIds.add(recordId);
    }
    if (!name || name.length > MAX_NAME_LENGTH) {
      errors.push(issue('error', 'invalid_name', `Input ${index + 1} requires a nonblank name of at most ${MAX_NAME_LENGTH} characters.`, context));
    }
    if (value?.molecule !== 'dna') {
      errors.push(issue('error', 'not_dna', `Input ${index + 1} must be explicitly identified as DNA.`, context));
    }
    if (
      !sourceSequence
      || sourceSequence.length > MAX_ARTIFACT_CLONING_SEQUENCE_LENGTH
      || !DNA_PATTERN.test(sourceSequence)
    ) {
      errors.push(issue(
        'error',
        'invalid_dna_sequence',
        `Input ${index + 1} must contain 1–${MAX_ARTIFACT_CLONING_SEQUENCE_LENGTH.toLocaleString()} IUPAC DNA bases and no gaps or U residues.`,
        context,
      ));
    }

    if (!validOrientation) {
      errors.push(issue(
        'error',
        'invalid_orientation',
        `Input ${index + 1} orientation must be "forward" or "reverse".`,
        context,
      ));
    }

    // The caller digest always describes the stored source record. Validate it
    // before any orientation transform so a reverse-complemented input remains
    // tied to the exact workspace sequence from which it was derived.
    const sourceSha256 = sourceSequence ? sha256HexSync(sourceSequence) : '';
    if (value?.sha256 !== undefined) {
      if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
        errors.push(issue('error', 'invalid_sha256', `Input ${index + 1} has an invalid SHA-256 digest.`, context));
      } else if (sourceSequence && value.sha256.toLowerCase() !== sourceSha256) {
        errors.push(issue('error', 'sha256_mismatch', `Input ${index + 1} SHA-256 does not match its normalized source DNA sequence.`, context));
      }
    }

    if (
      recordId
      && name
      && sourceSequence
      && sourceSequence.length <= MAX_ARTIFACT_CLONING_SEQUENCE_LENGTH
      && DNA_PATTERN.test(sourceSequence)
      && validOrientation
    ) {
      const effectiveSequence = orientation === 'reverse'
        ? reverseComplement(sourceSequence).toUpperCase()
        : sourceSequence;
      const effectiveSha256 = sha256HexSync(effectiveSequence);
      inputs.push({
        recordId,
        name,
        sourceSequence,
        sequence: effectiveSequence,
        normalizedLength: effectiveSequence.length,
        orientation,
        sourceSha256,
        effectiveSha256,
        inputSha256: sourceSha256,
      });
    }
  });

  return { inputs, errors };
}

function requestProvenance(
  engine: ArtifactCloningPlanProvenance['engine'],
  inputs: readonly NormalizedCloningInput[],
  parameters: Record<string, unknown>,
): ArtifactCloningPlanProvenance {
  const inputRecordIds = inputs.map((input) => input.recordId);
  const inputOrientations = inputs.map((input) => input.orientation);
  const inputSha256s = inputs.map((input) => input.sourceSha256);
  const effectiveInputSha256s = inputs.map((input) => input.effectiveSha256);
  const request = JSON.stringify({
    engine,
    inputs: inputs.map((input) => ({
      recordId: input.recordId,
      name: input.name,
      orientation: input.orientation,
      sourceSequence: input.sourceSequence,
      sourceSha256: input.sourceSha256,
      effectiveSequence: input.sequence,
      effectiveSha256: input.effectiveSha256,
    })),
    parameters,
  });
  return {
    adapter: 'motif-for-claude-science-cloning',
    adapterVersion: ARTIFACT_CLONING_ADAPTER_VERSION,
    engine,
    inputRecordIds,
    inputOrientations,
    inputSha256s,
    effectiveInputSha256s,
    requestSha256: sha256HexSync(request),
  };
}

function overhangLengthForEnzyme(enzyme: GoldenGateEnzymeName): 3 | 4 {
  return enzyme === 'SapI' || enzyme === 'BspQI' ? 3 : 4;
}

function normalizeRequestedOverhang(
  value: unknown,
  expectedLength: 3 | 4,
  side: 'left' | 'right',
  recordId: string | undefined,
  partName: string,
  errors: ArtifactCloningIssue[],
): string | null {
  if (value === undefined || value === null) return null;
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (normalized.length === 0 && typeof value === 'string') return null;
  if (!new RegExp(`^[ACGT]{${expectedLength}}$`).test(normalized)) {
    errors.push(issue(
      'error',
      'invalid_requested_fusion_site',
      `${partName} requested ${side} fusion site must be exactly ${expectedLength} A/C/G/T bases.`,
      recordId ? { recordId } : {},
    ));
    return null;
  }
  return normalized;
}

function summarizeKit(
  kit: GoldenGateKit,
  enzyme: GoldenGateEnzymeName,
  includePrimaryFusionSites = true,
): ArtifactGoldenGateProfileSummary {
  const usesPrimaryLevel = enzyme === kit.enzyme && includePrimaryFusionSites;
  return {
    id: kit.id,
    name: kit.name,
    description: kit.description,
    enzyme,
    ...(kit.upperLevelEnzyme === undefined ? {} : { upperLevelEnzyme: kit.upperLevelEnzyme }),
    fusionSiteLength: usesPrimaryLevel ? kit.fusionSiteLength : overhangLengthForEnzyme(enzyme),
    // The catalog's fusion set/prototype describe primary entry/TU assembly.
    // Recursive GoldenBraid rounds use position-specific vector overhangs, so
    // they must not inherit that set even when their alternating enzyme is BsaI.
    fusionSites: usesPrimaryLevel ? [...kit.fusionSites] : [],
    prototype: usesPrimaryLevel ? kit.prototype?.map((entry) => ({ ...entry })) ?? [] : [],
    citation: kit.citation,
    citationUrl: kit.citationUrl,
  };
}

function isGoldenGateEnzyme(value: unknown): value is GoldenGateEnzymeName {
  return typeof value === 'string'
    && (GOLDEN_GATE_ENZYME_NAMES as readonly string[]).includes(value);
}

function isGoldenBraidDirection(value: unknown): value is ArtifactGoldenBraidDirection {
  return value === 'alpha_to_omega' || value === 'omega_to_alpha';
}

function goldenBraidDirectionConfig(direction: ArtifactGoldenBraidDirection): {
  sourceLevel: 'alpha' | 'omega';
  destinationLevel: 'alpha' | 'omega';
  enzyme: GoldenGateEnzymeName;
  nextEnzyme: GoldenGateEnzymeName;
} {
  return direction === 'alpha_to_omega'
    ? {
      sourceLevel: 'alpha',
      destinationLevel: 'omega',
      enzyme: 'BsmBI',
      nextEnzyme: 'BsaI',
    }
    : {
      sourceLevel: 'omega',
      destinationLevel: 'alpha',
      enzyme: 'BsaI',
      nextEnzyme: 'BsmBI',
    };
}

type GoldenBraidIdentityValidation = {
  valid: boolean;
  errors: ArtifactCloningIssue[];
  preparation: ArtifactPreparationAction[];
};

function validateGoldenBraidIdentity(
  parts: readonly ArtifactGoldenGatePartInput[],
  direction: ArtifactGoldenBraidDirection,
  destinationRecordId: string | undefined,
): GoldenBraidIdentityValidation {
  const { sourceLevel, destinationLevel } = goldenBraidDirectionConfig(direction);
  const errors: ArtifactCloningIssue[] = [];
  const preparation: ArtifactPreparationAction[] = [];
  const destinationId = destinationRecordId?.trim() ?? '';

  if (parts.length < 3) {
    preparation.push({
      id: 'vector:golden-braid-destination',
      status: 'required',
      kind: 'add_destination_vector',
      label: `Add a level ${destinationLevel} destination vector`,
      detail: `Recursive GoldenBraid requires two level ${sourceLevel} source modules plus one explicitly identified level ${destinationLevel} destination vector.`,
      recordIds: [],
    });
  } else if (parts.length > 3) {
    errors.push(issue(
      'error',
      'golden_braid_binary_input_count',
      'A recursive GoldenBraid round requires exactly two source modules and one destination vector.',
    ));
  }

  const destination = destinationId
    ? parts.find((part) => typeof part?.recordId === 'string' && part.recordId.trim() === destinationId)
    : undefined;
  if (!destinationId) {
    if (!preparation.some((action) => action.kind === 'add_destination_vector')) {
      preparation.push({
        id: 'vector:golden-braid-destination',
        status: 'required',
        kind: 'add_destination_vector',
        label: `Choose the level ${destinationLevel} destination vector`,
        detail: 'Select the destination record explicitly; compatible overhangs do not establish vector identity.',
        recordIds: [],
      });
    }
  } else if (!destination) {
    errors.push(issue(
      'error',
      'golden_braid_destination_not_found',
      `GoldenBraid destination record "${destinationId}" is not present in the ordered inputs.`,
    ));
  }

  const missingIdentityIds: string[] = [];
  const sourceSlots: ArtifactGoldenBraidSlot[] = [];
  parts.forEach((part) => {
    const recordId = typeof part?.recordId === 'string' ? part.recordId.trim() : '';
    const partName = typeof part?.name === 'string' && part.name.trim() ? part.name.trim() : recordId || 'Input';
    const context = recordId ? { recordId } : {};
    const role = part.goldenBraidRole;
    const level = part.goldenBraidLevel;
    const slot = part.goldenBraidSlot;
    if (role !== undefined && role !== 'source_module' && role !== 'destination_vector') {
      errors.push(issue('error', 'invalid_golden_braid_role', `${partName} has an invalid GoldenBraid role.`, context));
    }
    if (level !== undefined && level !== 'entry' && level !== 'alpha' && level !== 'omega') {
      errors.push(issue('error', 'invalid_golden_braid_level', `${partName} has an invalid GoldenBraid level.`, context));
    }
    if (slot !== undefined && slot !== '1' && slot !== '2' && slot !== '1R' && slot !== '2R') {
      errors.push(issue('error', 'invalid_golden_braid_slot', `${partName} has an invalid GoldenBraid plasmid type.`, context));
    }
    if (role === undefined || level === undefined || slot === undefined) {
      if (recordId) missingIdentityIds.push(recordId);
      return;
    }

    const isDestination = destinationId !== '' && recordId === destinationId;
    const expectedRole: ArtifactGoldenBraidPartRole = isDestination ? 'destination_vector' : 'source_module';
    const expectedLevel = isDestination ? destinationLevel : sourceLevel;
    if (role !== expectedRole) {
      errors.push(issue(
        'error',
        'golden_braid_role_mismatch',
        `${partName} must be identified as ${expectedRole === 'destination_vector' ? 'the destination vector' : 'a source module'} for this round.`,
        context,
      ));
    }
    if (level !== expectedLevel) {
      errors.push(issue(
        'error',
        'golden_braid_level_mismatch',
        `${partName} is level ${level}, but this ${direction === 'alpha_to_omega' ? 'α→Ω' : 'Ω→α'} round requires ${expectedLevel}.`,
        context,
      ));
    }
    if (!isDestination && (slot === '1' || slot === '2' || slot === '1R' || slot === '2R')) sourceSlots.push(slot);
  });

  if (sourceSlots.length === 2 && sourceSlots[0][0] === sourceSlots[1][0]) {
    errors.push(issue(
      'error',
      'golden_braid_source_slot_pair_required',
      `Recursive GoldenBraid requires complementary source plasmid types 1/1R and 2/2R; both selected sources have base type ${sourceSlots[0][0]}.`,
    ));
  }

  if (missingIdentityIds.length > 0) {
    preparation.push({
      id: 'identity:golden-braid-inputs',
      status: 'required',
      kind: 'validate_golden_braid_identity',
      label: 'Verify GoldenBraid levels, types, and roles',
      detail: `Identify complementary type 1/1R + type 2/2R source modules at level ${sourceLevel}, plus a typed level ${destinationLevel} destination vector.`,
      recordIds: missingIdentityIds,
    });
  }

  return {
    valid: parts.length === 3 && destination !== undefined && errors.length === 0 && preparation.length === 0,
    errors,
    preparation,
  };
}

function validateGoldenBraidTuIdentity(
  parts: readonly ArtifactGoldenGatePartInput[],
  destinationRecordId: string | undefined,
): GoldenBraidIdentityValidation {
  const errors: ArtifactCloningIssue[] = [];
  const preparation: ArtifactPreparationAction[] = [];
  const destinationId = destinationRecordId?.trim() ?? '';
  const destination = destinationId
    ? parts.find((part) => typeof part?.recordId === 'string' && part.recordId.trim() === destinationId)
    : undefined;

  if (!destinationId) {
    preparation.push({
      id: 'vector:golden-braid-alpha-destination',
      status: 'required',
      kind: 'add_destination_vector',
      label: 'Choose a level alpha destination vector',
      detail: 'A GoldenBraid transcription-unit plasmid requires an explicitly identified alpha destination; compatible source-part overhangs alone are not a complete plasmid.',
      recordIds: [],
    });
  } else if (!destination) {
    errors.push(issue(
      'error',
      'golden_braid_destination_not_found',
      `GoldenBraid destination record "${destinationId}" is not present in the ordered inputs.`,
    ));
  }

  if (parts.length < 3) {
    errors.push(issue(
      'error',
      'golden_braid_tu_input_count',
      'GoldenBraid transcription-unit assembly requires at least two entry parts plus one alpha destination vector.',
    ));
  }

  const missingIdentityIds: string[] = [];
  parts.forEach((part) => {
    const recordId = typeof part?.recordId === 'string' ? part.recordId.trim() : '';
    const partName = typeof part?.name === 'string' && part.name.trim() ? part.name.trim() : recordId || 'Input';
    const context = recordId ? { recordId } : {};
    const role = part.goldenBraidRole;
    const level = part.goldenBraidLevel;
    const slot = part.goldenBraidSlot;
    const isDestination = destinationId !== '' && recordId === destinationId;

    if (role !== undefined && role !== 'source_module' && role !== 'destination_vector') {
      errors.push(issue('error', 'invalid_golden_braid_role', `${partName} has an invalid GoldenBraid role.`, context));
    }
    if (level !== undefined && level !== 'entry' && level !== 'alpha' && level !== 'omega') {
      errors.push(issue('error', 'invalid_golden_braid_level', `${partName} has an invalid GoldenBraid level.`, context));
    }
    if (slot !== undefined && slot !== '1' && slot !== '2' && slot !== '1R' && slot !== '2R') {
      errors.push(issue('error', 'invalid_golden_braid_slot', `${partName} has an invalid GoldenBraid plasmid type.`, context));
    }

    const identityMissing = role === undefined
      || level === undefined
      || (isDestination && slot === undefined);
    if (identityMissing) {
      if (recordId) missingIdentityIds.push(recordId);
      return;
    }

    const expectedRole: ArtifactGoldenBraidPartRole = isDestination ? 'destination_vector' : 'source_module';
    const expectedLevel: ArtifactGoldenBraidLevel = isDestination ? 'alpha' : 'entry';
    if (role !== expectedRole) {
      errors.push(issue(
        'error',
        'golden_braid_role_mismatch',
        `${partName} must be identified as ${isDestination ? 'the alpha destination vector' : 'an entry-level source part'}.`,
        context,
      ));
    }
    if (level !== expectedLevel) {
      errors.push(issue(
        'error',
        'golden_braid_level_mismatch',
        `${partName} is level ${level}, but transcription-unit assembly requires ${expectedLevel}.`,
        context,
      ));
    }
    if (!isDestination && slot !== undefined) {
      errors.push(issue(
        'error',
        'golden_braid_slot_not_applicable',
        `${partName} is an entry part and must not be labeled as a pDGB type 1/2 plasmid.`,
        context,
      ));
    }
  });

  if (missingIdentityIds.length > 0) {
    preparation.push({
      id: 'identity:golden-braid-tu-inputs',
      status: 'required',
      kind: 'validate_golden_braid_identity',
      label: 'Verify GoldenBraid entry parts and destination',
      detail: 'Identify source records as entry parts and identify the alpha destination vector as pDGB type 1, 2, 1R, or 2R.',
      recordIds: missingIdentityIds,
    });
  }

  return {
    valid: parts.length >= 3 && destination !== undefined && errors.length === 0 && preparation.length === 0,
    errors,
    preparation,
  };
}

function uniqueIssues(values: ArtifactCloningIssue[]): ArtifactCloningIssue[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = `${value.severity}:${value.code}:${value.recordId ?? ''}:${value.junctionIndex ?? ''}:${value.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function planArtifactGoldenGateDesign(input: ArtifactGoldenGateProfileInput): ArtifactGoldenGateDesignPlan {
  const rawParts = Array.isArray(input?.parts) ? input.parts : [];
  const normalized = normalizeInputs(rawParts);
  const errors = [...normalized.errors];
  const warnings: ArtifactCloningIssue[] = [];
  const requestedMode = input?.organizationMode ?? 'freeform';
  const organizationMode = ORGANIZATION_MODES.includes(requestedMode)
    ? requestedMode
    : 'freeform';
  if (!ORGANIZATION_MODES.includes(requestedMode)) {
    errors.push(issue('error', 'unsupported_organization_mode', `Unsupported Golden Gate organization mode "${String(requestedMode)}".`));
  }

  const effectiveKitId = input?.kitId ?? (organizationMode === 'freeform' ? undefined : 'goldenbraid-3');
  const kit = effectiveKitId === undefined ? null : getGoldenGateKit(effectiveKitId);
  if (effectiveKitId !== undefined && !kit) {
    errors.push(issue('error', 'unsupported_kit', `Unknown Golden Gate kit profile "${effectiveKitId}".`));
  }
  if (organizationMode !== 'freeform' && kit?.id !== 'goldenbraid-3') {
    errors.push(issue(
      'error',
      'golden_braid_profile_required',
      'GoldenBraid transcription-unit and alpha/omega modes require the GoldenBraid 3.0 profile.',
    ));
  }

  const requestedDirection = input?.goldenBraidDirection;
  const goldenBraidDirection = organizationMode === 'golden_braid_binary'
    && isGoldenBraidDirection(requestedDirection)
    ? requestedDirection
    : null;
  if (organizationMode === 'golden_braid_binary' && requestedDirection === undefined) {
    errors.push(issue(
      'error',
      'golden_braid_direction_required',
      'Choose an explicit GoldenBraid direction: alpha to omega or omega to alpha.',
    ));
  } else if (organizationMode === 'golden_braid_binary'
    && requestedDirection !== undefined
    && goldenBraidDirection === null) {
    errors.push(issue(
      'error',
      'invalid_golden_braid_direction',
      `Unsupported GoldenBraid direction "${String(requestedDirection)}".`,
    ));
  } else if (organizationMode !== 'golden_braid_binary' && requestedDirection !== undefined) {
    errors.push(issue(
      'error',
      'golden_braid_direction_not_applicable',
      'GoldenBraid direction applies only to recursive alpha/omega assembly.',
    ));
  }
  const braidConfig = goldenBraidDirection === null
    ? null
    : goldenBraidDirectionConfig(goldenBraidDirection);
  const destinationRecordId = organizationMode !== 'freeform'
    && typeof input?.destinationRecordId === 'string'
    ? input.destinationRecordId.trim() || null
    : null;
  if (organizationMode === 'freeform' && input?.destinationRecordId !== undefined) {
    errors.push(issue(
      'error',
      'golden_braid_destination_not_applicable',
      'A GoldenBraid destination record applies only to GoldenBraid assembly.',
    ));
  }
  const identityValidation = organizationMode === 'golden_braid_binary' && goldenBraidDirection
    ? validateGoldenBraidIdentity(rawParts, goldenBraidDirection, destinationRecordId ?? undefined)
    : organizationMode === 'golden_braid_tu'
      ? validateGoldenBraidTuIdentity(rawParts, destinationRecordId ?? undefined)
      : { valid: false, errors: [], preparation: [] };
  errors.push(...identityValidation.errors);

  const requestedEnzyme = input?.enzyme;
  if (requestedEnzyme !== undefined && !isGoldenGateEnzyme(requestedEnzyme)) {
    errors.push(issue('error', 'unsupported_enzyme', `Unsupported Type IIS enzyme "${String(requestedEnzyme)}".`));
  }
  const organizationEnzyme = organizationMode === 'golden_braid_binary'
    ? braidConfig?.enzyme ?? null
    : organizationMode === 'golden_braid_tu'
      ? kit?.enzyme ?? null
      : null;
  const enzyme = isGoldenGateEnzyme(requestedEnzyme)
    ? requestedEnzyme
    : organizationEnzyme ?? kit?.enzyme ?? (requestedEnzyme === undefined ? 'BsaI' : null);
  const enzymeMatchesOrganization = organizationMode === 'freeform'
    || organizationEnzyme === null
    || enzyme === organizationEnzyme
    || (organizationMode === 'golden_braid_binary'
      && goldenBraidDirection === 'alpha_to_omega'
      && enzyme === 'Esp3I');
  if (organizationMode !== 'freeform' && enzyme && !enzymeMatchesOrganization) {
    errors.push(issue(
      'error',
      'golden_braid_level_enzyme_mismatch',
      `${organizationMode === 'golden_braid_binary'
        ? `GoldenBraid ${goldenBraidDirection === 'omega_to_alpha' ? 'Ω→α' : 'α→Ω'} stacking`
        : 'GoldenBraid transcription-unit assembly'} requires ${organizationMode === 'golden_braid_binary' && goldenBraidDirection === 'alpha_to_omega' ? 'BsmBI or Esp3I' : organizationEnzyme}, not ${enzyme}.`,
    ));
  } else if (kit
    && enzyme
    && enzyme !== kit.enzyme
    && enzyme !== kit.upperLevelEnzyme
    && !(kit.id === 'goldenbraid-3' && goldenBraidDirection === 'alpha_to_omega' && enzyme === 'Esp3I')) {
    errors.push(issue(
      'error',
      'enzyme_profile_mismatch',
      `${kit.name} declares ${kit.enzyme}${kit.upperLevelEnzyme ? ` or ${kit.upperLevelEnzyme}` : ''}, not ${enzyme}.`,
    ));
  }

  const requestedFusionBoundaries = rawParts.map((part) => {
    const recordId = typeof part?.recordId === 'string' ? part.recordId.trim() : undefined;
    const partName = typeof part?.name === 'string' && part.name.trim()
      ? part.name.trim()
      : recordId || 'Input';
    const expectedLength = enzyme ? overhangLengthForEnzyme(enzyme) : 4;
    const left = normalizeRequestedOverhang(
      part?.requestedLeftOverhang,
      expectedLength,
      'left',
      recordId,
      partName,
      errors,
    );
    const right = normalizeRequestedOverhang(
      part?.requestedRightOverhang,
      expectedLength,
      'right',
      recordId,
      partName,
      errors,
    );
    if ((left === null) !== (right === null)) {
      errors.push(issue(
        'error',
        'incomplete_requested_fusion_sites',
        `${partName} must define both requested fusion sites or neither.`,
        recordId ? { recordId } : {},
      ));
    }
    return { left, right };
  });

  const canEvaluate = errors.length === 0
    && enzyme !== null
    && normalized.inputs.length === rawParts.length;
  const organization = canEvaluate
    ? buildGoldenGateOrganizationPlan(
      normalized.inputs.map((part) => ({ id: part.recordId, name: part.name, sequence: part.sequence })),
      enzyme,
      organizationMode,
    )
    : null;
  organization?.warnings.forEach((message) => {
    // The organization helper counts only modules; a validated artifact plan
    // also carries the destination vector as its third engine input.
    if (organizationMode === 'golden_braid_binary'
      && identityValidation.valid
      && /more than two|assembling pairs first/i.test(message)) return;
    warnings.push(issue('warning', 'organization_warning', message));
  });

  const parts: ArtifactGoldenGatePartPreparation[] = canEvaluate && organization
    ? normalized.inputs.map((part, index) => {
      const boundary = getGoldenGatePartBoundary({ name: part.name, sequence: part.sequence }, enzyme);
      const assignment = organization.assignments[index];
      const rawPart = rawParts[index];
      const requestedBoundary = requestedFusionBoundaries[index] ?? { left: null, right: null };
      const partIssues: ArtifactCloningIssue[] = [];
      boundary.errors.forEach((message) => partIssues.push(issue(
        boundary.internalSiteCount > 0 && /internal/i.test(message) ? 'warning' : 'error',
        boundary.internalSiteCount > 0 && /internal/i.test(message) ? 'internal_type_iis_site' : 'invalid_type_iis_boundary',
        `${part.name}: ${message}.`,
        { recordId: part.recordId },
      )));
      const kitFusionSetApplies = kit !== null
        && organizationMode !== 'golden_braid_binary'
        && enzyme === kit.enzyme
        && overhangLengthForEnzyme(enzyme) === kit.fusionSiteLength;
      const kitCheck = kitFusionSetApplies
        ? checkPartAgainstKit([boundary.leftOverhang, boundary.rightOverhang], kit)
        : null;
      if (kitCheck && kit && kitCheck.unmatched.length > 0) {
        partIssues.push(issue(
          'warning',
          'nonstandard_fusion_site',
          `${part.name} uses fusion site${kitCheck.unmatched.length === 1 ? '' : 's'} ${kitCheck.unmatched.join(', ')} outside ${kit.name}.`,
          { recordId: part.recordId },
        ));
      }
      if (rawPart?.goldenBraidRole !== 'destination_vector') {
        assignment?.warnings.forEach((message) => partIssues.push(issue('warning', 'role_boundary_warning', message, { recordId: part.recordId })));
      }
      const requestedBoundaryApplied = requestedBoundary.left === null
        || (boundary.leftOverhang === requestedBoundary.left && boundary.rightOverhang === requestedBoundary.right);
      if (!requestedBoundaryApplied) {
        partIssues.push(issue(
          'warning',
          'requested_fusion_sites_not_applied',
          `${part.name} does not yet release the requested ${requestedBoundary.left}→${requestedBoundary.right} fusion boundaries.`,
          { recordId: part.recordId },
        ));
      }
      const status = boundary.internalSiteCount > 0
        ? 'needs_domestication'
        : boundary.valid && requestedBoundaryApplied
          ? 'ready'
          : 'needs_flanks';
      return {
        recordId: part.recordId,
        name: part.name,
        normalizedLength: part.normalizedLength,
        orientation: part.orientation,
        sourceSha256: part.sourceSha256,
        effectiveSha256: part.effectiveSha256,
        inputSha256: part.inputSha256,
        status,
        leftOverhang: boundary.leftOverhang,
        rightOverhang: boundary.rightOverhang,
        insertStart: boundary.insertStart,
        insertEnd: boundary.insertEnd,
        internalSiteCount: boundary.internalSiteCount,
        role: assignment?.role ?? 'unknown',
        roleLabel: rawPart?.goldenBraidRole === 'destination_vector'
          ? 'DEST'
          : assignment?.roleLabel ?? 'PART',
        goldenBraidLevel: rawPart?.goldenBraidLevel === 'entry'
          || rawPart?.goldenBraidLevel === 'alpha'
          || rawPart?.goldenBraidLevel === 'omega'
          ? rawPart.goldenBraidLevel
          : null,
        goldenBraidRole: rawPart?.goldenBraidRole === 'source_module' || rawPart?.goldenBraidRole === 'destination_vector'
          ? rawPart.goldenBraidRole
          : null,
        goldenBraidSlot: rawPart?.goldenBraidSlot === '1'
          || rawPart?.goldenBraidSlot === '2'
          || rawPart?.goldenBraidSlot === '1R'
          || rawPart?.goldenBraidSlot === '2R'
          ? rawPart.goldenBraidSlot
          : null,
        requestedLeftOverhang: requestedBoundary.left,
        requestedRightOverhang: requestedBoundary.right,
        kitFusionSiteStatus: kit === null || !kitFusionSetApplies
          ? 'not_checked'
          : boundary.leftOverhang === null || boundary.rightOverhang === null
            ? 'not_evaluable'
            : kitCheck?.consistent ? 'consistent' : 'nonstandard',
        kitMatchedOverhangs: kitCheck?.matched ?? [],
        kitUnmatchedOverhangs: kitCheck?.unmatched ?? [],
        issues: uniqueIssues(partIssues),
      };
    })
    : [];

  const preparation: ArtifactPreparationAction[] = [...identityValidation.preparation];
  parts.forEach((part) => {
    const requestedBoundaryDiffers = part.requestedLeftOverhang !== null
      && (part.leftOverhang !== part.requestedLeftOverhang || part.rightOverhang !== part.requestedRightOverhang);
    const needsFlanks = part.leftOverhang === null || part.rightOverhang === null || requestedBoundaryDiffers;
    if (needsFlanks) {
      preparation.push({
        id: `flanks:${part.recordId}`,
        status: 'required',
        kind: 'add_type_iis_flanks',
        label: `Prepare ${part.name} with ${enzyme ?? 'Type IIS'} flanks`,
        detail: part.requestedLeftOverhang && part.requestedRightOverhang
          ? `Design primer tails that release the verified ${part.requestedLeftOverhang}→${part.requestedRightOverhang} fusion boundaries; then revalidate the amplified insert.`
          : 'Add one inward-facing recognition site at each end and revalidate the released insert boundaries.',
        recordIds: [part.recordId],
      });
    }
    if (part.internalSiteCount > 0) {
      preparation.push({
        id: `domesticate:${part.recordId}`,
        status: 'required',
        kind: 'domesticate',
        label: `Domesticate ${part.name}`,
        detail: `Remove ${part.internalSiteCount} internal ${enzyme} site${part.internalSiteCount === 1 ? '' : 's'} without changing the intended product.`,
        recordIds: [part.recordId],
      });
    }
    if (part.kitFusionSiteStatus === 'nonstandard') {
      preparation.push({
        id: `fusion:${part.recordId}`,
        status: 'recommended',
        kind: 'review_fusion_site',
        label: `Review ${part.name} fusion sites`,
        detail: `${part.kitUnmatchedOverhangs.join(', ')} ${part.kitUnmatchedOverhangs.length === 1 ? 'is' : 'are'} outside the selected kit profile.`,
        recordIds: [part.recordId],
      });
    }
  });

  if (organization && organization.suggestedOrderIds.some((id, index) => id !== normalized.inputs[index]?.recordId)) {
    preparation.push({
      id: 'reorder:organization',
      status: 'recommended',
      kind: 'reorder_parts',
      label: 'Apply the suggested part order',
      detail: `Use ${organization.suggestedOrderIds.join(' → ')} for the selected organization mode.`,
      recordIds: [...organization.suggestedOrderIds],
    });
  }

  const assembly = canEvaluate
    && parts.every((part) => part.status === 'ready')
    && (organizationMode === 'freeform' || identityValidation.valid)
    ? goldenGateAssemble(
      normalized.inputs.map((part) => ({ id: part.recordId, name: part.name, sequence: part.sequence })),
      enzyme,
    )
    : null;
  if (assembly && !assembly.success) {
    assembly.errors.forEach((message) => errors.push(issue('error', 'assembly_not_ready', message)));
    assembly.warnings.forEach((message) => warnings.push(issue('warning', 'assembly_warning', message)));
    if (assembly.missingVectorOverhangs) {
      preparation.push({
        id: 'vector:destination',
        status: 'required',
        kind: 'add_destination_vector',
        label: 'Add a compatible destination vector',
        detail: `The open chain needs vector-facing overhangs ${assembly.missingVectorOverhangs.left} and ${assembly.missingVectorOverhangs.right}.`,
        recordIds: [],
      });
    }
  }
  if (assembly?.success && assembly.sequence.length > MAX_ARTIFACT_CLONING_PRODUCT_LENGTH) {
    errors.push(issue(
      'error',
      'product_too_large',
      `The ${assembly.sequence.length.toLocaleString()} bp product exceeds the artifact limit of ${MAX_ARTIFACT_CLONING_PRODUCT_LENGTH.toLocaleString()} bp.`,
    ));
  }

  const provenance = canEvaluate
    ? requestProvenance('motif-bio/golden-gate', normalized.inputs, {
      kitId: kit?.id ?? null,
      organizationMode,
      enzyme,
      goldenBraidDirection,
      goldenBraidSourceLevel: braidConfig?.sourceLevel ?? null,
      goldenBraidDestinationLevel: braidConfig?.destinationLevel ?? null,
      destinationRecordId,
      goldenBraidIdentityValidated: identityValidation.valid,
      goldenBraidPartIdentities: organizationMode !== 'freeform'
        ? rawParts.map((part) => ({
          recordId: part.recordId,
          level: part.goldenBraidLevel ?? null,
          role: part.goldenBraidRole ?? null,
          slot: part.goldenBraidSlot ?? null,
        }))
        : [],
      requestedFusionBoundaries: rawParts.map((part, index) => ({
        recordId: part.recordId,
        left: requestedFusionBoundaries[index]?.left ?? null,
        right: requestedFusionBoundaries[index]?.right ?? null,
      })),
    })
    : null;
  const product = assembly?.success
    && assembly.sequence.length <= MAX_ARTIFACT_CLONING_PRODUCT_LENGTH
    && errors.length === 0
    ? {
      sequence: assembly.sequence,
      sha256: sha256HexSync(assembly.sequence),
      length: assembly.sequence.length,
      topology: 'circular' as const,
      orderedRecordIds: assembly.partIds ?? assembly.parts,
      overhangs: [...assembly.overhangs],
    }
    : null;
  const hasSchemaErrors = normalized.errors.length > 0
    || errors.some((entry) => [
      'unsupported_organization_mode',
      'unsupported_kit',
      'golden_braid_profile_required',
      'golden_braid_direction_required',
      'invalid_golden_braid_direction',
      'golden_braid_direction_not_applicable',
      'golden_braid_destination_not_applicable',
      'golden_braid_level_enzyme_mismatch',
      'golden_braid_binary_input_count',
      'golden_braid_tu_input_count',
      'golden_braid_destination_not_found',
      'invalid_golden_braid_role',
      'invalid_golden_braid_level',
      'invalid_golden_braid_slot',
      'golden_braid_role_mismatch',
      'golden_braid_level_mismatch',
      'golden_braid_slot_not_applicable',
      'golden_braid_source_slot_pair_required',
      'unsupported_enzyme',
      'enzyme_profile_mismatch',
      'invalid_requested_fusion_site',
      'incomplete_requested_fusion_sites',
    ].includes(entry.code));

  return {
    kind: 'golden_gate_design',
    status: product ? 'ready' : hasSchemaErrors ? 'blocked' : 'needs_preparation',
    organizationMode,
    goldenBraidDirection,
    sourceLevel: organizationMode === 'golden_braid_binary'
      ? braidConfig?.sourceLevel ?? null
      : organizationMode === 'golden_braid_tu' ? 'entry' : null,
    destinationLevel: organizationMode === 'golden_braid_binary'
      ? braidConfig?.destinationLevel ?? null
      : organizationMode === 'golden_braid_tu' ? 'alpha' : null,
    destinationRecordId,
    goldenBraidIdentityValidated: identityValidation.valid,
    enzyme,
    profile: kit && enzyme ? summarizeKit(kit, enzyme, organizationMode !== 'golden_braid_binary') : null,
    inputs: normalized.inputs.map(({ sequence: _sequence, sourceSequence: _sourceSequence, ...entry }) => entry),
    parts,
    suggestedOrderRecordIds: organization?.suggestedOrderIds ?? normalized.inputs.map((part) => part.recordId),
    nextLevel: organizationMode === 'golden_braid_binary'
      ? braidConfig?.destinationLevel ?? 'none'
      : organization?.nextLevel ?? 'none',
    nextLevelLabel: organizationMode === 'golden_braid_binary' && braidConfig
      ? `Level ${braidConfig.destinationLevel} GoldenBraid stack`
      : organization?.nextLevelLabel ?? 'Custom product',
    recommendedNextLevelEnzyme: organizationMode === 'freeform'
      ? null
      : organizationMode === 'golden_braid_binary'
        ? braidConfig?.nextEnzyme ?? null
        : kit?.upperLevelEnzyme ?? null,
    preparation,
    product,
    errors: uniqueIssues(errors),
    warnings: uniqueIssues(warnings),
    provenance,
  };
}

function validOverlapBound(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return Number.isInteger(value) && Number(value) >= 10 && Number(value) <= 120
    ? Number(value)
    : null;
}

export function planArtifactGibsonDesign(input: ArtifactGibsonDesignInput): ArtifactGibsonDesignPlan {
  const rawFragments = Array.isArray(input?.fragments) ? input.fragments : [];
  const normalized = normalizeInputs(rawFragments);
  const errors = [...normalized.errors];
  const warnings: ArtifactCloningIssue[] = [];
  const topology = input?.topology;
  if (topology !== 'linear' && topology !== 'circular') {
    errors.push(issue('error', 'invalid_topology', 'Gibson topology must be explicitly linear or circular.'));
  }
  const minOverlapValue = validOverlapBound(input?.minOverlap, 15);
  const maxOverlapValue = validOverlapBound(input?.maxOverlap, 60);
  if (minOverlapValue === null) {
    errors.push(issue('error', 'invalid_min_overlap', 'Minimum overlap must be an integer from 10 to 120 bp.'));
  }
  if (maxOverlapValue === null) {
    errors.push(issue('error', 'invalid_max_overlap', 'Maximum overlap must be an integer from 10 to 120 bp.'));
  }
  const minOverlap = minOverlapValue ?? 15;
  const maxOverlap = maxOverlapValue ?? 60;
  if (minOverlap > maxOverlap) {
    errors.push(issue('error', 'invalid_overlap_range', 'Minimum overlap cannot exceed maximum overlap.'));
  }

  const canEvaluate = errors.length === 0 && normalized.inputs.length === rawFragments.length;
  const junctions: ArtifactGibsonJunctionPlan[] = [];
  if (canEvaluate) {
    const count = topology === 'circular' ? normalized.inputs.length : normalized.inputs.length - 1;
    for (let index = 0; index < count; index += 1) {
      const left = normalized.inputs[index];
      const right = normalized.inputs[(index + 1) % normalized.inputs.length];
      const closing = index === normalized.inputs.length - 1;
      const overlap = findOverlap(left.sequence, right.sequence, minOverlap, maxOverlap);
      const junctionIssues: ArtifactCloningIssue[] = [];
      if (!overlap) {
        junctionIssues.push(issue(
          'error',
          closing ? 'missing_closing_overlap' : 'missing_overlap',
          `No ${minOverlap}–${maxOverlap} bp exact overlap was found for ${left.name} → ${right.name}.`,
          { junctionIndex: index },
        ));
      } else if (overlap.tm < 50) {
        junctionIssues.push(issue(
          'warning',
          'low_overlap_tm',
          `${left.name} → ${right.name} overlap Tm is ${overlap.tm.toFixed(1)} °C; review overlaps below 50 °C.`,
          { junctionIndex: index },
        ));
      }
      junctions.push({
        index,
        leftRecordId: left.recordId,
        rightRecordId: right.recordId,
        closing,
        status: !overlap ? 'missing_overlap' : overlap.tm < 50 ? 'low_tm' : 'ready',
        overlapSequence: overlap?.sequence ?? null,
        overlapLength: overlap?.length ?? 0,
        overlapTm: overlap?.tm ?? null,
        issues: junctionIssues,
      });
    }
  }

  const preparation: ArtifactPreparationAction[] = [];
  junctions.forEach((junction) => {
    const left = normalized.inputs.find((entry) => entry.recordId === junction.leftRecordId);
    const right = normalized.inputs.find((entry) => entry.recordId === junction.rightRecordId);
    if (junction.status === 'missing_overlap') {
      preparation.push({
        id: `homology:${junction.index}`,
        status: 'required',
        kind: 'add_homology',
        label: `Add homology for ${left?.name ?? junction.leftRecordId} → ${right?.name ?? junction.rightRecordId}`,
        detail: `Add a unique ${minOverlap}–${maxOverlap} bp homology arm; then revalidate the exact junction.`,
        recordIds: [junction.leftRecordId, junction.rightRecordId],
        junctionIndex: junction.index,
      });
    } else if (junction.status === 'low_tm') {
      preparation.push({
        id: `tm:${junction.index}`,
        status: 'recommended',
        kind: 'review_overlap_tm',
        label: `Review overlap Tm for ${left?.name ?? junction.leftRecordId} → ${right?.name ?? junction.rightRecordId}`,
        detail: `The detected overlap is ${junction.overlapLength} bp at ${junction.overlapTm?.toFixed(1)} °C.`,
        recordIds: [junction.leftRecordId, junction.rightRecordId],
        junctionIndex: junction.index,
      });
    }
  });

  const realOverlaps = junctions
    .map((junction) => junction.overlapSequence)
    .filter((sequence): sequence is string => sequence !== null);
  const reused = [...new Set(realOverlaps.filter((sequence, index) => realOverlaps.indexOf(sequence) !== index))];
  reused.forEach((sequence) => {
    warnings.push(issue('warning', 'reused_overlap', `Overlap ${sequence.slice(0, 20)}${sequence.length > 20 ? '…' : ''} is reused and may assemble ambiguously.`));
    preparation.push({
      id: `unique:${sha256HexSync(sequence).slice(0, 12)}`,
      status: 'recommended',
      kind: 'review_overlap_uniqueness',
      label: 'Review reused homology sequence',
      detail: 'The same overlap appears at more than one junction; redesign it if unique assembly order matters.',
      recordIds: junctions
        .filter((junction) => junction.overlapSequence === sequence)
        .flatMap((junction) => [junction.leftRecordId, junction.rightRecordId]),
    });
  });

  const assembly = canEvaluate
    ? gibsonAssemble(
      normalized.inputs.map((part) => ({ name: part.name, sequence: part.sequence })),
      minOverlap,
      maxOverlap,
      topology,
    )
    : null;
  if (assembly && !assembly.success) {
    assembly.errors.forEach((message) => errors.push(issue('error', 'assembly_not_ready', message)));
  }
  assembly?.warnings.forEach((message) => warnings.push(issue('warning', 'assembly_warning', message)));
  if (assembly?.success && assembly.sequence.length > MAX_ARTIFACT_CLONING_PRODUCT_LENGTH) {
    errors.push(issue(
      'error',
      'product_too_large',
      `The ${assembly.sequence.length.toLocaleString()} bp product exceeds the artifact limit of ${MAX_ARTIFACT_CLONING_PRODUCT_LENGTH.toLocaleString()} bp.`,
    ));
  }

  const provenance = canEvaluate
    ? requestProvenance('motif-bio/gibson-assembly', normalized.inputs, { topology, minOverlap, maxOverlap })
    : null;
  const product = assembly?.success
    && assembly.sequence.length <= MAX_ARTIFACT_CLONING_PRODUCT_LENGTH
    && errors.length === 0
    ? {
      sequence: assembly.sequence,
      sha256: sha256HexSync(assembly.sequence),
      length: assembly.sequence.length,
      topology: assembly.topology,
      orderedRecordIds: normalized.inputs.map((entry) => entry.recordId),
    }
    : null;

  return {
    kind: 'gibson_design',
    status: product ? 'ready' : normalized.errors.length > 0 || !canEvaluate ? 'blocked' : 'needs_preparation',
    topology: topology === 'circular' ? 'circular' : 'linear',
    minOverlap,
    maxOverlap,
    inputs: normalized.inputs.map(({ sequence: _sequence, sourceSequence: _sourceSequence, ...entry }) => entry),
    junctions,
    preparation,
    product,
    errors: uniqueIssues(errors),
    warnings: uniqueIssues(warnings),
    provenance,
  };
}
