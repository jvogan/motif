import type {
  Feature,
  RestrictionMethylationState,
  RestrictionMethylationTarget,
  RestrictionEnzyme,
  Topology,
} from './types';
import {
  calculateRestrictionCleavageGeometry,
  findRestrictionSites,
  isActiveDoubleStrandRestrictionSite,
  normalizeRestrictionSequence,
  scanRestrictionSites,
  type FindRestrictionSitesOptions,
  type RestrictionCleavageGeometry,
  type RestrictionIssueCode,
  type RestrictionScanIssue,
} from './restriction-sites';
import { RESTRICTION_ENZYMES_FULL } from './enzyme-data';
import { reverseComplement } from './reverse-complement';
import { remapFeatureLocation, type FeatureCoordinateMapSpan } from './feature-location';

export type RestrictionOverhangType = 'blunt' | '5prime' | '3prime';

export interface RestrictionDigestOptions {
  methylation?: RestrictionMethylationState | Partial<Record<RestrictionMethylationTarget, RestrictionMethylationState>>;
  methylationState?: RestrictionMethylationState;
  methylationAssumptions?: RestrictionMethylationState | Partial<Record<RestrictionMethylationTarget, RestrictionMethylationState>>;
}

export type RestrictionDigestIssueCode = RestrictionIssueCode | 'unknown_enzyme' | 'incompatible_colocated_cleavage';

export interface RestrictionDigestIssue {
  code: RestrictionDigestIssueCode;
  message: string;
  enzyme?: string;
  position?: number;
  topCutPosition?: number | null;
  bottomCutPosition?: number | null;
  required?: string;
  observed?: string;
  evidence?: RestrictionScanIssue['evidence'];
}

export interface RestrictionDigestResult {
  sequence: string;
  topology: Topology;
  requestedEnzymes: string[];
  resolvedEnzymes: string[];
  unknownEnzymes: string[];
  sites: ReturnType<typeof findRestrictionSites>;
  /** Physical double-strand boundaries; nicks are intentionally excluded. */
  cuts: RestrictionCleavageGeometry[];
  fragments: DigestFragment[];
  issues: RestrictionDigestIssue[];
  cutCount: number;
}

export class RestrictionDigestError extends Error {
  readonly issues: RestrictionDigestIssue[];
  readonly result: RestrictionDigestResult;

  constructor(result: RestrictionDigestResult) {
    super(result.issues.map((issue) => issue.message).join(' '));
    this.name = 'RestrictionDigestError';
    this.issues = result.issues;
    this.result = result;
  }
}

interface FragmentEnd {
  overhang: string;
  type: RestrictionOverhangType;
}

const BLUNT_END: FragmentEnd = { overhang: '', type: 'blunt' };

function readSenseOverhang(seq: string, start: number, end: number, topology: Topology): string | null {
  const upper = seq.toUpperCase();
  if (end < start || upper.length === 0) return null;
  if (end === start) return '';
  if (topology === 'linear') {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > upper.length) return null;
    return upper.slice(start, end);
  }
  let overhang = '';
  for (let pos = start; pos < end; pos += 1) {
    const idx = ((pos % upper.length) + upper.length) % upper.length;
    overhang += upper[idx];
  }
  return overhang;
}

export interface DigestFragment {
  sequence: string;
  length: number;
  startInOriginal: number;
  endInOriginal: number;
  leftEnzyme: string | null;
  rightEnzyme: string | null;
  /** All requested enzymes sharing each boundary; left/rightEnzyme remain compatibility aliases. */
  leftEnzymes?: string[];
  rightEnzymes?: string[];
  overhang5: string;
  overhang3: string;
  overhang5Type: RestrictionOverhangType;
  overhang3Type: RestrictionOverhangType;
  features: Feature[];
}

function issueFromScan(issue: RestrictionScanIssue): RestrictionDigestIssue {
  return { ...issue };
}

function wholeFragment(seq: string, features: readonly Feature[] | undefined): DigestFragment {
  const mappedFeatures = features?.flatMap((feature) => {
    const location = remapFeatureLocation(feature, [{ start: 0, end: seq.length, targetStart: 0 }]);
    return location ? [{ ...feature, ...location, id: crypto.randomUUID() }] : [];
  }) ?? [];
  return {
    sequence: seq,
    length: seq.length,
    startInOriginal: 0,
    endInOriginal: seq.length,
    leftEnzyme: null,
    rightEnzyme: null,
    overhang5: BLUNT_END.overhang,
    overhang3: BLUNT_END.overhang,
    overhang5Type: BLUNT_END.type,
    overhang3Type: BLUNT_END.type,
    features: mappedFeatures,
  };
}

function buildFeatureSlicers(
  sequence: string,
  topology: Topology,
  features: readonly Feature[] | undefined,
): {
  sliceFeatures: (start: number, end: number) => Feature[];
  sliceFeaturesWrap: (start: number, end: number) => Feature[];
} {
  function sliceFeaturesThroughSpans(sourceSpans: readonly FeatureCoordinateMapSpan[]): Feature[] {
    if (!features || features.length === 0) return [];
    return features.flatMap((feature) => {
      const location = remapFeatureLocation(feature, sourceSpans);
      return location ? [{ ...feature, ...location, id: crypto.randomUUID() }] : [];
    });
  }
  return {
    sliceFeatures: (start, end) => sliceFeaturesThroughSpans([{ start, end, targetStart: 0 }]),
    sliceFeaturesWrap: (start, end) => {
      if (topology !== 'circular' || (end > start && end <= sequence.length)) {
        return sliceFeaturesThroughSpans([{ start, end, targetStart: 0 }]);
      }
      const headEnd = end > sequence.length ? end - sequence.length : end;
      const tailLength = sequence.length - start;
      return sliceFeaturesThroughSpans([
        { start, end: sequence.length, targetStart: 0 },
        { start: 0, end: headEnd, targetStart: tailLength },
      ]);
    },
  };
}

function resolveRequestedEnzymes(
  enzymeNames: readonly string[],
  enzymeCatalog: readonly RestrictionEnzyme[],
): { requestedNames: string[]; enzymes: RestrictionEnzyme[]; unknownEnzymes: string[] } {
  const byName = new Map<string, RestrictionEnzyme>();
  for (const enzyme of enzymeCatalog) {
    const key = enzyme.name.trim().toLocaleLowerCase();
    if (key && !byName.has(key)) byName.set(key, enzyme);
  }
  const requestedNames = enzymeNames.map((name) => name.trim()).filter(Boolean);
  const enzymes: RestrictionEnzyme[] = [];
  const unknownEnzymes: string[] = [];
  const seenEnzymes = new Set<string>();
  const seenUnknown = new Set<string>();
  for (const requested of requestedNames) {
    const key = requested.toLocaleLowerCase();
    const enzyme = byName.get(key);
    if (!enzyme) {
      if (!seenUnknown.has(key)) {
        seenUnknown.add(key);
        unknownEnzymes.push(requested);
      }
      continue;
    }
    if (!seenEnzymes.has(key)) {
      seenEnzymes.add(key);
      enzymes.push(enzyme);
    }
  }
  return { requestedNames, enzymes, unknownEnzymes };
}

function activeDoubleStrandSite(site: ReturnType<typeof findRestrictionSites>[number]): boolean {
  return isActiveDoubleStrandRestrictionSite(site);
}

function restrictionDigestResultFor(
  seq: string,
  enzymeNames: readonly string[],
  topology: Topology,
  features: readonly Feature[] | undefined,
  enzymeCatalog: readonly RestrictionEnzyme[],
  options: RestrictionDigestOptions | undefined,
): RestrictionDigestResult {
  let normalized: string;
  try {
    normalized = normalizeRestrictionSequence(seq);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid restriction sequence.';
    return {
      sequence: '',
      topology,
      requestedEnzymes: enzymeNames.map((name) => String(name)),
      resolvedEnzymes: [],
      unknownEnzymes: [],
      sites: [],
      cuts: [],
      fragments: [],
      issues: [{ code: 'invalid_sequence', message }],
      cutCount: 0,
    };
  }
  const resolution = resolveRequestedEnzymes(enzymeNames, enzymeCatalog);
  const issues: RestrictionDigestIssue[] = resolution.unknownEnzymes.map((enzyme) => ({
    code: 'unknown_enzyme',
    enzyme,
    message: `Unknown restriction enzyme "${enzyme}" was requested and was not silently ignored.`,
  }));
  let scan: ReturnType<typeof scanRestrictionSites>;
  try {
    scan = scanRestrictionSites(normalized, resolution.enzymes, {
      topology,
      methylation: options?.methylation,
      methylationState: options?.methylationState,
      methylationAssumptions: options?.methylationAssumptions,
    } satisfies FindRestrictionSitesOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid restriction recognition sequence.';
    return {
      sequence: normalized,
      topology,
      requestedEnzymes: resolution.requestedNames,
      resolvedEnzymes: resolution.enzymes.map((enzyme) => enzyme.name),
      unknownEnzymes: resolution.unknownEnzymes,
      sites: [],
      cuts: [],
      fragments: [],
      issues: [...issues, { code: 'invalid_recognition_sequence', message }],
      cutCount: 0,
    };
  }
  issues.push(...scan.issues.map(issueFromScan));
  const usableSites = scan.sites.filter(activeDoubleStrandSite);
  const allCutRecords = usableSites.map((site) => {
    const enzyme = resolution.enzymes.find((candidate) => candidate.name.toLocaleLowerCase() === site.enzyme.toLocaleLowerCase())
      ?? resolution.enzymes[0];
    return {
      site,
      enzyme,
      geometry: {
        ...calculateRestrictionCleavageGeometry(enzyme, site.position, site.strand ?? 1),
        topCutPosition: site.topCutPosition ?? null,
        bottomCutPosition: site.bottomCutPosition ?? null,
        cutPosition: site.cutPosition,
      },
    };
  });

  // A legacy top-strand coordinate is only a compatibility boundary. Two
  // enzymes can share it while cleaving the opposite strand at different
  // coordinates (and therefore producing different sticky ends). Group by
  // the complete physical geometry and fail closed when one boundary has
  // incompatible co-located cleavage records.
  const geometryKey = (record: typeof allCutRecords[number]): string => JSON.stringify([
    record.geometry.mode,
    record.geometry.topCutPosition,
    record.geometry.bottomCutPosition,
    record.geometry.cutPosition,
    record.geometry.overhangStart,
    record.geometry.overhangEnd,
    record.geometry.overhangLength,
    record.geometry.valid,
    record.enzyme.overhang,
  ]);
  const recordsByLegacyCut = new Map<number, typeof allCutRecords>();
  for (const record of allCutRecords) {
    const records = recordsByLegacyCut.get(record.site.cutPosition) ?? [];
    records.push(record);
    recordsByLegacyCut.set(record.site.cutPosition, records);
  }
  const uniqueCutRecords: typeof allCutRecords = [];
  const enzymeNamesAtGeometry = new Map<string, string[]>();
  for (const [legacyCutPosition, records] of recordsByLegacyCut) {
    const byGeometry = new Map<string, typeof allCutRecords>();
    for (const record of records) {
      const key = geometryKey(record);
      const matching = byGeometry.get(key) ?? [];
      matching.push(record);
      byGeometry.set(key, matching);
    }
    if (byGeometry.size > 1) {
      const enzymes = Array.from(new Set(records.map((record) => record.enzyme.name)));
      issues.push({
        code: 'incompatible_colocated_cleavage',
        position: legacyCutPosition,
        enzyme: enzymes[0],
        message: `Restriction enzymes ${enzymes.join(', ')} share cut coordinate ${legacyCutPosition} but have incompatible colocated cleavage geometry.`,
      });
    }
    for (const [key, matching] of byGeometry) {
      uniqueCutRecords.push(matching[0]);
      enzymeNamesAtGeometry.set(key, Array.from(new Set(matching.map((record) => record.enzyme.name))));
    }
  }
  const cuts: RestrictionCleavageGeometry[] = uniqueCutRecords.map((record) => ({
    ...record.geometry,
    enzymes: enzymeNamesAtGeometry.get(geometryKey(record)) ?? [record.enzyme.name],
  }));

  const base: RestrictionDigestResult = {
    sequence: normalized,
    topology,
    requestedEnzymes: resolution.requestedNames,
    resolvedEnzymes: resolution.enzymes.map((enzyme) => enzyme.name),
    unknownEnzymes: resolution.unknownEnzymes,
    sites: scan.sites,
    cuts,
    fragments: [],
    issues,
    cutCount: cuts.length,
  };
  // Conditional or physically impossible outcomes never become an intact or
  // partially digested success. Callers can inspect the exact issue and sites.
  if (issues.length > 0 || normalized.length === 0 || cuts.length === 0) {
    if (issues.length === 0 && normalized.length > 0) base.fragments = [wholeFragment(normalized, features)];
    return base;
  }

  const enzymeByName = new Map(resolution.enzymes.map((enzyme) => [enzyme.name.toLocaleLowerCase(), enzyme]));
  const cutRecords = uniqueCutRecords
    .map((record) => ({
      site: record.site,
      enzyme: enzymeByName.get(record.site.enzyme.toLocaleLowerCase())!,
      geometry: record.geometry,
    }))
    .sort((a, b) => a.site.cutPosition - b.site.cutPosition);
  const uniqueCuts = cutRecords.filter((cut, index) => index === 0 || cut.site.cutPosition !== cutRecords[index - 1].site.cutPosition);
  const featureSlicers = buildFeatureSlicers(normalized, topology, features);

  const endFor = (record: typeof uniqueCuts[number], side: 'left' | 'right'): FragmentEnd => {
    const enzyme = record.enzyme;
    // Circular scan results expose cut coordinates modulo the source length so
    // callers can place them on a map.  The sticky window, however, can cross
    // the origin (for example EcoRI at positions n-2..1), and independently
    // modulo-folding its start/end turns one physical interval into `start >
    // end`, which `readSenseOverhang` correctly rejects for linear input but
    // cannot interpret as a wrapped interval.  Recompute the unwrapped
    // physical geometry from the site anchor for materialization; fragment
    // boundaries continue to use the normalized coordinates in `record`.
    const geometry = topology === 'circular'
      ? calculateRestrictionCleavageGeometry(enzyme, record.site.position, record.site.strand ?? 1)
      : record.geometry;
    if (geometry.mode !== 'double-strand') return BLUNT_END;
    if (enzyme.overhang === 'blunt') {
      if (geometry.overhangLength !== 0) throw new RestrictionDigestError({ ...base, issues: [{ code: 'invalid_geometry', enzyme: enzyme.name, message: `Enzyme ${enzyme.name} is labeled blunt but has a non-zero strand gap.` }], fragments: [] });
      return BLUNT_END;
    }
    if (!Number.isInteger(geometry.overhangStart) || !Number.isInteger(geometry.overhangEnd) || geometry.overhangLength <= 0) {
      throw new RestrictionDigestError({ ...base, issues: [{ code: 'invalid_geometry', enzyme: enzyme.name, message: `Enzyme ${enzyme.name} has no materializable sticky-end window.` }], fragments: [] });
    }
    const sense = readSenseOverhang(normalized, geometry.overhangStart, geometry.overhangEnd, topology);
    if (sense === null || sense.length !== geometry.overhangLength) {
      throw new RestrictionDigestError({ ...base, issues: [{ code: 'insufficient_flanking_bases', enzyme: enzyme.name, message: `Enzyme ${enzyme.name} sticky-end window is outside the sequence bounds.` }], fragments: [] });
    }
    const sticky = enzyme.overhang === '3prime' ? reverseComplement(sense) : sense;
    return side === 'left'
      ? { overhang: sticky, type: enzyme.overhang }
      : { overhang: reverseComplement(sticky), type: enzyme.overhang };
  };

  const fragments: DigestFragment[] = [];
  if (topology === 'linear') {
    for (let index = 0; index <= uniqueCuts.length; index += 1) {
      const start = index === 0 ? 0 : uniqueCuts[index - 1].site.cutPosition;
      const end = index === uniqueCuts.length ? normalized.length : uniqueCuts[index].site.cutPosition;
      if (end <= start) continue;
      const leftRecord = index === 0 ? null : uniqueCuts[index - 1];
      const rightRecord = index === uniqueCuts.length ? null : uniqueCuts[index];
      const left = leftRecord ? endFor(leftRecord, 'left') : BLUNT_END;
      const right = rightRecord ? endFor(rightRecord, 'right') : BLUNT_END;
      fragments.push({
        sequence: normalized.slice(start, end),
        length: end - start,
        startInOriginal: start,
        endInOriginal: end,
        leftEnzyme: leftRecord?.enzyme.name ?? null,
        rightEnzyme: rightRecord?.enzyme.name ?? null,
        leftEnzymes: leftRecord ? enzymeNamesAtGeometry.get(geometryKey(leftRecord)) ?? [leftRecord.enzyme.name] : [],
        rightEnzymes: rightRecord ? enzymeNamesAtGeometry.get(geometryKey(rightRecord)) ?? [rightRecord.enzyme.name] : [],
        overhang5: left.overhang,
        overhang3: right.overhang,
        overhang5Type: left.type,
        overhang3Type: right.type,
        features: featureSlicers.sliceFeatures(start, end),
      });
    }
  } else {
    for (let index = 0; index < uniqueCuts.length; index += 1) {
      const current = uniqueCuts[index];
      const next = uniqueCuts[(index + 1) % uniqueCuts.length];
      const start = current.site.cutPosition;
      const end = next.site.cutPosition;
      const fragmentLength = end > start ? end - start : normalized.length - start + end;
      if (fragmentLength <= 0) continue;
      const left = endFor(current, 'left');
      const right = endFor(next, 'right');
      fragments.push({
        sequence: end > start ? normalized.slice(start, end) : normalized.slice(start) + normalized.slice(0, end),
        length: fragmentLength,
        startInOriginal: start,
        endInOriginal: end > start ? end : end + normalized.length,
        leftEnzyme: current.enzyme.name,
        rightEnzyme: next.enzyme.name,
        leftEnzymes: enzymeNamesAtGeometry.get(geometryKey(current)) ?? [current.enzyme.name],
        rightEnzymes: enzymeNamesAtGeometry.get(geometryKey(next)) ?? [next.enzyme.name],
        overhang5: left.overhang,
        overhang3: right.overhang,
        overhang5Type: left.type,
        overhang3Type: right.type,
        features: end > start ? featureSlicers.sliceFeatures(start, end) : featureSlicers.sliceFeaturesWrap(start, end),
      });
    }
  }
  const totalLength = fragments.reduce((sum, fragment) => sum + fragment.length, 0);
  if (totalLength !== normalized.length || fragments.some((fragment) => fragment.length !== fragment.sequence.length)) {
    return {
      ...base,
      issues: [...base.issues, { code: 'invalid_geometry', message: 'Digest fragments violate length or source-conservation invariants.' }],
      fragments: [],
    };
  }
  return { ...base, fragments };
}

/** Preview counts and structured issues without silently dropping unknown names. */
export function digestPreviewDetailed(
  seq: string,
  enzymeNames: string[],
  topology: Topology = 'linear',
  enzymeCatalog: readonly RestrictionEnzyme[] = RESTRICTION_ENZYMES_FULL,
  options?: RestrictionDigestOptions,
): {
  counts: Map<string, number>;
  sites: RestrictionDigestResult['sites'];
  issues: RestrictionDigestIssue[];
  unknownEnzymes: string[];
} {
  const result = restrictionDigestResultFor(seq, enzymeNames, topology, undefined, enzymeCatalog, options);
  const counts = new Map<string, number>(enzymeNames.map((name) => [name, 0]));
  for (const site of result.sites) {
    if (!activeDoubleStrandSite(site)) continue;
    counts.set(site.enzyme, (counts.get(site.enzyme) ?? 0) + 1);
  }
  return { counts, sites: result.sites, issues: result.issues, unknownEnzymes: result.unknownEnzymes };
}

/** Backwards-compatible map API; invalid requests are now explicit errors. */
export function digestPreview(
  seq: string,
  enzymeNames: string[],
  topology: Topology = 'linear',
): Map<string, number> {
  const result = digestPreviewDetailed(seq, enzymeNames, topology);
  if (result.issues.length > 0) {
    throw new RestrictionDigestError({
      sequence: normalizeRestrictionSequence(seq),
      topology,
      requestedEnzymes: enzymeNames,
      resolvedEnzymes: [],
      unknownEnzymes: result.unknownEnzymes,
      sites: result.sites,
      cuts: [],
      fragments: [],
      issues: result.issues,
      cutCount: 0,
    });
  }
  return result.counts;
}

/** Detailed physical digest API. Nicks do not create ordinary cut boundaries. */
export function restrictionDigestDetailed(
  seq: string,
  enzymeNames: string[],
  topology: Topology = 'linear',
  features?: Feature[],
  enzymeCatalog: readonly RestrictionEnzyme[] = RESTRICTION_ENZYMES_FULL,
  options?: RestrictionDigestOptions,
): RestrictionDigestResult {
  return restrictionDigestResultFor(seq, enzymeNames, topology, features, enzymeCatalog, options);
}

/** Descriptive alias for integrations that call diagnostics "with issues". */
export const restrictionDigestWithIssues = restrictionDigestDetailed;

/**
 * Perform a digest using the historical fragment-array return type. New code
 * that needs conditional/physical diagnostics should use
 * `restrictionDigestDetailed`; this wrapper refuses to hide any issue.
 */
export function restrictionDigest(
  seq: string,
  enzymeNames: string[],
  topology: Topology = 'linear',
  features?: Feature[],
  enzymeCatalog: readonly RestrictionEnzyme[] = RESTRICTION_ENZYMES_FULL,
  options?: RestrictionDigestOptions,
): DigestFragment[] {
  const result = restrictionDigestDetailed(seq, enzymeNames, topology, features, enzymeCatalog, options);
  if (result.issues.length > 0) throw new RestrictionDigestError(result);
  return result.fragments;
}
