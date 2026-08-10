import { describe, expect, it } from 'vitest';
import { validatePayload as validatePackagedPayload } from '../../src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/create-artifact.mjs';
import { validateMotifPayload } from '../../mcp/motif/payload.ts';
import { validateRuntimeRecordInputs } from '../../src/artifacts/motif-artifact.tsx';

const baseRecord = { id: 'r1', name: 'r1', type: 'dna', sequence: 'GAATTC' };

function accepts(validate) {
  try {
    validate();
    return true;
  } catch {
    return false;
  }
}

function validatorOutcomes(payload) {
  const records = payload.records;
  return [
    accepts(() => validatePackagedPayload(payload)),
    accepts(() => validateMotifPayload(payload)),
    accepts(() => validateRuntimeRecordInputs(records, 'motifAddRecords')),
  ];
}

function workspaceValidatorOutcomes(payload) {
  return [
    accepts(() => validatePackagedPayload(payload)),
    accepts(() => validateMotifPayload(payload)),
  ];
}

describe('public payload validator parity', () => {
  it.each([
    ['valid record', { records: [baseRecord] }, [true, true, true]],
    ['sparse records array', { records: new Array(1) }, [false, false, false]],
    ['sparse feature array', {
      records: [{ ...baseRecord, features: new Array(1) }],
    }, [false, false, false]],
    ['sparse site array', {
      records: [{ ...baseRecord, sites: new Array(1) }],
    }, [false, false, false]],
    ['sparse site-hit array', {
      records: [{ ...baseRecord, sites: [{ hits: new Array(1) }] }],
    }, [false, false, false]],
    ['sparse feature-subrange array', {
      records: [{ ...baseRecord, features: [{ start: 0, end: 2, subRanges: new Array(1) }] }],
    }, [false, false, false]],
  ])('%s has matching acceptance across all validator boundaries', (_name, payload, expected) => {
    expect(validatorOutcomes(payload)).toEqual(expected);
  });

  it('keeps custom enzyme physical and methylation metadata in parity', () => {
    const valid = {
      records: [baseRecord],
      artifactState: {
        customEnzymes: [{
          name: 'CustomI',
          recognitionSequence: 'GAATTC',
          cutOffset: 1,
          complementCutOffset: 5,
          overhang: '5prime',
          cleavageMode: 'double-strand',
          methylationRequirement: {
            target: 'dam',
            state: 'unmethylated',
            evidence: {
              source: 'https://example.test/dam',
              sourceLabel: 'Assay record',
              conditions: 'Unmethylated substrate',
            },
          },
          methylationBehavior: 'context_dependent',
          methylationEvidence: {
            source: 'https://example.test/context',
            sourceLabel: 'Context record',
            conditions: 'Context-dependent substrate',
          },
        }],
      },
    };
    expect(workspaceValidatorOutcomes(valid)).toEqual([true, true]);

    const duplicate = {
      ...valid,
      artifactState: {
        customEnzymes: [
          valid.artifactState.customEnzymes[0],
          { ...valid.artifactState.customEnzymes[0], name: 'customi' },
        ],
      },
    };
    expect(workspaceValidatorOutcomes(duplicate)).toEqual([false, false]);
    expect(() => validatePackagedPayload(duplicate)).toThrow(/customEnzymes\[1\].*customEnzymes\[0\]/i);
    expect(() => validateMotifPayload(duplicate)).toThrow(/customEnzymes\[1\].*customEnzymes\[0\]/i);
  });
});
