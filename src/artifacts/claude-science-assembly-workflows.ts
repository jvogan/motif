import { getGoldenGatePartBoundary } from '../bio/golden-gate';
import {
  assessGoldenGateAssemblyFidelity,
  type GoldenGateFidelityAssessment,
  type GoldenGateFidelityCondition,
  type GoldenGateFidelityJunction,
} from '../bio/golden-gate-fidelity';
import { reverseComplement } from '../bio/reverse-complement';
import { remapPositionQualifiers, type QualifierBaseMap } from '../bio/transl-except';
import { isProposedAnnotation } from '../bio/proposed-annotations';
import type { Feature, Topology } from '../bio/types';
import {
  normalizeArtifactWorkflowResults,
  type ArtifactJsonObject,
  type ArtifactProvenance,
  type ArtifactWorkflowResult,
} from './claude-science-workspace-collections';
import { sha256HexSync } from './claude-science-sha256';
import { materializeGoldenGateFlankSpacers } from './claude-science-golden-gate-normalization';

/**
 * Pure planning helpers for the standalone Claude Science artifact.
 *
 * The main bio workbench has feature-aware assembly functions that allocate
 * feature ids. These helpers intentionally do less: they validate ordered
 * record inputs, describe the chemistry, and only return a product sequence
 * when every required junction is supported by the supplied metadata. They do
 * not read stores, mutate inputs, call the clock, or allocate ids.
 */

export const MAX_ARTIFACT_ASSEMBLY_PARTS = 100;
export const MAX_ARTIFACT_ASSEMBLY_PART_LENGTH = 250_000;
export const MAX_ARTIFACT_ASSEMBLY_PRODUCT_LENGTH = 250_000;
export const MAX_ARTIFACT_ASSEMBLY_OVERHANG_LENGTH = 32;

const MAX_ID_LENGTH = 160;
const MAX_NAME_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 16_384;
const MAX_TAGS = 100;
const MAX_TAG_LENGTH = 256;
const DNA_PATTERN = /^[ACGTRYSWKMBDHVN]+$/i;
const CONCRETE_DNA_PATTERN = /^[ACGT]+$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export type ArtifactAssemblyIssue = {
  code: string;
  message: string;
  recordId?: string;
  junctionIndex?: number;
};

export type ArtifactAssemblyEndType = 'blunt' | '5prime' | '3prime';

export type ArtifactAssemblyEnd = {
  /** Empty for blunt ends; concrete A/C/G/T bases for sticky ends. */
  sequence: string;
  type: ArtifactAssemblyEndType;
};

export type ArtifactAssemblyPartBase = {
  recordId: string;
  name: string;
  sequence: string;
  molecule: 'dna';
  /** Optional caller-computed digest used for reproducible provenance. */
  sha256?: string;
};

export type ArtifactLigationPartInput = ArtifactAssemblyPartBase & {
  /** Explicit physical left end. Takes precedence over record-shaped fields. */
  leftEnd?: ArtifactAssemblyEnd;
  /** Explicit physical right end. Takes precedence over record-shaped fields. */
  rightEnd?: ArtifactAssemblyEnd;
  /** Record-shaped left-end sequence. Absent means unknown; empty means blunt. */
  overhang5?: string;
  /** Record-shaped right-end sequence. Absent means unknown; empty means blunt. */
  overhang3?: string;
  /** Needed for a nonempty record-shaped left end; digest fragments provide it. */
  overhang5Type?: ArtifactAssemblyEndType;
  /** Needed for a nonempty record-shaped right end; digest fragments provide it. */
  overhang3Type?: ArtifactAssemblyEndType;
};

export type ArtifactGoldenGatePartInput = ArtifactAssemblyPartBase & {
  /** Circular donors must be linearized before this bounded boundary parser can evaluate them. */
  sourceTopology?: Topology;
};

export type ArtifactLigationJunction = {
  index: number;
  leftRecordId: string;
  rightRecordId: string;
  closing: boolean;
  leftEnd: ArtifactAssemblyEnd;
  rightEnd: ArtifactAssemblyEnd;
  type: 'blunt' | 'sticky' | 'incompatible' | 'not_evaluable';
  compatible: boolean;
  reason: string;
};

export type ArtifactLigationPlan = {
  kind: 'ligation';
  status: 'ready' | 'blocked';
  topology: Topology;
  inputRecordIds: string[];
  inputSha256s?: string[];
  /** Physical outer ends retained by a linear product; null for a circle. */
  terminalEnds: { left: ArtifactAssemblyEnd; right: ArtifactAssemblyEnd } | null;
  junctions: ArtifactLigationJunction[];
  productSequence: string | null;
  errors: ArtifactAssemblyIssue[];
  warnings: ArtifactAssemblyIssue[];
};

export type ArtifactTypeIISEnzymeGeometry = {
  name: 'BsaI' | 'BbsI' | 'BsmBI' | 'Esp3I' | 'SapI' | 'BspQI';
  recognitionSequence: string;
  reverseRecognitionSequence: string;
  cutOffset: number;
  complementCutOffset: number;
  overhangType: '5prime';
  overhangLength: number;
};

const TYPE_IIS_ENZYMES: readonly ArtifactTypeIISEnzymeGeometry[] = [
  { name: 'BsaI', recognitionSequence: 'GGTCTC', reverseRecognitionSequence: 'GAGACC', cutOffset: 7, complementCutOffset: 11, overhangType: '5prime', overhangLength: 4 },
  { name: 'BbsI', recognitionSequence: 'GAAGAC', reverseRecognitionSequence: 'GTCTTC', cutOffset: 8, complementCutOffset: 12, overhangType: '5prime', overhangLength: 4 },
  { name: 'BsmBI', recognitionSequence: 'CGTCTC', reverseRecognitionSequence: 'GAGACG', cutOffset: 7, complementCutOffset: 11, overhangType: '5prime', overhangLength: 4 },
  { name: 'Esp3I', recognitionSequence: 'CGTCTC', reverseRecognitionSequence: 'GAGACG', cutOffset: 7, complementCutOffset: 11, overhangType: '5prime', overhangLength: 4 },
  { name: 'SapI', recognitionSequence: 'GCTCTTC', reverseRecognitionSequence: 'GAAGAGC', cutOffset: 8, complementCutOffset: 11, overhangType: '5prime', overhangLength: 3 },
  { name: 'BspQI', recognitionSequence: 'GCTCTTC', reverseRecognitionSequence: 'GAAGAGC', cutOffset: 8, complementCutOffset: 11, overhangType: '5prime', overhangLength: 3 },
] as const;

export type ArtifactGoldenGatePartPlan = {
  recordId: string;
  name: string;
  status: 'ready' | 'blocked';
  leftOverhang: string | null;
  rightOverhang: string | null;
  insertStart: number | null;
  insertEnd: number | null;
  releasedSequence: string | null;
  siteCount: number;
  internalSiteCount: number;
  domesticationRequired: boolean;
  errors: ArtifactAssemblyIssue[];
  warnings: ArtifactAssemblyIssue[];
};

export type ArtifactGoldenGateJunction = {
  index: number;
  leftRecordId: string;
  rightRecordId: string;
  closing: boolean;
  leftOverhang: string | null;
  rightOverhang: string | null;
  compatible: boolean;
  status: 'compatible' | 'incompatible' | 'not_evaluable';
  reason: string;
};

export type ArtifactGoldenGatePlan = {
  kind: 'golden_gate';
  status: 'ready' | 'blocked';
  topology: Topology;
  requestedEnzyme: string;
  enzyme: ArtifactTypeIISEnzymeGeometry | null;
  inputRecordIds: string[];
  inputSha256s?: string[];
  parts: ArtifactGoldenGatePartPlan[];
  junctions: ArtifactGoldenGateJunction[];
  /** Empirical fidelity is unknown until an exact published condition is selected. */
  fidelity: GoldenGateFidelityAssessment;
  domesticationRequiredRecordIds: string[];
  productSequence: string | null;
  errors: ArtifactAssemblyIssue[];
  warnings: ArtifactAssemblyIssue[];
};

export type ArtifactAssemblyPlan = ArtifactLigationPlan | ArtifactGoldenGatePlan;

export type ArtifactAssemblyDerivedRecordInput = {
  id: string;
  name: string;
  description?: string;
  sequence: string;
  molecule: 'dna';
  type: 'dna';
  topology: Topology;
  length: number;
  overhang5?: string;
  overhang3?: string;
  overhang5Type?: ArtifactAssemblyEndType;
  overhang3Type?: ArtifactAssemblyEndType;
  source: string;
  group?: string;
  dateAdded: string;
  tags?: string[];
  provenance: ArtifactJsonObject;
};

export type ArtifactAssemblyArtifactOptions = {
  workflowResultId: string;
  createdAt: string;
  name: string;
  provenance: Omit<ArtifactProvenance, 'parentIds'> & { parentIds?: readonly string[] };
  outputRecord?: {
    id: string;
    name: string;
    description?: string;
    source?: string;
    group?: string;
    tags?: readonly string[];
  };
};

export type ArtifactAssemblyArtifacts = {
  workflowResult: ArtifactWorkflowResult;
  /** Present only when the plan is ready and outputRecord was requested. */
  derivedRecord?: ArtifactAssemblyDerivedRecordInput;
};

function issue(
  code: string,
  message: string,
  context: Pick<ArtifactAssemblyIssue, 'recordId' | 'junctionIndex'> = {},
): ArtifactAssemblyIssue {
  return {
    code,
    message,
    ...(context.recordId === undefined ? {} : { recordId: context.recordId }),
    ...(context.junctionIndex === undefined ? {} : { junctionIndex: context.junctionIndex }),
  };
}

function normalizeShortText(value: unknown, _label: string, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function normalizedDna(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, '').toUpperCase();
  if (!normalized || normalized.length > MAX_ARTIFACT_ASSEMBLY_PART_LENGTH) return null;
  return DNA_PATTERN.test(normalized) ? normalized : null;
}

type NormalizedPart<T> = {
  original: T;
  recordId: string;
  name: string;
  sequence: string;
  sha256?: string;
};

function validatePartBase<T extends ArtifactAssemblyPartBase>(
  part: T,
  index: number,
): { part: NormalizedPart<T> | null; errors: ArtifactAssemblyIssue[] } {
  const errors: ArtifactAssemblyIssue[] = [];
  const recordId = normalizeShortText(part?.recordId, `parts[${index}].recordId`, MAX_ID_LENGTH);
  const name = normalizeShortText(part?.name, `parts[${index}].name`, MAX_NAME_LENGTH);
  const sequence = normalizedDna(part?.sequence);
  const context = recordId ? { recordId } : {};

  if (!recordId) errors.push(issue('invalid_record_id', `Part ${index + 1} requires a nonblank record id of at most ${MAX_ID_LENGTH} characters.`));
  if (!name) errors.push(issue('invalid_part_name', `Part ${index + 1} requires a nonblank name of at most ${MAX_NAME_LENGTH} characters.`, context));
  if (part?.molecule !== 'dna') errors.push(issue('not_dna', `Part ${index + 1} must be explicitly identified as DNA.`, context));
  if (!sequence) {
    errors.push(issue(
      'invalid_dna_sequence',
      `Part ${index + 1} must contain 1–${MAX_ARTIFACT_ASSEMBLY_PART_LENGTH.toLocaleString()} IUPAC DNA bases and no gaps or U residues.`,
      context,
    ));
  }
  if (part?.sha256 !== undefined && (typeof part.sha256 !== 'string' || !SHA256_PATTERN.test(part.sha256))) {
    errors.push(issue('invalid_sha256', `Part ${index + 1} has an invalid SHA-256 digest.`, context));
  } else if (
    sequence
    && typeof part?.sha256 === 'string'
    && part.sha256.toLowerCase() !== sha256HexSync(sequence)
  ) {
    errors.push(issue(
      'sha256_mismatch',
      `Part ${index + 1} SHA-256 does not match its normalized DNA sequence.`,
      context,
    ));
  }

  if (!recordId || !name || !sequence || errors.length > 0) return { part: null, errors };
  return {
    part: {
      original: part,
      recordId,
      name,
      sequence,
      ...(part.sha256 === undefined ? {} : { sha256: part.sha256.toLowerCase() }),
    },
    errors,
  };
}

function validatePartCount(parts: readonly unknown[]): ArtifactAssemblyIssue[] {
  if (parts.length < 2) {
    return [issue('too_few_parts', 'Assembly planning requires at least two ordered DNA parts.')];
  }
  if (parts.length > MAX_ARTIFACT_ASSEMBLY_PARTS) {
    return [issue('too_many_parts', `Assembly planning supports at most ${MAX_ARTIFACT_ASSEMBLY_PARTS} parts.`)];
  }
  return [];
}

function inputHashes<T extends { sha256?: string }>(parts: readonly T[]): {
  hashes?: string[];
  warning?: ArtifactAssemblyIssue;
} {
  const present = parts.filter((part) => part.sha256 !== undefined).length;
  if (present === 0) return {};
  if (present !== parts.length) {
    return {
      warning: issue(
        'partial_input_hashes',
        'Only some inputs include SHA-256 provenance; hashes are omitted from the saved workflow until every input is hashed.',
      ),
    };
  }
  return { hashes: parts.map((part) => part.sha256 as string) };
}

function normalizeAssemblyEnd(
  value: ArtifactAssemblyEnd | undefined,
  label: string,
  recordId: string,
): { end: ArtifactAssemblyEnd | null; errors: ArtifactAssemblyIssue[] } {
  const errors: ArtifactAssemblyIssue[] = [];
  if (!value || (value.type !== 'blunt' && value.type !== '5prime' && value.type !== '3prime')) {
    return {
      end: null,
      errors: [issue('invalid_end_type', `${label} must declare blunt, 5prime, or 3prime end chemistry.`, { recordId })],
    };
  }
  if (typeof value.sequence !== 'string') {
    return {
      end: null,
      errors: [issue('invalid_overhang', `${label} must include an overhang sequence string.`, { recordId })],
    };
  }
  const sequence = value.sequence.replace(/\s+/g, '').toUpperCase();
  if (value.type === 'blunt') {
    if (sequence.length !== 0) {
      errors.push(issue('blunt_end_has_sequence', `${label} is blunt and therefore cannot carry an overhang sequence.`, { recordId }));
    }
  } else if (
    sequence.length === 0
    || sequence.length > MAX_ARTIFACT_ASSEMBLY_OVERHANG_LENGTH
    || !CONCRETE_DNA_PATTERN.test(sequence)
  ) {
    errors.push(issue(
      'invalid_overhang',
      `${label} sticky overhang must contain 1–${MAX_ARTIFACT_ASSEMBLY_OVERHANG_LENGTH} concrete A/C/G/T bases.`,
      { recordId },
    ));
  }
  return {
    end: errors.length === 0 ? { type: value.type, sequence } : null,
    errors,
  };
}

function recordShapedAssemblyEnd(
  part: ArtifactLigationPartInput,
  side: 'left' | 'right',
  name: string,
  recordId: string,
): { end: ArtifactAssemblyEnd | null; errors: ArtifactAssemblyIssue[] } {
  const explicit = side === 'left' ? part.leftEnd : part.rightEnd;
  if (explicit !== undefined) {
    return normalizeAssemblyEnd(explicit, `${name} ${side} end`, recordId);
  }

  const sequenceValue = side === 'left' ? part.overhang5 : part.overhang3;
  const typeValue = side === 'left' ? part.overhang5Type : part.overhang3Type;
  const recordField = side === 'left' ? 'overhang5' : 'overhang3';
  const typeField = side === 'left' ? 'overhang5Type' : 'overhang3Type';
  if (sequenceValue === undefined) {
    return {
      end: null,
      errors: [issue(
        'unknown_end_metadata',
        `${name} has no recorded ${side}-end chemistry. Digest or linearize it first, then use a fragment with explicit blunt or sticky ends.`,
        { recordId },
      )],
    };
  }
  if (typeof sequenceValue !== 'string') {
    return {
      end: null,
      errors: [issue('invalid_overhang', `${name} ${recordField} must be a string.`, { recordId })],
    };
  }
  const sequence = sequenceValue.replace(/\s+/g, '').toUpperCase();
  if (sequence.length === 0) {
    if (typeValue !== undefined && typeValue !== 'blunt') {
      return {
        end: null,
        errors: [issue(
          'inconsistent_end_metadata',
          `${name} ${recordField} is explicitly blunt but ${typeField} is ${typeValue}.`,
          { recordId },
        )],
      };
    }
    return { end: { sequence: '', type: 'blunt' }, errors: [] };
  }
  if (typeValue === undefined || typeValue === 'blunt') {
    return {
      end: null,
      errors: [issue(
        'unknown_overhang_polarity',
        `${name} ${recordField} is sticky; provide ${typeField} as 5prime or 3prime before evaluating ligation.`,
        { recordId },
      )],
    };
  }
  return normalizeAssemblyEnd(
    { sequence, type: typeValue },
    `${name} ${side} end`,
    recordId,
  );
}

/** `5prime`/`3prime` is the stored end chemistry; a reader is shown 5′ and 3′. */
function endTypeLabel(type: ArtifactAssemblyEndType): string {
  return type === 'blunt' ? 'blunt' : type === '5prime' ? '5′' : '3′';
}

function ligationJunction(
  left: { recordId: string; name: string; rightEnd: ArtifactAssemblyEnd | null },
  right: { recordId: string; name: string; leftEnd: ArtifactAssemblyEnd | null },
  index: number,
  closing: boolean,
): ArtifactLigationJunction {
  const leftEnd = left.rightEnd;
  const rightEnd = right.leftEnd;
  if (!leftEnd || !rightEnd) {
    return {
      index,
      leftRecordId: left.recordId,
      rightRecordId: right.recordId,
      closing,
      leftEnd: leftEnd ?? { type: 'blunt', sequence: '' },
      rightEnd: rightEnd ?? { type: 'blunt', sequence: '' },
      type: 'not_evaluable',
      compatible: false,
      reason: `Cannot evaluate ${left.name} → ${right.name} until both physical ends are valid.`,
    };
  }
  if (leftEnd.type === 'blunt' && rightEnd.type === 'blunt') {
    return {
      index,
      leftRecordId: left.recordId,
      rightRecordId: right.recordId,
      closing,
      leftEnd,
      rightEnd,
      type: 'blunt',
      compatible: true,
      reason: `${left.name} → ${right.name} is a blunt-end junction.`,
    };
  }
  if (leftEnd.type === 'blunt' || rightEnd.type === 'blunt') {
    return {
      index,
      leftRecordId: left.recordId,
      rightRecordId: right.recordId,
      closing,
      leftEnd,
      rightEnd,
      type: 'incompatible',
      compatible: false,
      reason: `${left.name} → ${right.name} mixes a blunt end with a sticky one. Fill in or chew back the sticky end and ligate blunt, or recut the blunt part so both ends leave the same overhang.`,
    };
  }
  if (leftEnd.type !== rightEnd.type) {
    return {
      index,
      leftRecordId: left.recordId,
      rightRecordId: right.recordId,
      closing,
      leftEnd,
      rightEnd,
      type: 'incompatible',
      compatible: false,
      reason: `${left.name} leaves a ${endTypeLabel(leftEnd.type)} overhang and ${right.name} a ${endTypeLabel(rightEnd.type)} overhang, which cannot pair. Recut one part so both ends leave the same polarity, or blunt both ends and ligate blunt.`,
    };
  }
  const expected = reverseComplement(leftEnd.sequence).toUpperCase();
  const compatible = expected === rightEnd.sequence;
  return {
    index,
    leftRecordId: left.recordId,
    rightRecordId: right.recordId,
    closing,
    leftEnd,
    rightEnd,
    type: compatible ? 'sticky' : 'incompatible',
    compatible,
    reason: compatible
      ? `${left.name} → ${right.name} has complementary ${endTypeLabel(leftEnd.type)} sticky ends.`
      : `${left.name} leaves ${endTypeLabel(leftEnd.type)} ${leftEnd.sequence} and ${right.name} starts with ${endTypeLabel(rightEnd.type)} ${rightEnd.sequence}, which cannot pair. Recut ${right.name} to start with ${endTypeLabel(leftEnd.type)} ${expected}, or blunt both ends and ligate blunt — a blunt join carries no part order.`,
  };
}

function ligationOrderAmbiguityIssues(
  parts: ReadonlyArray<{
    recordId: string;
    name: string;
    leftEnd: ArtifactAssemblyEnd | null;
    rightEnd: ArtifactAssemblyEnd | null;
  }>,
  topology: Topology,
  junctions: readonly ArtifactLigationJunction[],
): ArtifactAssemblyIssue[] {
  const issues: ArtifactAssemblyIssue[] = [];
  const bluntJunctions = junctions.filter((junction) => junction.type === 'blunt');
  if (bluntJunctions.length > 0) {
    issues.push(issue(
      'ambiguous_blunt_ligation',
      'Blunt junctions do not encode a unique part order. Save the compatibility plan only, or provide directional sticky ends before materializing an intended product.',
      { junctionIndex: bluntJunctions[0]?.index },
    ));
  }

  parts.forEach((part, index) => {
    const rightEnd = part.rightEnd;
    if (!rightEnd || rightEnd.type === 'blunt') return;
    const expectedLeft = reverseComplement(rightEnd.sequence).toUpperCase();
    const compatibleTargets = parts.flatMap((candidate, candidateIndex) => (
      candidate.leftEnd
      && candidate.leftEnd.type === rightEnd.type
      && candidate.leftEnd.sequence === expectedLeft
        ? [candidateIndex]
        : []
    ));
    const intendedTarget = index < parts.length - 1
      ? index + 1
      : topology === 'circular' ? 0 : null;

    if (intendedTarget === null) {
      if (compatibleTargets.length > 0) {
        issues.push(issue(
          'ambiguous_terminal_ligation',
          `${part.name} has a terminal ${endTypeLabel(rightEnd.type)} ${rightEnd.sequence} overhang that can ligate to ${compatibleTargets.length} selected left end${compatibleTargets.length === 1 ? '' : 's'}; the intended linear product is not unique.`,
          { recordId: part.recordId },
        ));
      }
      return;
    }

    if (compatibleTargets.length !== 1 || compatibleTargets[0] !== intendedTarget) {
      const end = `${endTypeLabel(rightEnd.type)} ${rightEnd.sequence}`;
      const intendedName = parts[intendedTarget]?.name ?? `the part at position ${intendedTarget + 1}`;
      issues.push(issue(
        'ambiguous_sticky_ligation',
        compatibleTargets.length === 0
          ? `${part.name} leaves ${end} and no selected part starts with the matching ${endTypeLabel(rightEnd.type)} ${expectedLeft}, so nothing can follow it at position ${intendedTarget + 1}.`
          : compatibleTargets.length === 1
            ? compatibleTargets[0] === index
              ? `${part.name} leaves ${end}, which matches its own left end, so it can close on itself instead of joining ${intendedName}.`
              : `${part.name} leaves ${end}, which pairs with ${parts[compatibleTargets[0]]?.name ?? `position ${compatibleTargets[0] + 1}`} rather than ${intendedName}. Move that part to position ${intendedTarget + 1}, or recut so the intended pair matches.`
            : `${part.name} leaves ${end}, which ${compatibleTargets.length} selected parts start with, so the order is ambiguous. Give each junction its own overhang pair.`,
        {
          recordId: part.recordId,
          ...(junctions.length === 0 ? {} : { junctionIndex: Math.min(index, junctions.length - 1) }),
        },
      ));
    }
  });

  return issues;
}

export function planArtifactLigation(input: {
  parts: readonly ArtifactLigationPartInput[];
  topology: Topology;
}): ArtifactLigationPlan {
  const rawParts = Array.isArray(input?.parts) ? input.parts : [];
  const topology: Topology = input?.topology === 'circular' ? 'circular' : 'linear';
  const errors = validatePartCount(rawParts);
  const warnings: ArtifactAssemblyIssue[] = [];
  const normalized: Array<NormalizedPart<ArtifactLigationPartInput> & {
    leftEnd: ArtifactAssemblyEnd | null;
    rightEnd: ArtifactAssemblyEnd | null;
  }> = [];

  if (input?.topology !== 'linear' && input?.topology !== 'circular') {
    errors.push(issue('invalid_topology', 'Ligation topology must be explicitly set to linear or circular.'));
  }

  rawParts.slice(0, MAX_ARTIFACT_ASSEMBLY_PARTS).forEach((part, index) => {
    const base = validatePartBase(part, index);
    errors.push(...base.errors);
    if (!base.part) return;
    const left = recordShapedAssemblyEnd(part, 'left', base.part.name, base.part.recordId);
    const right = recordShapedAssemblyEnd(part, 'right', base.part.name, base.part.recordId);
    errors.push(...left.errors, ...right.errors);
    normalized.push({ ...base.part, leftEnd: left.end, rightEnd: right.end });
  });

  const hashes = normalized.length === rawParts.length ? inputHashes(normalized) : {};
  if (hashes.warning) warnings.push(hashes.warning);
  warnings.push(issue(
    'ligation_conditions_not_modeled',
    'This plan validates supplied end compatibility and intended order only. 5′ phosphorylation, ligase conditions, DNA concentration, and competing products are not modeled.',
  ));

  const junctions: ArtifactLigationJunction[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    junctions.push(ligationJunction(normalized[index], normalized[index + 1], index, false));
  }
  if (topology === 'circular' && normalized.length >= 2) {
    junctions.push(ligationJunction(
      normalized[normalized.length - 1],
      normalized[0],
      junctions.length,
      true,
    ));
  }

  junctions.forEach((junction) => {
    if (!junction.compatible) {
      errors.push(issue('incompatible_junction', junction.reason, { junctionIndex: junction.index }));
    }
  });
  errors.push(...ligationOrderAmbiguityIssues(normalized, topology, junctions));

  const totalLength = normalized.reduce((sum, part) => sum + part.sequence.length, 0);
  if (totalLength > MAX_ARTIFACT_ASSEMBLY_PRODUCT_LENGTH) {
    errors.push(issue(
      'product_too_large',
      `The ${totalLength.toLocaleString()} bp ligation product exceeds the artifact record limit of ${MAX_ARTIFACT_ASSEMBLY_PRODUCT_LENGTH.toLocaleString()} bp.`,
    ));
  }

  const ready = errors.length === 0 && normalized.length === rawParts.length;
  let terminalEnds: ArtifactLigationPlan['terminalEnds'] = null;
  if (topology === 'linear' && ready) {
    const left = normalized[0]?.leftEnd;
    const right = normalized[normalized.length - 1]?.rightEnd;
    if (left && right) terminalEnds = { left, right };
  }
  return {
    kind: 'ligation',
    status: ready ? 'ready' : 'blocked',
    topology,
    inputRecordIds: normalized.map((part) => part.recordId),
    ...(hashes.hashes === undefined ? {} : { inputSha256s: hashes.hashes }),
    terminalEnds,
    junctions,
    productSequence: ready ? normalized.map((part) => part.sequence).join('') : null,
    errors,
    warnings,
  };
}

export function getArtifactTypeIISEnzymeGeometry(
  requestedName: unknown,
): ArtifactTypeIISEnzymeGeometry | null {
  if (typeof requestedName !== 'string') return null;
  const normalized = requestedName.trim().toLowerCase();
  const enzyme = TYPE_IIS_ENZYMES.find((candidate) => candidate.name.toLowerCase() === normalized);
  return enzyme ? { ...enzyme } : null;
}

function goldenGateJunction(
  left: ArtifactGoldenGatePartPlan,
  right: ArtifactGoldenGatePartPlan,
  index: number,
  closing: boolean,
): ArtifactGoldenGateJunction {
  if (!left.rightOverhang || !right.leftOverhang) {
    return {
      index,
      leftRecordId: left.recordId,
      rightRecordId: right.recordId,
      closing,
      leftOverhang: left.rightOverhang,
      rightOverhang: right.leftOverhang,
      compatible: false,
      status: 'not_evaluable',
      reason: `Cannot evaluate ${left.name} → ${right.name} until both Type IIS boundaries are valid.`,
    };
  }
  const compatible = left.rightOverhang === right.leftOverhang;
  return {
    index,
    leftRecordId: left.recordId,
    rightRecordId: right.recordId,
    closing,
    leftOverhang: left.rightOverhang,
    rightOverhang: right.leftOverhang,
    compatible,
    status: compatible ? 'compatible' : 'incompatible',
    reason: compatible
      ? `${left.name} → ${right.name} shares fusion overhang ${left.rightOverhang}.`
      : `${left.name} ends with ${left.rightOverhang}; ${right.name} begins with ${right.leftOverhang}.`,
  };
}

function duplicateFusionWarnings(
  parts: readonly ArtifactGoldenGatePartPlan[],
): ArtifactAssemblyIssue[] {
  const warnings: ArtifactAssemblyIssue[] = [];
  const count = new Map<string, number>();
  for (const part of parts) {
    if (part.leftOverhang) count.set(part.leftOverhang, (count.get(part.leftOverhang) ?? 0) + 1);
  }
  for (const [overhang, occurrences] of count) {
    if (occurrences > 1) {
      warnings.push(issue(
        'duplicate_fusion_overhang',
        `Fusion overhang ${overhang} starts ${occurrences} ordered parts; alternate ligation products may compete with the intended order.`,
      ));
    }
    if (overhang === reverseComplement(overhang).toUpperCase()) {
      warnings.push(issue(
        'palindromic_fusion_overhang',
        `Fusion overhang ${overhang} is palindromic and may increase self-ligation risk.`,
      ));
    }
  }
  return warnings;
}

function goldenGateFidelityJunction(junction: ArtifactGoldenGateJunction): GoldenGateFidelityJunction {
  // The artifact planner stores one fusion-site identity on both compatible
  // ends.  The empirical tables use the physical two-strand pair, so expose
  // the reverse-complement strand only after compatibility has been proven.
  const left = junction.compatible ? junction.leftOverhang : null;
  return {
    leftOverhang: left,
    rightOverhang: left === null ? null : reverseComplement(left).toUpperCase(),
    label: `${junction.leftRecordId} → ${junction.rightRecordId}${junction.closing ? ' (closing)' : ''}`,
  };
}

function enzymeFamily(value: string): string {
  return value.trim().toLowerCase().replace(/[-\s]?(?:hf(?:v2)?|v2)$/i, '');
}

function fidelityRequestedEnzyme(
  enzyme: ArtifactTypeIISEnzymeGeometry | null,
  condition: GoldenGateFidelityCondition | null | undefined,
): string | undefined {
  if (!enzyme) return condition ? '__unsupported_type_iis_enzyme__' : undefined;
  // The artifact geometry names BsaI/BbsI/BsmBI while the published assay
  // names the tested high-fidelity variants (BsaI-HFv2, BbsI-HF, BsmBI-v2).
  // Permit only these explicit family aliases; never make a cross-family
  // substitution such as BsaI data for BbsI.
  if (condition && enzymeFamily(enzyme.name) === enzymeFamily(condition.enzyme)) return condition.enzyme;
  return enzyme.name;
}

export function planArtifactGoldenGateAssembly(input: {
  parts: readonly ArtifactGoldenGatePartInput[];
  enzyme: string;
  topology: Topology;
  /** Exact published assay condition; omitted means no empirical score is claimed. */
  fidelityCondition?: GoldenGateFidelityCondition | null;
  /** Explicitly opt into the non-probabilistic Hamming comparison fallback. */
  fidelityFallback?: 'none' | 'hamming';
}): ArtifactGoldenGatePlan {
  const rawParts = Array.isArray(input?.parts) ? input.parts : [];
  const topology: Topology = input?.topology === 'linear' ? 'linear' : 'circular';
  const requestedEnzyme = typeof input?.enzyme === 'string' ? input.enzyme.trim() : '';
  const enzyme = getArtifactTypeIISEnzymeGeometry(requestedEnzyme);
  const errors = validatePartCount(rawParts);
  const warnings: ArtifactAssemblyIssue[] = [];
  const normalized: NormalizedPart<ArtifactGoldenGatePartInput>[] = [];

  if (input?.topology !== 'linear' && input?.topology !== 'circular') {
    errors.push(issue('invalid_topology', 'Golden Gate topology must be explicitly set to linear or circular.'));
  }
  if (!enzyme) {
    errors.push(issue(
      'unsupported_type_iis_enzyme',
      `Unsupported Type IIS enzyme "${requestedEnzyme || String(input?.enzyme ?? '')}". Choose BsaI, BbsI, BsmBI, Esp3I, SapI, or BspQI.`,
    ));
  }

  rawParts.slice(0, MAX_ARTIFACT_ASSEMBLY_PARTS).forEach((part, index) => {
    const base = validatePartBase(part, index);
    errors.push(...base.errors);
    if (base.part) normalized.push(base.part);
  });

  const hashes = normalized.length === rawParts.length ? inputHashes(normalized) : {};
  if (hashes.warning) warnings.push(hashes.warning);

  const parts: ArtifactGoldenGatePartPlan[] = normalized.map((part) => {
    if (!enzyme) {
      return {
        recordId: part.recordId,
        name: part.name,
        status: 'blocked',
        leftOverhang: null,
        rightOverhang: null,
        insertStart: null,
        insertEnd: null,
        releasedSequence: null,
        siteCount: 0,
        internalSiteCount: 0,
        domesticationRequired: false,
        errors: [issue('unsupported_type_iis_enzyme', 'Type IIS boundaries cannot be evaluated for the selected enzyme.', { recordId: part.recordId })],
        warnings: [],
      };
    }

    if (part.original.sourceTopology === 'circular') {
      return {
        recordId: part.recordId,
        name: part.name,
        status: 'blocked',
        leftOverhang: null,
        rightOverhang: null,
        insertStart: null,
        insertEnd: null,
        releasedSequence: null,
        siteCount: 0,
        internalSiteCount: 0,
        domesticationRequired: false,
        errors: [issue(
          'circular_source_requires_linearization',
          `${part.name} is circular. Linearize or extract a flank-contained part before evaluating Type IIS boundaries.`,
          { recordId: part.recordId },
        )],
        warnings: [],
      };
    }

    const boundary = getGoldenGatePartBoundary(
      {
        name: part.name,
        sequence: materializeGoldenGateFlankSpacers(part.sequence, enzyme.name).sequence,
      },
      enzyme.name,
    );
    const partWarnings: ArtifactAssemblyIssue[] = [];
    const partErrors: ArtifactAssemblyIssue[] = [];
    if (boundary.internalSiteCount > 0) {
      partWarnings.push(issue(
        'internal_type_iis_site',
        `${part.name} contains ${boundary.internalSiteCount} internal ${enzyme.name} site${boundary.internalSiteCount === 1 ? '' : 's'}; domesticate the insert and revalidate before assembly.`,
        { recordId: part.recordId },
      ));
      partErrors.push(issue(
        'domestication_required',
        `${part.name} cannot be assembled honestly until its internal ${enzyme.name} site${boundary.internalSiteCount === 1 ? '' : 's'} are removed.`,
        { recordId: part.recordId },
      ));
    }
    for (const message of boundary.errors) {
      if (message.includes('internal')) continue;
      partErrors.push(issue('invalid_type_iis_boundary', `${part.name}: ${message}.`, { recordId: part.recordId }));
    }

    const hasInsert = boundary.insertStart !== null
      && boundary.insertEnd !== null
      && boundary.insertEnd > boundary.insertStart;
    const releasedSequence = hasInsert
      ? part.sequence.slice(boundary.insertStart as number, boundary.insertEnd as number).toUpperCase()
      : null;
    return {
      recordId: part.recordId,
      name: part.name,
      status: partErrors.length === 0 && boundary.valid ? 'ready' : 'blocked',
      leftOverhang: boundary.leftOverhang,
      rightOverhang: boundary.rightOverhang,
      insertStart: boundary.insertStart,
      insertEnd: boundary.insertEnd,
      releasedSequence,
      siteCount: boundary.siteCount,
      internalSiteCount: boundary.internalSiteCount,
      domesticationRequired: boundary.internalSiteCount > 0,
      errors: partErrors,
      warnings: partWarnings,
    };
  });

  parts.forEach((part) => {
    errors.push(...part.errors);
    warnings.push(...part.warnings);
  });
  const fusionWarnings = duplicateFusionWarnings(parts);
  warnings.push(...fusionWarnings);
  fusionWarnings
    .filter((entry) => entry.code === 'duplicate_fusion_overhang')
    .forEach((entry) => {
      errors.push(issue(
        'ambiguous_fusion_overhang',
        `${entry.message} The intended product is not uniquely supported, so no product sequence is emitted.`,
      ));
    });

  const junctions: ArtifactGoldenGateJunction[] = [];
  for (let index = 0; index < parts.length - 1; index += 1) {
    junctions.push(goldenGateJunction(parts[index], parts[index + 1], index, false));
  }
  if (topology === 'circular' && parts.length >= 2) {
    junctions.push(goldenGateJunction(parts[parts.length - 1], parts[0], junctions.length, true));
  }
  junctions.forEach((junction) => {
    if (!junction.compatible) {
      errors.push(issue(
        junction.status === 'not_evaluable' ? 'unevaluable_golden_gate_junction' : 'incompatible_golden_gate_junction',
        junction.reason,
        { junctionIndex: junction.index },
      ));
    }
  });

  const fidelity = assessGoldenGateAssemblyFidelity({
    condition: input?.fidelityCondition,
    enzyme: fidelityRequestedEnzyme(enzyme, input?.fidelityCondition),
    fallback: input?.fidelityFallback,
    junctions: junctions.map(goldenGateFidelityJunction),
  });
  if ((input?.fidelityCondition !== undefined || input?.fidelityFallback !== undefined)
    && fidelity.warnings[0]) {
    warnings.push(issue('golden_gate_fidelity', fidelity.warnings[0]));
  }

  let candidateProduct: string | null = null;
  if (enzyme && parts.length === rawParts.length && parts.every((part) => part.releasedSequence !== null)) {
    candidateProduct = parts[0]?.releasedSequence ?? null;
    for (let index = 1; candidateProduct !== null && index < parts.length; index += 1) {
      candidateProduct += (parts[index].releasedSequence as string).slice(enzyme.overhangLength);
    }
    if (candidateProduct !== null && topology === 'circular') {
      candidateProduct = candidateProduct.slice(0, Math.max(0, candidateProduct.length - enzyme.overhangLength));
    }
    if (candidateProduct !== null && candidateProduct.length > MAX_ARTIFACT_ASSEMBLY_PRODUCT_LENGTH) {
      errors.push(issue(
        'product_too_large',
        `The ${candidateProduct.length.toLocaleString()} bp Golden Gate product exceeds the artifact record limit of ${MAX_ARTIFACT_ASSEMBLY_PRODUCT_LENGTH.toLocaleString()} bp.`,
      ));
    }
  }

  const ready = errors.length === 0
    && parts.length === rawParts.length
    && parts.every((part) => part.status === 'ready')
    && junctions.every((junction) => junction.compatible)
    && candidateProduct !== null;

  return {
    kind: 'golden_gate',
    status: ready ? 'ready' : 'blocked',
    topology,
    requestedEnzyme,
    enzyme,
    inputRecordIds: normalized.map((part) => part.recordId),
    ...(hashes.hashes === undefined ? {} : { inputSha256s: hashes.hashes }),
    parts,
    junctions,
    fidelity,
    domesticationRequiredRecordIds: parts
      .filter((part) => part.domesticationRequired)
      .map((part) => part.recordId),
    productSequence: ready ? candidateProduct : null,
    errors,
    warnings,
  };
}

function assemblyIssueJson(value: ArtifactAssemblyIssue): ArtifactJsonObject {
  return {
    code: value.code,
    message: value.message,
    ...(value.recordId === undefined ? {} : { recordId: value.recordId }),
    ...(value.junctionIndex === undefined ? {} : { junctionIndex: value.junctionIndex }),
  };
}

function goldenGateFidelityJson(assessment: GoldenGateFidelityAssessment): ArtifactJsonObject {
  const condition = assessment.condition === null ? null : {
    enzyme: assessment.condition.enzyme,
    ligase: assessment.condition.ligase,
    enzymeAmount: assessment.condition.enzymeAmount,
    buffer: assessment.condition.buffer,
    reactionVolumeUl: assessment.condition.reactionVolumeUl,
    substrateConcentrationNm: assessment.condition.substrateConcentrationNm,
    cycles: assessment.condition.cycles,
    cycleSteps: assessment.condition.cycleSteps.map((step) => ({
      temperatureC: step.temperatureC,
      minutes: step.minutes,
    })),
    finalHeatSoak: {
      temperatureC: assessment.condition.finalHeatSoak.temperatureC,
      minutes: assessment.condition.finalHeatSoak.minutes,
    },
  } satisfies ArtifactJsonObject;
  const provenance = assessment.provenance === null ? null : {
    datasetId: assessment.provenance.datasetId,
    datasetVersion: assessment.provenance.datasetVersion,
    citation: assessment.provenance.citation,
    doi: assessment.provenance.doi,
    articleUrl: assessment.provenance.articleUrl,
    dataUrl: assessment.provenance.dataUrl,
    table: assessment.provenance.table,
    license: assessment.provenance.license,
    sourceSha256: assessment.provenance.sourceSha256,
  } satisfies ArtifactJsonObject;
  return {
    status: assessment.status,
    method: assessment.method,
    datasetId: assessment.datasetId,
    condition,
    provenance,
    junctions: assessment.junctions.map((junction) => ({
      index: junction.index,
      ...(junction.label === undefined ? {} : { label: junction.label }),
      leftOverhang: junction.leftOverhang,
      rightOverhang: junction.rightOverhang,
      status: junction.status,
      correctCount: junction.correctCount,
      mismatchCount: junction.mismatchCount,
      totalCount: junction.totalCount,
      counts: junction.counts === null ? null : { ...junction.counts },
      fidelity: junction.fidelity,
      estimatedFidelity: junction.estimatedFidelity,
      heuristicScore: junction.heuristicScore,
      nearestMismatchDistance: junction.nearestMismatchDistance,
      ...(junction.reason === undefined ? {} : { reason: junction.reason }),
    })),
    assembly: {
      junctionCount: assessment.assembly.junctionCount,
      knownJunctions: assessment.assembly.knownJunctions,
      unknownJunctions: assessment.assembly.unknownJunctions,
      coverage: assessment.assembly.coverage,
      estimatedFidelity: assessment.assembly.estimatedFidelity,
      heuristicScore: assessment.assembly.heuristicScore,
      assumptions: [...assessment.assembly.assumptions],
      unknownReasons: [...assessment.assembly.unknownReasons],
    },
    warnings: [...assessment.warnings],
  };
}

function assemblyParameters(plan: ArtifactAssemblyPlan): ArtifactJsonObject {
  if (plan.kind === 'ligation') {
    return {
      topology: plan.topology,
      orderedInputRecordIds: [...plan.inputRecordIds],
      ...(plan.terminalEnds === null ? {} : {
        terminalEnds: {
          left: { ...plan.terminalEnds.left },
          right: { ...plan.terminalEnds.right },
        },
      }),
      junctions: plan.junctions.map((junction) => ({
        leftRecordId: junction.leftRecordId,
        rightRecordId: junction.rightRecordId,
        closing: junction.closing,
        leftEnd: { ...junction.leftEnd },
        rightEnd: { ...junction.rightEnd },
      })),
    };
  }
  return {
    topology: plan.topology,
    orderedInputRecordIds: [...plan.inputRecordIds],
    requestedEnzyme: plan.requestedEnzyme,
    ...(plan.enzyme === null ? {} : {
      enzyme: {
        name: plan.enzyme.name,
        recognitionSequence: plan.enzyme.recognitionSequence,
        reverseRecognitionSequence: plan.enzyme.reverseRecognitionSequence,
        cutOffset: plan.enzyme.cutOffset,
        complementCutOffset: plan.enzyme.complementCutOffset,
        overhangType: plan.enzyme.overhangType,
        overhangLength: plan.enzyme.overhangLength,
      },
    }),
    parts: plan.parts.map((part) => ({
      recordId: part.recordId,
      leftOverhang: part.leftOverhang,
      rightOverhang: part.rightOverhang,
      insertStart: part.insertStart,
      insertEnd: part.insertEnd,
      internalSiteCount: part.internalSiteCount,
    })),
    fidelity: goldenGateFidelityJson(plan.fidelity),
  };
}

function assemblyResult(plan: ArtifactAssemblyPlan): ArtifactJsonObject {
  const result: ArtifactJsonObject = {
    status: plan.status,
    topology: plan.topology,
    productLength: plan.productSequence?.length ?? null,
    errors: plan.errors.map(assemblyIssueJson),
    warnings: plan.warnings.map(assemblyIssueJson),
    junctions: plan.junctions.map((junction) => ({
      leftRecordId: junction.leftRecordId,
      rightRecordId: junction.rightRecordId,
      closing: junction.closing,
      compatible: junction.compatible,
      status: 'status' in junction ? junction.status : junction.type,
      reason: junction.reason,
    })),
  };
  if (plan.kind === 'golden_gate') result.fidelity = goldenGateFidelityJson(plan.fidelity);
  return result;
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function normalizeOutputRecordOptions(
  value: NonNullable<ArtifactAssemblyArtifactOptions['outputRecord']>,
): Omit<NonNullable<ArtifactAssemblyArtifactOptions['outputRecord']>, 'tags'> & { tags?: string[] } {
  const id = normalizeShortText(value.id, 'outputRecord.id', MAX_ID_LENGTH);
  const name = normalizeShortText(value.name, 'outputRecord.name', MAX_NAME_LENGTH);
  if (!id) throw new Error(`outputRecord.id must be nonblank and at most ${MAX_ID_LENGTH} characters.`);
  if (!name) throw new Error(`outputRecord.name must be nonblank and at most ${MAX_NAME_LENGTH} characters.`);
  if (value.description !== undefined && (typeof value.description !== 'string' || value.description.length > MAX_DESCRIPTION_LENGTH)) {
    throw new Error(`outputRecord.description cannot exceed ${MAX_DESCRIPTION_LENGTH.toLocaleString()} characters.`);
  }
  const group = value.group === undefined
    ? undefined
    : normalizeShortText(value.group, 'outputRecord.group', MAX_NAME_LENGTH);
  if (value.group !== undefined && !group) {
    throw new Error(`outputRecord.group must be nonblank and at most ${MAX_NAME_LENGTH} characters when provided.`);
  }
  const source = value.source === undefined
    ? undefined
    : normalizeShortText(value.source, 'outputRecord.source', MAX_NAME_LENGTH);
  if (value.source !== undefined && !source) {
    throw new Error(`outputRecord.source must be nonblank and at most ${MAX_NAME_LENGTH} characters when provided.`);
  }
  let tags: string[] | undefined;
  if (value.tags !== undefined) {
    if (!Array.isArray(value.tags) || value.tags.length > MAX_TAGS) {
      throw new Error(`outputRecord.tags cannot contain more than ${MAX_TAGS} entries.`);
    }
    tags = value.tags.map((tag, index) => {
      const normalized = normalizeShortText(tag, `outputRecord.tags[${index}]`, MAX_TAG_LENGTH);
      if (!normalized) throw new Error(`outputRecord.tags[${index}] must be nonblank and at most ${MAX_TAG_LENGTH} characters.`);
      return normalized;
    });
  }
  return {
    id,
    name,
    ...(value.description === undefined ? {} : { description: value.description }),
    ...(source ? { source } : {}),
    ...(group ? { group } : {}),
    ...(tags === undefined ? {} : { tags: Array.from(new Set(tags)) }),
  };
}

/**
 * Turn a deterministic plan into portable workflow history and, on success,
 * an optional record input accepted by the standalone artifact runtime.
 * Caller-owned ids and timestamps are mandatory; blocked plans never produce
 * a derived record or claim an output record id.
 */
export function createArtifactAssemblyArtifacts(
  plan: ArtifactAssemblyPlan,
  options: ArtifactAssemblyArtifactOptions,
): ArtifactAssemblyArtifacts {
  if (!validIsoTimestamp(options.createdAt)) {
    throw new Error('createdAt must be a valid ISO 8601 date-time supplied by the caller.');
  }
  const workflowResultId = normalizeShortText(options.workflowResultId, 'workflowResultId', MAX_ID_LENGTH);
  const name = normalizeShortText(options.name, 'name', MAX_NAME_LENGTH);
  if (!workflowResultId) throw new Error(`workflowResultId must be nonblank and at most ${MAX_ID_LENGTH} characters.`);
  if (!name) throw new Error(`name must be nonblank and at most ${MAX_NAME_LENGTH} characters.`);
  if (!options.provenance || typeof options.provenance.source !== 'string' || !options.provenance.source.trim()) {
    throw new Error('provenance.source is required.');
  }

  const output = options.outputRecord ? normalizeOutputRecordOptions(options.outputRecord) : undefined;
  const canMaterialize = plan.status === 'ready' && plan.productSequence !== null && output !== undefined;
  const provenance: ArtifactProvenance = {
    ...options.provenance,
    operation: options.provenance.operation ?? plan.kind,
    parentIds: [...(options.provenance.parentIds ?? plan.inputRecordIds)],
  };
  const [workflowResult] = normalizeArtifactWorkflowResults([{
    id: workflowResultId,
    kind: plan.kind,
    name,
    inputRecordIds: [...plan.inputRecordIds],
    ...(plan.inputSha256s === undefined ? {} : { inputSha256s: [...plan.inputSha256s] }),
    parameters: assemblyParameters(plan),
    outputRecordIds: canMaterialize ? [output.id] : [],
    result: assemblyResult(plan),
    createdAt: options.createdAt,
    provenance,
  }]);
  if (!workflowResult) throw new Error('Could not create the assembly workflow result.');

  if (!canMaterialize || !output || plan.productSequence === null) return { workflowResult };
  const productSequence = plan.productSequence;

  const source = normalizeShortText(output.source ?? options.provenance.source, 'outputRecord.source', MAX_NAME_LENGTH);
  if (!source) throw new Error('The derived record source is invalid.');
  const terminalEndFields: Pick<
    ArtifactAssemblyDerivedRecordInput,
    'overhang5' | 'overhang3' | 'overhang5Type' | 'overhang3Type'
  > = plan.topology === 'circular'
    ? {}
    : plan.kind === 'ligation' && plan.terminalEnds
      ? {
        overhang5: plan.terminalEnds.left.sequence,
        overhang3: plan.terminalEnds.right.sequence,
        overhang5Type: plan.terminalEnds.left.type,
        overhang3Type: plan.terminalEnds.right.type,
      }
      : plan.kind === 'golden_gate'
        && plan.enzyme
        && plan.parts[0]?.leftOverhang
        && plan.parts[plan.parts.length - 1]?.rightOverhang
        ? {
          overhang5: plan.parts[0].leftOverhang,
          // Artifact `overhang3` stores the physical complementary strand at
          // the right end, while Golden Gate planning compares the sense-side
          // fusion sequence directly between adjacent parts.
          overhang3: reverseComplement(plan.parts[plan.parts.length - 1].rightOverhang as string).toUpperCase(),
          overhang5Type: plan.enzyme.overhangType,
          overhang3Type: plan.enzyme.overhangType,
        }
        : {};
  const derivedRecord: ArtifactAssemblyDerivedRecordInput = {
    id: output.id,
    name: output.name,
    ...(output.description === undefined ? {} : { description: output.description }),
    sequence: productSequence,
    molecule: 'dna',
    type: 'dna',
    topology: plan.topology,
    length: productSequence.length,
    ...terminalEndFields,
    source,
    ...(output.group === undefined ? {} : { group: output.group.trim() }),
    dateAdded: workflowResult.createdAt,
    ...(output.tags === undefined ? {} : { tags: [...output.tags] }),
    provenance: {
      source: options.provenance.source,
      operation: plan.kind,
      workflowResultId,
      parentRecordIds: [...plan.inputRecordIds],
      createdAt: workflowResult.createdAt,
      ...(options.provenance.actor === undefined ? {} : { actor: options.provenance.actor }),
      ...(options.provenance.engine === undefined ? {} : { engine: options.provenance.engine }),
      ...(options.provenance.engineVersion === undefined ? {} : { engineVersion: options.provenance.engineVersion }),
      ...(options.provenance.metadata === undefined ? {} : { metadata: options.provenance.metadata }),
    },
  };
  return { workflowResult, derivedRecord };
}

type CarriedFeatureShape = {
  start: number;
  end: number;
  strand?: number;
  subRanges?: ReadonlyArray<{ start: number; end: number; strand?: number }>;
  metadata?: Readonly<Record<string, unknown>>;
};

/**
 * A proposed ORF that nobody accepted is a guess about its part, so a product
 * does not carry it: it would arrive as a feature of a record whose own review
 * never offered it. An accepted proposal is an annotation and carries.
 */
function isUnreviewedGuess(feature: CarriedFeatureShape): boolean {
  return feature.metadata !== undefined && isProposedAnnotation({ metadata: feature.metadata });
}

/**
 * A qualifier such as /transl_except=(pos:1204..1206,aa:Sec) names bases by
 * absolute position, so it moves with its feature; left behind, it would
 * recode whatever codon now sits at the old number.
 */
function carriedQualifiers(feature: CarriedFeatureShape, map: QualifierBaseMap): { metadata?: Readonly<Record<string, unknown>> } {
  return feature.metadata === undefined ? {} : { metadata: remapPositionQualifiers(feature.metadata, map) };
}

/**
 * A part used reverse-complemented enters the product as its flipped bases, so
 * each feature is mirrored within the part and moves to the other strand; a
 * directionless one stays directionless. Sub-ranges keep their stored order:
 * it is biological 5′→3′ order, and mirroring each piece keeps that true on the
 * flipped strand. A feature's own bases are unchanged, so `codon_start`, which
 * counts from the feature's 5′ end, stays right.
 */
function orientPart<P extends { sequence: string; features?: readonly CarriedFeatureShape[]; orientation?: string }>(part: P): P {
  if (part.orientation !== 'reverse') return part;
  const length = part.sequence.length;
  const flip = <T extends { start: number; end: number; strand?: number }>(item: T): T => ({
    ...item,
    start: length - item.end,
    end: length - item.start,
    ...(item.strand === undefined ? {} : { strand: -item.strand || 0 }),
  });
  return {
    ...part,
    sequence: reverseComplement(part.sequence),
    features: part.features?.map((feature) => ({
      ...flip(feature),
      ...(feature.subRanges && { subRanges: feature.subRanges.map(flip) }),
      ...carriedQualifiers(feature, {
        base: (index) => (index >= 0 && index < length ? length - 1 - index : null),
        flipped: true,
      }),
    })),
  };
}

/**
 * True when any base of the feature lies in one of the [start, end) intervals.
 * A circular location written across the origin (start after end) covers the
 * bases from start to the molecule's end and from 0 to end.
 */
export function featureOverlapsIntervals(
  feature: Pick<CarriedFeatureShape, 'start' | 'end' | 'subRanges'>,
  intervals: ReadonlyArray<readonly [number, number]>,
  moleculeLength: number,
): boolean {
  const pieces: Array<readonly [number, number]> = feature.subRanges?.length
    ? feature.subRanges.map((range) => [range.start, range.end] as const)
    : feature.start > feature.end
      ? [[feature.start, moleculeLength], [0, feature.end]]
      : [[feature.start, feature.end]];
  return pieces.some(([from, to]) => intervals.some(([start, end]) => from < end && to > start));
}

/**
 * The sentence a product's result line adds when the builder left features out
 * because they cross one of its boundaries: a cut, an amplicon end or a part
 * end. Names the first three, then counts the rest; null when nothing was left
 * out, so the line reads as before. An imported GenBank `source` feature
 * describes the whole record, so any cut crosses it, and a proposed ORF is a
 * guess, not an annotation: neither is named.
 */
export function describeFeaturesLeftOut(
  features: ReadonlyArray<Pick<Feature, 'name' | 'type' | 'metadata'>>,
  boundary: 'cut' | 'amplicon' | 'part',
  productCount = 1,
): string | null {
  const names = features
    .filter((feature) => feature.metadata.motifOriginalFeatureKey !== 'source' && !isProposedAnnotation(feature))
    .map((feature) => feature.name.trim() || feature.type);
  if (names.length === 0) return null;
  const one = names.length === 1;
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  const listed = rest > 0
    ? `${shown.join(', ')} and ${rest} more`
    : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}` : shown[0];
  const crosses = boundary === 'cut'
    ? productCount === 1 ? 'the cut' : 'a cut'
    : boundary === 'amplicon' ? 'an amplicon end' : 'a part end';
  const absent = boundary === 'cut' && productCount === 2
    ? 'in neither fragment'
    : boundary === 'cut' && productCount > 2 ? 'in no fragment' : `not in the ${boundary === 'cut' ? 'linearized record' : 'product'}`;
  return `${names.length} feature${one ? '' : 's'} ${one ? 'crosses' : 'cross'} ${crosses} and ${one ? 'is' : 'are'} ${absent}: ${listed}.`;
}

/**
 * Carry each part's features onto a ligation product. The product is the parts'
 * sequences joined in order, so a feature moves by the summed length of the
 * parts before it. A feature that does not lie inside its own part (a wrapped
 * or out-of-range location) is left behind rather than guessed, and pushed on
 * `leftOut` so the result can say so. Returns [] when the parts do not add up
 * to the product, so a mismatch never mislabels bases.
 */
export function carryLigationPartFeatures<F extends CarriedFeatureShape>(
  parts: ReadonlyArray<{ sequence: string; features?: readonly F[] }>,
  productLength: number,
  leftOut?: F[],
): F[] {
  const total = parts.reduce((sum, part) => sum + part.sequence.length, 0);
  if (total !== productLength) return [];
  const carried: F[] = [];
  let offset = 0;
  for (const part of parts) {
    const length = part.sequence.length;
    for (const feature of part.features ?? []) {
      if (isUnreviewedGuess(feature)) continue;
      const inside = Number.isInteger(feature.start) && Number.isInteger(feature.end)
        && feature.start >= 0 && feature.end > feature.start && feature.end <= length
        && (feature.subRanges ?? []).every((range) => range.start >= 0 && range.end > range.start && range.end <= length);
      if (!inside) {
        leftOut?.push(feature);
        continue;
      }
      carried.push({
        ...feature,
        start: feature.start + offset,
        end: feature.end + offset,
        ...(feature.subRanges === undefined
          ? {}
          : { subRanges: feature.subRanges.map((range) => ({ ...range, start: range.start + offset, end: range.end + offset })) }),
        ...carriedQualifiers(feature, { base: (index) => (index >= 0 && index < length ? index + offset : null) }),
      });
    }
    offset += length;
  }
  return carried;
}

/**
 * Carry a part's features onto an overlap-assembly product by locating the
 * part's own bases in it. Gibson shares each overlap between neighbours, so a
 * part's sequence still appears contiguously in the product and its features
 * move by where it landed; a part used reverse-complemented is flipped first. A
 * part contributes nothing when its sequence appears more than once or does not
 * appear: an ambiguous placement must not label bases it cannot prove. A
 * feature that does not lie inside its part (a location across a circular
 * part's origin) is pushed on `leftOut`.
 */
export function carryOverlapPartFeatures<F extends CarriedFeatureShape>(
  parts: ReadonlyArray<{ sequence: string; features?: readonly F[]; orientation?: 'forward' | 'reverse' }>,
  productSequence: string,
  leftOut?: F[],
): F[] {
  const product = productSequence.toUpperCase();
  const carried: F[] = [];
  for (const part of parts.map(orientPart)) {
    const sequence = part.sequence.toUpperCase();
    if (!sequence || sequence.length > product.length) continue;
    const at = product.indexOf(sequence);
    if (at < 0 || product.indexOf(sequence, at + 1) >= 0) continue;
    for (const feature of part.features ?? []) {
      if (isUnreviewedGuess(feature)) continue;
      const inside = Number.isInteger(feature.start) && Number.isInteger(feature.end)
        && feature.start >= 0 && feature.end > feature.start && feature.end <= sequence.length
        && (feature.subRanges ?? []).every((range) => range.start >= 0 && range.end > range.start && range.end <= sequence.length);
      if (!inside) {
        leftOut?.push(feature);
        continue;
      }
      // Drop keys whose value is undefined: a record input is validated as JSON,
      // and a spread copy of a stored feature keeps `subRanges: undefined`.
      const defined = Object.fromEntries(Object.entries(feature).filter(([, value]) => value !== undefined)) as F;
      carried.push({
        ...defined,
        start: at + feature.start,
        end: at + feature.end,
        ...(feature.subRanges === undefined
          ? {}
          : { subRanges: feature.subRanges.map((range) => ({ ...range, start: at + range.start, end: at + range.end })) }),
        ...carriedQualifiers(feature, { base: (index) => (index >= 0 && index < sequence.length ? at + index : null) }),
      });
    }
  }
  return carried;
}

/**
 * Carry each part's features onto a Golden Gate product. Type IIS digestion
 * keeps only `sequence[insertStart, insertEnd)` of a part, and every released
 * piece after the first shares its left overhang with the piece before it, so a
 * part's bases sit at a running offset rather than at a plain sum of lengths.
 *
 * A feature is carried only when it lies wholly inside its part's released
 * region: one that crosses a trim boundary — a recognition site, its spacer, or
 * the flank beyond it — is dropped rather than clipped, because those bases are
 * absent from the product. For a circular product the last part's trailing
 * overhang is the first part's leading overhang, so a feature reaching into it
 * is dropped too rather than wrapped. Each part is placed only when the product
 * really carries its released bases there; a part that fails that check
 * contributes nothing, so an unproven placement never labels bases. A feature
 * that crosses a trim boundary is pushed on `leftOut`; one wholly outside the
 * released region is not, since the design discards those bases on purpose.
 */
export function carryGoldenGatePartFeatures<F extends CarriedFeatureShape>(
  parts: ReadonlyArray<{
    sequence: string;
    insertStart: number | null;
    insertEnd: number | null;
    features?: readonly F[];
    orientation?: 'forward' | 'reverse';
  }>,
  overhangLength: number,
  productSequence: string,
  topology: Topology,
  leftOut?: F[],
): F[] {
  if (!Number.isInteger(overhangLength) || overhangLength <= 0 || parts.length === 0) return [];
  const product = productSequence.toUpperCase();
  // A design part's insert bounds are measured on its oriented sequence.
  parts = parts.map(orientPart);
  const released = parts.map((part) => {
    const { insertStart, insertEnd } = part;
    if (!Number.isInteger(insertStart) || !Number.isInteger(insertEnd)) return null;
    const start = insertStart as number;
    const end = insertEnd as number;
    if (start < 0 || end <= start || end > part.sequence.length) return null;
    const piece = part.sequence.slice(start, end).toUpperCase();
    return piece.length > overhangLength ? piece : null;
  });
  if (released.some((piece) => piece === null)) return [];
  const pieces = released as string[];
  const joined = pieces.reduce((sum, piece) => sum + piece.length, 0)
    - overhangLength * (parts.length - 1)
    - (topology === 'circular' ? overhangLength : 0);
  if (joined !== product.length) return [];

  const carried: F[] = [];
  let offset = 0;
  parts.forEach((part, index) => {
    const piece = pieces[index];
    const head = Math.min(piece.length, product.length - offset);
    const placed = head > 0
      && product.slice(offset, offset + head) === piece.slice(0, head)
      && (head === piece.length
        || (topology === 'circular' && product.slice(0, piece.length - head) === piece.slice(head)));
    if (placed) {
      const start = part.insertStart as number;
      const end = part.insertEnd as number;
      const shift = offset - start;
      for (const feature of part.features ?? []) {
        if (isUnreviewedGuess(feature)) continue;
        const inside = Number.isInteger(feature.start) && Number.isInteger(feature.end)
          && feature.start >= start && feature.end > feature.start && feature.end <= end
          && feature.end + shift <= product.length
          && (feature.subRanges ?? []).every((range) => (
            range.start >= start && range.end > range.start && range.end <= end
          ));
        if (!inside) {
          // A feature wholly outside the released bases (a donor backbone) is
          // meant to go; one that reaches into them crosses a part end.
          if (featureOverlapsIntervals(feature, [[start, end]], part.sequence.length)) leftOut?.push(feature);
          continue;
        }
        // Drop keys whose value is undefined: a record input is validated as
        // JSON, and a spread copy of a stored feature keeps `subRanges: undefined`.
        const defined = Object.fromEntries(Object.entries(feature).filter(([, value]) => value !== undefined)) as F;
        carried.push({
          ...defined,
          start: feature.start + shift,
          end: feature.end + shift,
          ...(feature.subRanges === undefined
            ? {}
            : { subRanges: feature.subRanges.map((range) => ({ ...range, start: range.start + shift, end: range.end + shift })) }),
          ...carriedQualifiers(feature, {
            base: (index) => (index >= start && index < end && index + shift < product.length ? index + shift : null),
          }),
        });
      }
    }
    offset += piece.length - overhangLength;
  });
  return carried;
}
