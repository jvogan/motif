import { computeMSA, isMSAError, MSA_MAX_SEQ_LEN, type MSAResult } from '../bio/msa';
import { STANDARD_CODE } from '../bio/codon-tables';
import type { SequenceType } from '../bio/types';

export const ARTIFACT_MSA_MAX_ALIGNMENTS = 50;
export const ARTIFACT_MSA_MAX_ROWS = 100;
export const ARTIFACT_MSA_MAX_COLUMNS = 50_000;
export const ARTIFACT_MSA_MAX_CELLS = 2_000_000;
export const ARTIFACT_MSA_MAX_WORKSPACE_CELLS = 4_000_000;
export const ARTIFACT_MSA_MAX_LOCAL_SEQUENCES = 10;
export const ARTIFACT_MSA_LOCAL_WORK_BUDGET = 40_000_000;
export const ARTIFACT_MSA_MAX_NAME_LENGTH = 1_024;
export const ARTIFACT_MSA_MAX_IMPORT_CHARACTERS = 2_250_000;
export const ARTIFACT_MSA_MAX_IMPORT_BYTES = 2_500_000;

export type MsaClientBounds = { left: number; right: number; top: number; bottom: number };

export type MsaColumnHitTestMetrics = {
  viewportLeft: number;
  viewportRight: number;
  labelWidth: number;
  scrollLeft: number;
  cellWidth: number;
  columnCount: number;
};

export type MsaGridCellPosition = { rowIndex: number; column: number };

export type MsaGridNavigationOptions = {
  rowCount: number;
  columnCount: number;
  pageColumnCount: number;
  toGridBoundary?: boolean;
};

const MSA_DRAG_EDGE_MIN_SPEED = 2;
const MSA_DRAG_EDGE_MAX_SPEED = 32;
const MSA_DRAG_EDGE_SPEED_SCALE = 0.35;

/** Clamp a drag pointer just inside a client-coordinate rectangle. */
export function clampMsaClientPoint(
  clientX: number,
  clientY: number,
  bounds: MsaClientBounds,
): { clientX: number; clientY: number } {
  const maxX = Math.max(bounds.left, bounds.right - 0.5);
  const maxY = Math.max(bounds.top, bounds.bottom - 0.5);
  return {
    clientX: Math.max(bounds.left, Math.min(maxX, clientX)),
    clientY: Math.max(bounds.top, Math.min(maxY, clientY)),
  };
}

/** Per-frame signed scroll distance for a pointer beyond one viewport axis. */
export function msaEdgeAutoScrollDelta(pointer: number, start: number, end: number): number {
  const overshoot = pointer < start ? pointer - start : pointer > end ? pointer - end : 0;
  if (overshoot === 0) return 0;
  const speed = Math.min(
    MSA_DRAG_EDGE_MAX_SPEED,
    Math.max(MSA_DRAG_EDGE_MIN_SPEED, Math.ceil(Math.abs(overshoot) * MSA_DRAG_EDGE_SPEED_SCALE)),
  );
  return overshoot < 0 ? -speed : speed;
}

/** Map a client X coordinate to an alignment column, optionally clamping drag overflow. */
export function msaColumnFromClientX(
  clientX: number,
  metrics: MsaColumnHitTestMetrics,
  clampToViewport = false,
): number | null {
  if (metrics.columnCount <= 0 || metrics.cellWidth <= 0) return null;
  const sequenceLeft = metrics.viewportLeft + metrics.labelWidth;
  const sequenceRight = Math.max(sequenceLeft, metrics.viewportRight);
  const resolvedX = clampToViewport
    ? clampMsaClientPoint(clientX, 0, { left: sequenceLeft, right: sequenceRight, top: 0, bottom: 1 }).clientX
    : clientX;
  if (!clampToViewport && (resolvedX < sequenceLeft || resolvedX >= sequenceRight)) return null;
  const column = Math.floor((resolvedX - sequenceLeft + metrics.scrollLeft) / metrics.cellWidth);
  if (clampToViewport) return Math.max(0, Math.min(metrics.columnCount - 1, column));
  return column >= 0 && column < metrics.columnCount ? column : null;
}

/** Resolve a keyboard navigation key to a clamped cell in the sequence grid. */
export function navigateMsaGridCell(
  current: MsaGridCellPosition,
  key: string,
  options: MsaGridNavigationOptions,
): MsaGridCellPosition | null {
  const rowCount = Math.max(0, Math.floor(options.rowCount));
  const columnCount = Math.max(0, Math.floor(options.columnCount));
  if (rowCount === 0 || columnCount === 0) return null;

  const lastRow = rowCount - 1;
  const lastColumn = columnCount - 1;
  const rowIndex = Math.max(0, Math.min(lastRow, Math.floor(current.rowIndex)));
  const column = Math.max(0, Math.min(lastColumn, Math.floor(current.column)));
  const page = Math.max(1, Math.floor(options.pageColumnCount));

  if (key === 'ArrowLeft') return { rowIndex, column: Math.max(0, column - 1) };
  if (key === 'ArrowRight') return { rowIndex, column: Math.min(lastColumn, column + 1) };
  if (key === 'ArrowUp') return { rowIndex: Math.max(0, rowIndex - 1), column };
  if (key === 'ArrowDown') return { rowIndex: Math.min(lastRow, rowIndex + 1), column };
  if (key === 'PageUp') return { rowIndex, column: Math.max(0, column - page) };
  if (key === 'PageDown') return { rowIndex, column: Math.min(lastColumn, column + page) };
  if (key === 'Home') return options.toGridBoundary ? { rowIndex: 0, column: 0 } : { rowIndex, column: 0 };
  if (key === 'End') {
    return options.toGridBoundary
      ? { rowIndex: lastRow, column: lastColumn }
      : { rowIndex, column: lastColumn };
  }
  return null;
}

export type ArtifactAlignmentMode = 'browser' | 'local-command' | 'imported';

export type ArtifactAlignmentEngineInput = {
  id?: string;
  label?: string;
  version?: string;
  mode?: ArtifactAlignmentMode;
  parameters?: string[];
  usedFallback?: boolean;
};

export type ArtifactAlignmentRowInput = {
  id?: string;
  name?: string;
  aligned?: string;
  sequence?: string;
  sourceRecordId?: string;
  inputSha256?: string;
};

export type ArtifactAlignmentInput = {
  id?: string;
  name?: string;
  molecule?: SequenceType;
  type?: SequenceType;
  referenceRowId?: string;
  rows?: ArtifactAlignmentRowInput[];
  sequences?: ArtifactAlignmentRowInput[];
  alignedFasta?: string;
  engine?: ArtifactAlignmentEngineInput | string;
  createdAt?: string;
  outputSha256?: string;
  note?: string;
};

export type ArtifactAlignmentRow = {
  id: string;
  name: string;
  aligned: string;
  identity: number;
  sourceRecordId?: string;
  inputSha256?: string;
};

export type ArtifactAlignmentEngine = {
  id: string;
  label: string;
  mode: ArtifactAlignmentMode;
  version?: string;
  parameters?: string[];
  usedFallback?: boolean;
};

export type ArtifactAlignment = {
  id: string;
  name: string;
  molecule: SequenceType;
  referenceRowId: string;
  rows: ArtifactAlignmentRow[];
  engine: ArtifactAlignmentEngine;
  createdAt?: string;
  outputSha256?: string;
  note?: string;
  consensus: string;
  conserved: boolean[];
  gapOnly: boolean[];
  alignmentLength: number;
  centerIdx: number;
};

export type ArtifactMsaRecord = {
  id: string;
  name: string;
  sequence: string;
  type: SequenceType;
};

export class ArtifactAlignmentError extends Error {
  readonly code:
    | 'invalid_alignment'
    | 'invalid_fasta'
    | 'mixed_molecule'
    | 'too_large'
    | 'work_budget';

  constructor(code: ArtifactAlignmentError['code'], message: string) {
    super(message);
    this.name = 'ArtifactAlignmentError';
    this.code = code;
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedText(value: unknown, fallback: string, field: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw new ArtifactAlignmentError('invalid_alignment', `${field} must be a string.`);
  const text = value.trim();
  if (!text) return fallback;
  if (text.length > ARTIFACT_MSA_MAX_NAME_LENGTH) {
    throw new ArtifactAlignmentError('too_large', `${field} cannot exceed ${ARTIFACT_MSA_MAX_NAME_LENGTH.toLocaleString()} characters.`);
  }
  return text;
}

function safeId(value: unknown, fallback: string, field: string): string {
  return normalizedText(value, fallback, field).replace(/\s+/g, '-');
}

function hasUnsafeHeaderCharacter(text: string): boolean {
  return Array.from(text).some((symbol) => {
    const code = symbol.charCodeAt(0);
    return symbol === '>' || code < 32 || code === 127 || code === 0x2028 || code === 0x2029;
  });
}

function normalizedHeaderText(value: unknown, fallback: string, field: string): string {
  const text = normalizedText(value, fallback, field);
  if (hasUnsafeHeaderCharacter(text)) {
    throw new ArtifactAlignmentError('invalid_alignment', `${field} cannot contain FASTA header markers, line breaks, or control characters.`);
  }
  return text;
}

function normalizeMolecule(value: unknown): SequenceType | null {
  if (value === 'dna' || value === 'rna' || value === 'protein') return value;
  return null;
}

function validAlphabet(sequence: string, molecule: SequenceType): boolean {
  if (molecule === 'dna') return /^[ACGTRYSWKMBDHVN?-]+$/.test(sequence);
  if (molecule === 'rna') return /^[ACGURYSWKMBDHVN?-]+$/.test(sequence);
  return /^[A-Z*?-]+$/.test(sequence);
}

function cleanAlignedSequence(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new ArtifactAlignmentError('invalid_alignment', `${field} must be a string.`);
  if (value.length > ARTIFACT_MSA_MAX_IMPORT_CHARACTERS) {
    throw new ArtifactAlignmentError('too_large', `${field} cannot exceed ${ARTIFACT_MSA_MAX_IMPORT_CHARACTERS.toLocaleString()} raw characters.`);
  }
  return value.toUpperCase().replace(/\./g, '-').replace(/\s+/g, '');
}

function summarizeRows(
  rows: Array<Omit<ArtifactAlignmentRow, 'identity'>>,
): Pick<ArtifactAlignment, 'rows' | 'consensus' | 'conserved' | 'gapOnly' | 'alignmentLength'> {
  const alignmentLength = rows[0]?.aligned.length ?? 0;
  let consensus = '';
  const conserved: boolean[] = [];
  const gapOnly: boolean[] = [];

  for (let column = 0; column < alignmentLength; column += 1) {
    const symbols = rows.map((row) => row.aligned[column] ?? '-');
    const nonGap = symbols.filter((symbol) => symbol !== '-');
    if (nonGap.length === 0) {
      consensus += '-';
      conserved.push(false);
      gapOnly.push(true);
      continue;
    }
    const counts = new Map<string, number>();
    for (const symbol of nonGap) counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    const winner = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    consensus += winner;
    conserved.push(nonGap.length === symbols.length && nonGap.every((symbol) => symbol === winner));
    gapOnly.push(false);
  }

  const summarizedRows: ArtifactAlignmentRow[] = rows.map((row) => {
    let matches = 0;
    let total = 0;
    for (let column = 0; column < alignmentLength; column += 1) {
      if (consensus[column] === '-') continue;
      total += 1;
      if (row.aligned[column] === consensus[column]) matches += 1;
    }
    return {
      ...row,
      identity: total > 0 ? Math.round((matches / total) * 1_000) / 10 : 0,
    };
  });

  return { rows: summarizedRows, consensus, conserved, gapOnly, alignmentLength };
}

function normalizeEngine(value: ArtifactAlignmentInput['engine']): ArtifactAlignmentEngine {
  if (typeof value === 'string') {
    const label = normalizedText(value, 'Imported alignment', 'alignment.engine');
    return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, mode: 'imported' };
  }
  if (value !== undefined && !plainObject(value)) {
    throw new ArtifactAlignmentError('invalid_alignment', 'alignment.engine must be a string or object.');
  }
  const input = plainObject(value) ? value as ArtifactAlignmentEngineInput : {};
  if (input.mode !== undefined && input.mode !== 'browser' && input.mode !== 'local-command' && input.mode !== 'imported') {
    throw new ArtifactAlignmentError('invalid_alignment', 'alignment.engine.mode must be browser, local-command, or imported.');
  }
  if (input.usedFallback !== undefined && typeof input.usedFallback !== 'boolean') {
    throw new ArtifactAlignmentError('invalid_alignment', 'alignment.engine.usedFallback must be a boolean.');
  }
  const mode: ArtifactAlignmentMode = input.mode === 'browser' || input.mode === 'local-command' || input.mode === 'imported'
    ? input.mode
    : 'imported';
  const label = normalizedText(input.label, mode === 'browser' ? 'Motif local preview' : 'Imported alignment', 'alignment.engine.label');
  const parameters = input.parameters === undefined
    ? undefined
    : Array.isArray(input.parameters) && input.parameters.every((item) => typeof item === 'string' && item.length <= ARTIFACT_MSA_MAX_NAME_LENGTH)
      ? [...input.parameters]
      : (() => { throw new ArtifactAlignmentError('invalid_alignment', 'alignment.engine.parameters must be an array of bounded strings.'); })();
  return {
    id: safeId(input.id, label.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'imported', 'alignment.engine.id'),
    label,
    mode,
    version: input.version === undefined ? undefined : normalizedText(input.version, '', 'alignment.engine.version') || undefined,
    parameters,
    usedFallback: typeof input.usedFallback === 'boolean' ? input.usedFallback : undefined,
  };
}

function rowsFromAlignedFasta(text: string): ArtifactAlignmentRowInput[] {
  if (typeof text !== 'string' || !text.trim()) {
    throw new ArtifactAlignmentError('invalid_fasta', 'Aligned FASTA is empty.');
  }
  if (text.length > ARTIFACT_MSA_MAX_IMPORT_CHARACTERS) {
    throw new ArtifactAlignmentError('too_large', `Aligned text cannot exceed ${ARTIFACT_MSA_MAX_IMPORT_CHARACTERS.toLocaleString()} characters.`);
  }
  const rows: ArtifactAlignmentRowInput[] = [];
  let current: ArtifactAlignmentRowInput | null = null;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';')) continue;
    if (line.startsWith('>')) {
      const name = line.slice(1).trim();
      if (!name) throw new ArtifactAlignmentError('invalid_fasta', 'Every FASTA row needs a non-empty header.');
      current = { name, aligned: '' };
      rows.push(current);
      if (rows.length > ARTIFACT_MSA_MAX_ROWS) {
        throw new ArtifactAlignmentError('too_large', `An alignment can contain at most ${ARTIFACT_MSA_MAX_ROWS} rows.`);
      }
      continue;
    }
    if (!current) throw new ArtifactAlignmentError('invalid_fasta', 'Aligned FASTA must begin with a >header line.');
    current.aligned = `${current.aligned ?? ''}${line}`;
    if ((current.aligned?.length ?? 0) > ARTIFACT_MSA_MAX_COLUMNS) {
      throw new ArtifactAlignmentError('too_large', `An alignment can contain at most ${ARTIFACT_MSA_MAX_COLUMNS.toLocaleString()} columns.`);
    }
  }
  return rows;
}

function rowsFromClustal(text: string): ArtifactAlignmentRowInput[] {
  if (typeof text !== 'string' || !text.trim()) {
    throw new ArtifactAlignmentError('invalid_fasta', 'CLUSTAL alignment is empty.');
  }
  if (text.length > ARTIFACT_MSA_MAX_IMPORT_CHARACTERS) {
    throw new ArtifactAlignmentError('too_large', `Aligned text cannot exceed ${ARTIFACT_MSA_MAX_IMPORT_CHARACTERS.toLocaleString()} characters.`);
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim().length > 0);
  if (firstContent < 0 || !/^CLUSTAL(?:\s|$)/i.test(lines[firstContent].trim())) {
    throw new ArtifactAlignmentError('invalid_fasta', 'CLUSTAL text must begin with a CLUSTAL header.');
  }

  const order: string[] = [];
  const sequences = new Map<string, string>();
  for (const rawLine of lines.slice(firstContent + 1)) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^[*:.\s]+$/.test(trimmed) || trimmed.startsWith('#')) continue;
    const match = rawLine.match(/^\s*(\S+)\s+([A-Za-z*?.-]+)(?:\s+\d+)?\s*$/);
    if (!match) throw new ArtifactAlignmentError('invalid_fasta', `Malformed CLUSTAL row: ${trimmed.slice(0, 80)}`);
    const [, identifier, chunk] = match;
    if (!sequences.has(identifier)) {
      order.push(identifier);
      sequences.set(identifier, '');
      if (order.length > ARTIFACT_MSA_MAX_ROWS) {
        throw new ArtifactAlignmentError('too_large', `An alignment can contain at most ${ARTIFACT_MSA_MAX_ROWS} rows.`);
      }
    }
    const next = `${sequences.get(identifier) ?? ''}${chunk}`;
    if (next.length > ARTIFACT_MSA_MAX_COLUMNS) {
      throw new ArtifactAlignmentError('too_large', `An alignment can contain at most ${ARTIFACT_MSA_MAX_COLUMNS.toLocaleString()} columns.`);
    }
    sequences.set(identifier, next);
  }
  return order.map((identifier) => ({ id: identifier, name: identifier, aligned: sequences.get(identifier) ?? '' }));
}

export function normalizeArtifactAlignment(
  input: unknown,
  index = 0,
  maxCells = ARTIFACT_MSA_MAX_CELLS,
): ArtifactAlignment {
  if (!plainObject(input)) throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}] must be an object.`);
  const raw = input as ArtifactAlignmentInput;
  if (raw.rows !== undefined && !Array.isArray(raw.rows)) {
    throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}].rows must be an array.`);
  }
  if (raw.sequences !== undefined && !Array.isArray(raw.sequences)) {
    throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}].sequences must be an array.`);
  }
  if (raw.alignedFasta !== undefined && typeof raw.alignedFasta !== 'string') {
    throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}].alignedFasta must be a string.`);
  }
  const rawRows = typeof raw.alignedFasta === 'string'
    ? rowsFromAlignedFasta(raw.alignedFasta)
    : Array.isArray(raw.rows)
      ? raw.rows
      : Array.isArray(raw.sequences)
        ? raw.sequences
        : null;
  if (!rawRows || rawRows.length < 2) {
    throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}] needs at least 2 aligned rows.`);
  }
  if (rawRows.length > ARTIFACT_MSA_MAX_ROWS) {
    throw new ArtifactAlignmentError('too_large', `An alignment can contain at most ${ARTIFACT_MSA_MAX_ROWS} rows.`);
  }

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const rows: Array<Omit<ArtifactAlignmentRow, 'identity'>> = rawRows.map((candidate, rowIndex) => {
    if (!plainObject(candidate)) throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}].rows[${rowIndex}] must be an object.`);
    const row = candidate as ArtifactAlignmentRowInput;
    const name = normalizedHeaderText(row.name, `Sequence ${rowIndex + 1}`, `alignments[${index}].rows[${rowIndex}].name`);
    const nameKey = name.toLocaleLowerCase();
    if (seenNames.has(nameKey)) throw new ArtifactAlignmentError('invalid_alignment', `Alignment row names must be unique; “${name}” appears more than once.`);
    seenNames.add(nameKey);
    const id = safeId(row.id, `row-${rowIndex + 1}`, `alignments[${index}].rows[${rowIndex}].id`);
    if (seenIds.has(id)) throw new ArtifactAlignmentError('invalid_alignment', `Alignment row ids must be unique; “${id}” appears more than once.`);
    seenIds.add(id);
    const aligned = cleanAlignedSequence(row.aligned ?? row.sequence, `alignments[${index}].rows[${rowIndex}].aligned`);
    if (!aligned) throw new ArtifactAlignmentError('invalid_alignment', `Alignment row “${name}” is empty.`);
    if (!aligned.replace(/-/g, '')) throw new ArtifactAlignmentError('invalid_alignment', `Alignment row “${name}” cannot contain gaps only.`);
    if (aligned.length > ARTIFACT_MSA_MAX_COLUMNS) {
      throw new ArtifactAlignmentError('too_large', `An alignment can contain at most ${ARTIFACT_MSA_MAX_COLUMNS.toLocaleString()} columns.`);
    }
    if (rawRows.length * aligned.length > Math.min(ARTIFACT_MSA_MAX_CELLS, maxCells)) {
      throw new ArtifactAlignmentError(
        'too_large',
        maxCells < ARTIFACT_MSA_MAX_CELLS
          ? `Saved alignments can contain at most ${ARTIFACT_MSA_MAX_WORKSPACE_CELLS.toLocaleString()} row-columns in total.`
          : `An alignment can contain at most ${ARTIFACT_MSA_MAX_CELLS.toLocaleString()} row-columns.`,
      );
    }
    return {
      id,
      name,
      aligned,
      sourceRecordId: row.sourceRecordId === undefined ? undefined : normalizedText(row.sourceRecordId, '', `alignments[${index}].rows[${rowIndex}].sourceRecordId`) || undefined,
      inputSha256: row.inputSha256 === undefined ? undefined : normalizedText(row.inputSha256, '', `alignments[${index}].rows[${rowIndex}].inputSha256`) || undefined,
    };
  });

  const alignmentLength = rows[0].aligned.length;
  if (alignmentLength > ARTIFACT_MSA_MAX_COLUMNS) {
    throw new ArtifactAlignmentError('too_large', `An alignment can contain at most ${ARTIFACT_MSA_MAX_COLUMNS.toLocaleString()} columns.`);
  }
  if (rows.some((row) => row.aligned.length !== alignmentLength)) {
    throw new ArtifactAlignmentError('invalid_alignment', 'All aligned rows must have exactly the same number of columns.');
  }
  if (rows.length * alignmentLength > ARTIFACT_MSA_MAX_CELLS) {
    throw new ArtifactAlignmentError('too_large', `An alignment can contain at most ${ARTIFACT_MSA_MAX_CELLS.toLocaleString()} row-columns.`);
  }
  if (rows.length * alignmentLength > maxCells) {
    throw new ArtifactAlignmentError('too_large', `Saved alignments can contain at most ${ARTIFACT_MSA_MAX_WORKSPACE_CELLS.toLocaleString()} row-columns in total.`);
  }

  if (raw.molecule !== undefined && !normalizeMolecule(raw.molecule)) {
    throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}].molecule must be dna, rna, or protein.`);
  }
  if (raw.type !== undefined && !normalizeMolecule(raw.type)) {
    throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}].type must be dna, rna, or protein.`);
  }
  if (raw.molecule !== undefined && raw.type !== undefined && raw.molecule !== raw.type) {
    throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}].molecule and type must agree.`);
  }
  const molecule = normalizeMolecule(raw.molecule ?? raw.type);
  if (!molecule) {
    throw new ArtifactAlignmentError('invalid_alignment', `alignments[${index}].molecule or type is required because aligned symbols alone cannot distinguish every nucleotide sequence from protein.`);
  }
  for (const row of rows) {
    if (!validAlphabet(row.aligned, molecule)) {
      throw new ArtifactAlignmentError('invalid_alignment', `Alignment row “${row.name}” contains symbols that are not valid for ${molecule.toUpperCase()}.`);
    }
  }

  const summary = summarizeRows(rows);
  const id = safeId(raw.id, `alignment-${index + 1}`, `alignments[${index}].id`);
  let referenceRowId = rows[0].id;
  if (raw.referenceRowId !== undefined) {
    const requestedReference = safeId(raw.referenceRowId, '', `alignments[${index}].referenceRowId`);
    if (!seenIds.has(requestedReference)) {
      throw new ArtifactAlignmentError('invalid_alignment', `Alignment referenceRowId “${requestedReference}” does not match a row id.`);
    }
    referenceRowId = requestedReference;
  }
  return {
    id,
    name: normalizedHeaderText(raw.name, `Alignment ${index + 1}`, `alignments[${index}].name`),
    molecule,
    referenceRowId,
    ...summary,
    engine: normalizeEngine(raw.engine),
    createdAt: raw.createdAt === undefined ? undefined : normalizedText(raw.createdAt, '', `alignments[${index}].createdAt`) || undefined,
    outputSha256: raw.outputSha256 === undefined ? undefined : normalizedText(raw.outputSha256, '', `alignments[${index}].outputSha256`) || undefined,
    note: raw.note === undefined ? undefined : normalizedText(raw.note, '', `alignments[${index}].note`) || undefined,
    centerIdx: Math.max(0, rows.findIndex((row) => row.id === referenceRowId)),
  };
}

export function normalizeArtifactAlignments(value: unknown): ArtifactAlignment[] {
  if (value === undefined || value === null) return [];
  const candidates = Array.isArray(value) ? value : [value];
  if (candidates.length > ARTIFACT_MSA_MAX_ALIGNMENTS) {
    throw new ArtifactAlignmentError('too_large', `A workspace can contain at most ${ARTIFACT_MSA_MAX_ALIGNMENTS} saved alignments.`);
  }
  const alignments: ArtifactAlignment[] = [];
  const ids = new Set<string>();
  let cells = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const alignment = normalizeArtifactAlignment(
      candidates[index],
      index,
      Math.min(ARTIFACT_MSA_MAX_CELLS, ARTIFACT_MSA_MAX_WORKSPACE_CELLS - cells),
    );
    if (ids.has(alignment.id)) throw new ArtifactAlignmentError('invalid_alignment', `Alignment ids must be unique; “${alignment.id}” appears more than once.`);
    ids.add(alignment.id);
    cells += alignment.rows.length * alignment.alignmentLength;
    alignments.push(alignment);
  }
  return alignments;
}

export function parseAlignedFasta(
  text: string,
  options: Omit<ArtifactAlignmentInput, 'rows' | 'sequences' | 'alignedFasta'> = {},
): ArtifactAlignment {
  return normalizeArtifactAlignment({ ...options, rows: rowsFromAlignedFasta(text) });
}

export function parseAlignmentText(
  text: string,
  options: Omit<ArtifactAlignmentInput, 'rows' | 'sequences' | 'alignedFasta'> = {},
): ArtifactAlignment {
  if (typeof text !== 'string' || text.length > ARTIFACT_MSA_MAX_IMPORT_CHARACTERS) {
    throw new ArtifactAlignmentError('too_large', `Aligned text cannot exceed ${ARTIFACT_MSA_MAX_IMPORT_CHARACTERS.toLocaleString()} characters.`);
  }
  const firstContent = text.replace(/^\uFEFF/, '').split(/\r?\n/).find((line) => {
    const trimmed = line.trim();
    return Boolean(trimmed && !trimmed.startsWith(';'));
  })?.trim() ?? '';
  const rows = /^CLUSTAL(?:\s|$)/i.test(firstContent) ? rowsFromClustal(text) : rowsFromAlignedFasta(text);
  return normalizeArtifactAlignment({ ...options, rows });
}

export function estimateLocalAlignmentWork(records: readonly ArtifactMsaRecord[]): number {
  const lengths = records.map((record) => record.sequence.replace(/\s+/g, '').length);
  let pairwise = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    for (let j = i + 1; j < lengths.length; j += 1) pairwise += lengths[i] * lengths[j];
  }
  const maxLength = Math.max(0, ...lengths);
  const centerPass = lengths.reduce((sum, length) => sum + maxLength * length, 0) - maxLength * maxLength;
  return pairwise + Math.max(0, centerPass);
}

export function createLocalArtifactAlignment(
  records: readonly ArtifactMsaRecord[],
  options: { id?: string; name?: string; createdAt?: string } = {},
): ArtifactAlignment {
  if (records.length < 2 || records.length > ARTIFACT_MSA_MAX_LOCAL_SEQUENCES) {
    throw new ArtifactAlignmentError('invalid_alignment', `Select 2–${ARTIFACT_MSA_MAX_LOCAL_SEQUENCES} records for a browser alignment.`);
  }
  const molecule = records[0].type;
  if (records.some((record) => record.type !== molecule)) {
    throw new ArtifactAlignmentError('mixed_molecule', 'Browser alignment requires records with the same molecule type.');
  }
  const longest = Math.max(...records.map((record) => record.sequence.replace(/\s+/g, '').length));
  if (longest > MSA_MAX_SEQ_LEN) {
    throw new ArtifactAlignmentError('too_large', `Browser alignment supports at most ${MSA_MAX_SEQ_LEN.toLocaleString()} residues per record.`);
  }
  const work = estimateLocalAlignmentWork(records);
  if (work > ARTIFACT_MSA_LOCAL_WORK_BUDGET) {
    throw new ArtifactAlignmentError(
      'work_budget',
      `This selection is too expensive for a responsive browser preview (${Math.round(work / 1_000_000)}M estimated cells). Import a MAFFT, MUSCLE, or Clustal alignment instead.`,
    );
  }
  const usedNames = new Map<string, number>();
  const displayNames = records.map((record) => {
    const key = record.name.toLocaleLowerCase();
    const count = (usedNames.get(key) ?? 0) + 1;
    usedNames.set(key, count);
    return count === 1 ? record.name : `${record.name} (${count})`;
  });
  const result = computeMSA(records.map((record) => record.sequence), displayNames);
  if (isMSAError(result)) throw new ArtifactAlignmentError(result.type === 'too_large' ? 'too_large' : 'invalid_alignment', result.message);
  const rows: ArtifactAlignmentRowInput[] = result.rows.map((row, index) => ({
    id: `row-${index + 1}`,
    name: row.name,
    aligned: row.aligned,
    sourceRecordId: records[index].id,
  }));
  const referenceRowId = rows[result.centerIdx]?.id;
  return normalizeArtifactAlignment({
    id: options.id,
    name: options.name ?? `Alignment of ${records.length} records`,
    molecule,
    referenceRowId,
    rows,
    engine: {
      id: 'motif-star',
      label: 'Motif local preview',
      mode: 'browser',
      usedFallback: false,
    },
    createdAt: options.createdAt ?? new Date().toISOString(),
    note: 'Computed locally in this browser with Motif’s bounded star alignment.',
  });
}

export function artifactAlignmentResult(alignment: ArtifactAlignment): MSAResult {
  return {
    rows: alignment.rows.map((row) => ({ name: row.name, aligned: row.aligned, identity: row.identity })),
    consensus: alignment.consensus,
    conserved: [...alignment.conserved],
    gapOnly: [...alignment.gapOnly],
    alignmentLength: alignment.alignmentLength,
    centerIdx: alignment.centerIdx,
  };
}

export function serializeArtifactAlignment(alignment: ArtifactAlignment): ArtifactAlignmentInput {
  return {
    id: alignment.id,
    name: alignment.name,
    molecule: alignment.molecule,
    referenceRowId: alignment.referenceRowId,
    rows: alignment.rows.map((row) => ({
      id: row.id,
      name: row.name,
      aligned: row.aligned,
      sourceRecordId: row.sourceRecordId,
      inputSha256: row.inputSha256,
    })),
    engine: {
      ...alignment.engine,
      parameters: alignment.engine.parameters ? [...alignment.engine.parameters] : undefined,
    },
    createdAt: alignment.createdAt,
    outputSha256: alignment.outputSha256,
    note: alignment.note,
  };
}

function wrapSequence(sequence: string, width = 80): string {
  const lines: string[] = [];
  for (let offset = 0; offset < sequence.length; offset += width) lines.push(sequence.slice(offset, offset + width));
  return lines.join('\n');
}

export function formatAlignedFasta(alignment: ArtifactAlignment): string {
  return `${alignment.rows.map((row) => `>${row.name}\n${wrapSequence(row.aligned)}`).join('\n')}\n`;
}

export function formatConsensusFasta(alignment: ArtifactAlignment): string {
  return `>${alignment.name} consensus\n${wrapSequence(alignment.consensus)}\n`;
}

function clustalIdentifiers(rows: readonly ArtifactAlignmentRow[]): string[] {
  const used = new Set<string>();
  return rows.map((row, index) => {
    const ascii = row.name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[^A-Za-z0-9_.-]+/g, '_')
      .replace(/^[-_.]+|[-_.]+$/g, '');
    const root = (ascii || `sequence_${index + 1}`).slice(0, 30);
    let identifier = root;
    for (let suffix = 2; used.has(identifier.toLocaleLowerCase()); suffix += 1) {
      const ending = `_${suffix}`;
      identifier = `${root.slice(0, 30 - ending.length)}${ending}`;
    }
    used.add(identifier.toLocaleLowerCase());
    return identifier;
  });
}

export function formatClustal(alignment: ArtifactAlignment, blockWidth = 60): string {
  const identifiers = clustalIdentifiers(alignment.rows);
  const nameWidth = Math.max(10, ...identifiers.map((identifier) => identifier.length));
  const lines = ['CLUSTAL W multiple sequence alignment', ''];
  for (let start = 0; start < alignment.alignmentLength; start += blockWidth) {
    const end = Math.min(alignment.alignmentLength, start + blockWidth);
    for (let rowIndex = 0; rowIndex < alignment.rows.length; rowIndex += 1) {
      const row = alignment.rows[rowIndex];
      lines.push(`${identifiers[rowIndex].padEnd(nameWidth + 2)}${row.aligned.slice(start, end)}`);
    }
    lines.push(`${''.padEnd(nameWidth + 2)}${alignment.conserved.slice(start, end).map((value) => value ? '*' : ' ').join('')}`, '');
  }
  return `${lines.join('\n')}\n`;
}

export function safeAlignmentFilename(alignment: ArtifactAlignment, extension: string): string {
  const slug = alignment.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'alignment';
  return `${slug}.${extension.replace(/^\./, '')}`;
}

// ===== Viewer analytics: per-column statistics (pure, derived) =====
//
// These read only the aligned rows already stored on an ArtifactAlignment, so
// they add no persisted state and never touch the alignment engine. The viewer
// uses them to draw conservation/occupancy histograms, shade columns, and
// summarize a selection.

export type MsaColumnStats = {
  /** Non-gap fraction of rows at this column (0..1). */
  occupancy: number;
  /** Majority non-gap residue; '-' when the whole column is gaps. */
  consensusResidue: string;
  /** Count of the majority residue among non-gap rows. */
  consensusCount: number;
  /** consensusCount / non-gap rows (0..1); 0 when the column is all gaps. */
  consensusFraction: number;
  /** consensusCount / total rows (0..1) — identity gated by occupancy. */
  identity: number;
  /** Blended 0..1 conservation score (majority dominance × occupancy). */
  conservation: number;
  /** Shannon entropy in bits over non-gap residues (0 = single residue). */
  entropy: number;
  /** True when every row carries the same non-gap residue here. */
  fullyConserved: boolean;
};

const LOG2 = Math.log(2);

/** Per-column statistics for an alignment's rows. O(rows × columns), single pass. */
export function computeMsaColumnStats(
  rows: ReadonlyArray<{ aligned: string }>,
  molecule: SequenceType = 'dna',
): MsaColumnStats[] {
  const rowCount = rows.length;
  const length = rows[0]?.aligned.length ?? 0;
  const stats: MsaColumnStats[] = new Array(length);
  // Normalise Shannon entropy against the alphabet so conservation measures
  // residue diversity (1 = a single residue, 0 = maximally diverse) — genuinely
  // distinct from identity, which only tracks the majority residue's share.
  const maxEntropy = Math.log2(molecule === 'protein' ? 20 : 4);
  for (let column = 0; column < length; column += 1) {
    const counts = new Map<string, number>();
    let nonGap = 0;
    for (let row = 0; row < rowCount; row += 1) {
      const symbol = rows[row].aligned[column] ?? '-';
      if (symbol === '-') continue;
      nonGap += 1;
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    if (nonGap === 0) {
      stats[column] = {
        occupancy: 0, consensusResidue: '-', consensusCount: 0,
        consensusFraction: 0, identity: 0, conservation: 0, entropy: 0, fullyConserved: false,
      };
      continue;
    }
    let winner = '';
    let winnerCount = 0;
    let entropy = 0;
    for (const [symbol, count] of counts) {
      if (count > winnerCount || (count === winnerCount && (winner === '' || symbol < winner))) {
        winner = symbol;
        winnerCount = count;
      }
      const probability = count / nonGap;
      entropy -= probability * (Math.log(probability) / LOG2);
    }
    const occupancy = nonGap / rowCount;
    const consensusFraction = winnerCount / nonGap;
    stats[column] = {
      occupancy,
      consensusResidue: winner,
      consensusCount: winnerCount,
      consensusFraction,
      identity: winnerCount / rowCount,
      conservation: occupancy * Math.max(0, Math.min(1, 1 - entropy / maxEntropy)),
      entropy,
      fullyConserved: winnerCount === rowCount,
    };
  }
  return stats;
}

/** One column of a sequence logo: the residues present and the column height. */
export type MsaLogoColumn = {
  /**
   * Fill height 0..1 = occupancy × (1 − H/Hmax) — the same conservation measure
   * the histogram uses, so a fully conserved fully occupied column fills the
   * track and a diverse or gappy column is shorter.
   */
  information: number;
  /** Residues present, descending by frequency; fraction is share of occupied rows. */
  stack: { symbol: string; fraction: number }[];
};

/**
 * Per-column data for a sequence-logo track: for each column the residues present
 * (sorted most-frequent first, ties alphabetical) and a 0..1 fill height scaled by
 * information content. The optional half-open range keeps UI callers windowed;
 * work and retained objects are O(rows × requested columns). Gaps never count.
 * Mirrors the conservation definition in computeMsaColumnStats so the logo
 * height and the conservation histogram agree.
 */
export function computeSequenceLogoColumns(
  rows: ReadonlyArray<{ aligned: string }>,
  molecule: SequenceType = 'dna',
  range: { startColumn?: number; endColumn?: number } = {},
): MsaLogoColumn[] {
  const rowCount = rows.length;
  const length = rows[0]?.aligned.length ?? 0;
  const requestedStart = Number.isFinite(range.startColumn) ? Math.floor(range.startColumn!) : 0;
  const requestedEnd = Number.isFinite(range.endColumn) ? Math.ceil(range.endColumn!) : length;
  const startColumn = Math.max(0, Math.min(length, requestedStart));
  const endColumn = Math.max(startColumn, Math.min(length, requestedEnd));
  const maxEntropy = Math.log2(molecule === 'protein' ? 20 : 4);
  const columns: MsaLogoColumn[] = new Array(endColumn - startColumn);
  for (let column = startColumn; column < endColumn; column += 1) {
    const outputIndex = column - startColumn;
    const counts = new Map<string, number>();
    let nonGap = 0;
    for (let row = 0; row < rowCount; row += 1) {
      const symbol = rows[row].aligned[column] ?? '-';
      if (symbol === '-') continue;
      nonGap += 1;
      counts.set(symbol, (counts.get(symbol) ?? 0) + 1);
    }
    if (nonGap === 0) { columns[outputIndex] = { information: 0, stack: [] }; continue; }
    let entropy = 0;
    const stack: { symbol: string; fraction: number }[] = [];
    for (const [symbol, count] of counts) {
      const probability = count / nonGap;
      entropy -= probability * (Math.log(probability) / LOG2);
      stack.push({ symbol, fraction: probability });
    }
    stack.sort((a, b) => b.fraction - a.fraction || (a.symbol < b.symbol ? -1 : 1));
    const occupancy = nonGap / rowCount;
    const information = maxEntropy > 0 ? occupancy * Math.max(0, Math.min(1, 1 - entropy / maxEntropy)) : 0;
    columns[outputIndex] = { information, stack };
  }
  return columns;
}

/** Bucket a 0..1 score into 0..4 for CSS-driven shading intensity. */
export function msaShadeBucket(value: number): 0 | 1 | 2 | 3 | 4 {
  if (!(value > 0)) return 0;
  if (value >= 0.999) return 4;
  if (value >= 0.8) return 3;
  if (value >= 0.6) return 2;
  if (value >= 0.4) return 1;
  return 0;
}

// ===== Residue colour schemes =====
//
// residueColorKey returns a stable class-like token consumed as a data-attribute
// and coloured in claude-science-msa.css (so palettes stay theme-aware in light
// and dark). The viewer keeps its existing residueTone rendering for 'auto';
// resolveMsaColorScheme exposes the matching molecule-aware scheme semantics.

export type MsaColorScheme = 'auto' | 'nucleotide' | 'clustal' | 'hydrophobicity' | 'taylor';
export type MsaShadeMode = 'none' | 'mismatch' | 'identity' | 'conservation';

export const MSA_COLOR_SCHEMES: readonly MsaColorScheme[] = ['auto', 'nucleotide', 'clustal', 'hydrophobicity', 'taylor'];
export const MSA_SHADE_MODES: readonly MsaShadeMode[] = ['none', 'mismatch', 'identity', 'conservation'];

export function resolveMsaColorScheme(
  molecule: SequenceType,
  scheme: MsaColorScheme,
): Exclude<MsaColorScheme, 'auto'> {
  if (scheme !== 'auto') return scheme;
  return molecule === 'protein' ? 'clustal' : 'nucleotide';
}

// ClustalX-style amino-acid chemistry groups.
const CLUSTAL_GROUP: Record<string, string> = {
  A: 'hydrophobic', I: 'hydrophobic', L: 'hydrophobic', M: 'hydrophobic', F: 'hydrophobic', W: 'hydrophobic', V: 'hydrophobic',
  K: 'positive', R: 'positive',
  E: 'negative', D: 'negative',
  N: 'polar', Q: 'polar', S: 'polar', T: 'polar',
  C: 'cysteine', G: 'glycine', P: 'proline', H: 'aromatic', Y: 'aromatic',
};

// Kyte-Doolittle hydropathy, bucketed 0 (hydrophilic) .. 4 (hydrophobic).
const KYTE_DOOLITTLE: Record<string, number> = {
  I: 4.5, V: 4.2, L: 3.8, F: 2.8, C: 2.5, M: 1.9, A: 1.8, G: -0.4, T: -0.7, S: -0.8,
  W: -0.9, Y: -1.3, P: -1.6, H: -3.2, E: -3.5, Q: -3.5, D: -3.5, N: -3.5, K: -3.9, R: -4.5,
};

function hydropathyBucket(symbol: string): 0 | 1 | 2 | 3 | 4 {
  const value = KYTE_DOOLITTLE[symbol];
  if (value === undefined) return 2;
  if (value >= 3) return 4;
  if (value >= 1) return 3;
  if (value >= -1) return 2;
  if (value >= -3.4) return 1;
  return 0;
}

/** Palette token for a residue under a given scheme; '' means "no colour". */
export function residueColorKey(symbol: string, molecule: SequenceType, scheme: MsaColorScheme): string {
  const residue = symbol.toUpperCase();
  if (residue === '-' || residue === '.' || residue === '' || residue === '?') return '';
  const resolvedScheme = resolveMsaColorScheme(molecule, scheme);
  if (resolvedScheme === 'nucleotide') {
    if (residue === 'A') return 'nt-a';
    if (residue === 'C') return 'nt-c';
    if (residue === 'G') return 'nt-g';
    if (residue === 'T' || residue === 'U') return 'nt-t';
    return 'nt-other';
  }
  if (resolvedScheme === 'taylor') return 'taylor';
  if (resolvedScheme === 'hydrophobicity') return `hyd-${hydropathyBucket(residue)}`;
  const group = CLUSTAL_GROUP[residue];
  return group ? `cl-${group}` : 'cl-other';
}

// ===== Selection helpers =====
//
// A selection is an inclusive column range plus an optional row-id subset (all
// rows when omitted). These produce copy payloads for the viewer's context menu
// without mutating the workspace.

export type MsaColumnRange = { start: number; end: number };

export type MsaSelection = {
  columns: MsaColumnRange;
  rowIds?: readonly string[];
};

function selectionRows(alignment: ArtifactAlignment, selection: MsaSelection): ArtifactAlignmentRow[] {
  if (!selection.rowIds || selection.rowIds.length === 0) return alignment.rows;
  // Resolve ids in the order the caller supplied them (the displayed/sorted/
  // reordered order), not the alignment's stored order.
  const byId = new Map(alignment.rows.map((row) => [row.id, row]));
  return selection.rowIds
    .map((id) => byId.get(id))
    .filter((row): row is ArtifactAlignmentRow => row !== undefined);
}

function clampRange(range: MsaColumnRange, length: number): MsaColumnRange {
  const start = Math.max(0, Math.min(length - 1, Math.min(range.start, range.end)));
  const end = Math.max(0, Math.min(length - 1, Math.max(range.start, range.end)));
  return { start, end };
}

/** Aligned (gapped) slice of the selected block, one entry per selected row. */
export function sliceSelectionRows(
  alignment: ArtifactAlignment,
  selection: MsaSelection,
): Array<{ id: string; name: string; aligned: string }> {
  const { start, end } = clampRange(selection.columns, alignment.alignmentLength);
  return selectionRows(alignment, selection).map((row) => ({
    id: row.id,
    name: row.name,
    aligned: row.aligned.slice(start, end + 1),
  }));
}

/** Selected block as aligned (gap-preserving) FASTA. */
export function selectionToFasta(alignment: ArtifactAlignment, selection: MsaSelection): string {
  return `${sliceSelectionRows(alignment, selection)
    .map((row) => `>${row.name}\n${wrapSequence(row.aligned)}`)
    .join('\n')}\n`;
}

/** Selected block as ungapped (residues-only) FASTA, dropping rows left empty. */
export function selectionToUngappedFasta(alignment: ArtifactAlignment, selection: MsaSelection): string {
  const rows = sliceSelectionRows(alignment, selection)
    .map((row) => ({ ...row, residues: row.aligned.replace(/-/g, '') }))
    .filter((row) => row.residues.length > 0);
  return `${rows.map((row) => `>${row.name}\n${wrapSequence(row.residues)}`).join('\n')}\n`;
}

/** Selected block as plain aligned rows (one line per row, no headers). */
export function selectionToColumnsText(alignment: ArtifactAlignment, selection: MsaSelection): string {
  return sliceSelectionRows(alignment, selection).map((row) => row.aligned).join('\n');
}

/** Aggregate stats over a column range, for the selection readout. */
export function summarizeSelectionColumns(
  columnStats: readonly MsaColumnStats[],
  range: MsaColumnRange,
): { columns: number; variableColumns: number; fullyConserved: number; meanIdentity: number; meanConservation: number; gapColumns: number } {
  const length = columnStats.length;
  const { start, end } = clampRange(range, length);
  let variableColumns = 0;
  let fullyConserved = 0;
  let gapColumns = 0;
  let identitySum = 0;
  let conservationSum = 0;
  const columns = length > 0 ? end - start + 1 : 0;
  for (let column = start; column <= end && column < length; column += 1) {
    const stat = columnStats[column];
    if (!stat) continue;
    // An all-gap column has no residues to agree or disagree, so it is neither
    // conserved nor variable, and must not dilute the mean identity/conservation
    // — it counts only as a gap column.
    if (stat.occupancy === 0) { gapColumns += 1; continue; }
    identitySum += stat.identity;
    conservationSum += stat.conservation;
    if (stat.fullyConserved) fullyConserved += 1;
    else if (stat.consensusFraction < 1) variableColumns += 1;
  }
  const informative = columns - gapColumns;
  return {
    columns,
    variableColumns,
    fullyConserved,
    gapColumns,
    meanIdentity: informative > 0 ? identitySum / informative : 0,
    meanConservation: informative > 0 ? conservationSum / informative : 0,
  };
}

/**
 * Return a new ordering with `id` moved to `targetIndex`. The item is removed
 * first, then reinserted, so `targetIndex` is interpreted against the array
 * without the moved id and clamped to its bounds. Used by the viewer's manual
 * row drag-reorder (pointer drop and keyboard step both funnel through here so
 * the reorder logic stays pure and unit-testable). Ids absent from `order`, or
 * a target equal to the current slot, yield an equivalent order.
 */
export function moveRowId(order: readonly string[], id: string, targetIndex: number): string[] {
  const from = order.indexOf(id);
  if (from < 0) return order.slice();
  const without = order.filter((value) => value !== id);
  const clamped = Math.max(0, Math.min(without.length, targetIndex));
  without.splice(clamped, 0, id);
  return without;
}

/** One translated amino-acid cell, positioned against alignment columns. */
export type MsaTranslationCodon = {
  aminoAcid: string;      // single-letter AA; 'X' unknown/ambiguous, '*' stop
  position: number;       // 1-based amino-acid index within this row's frame
  codon: string;          // 3-letter DNA codon (U normalized to T), uppercase
  startColumn: number;    // alignment column of the codon's first nucleotide
  endColumn: number;      // alignment column of the codon's third nucleotide
  gapSpanning: boolean;   // alignment gaps fall between the codon's nucleotides
};

/**
 * Translate a gapped, aligned nucleotide row into amino-acid cells positioned
 * against the alignment columns. Ungapped nucleotides are read starting at
 * `frame`, grouped into codons; each returned cell spans the columns of its
 * codon's first and third nucleotide (wider than three columns when alignment
 * gaps interrupt the codon — flagged via `gapSpanning`). The `frame` offset and
 * any trailing 1-2 nucleotide remainder produce no cell. Unknown/ambiguous
 * codons yield 'X'; stop codons yield '*'. Gaps never consume the reading frame,
 * so a gap alone is not treated as a frameshift. Callers should restrict this to
 * nucleotide molecules (DNA/RNA).
 */
export function translateAlignedRow(aligned: string, frame: 0 | 1 | 2 = 0): MsaTranslationCodon[] {
  const codons: MsaTranslationCodon[] = [];
  let seenNonGap = 0;
  let bases = '';
  let columns: number[] = [];
  let position = 0;
  for (let column = 0; column < aligned.length; column += 1) {
    const raw = aligned[column];
    if (raw === '-' || raw === '.') continue;
    seenNonGap += 1;
    if (seenNonGap <= frame) continue;
    const upper = raw.toUpperCase();
    bases += upper === 'U' ? 'T' : upper;
    columns.push(column);
    if (bases.length === 3) {
      position += 1;
      codons.push({
        aminoAcid: STANDARD_CODE.codons[bases] ?? 'X',
        position,
        codon: bases,
        startColumn: columns[0],
        endColumn: columns[2],
        gapSpanning: columns[2] - columns[0] !== 2,
      });
      bases = '';
      columns = [];
    }
  }
  return codons;
}

/** A motif hit within one row, mapped back to alignment columns. */
export type MsaMotifMatch = {
  rowId: string;
  rowName: string;
  startColumn: number;      // alignment column of the first matched residue
  endColumn: number;        // alignment column of the last matched residue
  columns: number[];        // alignment columns of every matched residue (gaps skipped)
};

export type MsaMotifSearchResult = { matches: MsaMotifMatch[]; truncated: boolean };

export const MSA_MOTIF_SEARCH_MAX_MATCHES = 5_000;
export const MSA_MOTIF_SEARCH_MAX_QUERY_LENGTH = 256;
export const MSA_MOTIF_SEARCH_MAX_RETAINED_COLUMNS = 200_000;

// Upper bound on residue comparisons per search so a long, rare, or absent query
// on a large alignment cannot block the render thread: once exceeded the scan
// stops and reports `truncated` instead of running to completion.
export const MSA_MOTIF_SEARCH_MAX_COMPARISONS = 2_000_000;

// IUPAC nucleotide ambiguity → the concrete bases each code covers.
const IUPAC_NUCLEOTIDES: Record<string, string> = {
  A: 'A', C: 'C', G: 'G', T: 'T', U: 'T',
  R: 'AG', Y: 'CT', S: 'CG', W: 'AT', K: 'GT', M: 'AC',
  B: 'CGT', D: 'AGT', H: 'ACT', V: 'ACG', N: 'ACGT',
};

function nucleotidesMatch(query: string, target: string): boolean {
  const querySet = IUPAC_NUCLEOTIDES[query] ?? query;
  const targetSet = IUPAC_NUCLEOTIDES[target] ?? target;
  for (const base of querySet) if (targetSet.includes(base)) return true;
  return false;
}

function residueMatch(query: string, target: string, molecule: SequenceType): boolean {
  if (molecule === 'protein') return query === target || query === 'X' || target === 'X';
  return nucleotidesMatch(query, target);
}

function normalizeMotifResidue(symbol: string, molecule: SequenceType): string {
  const upper = symbol.toUpperCase();
  return molecule !== 'protein' && upper === 'U' ? 'T' : upper;
}

type MsaMotifMatchOrder = Pick<MsaMotifMatch, 'rowId' | 'rowName' | 'startColumn' | 'endColumn'>;

/** Total order over matches: earliest alignment column first, then row identity. */
function compareMotifMatches(a: MsaMotifMatchOrder, b: MsaMotifMatchOrder): number {
  return a.startColumn - b.startColumn
    || a.endColumn - b.endColumn
    || a.rowName.localeCompare(b.rowName, undefined, { numeric: true })
    || a.rowId.localeCompare(b.rowId, undefined, { numeric: true });
}

/**
 * Retains only the `capacity` globally-earliest matches (by compareMotifMatches)
 * using a binary max-heap, so a low-complexity query stays O(total × log capacity)
 * in time and O(capacity) in memory no matter how many raw hits it produces —
 * instead of collecting every hit and sorting (which the row-order cap got wrong,
 * and which could exhaust memory before the count cap ever tripped).
 */
class BoundedEarliestMatches {
  private heap: MsaMotifMatch[] = [];
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /**
   * Add a match; returns true when the set was already full (results capped).
   * The columns factory runs only when the candidate is retained, avoiding a
   * query-length array allocation for every discarded low-complexity hit.
   */
  push(order: MsaMotifMatchOrder, columns: () => number[]): boolean {
    if (this.capacity <= 0) return true;
    const materialize = (): MsaMotifMatch => ({ ...order, columns: columns() });
    if (this.heap.length < this.capacity) {
      this.heap.push(materialize());
      this.siftUp(this.heap.length - 1);
      return false;
    }
    // Full: keep the new match only if it is earlier than the current worst (root).
    if (compareMotifMatches(order, this.heap[0]) < 0) {
      this.heap[0] = materialize();
      this.siftDown(0);
    }
    return true;
  }

  toSortedArray(): MsaMotifMatch[] {
    return this.heap.slice().sort(compareMotifMatches);
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compareMotifMatches(this.heap[i], this.heap[parent]) <= 0) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  private siftDown(index: number): void {
    let i = index;
    const size = this.heap.length;
    for (;;) {
      let largest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < size && compareMotifMatches(this.heap[left], this.heap[largest]) > 0) largest = left;
      if (right < size && compareMotifMatches(this.heap[right], this.heap[largest]) > 0) largest = right;
      if (largest === i) break;
      [this.heap[i], this.heap[largest]] = [this.heap[largest], this.heap[i]];
      i = largest;
    }
  }
}

/**
 * Find every occurrence of `query` across the ungapped residues of each row,
 * mapping each hit back to the alignment columns it covers (gap columns between
 * matched residues are skipped, never counted as part of the motif). Matching is
 * case-insensitive, treats U/T as equivalent for nucleotides, and honours IUPAC
 * ambiguity in both the query and the target (protein uses X as a wildcard).
 * Overlapping hits are returned. A query containing a gap, or empty, yields no
 * matches. Results are capped at `maxMatches` (sorted by column then row) with a
 * `truncated` flag so a low-complexity query stays bounded.
 */
export function findMsaMotifMatches(
  rows: readonly { id: string; name: string; aligned: string }[],
  query: string,
  options: {
    molecule: SequenceType;
    maxMatches?: number;
    maxComparisons?: number;
    maxQueryLength?: number;
    maxRetainedColumns?: number;
  },
): MsaMotifSearchResult {
  const trimmed = query.trim();
  if (!trimmed || /[-.]/.test(trimmed)) return { matches: [], truncated: false };
  const { molecule } = options;
  const maxMatches = Math.max(0, Math.floor(options.maxMatches ?? MSA_MOTIF_SEARCH_MAX_MATCHES));
  const maxComparisons = Math.max(1, Math.floor(options.maxComparisons ?? MSA_MOTIF_SEARCH_MAX_COMPARISONS));
  const maxQueryLength = Math.max(1, Math.floor(options.maxQueryLength ?? MSA_MOTIF_SEARCH_MAX_QUERY_LENGTH));
  const maxRetainedColumns = Math.max(0, Math.floor(options.maxRetainedColumns ?? MSA_MOTIF_SEARCH_MAX_RETAINED_COLUMNS));
  const needle = Array.from(trimmed, (symbol) => normalizeMotifResidue(symbol, molecule));
  if (needle.length > maxQueryLength) return { matches: [], truncated: true };
  // Every retained match owns one alignment-column index per query residue.
  // Bound that aggregate independently of the match count so long motifs cannot
  // turn a nominally bounded result into millions of array entries.
  const retainedCapacity = Math.min(maxMatches, Math.floor(maxRetainedColumns / needle.length));
  // Keep only the globally-earliest `maxMatches` regardless of row scan order,
  // and cap total residue comparisons so a rare/absent long query stays bounded.
  const collector = new BoundedEarliestMatches(retainedCapacity);
  let truncated = false;
  let comparisons = 0;

  scan: for (const row of rows) {
    const residues: string[] = [];
    const columns: number[] = [];
    for (let column = 0; column < row.aligned.length; column += 1) {
      const symbol = row.aligned[column];
      if (symbol === '-' || symbol === '.') continue;
      residues.push(normalizeMotifResidue(symbol, molecule));
      columns.push(column);
    }
    const limit = residues.length - needle.length;
    for (let start = 0; start <= limit; start += 1) {
      let ok = true;
      for (let offset = 0; offset < needle.length; offset += 1) {
        comparisons += 1;
        if (comparisons > maxComparisons) { truncated = true; break scan; }
        if (!residueMatch(needle[offset], residues[start + offset], molecule)) { ok = false; break; }
      }
      if (!ok) continue;
      if (collector.push({
        rowId: row.id,
        rowName: row.name,
        startColumn: columns[start],
        endColumn: columns[start + needle.length - 1],
      }, () => columns.slice(start, start + needle.length))) {
        truncated = true;
        // With zero retention capacity, the first hit proves truncation and no
        // later scan can change the intentionally empty result.
        if (retainedCapacity === 0) break scan;
      }
    }
  }

  return { matches: collector.toSortedArray(), truncated };
}

// ===== Alignment image export (pure geometry + palette) =====
//
// PNG/SVG export must render from the data model, not the DOM: the matrix is
// column-virtualised, so only a sliver of columns is ever mounted. These helpers
// stay DOM-free and deterministic so they unit-test without a canvas —
// computeAlignmentImageLayout derives the pixel geometry, and
// resolveResidueCellColor mirrors the residue-scheme fills in
// claude-science-msa.css as concrete sRGB hex against an explicit export
// background (live CSS variables never resolve in pure code).

export type AlignmentImageScope = 'view' | 'all';

/** Minimal alignment shape the layout needs — ArtifactAlignment satisfies it. */
export type AlignmentImageSource = {
  rows: ReadonlyArray<{ name: string; aligned: string }>;
  alignmentLength: number;
};

export type AlignmentImageLayoutOptions = {
  scope: AlignmentImageScope;
  /** Half-open [startColumn, endColumn) window used when scope === 'view'. */
  startColumn?: number;
  endColumn?: number;
  cellWidth?: number;
  cellHeight?: number;
  fontSize?: number;
  labelWidth?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxCells?: number;
};

export type AlignmentImageLayout = {
  scope: AlignmentImageScope;
  startColumn: number;
  columnCount: number;
  rowCount: number;
  cellWidth: number;
  cellHeight: number;
  fontSize: number;
  /** True when cells are wide enough to draw glyphs (else birdseye blocks). */
  drawLetters: boolean;
  labelWidth: number;
  titleHeight: number;
  axisHeight: number;
  headerHeight: number;
  /** Final canvas/SVG dimensions, clamped to the pixel budget. */
  width: number;
  height: number;
  /** Unclamped ideal dimensions (before the pixel budget was applied). */
  contentWidth: number;
  contentHeight: number;
  /** True when the cell/column budget forced a shrink (offer SVG as vector). */
  clamped: boolean;
};

// Legibility floor shared with the viewer's birdseye threshold (MSA_LETTER_MIN).
export const MSA_IMAGE_LETTER_MIN = 6.5;
export const MSA_IMAGE_MAX_WIDTH = 12_000;
export const MSA_IMAGE_MAX_HEIGHT = 8_000;
// Cap on drawn cells so a huge alignment cannot produce an unbounded canvas or
// SVG string; past this the whole-alignment scope draws a leading window.
export const MSA_IMAGE_MAX_CELLS = 400_000;
const MSA_IMAGE_DEFAULT_CELL_WIDTH = 12;
const MSA_IMAGE_DEFAULT_CELL_HEIGHT = 16;
const MSA_IMAGE_DEFAULT_FONT_SIZE = 11;
const MSA_IMAGE_MIN_LABEL_WIDTH = 96;
const MSA_IMAGE_MAX_LABEL_WIDTH = 320;

function imageLabelWidth(rows: AlignmentImageSource['rows'], fontSize: number): number {
  const approxChar = fontSize * 0.62;
  let longest = 0;
  for (const row of rows) longest = Math.max(longest, Math.min(row.name.length, 40));
  const raw = Math.round(longest * approxChar) + 18;
  return Math.max(MSA_IMAGE_MIN_LABEL_WIDTH, Math.min(MSA_IMAGE_MAX_LABEL_WIDTH, raw));
}

/**
 * Pixel geometry for an exported alignment image. Resolves the column window
 * from `scope` (the visible [start, end) range for 'view', the whole alignment
 * for 'all'), caps the drawn cell count, then scales the cell size down to fit
 * within the pixel budget rather than clipping — so a wide alignment renders as
 * a birdseye mosaic with every column visible. `drawLetters` follows the final
 * (possibly scaled) cell width, matching the viewer's blocks threshold, and
 * `clamped` reports whether any budget forced a shrink.
 */
export function computeAlignmentImageLayout(
  alignment: AlignmentImageSource,
  options: AlignmentImageLayoutOptions,
): AlignmentImageLayout {
  const rowCount = alignment.rows.length;
  const alignmentLength = Math.max(0, Math.floor(alignment.alignmentLength));
  const maxWidth = Math.max(200, options.maxWidth ?? MSA_IMAGE_MAX_WIDTH);
  const maxHeight = Math.max(200, options.maxHeight ?? MSA_IMAGE_MAX_HEIGHT);
  const maxCells = Math.max(1, Math.floor(options.maxCells ?? MSA_IMAGE_MAX_CELLS));

  // Resolve the column window.
  let startColumn = 0;
  let columnCount = alignmentLength;
  if (options.scope === 'view') {
    const rawStart = Math.floor(options.startColumn ?? 0);
    const rawEnd = Math.ceil(options.endColumn ?? alignmentLength);
    const start = Math.max(0, Math.min(alignmentLength, rawStart));
    const end = Math.max(start, Math.min(alignmentLength, rawEnd));
    startColumn = start;
    columnCount = end - start;
    // A degenerate/empty window falls back to the whole alignment.
    if (columnCount <= 0) { startColumn = 0; columnCount = alignmentLength; }
  }
  columnCount = Math.max(0, columnCount);

  let clamped = false;

  // Cell-count cap: draw a leading window rather than an unbounded image.
  if (rowCount > 0 && columnCount * rowCount > maxCells) {
    columnCount = Math.max(1, Math.floor(maxCells / rowCount));
    clamped = true;
  }

  let cellWidth = Math.max(0.5, options.cellWidth ?? MSA_IMAGE_DEFAULT_CELL_WIDTH);
  let cellHeight = Math.max(1, options.cellHeight ?? MSA_IMAGE_DEFAULT_CELL_HEIGHT);
  const baseFont = Math.max(6, Math.floor(options.fontSize ?? MSA_IMAGE_DEFAULT_FONT_SIZE));
  let labelWidth = Math.round(options.labelWidth ?? imageLabelWidth(alignment.rows, baseFont));
  labelWidth = Math.max(1, Math.min(labelWidth, Math.floor(maxWidth * 0.5)));

  const titleHeight = Math.round(baseFont * 1.7) + 10;
  const axisHeight = Math.round(baseFont) + 8;
  const headerHeight = titleHeight + axisHeight;

  // Scale cells down to fit the pixel budget (never clip; birdseye when tiny).
  const idealSequenceWidth = columnCount * cellWidth;
  if (idealSequenceWidth > 0 && labelWidth + idealSequenceWidth > maxWidth) {
    cellWidth = Math.max(0.2, (maxWidth - labelWidth) / columnCount);
    clamped = true;
  }
  const idealRowsHeight = rowCount * cellHeight;
  if (idealRowsHeight > 0 && headerHeight + idealRowsHeight > maxHeight) {
    cellHeight = Math.max(1, (maxHeight - headerHeight) / rowCount);
    clamped = true;
  }

  const drawLetters = cellWidth >= MSA_IMAGE_LETTER_MIN;
  const fontSize = drawLetters
    ? Math.max(6, Math.min(baseFont, Math.floor(cellWidth * 1.35), Math.max(6, Math.floor(cellHeight * 0.78))))
    : 0;

  const contentWidth = labelWidth + columnCount * cellWidth;
  const contentHeight = headerHeight + rowCount * cellHeight;
  const width = Math.max(1, Math.min(maxWidth, Math.ceil(contentWidth)));
  const height = Math.max(1, Math.min(maxHeight, Math.ceil(contentHeight)));

  return {
    scope: options.scope,
    startColumn,
    columnCount,
    rowCount,
    cellWidth,
    cellHeight,
    fontSize,
    drawLetters,
    labelWidth,
    titleHeight,
    axisHeight,
    headerHeight,
    width,
    height,
    contentWidth,
    contentHeight,
    clamped,
  };
}

type ImageFill = { hex: string; pct: number };

// Base hex + mix percent for each residue colour-key token, mirroring the fills
// in claude-science-msa.css: color-mix(in srgb, HEX P%, var(--bg-primary)).
const MSA_IMAGE_COLOR_KEY_FILL: Record<string, ImageFill> = {
  'nt-a': { hex: '#2ea043', pct: 34 },
  'nt-c': { hex: '#4c8dff', pct: 34 },
  'nt-g': { hex: '#f0a020', pct: 36 },
  'nt-t': { hex: '#f0553f', pct: 34 },
  'nt-other': { hex: '#8b93a1', pct: 30 },
  'cl-hydrophobic': { hex: '#5b8def', pct: 34 },
  'cl-positive': { hex: '#e0533f', pct: 34 },
  'cl-negative': { hex: '#b657c4', pct: 34 },
  'cl-polar': { hex: '#3fae6b', pct: 34 },
  'cl-cysteine': { hex: '#e58fa8', pct: 36 },
  'cl-glycine': { hex: '#e08a3c', pct: 36 },
  'cl-proline': { hex: '#cdbb3a', pct: 40 },
  'cl-aromatic': { hex: '#2fb0b8', pct: 34 },
  'cl-other': { hex: '#8b93a1', pct: 26 },
  'hyd-0': { hex: '#4c8dff', pct: 34 },
  'hyd-1': { hex: '#86b6f0', pct: 32 },
  'hyd-2': { hex: '#cfd3da', pct: 28 },
  'hyd-3': { hex: '#f0a86a', pct: 34 },
  'hyd-4': { hex: '#f0553f', pct: 36 },
};

// Taylor wheel: per-residue base hex + percent (the data-residue fills in the
// CSS), keyed by uppercase single-letter residue.
const MSA_IMAGE_TAYLOR_FILL: Record<string, ImageFill> = {
  A: { hex: '#ccff00', pct: 40 }, R: { hex: '#0000ff', pct: 34 }, N: { hex: '#cc00ff', pct: 34 },
  D: { hex: '#ff0000', pct: 34 }, C: { hex: '#ffff00', pct: 40 }, Q: { hex: '#ff00cc', pct: 34 },
  E: { hex: '#ff0066', pct: 34 }, G: { hex: '#ff9900', pct: 38 }, H: { hex: '#0066ff', pct: 34 },
  I: { hex: '#66ff00', pct: 40 }, L: { hex: '#33ff00', pct: 40 }, K: { hex: '#6600ff', pct: 34 },
  M: { hex: '#00ff00', pct: 40 }, F: { hex: '#00ff66', pct: 40 }, P: { hex: '#ffcc00', pct: 40 },
  S: { hex: '#ff3300', pct: 36 }, T: { hex: '#ff6600', pct: 38 }, W: { hex: '#00ccff', pct: 36 },
  Y: { hex: '#00ffcc', pct: 40 }, V: { hex: '#99ff00', pct: 40 },
};

function parseHexColor(hex: string): { r: number; g: number; b: number } {
  let value = hex.trim().replace(/^#/, '');
  if (value.length === 3) value = value.split('').map((channel) => channel + channel).join('');
  const int = Number.parseInt(value, 16);
  if (value.length !== 6 || Number.isNaN(int)) return { r: 0, g: 0, b: 0 };
  return { r: (int >> 16) & 0xff, g: (int >> 8) & 0xff, b: int & 0xff };
}

function toHexChannel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

/**
 * Replicate CSS `color-mix(in srgb, hex pct%, background)`: a per-channel linear
 * blend in gamma-encoded sRGB (no linearisation), matching how the viewer's
 * residue fills mix a base colour toward --bg-primary. Returns `#rrggbb`.
 */
export function mixSrgb(hex: string, pct: number, backgroundHex: string): string {
  const weight = Math.max(0, Math.min(1, pct / 100));
  const color = parseHexColor(hex);
  const bg = parseHexColor(backgroundHex);
  return `#${toHexChannel(color.r * weight + bg.r * (1 - weight))}`
    + `${toHexChannel(color.g * weight + bg.g * (1 - weight))}`
    + `${toHexChannel(color.b * weight + bg.b * (1 - weight))}`;
}

/**
 * Final sRGB fill for a residue cell in an exported image, mirroring the CSS
 * scheme fills against an explicit (deterministic) export background. Returns
 * null when the residue has no fill (a gap, '?', '.', or a residue the active
 * scheme leaves uncoloured) so the caller can leave the cell as background.
 * 'auto' resolves through residueColorKey to the molecule's default scheme.
 */
export function resolveResidueCellColor(
  symbol: string,
  molecule: SequenceType,
  scheme: MsaColorScheme,
  backgroundHex: string,
): string | null {
  const token = residueColorKey(symbol, molecule, scheme);
  if (!token) return null;
  if (token === 'taylor') {
    const fill = MSA_IMAGE_TAYLOR_FILL[symbol.toUpperCase()];
    return fill ? mixSrgb(fill.hex, fill.pct, backgroundHex) : null;
  }
  const fill = MSA_IMAGE_COLOR_KEY_FILL[token];
  return fill ? mixSrgb(fill.hex, fill.pct, backgroundHex) : null;
}
