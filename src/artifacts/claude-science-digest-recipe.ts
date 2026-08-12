import {
  restrictionDigestDetailed,
  type DigestFragment,
  type RestrictionDigestIssue,
  type RestrictionDigestOptions,
  type RestrictionFeatureMappingReceipt,
} from '../bio/restriction-digest';
import type {
  Feature,
  RestrictionEnzyme,
  RestrictionMethylationEvidence,
  RestrictionMethylationRequirement,
  RestrictionSite,
  SequenceType,
  Topology,
} from '../bio/types';
import {
  isActiveDoubleStrandRestrictionSite,
  normalizeRestrictionEnzymes,
} from '../bio/restriction-sites';

export type DigestRecipeIssueCode =
  | 'empty-enzyme-list'
  | 'empty-sequence'
  | 'unresolved-enzyme'
  | 'unsupported-sequence-type'
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
  | 'invalid_feature_collection'
  | 'feature_limit'
  | 'invalid_feature'
  | 'subrange_limit'
  | 'invalid_subrange'
  | 'metadata_limit'
  | 'feature_work_limit'
  | 'feature_mapping_work_limit'
  | 'incompatible_colocated_cleavage';

export interface DigestRecipeIssue {
  code: DigestRecipeIssueCode;
  message: string;
  names?: string[];
  enzyme?: string;
  position?: number;
  required?: string;
  observed?: string;
  evidence?: RestrictionDigestIssue['evidence'];
  retainedSites?: number;
  omittedSitesAtLeast?: number;
  retainedIssues?: number;
}

export interface DigestEnzymeResolution {
  /** Tokens in the order entered, preserving the user's spelling. */
  tokens: string[];
  /** Canonical catalog entries, de-duplicated in first-requested order. */
  enzymes: RestrictionEnzyme[];
  /** Canonical enzyme names that appeared more than once. */
  duplicateNames: string[];
  /** Unknown tokens, de-duplicated case-insensitively in first-requested order. */
  unresolvedNames: string[];
}

export interface DigestRecipeEnzyme {
  enzyme: RestrictionEnzyme;
  name: string;
  cutCount: number;
  /** Recognized single-strand cleavage events that preserve molecule continuity. */
  nickCount: number;
  sites: RestrictionSite[];
  type: 'traditional' | 'type-iis' | 'nickase';
  /** Per-enzyme methylation rule retained in the saved receipt. */
  methylationRequirement?: RestrictionMethylationRequirement;
  /** Context-dependent rules cannot be reduced to a single global state. */
  methylationBehavior?: RestrictionEnzyme['methylationBehavior'];
  methylationEvidence?: RestrictionMethylationEvidence;
}

export type DigestMoleculeOutcome =
  | 'not-run'
  | 'uncut'
  | 'linearized'
  | 'fragmented';

export interface DigestRecipe {
  input: string;
  sequenceType: SequenceType;
  topology: Topology;
  isValid: boolean;
  issues: DigestRecipeIssue[];
  duplicateNames: string[];
  unresolvedNames: string[];
  enzymes: DigestRecipeEnzyme[];
  sites: RestrictionSite[];
  /** Number of distinct physical cut coordinates across all requested enzymes. */
  cutCount: number;
  /** Number of recognition sites, before co-located cuts are collapsed. */
  recognitionSiteCount: number;
  /** Explicit state assumptions used for methylation-sensitive enzymes. */
  methylationAssumptions?: RestrictionDigestOptions['methylationAssumptions'];
  /** Bounded annotation-mapping preflight, when feature propagation was requested. */
  featureMapping?: RestrictionFeatureMappingReceipt;
  outcome: DigestMoleculeOutcome;
  fragments: DigestFragment[];
}

export interface BuildDigestRecipeInput {
  sequence: string;
  sequenceType: SequenceType;
  topology: Topology;
  enzymeText: string;
  enzymeCatalog: readonly RestrictionEnzyme[];
  features?: readonly Feature[];
  methylation?: RestrictionDigestOptions['methylation'];
  methylationState?: RestrictionDigestOptions['methylationState'];
  methylationAssumptions?: RestrictionDigestOptions['methylationAssumptions'];
}

function isTypeIISEnzyme(enzyme: RestrictionEnzyme): boolean {
  const recognitionLength = enzyme.recognitionSequence.length;
  return Math.min(enzyme.cutOffset, enzyme.complementCutOffset) < 0
    || Math.max(enzyme.cutOffset, enzyme.complementCutOffset) > recognitionLength;
}

/**
 * Parse the compact digest field used by the standalone artifact. Enzyme names
 * are conventionally whitespace-free, so commas, semicolons, and whitespace
 * all act as separators. Resolution is case-insensitive while the canonical
 * catalog spelling is retained for display and engine calls.
 */
export function resolveDigestEnzymes(
  input: string,
  enzymeCatalog: readonly RestrictionEnzyme[],
): DigestEnzymeResolution {
  const normalizedCatalog = normalizeRestrictionEnzymes(enzymeCatalog);
  const tokens = input
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const catalogByName = new Map<string, RestrictionEnzyme>();
  for (const enzyme of normalizedCatalog) {
    const key = enzyme.name.trim().toLocaleLowerCase();
    if (key && !catalogByName.has(key)) catalogByName.set(key, enzyme);
  }

  const enzymes: RestrictionEnzyme[] = [];
  const duplicateNames: string[] = [];
  const unresolvedNames: string[] = [];
  const seenResolved = new Set<string>();
  const seenDuplicates = new Set<string>();
  const seenUnresolved = new Set<string>();

  for (const token of tokens) {
    const key = token.toLocaleLowerCase();
    const enzyme = catalogByName.get(key);
    if (!enzyme) {
      if (!seenUnresolved.has(key)) {
        seenUnresolved.add(key);
        unresolvedNames.push(token);
      }
      continue;
    }

    if (seenResolved.has(key)) {
      if (!seenDuplicates.has(key)) {
        seenDuplicates.add(key);
        duplicateNames.push(enzyme.name);
      }
      continue;
    }

    seenResolved.add(key);
    enzymes.push(enzyme);
  }

  return { tokens, enzymes, duplicateNames, unresolvedNames };
}

/**
 * Build a deterministic, UI-ready digest recipe without mutating workspace
 * state. Unknown enzymes and non-DNA records are hard validation failures, so
 * they can never masquerade as a successful one-fragment digest.
 *
 * Restriction sites and fragments come directly from the shared scanner and
 * digest engine. Consequently reverse-strand Type IIS cut coordinates and
 * sticky-end geometry are preserved rather than being reconstructed here.
 */
export function buildDigestRecipe(input: BuildDigestRecipeInput): DigestRecipe {
  const resolution = resolveDigestEnzymes(input.enzymeText, input.enzymeCatalog);
  const issues: DigestRecipeIssue[] = [];

  if (input.sequenceType !== 'dna') {
    issues.push({
      code: 'unsupported-sequence-type',
      message: 'Restriction digest is available for DNA records only.',
    });
  }
  if (input.sequence.length === 0) {
    issues.push({ code: 'empty-sequence', message: 'Add a DNA sequence before running a digest.' });
  }
  if (resolution.tokens.length === 0) {
    issues.push({ code: 'empty-enzyme-list', message: 'Choose at least one restriction enzyme.' });
  }
  if (resolution.unresolvedNames.length > 0) {
    issues.push({
      code: 'unresolved-enzyme',
      message: `Unknown restriction enzyme${resolution.unresolvedNames.length === 1 ? '' : 's'}: ${resolution.unresolvedNames.join(', ')}.`,
      names: [...resolution.unresolvedNames],
    });
  }

  const canScan = input.sequenceType === 'dna'
    && input.sequence.length > 0
    && resolution.enzymes.length > 0;
  const digestResult = canScan
    ? restrictionDigestDetailed(
      input.sequence,
      resolution.enzymes.map((enzyme) => enzyme.name),
      input.topology,
      input.features ? [...input.features] : undefined,
      resolution.enzymes,
      {
        methylation: input.methylation,
        methylationState: input.methylationState,
        methylationAssumptions: input.methylationAssumptions,
      },
    )
    : null;
  const sites = digestResult?.sites ?? [];
  const digestIssues = digestResult?.issues ?? [];
  issues.push(...digestIssues.map((issue: RestrictionDigestIssue): DigestRecipeIssue => ({
    code: issue.code === 'unknown_enzyme' ? 'unresolved-enzyme' : issue.code,
    message: issue.message,
    ...(issue.enzyme === undefined ? {} : { enzyme: issue.enzyme }),
    ...(issue.position === undefined ? {} : { position: issue.position }),
    ...(issue.required === undefined ? {} : { required: issue.required }),
    ...(issue.observed === undefined ? {} : { observed: issue.observed }),
    ...(issue.evidence === undefined ? {} : { evidence: issue.evidence }),
    ...(issue.retainedSites === undefined ? {} : { retainedSites: issue.retainedSites }),
    ...(issue.omittedSitesAtLeast === undefined ? {} : { omittedSitesAtLeast: issue.omittedSitesAtLeast }),
    ...(issue.retainedIssues === undefined ? {} : { retainedIssues: issue.retainedIssues }),
  })));

  const enzymes = resolution.enzymes.map((enzyme): DigestRecipeEnzyme => {
    const enzymeSites = sites.filter((site) => site.enzyme.toLocaleLowerCase() === enzyme.name.toLocaleLowerCase());
    const cutSites = enzymeSites.filter((site) => (
      isActiveDoubleStrandRestrictionSite(site)
    ));
    const nickSites = enzymeSites.filter((site) => (
      site.cleavageMode !== undefined
      && site.cleavageStatus === 'ok'
      && !isActiveDoubleStrandRestrictionSite(site)
    ));
    const methylationEvidence = enzyme.methylationEvidence ?? enzyme.methylationRequirement?.evidence;
    return {
      enzyme,
      name: enzyme.name,
      cutCount: cutSites.length,
      nickCount: nickSites.length,
      sites: enzymeSites,
      type: (enzyme.cleavageMode ?? 'double-strand') !== 'double-strand'
        ? 'nickase'
        : isTypeIISEnzyme(enzyme)
          ? 'type-iis'
          : 'traditional',
      ...(enzyme.methylationRequirement === undefined
        ? {}
        : { methylationRequirement: enzyme.methylationRequirement }),
      ...(enzyme.methylationBehavior === undefined
        ? {}
        : { methylationBehavior: enzyme.methylationBehavior }),
      ...(methylationEvidence === undefined
        ? {}
        : { methylationEvidence }),
    };
  });

  const isValid = issues.length === 0;
  const fragments = isValid ? (digestResult?.fragments ?? []) : [];
  const cutCount = digestResult?.cutCount ?? 0;
  const resolvedMethylationAssumptions = input.methylationAssumptions ?? input.methylation ?? input.methylationState;
  const methylationAssumptions = typeof resolvedMethylationAssumptions === 'object'
    && resolvedMethylationAssumptions !== null
    ? { ...resolvedMethylationAssumptions }
    : resolvedMethylationAssumptions;

  let outcome: DigestMoleculeOutcome = 'not-run';
  if (isValid) {
    if (cutCount === 0) outcome = 'uncut';
    else if (input.topology === 'circular' && cutCount === 1) outcome = 'linearized';
    else outcome = 'fragmented';
  }

  return {
    input: input.enzymeText,
    sequenceType: input.sequenceType,
    topology: input.topology,
    isValid,
    issues,
    duplicateNames: resolution.duplicateNames,
    unresolvedNames: resolution.unresolvedNames,
    enzymes,
    sites,
    cutCount,
    recognitionSiteCount: sites.length,
    ...(input.methylation === undefined && input.methylationState === undefined && input.methylationAssumptions === undefined
      ? {}
      : {
          methylationAssumptions,
        }),
    ...(digestResult?.featureMapping === undefined ? {} : { featureMapping: digestResult.featureMapping }),
    outcome,
    fragments,
  };
}
