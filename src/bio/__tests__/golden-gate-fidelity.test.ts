import { describe, expect, it } from 'vitest';
import {
  assessGoldenGateAssemblyFidelity,
  GOLDEN_GATE_FIDELITY_CONDITIONS,
  GOLDEN_GATE_FIDELITY_DATASETS,
  findGoldenGateFidelityDataset,
  rankGoldenGateOverhangSets,
} from '../golden-gate-fidelity';

const BSAI = GOLDEN_GATE_FIDELITY_CONDITIONS['pryor-2020-bsai-hfv2'];
const SAPI = GOLDEN_GATE_FIDELITY_CONDITIONS['pryor-2020-sapi'];

describe('empirical Golden Gate fidelity', () => {
  it('loads all five primary-source matrices with independent source hashes', () => {
    expect(GOLDEN_GATE_FIDELITY_DATASETS.map((dataset) => dataset.overhangLength)).toEqual([4, 4, 4, 4, 3]);
    expect(GOLDEN_GATE_FIDELITY_DATASETS.map((dataset) => dataset.provenance.sourceSha256)).toEqual([
      '320dd058f3ca6372768c7ddfe9cda2a2ea2a076c4f86dd08587d8f295aae1d15',
      '7c444e99e5e4d245461a892e8543a35c84987f93abcee7098de9d9d817237e94',
      '1557e62cfa4f89cd021420b75e145dae2f453ecf26dcca340a8c29008736ea66',
      '56143bb445e6d84bba646429402e0948793395269cc5d8ba0e80962c0cac6492',
      'dfa2df906bd306e3971652c4b95d004818fdb8dd9e49f4522691959d28f537cb',
    ]);
    expect(findGoldenGateFidelityDataset(BSAI)?.provenance.table).toBe('S1 Table');
  });

  it('retains every empirical source cell as a bounded integer observation', () => {
    let cellCount = 0;
    let nonZeroCellCount = 0;
    for (const dataset of GOLDEN_GATE_FIDELITY_DATASETS) {
      for (const leftOverhang of dataset.overhangs) {
        for (const rightOverhang of dataset.overhangs) {
          const count = dataset.count(leftOverhang, rightOverhang);
          expect(Number.isSafeInteger(count)).toBe(true);
          expect(count).toBeGreaterThanOrEqual(0);
          cellCount += 1;
          if (count > 0) nonZeroCellCount += 1;
        }
      }
    }
    expect(cellCount).toBe(4 * (4 ** 4) ** 2 + (4 ** 3) ** 2);
    expect(nonZeroCellCount).toBeGreaterThan(0);
  }, 30_000);

  it('uses the published BsaI-HFv2 count and preserves ligation-pair orientation symmetry', () => {
    const dataset = findGoldenGateFidelityDataset(BSAI);
    expect(dataset).not.toBeNull();
    expect(dataset?.count('AAAA', 'TTTT')).toBe(635);
    expect(dataset?.count('TTTT', 'AAAA')).toBe(635);
    expect(dataset?.count('AAAA', 'AAAA')).toBe(0);

    const assessment = assessGoldenGateAssemblyFidelity({
      condition: BSAI,
      junctions: [
        { leftOverhang: 'AAAA', rightOverhang: 'TTTT', label: 'promoter → CDS' },
        { leftOverhang: 'AAAC', rightOverhang: 'GTTT', label: 'CDS → terminator' },
      ],
    });
    expect(assessment).toMatchObject({ status: 'supported', method: 'empirical', datasetId: 'pryor-2020-bsai-hfv2' });
    expect(assessment.junctions[0]).toMatchObject({
      status: 'supported',
      correctCount: 1270,
      counts: expect.objectContaining({ correct: 1270 }),
    });
    expect(assessment.assembly).toMatchObject({ junctionCount: 2, knownJunctions: 2, coverage: 1 });
    expect(assessment.assembly.estimatedFidelity).toBeGreaterThan(0);
    expect(assessment.assembly.assumptions[0]).toMatch(/independence assumption/i);
  });

  it('returns unsupported rather than borrowing a score for an unmatched condition', () => {
    const assessment = assessGoldenGateAssemblyFidelity({
      condition: { ...BSAI, buffer: '1× unknown buffer' },
      junctions: [{ leftOverhang: 'AAAA', rightOverhang: 'TTTT' }],
    });
    expect(assessment.status).toBe('unsupported');
    expect(assessment.datasetId).toBeNull();
    expect(assessment.junctions[0]).toMatchObject({ status: 'unknown', estimatedFidelity: null });
    expect(assessment.warnings[0]).toMatch(/no published empirical matrix/i);
  });

  it('rejects a requested cross-enzyme condition and malformed condition without throwing', () => {
    const crossEnzyme = assessGoldenGateAssemblyFidelity({
      enzyme: 'BbsI',
      condition: BSAI,
      junctions: [{ leftOverhang: 'AAAA', rightOverhang: 'TTTT' }],
    });
    expect(crossEnzyme).toMatchObject({ status: 'unsupported', datasetId: null });
    expect(crossEnzyme.warnings[0]).toMatch(/not the requested BbsI/i);

    const malformed = assessGoldenGateAssemblyFidelity({
      condition: { ...BSAI, cycleSteps: undefined as never },
      junctions: [{ leftOverhang: 'AAAA', rightOverhang: 'TTTT' }],
    });
    expect(malformed).toMatchObject({ status: 'unsupported', datasetId: null, condition: null });
  });

  it('ranks complete overhang sets by whole-assembly empirical fidelity', () => {
    const ranking = rankGoldenGateOverhangSets({
      condition: SAPI,
      candidates: [
        { id: 'single', overhangs: ['AAT'] },
        { id: 'expanded', overhangs: ['AAT', 'TTA'] },
      ],
    });
    expect(ranking.map((entry) => entry.candidateId)).toEqual(['single', 'expanded']);
    expect(ranking[0]?.assessment.assembly.estimatedFidelity).toBeGreaterThan(0);
    expect(ranking[1]?.assessment.assembly.estimatedFidelity).toBeLessThan(1);
  });

  it('labels Hamming fallback as heuristic and never exposes it as empirical fidelity', () => {
    const assessment = assessGoldenGateAssemblyFidelity({
      condition: { ...BSAI, enzyme: 'BsaI' },
      fallback: 'hamming',
      junctions: [{ leftOverhang: 'AAAA', rightOverhang: 'TTTT' }, { leftOverhang: 'AAAT', rightOverhang: 'ATTT' }],
    });
    expect(assessment).toMatchObject({ status: 'heuristic', method: 'hamming-heuristic', datasetId: null });
    expect(assessment.assembly.estimatedFidelity).toBeNull();
    expect(assessment.assembly.heuristicScore).not.toBeNull();
    expect(assessment.warnings.join(' ')).toMatch(/explicitly heuristic/i);
  });
});
