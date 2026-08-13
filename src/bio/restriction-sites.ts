import type {
  RestrictionCleavageMode,
  RestrictionCleavageStatus,
  RestrictionEnzyme,
  RestrictionMethylationState,
  RestrictionMethylationTarget,
  RestrictionMethylationEvidence,
  RestrictionSite,
  Topology,
} from './types';
import { RESTRICTION_ENZYMES_FULL } from './enzyme-data';
import { reverseComplement } from './reverse-complement';

/**
 * Options for [`findRestrictionSites`].
 * Circular topology causes the scanner to wrap across the origin.
 */
export interface FindRestrictionSitesOptions {
  /**
   * Sequence topology. When `'circular'`, the scanner appends a wrap window
   * `seq.slice(0, recognitionMaxLen - 1)` so that recognition strings
   * straddling the origin are matched. Defaults to `'linear'`.
   */
  topology?: Topology;
  /** Explicit molecular-state assumption for methylation-sensitive enzymes. */
  methylation?: RestrictionMethylationState | Partial<Record<RestrictionMethylationTarget, RestrictionMethylationState>>;
  /** Singular alias for integrations that carry one global state. */
  methylationState?: RestrictionMethylationState;
  /** Alias accepted by workflow callers that keep assumptions plural. */
  methylationAssumptions?: RestrictionMethylationState | Partial<Record<RestrictionMethylationTarget, RestrictionMethylationState>>;
}

export type RestrictionIssueCode =
  | 'invalid_sequence'
  | 'invalid_recognition_sequence'
  | 'invalid_enzyme_name'
  | 'invalid_topology'
  | 'scan_work_limit'
  | 'insufficient_flanking_bases'
  | 'methylation_unknown'
  | 'methylation_unmethylated'
  | 'methylation_context_unknown'
  | 'invalid_geometry'
  | 'circular_geometry_exceeds_molecule'
  | 'result_limit'
  | 'unknown_enzyme';

export interface RestrictionScanIssue {
  code: RestrictionIssueCode;
  message: string;
  enzyme?: string;
  position?: number;
  topCutPosition?: number | null;
  bottomCutPosition?: number | null;
  required?: string;
  observed?: string;
  evidence?: RestrictionMethylationEvidence;
  retainedSites?: number;
  omittedSitesAtLeast?: number;
  retainedIssues?: number;
}

export type RestrictionScanDiagnosticCode = 'result_limit';

export interface RestrictionScanDiagnostic {
  code: RestrictionScanDiagnosticCode;
  message: string;
  retainedSites: number;
  omittedSitesAtLeast: number;
  retainedIssues: number;
  maxSites: number;
  maxIssues: number;
  maxOutputBytes: number;
}

/** The physical coordinates of both strand cleavages for one recognition site. */
export interface RestrictionCleavageGeometry {
  mode: RestrictionCleavageMode;
  topCutPosition: number | null;
  bottomCutPosition: number | null;
  /** Legacy digest boundary: top nick for double-strand/top-nick sites. */
  cutPosition: number;
  overhangStart: number;
  overhangEnd: number;
  overhangLength: number;
  valid: boolean;
  /** Canonical enzyme identities sharing this physical cut, when digested as a set. */
  enzymes?: string[];
}

export interface RestrictionScanResult {
  sequence: string;
  topology: Topology;
  sites: RestrictionSite[];
  issues: RestrictionScanIssue[];
  /** False when a result cardinality/output ceiling stopped enumeration. */
  complete: boolean;
  diagnostics: RestrictionScanDiagnostic[];
}

/**
 * The activity category for one requested enzyme after scanning. Categories
 * are deliberately more precise than the historical `findNonCutters`
 * boolean: a nick, a conditional site, and a legacy record without physical
 * safety fields are not scientifically interchangeable with no recognition
 * site.
 */
export type RestrictionEnzymeScanCategory =
  | 'no-site'
  | 'active-double-strand'
  | 'nick-only'
  | 'conditional'
  | 'insufficient-flanking-bases'
  | 'invalid-geometry'
  | 'legacy-unsafe';

export interface RestrictionEnzymeScanReceipt {
  enzyme: RestrictionEnzyme;
  sites: RestrictionSite[];
  issues: RestrictionScanIssue[];
  category: RestrictionEnzymeScanCategory;
  activeDoubleStrandSiteCount: number;
  nickSiteCount: number;
  conditionalSiteCount: number;
  insufficientFlankingSiteCount: number;
  invalidGeometrySiteCount: number;
  legacyUnsafeSiteCount: number;
  /** False when the underlying scan was truncated by a result ceiling. */
  complete: boolean;
  diagnostics: RestrictionScanDiagnostic[];
}

export class RestrictionInputError extends Error {
  readonly code: 'invalid_sequence' | 'invalid_recognition_sequence' | 'invalid_enzyme_name' | 'invalid_topology' | 'scan_work_limit' | 'result_limit';

  constructor(
    code: 'invalid_sequence' | 'invalid_recognition_sequence' | 'invalid_enzyme_name' | 'invalid_topology' | 'scan_work_limit' | 'result_limit',
    message: string,
  ) {
    super(message);
    this.name = 'RestrictionInputError';
    this.code = code;
  }
}

/** Thrown by exhaustive compatibility wrappers when detailed scanning is partial. */
export class RestrictionScanResultLimitError extends RestrictionInputError {
  readonly result: RestrictionScanResult;

  constructor(result: RestrictionScanResult) {
    super('result_limit', result.diagnostics.map((diagnostic) => diagnostic.message).join(' '));
    this.name = 'RestrictionScanResultLimitError';
    this.result = result;
  }
}

const RESTRICTION_METHYLATION_TARGETS = new Set<RestrictionMethylationTarget>([
  'dam',
  'dcm',
  'cpg',
  'custom',
]);
const RESTRICTION_METHYLATION_STATES = new Set<RestrictionMethylationState>([
  'unknown',
  'methylated',
  'unmethylated',
]);
const MAX_RESTRICTION_METHYLATION_TEXT_LENGTH = 4_096;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

const INVALID_ENZYME_PROPERTY = Symbol('invalid-enzyme-property');

/**
 * Read a direct data property without invoking an accessor. Restriction
 * enzymes cross an agent/tool boundary, so inherited or executable fields
 * must not be treated as catalog data.
 */
function ownEnzymeProperty(
  value: Record<string, unknown>,
  key: string,
): unknown | typeof INVALID_ENZYME_PROPERTY | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    return 'value' in descriptor ? descriptor.value : INVALID_ENZYME_PROPERTY;
  } catch {
    return INVALID_ENZYME_PROPERTY;
  }
}

/** Reject holes and accessors before indexing a bounded input array. */
function assertDenseRestrictionArray(
  value: unknown,
  label: string,
  code: 'invalid_enzyme_name' | 'invalid_recognition_sequence',
  maxLength: number,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new RestrictionInputError(code, `${label} must be an array.`);
  }
  let length: number;
  try {
    length = value.length;
  } catch {
    throw new RestrictionInputError(code, `${label} length could not be inspected safely.`);
  }
  if (length > maxLength) {
    throw new RestrictionInputError(
      code,
      `${label} accepts at most ${maxLength} entries per request.`,
    );
  }
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    } catch {
      throw new RestrictionInputError(code, `${label}[${index}] could not be inspected safely.`);
    }
    if (!descriptor) {
      throw new RestrictionInputError(code, `${label}[${index}] is missing; sparse arrays are not accepted.`);
    }
    if (!('value' in descriptor)) {
      throw new RestrictionInputError(code, `${label}[${index}] must be a direct data value, not an accessor.`);
    }
  }
}

function validMethylationText(value: unknown, allowEmpty = false): value is string {
  return typeof value === 'string'
    && (allowEmpty || value.length > 0)
    && value.length <= MAX_RESTRICTION_METHYLATION_TEXT_LENGTH
    && !hasControlCharacters(value);
}

function validateMethylationEvidence(value: unknown, label: string): void {
  const evidence = isPlainObject(value) ? value : null;
  const source = evidence ? ownEnzymeProperty(evidence, 'source') : undefined;
  const sourceLabel = evidence ? ownEnzymeProperty(evidence, 'sourceLabel') : undefined;
  const conditions = evidence ? ownEnzymeProperty(evidence, 'conditions') : undefined;
  const limitation = evidence ? ownEnzymeProperty(evidence, 'limitation') : undefined;
  if (!evidence
    || source === INVALID_ENZYME_PROPERTY
    || sourceLabel === INVALID_ENZYME_PROPERTY
    || conditions === INVALID_ENZYME_PROPERTY
    || limitation === INVALID_ENZYME_PROPERTY
    || !validMethylationText(source)
    || !validMethylationText(sourceLabel)
    || !validMethylationText(conditions)
    || (limitation !== undefined && !validMethylationText(limitation, true))) {
    throw new RestrictionInputError(
      'invalid_recognition_sequence',
      `${label} must contain bounded source, sourceLabel, and conditions text, with an optional bounded limitation.`,
    );
  }
}

function validateMethylationMetadata(enzyme: Partial<RestrictionEnzyme>, name: string): void {
  const requirement = enzyme.methylationRequirement;
  if (requirement !== undefined) {
    const requirementObject = isPlainObject(requirement) ? requirement : null;
    const target: unknown = requirementObject ? ownEnzymeProperty(requirementObject, 'target') : undefined;
    const state: unknown = requirementObject ? ownEnzymeProperty(requirementObject, 'state') : undefined;
    const evidence: unknown = requirementObject ? ownEnzymeProperty(requirementObject, 'evidence') : undefined;
    if (!RESTRICTION_METHYLATION_TARGETS.has(target as RestrictionMethylationTarget)
      || !RESTRICTION_METHYLATION_STATES.has(state as RestrictionMethylationState)
      || state === 'unknown') {
      throw new RestrictionInputError(
        'invalid_recognition_sequence',
        `Restriction enzyme "${name}" has invalid methylationRequirement metadata.`,
      );
    }
    if (evidence === INVALID_ENZYME_PROPERTY) {
      throw new RestrictionInputError(
        'invalid_recognition_sequence',
        `Restriction enzyme "${name}" methylationRequirement.evidence must be a direct data property.`,
      );
    }
    if (evidence !== undefined) {
      validateMethylationEvidence(evidence, `Restriction enzyme "${name}" methylationRequirement.evidence`);
    }
  }
  if (enzyme.methylationBehavior !== undefined && enzyme.methylationBehavior !== 'context_dependent') {
    throw new RestrictionInputError(
      'invalid_recognition_sequence',
      `Restriction enzyme "${name}" has invalid methylationBehavior metadata.`,
    );
  }
  if (enzyme.methylationEvidence !== undefined) {
    validateMethylationEvidence(enzyme.methylationEvidence, `Restriction enzyme "${name}" methylationEvidence`);
  }
}

/** Normalize requested enzyme names at the digest boundary. */
export function normalizeRestrictionEnzymeNames(value: unknown): string[] {
  assertDenseRestrictionArray(
    value,
    'Restriction enzyme names',
    'invalid_enzyme_name',
    MAX_RESTRICTION_ENZYMES,
  );
  const names: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const rawName = value[index];
    if (typeof rawName !== 'string') {
      throw new RestrictionInputError('invalid_enzyme_name', `Restriction enzyme name ${index + 1} must be a string.`);
    }
    const name = rawName.trim();
    if (!name || name.length > MAX_RESTRICTION_ENZYME_NAME_LENGTH || hasControlCharacters(name)) {
      throw new RestrictionInputError(
        'invalid_enzyme_name',
        `Restriction enzyme name ${index + 1} must be 1–${MAX_RESTRICTION_ENZYME_NAME_LENGTH} characters without control characters.`,
      );
    }
    names.push(name);
  }
  return names;
}

/** Hard limits for the browser-facing restriction scanner. */
export const MAX_RESTRICTION_ENZYMES = 512;
export const MAX_RESTRICTION_ENZYME_NAME_LENGTH = 128;
export const MAX_RESTRICTION_RECOGNITION_LENGTH = 64;
export const MAX_RESTRICTION_CUT_OFFSET = 1_000;
export const MAX_RESTRICTION_SEQUENCE_LENGTH = 1_000_000;
export const MAX_RESTRICTION_SCAN_WORK_UNITS = 100_000_000;
/** Maximum number of retained site objects in one detailed scan. */
export const MAX_RESTRICTION_RESULT_SITES = 100_000;
/** Maximum number of retained issue objects, including one result-limit marker. */
export const MAX_RESTRICTION_RESULT_ISSUES = 100_000;
/** Approximate serialized output budget for one detailed scan. */
export const MAX_RESTRICTION_RESULT_BYTES = 32 * 1024 * 1024;
/** Reserved space for the final typed result-limit diagnostic and issue. */
const RESTRICTION_RESULT_LIMIT_RECEIPT_RESERVE_BYTES = 16 * 1024;

const restrictionTextEncoder = new TextEncoder();

function serializedRestrictionBytes(value: unknown): number {
  return restrictionTextEncoder.encode(JSON.stringify(value)).byteLength;
}

const IUPAC_BASES: Readonly<Record<string, ReadonlySet<string>>> = {
  A: new Set(['A']),
  C: new Set(['C']),
  G: new Set(['G']),
  T: new Set(['T']),
  R: new Set(['A', 'G']),
  Y: new Set(['C', 'T']),
  S: new Set(['G', 'C']),
  W: new Set(['A', 'T']),
  K: new Set(['G', 'T']),
  M: new Set(['A', 'C']),
  B: new Set(['C', 'G', 'T']),
  D: new Set(['A', 'G', 'T']),
  H: new Set(['A', 'C', 'T']),
  V: new Set(['A', 'C', 'G']),
  N: new Set(['A', 'C', 'G', 'T']),
};

const IUPAC_SYMBOLS = new Set(Object.keys(IUPAC_BASES));

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

/** Remove display whitespace/numbering and normalize RNA U to DNA T. */
export function normalizeRestrictionSequence(seq: string): string {
  if (typeof seq !== 'string') {
    throw new RestrictionInputError('invalid_sequence', 'Restriction sequence must be a string.');
  }
  let normalized = '';
  for (const raw of seq.toUpperCase()) {
    if (/\s/.test(raw) || /[0-9]/.test(raw)) continue;
    const ch = raw === 'U' ? 'T' : raw;
    if (!IUPAC_SYMBOLS.has(ch)) {
      throw new RestrictionInputError(
        'invalid_sequence',
        `Restriction sequence contains unsupported symbol "${raw}". Use DNA/IUPAC symbols, whitespace, or numbering.`,
      );
    }
    normalized += ch;
    if (normalized.length > MAX_RESTRICTION_SEQUENCE_LENGTH) {
      throw new RestrictionInputError(
        'invalid_sequence',
        `Restriction sequence exceeds the ${MAX_RESTRICTION_SEQUENCE_LENGTH.toLocaleString()}-base safety limit.`,
      );
    }
  }
  return normalized;
}

/** Normalize and validate a custom enzyme recognition string. */
export function normalizeRestrictionRecognitionSequence(seq: string): string {
  if (typeof seq !== 'string') {
    throw new RestrictionInputError('invalid_recognition_sequence', 'Restriction recognition sequence must be a string.');
  }
  const normalized = seq.replace(/\s/g, '').toUpperCase().replaceAll('U', 'T');
  if (!normalized || [...normalized].some((ch) => !IUPAC_SYMBOLS.has(ch))) {
    throw new RestrictionInputError(
      'invalid_recognition_sequence',
      'Restriction recognition sequence must contain one or more IUPAC DNA symbols.',
    );
  }
  if (normalized.length > MAX_RESTRICTION_RECOGNITION_LENGTH) {
    throw new RestrictionInputError(
      'invalid_recognition_sequence',
      `Restriction recognition sequence exceeds the ${MAX_RESTRICTION_RECOGNITION_LENGTH}-symbol safety limit.`,
    );
  }
  return normalized;
}

/** Validate the runtime topology boundary instead of falling back silently. */
export function normalizeRestrictionTopology(value: unknown): Topology {
  if (value === undefined) return 'linear';
  if (value === 'linear' || value === 'circular') return value;
  throw new RestrictionInputError(
    'invalid_topology',
    'Restriction topology must be exactly "linear" or "circular".',
  );
}

export function isValidRestrictionRecognitionSequence(seq: string): boolean {
  try {
    normalizeRestrictionRecognitionSequence(seq);
    return true;
  } catch {
    return false;
  }
}

/** Normalize a complete runtime enzyme list before any scan or catalog lookup. */
export function normalizeRestrictionEnzymes(enzymes: unknown): RestrictionEnzyme[] {
  assertDenseRestrictionArray(
    enzymes,
    'Restriction enzymes',
    'invalid_recognition_sequence',
    MAX_RESTRICTION_ENZYMES,
  );
  const seenNames = new Set<string>();
  const normalizedEnzymes: RestrictionEnzyme[] = [];
  for (let index = 0; index < enzymes.length; index += 1) {
    const rawEnzyme = enzymes[index];
    if (!isPlainObject(rawEnzyme)) {
      throw new RestrictionInputError('invalid_recognition_sequence', `Restriction enzyme ${index + 1} must be an object.`);
    }
    const candidate = rawEnzyme;
    const nameValue = ownEnzymeProperty(candidate, 'name');
    const recognitionValue = ownEnzymeProperty(candidate, 'recognitionSequence');
    const cutOffsetValue = ownEnzymeProperty(candidate, 'cutOffset');
    const complementCutOffsetValue = ownEnzymeProperty(candidate, 'complementCutOffset');
    const overhangValue = ownEnzymeProperty(candidate, 'overhang');
    const cleavageModeValue = ownEnzymeProperty(candidate, 'cleavageMode');
    const methylationRequirementValue = ownEnzymeProperty(candidate, 'methylationRequirement');
    const methylationBehaviorValue = ownEnzymeProperty(candidate, 'methylationBehavior');
    const methylationEvidenceValue = ownEnzymeProperty(candidate, 'methylationEvidence');
    const hasInvalidAccessor = [
      nameValue,
      recognitionValue,
      cutOffsetValue,
      complementCutOffsetValue,
      overhangValue,
      cleavageModeValue,
      methylationRequirementValue,
      methylationBehaviorValue,
      methylationEvidenceValue,
    ].some((value) => value === INVALID_ENZYME_PROPERTY);
    if (hasInvalidAccessor) {
      throw new RestrictionInputError(
        'invalid_recognition_sequence',
        `Restriction enzyme ${index + 1} must contain direct data properties; accessors are not accepted.`,
      );
    }
    if (typeof nameValue !== 'string') {
      throw new RestrictionInputError('invalid_recognition_sequence', `Restriction enzyme ${index + 1} name must be a string.`);
    }
    const name = nameValue.trim();
    if (!name || name.length > MAX_RESTRICTION_ENZYME_NAME_LENGTH || hasControlCharacters(name)) {
      throw new RestrictionInputError(
        'invalid_recognition_sequence',
        `Restriction enzyme ${index + 1} name must be 1–${MAX_RESTRICTION_ENZYME_NAME_LENGTH} characters without control characters.`,
      );
    }
    const nameKey = name.toLowerCase();
    if (seenNames.has(nameKey)) {
      throw new RestrictionInputError('invalid_recognition_sequence', `Restriction enzyme names must be unique; "${name}" appears more than once.`);
    }
    seenNames.add(nameKey);
    const recognitionSequence = normalizeRestrictionRecognitionSequence(recognitionValue as string);
    const validOffset = (value: unknown): value is number => (
      Number.isSafeInteger(value) && (value as number) >= -MAX_RESTRICTION_CUT_OFFSET && (value as number) <= MAX_RESTRICTION_CUT_OFFSET
    );
    if (!validOffset(cutOffsetValue) || !validOffset(complementCutOffsetValue)) {
      throw new RestrictionInputError(
        'invalid_recognition_sequence',
        `Restriction enzyme "${name}" cut offsets must be safe integers from -${MAX_RESTRICTION_CUT_OFFSET} to ${MAX_RESTRICTION_CUT_OFFSET}.`,
      );
    }
    const cleavageMode = cleavageModeValue === undefined ? 'double-strand' : cleavageModeValue;
    if (cleavageMode !== 'double-strand' && cleavageMode !== 'nick_top' && cleavageMode !== 'nick_bottom') {
      throw new RestrictionInputError('invalid_recognition_sequence', `Restriction enzyme "${name}" has an invalid cleavage mode.`);
    }
    if (overhangValue !== 'blunt' && overhangValue !== '5prime' && overhangValue !== '3prime') {
      throw new RestrictionInputError('invalid_recognition_sequence', `Restriction enzyme "${name}" has an invalid overhang type.`);
    }
    validateMethylationMetadata({
      ...(methylationRequirementValue === undefined ? {} : {
        methylationRequirement: methylationRequirementValue as RestrictionEnzyme['methylationRequirement'],
      }),
      ...(methylationBehaviorValue === undefined ? {} : {
        methylationBehavior: methylationBehaviorValue as RestrictionEnzyme['methylationBehavior'],
      }),
      ...(methylationEvidenceValue === undefined ? {} : {
        methylationEvidence: methylationEvidenceValue as RestrictionEnzyme['methylationEvidence'],
      }),
    }, name);
    const cloneEvidence = (
      evidence: RestrictionEnzyme['methylationEvidence'],
    ): RestrictionEnzyme['methylationEvidence'] => evidence === undefined ? undefined : {
      source: evidence.source,
      sourceLabel: evidence.sourceLabel,
      conditions: evidence.conditions,
      ...(evidence.limitation === undefined ? {} : { limitation: evidence.limitation }),
    };
    const requirement = methylationRequirementValue as RestrictionEnzyme['methylationRequirement'];
    const normalized: RestrictionEnzyme = {
      name,
      recognitionSequence,
      cutOffset: cutOffsetValue,
      complementCutOffset: complementCutOffsetValue,
      overhang: overhangValue,
      cleavageMode,
      ...(requirement === undefined ? {} : {
        methylationRequirement: {
          target: requirement.target,
          state: requirement.state,
          ...(requirement.evidence === undefined
            ? {}
            : { evidence: cloneEvidence(requirement.evidence) }),
        },
      }),
      ...(methylationBehaviorValue !== undefined ? { methylationBehavior: methylationBehaviorValue as RestrictionEnzyme['methylationBehavior'] } : {}),
      ...(methylationEvidenceValue === undefined ? {} : {
        methylationEvidence: cloneEvidence(methylationEvidenceValue as RestrictionEnzyme['methylationEvidence']),
      }),
    };
    normalizedEnzymes.push(normalized);
  }
  return normalizedEnzymes;
}

function methylationStateFor(
  enzyme: RestrictionEnzyme,
  options: FindRestrictionSitesOptions | undefined,
): RestrictionMethylationState {
  const requirement = enzyme.methylationRequirement;
  if (!requirement) return 'methylated';
  const assumptions = options?.methylationAssumptions ?? options?.methylation ?? options?.methylationState;
  if (typeof assumptions === 'string') return assumptions;
  if (assumptions && assumptions[requirement.target] !== undefined) {
    return assumptions[requirement.target] as RestrictionMethylationState;
  }
  return 'unknown';
}

/** Compute explicit top/bottom nick coordinates before sequence-bound checks. */
export function calculateRestrictionCleavageGeometry(
  enzyme: RestrictionEnzyme,
  sitePosition: number,
  strand: 1 | -1 = 1,
): RestrictionCleavageGeometry {
  const recognitionLength = normalizeRestrictionRecognitionSequence(enzyme.recognitionSequence).length;
  const mode = enzyme.cleavageMode ?? 'double-strand';
  const forwardTop = strand === -1
    ? sitePosition + recognitionLength - enzyme.complementCutOffset
    : sitePosition + enzyme.cutOffset;
  const forwardBottom = strand === -1
    ? sitePosition + recognitionLength - enzyme.cutOffset
    : sitePosition + enzyme.complementCutOffset;
  const topCutPosition = mode === 'nick_bottom' ? null : forwardTop;
  const bottomCutPosition = mode === 'nick_top' ? null : forwardBottom;
  const positions = [topCutPosition, bottomCutPosition].filter((value): value is number => value !== null);
  const finite = positions.length > 0 && positions.every((value) => Number.isFinite(value));
  const cutPosition = positions[0] ?? Number.NaN;
  const overhangStart = finite ? Math.min(...positions) : Number.NaN;
  const overhangEnd = finite ? Math.max(...positions) : Number.NaN;
  const overhangLength = finite ? overhangEnd - overhangStart : Number.NaN;
  const valid = finite
    && Number.isInteger(overhangStart)
    && Number.isInteger(overhangEnd)
    && (mode === 'double-strand' || enzyme.overhang === 'blunt')
    && (mode !== 'double-strand' || (enzyme.overhang === 'blunt' ? overhangLength === 0 : overhangLength > 0));
  return {
    mode,
    topCutPosition,
    bottomCutPosition,
    cutPosition,
    overhangStart,
    overhangEnd,
    overhangLength,
    valid,
  };
}

/**
 * Classify one site without guessing when it came from an older serialized
 * payload. A scanner-produced double-strand site has both safety fields and
 * both physical cut coordinates; a legacy object missing any of those facts
 * is not safe to use as a physical cut assertion.
 */
export function restrictionSiteActivity(
  site: Pick<RestrictionSite, 'cleavageMode' | 'cleavageStatus' | 'topCutPosition' | 'bottomCutPosition'>,
): RestrictionEnzymeScanCategory {
  const mode = site.cleavageMode;
  const status = site.cleavageStatus;
  if (mode === undefined || status === undefined) return 'legacy-unsafe';
  if (mode !== 'double-strand' && mode !== 'nick_top' && mode !== 'nick_bottom') return 'legacy-unsafe';

  // An explicit scanner status is itself a safety receipt. Preserve it even
  // when the associated coordinates are intentionally non-materializable.
  if (status === 'invalid_geometry') return 'invalid-geometry';
  if (status === 'insufficient_flanking_bases') return 'insufficient-flanking-bases';
  if (
    status === 'methylation_unknown'
    || status === 'methylation_unmethylated'
    || status === 'methylation_context_unknown'
  ) return 'conditional';
  if (status !== 'ok') return 'legacy-unsafe';

  const hasInteger = (value: number | null | undefined): value is number => (
    value !== null && value !== undefined && Number.isInteger(value) && value >= 0
  );
  const completeGeometry = mode === 'double-strand'
    ? hasInteger(site.topCutPosition) && hasInteger(site.bottomCutPosition)
    : mode === 'nick_bottom'
      ? site.topCutPosition === null && hasInteger(site.bottomCutPosition)
      : site.bottomCutPosition === null && hasInteger(site.topCutPosition);
  if (!completeGeometry) return 'legacy-unsafe';
  return mode === 'double-strand' ? 'active-double-strand' : 'nick-only';
}

/** True only for a complete, scanner-safe physical double-strand site. */
export function isActiveDoubleStrandRestrictionSite(
  site: Pick<RestrictionSite, 'cleavageMode' | 'cleavageStatus' | 'topCutPosition' | 'bottomCutPosition'>,
): boolean {
  return restrictionSiteActivity(site) === 'active-double-strand';
}

function coordinateInLinearSequence(value: number | null, length: number): boolean {
  return value === null || (Number.isInteger(value) && value >= 0 && value <= length);
}

function issueForSite(
  enzyme: RestrictionEnzyme,
  sitePosition: number,
  geometry: RestrictionCleavageGeometry,
  sequenceLength: number,
  topology: Topology,
  options: FindRestrictionSitesOptions | undefined,
  rawGeometry: RestrictionCleavageGeometry = geometry,
): RestrictionScanIssue | null {
  if (!geometry.valid) {
    return {
      code: 'invalid_geometry',
      message: `Enzyme ${enzyme.name} has inconsistent ${geometry.mode} cleavage geometry.`,
      enzyme: enzyme.name,
      position: sitePosition,
      topCutPosition: geometry.topCutPosition,
      bottomCutPosition: geometry.bottomCutPosition,
    };
  }
  if (topology === 'circular') {
    const rawPositions = [rawGeometry.topCutPosition, rawGeometry.bottomCutPosition]
      .filter((value): value is number => value !== null);
    const crossesMoreThanOneCircumference = normalizeRestrictionRecognitionSequence(enzyme.recognitionSequence).length > sequenceLength
      || geometry.overhangLength > sequenceLength
      || rawPositions.some((position) => Math.abs(position - sitePosition) > sequenceLength);
    if (crossesMoreThanOneCircumference) {
      return {
        code: 'circular_geometry_exceeds_molecule',
        message: `Enzyme ${enzyme.name} recognition or cleavage geometry traverses more than one circumference of the circular sequence and cannot be materialized.`,
        enzyme: enzyme.name,
        position: sitePosition,
        topCutPosition: geometry.topCutPosition,
        bottomCutPosition: geometry.bottomCutPosition,
        required: 'recognition and cleavage intervals must traverse no more than one sequence circumference',
      };
    }
  }
  if (topology === 'linear' && (!coordinateInLinearSequence(geometry.topCutPosition, sequenceLength)
    || !coordinateInLinearSequence(geometry.bottomCutPosition, sequenceLength))) {
    return {
      code: 'insufficient_flanking_bases',
      message: `Enzyme ${enzyme.name} requires strand cleavage coordinates outside the linear sequence bounds.`,
      enzyme: enzyme.name,
      position: sitePosition,
      topCutPosition: geometry.topCutPosition,
      bottomCutPosition: geometry.bottomCutPosition,
      required: 'all strand cut coordinates within [0, sequence.length]',
    };
  }
  const requirement = enzyme.methylationRequirement;
  if (enzyme.methylationBehavior === 'context_dependent') {
    const assumptions = options?.methylationAssumptions ?? options?.methylation ?? options?.methylationState;
    const state = typeof assumptions === 'string'
      ? assumptions
      : assumptions?.cpg ?? 'unknown';
    if (state !== 'unmethylated') {
      return {
        code: 'methylation_context_unknown',
        message: `Enzyme ${enzyme.name} has context-dependent methylation behavior that Motif cannot resolve from a global state.`,
        enzyme: enzyme.name,
        position: sitePosition,
        observed: state,
        evidence: enzyme.methylationEvidence,
      };
    }
  }
  if (requirement) {
    const state = methylationStateFor(enzyme, options);
    if (state === 'unknown') {
      return {
        code: 'methylation_unknown',
        message: `Enzyme ${enzyme.name} requires ${requirement.target}=${requirement.state}, but the requested state is unknown.`,
        enzyme: enzyme.name,
        position: sitePosition,
        required: `${requirement.target}:${requirement.state}`,
        observed: state,
        evidence: requirement.evidence,
      };
    }
    if (state !== requirement.state) {
      return {
        code: 'methylation_unmethylated',
        message: `Enzyme ${enzyme.name} requires ${requirement.target}=${requirement.state}; requested state was ${state}.`,
        enzyme: enzyme.name,
        position: sitePosition,
        required: `${requirement.target}:${requirement.state}`,
        observed: state,
        evidence: requirement.evidence,
      };
    }
  }
  return null;
}

function concreteIupacMatch(buffer: string, start: number, recognition: string): boolean {
  if (start < 0 || start + recognition.length > buffer.length) return false;
  for (let offset = 0; offset < recognition.length; offset += 1) {
    const sequenceBase = buffer[start + offset];
    // A sequence ambiguity cannot prove a physical recognition site. It is
    // accepted by normalization and reported by countAmbiguousBases, but is
    // conservatively excluded from a cut assertion.
    if (!('ACGT'.includes(sequenceBase) && IUPAC_BASES[recognition[offset]].has(sequenceBase))) return false;
  }
  return true;
}

/**
 * Default working set of restriction enzymes used by the UI and digest functions.
 *
 * Originally the 25-enzyme 6-cutter / Type IIS panel preserved across releases.
 * The eGFP onboarding sample (720 bp) has no canonical 6-cutter
 * site, so the Inspector "Common" tab opened to "0 cuts" — a dead end for
 * first-time users. Five canonical screening 4-cutters (AluI, HaeIII, TaqI,
 * HpaII, MspI) are appended so the default Inspector view yields useful
 * diagnostic digests on short ORF-sized sequences. The new enzymes are pushed
 * to the end so callers that index by position (`RESTRICTION_ENZYMES[1]`,
 * etc.) and the palette in `getRestrictionEnzymeColor` keep their current
 * mappings.
 *
 * For the full 200+ enzyme database use RESTRICTION_ENZYMES_FULL from enzyme-data.ts.
 */
export const RESTRICTION_ENZYMES: RestrictionEnzyme[] = [
  { name: 'EcoRI',  recognitionSequence: 'GAATTC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'BamHI',  recognitionSequence: 'GGATCC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'HindIII', recognitionSequence: 'AAGCTT',  cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'XbaI',   recognitionSequence: 'TCTAGA',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'SalI',   recognitionSequence: 'GTCGAC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'PstI',   recognitionSequence: 'CTGCAG',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'NotI',   recognitionSequence: 'GCGGCCGC', cutOffset: 2, complementCutOffset: 6, overhang: '5prime' },
  { name: 'XhoI',   recognitionSequence: 'CTCGAG',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NcoI',   recognitionSequence: 'CCATGG',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NdeI',   recognitionSequence: 'CATATG',   cutOffset: 2, complementCutOffset: 4, overhang: '5prime' },
  { name: 'SpeI',   recognitionSequence: 'ACTAGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'KpnI',   recognitionSequence: 'GGTACC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SacI',   recognitionSequence: 'GAGCTC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SmaI',   recognitionSequence: 'CCCGGG',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'BglII',  recognitionSequence: 'AGATCT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'ClaI',   recognitionSequence: 'ATCGAT',   cutOffset: 2, complementCutOffset: 4, overhang: '5prime' },
  { name: 'EcoRV',  recognitionSequence: 'GATATC',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'AgeI',   recognitionSequence: 'ACCGGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'NheI',   recognitionSequence: 'GCTAGC',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'MluI',   recognitionSequence: 'ACGCGT',   cutOffset: 1, complementCutOffset: 5, overhang: '5prime' },
  { name: 'BsaI',   recognitionSequence: 'GGTCTC',   cutOffset: 7, complementCutOffset: 11, overhang: '5prime' },
  { name: 'BbsI',   recognitionSequence: 'GAAGAC',   cutOffset: 8, complementCutOffset: 12, overhang: '5prime' },
  { name: 'ScaI',   recognitionSequence: 'AGTACT',   cutOffset: 3, complementCutOffset: 3, overhang: 'blunt' },
  { name: 'ApaI',   recognitionSequence: 'GGGCCC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  { name: 'SphI',   recognitionSequence: 'GCATGC',   cutOffset: 5, complementCutOffset: 1, overhang: '3prime' },
  // Canonical screening 4-cutters that appear in molecular biology
  // kits (RFLP/diagnostic digests, methylation-sensitive pair, RAD-tag panel).
  // Order matches the AluI/HaeIII/TaqI/HpaII/MspI panel called out in the
  // Mirrors RESTRICTION_ENZYMES_FULL entries 1:1 so the digest engine
  // returns identical cut/overhang shapes whichever set the caller passes.
  { name: 'AluI',   recognitionSequence: 'AGCT',     cutOffset: 2, complementCutOffset: 2, overhang: 'blunt'  },
  { name: 'HaeIII', recognitionSequence: 'GGCC',     cutOffset: 2, complementCutOffset: 2, overhang: 'blunt'  },
  { name: 'TaqI',   recognitionSequence: 'TCGA',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
  { name: 'HpaII',  recognitionSequence: 'CCGG',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
  { name: 'MspI',   recognitionSequence: 'CCGG',     cutOffset: 1, complementCutOffset: 3, overhang: '5prime' },
];

for (const enzyme of RESTRICTION_ENZYMES) {
  enzyme.cleavageMode ??= 'double-strand';
}

// The compact working set predates the expanded catalog and historically
// carried shallow copies of several records. Resolve every overlapping name
// to the full catalog record so methylation rules, evidence, and future
// physical metadata cannot drift between the Common and Full sources.
const canonicalFullEnzymes = new Map(
  RESTRICTION_ENZYMES_FULL.map((enzyme) => [enzyme.name.toLowerCase(), enzyme] as const),
);
for (let index = 0; index < RESTRICTION_ENZYMES.length; index += 1) {
  const canonical = canonicalFullEnzymes.get(RESTRICTION_ENZYMES[index].name.toLowerCase());
  if (canonical) RESTRICTION_ENZYMES[index] = canonical;
}

// For the full 200+ enzyme database, import directly from './enzyme-data'.

// Recognition is matched base-by-base rather than interpolated into a RegExp.
// This both handles IUPAC symbols explicitly and makes regex injection
// impossible for custom enzyme records.

/**
 * Find all restriction sites in a sequence for the given enzymes.
 *
 * The scanner checks BOTH strands. For each non-palindromic enzyme,
 * the reverse-complement of the recognition sequence is also scanned and
 * matches are tagged `strand: -1`. This preserves the scanner's strand-aware
 * output structure and is critical for Type IIS enzymes (BsaI/BbsI/BsmBI/SapI/etc.)
 * whose binding sites are not symmetric. Empirically verified: BsaI on
 * `AAAAAAGAGACCTTTTT` (where `GAGACC = revcomp(GGTCTC)`) now correctly
 * returns 1 site at position 6.
 *
 * When `options.topology === 'circular'`, the scanner
 * appends a wrap window so that recognition strings straddling the origin
 * are matched. Returned `position` values stay in `[0, seq.length)`.
 *
 * @param seq - DNA sequence
 * @param enzymes - List of restriction enzymes to scan (defaults to all)
 * @param options - Optional topology hint (default: linear)
 */
export function findRestrictionSites(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionSite[] {
  const result = scanRestrictionSites(seq, enzymes, options);
  if (!result.complete) throw new RestrictionScanResultLimitError(result);
  return result.sites;
}

/** Descriptive alias for callers that need scanner issues as well as sites. */
export const findRestrictionSitesDetailed = scanRestrictionSites;

/**
 * Scan both strands while retaining physical cleavage geometry and structured
 * conditional outcomes. `findRestrictionSites` remains the compatibility
 * wrapper for callers that only need the site array.
 */
export function scanRestrictionSites(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionScanResult {
  const upper = normalizeRestrictionSequence(seq);
  const topology = normalizeRestrictionTopology(options?.topology);
  const sites: RestrictionSite[] = [];
  const issues: RestrictionScanIssue[] = [];
  const normalizedEnzymes = normalizeRestrictionEnzymes(enzymes);
  const diagnostics: RestrictionScanDiagnostic[] = [];
  if (upper.length === 0 || normalizedEnzymes.length === 0) {
    return { sequence: upper, topology, sites, issues, complete: true, diagnostics };
  }
  let patternCount = 0;
  let recognitionWork = 0;
  let maxRecLen = 0;
  for (const enzyme of normalizedEnzymes) {
    const recognition = enzyme.recognitionSequence;
    const orientations = reverseComplement(recognition) === recognition ? 1 : 2;
    patternCount += orientations;
    maxRecLen = Math.max(maxRecLen, recognition.length);
    if (recognitionWork > Number.MAX_SAFE_INTEGER - orientations * recognition.length) {
      recognitionWork = Number.MAX_SAFE_INTEGER;
      break;
    }
    recognitionWork += orientations * recognition.length;
  }
  const scanLength = upper.length + (topology === 'circular' ? Math.max(0, maxRecLen - 1) : 0);
  const scanWorkUnits = recognitionWork > Number.MAX_SAFE_INTEGER / Math.max(1, scanLength)
    ? Number.POSITIVE_INFINITY
    : scanLength * recognitionWork;
  if (!Number.isSafeInteger(scanWorkUnits) || scanWorkUnits > MAX_RESTRICTION_SCAN_WORK_UNITS) {
    throw new RestrictionInputError(
      'scan_work_limit',
      `Restriction scan requires ${Number.isSafeInteger(scanWorkUnits) ? scanWorkUnits.toLocaleString() : 'an unsafe number of'} comparison units across ${patternCount} tested orientations, above the ${MAX_RESTRICTION_SCAN_WORK_UNITS.toLocaleString()}-unit safety limit.`,
    );
  }
  const wrapWindow = topology === 'circular' ? Math.max(0, maxRecLen - 1) : 0;
  const scanBuffer = wrapWindow > 0
    ? upper + upper.repeat(Math.ceil(wrapWindow / upper.length)).slice(0, wrapWindow)
    : upper;
  const seen = new Set<string>();
  const modulo = (value: number): number => ((value % upper.length) + upper.length) % upper.length;
  let complete = true;
  let omittedSitesAtLeast = 0;
  let estimatedOutputBytes = serializedRestrictionBytes({
    sequence: upper,
    topology,
    sites: [],
    issues: [],
    complete: true,
    diagnostics: [],
  }) + RESTRICTION_RESULT_LIMIT_RECEIPT_RESERVE_BYTES;
  const markResultLimit = (): void => {
    complete = false;
  };

  const addSite = (enzyme: RestrictionEnzyme, index: number, strand: 1 | -1): void => {
    const recognition = normalizeRestrictionRecognitionSequence(enzyme.recognitionSequence);
    const geometry = calculateRestrictionCleavageGeometry(enzyme, index, strand);
    const circularGeometry = topology === 'circular'
      ? {
          ...geometry,
          topCutPosition: geometry.topCutPosition === null ? null : modulo(geometry.topCutPosition),
          bottomCutPosition: geometry.bottomCutPosition === null ? null : modulo(geometry.bottomCutPosition),
          cutPosition: modulo(geometry.cutPosition),
          overhangStart: modulo(geometry.overhangStart),
          overhangEnd: modulo(geometry.overhangEnd),
        }
      : geometry;
    const issue = issueForSite(enzyme, index, circularGeometry, upper.length, topology, options, geometry);
    const status: RestrictionCleavageStatus = issue?.code === 'insufficient_flanking_bases'
      ? 'insufficient_flanking_bases'
      : issue?.code === 'methylation_unknown'
        ? 'methylation_unknown'
        : issue?.code === 'methylation_unmethylated'
          ? 'methylation_unmethylated'
          : issue?.code === 'methylation_context_unknown'
            ? 'methylation_context_unknown'
          : issue?.code === 'invalid_geometry' || issue?.code === 'circular_geometry_exceeds_molecule'
            ? 'invalid_geometry' : 'ok';
    // A single recognition window can match both strands when it contains
    // ambiguity symbols.  The matching strand is not the physical identity of
    // a cut: identical top/bottom coordinates describe one event, while a
    // strand-specific asymmetric cutter can produce two distinct geometries at
    // the same position.  Keep only truly identical physical outcomes.
    const dedupeKey = JSON.stringify([
      enzyme.name,
      index,
      status,
      circularGeometry.cutPosition,
      circularGeometry.topCutPosition,
      circularGeometry.bottomCutPosition,
      circularGeometry.overhangStart,
      circularGeometry.overhangEnd,
      circularGeometry.overhangLength,
      circularGeometry.valid,
    ]);
    if (seen.has(dedupeKey)) return;
    const site: RestrictionSite = {
      enzyme: enzyme.name,
      position: index,
      cutPosition: circularGeometry.cutPosition,
      recognitionSequence: recognition,
      overhang: enzyme.overhang,
      cleavageMode: enzyme.cleavageMode ?? 'double-strand',
      topCutPosition: circularGeometry.topCutPosition,
      bottomCutPosition: circularGeometry.bottomCutPosition,
      cleavageStatus: status,
      strand,
    };
    const estimatedSiteBytes = serializedRestrictionBytes(site) + (sites.length > 0 ? 1 : 0);
    const estimatedIssueBytes = issue
      ? serializedRestrictionBytes(issue) + (issues.length > 0 ? 1 : 0)
      : 0;
    if (
      sites.length >= MAX_RESTRICTION_RESULT_SITES
      || issues.length >= MAX_RESTRICTION_RESULT_ISSUES - 1
      || estimatedOutputBytes + estimatedSiteBytes + estimatedIssueBytes > MAX_RESTRICTION_RESULT_BYTES
    ) {
      markResultLimit();
      omittedSitesAtLeast += 1;
      return;
    }
    seen.add(dedupeKey);
    if (issue) issues.push(issue);
    sites.push(site);
    estimatedOutputBytes += estimatedSiteBytes + estimatedIssueBytes;
  };

  for (const enzyme of normalizedEnzymes) {
    if (!complete) break;
    const recognition = enzyme.recognitionSequence;
    const reverseRecognition = reverseComplement(recognition);
    const isPalindrome = reverseRecognition === recognition;
    const patterns: Array<[string, 1 | -1]> = [[recognition, 1]];
    if (!isPalindrome) patterns.push([reverseRecognition, -1]);
    for (const [pattern, strand] of patterns) {
      if (!complete) break;
      for (let index = 0; index <= scanBuffer.length - pattern.length; index += 1) {
        if (!complete) break;
        if (topology === 'circular' && index >= upper.length) continue;
        if (concreteIupacMatch(scanBuffer, index, pattern)) addSite(enzyme, index, strand);
      }
    }
  }

  sites.sort((a, b) => a.position - b.position || a.enzyme.localeCompare(b.enzyme));
  if (!complete) {
    const diagnostic: RestrictionScanDiagnostic = {
      code: 'result_limit',
      message: `Restriction scan stopped at a bounded result limit (${sites.length.toLocaleString()} retained sites; at least ${omittedSitesAtLeast.toLocaleString()} additional matching sites were omitted).`,
      retainedSites: sites.length,
      omittedSitesAtLeast,
      retainedIssues: issues.length,
      maxSites: MAX_RESTRICTION_RESULT_SITES,
      maxIssues: MAX_RESTRICTION_RESULT_ISSUES,
      maxOutputBytes: MAX_RESTRICTION_RESULT_BYTES,
    };
    diagnostics.push(diagnostic);
    issues.push({
      code: 'result_limit',
      message: diagnostic.message,
      retainedSites: diagnostic.retainedSites,
      omittedSitesAtLeast: diagnostic.omittedSitesAtLeast,
      retainedIssues: diagnostic.retainedIssues,
    });
  }
  return { sequence: upper, topology, sites, issues, complete, diagnostics };
}

function scanCategoryForSites(sites: readonly RestrictionSite[]): RestrictionEnzymeScanCategory {
  if (sites.length === 0) return 'no-site';
  const categories = new Set(sites.map(restrictionSiteActivity));
  // An active double-strand site is the only category that authorizes a cut;
  // retain that precedence when a sequence contains mixed site outcomes.
  if (categories.has('active-double-strand')) return 'active-double-strand';
  if (categories.has('legacy-unsafe')) return 'legacy-unsafe';
  if (categories.has('invalid-geometry')) return 'invalid-geometry';
  if (categories.has('insufficient-flanking-bases')) return 'insufficient-flanking-bases';
  if (categories.has('conditional')) return 'conditional';
  return 'nick-only';
}

/**
 * Build per-enzyme activity receipts from an already-completed scan.
 *
 * Keeping this projection separate from the scanner is important for legacy
 * compatibility helpers: they can reuse one bounded scan rather than running
 * the full sequence enumeration a second time.
 */
function classifyRestrictionEnzymeScanResult(
  scan: RestrictionScanResult,
  normalizedEnzymes: readonly RestrictionEnzyme[],
): RestrictionEnzymeScanReceipt[] {
  return normalizedEnzymes.map((enzyme) => {
    const key = enzyme.name.trim().toLowerCase();
    const sites = scan.sites.filter((site) => site.enzyme.trim().toLowerCase() === key);
    const activities = sites.map(restrictionSiteActivity);
    return {
      enzyme,
      sites,
      issues: scan.issues.filter((issue) => issue.enzyme?.trim().toLowerCase() === key),
      category: scanCategoryForSites(sites),
      activeDoubleStrandSiteCount: activities.filter((activity) => activity === 'active-double-strand').length,
      nickSiteCount: activities.filter((activity) => activity === 'nick-only').length,
      conditionalSiteCount: activities.filter((activity) => activity === 'conditional').length,
      insufficientFlankingSiteCount: activities.filter((activity) => activity === 'insufficient-flanking-bases').length,
      invalidGeometrySiteCount: activities.filter((activity) => activity === 'invalid-geometry').length,
      legacyUnsafeSiteCount: activities.filter((activity) => activity === 'legacy-unsafe').length,
      complete: scan.complete,
      diagnostics: [...scan.diagnostics],
    };
  });
}

/**
 * Return a structured activity receipt for each requested enzyme. This is the
 * unambiguous replacement for treating every enzyme without an active
 * double-strand site as a conventional "non-cutter".
 */
export function classifyRestrictionEnzymes(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionEnzymeScanReceipt[] {
  const scan = scanRestrictionSites(seq, enzymes, options);
  const normalizedEnzymes = normalizeRestrictionEnzymes(enzymes);
  return classifyRestrictionEnzymeScanResult(scan, normalizedEnzymes);
}

/** Descriptive alias for integrations that call the result a receipt. */
export const restrictionEnzymeScanReceipts = classifyRestrictionEnzymes;

/**
 * Find enzymes that cut exactly once (unique cutters).
 */
export function findUniqueCutters(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionSite[] {
  const allSites = findRestrictionSites(seq, enzymes, options)
    .filter(isActiveDoubleStrandRestrictionSite);

  // Group by enzyme
  const byEnzyme = new Map<string, RestrictionSite[]>();
  for (const site of allSites) {
    const list = byEnzyme.get(site.enzyme) ?? [];
    list.push(site);
    byEnzyme.set(site.enzyme, list);
  }

  // Return only those that appear exactly once
  const unique: RestrictionSite[] = [];
  for (const [, sitesForEnzyme] of byEnzyme) {
    if (sitesForEnzyme.length === 1) {
      unique.push(sitesForEnzyme[0]);
    }
  }

  return unique.sort((a, b) => a.position - b.position);
}

/**
 * Detect sequence-side IUPAC ambiguity. Ambiguous input is accepted by the
 * scanner but is conservatively excluded from a physical site assertion; this
 * helper lets the UI explain a possible under-count before showing results.
 *
 * Returns the count of ambiguous (non-A/C/G/T) bases. Whitespace and digits
 * are ignored to match `findRestrictionSites`'s pre-scan normalization.
 */
export function countAmbiguousBases(seq: string): number {
  let count = 0;
  for (const ch of seq.toUpperCase()) {
    if (ch === 'A' || ch === 'C' || ch === 'G' || ch === 'T' || ch === 'U') continue;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') continue;
    if (ch >= '0' && ch <= '9') continue;
    if ('RYSWKMBDHVN'.includes(ch)) count++;
  }
  return count;
}

/**
 * Find enzymes without an active, complete double-strand cut.
 *
 * @deprecated Use `classifyRestrictionEnzymes` when the distinction between
 * no-site, nick-only, conditional, invalid, and legacy data matters. This
 * compatibility helper deliberately keeps the historical broad meaning.
 */
export function findNonCutters(
  seq: string,
  enzymes: RestrictionEnzyme[] = RESTRICTION_ENZYMES,
  options?: FindRestrictionSitesOptions,
): RestrictionEnzyme[] {
  const scan = scanRestrictionSites(seq, enzymes, options);
  if (!scan.complete) throw new RestrictionScanResultLimitError(scan);
  const normalizedEnzymes = normalizeRestrictionEnzymes(enzymes);
  const activeEnzymes = new Set(
    classifyRestrictionEnzymeScanResult(scan, normalizedEnzymes)
      .filter((receipt) => receipt.category === 'active-double-strand')
      .map((receipt) => receipt.enzyme.name.toLowerCase()),
  );
  return enzymes.filter((enzyme) => !activeEnzymes.has(enzyme.name.trim().toLowerCase()));
}
