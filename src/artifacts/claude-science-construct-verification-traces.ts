/**
 * Lays a construct-verification run's reads out as an alignment, so a variant
 * row can open Alignment's Traces view at the base it names.
 *
 * The verification engine has already aligned every mapped read to the
 * reference, and its coordinate map records which raw call sits at which
 * reference base. The rows here come from that map instead of a fresh
 * alignment, so the column a variant opens is the column the engine called it
 * at, and the reference row carries the reference's own numbering: the table's
 * "18" is the readout's "Reference position 18".
 *
 * Only reads that cover the variant are laid out, on the part of the reference
 * they span. Each read row holds every one of its calls in reference
 * orientation, which is what lets the trace viewer link it back to its AB1
 * trace. The ends the engine trimmed for low quality are drawn ungapped beside
 * the mapped part. The alignment stops at a circular reference's origin; calls
 * past it are drawn beyond the reference row's end.
 */
import { reverseComplement } from '../bio/reverse-complement';
import type {
  ArtifactConstructAlignmentColumn,
  ArtifactConstructVerificationResult,
} from './claude-science-construct-verification';
import {
  normalizeArtifactAlignment,
  type ArtifactAlignment,
  type ArtifactAlignmentRowInput,
} from './claude-science-msa';
import { sha256HexSync } from './claude-science-sha256';

export type ConstructVerificationTraceVariant = {
  type?: string;
  referenceStart?: number;
  position?: number;
  referencePosition?: number;
  supportingReadIds?: readonly string[];
};

export type ConstructVerificationTraceRecord = {
  id: string;
  name: string;
  /** SHA-256 of the record sequence, kept on the row as its input attestation. */
  sha256: string;
  sangerTrace?: { baseCalls: string };
};

export type ConstructVerificationTraceTarget = {
  alignment: ArtifactAlignment;
  /** 0-based alignment column of the variant: its first reference base, or an insertion's first inserted call. */
  column: number;
  /** The row to show first: a read that carries the variant when one does. */
  rowId: string | null;
};

type VerificationResult = Pick<ArtifactConstructVerificationResult, 'reference' | 'reads' | 'provenance'>;
type VerificationRead = VerificationResult['reads'][number];

type Anchor = {
  /** 0-based reference base the view opens at. */
  position: number;
  /** An insertion opens on its first inserted call, in the slot after `position`. */
  insertion: 'after' | 'before' | null;
};

type Token =
  | { kind: 'base'; v: number; o: number }
  | { kind: 'gap'; v: number }
  | { kind: 'insert'; after: number; o: number };

type ReadLayout = {
  read: VerificationRead;
  record: ConstructVerificationTraceRecord;
  oriented: string;
  tokens: Token[];
};

function modulo(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function variantAnchor(
  variant: ConstructVerificationTraceVariant,
  referenceLength: number,
  circular: boolean,
): Anchor | null {
  const start = variant.referenceStart ?? variant.position ?? variant.referencePosition;
  if (!Number.isFinite(start) || referenceLength <= 0) return null;
  const boundary = Math.trunc(start as number);
  if (variant.type !== 'insertion') {
    return boundary >= 0 && boundary < referenceLength
      ? { position: boundary, insertion: null }
      : null;
  }
  // Boundary b sits between 0-based b - 1 and b ("after b" in 1-based terms).
  if (boundary > 0 && boundary <= referenceLength) return { position: boundary - 1, insertion: 'after' };
  if (boundary === 0) return circular ? { position: referenceLength - 1, insertion: 'after' } : { position: 0, insertion: 'before' };
  return null;
}

function mappedSpan(read: VerificationRead): number {
  const mapping = read.mapping;
  if (!mapping) return 0;
  return Number.isFinite(mapping.referenceSpan) ? mapping.referenceSpan : 0;
}

function readCovers(read: VerificationRead, position: number, referenceLength: number, circular: boolean): boolean {
  if (read.status !== 'mapped' || !read.mapping) return false;
  const offset = circular
    ? modulo(position - read.mapping.referenceStart, referenceLength)
    : position - read.mapping.referenceStart;
  return offset >= 0 && offset < mappedSpan(read);
}

/**
 * Mapped reads that cover a variant's base, the ones that carry the variant
 * first. Cheap enough to decide, per table row, whether there is a trace to open.
 */
export function constructVariantTraceReadIds(
  result: VerificationResult,
  variant: ConstructVerificationTraceVariant,
): string[] {
  const length = result.reference.length;
  const circular = result.reference.topology === 'circular';
  const anchor = variantAnchor(variant, length, circular);
  if (!anchor) return [];
  const covering = result.reads.filter((read) => readCovers(read, anchor.position, length, circular));
  const supporting = new Set(variant.supportingReadIds ?? []);
  return [
    ...covering.filter((read) => supporting.has(read.id)),
    ...covering.filter((read) => !supporting.has(read.id)),
  ].map((read) => read.id);
}

/**
 * One read's calls in order, each placed on a reference coordinate `v` in a
 * frame where the anchor base keeps its own number. A read across a circular
 * origin gets coordinates below 0 or at and past the length on the far side.
 * Returns null when the read's map does not account for every call exactly once.
 */
function readTokens(
  read: VerificationRead,
  record: ConstructVerificationTraceRecord,
  anchor: number,
  referenceLength: number,
  circular: boolean,
): ReadLayout | null {
  const mapping = read.mapping;
  const baseCalls = record.sangerTrace?.baseCalls ?? '';
  const count = baseCalls.length;
  if (!mapping || count === 0 || count !== read.rawLength) return null;
  const columns: readonly ArtifactConstructAlignmentColumn[] = mapping.coordinateMap?.columns ?? [];
  const firstReference = columns.find((column) => column.referencePosition !== null);
  if (!firstReference || firstReference.referencePosition === null) return null;
  const span = columns.filter((column) => column.referencePosition !== null).length;
  const offset = circular
    ? modulo(anchor - firstReference.referencePosition, referenceLength)
    : anchor - firstReference.referencePosition;
  if (offset < 0 || offset >= span) return null;
  const forward = mapping.orientation === 'forward';
  const oriented = (forward ? baseCalls : reverseComplement(baseCalls)).toUpperCase();
  const orientedIndex = (rawIndex: number | null): number | null => (
    rawIndex === null || !Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex >= count
      ? null
      : forward ? rawIndex : count - 1 - rawIndex
  );

  const firstV = anchor - offset;
  const mapped: Token[] = [];
  let v = firstV - 1;
  for (const column of columns) {
    if (column.operation === 'insertion') {
      const o = orientedIndex(column.rawCallIndex);
      if (o === null) return null;
      mapped.push({ kind: 'insert', after: v, o });
      continue;
    }
    v += 1;
    const expected = circular ? modulo(v, referenceLength) : v;
    if (column.referencePosition !== expected) return null;
    if (column.operation === 'deletion') {
      mapped.push({ kind: 'gap', v });
      continue;
    }
    const o = orientedIndex(column.rawCallIndex);
    if (o === null) return null;
    mapped.push({ kind: 'base', v, o });
  }
  const lastV = v;
  const calls = mapped.flatMap((token) => (token.kind === 'gap' ? [] : [token.o]));
  if (!calls.length || calls.some((o, index) => o !== calls[0] + index)) return null;
  const firstCall = calls[0];
  const lastCall = calls[calls.length - 1];
  const leading: Token[] = Array.from({ length: firstCall }, (_, o) => ({ kind: 'base', v: firstV - firstCall + o, o }));
  const trailing: Token[] = Array.from({ length: count - 1 - lastCall }, (_, index) => ({
    kind: 'base',
    v: lastV + 1 + index,
    o: lastCall + 1 + index,
  }));
  return { read, record, oriented, tokens: [...leading, ...mapped, ...trailing] };
}

function safeRowName(name: string, fallback: string, used: Set<string>): string {
  // FASTA-style headers: no line breaks, control characters or ">".
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f\u2028\u2029>]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || fallback;
  let candidate = clean;
  for (let index = 2; used.has(candidate.toLocaleLowerCase()); index += 1) candidate = `${clean} (${index})`;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}

/**
 * Builds the alignment a variant row opens, or null when no mapped read with a
 * usable trace covers the variant. The id is a digest of the rows, so opening
 * another variant covered by the same reads names the same alignment.
 */
export function constructVerificationTraceTarget({
  result,
  variant,
  reference,
  records,
}: {
  result: VerificationResult;
  variant: ConstructVerificationTraceVariant;
  reference: ConstructVerificationTraceRecord;
  records: ReadonlyMap<string, ConstructVerificationTraceRecord>;
}): ConstructVerificationTraceTarget | null {
  // The bases the engine mapped against, so every coordinate below agrees with its map.
  const referenceSequence = result.reference.sequence.toUpperCase();
  const length = referenceSequence.length;
  const circular = result.reference.topology === 'circular';
  if (length === 0 || length !== result.reference.length || reference.id !== result.reference.id) return null;
  const anchor = variantAnchor(variant, length, circular);
  if (!anchor) return null;
  const readsById = new Map(result.reads.map((read) => [read.id, read]));
  const layouts = constructVariantTraceReadIds(result, variant).flatMap((readId) => {
    const read = readsById.get(readId);
    const record = records.get(readId);
    const layout = read && record ? readTokens(read, record, anchor.position, length, circular) : null;
    return layout ? [layout] : [];
  });
  if (!layouts.length) return null;

  const coordinates = layouts.flatMap((layout) => layout.tokens.flatMap((token) => (token.kind === 'insert' ? [] : [token.v])));
  const sliceStart = Math.max(0, Math.min(...coordinates));
  const sliceEnd = Math.min(length - 1, Math.max(...coordinates));
  const leadSlot = sliceStart - 1;
  // Per read: the call (or gap) on each reference base, and the calls in the
  // slot after each base. Calls outside the slice go to the slot at its edge.
  const cellsByRead = layouts.map((layout) => {
    const cells = new Map<number, string>();
    const slots = new Map<number, string>();
    const push = (slot: number, symbol: string) => slots.set(slot, (slots.get(slot) ?? '') + symbol);
    for (const token of layout.tokens) {
      if (token.kind === 'insert') {
        push(Math.max(leadSlot, Math.min(sliceEnd, token.after)), layout.oriented[token.o]);
      } else if (token.v < sliceStart || token.v > sliceEnd) {
        if (token.kind === 'base') push(token.v < sliceStart ? leadSlot : sliceEnd, layout.oriented[token.o]);
      } else {
        cells.set(token.v, token.kind === 'base' ? layout.oriented[token.o] : '-');
      }
    }
    return { cells, slots };
  });
  const slotWidth = new Map<number, number>();
  for (const { slots } of cellsByRead) {
    for (const [slot, symbols] of slots) slotWidth.set(slot, Math.max(slotWidth.get(slot) ?? 0, symbols.length));
  }
  const widthAt = (slot: number) => slotWidth.get(slot) ?? 0;

  let referenceRow = '-'.repeat(widthAt(leadSlot));
  for (let v = sliceStart; v <= sliceEnd; v += 1) referenceRow += referenceSequence[v] + '-'.repeat(widthAt(v));
  const readRows = cellsByRead.map(({ cells, slots }) => {
    // The slot before the first base holds calls that run up to it, so they
    // sit against it; every other slot starts right after its base.
    let row = (slots.get(leadSlot) ?? '').padStart(widthAt(leadSlot), '-');
    for (let v = sliceStart; v <= sliceEnd; v += 1) row += (cells.get(v) ?? '-') + (slots.get(v) ?? '').padEnd(widthAt(v), '-');
    return row;
  });

  let column = widthAt(leadSlot);
  for (let v = sliceStart; v < anchor.position; v += 1) column += 1 + widthAt(v);
  if (anchor.insertion === 'after' && widthAt(anchor.position) > 0) column += 1;
  else if (anchor.insertion === 'before' && widthAt(leadSlot) > 0) column -= 1;

  const usedNames = new Set<string>();
  const rows: ArtifactAlignmentRowInput[] = [{
    id: 'reference',
    name: safeRowName(reference.name, 'Reference', usedNames),
    aligned: referenceRow,
    sourceRecordId: reference.id,
    inputSha256: reference.sha256,
  }];
  const rowIdByReadId = new Map<string, string>();
  layouts.forEach((layout, index) => {
    // A row that no longer spells its read cannot link to the trace; leave it out.
    if (readRows[index].replace(/-/g, '') !== layout.oriented) return;
    const id = `read-${rows.length}`;
    rowIdByReadId.set(layout.read.id, id);
    rows.push({
      id,
      name: safeRowName(layout.record.name, `Read ${rows.length}`, usedNames),
      aligned: readRows[index],
      sourceRecordId: layout.record.id,
      inputSha256: layout.record.sha256,
    });
  });
  if (rows.length < 2) return null;

  const first = sliceStart + 1;
  const last = sliceEnd + 1;
  const referenceName = rows[0].name as string;
  const digest = sha256HexSync(JSON.stringify([reference.id, first, rows.map((row) => [row.sourceRecordId, row.aligned])])).slice(0, 16);
  const engine = result.provenance?.engine
    ? `${result.provenance.engine}${result.provenance.engineVersion ? ` ${result.provenance.engineVersion}` : ''}`
    : 'Construct verification';
  const alignment = normalizeArtifactAlignment({
    id: `verification-reads-${digest}`,
    name: `${referenceName} ${first.toLocaleString()}–${last.toLocaleString()} · verification reads`,
    molecule: 'dna',
    referenceRowId: 'reference',
    referenceNumbering: { rowId: 'reference', firstResiduePosition: first },
    rows,
    engine: { id: 'motif-construct-verification', label: 'Construct verification read map', mode: 'browser', usedFallback: false },
    comparison: {
      route: 'browser',
      method: 'reference-anchored',
      algorithm: engine,
      fallback: false,
      warnings: [],
      ambiguityCount: 0,
    },
    createdAt: new Date().toISOString(),
    note: `Reads placed where construct verification mapped them on ${referenceName}, bases ${first.toLocaleString()}–${last.toLocaleString()}. The ends it trimmed for low quality are drawn ungapped beside the mapped part.`,
  });
  const focusReadId = (variant.supportingReadIds ?? []).find((readId) => rowIdByReadId.has(readId))
    ?? layouts.find((layout) => rowIdByReadId.has(layout.read.id))?.read.id;
  return {
    alignment,
    column: Math.max(0, Math.min(alignment.alignmentLength - 1, column)),
    rowId: focusReadId ? rowIdByReadId.get(focusReadId) ?? null : null,
  };
}
