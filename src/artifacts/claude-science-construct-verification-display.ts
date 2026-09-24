/**
 * Presentation helpers for construct-verification results.
 *
 * The engine and the saved report keep 0-based, end-exclusive reference
 * coordinates and stable internal ids. Everything a reader sees is built here
 * instead: 1-based positions (the sequence view, the alignment and the trace
 * all number from 1), alleles rather than ids, and one line per kind of finding
 * with the finding that decided the verdict first. Nothing here changes a
 * result or a saved report.
 */
import { reverseComplement } from '../bio/reverse-complement';
import type {
  ArtifactConstructAlignmentColumn,
  ArtifactConstructReadMapping,
  ArtifactConstructReadVerification,
  ArtifactConstructVerificationResult,
} from './claude-science-construct-verification';
import { sha256HexSync } from './claude-science-sha256';

export type ConstructVerificationDisplayVariant = {
  id?: string;
  type?: string;
  position?: number;
  referencePosition?: number;
  referenceStart?: number;
  referenceEnd?: number;
  reference?: string;
  ref?: string;
  observed?: string;
  alternate?: string;
  alt?: string;
  confidence?: 'high' | 'low';
  status?: string;
};

export type ConstructVerificationDisplayReason = {
  code: string;
  severity: string;
  message: string;
  readId?: string;
  regionId?: string;
  variantId?: string;
};

export type ConstructVerificationDisplayRead = {
  id: string;
  name?: string;
  status: string;
  /** Engine marker: the work budget stopped this 'unmapped' read's search. */
  searchIncomplete?: boolean;
  mapping: {
    referenceStart?: number;
    referenceEnd?: number;
    referenceSpan?: number;
    wraps?: boolean;
    identity?: number;
    secondBestScore?: number | null;
  } | null;
};

export type ConstructVerificationDisplayInput = {
  reasons: readonly ConstructVerificationDisplayReason[];
  reference: { length?: number; topology?: string };
  reads: readonly ConstructVerificationDisplayRead[];
  thresholds?: { minMappingIdentity?: number };
  variants: {
    observed: readonly ConstructVerificationDisplayVariant[];
    expected: readonly ConstructVerificationDisplayVariant[];
    unexpected: readonly ConstructVerificationDisplayVariant[];
    missingExpected: readonly ConstructVerificationDisplayVariant[];
  };
};

export type ConstructVerificationFinding = {
  /** Stable React key; one finding per code (and per variant type for variant codes). */
  key: string;
  code: string;
  severity: string;
  /** How many engine reasons this line stands for. */
  count: number;
  message: string;
};

function variantStart(variant: ConstructVerificationDisplayVariant): number | null {
  const start = variant.referenceStart ?? variant.position ?? variant.referencePosition;
  return Number.isFinite(start) ? Math.trunc(start as number) : null;
}

function variantReference(variant: ConstructVerificationDisplayVariant): string {
  return variant.reference ?? variant.ref ?? '';
}

function variantAlternate(variant: ConstructVerificationDisplayVariant): string {
  return variant.observed ?? variant.alternate ?? variant.alt ?? '';
}

function variantEnd(variant: ConstructVerificationDisplayVariant, start: number): number {
  if (Number.isFinite(variant.referenceEnd)) return Math.trunc(variant.referenceEnd as number);
  if (variant.type === 'insertion') return start;
  return start + Math.max(1, variantReference(variant).length);
}

function wrapOneBasedEnd(endExclusive: number, length: number | undefined): number {
  // A 0-based exclusive end equals the 1-based inclusive end, except that an
  // interval ending exactly at the origin of a circular reference reports 0.
  return endExclusive === 0 && length !== undefined && length > 0 ? length : endExclusive;
}

/**
 * 1-based reference coordinate of a variant for display.
 * Substitution at 0-based 17 -> "18"; deletion of 0-based 18..20 -> "19–21";
 * insertion at boundary 50 (between 0-based 49 and 50) -> "after 50".
 */
export function constructVariantDisplayPosition(
  variant: ConstructVerificationDisplayVariant,
  referenceLength?: number,
): string {
  const start = variantStart(variant);
  if (start === null) return '—';
  if (variant.type === 'insertion') {
    return start === 0 ? 'before 1' : `after ${start.toLocaleString()}`;
  }
  const end = wrapOneBasedEnd(variantEnd(variant, start), referenceLength);
  const first = start + 1;
  return end > first || end < first
    ? `${first.toLocaleString()}–${end.toLocaleString()}`
    : first.toLocaleString();
}

/** First 1-based reference base a variant touches (the base after an insertion's boundary). */
export function constructVariantFirstBase(variant: ConstructVerificationDisplayVariant): number | null {
  const start = variantStart(variant);
  return start === null ? null : start + 1;
}

/** Compact label: "A18G", "del 19–21", "ins T after 50". */
export function constructVariantLabel(
  variant: ConstructVerificationDisplayVariant,
  referenceLength?: number,
): string {
  const start = variantStart(variant);
  const reference = variantReference(variant);
  const alternate = variantAlternate(variant);
  if (start === null) return variant.type ? variant.type : 'variant';
  if (variant.type === 'insertion') {
    return `ins ${alternate || '?'} ${constructVariantDisplayPosition(variant, referenceLength)}`;
  }
  if (variant.type === 'deletion') {
    return `del ${constructVariantDisplayPosition(variant, referenceLength)}`;
  }
  return `${reference || '?'}${(start + 1).toLocaleString()}${alternate || '?'}`;
}

/**
 * 1-based inclusive rendering of a 0-based, end-exclusive reference interval.
 * [0, 700) -> "1–700"; a circular interval across the origin says so.
 */
export function constructReferenceRangeLabel(
  start: number | undefined,
  endExclusive: number | undefined,
  referenceLength?: number,
): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(endExclusive)) return null;
  const first = (start as number) + 1;
  const last = wrapOneBasedEnd(endExclusive as number, referenceLength);
  // A region ending exactly at the origin is flagged `wraps` by the engine
  // (start > end) without crossing it, so only the numbers decide.
  const across = last < first;
  return `${first.toLocaleString()}–${last.toLocaleString()}${across ? ' across the origin' : ''}`;
}

/**
 * A read reported as ambiguous_mapping only because the candidate search was
 * cut short, not because a second placement was found, or an 'unmapped' read
 * whose search the work budget stopped.
 *
 * An 'unmapped' read carries the engine's explicit `searchIncomplete` marker.
 * Without it (a proven verdict, or a report saved before the marker existed)
 * the read keeps the plain "did not align" wording.
 *
 * The engine sets `secondBestScore` whenever it scores a distinct runner-up,
 * and a runner-up is what makes a mapping genuinely ambiguous. A circular read
 * that laps the reference (span longer than the reference) is the one other
 * path that reports ambiguity without a runner-up. What is left is the path
 * where the uniqueness search stopped early (the exhaustive scan was over its
 * work budget, or the sampled seed search was truncated) and the engine could
 * not prove uniqueness either way. The mapping logic is not changed; this only
 * reads the fields the result already carries.
 */
export function constructReadSearchWasIncomplete(
  read: ConstructVerificationDisplayRead,
  reference: { length?: number; topology?: string },
): boolean {
  if (read.status === 'unmapped') return read.searchIncomplete === true;
  if (read.status !== 'ambiguous_mapping' || !read.mapping) return false;
  // Only an explicit null says no runner-up was scored; a result without the
  // field says nothing either way.
  if (read.mapping.secondBestScore !== null) return false;
  if (
    reference.topology === 'circular'
    && Number.isFinite(read.mapping.referenceSpan)
    && Number.isFinite(reference.length)
    && (read.mapping.referenceSpan as number) > (reference.length as number)
  ) return false;
  return true;
}

const SEVERITY_ORDER: Record<string, number> = { inconsistent: 0, review: 1 };

// Within a severity, the order in which a scientist should read the findings:
// what makes the evidence contradict the design first, then what makes it
// incomplete, then per-read and per-variant caveats.
const CODE_ORDER: readonly string[] = [
  'conflicting_consensus',
  'expected_variant_not_observed',
  'unexpected_variant',
  'no_usable_reads',
  'partial_reference_coverage',
  'required_region_uncovered',
  'required_region_low_depth',
  'required_region_missing_strand',
  'ambiguous_mapping',
  'unmapped_read',
  'low_mapping_identity',
  'excessive_indel',
  'trimmed_read_too_short',
  'expected_variant_not_covered',
  'low_confidence_variant',
  'missing_quality',
];

const VARIANT_CODES = new Set([
  'unexpected_variant',
  'low_confidence_variant',
  'expected_variant_not_observed',
  'expected_variant_not_covered',
]);

const READ_CODES = new Set([
  'ambiguous_mapping',
  'unmapped_read',
  'low_mapping_identity',
  'excessive_indel',
  'trimmed_read_too_short',
  'missing_quality',
]);

const LISTED_LABELS = 6;

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

function listWithMore(labels: readonly string[], total: number): string {
  // "and 1 more" takes the room the one label would, so show it instead.
  const shown = total <= LISTED_LABELS + 1 ? labels.slice(0, LISTED_LABELS + 1) : labels.slice(0, LISTED_LABELS);
  const more = total - shown.length;
  return `${shown.join(', ')}${more > 0 ? `, and ${more.toLocaleString()} more` : ''}`;
}

function variantTypeNoun(type: string | undefined, count: number): string {
  const noun = type === 'insertion' ? 'insertion' : type === 'deletion' ? 'deletion' : type === 'substitution' ? 'substitution' : 'variant';
  return count === 1 ? noun : `${noun}s`;
}

/**
 * Leading integer of the engine's conflicting_consensus sentence ("7 reference
 * positions lack …"). That sentence is the only place the engine reports its
 * conflict count, in both the live result and the saved report.
 */
export function constructConflictCount(reasons: readonly ConstructVerificationDisplayReason[]): number | null {
  const reason = reasons.find((entry) => entry.code === 'conflicting_consensus');
  if (!reason) return 0;
  const head = reason.message.split(' reference position')[0] ?? '';
  const digits = head.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : null;
}

/** High-quality variants below the fraction or quality threshold (one low_confidence_variant reason each). */
export function constructLowConfidenceCount(input: ConstructVerificationDisplayInput): number {
  return input.variants.observed.filter((variant) => variant.confidence === 'low').length;
}

function sortFindings(findings: ConstructVerificationFinding[]): ConstructVerificationFinding[] {
  const codeRank = (code: string) => {
    const index = CODE_ORDER.indexOf(code);
    return index < 0 ? CODE_ORDER.length : index;
  };
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => (
      (SEVERITY_ORDER[left.finding.severity] ?? 2) - (SEVERITY_ORDER[right.finding.severity] ?? 2)
      || codeRank(left.finding.code) - codeRank(right.finding.code)
      || left.index - right.index
    ))
    .map(({ finding }) => finding);
}

/**
 * Reader-facing review findings: one line per kind, severity first.
 *
 * Variant reasons collapse per code and variant type ("7 unexpected
 * substitutions: A18G, G37A, …"); read reasons collapse per code and name the
 * reads; region, coverage and unknown reasons keep their own sentences, which
 * carry no internal ids.
 */
export function constructVerificationFindings(
  input: ConstructVerificationDisplayInput,
  readNames: Readonly<Record<string, string>> = {},
): ConstructVerificationFinding[] {
  const referenceLength = input.reference.length;
  const variantsById = new Map<string, ConstructVerificationDisplayVariant>();
  for (const variant of [
    ...input.variants.observed,
    ...input.variants.unexpected,
    ...input.variants.expected,
    ...input.variants.missingExpected,
  ]) {
    if (variant.id && !variantsById.has(variant.id)) variantsById.set(variant.id, variant);
  }
  const readsById = new Map(input.reads.map((read) => [read.id, read]));
  const readLabel = (readId: string | undefined, fallback: string) => {
    if (!readId) return fallback;
    return readNames[readId] ?? readsById.get(readId)?.name ?? readId;
  };

  type Group = { code: string; severity: string; reasons: ConstructVerificationDisplayReason[]; variantType?: string; incomplete?: boolean };
  const groups = new Map<string, Group>();
  const standalone: ConstructVerificationFinding[] = [];

  input.reasons.forEach((reason, index) => {
    if (VARIANT_CODES.has(reason.code)) {
      const variant = reason.variantId ? variantsById.get(reason.variantId) : undefined;
      const variantType = variant?.type ?? 'variant';
      const key = `${reason.code}:${variantType}`;
      const group = groups.get(key) ?? { code: reason.code, severity: reason.severity, reasons: [], variantType };
      group.reasons.push(reason);
      groups.set(key, group);
      return;
    }
    if (READ_CODES.has(reason.code)) {
      const read = reason.readId ? readsById.get(reason.readId) : undefined;
      const incomplete = (reason.code === 'ambiguous_mapping' || reason.code === 'unmapped_read')
        && read !== undefined
        && constructReadSearchWasIncomplete(read, input.reference);
      const key = `${reason.code}:${incomplete ? 'incomplete' : 'found'}`;
      const group = groups.get(key) ?? { code: reason.code, severity: reason.severity, reasons: [], incomplete };
      group.reasons.push(reason);
      groups.set(key, group);
      return;
    }
    if (reason.code === 'conflicting_consensus') {
      const count = constructConflictCount([reason]);
      standalone.push({
        key: `conflicting_consensus:${index}`,
        code: reason.code,
        severity: reason.severity,
        count: 1,
        message: count === null
          ? reason.message
          : `Reads disagree at ${plural(count, 'reference position')}, so no consensus base could be called there.`,
      });
      return;
    }
    standalone.push({
      key: `${reason.code}:${reason.readId ?? reason.regionId ?? reason.variantId ?? index}`,
      code: reason.code,
      severity: reason.severity,
      count: 1,
      message: reason.message,
    });
  });

  const grouped: ConstructVerificationFinding[] = [];
  for (const [key, group] of groups) {
    const count = group.reasons.length;
    if (VARIANT_CODES.has(group.code)) {
      const labels = group.reasons.flatMap((reason) => {
        const variant = reason.variantId ? variantsById.get(reason.variantId) : undefined;
        return variant ? [constructVariantLabel(variant, referenceLength)] : [];
      });
      const unlabeled = count - labels.length;
      const noun = variantTypeNoun(group.variantType, count);
      const list = labels.length
        ? listWithMore(labels, labels.length + unlabeled)
        : '';
      let message: string;
      if (group.code === 'unexpected_variant') {
        message = `${count.toLocaleString()} unexpected ${noun}${list ? `: ${list}` : ''}. Supported with high confidence; not in the expected design.`;
      } else if (group.code === 'low_confidence_variant') {
        message = `${count.toLocaleString()} low-confidence ${noun}${list ? `: ${list}` : ''}. The evidence is below the quality or read-fraction threshold.`;
      } else if (group.code === 'expected_variant_not_observed') {
        message = `${count === 1 ? 'Expected' : `${count.toLocaleString()} expected`} ${noun} ${count === 1 ? 'was' : 'were'} not observed${list ? `: ${list}` : ''}, although the reads cover ${count === 1 ? 'it' : 'them'}.`;
      } else {
        message = `${count === 1 ? 'Expected' : `${count.toLocaleString()} expected`} ${noun} ${count === 1 ? 'is' : 'are'} not covered by a usable read${list ? `: ${list}` : ''}.`;
      }
      grouped.push({ key, code: group.code, severity: group.severity, count, message });
      continue;
    }
    const names = group.reasons.map((reason) => readLabel(reason.readId, 'a read'));
    const list = listWithMore(names, names.length);
    let message: string;
    const one = count === 1;
    const reads = plural(count, 'read');
    switch (group.code) {
      case 'ambiguous_mapping':
        message = group.incomplete
          ? `${reads} could not be confirmed as a unique match: ${list}. ${one ? 'It aligns' : 'They align'} to the reference, but the in-browser search stopped before checking the whole reference for a second match, so ${one ? 'it is' : 'they are'} not counted as evidence.`
          : `${reads} ${one ? 'matches' : 'match'} more than one place in the reference too closely to tell apart: ${list}. ${one ? 'It is' : 'They are'} not counted as evidence.`;
        break;
      case 'unmapped_read':
        message = group.incomplete
          ? `The in-browser search stopped before it found a close alignment for ${reads}: ${list}. A full search could still align ${one ? 'it' : 'them'} to the reference, so ${one ? 'it is' : 'they are'} not counted as evidence.`
          : `${reads} did not align to the reference: ${list}.`;
        break;
      case 'low_mapping_identity': {
        const floor = input.thresholds?.minMappingIdentity;
        message = `${reads} ${one ? 'aligns' : 'align'} below the ${Number.isFinite(floor) ? `${Math.round((floor as number) * 100)}% ` : ''}identity threshold: ${list}.`;
        break;
      }
      case 'excessive_indel':
        message = `${reads} ${one ? 'needs' : 'need'} more insertions or deletions than allowed to align: ${list}.`;
        break;
      case 'trimmed_read_too_short':
        message = `${reads} ${one ? 'is' : 'are'} too short after quality trimming: ${list}.`;
        break;
      case 'missing_quality':
        message = `${reads} ${one ? 'carries' : 'carry'} no quality scores, so ${one ? 'its' : 'their'} calls were used untrimmed: ${list}.`;
        break;
      default:
        message = group.reasons[0]?.message ?? group.code;
    }
    grouped.push({ key, code: group.code, severity: group.severity, count, message });
  }

  return sortFindings([...grouped, ...standalone]);
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function textOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export type ConstructVerificationReportVariant = {
  id?: string;
  type?: string;
  referenceStart?: number;
  referenceEnd?: number;
  reference?: string;
  alternate?: string;
  depth?: number;
  support?: number;
  meanQuality?: number | null;
  confidence?: 'high' | 'low';
  supportingReadIds?: string[];
  status?: 'observed' | 'low_confidence' | 'not_observed' | 'not_covered';
  observedVariantId?: string;
};

export type ConstructVerificationReportRegion = {
  id?: string;
  name?: string;
  start?: number;
  end?: number;
  wraps?: boolean;
  coveredFraction?: number;
  forwardCoveredBases?: number;
  reverseCoveredBases?: number;
  status?: string;
};

const EXPECTED_STATUSES = new Set(['observed', 'low_confidence', 'not_observed', 'not_covered']);

function reportVariant(variant: UnknownRecord): ConstructVerificationReportVariant {
  const status = textOr(variant.status);
  return {
    id: textOr(variant.id),
    type: textOr(variant.type),
    referenceStart: finiteOr(variant.referenceStart),
    referenceEnd: finiteOr(variant.referenceEnd),
    reference: textOr(variant.reference),
    alternate: textOr(variant.alternate),
    depth: finiteOr(variant.depth),
    support: finiteOr(variant.support),
    meanQuality: variant.meanQuality === null ? null : finiteOr(variant.meanQuality),
    confidence: variant.confidence === 'low' ? 'low' : variant.confidence === 'high' ? 'high' : undefined,
    supportingReadIds: Array.isArray(variant.supportingReadIds)
      ? variant.supportingReadIds.filter((id): id is string => typeof id === 'string')
      : undefined,
    status: status && EXPECTED_STATUSES.has(status) ? status as ConstructVerificationReportVariant['status'] : undefined,
    observedVariantId: textOr(variant.observedVariantId),
  };
}

function reportRegion(region: UnknownRecord): ConstructVerificationReportRegion {
  return {
    id: textOr(region.id),
    name: textOr(region.name),
    start: finiteOr(region.start),
    end: finiteOr(region.end),
    wraps: region.wraps === true,
    coveredFraction: finiteOr(region.coveredFraction),
    forwardCoveredBases: finiteOr(region.forwardCoveredBases),
    reverseCoveredBases: finiteOr(region.reverseCoveredBases),
    status: textOr(region.status),
  };
}

export type ConstructVerificationReportPresentation = {
  schema: string;
  version: number;
  state: 'consistent' | 'needs_review' | 'inconsistent';
  reasons: ConstructVerificationDisplayReason[];
  reference: { id?: string; name?: string; length?: number; topology?: string };
  thresholds?: { minMappingIdentity?: number };
  reads: Array<{
    id: string;
    name?: string;
    rawLength: number;
    meanQuality: number | null;
    status: string;
    searchIncomplete?: boolean;
    mapping: {
      orientation: 'forward' | 'reverse';
      referenceStart?: number;
      referenceEnd?: number;
      referenceSpan?: number;
      wraps?: boolean;
      secondBestScore?: number | null;
      alignedLength?: number;
      identity?: number;
      insertions?: number;
      deletions?: number;
    } | null;
  }>;
  coverage: {
    coveredBases: number;
    basesMeetingMinDepth?: number;
    coveredFraction: number;
    meanDepth?: number;
    requiredRegions: ConstructVerificationReportRegion[];
  };
  consensus: { calls: { status: string }[] };
  variants: {
    observed: ConstructVerificationReportVariant[];
    expected: ConstructVerificationReportVariant[];
    unexpected: ConstructVerificationReportVariant[];
    missingExpected: ConstructVerificationReportVariant[];
  };
  provenance?: { engine?: string; engineVersion?: string; workUnits?: number };
};

/**
 * Reads a saved construct-verification report (the JSON asset written at
 * Save) back into the evidence panel's presentation shape. The report keeps
 * 0-based coordinates and omits the per-base arrays, so the panel shows the
 * positions it showed at run time, and Mean depth comes from the report's own
 * mean. Returns null for anything that is not a report this engine wrote.
 */
export function constructVerificationPresentationFromReport(
  content: string,
): ConstructVerificationReportPresentation | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.schema !== 'motif.construct-verification-report.v1') return null;
  const state = parsed.state;
  if (state !== 'consistent' && state !== 'needs_review' && state !== 'inconsistent') return null;
  const reference = isRecord(parsed.reference) ? parsed.reference : {};
  const coverage = isRecord(parsed.coverage) ? parsed.coverage : {};
  const variants = isRecord(parsed.variants) ? parsed.variants : {};
  const provenance = isRecord(parsed.provenance) ? parsed.provenance : {};
  const thresholds = isRecord(parsed.thresholds) ? parsed.thresholds : {};
  return {
    schema: 'motif.construct-verification-report.v1',
    version: finiteOr(parsed.version) ?? 1,
    state,
    reasons: recordArray(parsed.reasons).flatMap((reason) => {
      const code = textOr(reason.code);
      const message = textOr(reason.message);
      if (!code || message === undefined) return [];
      const readId = textOr(reason.readId);
      const regionId = textOr(reason.regionId);
      const variantId = textOr(reason.variantId);
      return [{
        code,
        severity: textOr(reason.severity) ?? 'review',
        message,
        ...(readId ? { readId } : {}),
        ...(regionId ? { regionId } : {}),
        ...(variantId ? { variantId } : {}),
      }];
    }),
    reference: {
      id: textOr(reference.id),
      name: textOr(reference.name),
      length: finiteOr(reference.length),
      topology: textOr(reference.topology),
    },
    thresholds: { minMappingIdentity: finiteOr(thresholds.minMappingIdentity) },
    reads: recordArray(parsed.reads).flatMap((read) => {
      const id = textOr(read.id);
      if (!id) return [];
      const mapping = isRecord(read.mapping) ? read.mapping : null;
      return [{
        id,
        name: textOr(read.name),
        rawLength: finiteOr(read.rawLength) ?? 0,
        meanQuality: finiteOr(read.meanQuality) ?? null,
        status: textOr(read.status) ?? 'unmapped',
        ...(read.searchIncomplete === true ? { searchIncomplete: true } : {}),
        mapping: mapping ? {
          orientation: mapping.orientation === 'reverse' ? 'reverse' as const : 'forward' as const,
          referenceStart: finiteOr(mapping.referenceStart),
          referenceEnd: finiteOr(mapping.referenceEnd),
          referenceSpan: finiteOr(mapping.referenceSpan),
          wraps: mapping.wraps === true,
          secondBestScore: mapping.secondBestScore === null ? null : finiteOr(mapping.secondBestScore),
          alignedLength: finiteOr(mapping.alignedLength),
          identity: finiteOr(mapping.identity),
          insertions: finiteOr(mapping.insertions),
          deletions: finiteOr(mapping.deletions),
        } : null,
      }];
    }),
    coverage: {
      coveredBases: finiteOr(coverage.coveredBasesAtAnyDepth) ?? finiteOr(coverage.basesMeetingMinDepth) ?? 0,
      basesMeetingMinDepth: finiteOr(coverage.basesMeetingMinDepth),
      coveredFraction: finiteOr(coverage.coverageFraction) ?? 0,
      meanDepth: finiteOr(coverage.meanDepth),
      requiredRegions: recordArray(coverage.requiredRegions).map(reportRegion),
    },
    // The report keeps no per-base consensus calls.
    consensus: { calls: [] },
    variants: {
      observed: recordArray(variants.observed).map(reportVariant),
      expected: recordArray(variants.expected).map(reportVariant),
      unexpected: recordArray(variants.unexpected).map(reportVariant),
      missingExpected: recordArray(variants.missingExpected).map(reportVariant),
    },
    provenance: {
      engine: textOr(provenance.engine),
      engineVersion: textOr(provenance.engineVersion),
      workUnits: finiteOr(provenance.workUnits),
    },
  };
}

type SavedTraceRecord = {
  id: string;
  name: string;
  sequence: string;
  sangerTrace?: { baseCalls: string; qualityScores?: readonly number[] };
};

type SavedTraceResult = Pick<ArtifactConstructVerificationResult, 'reference' | 'reads' | 'provenance'>;

/**
 * Why a saved read or reference cannot open: its record is gone (or holds no
 * trace), it was edited after the run, or (for a read) the saved map does not
 * fit the record it attests.
 */
export type ConstructVerificationSavedTraceGap = 'missing' | 'edited' | 'unreadable';

/**
 * What a saved report can do for its variant rows. `ready`: the result to lay
 * the traces out from, as the live table does, with each read that cannot open
 * left out and listed with its cause. `no_reference`: the reference is missing
 * or was edited since the run. In both, `unavailable` places the reads whose
 * traces cannot open, so a row they alone cover can say why. `no_read_map`:
 * the report was saved before reports kept each read's CIGAR.
 */
export type ConstructVerificationSavedTraces<TraceRecord extends SavedTraceRecord> =
  | {
    status: 'ready';
    result: SavedTraceResult;
    reference: TraceRecord;
    records: ReadonlyMap<string, TraceRecord>;
    unavailableReads: { id: string; name: string; gap: ConstructVerificationSavedTraceGap }[];
    unavailable: SavedTraceResult;
  }
  | { status: 'no_reference'; gap: 'missing' | 'edited'; unavailable: SavedTraceResult }
  | { status: 'no_read_map' };

function normalizedDna(sequence: string): string {
  return sequence.replace(/\s+/g, '').toUpperCase();
}

function modulo(value: number, length: number): number {
  return ((value % length) + length) % length;
}

/** The read's column map rebuilt from its CIGAR, or null when the CIGAR does not fit the read and reference. */
function savedReadColumns(
  cigar: string,
  mapping: { orientation: 'forward' | 'reverse'; referenceStart: number; referenceSpan: number },
  trim: { rawStart: number; rawEnd: number },
  referenceSequence: string,
  circular: boolean,
  baseCalls: string,
  qualityScores: readonly number[] | undefined,
): ArtifactConstructAlignmentColumn[] | null {
  const length = referenceSequence.length;
  const forward = mapping.orientation === 'forward';
  const trimmed = baseCalls.slice(trim.rawStart, trim.rawEnd);
  const oriented = forward ? trimmed : reverseComplement(trimmed).toUpperCase();
  const columns: ArtifactConstructAlignmentColumn[] = [];
  let consumed = 0;
  let orientedIndex = 0;
  for (const [, runText, operation] of cigar.matchAll(/(\d+)([MID])/g)) {
    for (let step = 0; step < Number(runText); step += 1) {
      const absolute = mapping.referenceStart + consumed;
      const position = circular ? modulo(absolute, length) : absolute;
      if (position < 0 || position > length || (operation !== 'I' && position === length)) return null;
      const call = operation === 'D' ? null : orientedIndex;
      if (call !== null && call >= oriented.length) return null;
      const rawCallIndex = call === null ? null : forward ? trim.rawStart + call : trim.rawEnd - 1 - call;
      const readBase = call === null ? null : oriented[call];
      const referenceBase = operation === 'I' ? null : referenceSequence[position];
      columns.push({
        operation: operation === 'I'
          ? 'insertion'
          : operation === 'D'
            ? 'deletion'
            : readBase === referenceBase && /^[ACGT]$/.test(referenceBase ?? '') ? 'match' : 'substitution',
        referencePosition: operation === 'I' ? null : position,
        referenceBoundary: operation === 'I' ? position : null,
        rawCallIndex,
        orientedCallIndex: call,
        referenceBase,
        readBase,
        rawBase: rawCallIndex === null ? null : baseCalls[rawCallIndex],
        qualityScore: rawCallIndex === null ? null : qualityScores?.[rawCallIndex] ?? null,
      });
      if (operation !== 'I') consumed += 1;
      if (operation !== 'D') orientedIndex += 1;
    }
  }
  return orientedIndex === oriented.length && consumed === mapping.referenceSpan ? columns : null;
}

/**
 * Reads a saved report's reads back onto the workspace's own records, so a
 * saved variant row can open the traces at its base exactly as the live table
 * does. The report keeps no sequence or trace, so a record is used only while
 * it still hashes to what the run attested.
 */
export function constructVerificationSavedTraces<TraceRecord extends SavedTraceRecord>(
  content: string,
  records: readonly TraceRecord[],
): ConstructVerificationSavedTraces<TraceRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { status: 'no_read_map' };
  }
  if (!isRecord(parsed) || parsed.schema !== 'motif.construct-verification-report.v1' || !isRecord(parsed.reference)) {
    return { status: 'no_read_map' };
  }
  const reads = recordArray(parsed.reads).filter((read) => (
    read.status === 'mapped' && typeof read.id === 'string' && isRecord(read.mapping) && typeof read.mapping.cigar === 'string'
  ));
  if (!reads.length) return { status: 'no_read_map' };
  const recordById = new Map(records.map((record) => [record.id, record]));
  const savedReference = parsed.reference;
  const circular = savedReference.topology === 'circular';
  const provenance = (isRecord(parsed.provenance) ? parsed.provenance : {}) as unknown as SavedTraceResult['provenance'];
  // Where the reads that cannot open sat, with no calls: enough to tell which rows they covered.
  const unavailableReads: ArtifactConstructReadVerification[] = [];
  const unavailable = (): SavedTraceResult => ({
    reference: {
      id: String(savedReference.id),
      sequence: '',
      length: finiteOr(savedReference.length) ?? 0,
      topology: circular ? 'circular' : 'linear',
      sha256: String(savedReference.sha256),
    },
    reads: unavailableReads,
    provenance,
  });
  const readWithColumns = (read: UnknownRecord, columns: ArtifactConstructAlignmentColumn[]) => {
    // The saved read already has the engine's shape except for the column
    // map, which the CIGAR rebuilds; the CIGAR itself is not part of that shape.
    const { cigar: _cigar, ...counts } = read.mapping as UnknownRecord;
    return {
      ...(read as unknown as ArtifactConstructReadVerification),
      mapping: {
        ...(counts as unknown as ArtifactConstructReadMapping),
        coordinateMap: {
          columns,
          referencePositions: columns.map((column) => column.referencePosition),
          rawCallIndices: columns.map((column) => column.rawCallIndex),
        },
      },
    };
  };
  const reference = typeof savedReference.id === 'string' ? recordById.get(savedReference.id) : undefined;
  const referenceSequence = reference ? normalizedDna(reference.sequence) : '';
  if (
    !reference
    || sha256HexSync(referenceSequence) !== savedReference.sha256
    || referenceSequence.length !== savedReference.length
  ) {
    unavailableReads.push(...reads.map((read) => readWithColumns(read, [])));
    return { status: 'no_reference', gap: reference ? 'edited' : 'missing', unavailable: unavailable() };
  }

  const unavailableReadNames: { id: string; name: string; gap: ConstructVerificationSavedTraceGap }[] = [];
  const traceReads: ArtifactConstructReadVerification[] = [];
  for (const read of reads) {
    const id = read.id as string;
    const record = recordById.get(id);
    const mapping = read.mapping as UnknownRecord;
    const trim = isRecord(read.trim) ? read.trim : {};
    const baseCalls = record?.sangerTrace ? normalizedDna(record.sangerTrace.baseCalls) : '';
    const attested = baseCalls !== '' && sha256HexSync(baseCalls) === read.sha256;
    const columns = attested
      ? savedReadColumns(
        mapping.cigar as string,
        {
          orientation: mapping.orientation === 'reverse' ? 'reverse' : 'forward',
          referenceStart: finiteOr(mapping.referenceStart) ?? -1,
          referenceSpan: finiteOr(mapping.referenceSpan) ?? 0,
        },
        { rawStart: finiteOr(trim.rawStart) ?? 0, rawEnd: finiteOr(trim.rawEnd) ?? 0 },
        referenceSequence,
        circular,
        baseCalls,
        record?.sangerTrace?.qualityScores,
      )
      : null;
    if (!columns) {
      unavailableReadNames.push({
        id,
        name: record?.name ?? textOr(read.name) ?? id,
        // Editing a read's bases drops its trace, so a read still in the
        // workspace without base calls was edited, not removed.
        gap: !record ? 'missing' : !baseCalls ? 'edited' : attested ? 'unreadable' : 'edited',
      });
      unavailableReads.push(readWithColumns(read, []));
      continue;
    }
    traceReads.push(readWithColumns(read, columns));
  }
  return {
    status: 'ready',
    result: {
      reference: {
        id: reference.id,
        sequence: referenceSequence,
        length: referenceSequence.length,
        topology: circular ? 'circular' : 'linear',
        sha256: savedReference.sha256 as string,
      },
      reads: traceReads,
      provenance,
    },
    reference,
    records: recordById,
    unavailableReads: unavailableReadNames,
    unavailable: unavailable(),
  };
}
