import { describe, expect, it } from 'vitest';
import {
  addArtifactNote,
  appendArtifactWorkflowResult,
  createArtifactNote,
  getArtifactNotesSnapshot,
  getArtifactWorkflowResultsSnapshot,
  getArtifactWorkspaceCollectionsSnapshot,
  MAX_ARTIFACT_NOTE_BODY_LENGTH,
  MAX_ARTIFACT_NOTES,
  MAX_ARTIFACT_STRUCTURED_DEPTH,
  MAX_ARTIFACT_WORKFLOW_RECORD_IDS,
  MAX_ARTIFACT_WORKFLOW_RESULTS,
  normalizeArtifactNotes,
  normalizeArtifactWorkflowResults,
  normalizeArtifactWorkspaceCollections,
  removeArtifactNote,
  removeArtifactWorkflowResult,
  serializeArtifactWorkspaceCollections,
  stringifyArtifactWorkspaceCollections,
  updateArtifactNote,
} from '../claude-science-workspace-collections';

const CREATED_AT = '2026-07-12T16:30:00.000Z';
const UPDATED_AT = '2026-07-12T17:45:00.000Z';

function workflow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'workflow-1',
    kind: 'digest',
    name: 'EcoRI diagnostic digest',
    inputRecordIds: ['pUC19'],
    parameters: { enzymes: ['EcoRI'], topology: 'circular' },
    outputRecordIds: ['pUC19-fragment-1'],
    createdAt: CREATED_AT,
    provenance: {
      source: 'user',
      operation: 'restriction-digest',
      engine: 'motif',
      engineVersion: '2.4.0',
    },
    ...overrides,
  };
}

describe('Claude Science portable workspace collections', () => {
  it('keeps v1 payloads compatible by normalizing absent fields and omitting empty serialized fields', () => {
    expect(normalizeArtifactWorkspaceCollections(undefined)).toEqual({ notes: [], workflowResults: [] });
    expect(normalizeArtifactWorkspaceCollections({ records: [] })).toEqual({ notes: [], workflowResults: [] });
    expect(serializeArtifactWorkspaceCollections({ notes: [], workflowResults: [] })).toEqual({});
    expect(stringifyArtifactWorkspaceCollections({})).toBe('{}');
  });

  it('normalizes workspace, record, and range notes against a record index', () => {
    const notes = normalizeArtifactNotes([
      {
        id: 'workspace-note',
        body: 'Shared lab context',
        scope: 'workspace',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
      {
        id: 'record-note',
        title: '  QC note  ',
        body: 'Review insert orientation.',
        format: 'markdown',
        scope: 'record',
        recordId: 'pUC19',
        tags: ['QC', 'QC', ' review '],
        createdAt: '2026-07-12T09:30:00-07:00',
        updatedAt: UPDATED_AT,
      },
      {
        id: 'range-note',
        body: 'Promoter window',
        scope: 'range',
        recordId: 'pUC19',
        range: { start: 10, end: 60 },
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ], { recordLengths: new Map([['pUC19', 2_578]]) });

    expect(notes).toEqual([
      {
        id: 'workspace-note',
        body: 'Shared lab context',
        format: 'plain',
        scope: 'workspace',
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
      {
        id: 'record-note',
        title: 'QC note',
        body: 'Review insert orientation.',
        format: 'markdown',
        scope: 'record',
        recordId: 'pUC19',
        tags: ['QC', 'review'],
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
      },
      {
        id: 'range-note',
        body: 'Promoter window',
        format: 'plain',
        scope: 'range',
        recordId: 'pUC19',
        range: { start: 10, end: 60 },
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ]);
  });

  it('rejects incoherent note scopes, dangling references, invalid ranges, and reversed timestamps', () => {
    const base = {
      id: 'note-1',
      body: 'Body',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    };
    expect(() => normalizeArtifactNotes([{ ...base, scope: 'workspace', recordId: 'pUC19' }]))
      .toThrow(/workspace notes cannot carry/i);
    expect(() => normalizeArtifactNotes([{ ...base, scope: 'record' }]))
      .toThrow(/record notes require recordId/i);
    expect(() => normalizeArtifactNotes([{ ...base, scope: 'range', recordId: 'pUC19' }]))
      .toThrow(/range notes require both/i);
    expect(() => normalizeArtifactNotes([
      { ...base, scope: 'range', recordId: 'pUC19', range: { start: 10, end: 101 } },
    ], { recordLengths: new Map([['pUC19', 100]]) })).toThrow(/fit within/i);
    expect(() => normalizeArtifactNotes([
      { ...base, scope: 'record', recordId: 'missing' },
    ], { recordLengths: new Map([['pUC19', 100]]) })).toThrow(/does not match/i);
    expect(() => normalizeArtifactNotes([{
      ...base,
      scope: 'workspace',
      createdAt: UPDATED_AT,
      updatedAt: CREATED_AT,
    }])).toThrow(/cannot be earlier/i);
  });

  it('preserves HTML-looking note and metadata strings as inert JSON data', () => {
    const hostile = '<img src=x onerror="globalThis.pwned=true"><script>alert(1)</script>';
    const normalized = normalizeArtifactNotes([{
      id: 'inert-note',
      title: '<b>not markup</b>',
      body: hostile,
      format: 'markdown',
      scope: 'workspace',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      provenance: { source: 'import', metadata: { label: hostile } },
    }]);
    const json = JSON.parse(stringifyArtifactWorkspaceCollections({ notes: normalized })) as {
      notes: Array<{ body: string; provenance: { metadata: { label: string } } }>;
    };

    expect(json.notes[0].body).toBe(hostile);
    expect(json.notes[0].provenance.metadata.label).toBe(hostile);
    expect(typeof json.notes[0].body).toBe('string');
  });

  it('enforces note count, body-size, and duplicate-id limits without partial batches', () => {
    const note = (id: string, body = 'Body') => ({
      id,
      body,
      scope: 'workspace',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    expect(normalizeArtifactNotes(
      Array.from({ length: MAX_ARTIFACT_NOTES }, (_, index) => note(`note-${index}`)),
    )).toHaveLength(MAX_ARTIFACT_NOTES);
    expect(() => normalizeArtifactNotes(
      Array.from({ length: MAX_ARTIFACT_NOTES + 1 }, (_, index) => note(`note-${index}`)),
    )).toThrow(new RegExp(`more than ${MAX_ARTIFACT_NOTES.toLocaleString()} entries`, 'i'));
    expect(() => normalizeArtifactNotes([note('large', 'A'.repeat(MAX_ARTIFACT_NOTE_BODY_LENGTH + 1))]))
      .toThrow(new RegExp(`cannot exceed ${MAX_ARTIFACT_NOTE_BODY_LENGTH.toLocaleString()} characters`, 'i'));
    expect(() => normalizeArtifactNotes([note('duplicate'), note('duplicate')])).toThrow(/duplicate id/i);
  });

  it('normalizes every supported workflow kind and preserves ordered duplicate inputs', () => {
    const kinds = ['digest', 'gel', 'golden_gate', 'ligation'] as const;
    const results = normalizeArtifactWorkflowResults(kinds.map((kind, index) => workflow({
      id: `workflow-${index}`,
      kind,
      inputRecordIds: kind === 'golden_gate' ? ['part-a', 'part-b', 'part-a'] : ['pUC19'],
      outputRecordIds: kind === 'gel' ? [] : [`output-${index}`],
      result: { status: 'complete', fragmentSizes: [1_200, 1_378] },
    })));

    expect(results.map((result) => result.kind)).toEqual(kinds);
    expect(results[2].inputRecordIds).toEqual(['part-a', 'part-b', 'part-a']);
    expect(results[1].outputRecordIds).toEqual([]);
  });

  it('validates aligned input hashes, required provenance, record-id caps, and workflow batch ids', () => {
    const sha256 = 'a'.repeat(64);
    expect(normalizeArtifactWorkflowResults([workflow({ inputSha256s: [sha256.toUpperCase()] })])[0].inputSha256s)
      .toEqual([sha256]);
    expect(() => normalizeArtifactWorkflowResults([workflow({ inputSha256s: [] })]))
      .toThrow(/align one-to-one/i);
    expect(() => normalizeArtifactWorkflowResults([workflow({ inputSha256s: ['not-a-sha'] })]))
      .toThrow(/SHA-256/i);
    expect(() => normalizeArtifactWorkflowResults([workflow({ provenance: undefined })]))
      .toThrow(/provenance is required/i);
    expect(() => normalizeArtifactWorkflowResults([workflow({
      inputRecordIds: Array.from({ length: MAX_ARTIFACT_WORKFLOW_RECORD_IDS + 1 }, (_, index) => `record-${index}`),
    })])).toThrow(new RegExp(`more than ${MAX_ARTIFACT_WORKFLOW_RECORD_IDS.toLocaleString()} entries`, 'i'));
    expect(() => normalizeArtifactWorkflowResults([workflow(), workflow()])).toThrow(/duplicate id/i);
  });

  it('optionally validates workflow input and output record references', () => {
    const recordLengths = new Map([
      ['pUC19', 2_578],
      ['pUC19-fragment-1', 2_578],
    ]);
    expect(normalizeArtifactWorkflowResults([workflow()], { recordLengths })).toHaveLength(1);
    expect(() => normalizeArtifactWorkflowResults([
      workflow({ inputRecordIds: ['missing-input'] }),
    ], { recordLengths })).toThrow(/inputRecordIds\[0\].*does not match/i);
    expect(() => normalizeArtifactWorkflowResults([
      workflow({ outputRecordIds: ['deleted-output'] }),
    ], { recordLengths })).toThrow(/outputRecordIds\[0\].*does not match/i);
    expect(normalizeArtifactWorkflowResults([
      workflow({ outputRecordIds: ['deleted-output'] }),
    ], { recordLengths, allowMissingWorkflowOutputRecords: true })[0].outputRecordIds)
      .toEqual(['deleted-output']);
  });

  it('enforces workflow batch limits before normalizing entries', () => {
    const overLimit = Array.from({ length: MAX_ARTIFACT_WORKFLOW_RESULTS + 1 }, () => null);
    expect(() => normalizeArtifactWorkflowResults(overLimit))
      .toThrow(new RegExp(`more than ${MAX_ARTIFACT_WORKFLOW_RESULTS.toLocaleString()} entries`, 'i'));
  });

  it('rejects non-JSON, circular, unsafe-key, non-finite, and over-deep structured data', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const unsafe = JSON.parse('{"__proto__":{"polluted":true}}') as unknown;
    let deep: Record<string, unknown> = {};
    const deepRoot = deep;
    for (let index = 0; index <= MAX_ARTIFACT_STRUCTURED_DEPTH; index += 1) {
      const child: Record<string, unknown> = {};
      deep.next = child;
      deep = child;
    }

    expect(() => normalizeArtifactWorkflowResults([workflow({ parameters: { date: new Date() } })]))
      .toThrow(/plain JSON objects/i);
    expect(() => normalizeArtifactWorkflowResults([workflow({ parameters: circular })]))
      .toThrow(/circular references/i);
    expect(() => normalizeArtifactWorkflowResults([workflow({ parameters: unsafe })]))
      .toThrow(/not an allowed object key/i);
    expect(() => normalizeArtifactWorkflowResults([workflow({ parameters: { score: Number.NaN } })]))
      .toThrow(/NaN or Infinity/i);
    expect(() => normalizeArtifactWorkflowResults([workflow({ parameters: deepRoot })]))
      .toThrow(/maximum structured-data depth/i);
  });

  it('round-trips a defensive JSON-safe copy without retaining caller references', () => {
    const source = {
      notes: [{
        id: 'note-1',
        body: 'Original body',
        scope: 'workspace',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        provenance: { source: 'user', metadata: { nested: { stable: true } } },
      }],
      workflowResults: [workflow()],
    };
    const serialized = serializeArtifactWorkspaceCollections(source);
    (source.notes[0] as { body: string }).body = 'Caller mutation';
    ((source.workflowResults[0].parameters as { enzymes: string[] }).enzymes)[0] = 'BamHI';

    expect(serialized.notes?.[0].body).toBe('Original body');
    expect(serialized.workflowResults?.[0].parameters).toEqual({ enzymes: ['EcoRI'], topology: 'circular' });
    expect(normalizeArtifactWorkspaceCollections(JSON.parse(JSON.stringify(serialized)))).toEqual({
      notes: serialized.notes,
      workflowResults: serialized.workflowResults,
    });
  });


  it('creates and atomically adds caller-identified notes without mutating source arrays', () => {
    const created = createArtifactNote({
      id: 'note-created-by-caller',
      body: 'Caller supplied identity and time',
      scope: 'workspace',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    const source = [created];
    const added = addArtifactNote(source, {
      id: 'note-2',
      body: 'Second note',
      scope: 'workspace',
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
    });

    expect(created.id).toBe('note-created-by-caller');
    expect(created.createdAt).toBe(CREATED_AT);
    expect(source).toHaveLength(1);
    expect(added.map((note) => note.id)).toEqual(['note-created-by-caller', 'note-2']);
    added[0].body = 'Returned snapshot mutation';
    expect(source[0].body).toBe('Caller supplied identity and time');
  });

  it('updates and removes notes atomically while preserving immutable identity and creation time', () => {
    const source = normalizeArtifactNotes([{
      id: 'note-1',
      body: 'Before',
      scope: 'record',
      recordId: 'pUC19',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }]);
    const updated = updateArtifactNote(source, 'note-1', {
      body: 'After',
      format: 'markdown',
      updatedAt: UPDATED_AT,
    });
    const removed = removeArtifactNote(updated, 'note-1');

    expect(source[0]).toMatchObject({ body: 'Before', updatedAt: CREATED_AT });
    expect(updated[0]).toMatchObject({
      id: 'note-1',
      body: 'After',
      format: 'markdown',
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    });
    expect(removed).toEqual([]);
  });

  it('rejects invalid note mutations without changing the original collection', () => {
    const source = normalizeArtifactNotes([{
      id: 'note-1',
      body: 'Stable body',
      scope: 'workspace',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    }]);
    const before = JSON.stringify(source);

    expect(() => addArtifactNote(source, {
      id: 'note-1',
      body: 'Duplicate',
      scope: 'workspace',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    })).toThrow(/duplicate id/i);
    expect(() => updateArtifactNote(source, 'note-1', { body: 'No timestamp' }))
      .toThrow(/updatedAt is required/i);
    expect(() => updateArtifactNote(source, 'note-1', {
      id: 'replacement-id',
      body: 'Illegal identity change',
      updatedAt: UPDATED_AT,
    })).toThrow(/immutable field "id"/i);
    expect(() => updateArtifactNote(source, 'missing', { body: 'No target', updatedAt: UPDATED_AT }))
      .toThrow(/does not exist/i);
    expect(() => removeArtifactNote(source, 'missing')).toThrow(/does not exist/i);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('appends and removes workflow results atomically with reference validation', () => {
    const recordLengths = new Map([
      ['pUC19', 2_578],
      ['pUC19-fragment-1', 2_578],
    ]);
    const source: unknown[] = [];
    const added = appendArtifactWorkflowResult(source, workflow(), { recordLengths });
    const removed = removeArtifactWorkflowResult(added, 'workflow-1', { recordLengths });

    expect(source).toEqual([]);
    expect(added).toHaveLength(1);
    expect(removed).toEqual([]);
    const before = JSON.stringify(added);
    expect(() => appendArtifactWorkflowResult(added, workflow(), { recordLengths })).toThrow(/duplicate id/i);
    expect(() => removeArtifactWorkflowResult(added, 'missing', { recordLengths })).toThrow(/does not exist/i);
    expect(JSON.stringify(added)).toBe(before);
  });

  it('returns defensive note and complete collection snapshots', () => {
    const source = {
      notes: [{
        id: 'note-1',
        body: 'Original',
        scope: 'workspace',
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        provenance: { source: 'user', metadata: { nested: { value: 1 } } },
      }],
      workflowResults: [workflow()],
    };
    const noteSnapshot = getArtifactNotesSnapshot(source.notes);
    const workflowSnapshot = getArtifactWorkflowResultsSnapshot(source.workflowResults);
    const workspaceSnapshot = getArtifactWorkspaceCollectionsSnapshot(source);
    noteSnapshot[0].body = 'Changed snapshot';
    workflowSnapshot[0].parameters.topology = 'changed snapshot';
    workspaceSnapshot.workflowResults[0].parameters.topology = 'linear';

    expect(source.notes[0].body).toBe('Original');
    expect((source.workflowResults[0].parameters as { topology: string }).topology).toBe('circular');
  });
});
