import { describe, expect, it } from 'vitest';
import { normalizeArtifactDurableState } from '../claude-science-session';
import { planRecordDeleteUndo } from '../claude-science-record-delete-undo';

function workspace(recordIds: string[]) {
  return {
    records: recordIds.map((id) => ({ id, name: id })),
    selectedRecordId: recordIds[0] ?? 'record-1',
    alignments: [],
    notes: [],
    workflowResults: [],
    analysisResults: [],
    analysisAssets: [],
  };
}

describe('undoing a record delete with a __proto__ record id', () => {
  it('restores the per-record view state as an ordinary data key', () => {
    const lengths = new Map([['a', 10], ['__proto__', 20]]);
    const beforeState = normalizeArtifactDurableState(
      JSON.parse('{"restrictionLabelsByRecord":{"__proto__":true},"motifsByRecord":{"__proto__":"GAATTC"}}'),
      lengths,
    );
    expect(Object.hasOwn(beforeState.restrictionLabelsByRecord, '__proto__')).toBe(true);
    const currentState = normalizeArtifactDurableState(undefined, lengths);
    const plan = planRecordDeleteUndo({
      before: workspace(['a', '__proto__']),
      after: workspace(['a']),
      current: workspace(['a']),
      beforeState,
      currentState,
      deletedRecordIds: ['__proto__'],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.payload.records.map((record) => record.id)).toEqual(['a', '__proto__']);
    expect(Object.hasOwn(plan.artifactState.restrictionLabelsByRecord, '__proto__')).toBe(true);
    expect(plan.artifactState.restrictionLabelsByRecord.__proto__).toBe(true);
    expect(Object.hasOwn(plan.artifactState.motifsByRecord, '__proto__')).toBe(true);
    expect(plan.artifactState.motifsByRecord.__proto__).toBe('GAATTC');
  });
});
