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
});
