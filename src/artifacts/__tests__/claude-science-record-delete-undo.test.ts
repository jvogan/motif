import { describe, expect, it } from 'vitest';
import { normalizeArtifactDurableState } from '../claude-science-session';
import { planRecordDeleteUndo, reinsertRemovedById } from '../claude-science-record-delete-undo';

const rec = (id: string) => ({ id, name: id });

function workspace(recordIds: string[], extra: Partial<Record<'alignments' | 'notes' | 'workflowResults' | 'analysisResults' | 'analysisAssets', { id: string }[]>> = {}) {
  return {
    records: recordIds.map(rec),
    selectedRecordId: recordIds[0] ?? 'record-1',
    alignments: extra.alignments ?? [],
    notes: extra.notes ?? [],
    workflowResults: extra.workflowResults ?? [],
    analysisResults: extra.analysisResults ?? [],
    analysisAssets: extra.analysisAssets ?? [],
  };
}

describe('undoing a record delete', () => {
  it('puts the record back at its old index', () => {
    const before = [rec('a'), rec('b'), rec('c')];
    const after = [rec('a'), rec('c')];
    expect(reinsertRemovedById(before, after, after).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps a record added after the delete and does not duplicate one that is back', () => {
    const before = [rec('a'), rec('b'), rec('c')];
    const after = [rec('a'), rec('c')];
    expect(reinsertRemovedById(before, after, [...after, rec('d')]).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(reinsertRemovedById(before, after, [rec('b'), ...after]).map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('restores the linked notes, alignments, results and per-record view state, and selects the record', () => {
    const before = workspace(['a', 'b', 'c'], {
      notes: [{ id: 'n-a' }, { id: 'n-b' }],
      alignments: [{ id: 'aln-b' }],
      workflowResults: [{ id: 'wf-b' }],
      analysisResults: [{ id: 'res-b' }],
      analysisAssets: [{ id: 'asset-b' }],
    });
    const after = { ...workspace(['a', 'c'], { notes: [{ id: 'n-a' }] }), selectedRecordId: 'c' };
    const current = { ...after, notes: [{ id: 'n-a' }, { id: 'n-new' }] };
    const lengths = new Map([['a', 10], ['b', 20], ['c', 30]]);
    const beforeState = normalizeArtifactDurableState({ restrictionLabelsByRecord: { b: true }, hiddenEnzymesByRecord: { b: ['EcoRI'] } }, lengths);
    const currentState = normalizeArtifactDurableState({ restrictionLabelsByRecord: { c: true } }, lengths);
    const plan = planRecordDeleteUndo({ before, after, current, beforeState, currentState, deletedRecordIds: ['b'] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.payload.records.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(plan.payload.selectedRecordId).toBe('b');
    expect(plan.payload.notes.map((n) => n.id)).toEqual(['n-a', 'n-b', 'n-new']);
    expect(plan.payload.alignments.map((n) => n.id)).toEqual(['aln-b']);
    expect(plan.payload.workflowResults.map((n) => n.id)).toEqual(['wf-b']);
    expect(plan.payload.analysisResults.map((n) => n.id)).toEqual(['res-b']);
    expect(plan.payload.analysisAssets.map((n) => n.id)).toEqual(['asset-b']);
    expect(plan.artifactState.restrictionLabelsByRecord).toEqual({ b: true, c: true });
    expect(plan.artifactState.hiddenEnzymesByRecord).toEqual({ b: ['EcoRI'] });
  });

  it('refuses when a record with the deleted id is back, instead of making two', () => {
    const before = workspace(['a', 'b']);
    const after = workspace(['a']);
    const current = workspace(['a', 'b']);
    const state = normalizeArtifactDurableState(undefined, new Map());
    const plan = planRecordDeleteUndo({ before, after, current, beforeState: state, currentState: state, deletedRecordIds: ['b'] });
    expect(plan.ok).toBe(false);
  });
});
