import type { RestrictionEnzyme } from './types';
import { RESTRICTION_ENZYMES } from './restriction-sites';
import { RESTRICTION_ENZYMES_FULL } from './enzyme-data';

export type RestrictionPresetId =
  | 'golden-gate-type-iis'
  | 'common-mcs'
  | 'classic-6-cutter'
  | 'diagnostic-screening';

/**
 * A user-defined, named enzyme set. Referenced in `restrictionEnzymeSources` as
 * `custom:<id>` (mirrors the `custom:<id>` codon-table pattern). Persisted to
 * localStorage + the settings backup by the UI store.
 */
export interface CustomEnzymeList {
  id: string;
  name: string;
  enzymeNames: string[];
}

/** The `custom:` source prefix → bare list id. */
export const CUSTOM_ENZYME_LIST_PREFIX = 'custom:';

export interface RestrictionEnzymePreset {
  id: RestrictionPresetId;
  name: string;
  shortName: string;
  description: string;
  purpose: string;
  enzymeNames: readonly string[];
}

export const GOLDEN_GATE_TYPE_IIS_ENZYMES = [
  'BsaI',
  'BbsI',
  'BsmBI',
  'Esp3I',
  'SapI',
  'BspQI',
] as const;

export const COMMON_MCS_ENZYMES = [
  'EcoRI',
  'BamHI',
  'HindIII',
  'XbaI',
  'SalI',
  'PstI',
  'NotI',
  'XhoI',
  'NcoI',
  'NdeI',
  'SpeI',
  'KpnI',
  'SacI',
  'SmaI',
  'BglII',
  'ClaI',
  'EcoRV',
  'AgeI',
  'NheI',
  'MluI',
] as const;

export const CLASSIC_6_CUTTER_ENZYMES = [
  'EcoRI',
  'BamHI',
  'HindIII',
  'XbaI',
  'SalI',
  'PstI',
  'NotI',
  'XhoI',
  'NcoI',
  'NdeI',
  'SpeI',
  'KpnI',
  'SacI',
  'SmaI',
  'BglII',
  'ClaI',
  'EcoRV',
  'ScaI',
  'ApaI',
  'SphI',
] as const;

export const DIAGNOSTIC_SCREENING_ENZYMES = [
  'AluI',
  'HaeIII',
  'TaqI',
  'HpaII',
  'MspI',
  'DpnI',
  'MboI',
  'Sau3AI',
  'RsaI',
  'MseI',
  'Tsp509I',
  'HhaI',
] as const;

export const RESTRICTION_PRESETS: readonly RestrictionEnzymePreset[] = [
  {
    id: 'golden-gate-type-iis',
    name: 'Golden Gate Type IIS',
    shortName: 'Golden Gate',
    description: 'Common Type IIS enzymes for MoClo, Golden Gate, GoldenBraid, Loop, and YTK-style assembly.',
    purpose: 'Screen inserts and vectors for internal Type IIS sites before choosing direct assembly versus PCR/domestication.',
    enzymeNames: GOLDEN_GATE_TYPE_IIS_ENZYMES,
  },
  {
    id: 'common-mcs',
    name: 'Common MCS enzymes',
    shortName: 'MCS',
    description: 'Frequently used multiple-cloning-site enzymes across pUC/pET/pcDNA-style vectors.',
    purpose: 'Quickly inspect whether a sequence is compatible with common subcloning sites.',
    enzymeNames: COMMON_MCS_ENZYMES,
  },
  {
    id: 'classic-6-cutter',
    name: 'Classic 6-cutter panel',
    shortName: '6-cutters',
    description: 'Balanced set of workhorse 6-cutters and blunt cutters for routine maps and diagnostic digests.',
    purpose: 'Find unique cutters and digest options without the noise of the full catalog.',
    enzymeNames: CLASSIC_6_CUTTER_ENZYMES,
  },
  {
    id: 'diagnostic-screening',
    name: 'Diagnostic screening enzymes',
    shortName: 'Screening',
    description: 'Common 4-cutters and methylation-sensitive enzymes for fast RFLP-style checks.',
    purpose: 'Generate dense diagnostic patterns for shorter ORFs, amplicons, and QC fragments.',
    enzymeNames: DIAGNOSTIC_SCREENING_ENZYMES,
  },
] as const;

const PRESET_BY_ID = new Map<RestrictionPresetId, RestrictionEnzymePreset>(
  RESTRICTION_PRESETS.map((preset) => [preset.id, preset]),
);

function enzymeByName(
  name: string,
  enzymeDb: readonly RestrictionEnzyme[],
): RestrictionEnzyme | null {
  const normalized = name.toLowerCase();
  return enzymeDb.find((enzyme) => enzyme.name.toLowerCase() === normalized) ?? null;
}

export function getRestrictionPreset(id: RestrictionPresetId): RestrictionEnzymePreset {
  const preset = PRESET_BY_ID.get(id);
  if (!preset) {
    throw new Error(`Unknown restriction preset: ${id}`);
  }
  return preset;
}

export function resolveRestrictionPresetEnzymes(
  id: RestrictionPresetId,
  enzymeDb: readonly RestrictionEnzyme[] = RESTRICTION_ENZYMES_FULL,
): RestrictionEnzyme[] {
  const preset = getRestrictionPreset(id);
  const fallbackDb = enzymeDb === RESTRICTION_ENZYMES_FULL
    ? RESTRICTION_ENZYMES
    : [...enzymeDb, ...RESTRICTION_ENZYMES];

  return preset.enzymeNames.map((name) => {
    const enzyme = enzymeByName(name, enzymeDb) ?? enzymeByName(name, fallbackDb);
    if (!enzyme) {
      throw new Error(`Restriction preset "${preset.id}" references unknown enzyme "${name}".`);
    }
    return enzyme;
  });
}

export function listRestrictionPresetNames(): string[] {
  return RESTRICTION_PRESETS.map((preset) => preset.name);
}

/** A selectable enzyme-list source: a built-in scope or a named preset. */
export type RestrictionEnzymeSourceId = 'common' | 'all' | 'favorites' | RestrictionPresetId;

/**
 * R17 — resolve a UNION of enzyme sources into a deduped enzyme list (by name,
 * case-insensitive). Lets the restriction UI offer "pick any combination of
 * lists" — Common + Type IIS + Favorites + … — and scan one merged set so the
 * inspector AND the detail-view ticks reflect the same selection. `'all'`
 * dominates (it is the full catalog). Never returns empty — falls back to the
 * common working set so a scan always has something to do.
 */
export function resolveEnzymeUnion(
  sources: readonly string[],
  favorites: readonly string[] = [],
  customLists: readonly CustomEnzymeList[] = [],
): RestrictionEnzyme[] {
  if (sources.includes('all')) return [...RESTRICTION_ENZYMES_FULL];
  const fullByName = new Map(
    RESTRICTION_ENZYMES_FULL.map((enzyme) => [enzyme.name.toLowerCase(), enzyme] as const),
  );
  const customById = new Map(customLists.map((list) => [list.id, list] as const));
  const byName = new Map<string, RestrictionEnzyme>();
  const add = (enzyme: RestrictionEnzyme | null | undefined) => {
    if (!enzyme) return;
    const key = enzyme.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, enzyme);
  };
  for (const source of sources) {
    if (source === 'common') {
      for (const enzyme of RESTRICTION_ENZYMES) add(enzyme);
    } else if (source === 'favorites') {
      for (const name of favorites) add(fullByName.get(name.toLowerCase()));
    } else if (source.startsWith(CUSTOM_ENZYME_LIST_PREFIX)) {
      const list = customById.get(source.slice(CUSTOM_ENZYME_LIST_PREFIX.length));
      if (list) for (const name of list.enzymeNames) add(fullByName.get(name.toLowerCase()));
    } else if (PRESET_BY_ID.has(source as RestrictionPresetId)) {
      for (const name of getRestrictionPreset(source as RestrictionPresetId).enzymeNames) {
        add(fullByName.get(name.toLowerCase()) ?? enzymeByName(name, RESTRICTION_ENZYMES));
      }
    }
  }
  // Fallback to Common only for a TRULY degenerate selection (no resolvable
  // source). A favorites-only / custom-only selection that legitimately resolves
  // to nothing is handled by the caller (empty-state), so don't mask it here.
  if (byName.size === 0 && !sources.some((s) => s === 'favorites' || s.startsWith(CUSTOM_ENZYME_LIST_PREFIX))) {
    for (const enzyme of RESTRICTION_ENZYMES) add(enzyme);
  }
  return Array.from(byName.values());
}

// ── Isoschizomer canonical naming (R70) ─────────────────────────────────────
// Enzymes that share a recognition site (isoschizomers) fold into ONE inspector
// row / detail tick, so a single representative name is shown. Picking it purely
// alphabetically made the SAME physical site flip identity with the active
// enzyme list: GCTAGC reads "NheI" under Common (its only member) but "BmtI"
// under All (BmtI sorts before NheI). Prefer a member of the curated Common
// working set so a site keeps a stable, recognizable identity regardless of
// which list is active. Shared by RestrictionInspectorTab + DetailSequenceDisplay
// so both surfaces name a co-located cut identically.
const COMMON_WORKING_SET_NAMES: ReadonlySet<string> = new Set(
  RESTRICTION_ENZYMES.map((enzyme) => enzyme.name.toLowerCase()),
);

/**
 * Pick the canonical "primary" name among isoschizomers. Prefers a Common
 * working-set member; alphabetical is the tiebreak (within the common subset, or
 * across all names when none qualifies). Order-independent and stable across
 * enzyme-list scope toggles.
 */
export function pickPrimaryEnzymeName(names: readonly string[]): string {
  const alpha = [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const common = alpha.filter((name) => COMMON_WORKING_SET_NAMES.has(name.toLowerCase()));
  return (common.length > 0 ? common : alpha)[0];
}

/**
 * Order an isoschizomer group's names for display: canonical primary first, then
 * the rest alphabetically — so a merged label leads with the recognizable name
 * ("NheI/BmtI", not "BmtI/NheI").
 */
export function orderIsoschizomerNames(names: readonly string[]): string[] {
  const primary = pickPrimaryEnzymeName(names);
  const rest = names
    .filter((name) => name !== primary)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return [primary, ...rest];
}
