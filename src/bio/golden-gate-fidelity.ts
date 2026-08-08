import {
  GOLDEN_GATE_FIDELITY_RAW_DATASETS,
  type GoldenGateFidelityRawDataset,
} from './golden-gate-fidelity-data';
import { reverseComplement } from './reverse-complement';

/**
 * Evidence-backed ligation-fidelity analysis for Golden Gate junction sets.
 *
 * The bundled matrices are raw observed ligation-event counts, not calibrated
 * probabilities.  A per-junction estimate is therefore a conditional ratio
 * of the intended count to the intended count plus the observed counts for
 * the other ends in the proposed assembly.  The whole-assembly estimate is
 * the product of those ratios, matching Pryor et al.'s published Eq. 1 and
 * explicitly carrying the independence assumption in the result.
 */

const DNA_PATTERN = /^[ACGT]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export type GoldenGateFidelityTemperatureStep = {
  temperatureC: number;
  minutes: number;
};

/** Every field is required so a partial condition cannot borrow a score. */
export type GoldenGateFidelityCondition = {
  enzyme: string;
  ligase: string;
  enzymeAmount: string;
  buffer: string;
  reactionVolumeUl: number;
  substrateConcentrationNm: number;
  cycles: number;
  cycleSteps: readonly GoldenGateFidelityTemperatureStep[];
  finalHeatSoak: GoldenGateFidelityTemperatureStep;
};

export type GoldenGateFidelityProvenance = {
  datasetId: string;
  datasetVersion: string;
  citation: string;
  doi: string;
  articleUrl: string;
  dataUrl: string;
  table: string;
  license: 'CC BY 4.0';
  sourceSha256: string;
};

type SparseCount = readonly [row: number, column: number, count: number];

export type GoldenGateFidelityDataset = {
  id: string;
  condition: GoldenGateFidelityCondition;
  overhangLength: 3 | 4;
  overhangs: readonly string[];
  provenance: GoldenGateFidelityProvenance;
  /**
   * Count lookup for a physical 5′→3′ pair.  The supporting tables put
   * the reverse-complement of the physical right-hand axis on their row
   * labels and the physical left-hand axis on their column labels.
   */
  count(leftOverhang: string, rightOverhang: string): number;
};

export type GoldenGateFidelityJunction = {
  leftOverhang: string | null | undefined;
  rightOverhang: string | null | undefined;
  label?: string;
};

export type GoldenGateFidelityMethod = 'empirical' | 'hamming-heuristic';

export type GoldenGateFidelityJunctionScore = {
  index: number;
  label?: string;
  leftOverhang: string | null;
  rightOverhang: string | null;
  status: 'supported' | 'unknown' | 'heuristic';
  correctCount: number | null;
  mismatchCount: number | null;
  totalCount: number | null;
  /** Alias retained next to the explicit count fields for receipt consumers. */
  counts: { correct: number; mismatch: number; total: number } | null;
  /** Empirical conditional correct-vs-mismatch estimate. */
  fidelity: number | null;
  estimatedFidelity: number | null;
  /** Never a probability: only populated for the Hamming fallback. */
  heuristicScore: number | null;
  nearestMismatchDistance: number | null;
  reason?: string;
};

export type GoldenGateFidelityAssemblySummary = {
  junctionCount: number;
  knownJunctions: number;
  unknownJunctions: number;
  coverage: number;
  estimatedFidelity: number | null;
  /** Never a probability. This is only used to compare heuristic candidates. */
  heuristicScore: number | null;
  assumptions: string[];
  unknownReasons: string[];
};

export type GoldenGateFidelityAssessment = {
  status: 'supported' | 'partial' | 'unsupported' | 'unknown' | 'heuristic';
  method: GoldenGateFidelityMethod;
  datasetId: string | null;
  condition: GoldenGateFidelityCondition | null;
  provenance: GoldenGateFidelityProvenance | null;
  junctions: GoldenGateFidelityJunctionScore[];
  assembly: GoldenGateFidelityAssemblySummary;
  warnings: string[];
};

export type GoldenGateOverhangSetCandidate = {
  id?: string;
  /** Use explicit junction pairs when the assembly order is already known. */
  junctions?: readonly GoldenGateFidelityJunction[];
  /** Convenience form: each overhang is scored against its Watson–Crick pair. */
  overhangs?: readonly string[];
};

export type GoldenGateFidelityRankingEntry = {
  rank: number;
  candidateIndex: number;
  candidateId: string;
  assessment: GoldenGateFidelityAssessment;
};

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function conditionKey(condition: GoldenGateFidelityCondition | null | undefined): string | null {
  if (!condition
    || typeof condition !== 'object'
    || typeof condition.enzyme !== 'string'
    || typeof condition.ligase !== 'string'
    || typeof condition.enzymeAmount !== 'string'
    || typeof condition.buffer !== 'string'
    || !finitePositive(condition.reactionVolumeUl)
    || !finitePositive(condition.substrateConcentrationNm)
    || !Number.isInteger(condition.cycles)
    || condition.cycles <= 0
    || !Array.isArray(condition.cycleSteps)
    || condition.cycleSteps.length === 0
    || !condition.cycleSteps.every((step) => (
      step !== null
      && typeof step === 'object'
      && finiteNonnegative(step.temperatureC)
      && finitePositive(step.minutes)
    ))
    || condition.finalHeatSoak === null
    || typeof condition.finalHeatSoak !== 'object'
    || !finiteNonnegative(condition.finalHeatSoak.temperatureC)
    || !finitePositive(condition.finalHeatSoak.minutes)) {
    return null;
  }
  return JSON.stringify({
    enzyme: normalizeText(condition.enzyme),
    ligase: normalizeText(condition.ligase),
    enzymeAmount: normalizeText(condition.enzymeAmount),
    buffer: normalizeText(condition.buffer),
    reactionVolumeUl: condition.reactionVolumeUl,
    substrateConcentrationNm: condition.substrateConcentrationNm,
    cycles: condition.cycles,
    cycleSteps: condition.cycleSteps.map((step) => ({
      temperatureC: step.temperatureC,
      minutes: step.minutes,
    })),
    finalHeatSoak: {
      temperatureC: condition.finalHeatSoak.temperatureC,
      minutes: condition.finalHeatSoak.minutes,
    },
  });
}

function sourceHashIsValid(raw: GoldenGateFidelityRawDataset): boolean {
  return Boolean(raw?.source && SHA256_PATTERN.test(raw.source.sourceSha256));
}

function parseProfile(raw: GoldenGateFidelityRawDataset): GoldenGateFidelityTemperatureStep[] {
  const profile = /^(37|42)\/16 °C, 5 min each, 30 cycles; 60 °C 5 min$/.exec(raw.temperatureProfile);
  if (!profile) throw new Error(`Invalid Golden Gate fidelity temperature profile in ${raw.id}.`);
  const first = Number(profile[1]);
  return [
    { temperatureC: first, minutes: 5 },
    { temperatureC: 16, minutes: 5 },
  ];
}

function sparseCounts(raw: GoldenGateFidelityRawDataset): SparseCount[] {
  if (typeof raw.nonZeroCounts !== 'string' || raw.nonZeroCounts.length === 0) return [];
  return raw.nonZeroCounts.split(';').map((entry) => {
    const values = entry.split(',').map(Number);
    if (values.length !== 3 || !values.every(Number.isInteger) || values[2] < 0) {
      throw new Error(`Invalid sparse Golden Gate fidelity count in ${raw.id}.`);
    }
    return values as unknown as SparseCount;
  });
}

function makeCondition(raw: GoldenGateFidelityRawDataset): GoldenGateFidelityCondition {
  return {
    enzyme: raw.enzyme,
    ligase: raw.ligase,
    enzymeAmount: raw.enzymeAmount,
    buffer: raw.buffer,
    reactionVolumeUl: raw.reactionVolumeUl,
    substrateConcentrationNm: raw.substrateConcentrationNm,
    cycles: raw.cycles,
    cycleSteps: parseProfile(raw),
    finalHeatSoak: { ...raw.finalHeatSoak },
  };
}

function copyCondition(condition: GoldenGateFidelityCondition | null | undefined): GoldenGateFidelityCondition | null {
  if (conditionKey(condition) === null || !condition) return null;
  return {
    ...condition,
    cycleSteps: condition.cycleSteps.map((step) => ({ ...step })),
    finalHeatSoak: { ...condition.finalHeatSoak },
  };
}

function buildDataset(raw: GoldenGateFidelityRawDataset): GoldenGateFidelityDataset {
  if (!raw || typeof raw !== 'object' || !raw.id || !sourceHashIsValid(raw)
    || !raw.source || raw.source.license !== 'CC BY 4.0'
    || ![raw.source.citation, raw.source.doi, raw.source.articleUrl, raw.source.dataUrl, raw.source.table]
      .every((value) => typeof value === 'string' && value.trim().length > 0)) {
    throw new Error(`Invalid provenance for Golden Gate fidelity dataset ${raw?.id || '(unnamed)'}.`);
  }
  if ((raw.overhangLength !== 3 && raw.overhangLength !== 4)
    || !Array.isArray(raw.overhangs)
    || raw.overhangs.length !== 4 ** raw.overhangLength
    || raw.reactionVolumeUl !== 20
    || raw.substrateConcentrationNm !== 100
    || raw.cycles !== 30
    || raw.finalHeatSoak?.temperatureC !== 60
    || raw.finalHeatSoak?.minutes !== 5) {
    throw new Error(`Dataset ${raw.id} has an invalid condition or overhang axis.`);
  }
  const index = new Map<string, number>();
  raw.overhangs.forEach((overhang, position) => {
    if (!DNA_PATTERN.test(overhang)
      || overhang !== overhang.toUpperCase()
      || overhang.length !== raw.overhangLength
      || index.has(overhang)) {
      throw new Error(`Dataset ${raw.id} has an invalid or duplicate overhang label.`);
    }
    index.set(overhang, position);
  });
  const values = new Map<string, number>();
  for (const [row, column, count] of sparseCounts(raw)) {
    if (row < 0 || row >= raw.overhangs.length || column < 0 || column >= raw.overhangs.length) {
      throw new Error(`Dataset ${raw.id} contains an out-of-range sparse count.`);
    }
    const key = `${row}:${column}`;
    if (values.has(key)) throw new Error(`Dataset ${raw.id} contains duplicate sparse counts.`);
    values.set(key, count);
  }
  // Retain the published orientation-specific counts exactly.  The source
  // tables are indexed by the two 5′→3′ overhang axes, but their observed
  // entries are not guaranteed to be byte-for-byte symmetric at every cell.
  // Do not average, mirror, or otherwise invent a missing measurement.  The
  // caller supplies the assembly orientation and count() returns that exact
  // source cell; reverse-complement orientation is handled by the caller's
  // junction representation rather than by silently rewriting the matrix.
  const condition = makeCondition(raw);
  const sparse = values;
  return {
    id: raw.id,
    condition,
    overhangLength: raw.overhangLength,
    overhangs: [...raw.overhangs],
    provenance: {
      datasetId: raw.id,
      datasetVersion: raw.source.table,
      citation: raw.source.citation,
      doi: raw.source.doi,
      articleUrl: raw.source.articleUrl,
      dataUrl: raw.source.dataUrl,
      table: raw.source.table,
      license: raw.source.license,
      sourceSha256: raw.source.sourceSha256,
    },
    count(leftOverhang, rightOverhang) {
      const left = leftOverhang.trim().toUpperCase();
      const right = rightOverhang.trim().toUpperCase();
      const row = index.get(reverseComplement(right).toUpperCase());
      const column = index.get(left);
      if (row === undefined || column === undefined) return 0;
      return sparse.get(`${row}:${column}`) ?? 0;
    },
  };
}

export const GOLDEN_GATE_FIDELITY_DATASETS: readonly GoldenGateFidelityDataset[] = GOLDEN_GATE_FIDELITY_RAW_DATASETS.map(buildDataset);

export const GOLDEN_GATE_FIDELITY_CONDITIONS: Readonly<Record<string, GoldenGateFidelityCondition>> = Object.fromEntries(
  GOLDEN_GATE_FIDELITY_DATASETS.map((dataset) => [dataset.id, dataset.condition]),
);

/** Return only a condition-exact dataset; no enzyme or buffer substitution is allowed. */
export function findGoldenGateFidelityDataset(
  condition: GoldenGateFidelityCondition | null | undefined,
): GoldenGateFidelityDataset | null {
  const key = conditionKey(condition);
  if (key === null) return null;
  return GOLDEN_GATE_FIDELITY_DATASETS.find((dataset) => conditionKey(dataset.condition) === key) ?? null;
}

/** Validate an imported dataset before it is eligible to produce a score. */
export function importGoldenGateFidelityDataset(raw: GoldenGateFidelityRawDataset): GoldenGateFidelityDataset {
  return buildDataset(raw);
}

function normalizeOverhang(value: string | null | undefined, length: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return normalized.length === length && DNA_PATTERN.test(normalized) ? normalized : null;
}

function hammingDistance(a: string, b: string): number {
  let distance = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) distance += 1;
  }
  return distance + Math.abs(a.length - b.length);
}

function uniqueOverhangs(junctions: readonly GoldenGateFidelityJunction[], length: number): string[] {
  return [...new Set(junctions.flatMap((junction) => [
    normalizeOverhang(junction.leftOverhang, length),
    normalizeOverhang(junction.rightOverhang, length),
  ]).filter((value): value is string => value !== null))];
}

function unknownJunction(
  index: number,
  junction: GoldenGateFidelityJunction,
  reason: string,
): GoldenGateFidelityJunctionScore {
  return {
    index,
    ...(junction.label === undefined ? {} : { label: junction.label }),
    leftOverhang: typeof junction.leftOverhang === 'string' ? junction.leftOverhang.trim().toUpperCase() || null : null,
    rightOverhang: typeof junction.rightOverhang === 'string' ? junction.rightOverhang.trim().toUpperCase() || null : null,
    status: 'unknown',
    correctCount: null,
    mismatchCount: null,
    totalCount: null,
    counts: null,
    fidelity: null,
    estimatedFidelity: null,
    heuristicScore: null,
    nearestMismatchDistance: null,
    reason,
  };
}

function empiricalJunctionScore(
  index: number,
  junction: GoldenGateFidelityJunction,
  dataset: GoldenGateFidelityDataset,
  competitors: readonly string[],
): GoldenGateFidelityJunctionScore {
  const left = normalizeOverhang(junction.leftOverhang, dataset.overhangLength);
  const right = normalizeOverhang(junction.rightOverhang, dataset.overhangLength);
  if (!left || !right) return unknownJunction(index, junction, 'Both junction overhangs must be concrete A/C/G/T sequences.');
  if (reverseComplement(left).toUpperCase() !== right) {
    return unknownJunction(index, junction, 'The intended junction overhangs are not Watson–Crick complements.');
  }
  // The published p(O) definition counts both orientations: Oᵢ→WC(Oᵢ)
  // and WC(Oᵢ)→Oᵢ.  The denominator likewise includes every selected
  // overhang and its complement for both orientations.  `competitors` is
  // already the deduplicated physical-end set for the proposed assembly.
  const correct = dataset.count(left, right) + dataset.count(right, left);
  const total = competitors.reduce(
    (sum, competitor) => sum + dataset.count(left, competitor) + dataset.count(right, competitor),
    0,
  );
  if (total <= 0) {
    return unknownJunction(index, junction, 'The empirical matrix contains no observed ligation events for this assembly context.');
  }
  const mismatch = Math.max(0, total - correct);
  const fidelity = correct / total;
  return {
    index,
    ...(junction.label === undefined ? {} : { label: junction.label }),
    leftOverhang: left,
    rightOverhang: right,
    status: 'supported',
    correctCount: correct,
    mismatchCount: mismatch,
    totalCount: total,
    counts: { correct, mismatch, total },
    fidelity,
    estimatedFidelity: fidelity,
    heuristicScore: null,
    nearestMismatchDistance: null,
  };
}

function heuristicJunctionScore(
  index: number,
  junction: GoldenGateFidelityJunction,
  competitors: readonly string[],
  length: number,
): GoldenGateFidelityJunctionScore {
  const left = normalizeOverhang(junction.leftOverhang, length);
  const right = normalizeOverhang(junction.rightOverhang, length);
  if (!left || !right) return unknownJunction(index, junction, 'Both junction overhangs must be concrete A/C/G/T sequences.');
  const expected = reverseComplement(left).toUpperCase();
  if (right !== expected) {
    return {
      ...unknownJunction(index, junction, 'The intended junction overhangs are not Watson–Crick complements.'),
      leftOverhang: left,
      rightOverhang: right,
    };
  }
  const alternatives = competitors.filter((candidate) => candidate !== right);
  const nearest = alternatives.length === 0
    ? length
    : Math.min(...alternatives.map((candidate) => hammingDistance(right, candidate)));
  const score = nearest / length;
  return {
    index,
    ...(junction.label === undefined ? {} : { label: junction.label }),
    leftOverhang: left,
    rightOverhang: right,
    status: 'heuristic',
    correctCount: null,
    mismatchCount: null,
    totalCount: null,
    counts: null,
    fidelity: null,
    estimatedFidelity: null,
    heuristicScore: score,
    nearestMismatchDistance: nearest,
    reason: 'Hamming-distance heuristic; no empirical ligation probability is claimed.',
  };
}

function buildAssemblySummary(
  scores: readonly GoldenGateFidelityJunctionScore[],
  method: GoldenGateFidelityMethod,
): GoldenGateFidelityAssemblySummary {
  const known = scores.filter((score) => score.status === 'supported' || score.status === 'heuristic');
  const empirical = scores.filter((score) => score.status === 'supported' && score.estimatedFidelity !== null);
  const unknownReasons = [...new Set(scores.flatMap((score) => score.reason ? [score.reason] : []))];
  const allEmpirical = method === 'empirical' && scores.length > 0 && empirical.length === scores.length;
  const allHeuristic = method === 'hamming-heuristic' && scores.length > 0 && known.length === scores.length;
  const estimatedFidelity = allEmpirical
    ? empirical.reduce((product, score) => product * (score.estimatedFidelity as number), 1)
    : null;
  const heuristicScore = allHeuristic
    ? known.reduce((product, score) => product * (score.heuristicScore as number), 1)
    : null;
  return {
    junctionCount: scores.length,
    knownJunctions: known.length,
    unknownJunctions: scores.length - known.length,
    coverage: scores.length === 0 ? 0 : known.length / scores.length,
    estimatedFidelity,
    heuristicScore,
    assumptions: allEmpirical
      ? ['Whole-assembly estimate multiplies per-junction conditional ratios under the independence assumption used by Pryor et al. (2020).']
      : method === 'hamming-heuristic'
        ? ['Hamming values rank sequence separation only; they are not empirical ligation probabilities.']
        : [],
    unknownReasons,
  };
}

export function assessGoldenGateAssemblyFidelity(input: {
  junctions: readonly GoldenGateFidelityJunction[];
  condition?: GoldenGateFidelityCondition | null;
  /** Optional assembly enzyme guard; prevents a condition being borrowed across enzymes. */
  enzyme?: string | null;
  method?: 'empirical' | 'hamming';
  fallback?: 'none' | 'hamming';
}): GoldenGateFidelityAssessment {
  const requestedMethod: GoldenGateFidelityMethod = input?.method === 'hamming' || input?.fallback === 'hamming'
    ? 'hamming-heuristic'
    : 'empirical';
  const requestedJunctions = Array.isArray(input?.junctions) ? input.junctions : [];
  if (requestedMethod === 'hamming-heuristic') {
    const length = requestedJunctions.find((junction) => typeof junction.leftOverhang === 'string' || typeof junction.rightOverhang === 'string')
      ?.leftOverhang?.trim().length
      ?? requestedJunctions.find((junction) => typeof junction.rightOverhang === 'string')?.rightOverhang?.trim().length
      ?? 4;
    const competitors = uniqueOverhangs(requestedJunctions, length);
    const scores = requestedJunctions.map((junction, index) => heuristicJunctionScore(index, junction, competitors, length));
    const assembly = buildAssemblySummary(scores, requestedMethod);
    return {
      status: scores.length > 0 && assembly.unknownJunctions === 0 ? 'heuristic' : 'unknown',
      method: requestedMethod,
      datasetId: null,
      condition: copyCondition(input?.condition),
      provenance: null,
      junctions: scores,
      assembly,
      warnings: [
        'Hamming distance is an explicitly heuristic fallback and must not be read as empirical ligation fidelity.',
        ...(assembly.unknownJunctions > 0 ? ['Some junctions could not be evaluated by the heuristic.'] : []),
      ],
    };
  }

  const candidateDataset = findGoldenGateFidelityDataset(input?.condition);
  const requestedEnzyme = typeof input?.enzyme === 'string' ? normalizeText(input.enzyme) : null;
  const dataset = candidateDataset
    && (!requestedEnzyme || normalizeText(candidateDataset.condition.enzyme) === requestedEnzyme)
    ? candidateDataset
    : null;
  const length = dataset?.overhangLength ?? 4;
  const competitors = uniqueOverhangs(requestedJunctions, length);
  if (!dataset) {
    const conditionWasSupplied = input?.condition !== undefined && input?.condition !== null;
    const reason = candidateDataset && requestedEnzyme
      && normalizeText(candidateDataset.condition.enzyme) !== requestedEnzyme
      ? `The selected empirical matrix is for ${candidateDataset.condition.enzyme}, not the requested ${input.enzyme}; no cross-enzyme score is borrowed.`
      : conditionWasSupplied
        ? 'No published empirical matrix matches the complete enzyme, ligase, buffer, concentration, and cycling condition.'
      : 'An exact ligation condition is required before an empirical fidelity matrix can be selected.';
    const scores = requestedJunctions.map((junction, index) => unknownJunction(index, junction, reason));
    return {
      status: conditionWasSupplied ? 'unsupported' : 'unknown',
      method: 'empirical',
      datasetId: null,
      condition: copyCondition(input?.condition),
      provenance: null,
      junctions: scores,
      assembly: buildAssemblySummary(scores, 'empirical'),
      warnings: [reason],
    };
  }

  const scores = requestedJunctions.map((junction, index) => empiricalJunctionScore(index, junction, dataset, competitors));
  const assembly = buildAssemblySummary(scores, 'empirical');
  const status = scores.length === 0
    ? 'unknown'
    : assembly.knownJunctions === scores.length
      ? 'supported'
      : assembly.knownJunctions === 0 ? 'unknown' : 'partial';
  return {
    status,
    method: 'empirical',
    datasetId: dataset.id,
    condition: copyCondition(dataset.condition),
    provenance: { ...dataset.provenance },
    junctions: scores,
    assembly,
    warnings: [
      'Empirical matrix estimates are qualitative comparisons for the published assay condition; yield and fidelity can change with reaction conditions, DNA purity, and stoichiometry.',
      ...(assembly.unknownJunctions > 0 ? ['Some junctions lack an observed empirical estimate in this assembly context.'] : []),
    ],
  };
}

/** Short alias for callers that use “score” rather than “assess”. */
export const scoreGoldenGateAssembly = assessGoldenGateAssemblyFidelity;

function candidateJunctions(candidate: GoldenGateOverhangSetCandidate): GoldenGateFidelityJunction[] {
  if (Array.isArray(candidate.junctions)) return candidate.junctions.map((junction) => ({ ...junction }));
  return (candidate.overhangs ?? []).map((overhang) => ({
    leftOverhang: overhang,
    rightOverhang: typeof overhang === 'string' ? reverseComplement(overhang).toUpperCase() : null,
  }));
}

function rankingScore(entry: GoldenGateFidelityRankingEntry): [number, number, number] {
  const assembly = entry.assessment.assembly;
  if (assembly.estimatedFidelity !== null) return [2, assembly.estimatedFidelity, assembly.coverage];
  if (assembly.heuristicScore !== null) return [1, assembly.heuristicScore, assembly.coverage];
  return [0, assembly.coverage, 0];
}

/** Rank complete overhang sets by whole-assembly score, not isolated warnings. */
export function rankGoldenGateOverhangSets(input: {
  candidates: readonly GoldenGateOverhangSetCandidate[];
  condition?: GoldenGateFidelityCondition | null;
  method?: 'empirical' | 'hamming';
  fallback?: 'none' | 'hamming';
}): GoldenGateFidelityRankingEntry[] {
  const initial = (Array.isArray(input?.candidates) ? input.candidates : []).map((candidate, candidateIndex) => ({
    rank: 0,
    candidateIndex,
    candidateId: candidate.id ?? `candidate-${candidateIndex + 1}`,
    assessment: assessGoldenGateAssemblyFidelity({
      junctions: candidateJunctions(candidate),
      condition: input?.condition,
      method: input?.method,
      fallback: input?.fallback,
    }),
  }));
  initial.sort((left, right) => {
    const a = rankingScore(left);
    const b = rankingScore(right);
    return b[0] - a[0] || b[1] - a[1] || b[2] - a[2] || left.candidateIndex - right.candidateIndex;
  });
  return initial.map((entry, index) => ({ ...entry, rank: index + 1 }));
}
