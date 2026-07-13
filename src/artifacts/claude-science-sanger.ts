import {
  ABI_IMPORT_LIMITS,
  SANGER_TRACE_SCHEMA,
  type SangerBase,
  type SangerTraceChannels,
  type SangerTraceData,
  type SangerTraceSourceMetadata,
} from '../bio/abi-import';
import { reverseComplement } from '../bio/reverse-complement';

export const ARTIFACT_SANGER_MAX_WARNINGS = 100;
export const ARTIFACT_SANGER_MAX_WARNING_LENGTH = 1_024;
export const ARTIFACT_SANGER_MAX_WORKSPACE_SAMPLE_ENTRIES = 4_000_000;

const BASES = ['A', 'C', 'G', 'T'] as const;
const CHANNEL_TAGS = new Set(['DATA9', 'DATA10', 'DATA11', 'DATA12']);

export class ArtifactSangerTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactSangerTraceError';
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value: unknown, path: string, maxLength = ABI_IMPORT_LIMITS.maxOptionalMetadataText): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ArtifactSangerTraceError(`${path} must be a string no longer than ${maxLength.toLocaleString()} characters.`);
  }
  return value;
}

function integerArray(
  value: unknown,
  path: string,
  maxLength: number,
  min: number,
  max: number,
): number[] {
  if (!Array.isArray(value)) throw new ArtifactSangerTraceError(`${path} must be an array.`);
  if (value.length > maxLength) {
    throw new ArtifactSangerTraceError(`${path} cannot contain more than ${maxLength.toLocaleString()} values.`);
  }
  return value.map((entry, index) => {
    if (!Number.isInteger(entry) || Number(entry) < min || Number(entry) > max) {
      throw new ArtifactSangerTraceError(`${path}[${index}] must be an integer between ${min.toLocaleString()} and ${max.toLocaleString()}.`);
    }
    return Number(entry);
  });
}

function normalizeChannels(value: unknown): SangerTraceChannels {
  if (!plainObject(value)) throw new ArtifactSangerTraceError('sangerTrace.channels must be an object with A, C, G, and T arrays.');
  const channels = {} as SangerTraceChannels;
  let total = 0;
  for (const base of BASES) {
    channels[base] = integerArray(
      value[base],
      `sangerTrace.channels.${base}`,
      ABI_IMPORT_LIMITS.maxTraceSamplesPerChannel,
      -32_768,
      32_767,
    );
    total += channels[base].length;
  }
  if (total > ABI_IMPORT_LIMITS.maxTotalTraceSamples) {
    throw new ArtifactSangerTraceError(`sangerTrace channels cannot contain more than ${ABI_IMPORT_LIMITS.maxTotalTraceSamples.toLocaleString()} sample entries in total.`);
  }
  return channels;
}

function normalizeMetadata(value: unknown): SangerTraceSourceMetadata {
  if (!plainObject(value)) throw new ArtifactSangerTraceError('sangerTrace.metadata must be an object.');
  if (value.format !== 'ABIF') throw new ArtifactSangerTraceError('sangerTrace.metadata.format must be ABIF.');
  if (!Number.isInteger(value.abifVersion) || Number(value.abifVersion) < 0 || Number(value.abifVersion) > 65_535) {
    throw new ArtifactSangerTraceError('sangerTrace.metadata.abifVersion must be a 16-bit non-negative integer.');
  }
  if (value.baseCallsTag !== 'PBAS2' && value.baseCallsTag !== 'PBAS1') {
    throw new ArtifactSangerTraceError('sangerTrace.metadata.baseCallsTag must be PBAS2 or PBAS1.');
  }
  if (value.qualityScoresTag !== null && value.qualityScoresTag !== 'PCON2' && value.qualityScoresTag !== 'PCON1') {
    throw new ArtifactSangerTraceError('sangerTrace.metadata.qualityScoresTag must be PCON2, PCON1, or null.');
  }
  if (value.peakPositionsTag !== null && value.peakPositionsTag !== 'PLOC2' && value.peakPositionsTag !== 'PLOC1') {
    throw new ArtifactSangerTraceError('sangerTrace.metadata.peakPositionsTag must be PLOC2, PLOC1, or null.');
  }
  if (!plainObject(value.channelTags)) throw new ArtifactSangerTraceError('sangerTrace.metadata.channelTags must be an object.');
  const channelTags: SangerTraceSourceMetadata['channelTags'] = {};
  for (const base of BASES) {
    const tag = value.channelTags[base];
    if (tag === undefined) continue;
    if (typeof tag !== 'string' || !CHANNEL_TAGS.has(tag)) {
      throw new ArtifactSangerTraceError(`sangerTrace.metadata.channelTags.${base} is not a DATA9–DATA12 tag.`);
    }
    channelTags[base] = tag as SangerTraceSourceMetadata['channelTags'][SangerBase];
  }
  return {
    format: 'ABIF',
    abifVersion: Number(value.abifVersion),
    baseCallsTag: value.baseCallsTag,
    qualityScoresTag: value.qualityScoresTag,
    peakPositionsTag: value.peakPositionsTag,
    channelTags,
    sampleName: boundedString(value.sampleName, 'sangerTrace.metadata.sampleName'),
    sampleWell: boundedString(value.sampleWell, 'sangerTrace.metadata.sampleWell'),
    instrumentModel: boundedString(value.instrumentModel, 'sangerTrace.metadata.instrumentModel'),
    dyeSetName: boundedString(value.dyeSetName, 'sangerTrace.metadata.dyeSetName'),
    dataCollectionSoftwareVersion: boundedString(value.dataCollectionSoftwareVersion, 'sangerTrace.metadata.dataCollectionSoftwareVersion'),
    basecallerVersion: boundedString(value.basecallerVersion, 'sangerTrace.metadata.basecallerVersion'),
  };
}

export function artifactSangerTraceSampleEntries(trace: Pick<SangerTraceData, 'channels'>): number {
  return BASES.reduce((total, base) => total + trace.channels[base].length, 0);
}

export function normalizeArtifactSangerTrace(value: unknown, recordSequence: string): SangerTraceData {
  if (!plainObject(value)) throw new ArtifactSangerTraceError('sangerTrace must be a plain object.');
  if (value.schema !== SANGER_TRACE_SCHEMA || value.version !== 1) {
    throw new ArtifactSangerTraceError(`sangerTrace must use ${SANGER_TRACE_SCHEMA} version 1.`);
  }
  if (typeof value.baseCalls !== 'string' || typeof value.sequence !== 'string') {
    throw new ArtifactSangerTraceError('sangerTrace baseCalls and sequence must be strings.');
  }
  const baseCalls = value.baseCalls.toUpperCase();
  const sequence = value.sequence.toUpperCase();
  if (!baseCalls || baseCalls.length > ABI_IMPORT_LIMITS.maxBaseCalls || !/^[ACGTRYSWKMBDHVN]+$/.test(baseCalls)) {
    throw new ArtifactSangerTraceError('sangerTrace.baseCalls must contain bounded IUPAC DNA calls.');
  }
  if (sequence !== baseCalls || recordSequence.toUpperCase() !== baseCalls) {
    throw new ArtifactSangerTraceError('sangerTrace calls must exactly match the owning record sequence.');
  }
  const qualityScores = integerArray(value.qualityScores, 'sangerTrace.qualityScores', ABI_IMPORT_LIMITS.maxBaseCalls, 0, 255);
  const peakPositions = integerArray(value.peakPositions, 'sangerTrace.peakPositions', ABI_IMPORT_LIMITS.maxBaseCalls, 0, 2_147_483_647);
  if (!Array.isArray(value.warnings) || value.warnings.length > ARTIFACT_SANGER_MAX_WARNINGS) {
    throw new ArtifactSangerTraceError(`sangerTrace.warnings must contain at most ${ARTIFACT_SANGER_MAX_WARNINGS} strings.`);
  }
  const warnings = value.warnings.map((warning, index) => {
    if (typeof warning !== 'string' || warning.length > ARTIFACT_SANGER_MAX_WARNING_LENGTH) {
      throw new ArtifactSangerTraceError(`sangerTrace.warnings[${index}] must be a bounded string.`);
    }
    return warning;
  });
  const addIntegrityWarning = (warning: string) => {
    if (warnings.length < ARTIFACT_SANGER_MAX_WARNINGS && !warnings.includes(warning)) warnings.push(warning);
  };
  if (qualityScores.length !== 0 && qualityScores.length !== baseCalls.length) {
    addIntegrityWarning(`Quality-score count (${qualityScores.length}) does not match base-call count (${baseCalls.length}).`);
  }
  if (peakPositions.length !== 0 && peakPositions.length !== baseCalls.length) {
    addIntegrityWarning(`Peak-position count (${peakPositions.length}) does not match base-call count (${baseCalls.length}).`);
  }
  const channels = normalizeChannels(value.channels);
  const sampleCount = Math.max(0, ...BASES.map((base) => channels[base].length));
  if (value.sampleCount !== sampleCount) {
    throw new ArtifactSangerTraceError('sangerTrace.sampleCount must equal the longest decoded channel.');
  }
  if (peakPositions.some((position) => sampleCount > 0 && position >= sampleCount)) {
    addIntegrityWarning('One or more peak positions fall outside the decoded channel range.');
  }
  const dyeOrder = value.dyeOrder;
  if (dyeOrder !== null && (typeof dyeOrder !== 'string' || !/^[ACGT]{4}$/.test(dyeOrder) || new Set(dyeOrder).size !== 4)) {
    throw new ArtifactSangerTraceError('sangerTrace.dyeOrder must be an A/C/G/T permutation or null.');
  }
  if (value.storedReverseComplement !== null && typeof value.storedReverseComplement !== 'boolean') {
    throw new ArtifactSangerTraceError('sangerTrace.storedReverseComplement must be boolean or null.');
  }
  return {
    schema: SANGER_TRACE_SCHEMA,
    version: 1,
    baseCalls,
    sequence,
    qualityScores,
    peakPositions,
    channels,
    sampleCount,
    dyeOrder,
    storedReverseComplement: value.storedReverseComplement,
    warnings,
    metadata: normalizeMetadata(value.metadata),
  };
}

export type ArtifactTraceOrientation = 'forward' | 'reverse' | 'unlinked';

function sharedCanonicalKmers(sequence: string, templateKmers: ReadonlySet<string>, kmerLength: number): number {
  let support = 0;
  const normalized = sequence.toUpperCase();
  for (let index = 0; index <= normalized.length - kmerLength; index += 1) {
    const kmer = normalized.slice(index, index + kmerLength);
    if (/^[ACGT]+$/.test(kmer) && templateKmers.has(kmer)) support += 1;
  }
  return support;
}

/**
 * Fast strand preference for an AB1 read before the bounded browser MSA.
 * This is an orientation seed, not a replacement for the alignment itself.
 */
export function preferredTraceOrientation(
  readSequence: string,
  templateSequence: string,
): { orientation: 'forward' | 'reverse'; forwardSupport: number; reverseSupport: number } {
  const read = readSequence.toUpperCase();
  const template = templateSequence.toUpperCase();
  const kmerLength = Math.max(3, Math.min(7, read.length, template.length));
  const templateKmers = new Set<string>();
  for (let index = 0; index <= template.length - kmerLength; index += 1) {
    const kmer = template.slice(index, index + kmerLength);
    if (/^[ACGT]+$/.test(kmer)) templateKmers.add(kmer);
  }
  const forwardSupport = sharedCanonicalKmers(read, templateKmers, kmerLength);
  const reverseSupport = sharedCanonicalKmers(reverseComplement(read), templateKmers, kmerLength);
  return {
    orientation: reverseSupport > forwardSupport ? 'reverse' : 'forward',
    forwardSupport,
    reverseSupport,
  };
}

export function traceOrientationForAlignedRow(trace: SangerTraceData, aligned: string): ArtifactTraceOrientation {
  const ungapped = aligned.replace(/-/g, '').toUpperCase();
  if (ungapped === trace.baseCalls) return 'forward';
  if (ungapped === reverseComplement(trace.baseCalls)) return 'reverse';
  return 'unlinked';
}

export function sangerQualitySummary(trace: SangerTraceData): { mean: number; q20Percent: number } {
  if (trace.qualityScores.length === 0) return { mean: 0, q20Percent: 0 };
  const sum = trace.qualityScores.reduce((total, quality) => total + quality, 0);
  const q20 = trace.qualityScores.filter((quality) => quality >= 20).length;
  return {
    mean: sum / trace.qualityScores.length,
    q20Percent: (q20 / trace.qualityScores.length) * 100,
  };
}
