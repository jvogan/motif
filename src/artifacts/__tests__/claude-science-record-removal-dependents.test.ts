import { describe, expect, it } from 'vitest';
import { planRecordRemoval, recordRemovalDependents } from '../motif-artifact';

type Workspace = Parameters<typeof recordRemovalDependents>[0];

// Only ids, kinds, record links and counts matter to these two functions.
function workspace(parts: {
  records?: string[];
  results?: Array<[id: string, kind: string]>;
  workflows?: Array<[input: string, output?: string]>;
  alignments?: string[];
  notes?: string[];
}): Workspace {
  return {
    records: (parts.records ?? []).map((id) => ({ id })),
    analysisResults: (parts.results ?? []).map(([id, kind]) => ({ id, kind })),
    analysisAssets: [],
    workflowResults: (parts.workflows ?? []).map(([input, output]) => ({ inputRecordIds: [input], outputRecordIds: output ? [output] : [] })),
    alignments: (parts.alignments ?? []).map((recordId) => ({ rows: [{ sourceRecordId: recordId }] })),
    notes: (parts.notes ?? []).map((recordId) => ({ recordId })),
  } as unknown as Workspace;
}

describe('what a record delete takes with it', () => {
  it('names saved verification results apart from the other results', () => {
    const before = workspace({
      results: [['v1', 'construct_verification'], ['v2', 'construct_verification'], ['p1', 'primer_design'], ['kept', 'pcr']],
      workflows: [['read'], ['other']],
    });
    const after = workspace({ results: [['kept', 'pcr']], workflows: [['other']] });
    expect(recordRemovalDependents(before, after)).toBe('2 saved verification results and 2 other saved results');
  });

  it('counts one of each in the singular and lists three or more with commas', () => {
    const before = workspace({ results: [['v1', 'construct_verification']], alignments: ['read'], notes: ['read', 'read'] });
    expect(recordRemovalDependents(before, workspace({}))).toBe('1 saved verification result, 1 alignment, and 2 notes');
    expect(recordRemovalDependents(workspace({ workflows: [['read']] }), workspace({}))).toBe('1 saved result');
  });

  it('says nothing when the record goes alone', () => {
    expect(recordRemovalDependents(workspace({ notes: ['kept'] }), workspace({ notes: ['kept'] }))).toBeNull();
  });

  it('plans the same dependents the delete removes', () => {
    const before = workspace({
      records: ['read', 'reference'],
      workflows: [['read'], ['reference', 'read'], ['reference']],
      alignments: ['read', 'reference'],
      notes: ['read', 'reference'],
    });
    const after = planRecordRemoval(before, ['read']);
    expect(after.records.map((record) => record.id)).toEqual(['reference']);
    expect(after.workflowResults).toHaveLength(1);
    expect(after.alignments).toHaveLength(1);
    expect(after.notes).toHaveLength(1);
    expect(recordRemovalDependents(before, after)).toBe('2 saved results, 1 alignment, and 1 note');
  });
});
