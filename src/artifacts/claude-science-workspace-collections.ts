/**
 * Portable, additive collections for the standalone Claude Science workspace.
 *
 * These fields are optional on the existing v1 database payload. Older files
 * therefore normalize to empty collections and serialize without gaining new
 * keys until the user creates a note or saves a workflow result.
 *
 * Note bodies are opaque data. `format: "markdown"` is a presentation hint,
 * not permission to interpret HTML; renderers must continue to use React text
 * nodes or another explicitly safe Markdown renderer.
 */

export const MAX_ARTIFACT_NOTES = 1_000;
export const MAX_ARTIFACT_WORKFLOW_RESULTS = 1_000;
export const MAX_ARTIFACT_NOTE_BODY_LENGTH = 65_536;
export const MAX_ARTIFACT_NOTE_TITLE_LENGTH = 256;
export const MAX_ARTIFACT_NOTE_TAGS = 50;
export const MAX_ARTIFACT_TAG_LENGTH = 128;
export const MAX_ARTIFACT_ID_LENGTH = 160;
export const MAX_ARTIFACT_WORKFLOW_NAME_LENGTH = 256;
export const MAX_ARTIFACT_WORKFLOW_RECORD_IDS = 250;
export const MAX_ARTIFACT_PROVENANCE_PARENT_IDS = 250;
export const MAX_ARTIFACT_PROVENANCE_TEXT_LENGTH = 256;
export const MAX_ARTIFACT_STRUCTURED_DEPTH = 12;
export const MAX_ARTIFACT_STRUCTURED_NODES = 50_000;
export const MAX_ARTIFACT_STRUCTURED_ENTRIES = 10_000;
export const MAX_ARTIFACT_STRUCTURED_KEY_LENGTH = 256;
export const MAX_ARTIFACT_STRUCTURED_STRING_LENGTH = 16_384;
export const MAX_ARTIFACT_COLLECTION_TEXT_CHARACTERS = 8_388_608;

const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const WORKFLOW_KINDS = new Set<ArtifactWorkflowKind>(['digest', 'gel', 'golden_gate', 'ligation']);

export type ArtifactNoteScope = 'workspace' | 'record' | 'range';
export type ArtifactNoteFormat = 'plain' | 'markdown';
export type ArtifactWorkflowKind = 'digest' | 'gel' | 'golden_gate' | 'ligation';

export type ArtifactJsonPrimitive = string | number | boolean | null;
export type ArtifactJsonValue = ArtifactJsonPrimitive | ArtifactJsonValue[] | ArtifactJsonObject;
export type ArtifactJsonObject = { [key: string]: ArtifactJsonValue };

export type ArtifactSequenceRange = {
  /** 0-based, inclusive. */
  start: number;
  /** 0-based, exclusive. */
  end: number;
};

export type ArtifactProvenance = {
  source: string;
  operation?: string;
  actor?: string;
  engine?: string;
  engineVersion?: string;
  parentIds?: string[];
  metadata?: ArtifactJsonObject;
};

export type ArtifactNote = {
  id: string;
  title?: string;
  body: string;
  format: ArtifactNoteFormat;
  scope: ArtifactNoteScope;
  recordId?: string;
  range?: ArtifactSequenceRange;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  provenance?: ArtifactProvenance;
};

export type ArtifactWorkflowResult = {
  id: string;
  kind: ArtifactWorkflowKind;
  name: string;
  /** Ordered because part order is meaningful for assembly workflows. */
  inputRecordIds: string[];
  /** Optional SHA-256 values aligned by index with `inputRecordIds`. */
  inputSha256s?: string[];
  parameters: ArtifactJsonObject;
  outputRecordIds: string[];
  /** Compact, workflow-specific result data such as fragment or lane summaries. */
  result?: ArtifactJsonObject;
  createdAt: string;
  provenance: ArtifactProvenance;
};

/** Optional fields that can be spread into an existing v1 database payload. */
export type ArtifactWorkspaceCollectionFields = {
  notes?: ArtifactNote[];
  workflowResults?: ArtifactWorkflowResult[];
};

/** Internal form used after a v1-or-newer payload has been normalized. */
export type NormalizedArtifactWorkspaceCollections = {
  notes: ArtifactNote[];
  workflowResults: ArtifactWorkflowResult[];
};

export type ArtifactWorkspaceCollectionContext = {
  /** When supplied, record/range notes must resolve against this index. */
  recordLengths?: ReadonlyMap<string, number>;
  /**
   * Workflow outputs normally resolve against `recordLengths` too. Set this
   * only while restoring history whose derived records were deliberately
   * removed from the current workspace.
   */
  allowMissingWorkflowOutputRecords?: boolean;
};

export type ArtifactNoteUpdate = {
  title?: string;
  body?: string;
  format?: ArtifactNoteFormat;
  scope?: ArtifactNoteScope;
  recordId?: string;
  range?: ArtifactSequenceRange;
  tags?: string[];
  /** Required so updates never invent a wall-clock value inside pure code. */
  updatedAt: string;
  provenance?: ArtifactProvenance;
};

type ValidationBudget = {
  nodes: number;
  textCharacters: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function consumeText(value: string, path: string, budget: ValidationBudget): void {
  budget.textCharacters += value.length;
  if (budget.textCharacters > MAX_ARTIFACT_COLLECTION_TEXT_CHARACTERS) {
    throw new Error(
      `${path} makes workspace notes and workflow data exceed the maximum of ${MAX_ARTIFACT_COLLECTION_TEXT_CHARACTERS.toLocaleString()} text characters.`,
    );
  }
}

function boundedString(
  value: unknown,
  path: string,
  maxLength: number,
  budget: ValidationBudget,
  options: { trim?: boolean; allowBlank?: boolean } = {},
): string {
  if (typeof value !== 'string') throw new Error(`${path} must be a string.`);
  const normalized = options.trim === false ? value.replace(/\r\n?/g, '\n') : value.trim();
  if (!options.allowBlank && !normalized.trim()) throw new Error(`${path} must not be blank.`);
  if (normalized.length > maxLength) {
    throw new Error(`${path} cannot exceed ${maxLength.toLocaleString()} characters.`);
  }
  consumeText(normalized, path, budget);
  return normalized;
}

function normalizeId(value: unknown, path: string, budget: ValidationBudget): string {
  return boundedString(value, path, MAX_ARTIFACT_ID_LENGTH, budget);
}

function normalizeTimestamp(value: unknown, path: string, budget: ValidationBudget): string {
  const raw = boundedString(value, path, 64, budget);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    throw new Error(`${path} must be an ISO 8601 date-time.`);
  }
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) throw new Error(`${path} must be a valid ISO 8601 date-time.`);
  return new Date(milliseconds).toISOString();
}

function normalizeStringArray(
  value: unknown,
  path: string,
  maxEntries: number,
  maxLength: number,
  budget: ValidationBudget,
  options: { required?: boolean; deduplicate?: boolean } = {},
): string[] {
  if (value === undefined && !options.required) return [];
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length > maxEntries) {
    throw new Error(`${path} cannot contain more than ${maxEntries.toLocaleString()} entries.`);
  }
  const normalized = value.map((item, index) => boundedString(
    item,
    `${path}[${index}]`,
    maxLength,
    budget,
  ));
  return options.deduplicate ? Array.from(new Set(normalized)) : normalized;
}

function normalizeJsonValue(
  value: unknown,
  path: string,
  budget: ValidationBudget,
  ancestors: WeakSet<object>,
  depth: number,
): ArtifactJsonValue {
  budget.nodes += 1;
  if (budget.nodes > MAX_ARTIFACT_STRUCTURED_NODES) {
    throw new Error(`${path} exceeds the maximum of ${MAX_ARTIFACT_STRUCTURED_NODES.toLocaleString()} structured-data nodes.`);
  }
  if (depth > MAX_ARTIFACT_STRUCTURED_DEPTH) {
    throw new Error(`${path} exceeds the maximum structured-data depth of ${MAX_ARTIFACT_STRUCTURED_DEPTH}.`);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > MAX_ARTIFACT_STRUCTURED_STRING_LENGTH) {
      throw new Error(`${path} cannot exceed ${MAX_ARTIFACT_STRUCTURED_STRING_LENGTH.toLocaleString()} characters.`);
    }
    consumeText(value, path, budget);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must not contain NaN or Infinity.`);
    return value;
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error(`${path} must contain JSON-compatible values only.`);
  }
  if (ancestors.has(value)) throw new Error(`${path} must not contain circular references.`);

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MAX_ARTIFACT_STRUCTURED_ENTRIES) {
        throw new Error(`${path} cannot contain more than ${MAX_ARTIFACT_STRUCTURED_ENTRIES.toLocaleString()} entries.`);
      }
      return value.map((item, index) => normalizeJsonValue(
        item,
        `${path}[${index}]`,
        budget,
        ancestors,
        depth + 1,
      ));
    }
    if (!isPlainObject(value)) throw new Error(`${path} must contain plain JSON objects only.`);
    const entries = Object.entries(value);
    if (entries.length > MAX_ARTIFACT_STRUCTURED_ENTRIES) {
      throw new Error(`${path} cannot contain more than ${MAX_ARTIFACT_STRUCTURED_ENTRIES.toLocaleString()} properties.`);
    }
    const normalized: ArtifactJsonObject = {};
    for (const [key, item] of entries) {
      if (UNSAFE_OBJECT_KEYS.has(key)) throw new Error(`${path}.${key} is not an allowed object key.`);
      if (!key || key.length > MAX_ARTIFACT_STRUCTURED_KEY_LENGTH) {
        throw new Error(`${path} contains an empty or overlong object key.`);
      }
      consumeText(key, `${path}.${key}`, budget);
      normalized[key] = normalizeJsonValue(item, `${path}.${key}`, budget, ancestors, depth + 1);
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function normalizeJsonObject(
  value: unknown,
  path: string,
  budget: ValidationBudget,
): ArtifactJsonObject {
  if (!isPlainObject(value)) throw new Error(`${path} must be a plain JSON object.`);
  return normalizeJsonValue(value, path, budget, new WeakSet<object>(), 0) as ArtifactJsonObject;
}

function normalizeProvenance(
  value: unknown,
  path: string,
  budget: ValidationBudget,
  required: boolean,
): ArtifactProvenance | undefined {
  if (value === undefined) {
    if (required) throw new Error(`${path} is required.`);
    return undefined;
  }
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  const source = boundedString(value.source, `${path}.source`, MAX_ARTIFACT_PROVENANCE_TEXT_LENGTH, budget);
  const optionalText = (field: 'operation' | 'actor' | 'engine' | 'engineVersion'): string | undefined => (
    value[field] === undefined
      ? undefined
      : boundedString(value[field], `${path}.${field}`, MAX_ARTIFACT_PROVENANCE_TEXT_LENGTH, budget)
  );
  const operation = optionalText('operation');
  const actor = optionalText('actor');
  const engine = optionalText('engine');
  const engineVersion = optionalText('engineVersion');
  const parentIds = value.parentIds === undefined
    ? undefined
    : normalizeStringArray(
      value.parentIds,
      `${path}.parentIds`,
      MAX_ARTIFACT_PROVENANCE_PARENT_IDS,
      MAX_ARTIFACT_ID_LENGTH,
      budget,
    );
  const metadata = value.metadata === undefined
    ? undefined
    : normalizeJsonObject(value.metadata, `${path}.metadata`, budget);
  return {
    source,
    ...(operation === undefined ? {} : { operation }),
    ...(actor === undefined ? {} : { actor }),
    ...(engine === undefined ? {} : { engine }),
    ...(engineVersion === undefined ? {} : { engineVersion }),
    ...(parentIds === undefined ? {} : { parentIds }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function normalizeNote(
  value: unknown,
  index: number,
  context: ArtifactWorkspaceCollectionContext,
  budget: ValidationBudget,
): ArtifactNote {
  const path = `notes[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  const id = normalizeId(value.id, `${path}.id`, budget);
  const title = value.title === undefined
    ? undefined
    : boundedString(value.title, `${path}.title`, MAX_ARTIFACT_NOTE_TITLE_LENGTH, budget);
  const body = boundedString(
    value.body,
    `${path}.body`,
    MAX_ARTIFACT_NOTE_BODY_LENGTH,
    budget,
    { trim: false },
  );
  const format: ArtifactNoteFormat = value.format === undefined || value.format === 'plain'
    ? 'plain'
    : value.format === 'markdown'
      ? 'markdown'
      : (() => { throw new Error(`${path}.format must be "plain" or "markdown".`); })();
  const scope: ArtifactNoteScope = value.scope === 'workspace' || value.scope === 'record' || value.scope === 'range'
    ? value.scope
    : (() => { throw new Error(`${path}.scope must be "workspace", "record", or "range".`); })();
  const recordId = value.recordId === undefined ? undefined : normalizeId(value.recordId, `${path}.recordId`, budget);

  let range: ArtifactSequenceRange | undefined;
  if (value.range !== undefined) {
    if (!isPlainObject(value.range)) throw new Error(`${path}.range must be an object.`);
    const start = value.range.start;
    const end = value.range.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || Number(start) < 0 || Number(end) <= Number(start)) {
      throw new Error(`${path}.range must be a valid 0-based [start,end) range.`);
    }
    range = { start: Number(start), end: Number(end) };
  }

  if (scope === 'workspace' && (recordId !== undefined || range !== undefined)) {
    throw new Error(`${path} workspace notes cannot carry recordId or range.`);
  }
  if (scope === 'record' && (recordId === undefined || range !== undefined)) {
    throw new Error(`${path} record notes require recordId and cannot carry range.`);
  }
  if (scope === 'range' && (recordId === undefined || range === undefined)) {
    throw new Error(`${path} range notes require both recordId and range.`);
  }
  if (recordId !== undefined && context.recordLengths) {
    const recordLength = context.recordLengths.get(recordId);
    if (recordLength === undefined) throw new Error(`${path}.recordId does not match a workspace record.`);
    if (range && range.end > recordLength) {
      throw new Error(`${path}.range must fit within the ${recordLength}-residue record.`);
    }
  }

  const tags = value.tags === undefined
    ? undefined
    : normalizeStringArray(
      value.tags,
      `${path}.tags`,
      MAX_ARTIFACT_NOTE_TAGS,
      MAX_ARTIFACT_TAG_LENGTH,
      budget,
      { deduplicate: true },
    );
  const createdAt = normalizeTimestamp(value.createdAt, `${path}.createdAt`, budget);
  const updatedAt = normalizeTimestamp(value.updatedAt, `${path}.updatedAt`, budget);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error(`${path}.updatedAt cannot be earlier than createdAt.`);
  }
  const provenance = normalizeProvenance(value.provenance, `${path}.provenance`, budget, false);
  return {
    id,
    ...(title === undefined ? {} : { title }),
    body,
    format,
    scope,
    ...(recordId === undefined ? {} : { recordId }),
    ...(range === undefined ? {} : { range }),
    ...(tags === undefined ? {} : { tags }),
    createdAt,
    updatedAt,
    ...(provenance === undefined ? {} : { provenance }),
  };
}

function normalizeWorkflowResult(
  value: unknown,
  index: number,
  context: ArtifactWorkspaceCollectionContext,
  budget: ValidationBudget,
): ArtifactWorkflowResult {
  const path = `workflowResults[${index}]`;
  if (!isPlainObject(value)) throw new Error(`${path} must be an object.`);
  const id = normalizeId(value.id, `${path}.id`, budget);
  if (!WORKFLOW_KINDS.has(value.kind as ArtifactWorkflowKind)) {
    throw new Error(`${path}.kind must be "digest", "gel", "golden_gate", or "ligation".`);
  }
  const kind = value.kind as ArtifactWorkflowKind;
  const name = boundedString(value.name, `${path}.name`, MAX_ARTIFACT_WORKFLOW_NAME_LENGTH, budget);
  const inputRecordIds = normalizeStringArray(
    value.inputRecordIds,
    `${path}.inputRecordIds`,
    MAX_ARTIFACT_WORKFLOW_RECORD_IDS,
    MAX_ARTIFACT_ID_LENGTH,
    budget,
    { required: true },
  );
  if (inputRecordIds.length === 0) throw new Error(`${path}.inputRecordIds must contain at least one record id.`);
  const inputSha256s = value.inputSha256s === undefined
    ? undefined
    : normalizeStringArray(
      value.inputSha256s,
      `${path}.inputSha256s`,
      MAX_ARTIFACT_WORKFLOW_RECORD_IDS,
      64,
      budget,
    );
  if (inputSha256s && inputSha256s.length !== inputRecordIds.length) {
    throw new Error(`${path}.inputSha256s must align one-to-one with inputRecordIds.`);
  }
  inputSha256s?.forEach((sha256, shaIndex) => {
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error(`${path}.inputSha256s[${shaIndex}] must be a 64-character SHA-256 value.`);
    }
  });
  const normalizedInputSha256s = inputSha256s?.map((sha256) => sha256.toLowerCase());
  const parameters = normalizeJsonObject(value.parameters ?? {}, `${path}.parameters`, budget);
  const outputRecordIds = normalizeStringArray(
    value.outputRecordIds,
    `${path}.outputRecordIds`,
    MAX_ARTIFACT_WORKFLOW_RECORD_IDS,
    MAX_ARTIFACT_ID_LENGTH,
    budget,
  );
  if (context.recordLengths) {
    inputRecordIds.forEach((recordId, recordIndex) => {
      if (!context.recordLengths?.has(recordId)) {
        throw new Error(`${path}.inputRecordIds[${recordIndex}] does not match a workspace record.`);
      }
    });
    if (!context.allowMissingWorkflowOutputRecords) {
      outputRecordIds.forEach((recordId, recordIndex) => {
        if (!context.recordLengths?.has(recordId)) {
          throw new Error(`${path}.outputRecordIds[${recordIndex}] does not match a workspace record.`);
        }
      });
    }
  }
  const result = value.result === undefined
    ? undefined
    : normalizeJsonObject(value.result, `${path}.result`, budget);
  const createdAt = normalizeTimestamp(value.createdAt, `${path}.createdAt`, budget);
  const provenance = normalizeProvenance(value.provenance, `${path}.provenance`, budget, true);
  if (!provenance) throw new Error(`${path}.provenance is required.`);
  return {
    id,
    kind,
    name,
    inputRecordIds,
    ...(normalizedInputSha256s === undefined ? {} : { inputSha256s: normalizedInputSha256s }),
    parameters,
    outputRecordIds,
    ...(result === undefined ? {} : { result }),
    createdAt,
    provenance,
  };
}

function assertUniqueIds(values: readonly { id: string }[], path: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${path} contains duplicate id "${value.id}".`);
    ids.add(value.id);
  }
}

function normalizeNotesWithBudget(
  value: unknown,
  context: ArtifactWorkspaceCollectionContext,
  budget: ValidationBudget,
): ArtifactNote[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('notes must be an array when provided.');
  if (value.length > MAX_ARTIFACT_NOTES) {
    throw new Error(`notes cannot contain more than ${MAX_ARTIFACT_NOTES.toLocaleString()} entries.`);
  }
  const notes = value.map((note, index) => normalizeNote(note, index, context, budget));
  assertUniqueIds(notes, 'notes');
  return notes;
}

function normalizeWorkflowResultsWithBudget(
  value: unknown,
  budget: ValidationBudget,
  context: ArtifactWorkspaceCollectionContext,
): ArtifactWorkflowResult[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('workflowResults must be an array when provided.');
  if (value.length > MAX_ARTIFACT_WORKFLOW_RESULTS) {
    throw new Error(`workflowResults cannot contain more than ${MAX_ARTIFACT_WORKFLOW_RESULTS.toLocaleString()} entries.`);
  }
  const results = value.map((result, index) => normalizeWorkflowResult(result, index, context, budget));
  assertUniqueIds(results, 'workflowResults');
  return results;
}

export function normalizeArtifactNotes(
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactNote[] {
  return normalizeNotesWithBudget(value, context, { nodes: 0, textCharacters: 0 });
}

export function normalizeArtifactWorkflowResults(
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactWorkflowResult[] {
  return normalizeWorkflowResultsWithBudget(value, { nodes: 0, textCharacters: 0 }, context);
}

export function normalizeArtifactWorkspaceCollections(
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): NormalizedArtifactWorkspaceCollections {
  if (value === undefined || value === null) return { notes: [], workflowResults: [] };
  if (!isPlainObject(value)) throw new Error('Workspace collections must be an object.');
  const budget: ValidationBudget = { nodes: 0, textCharacters: 0 };
  return {
    notes: normalizeNotesWithBudget(value.notes, context, budget),
    workflowResults: normalizeWorkflowResultsWithBudget(value.workflowResults, budget, context),
  };
}

/**
 * Produces a defensive JSON-safe copy suitable for spreading into a database
 * payload. Empty collections are omitted to keep existing v1 exports stable.
 */
export function serializeArtifactWorkspaceCollections(
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactWorkspaceCollectionFields {
  const normalized = normalizeArtifactWorkspaceCollections(value, context);
  return {
    ...(normalized.notes.length === 0 ? {} : { notes: normalized.notes }),
    ...(normalized.workflowResults.length === 0 ? {} : { workflowResults: normalized.workflowResults }),
  };
}

/** Stable JSON handoff for tests, clipboard APIs, and future ZIP sidecars. */
export function stringifyArtifactWorkspaceCollections(
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): string {
  return JSON.stringify(serializeArtifactWorkspaceCollections(value, context), null, 2);
}

/** Validates one caller-identified note without generating ids or timestamps. */
export function createArtifactNote(
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactNote {
  const [note] = normalizeArtifactNotes([value], context);
  if (!note) throw new Error('A note is required.');
  return note;
}

/** Pure append. The existing array is never mutated, including on failure. */
export function addArtifactNote(
  notes: unknown,
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactNote[] {
  const current = normalizeArtifactNotes(notes, context);
  const note = createArtifactNote(value, context);
  return normalizeArtifactNotes([...current, note], context);
}

const ARTIFACT_NOTE_UPDATE_KEYS = new Set<keyof ArtifactNoteUpdate>([
  'title',
  'body',
  'format',
  'scope',
  'recordId',
  'range',
  'tags',
  'updatedAt',
  'provenance',
]);

/**
 * Pure atomic update. `id` and `createdAt` are immutable; callers must provide
 * the replacement `updatedAt` explicitly so tests and agents remain
 * deterministic.
 */
export function updateArtifactNote(
  notes: unknown,
  noteId: unknown,
  patch: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactNote[] {
  const current = normalizeArtifactNotes(notes, context);
  const id = normalizeId(noteId, 'noteId', { nodes: 0, textCharacters: 0 });
  const index = current.findIndex((note) => note.id === id);
  if (index < 0) throw new Error(`Note "${id}" does not exist.`);
  if (!isPlainObject(patch)) throw new Error('Note update must be an object.');
  for (const key of Object.keys(patch)) {
    if (!ARTIFACT_NOTE_UPDATE_KEYS.has(key as keyof ArtifactNoteUpdate)) {
      throw new Error(`Note update cannot modify unknown or immutable field "${key}".`);
    }
  }
  if (patch.updatedAt === undefined) throw new Error('Note update.updatedAt is required.');
  const updated = current.map((note, noteIndex) => noteIndex === index ? { ...note, ...patch } : note);
  return normalizeArtifactNotes(updated, context);
}

/** Pure removal that fails loudly when an id is stale or misspelled. */
export function removeArtifactNote(
  notes: unknown,
  noteId: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactNote[] {
  const current = normalizeArtifactNotes(notes, context);
  const id = normalizeId(noteId, 'noteId', { nodes: 0, textCharacters: 0 });
  if (!current.some((note) => note.id === id)) throw new Error(`Note "${id}" does not exist.`);
  return current.filter((note) => note.id !== id);
}

/** Defensive snapshot for runtime getter APIs. */
export function getArtifactNotesSnapshot(
  notes: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactNote[] {
  return normalizeArtifactNotes(notes, context);
}

/** Pure append with full batch and optional record-reference validation. */
export function appendArtifactWorkflowResult(
  workflowResults: unknown,
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactWorkflowResult[] {
  const current = normalizeArtifactWorkflowResults(workflowResults, context);
  const [result] = normalizeArtifactWorkflowResults([value], context);
  if (!result) throw new Error('A workflow result is required.');
  return normalizeArtifactWorkflowResults([...current, result], context);
}

/** Pure workflow-history removal with a loud stale-id failure. */
export function removeArtifactWorkflowResult(
  workflowResults: unknown,
  resultId: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactWorkflowResult[] {
  const current = normalizeArtifactWorkflowResults(workflowResults, context);
  const id = normalizeId(resultId, 'resultId', { nodes: 0, textCharacters: 0 });
  if (!current.some((result) => result.id === id)) {
    throw new Error(`Workflow result "${id}" does not exist.`);
  }
  return current.filter((result) => result.id !== id);
}

/** Defensive snapshot for workflow-history getter APIs. */
export function getArtifactWorkflowResultsSnapshot(
  workflowResults: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): ArtifactWorkflowResult[] {
  return normalizeArtifactWorkflowResults(workflowResults, context);
}

/** Defensive snapshot of both additive collections with one shared size budget. */
export function getArtifactWorkspaceCollectionsSnapshot(
  value: unknown,
  context: ArtifactWorkspaceCollectionContext = {},
): NormalizedArtifactWorkspaceCollections {
  return normalizeArtifactWorkspaceCollections(value, context);
}
