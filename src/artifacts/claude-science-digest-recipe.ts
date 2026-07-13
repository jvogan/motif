import { restrictionDigest, type DigestFragment } from '../bio/restriction-digest';
import { findRestrictionSites } from '../bio/restriction-sites';
import type {
  Feature,
  RestrictionEnzyme,
  RestrictionSite,
  SequenceType,
  Topology,
} from '../bio/types';

export type DigestRecipeIssueCode =
  | 'empty-enzyme-list'
  | 'empty-sequence'
  | 'unresolved-enzyme'
  | 'unsupported-sequence-type';

export interface DigestRecipeIssue {
  code: DigestRecipeIssueCode;
  message: string;
  names?: string[];
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
  sites: RestrictionSite[];
  type: 'traditional' | 'type-iis';
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
  const tokens = input
    .split(/[\s,;]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const catalogByName = new Map<string, RestrictionEnzyme>();
  for (const enzyme of enzymeCatalog) {
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
  const sites = canScan
    ? findRestrictionSites(input.sequence, [...resolution.enzymes], { topology: input.topology })
    : [];

  const enzymes = resolution.enzymes.map((enzyme): DigestRecipeEnzyme => {
    const enzymeSites = sites.filter((site) => site.enzyme.toLocaleLowerCase() === enzyme.name.toLocaleLowerCase());
    return {
      enzyme,
      name: enzyme.name,
      cutCount: enzymeSites.length,
      sites: enzymeSites,
      type: isTypeIISEnzyme(enzyme) ? 'type-iis' : 'traditional',
    };
  });

  const isValid = issues.length === 0;
  const fragments = isValid
    ? restrictionDigest(
      input.sequence,
      resolution.enzymes.map((enzyme) => enzyme.name),
      input.topology,
      input.features ? [...input.features] : undefined,
      resolution.enzymes,
    )
    : [];
  const distinctCutPositions = new Set(sites.map((site) => site.cutPosition));
  const cutCount = distinctCutPositions.size;

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
    outcome,
    fragments,
  };
}
