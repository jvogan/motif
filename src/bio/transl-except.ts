import { resolveTranslationTable } from './codon-tables';
import {
  extractFeatureSequence,
  featureLocationSegments,
  type FeatureCoordinateMapSpan,
  type FeatureLocation,
} from './feature-location';
import { translateCompleteCds } from './translate';
import type { CodonTable } from './types';

export type TranslationExceptionAminoAcid = 'Sec' | 'Pyl' | 'TERM';

export type TranslationExceptionDiagnosticCode =
  | 'missing_qualifier'
  | 'malformed'
  | 'unsupported_amino_acid'
  | 'remote_location'
  | 'ambiguous_location'
  | 'invalid_feature_location'
  | 'invalid_codon_start'
  | 'invalid_cds_frame'
  | 'orientation_mismatch'
  | 'out_of_bounds'
  | 'not_codon'
  | 'duplicate_exception';

export interface TranslationExceptionDiagnostic {
  code: TranslationExceptionDiagnosticCode;
  message: string;
  rawQualifier?: string;
  offset?: number;
  character?: string;
}

export interface TranslationException {
  raw: string;
  aminoAcid: TranslationExceptionAminoAcid;
  /** INSDC coordinates, 1-based inclusive. */
  start: number;
  end: number;
  complement: boolean;
  /** Zero-based offset in the materialized biological feature sequence. */
  featureOffset: number;
  codonIndex: number;
  residue: 'U' | 'O' | '*';
}

export interface TranslationExceptionReceipt {
  rawQualifier: string;
  parsed: TranslationException[];
  applied: TranslationException[];
  sourceProtein: string;
  materializedProtein: string;
  expectedProtein: string | null;
  proteinIdentity: boolean | null;
  translationTableId: number;
  codonStart: 1 | 2 | 3;
  limitations: string[];
}

export type MaterializeTranslationExceptionsResult =
  | {
      ok: true;
      sequence: string;
      sourceProtein: string;
      materializedProtein: string;
      exceptions: TranslationException[];
      receipt: TranslationExceptionReceipt;
      diagnostics: TranslationExceptionDiagnostic[];
    }
  | {
      ok: false;
      sequence: string;
      sourceProtein: string | null;
      materializedProtein: null;
      exceptions: TranslationException[];
      receipt: null;
      diagnostics: TranslationExceptionDiagnostic[];
    };

export interface MaterializeTranslationExceptionsOptions {
  sequence: string;
  feature: FeatureLocation;
  qualifier: unknown;
  codonStart?: unknown;
  translationTableId?: unknown;
  expectedProtein?: unknown;
}

function diagnostic(
  code: TranslationExceptionDiagnosticCode,
  message: string,
  rawQualifier?: string,
): TranslationExceptionDiagnostic {
  return { code, message, ...(rawQualifier === undefined ? {} : { rawQualifier }) };
}

function rawQualifierString(value: unknown): string | null {
  const raw = typeof value === 'string'
    ? value
    : Array.isArray(value) && value.every((entry) => typeof entry === 'string')
      ? value.join('')
      : null;
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseAminoAcid(value: string): TranslationExceptionAminoAcid | null {
  const normalized = value.trim();
  return normalized === 'Sec' || normalized === 'Pyl' || normalized === 'TERM' ? normalized : null;
}

function residueForAminoAcid(aminoAcid: TranslationExceptionAminoAcid): 'U' | 'O' | '*' {
  return aminoAcid === 'Sec' ? 'U' : aminoAcid === 'Pyl' ? 'O' : '*';
}

function balancedGroups(raw: string): { groups: Array<{ text: string; start: number; end: number }>; error?: number } {
  const groups: Array<{ text: string; start: number; end: number }> = [];
  let depth = 0;
  let groupStart = -1;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '(') {
      if (depth === 0) groupStart = index;
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth < 0) return { groups, error: index };
      if (depth === 0 && groupStart >= 0) {
        groups.push({ text: raw.slice(groupStart + 1, index), start: groupStart, end: index + 1 });
        groupStart = -1;
      }
    }
  }
  return depth === 0 ? { groups } : { groups, error: groupStart >= 0 ? groupStart : raw.length };
}

/**
 * The entries of a /transl_except value, one per recoded codon. INSDC writes
 * one qualifier per entry and the GenBank reader joins repeats into one value
 * ("(pos:6..8,aa:Sec),(pos:12..14,aa:Sec)"), so a writer splits it back into
 * one qualifier each. A value that is not a clean list of two or more
 * parenthesized entries comes back whole.
 */
export function translationExceptionEntries(value: string): string[] {
  const { groups, error } = balancedGroups(value);
  if (error !== undefined || groups.length < 2) return [value];
  const outside = groups.map((group, index) => value.slice(index === 0 ? 0 : groups[index - 1].end, group.start)).join('')
    + value.slice(groups[groups.length - 1].end);
  return /^[\s,]*$/.test(outside) ? groups.map((group) => value.slice(group.start, group.end)) : [value];
}

function parseLocation(
  value: string,
  rawQualifier: string,
): { start: number; end: number; complement: boolean } | TranslationExceptionDiagnostic {
  let location = value.trim();
  let complement = false;
  if (location.startsWith('complement(') && location.endsWith(')')) {
    complement = true;
    location = location.slice('complement('.length, -1).trim();
  }
  if (location.includes(':')) {
    return diagnostic('remote_location', 'Remote accession transl_except locations are not materialized without the referenced sequence.', rawQualifier);
  }
  if (/[<>]|\b(?:join|order|one-of)\b|[(),]/i.test(location)) {
    return diagnostic('ambiguous_location', 'Only one local three-base transl_except interval is materialized; fuzzy, joined, ordered, and one-of locations are rejected.', rawQualifier);
  }
  const match = /^(\d+)(?:\.\.(\d+))?$/.exec(location);
  if (!match) return diagnostic('malformed', `Malformed transl_except position "${value}".`, rawQualifier);
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    return diagnostic('malformed', `Invalid transl_except position "${value}".`, rawQualifier);
  }
  if (end - start + 1 !== 3) {
    return diagnostic('not_codon', 'A supported transl_except location must cover exactly one codon (three bases).', rawQualifier);
  }
  return { start, end, complement };
}

function parseQualifier(rawQualifier: string): {
  exceptions: TranslationException[];
  diagnostics: TranslationExceptionDiagnostic[];
} {
  const groups = balancedGroups(rawQualifier);
  if (groups.error !== undefined) {
    return { exceptions: [], diagnostics: [diagnostic('malformed', 'Unbalanced transl_except parentheses.', rawQualifier)] };
  }
  const outside = groups.groups.reduce((parts, group, index) => {
    const previousEnd = index === 0 ? 0 : groups.groups[index - 1].end;
    parts.push(rawQualifier.slice(previousEnd, group.start));
    if (index === groups.groups.length - 1) parts.push(rawQualifier.slice(group.end));
    return parts;
  }, [] as string[]).join('');
  if (groups.groups.length === 0 || outside.replace(/[\s,]/g, '') !== '') {
    return { exceptions: [], diagnostics: [diagnostic('malformed', 'transl_except must contain one or more parenthesized pos/aa entries.', rawQualifier)] };
  }
  const exceptions: TranslationException[] = [];
  const diagnostics: TranslationExceptionDiagnostic[] = [];
  for (const group of groups.groups) {
    const match = /^\s*pos\s*:\s*(.+?)\s*,\s*aa\s*:\s*([^,\s]+)\s*$/i.exec(group.text);
    if (!match) {
      diagnostics.push(diagnostic('malformed', `Malformed transl_except entry "${group.text}".`, rawQualifier));
      continue;
    }
    const location = parseLocation(match[1], rawQualifier);
    if ('code' in location) {
      diagnostics.push(location);
      continue;
    }
    const aminoAcid = parseAminoAcid(match[2]);
    if (!aminoAcid) {
      diagnostics.push(diagnostic('unsupported_amino_acid', `Unsupported transl_except amino-acid code "${match[2]}"; supported codes are Sec, Pyl, and TERM.`, rawQualifier));
      continue;
    }
    exceptions.push({
      raw: group.text,
      aminoAcid,
      start: location.start,
      end: location.end,
      complement: location.complement,
      featureOffset: -1,
      codonIndex: -1,
      residue: residueForAminoAcid(aminoAcid),
    });
  }
  return { exceptions, diagnostics };
}

function sourceCoordinateOrder(feature: FeatureLocation, sequenceLength: number): number[] | null {
  if (feature.strand !== 1 && feature.strand !== -1) return null;
  const segments = featureLocationSegments(feature);
  if (segments.length === 0) return null;
  const coordinates: number[] = [];
  const seen = new Set<number>();
  for (const segment of segments) {
    if (segment.start < 0 || segment.end > sequenceLength || segment.end <= segment.start || segment.strand !== feature.strand) return null;
    const part = segment.strand === 1
      ? Array.from({ length: segment.end - segment.start }, (_, offset) => segment.start + offset)
      : Array.from({ length: segment.end - segment.start }, (_, offset) => segment.end - 1 - offset);
    for (const coordinate of part) {
      if (seen.has(coordinate)) return null;
      seen.add(coordinate);
      coordinates.push(coordinate);
    }
  }
  return coordinates;
}

/**
 * `complement(...)` in a transl_except location describes the orientation of
 * the biological CDS location, not merely a convenient way to spell genomic
 * coordinates. Mixed or directionless feature pieces therefore have no
 * single orientation to validate against and are rejected by the location
 * check above.
 */
function featureBiologicalStrand(feature: FeatureLocation): 1 | -1 | null {
  if (feature.strand !== 1 && feature.strand !== -1) return null;
  const segments = featureLocationSegments(feature);
  if (segments.length === 0 || segments.some((segment) => segment.strand !== feature.strand)) return null;
  return feature.strand;
}

function parseCodonStart(value: unknown): 1 | 2 | 3 | null {
  const number = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  return number === 1 || number === 2 || number === 3 ? number : null;
}

function tableFor(value: unknown): { id: number; table: CodonTable } | null {
  const id = value === undefined || value === null || value === '' ? 1 : Number(value);
  if (!Number.isSafeInteger(id)) return null;
  const resolved = resolveTranslationTable(id);
  return resolved.supported ? { id: resolved.id, table: resolved.table } : null;
}

/**
 * Materialize only local, unambiguous INSDC transl_except entries. The base
 * CDS is translated strictly first; exceptions then replace a residue and are
 * recorded in a receipt suitable for export/audit surfaces.
 */
export function materializeTranslationExceptions(
  options: MaterializeTranslationExceptionsOptions,
): MaterializeTranslationExceptionsResult {
  const rawQualifier = rawQualifierString(options.qualifier);
  if (!rawQualifier) {
    return {
      ok: false,
      sequence: '',
      sourceProtein: null,
      materializedProtein: null,
      exceptions: [],
      receipt: null,
      diagnostics: [diagnostic('missing_qualifier', 'A transl_except qualifier is required.')],
    };
  }
  const parsed = parseQualifier(rawQualifier);
  if (parsed.diagnostics.length > 0) {
    return { ok: false, sequence: '', sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: parsed.diagnostics };
  }
  const codonStart = parseCodonStart(options.codonStart ?? options.feature.metadata?.codon_start ?? options.feature.metadata?.codonStart ?? 1);
  if (codonStart === null) {
    return { ok: false, sequence: '', sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: [diagnostic('invalid_codon_start', 'transl_except materialization requires codon_start 1, 2, or 3.', rawQualifier)] };
  }
  const table = tableFor(options.translationTableId ?? options.feature.metadata?.transl_table ?? options.feature.metadata?.translTable ?? 1);
  if (!table) {
    return { ok: false, sequence: '', sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: [diagnostic('malformed', 'transl_except materialization requires a supported NCBI translation table.', rawQualifier)] };
  }
  const coordinates = sourceCoordinateOrder(options.feature, options.sequence.length);
  if (!coordinates) {
    return { ok: false, sequence: '', sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: [diagnostic('invalid_feature_location', 'The CDS location is not a bounded, oriented, non-overlapping local feature.', rawQualifier)] };
  }
  const biologicalStrand = featureBiologicalStrand(options.feature);
  if (biologicalStrand === null) {
    return { ok: false, sequence: '', sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: [diagnostic('invalid_feature_location', 'The CDS location does not have one consistent biological strand for transl_except validation.', rawQualifier)] };
  }
  const orientationDiagnostics = parsed.exceptions
    .filter((exception) => exception.complement !== (biologicalStrand === -1))
    .map((exception) => diagnostic(
      'orientation_mismatch',
      `transl_except ${exception.start}..${exception.end} uses ${exception.complement ? 'complement' : 'forward'} orientation, but the CDS is on the ${biologicalStrand === -1 ? 'reverse' : 'forward'} strand.`,
      rawQualifier,
    ));
  if (orientationDiagnostics.length > 0) {
    return { ok: false, sequence: '', sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: orientationDiagnostics };
  }
  const sequence = extractFeatureSequence(options.sequence, options.feature, 'dna');
  const frame = codonStart - 1;
  if (sequence.length <= frame || (sequence.length - frame) % 3 !== 0) {
    return { ok: false, sequence, sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: [diagnostic('invalid_cds_frame', 'The CDS sequence after codon_start is not a complete number of codons.', rawQualifier)] };
  }
  if (!/^[ACGTU]+$/i.test(sequence)) {
    return { ok: false, sequence, sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: [diagnostic('invalid_cds_frame', 'The CDS contains ambiguous or non-DNA bases; transl_except requires strict base translation.', rawQualifier)] };
  }
  let sourceProtein: string;
  try {
    sourceProtein = translateCompleteCds(sequence, frame as 0 | 1 | 2, table.table);
  } catch {
    return { ok: false, sequence, sourceProtein: null, materializedProtein: null, exceptions: parsed.exceptions, receipt: null, diagnostics: [diagnostic('invalid_cds_frame', 'The CDS contains invalid or ambiguous bases that cannot be strictly translated for transl_except.', rawQualifier)] };
  }
  const indexByCoordinate = new Map(coordinates.map((coordinate, index) => [coordinate + 1, index]));
  const applied = parsed.exceptions.map((exception) => {
    const offsets = Array.from({ length: 3 }, (_, index) => indexByCoordinate.get(exception.start + index));
    if (offsets.some((offset) => offset === undefined)) return { ...exception, featureOffset: -1, codonIndex: -1 };
    const featureOffset = Math.min(...offsets as number[]);
    return { ...exception, featureOffset, codonIndex: Math.floor((featureOffset - frame) / 3) };
  });
  const diagnostics: TranslationExceptionDiagnostic[] = [];
  const seenCodons = new Map<number, TranslationException>();
  for (const exception of applied) {
    if (exception.featureOffset < frame || exception.codonIndex < 0 || (exception.featureOffset - frame) % 3 !== 0) {
      diagnostics.push(diagnostic('not_codon', `transl_except ${exception.start}..${exception.end} is not aligned to codon_start ${codonStart}.`, rawQualifier));
      continue;
    }
    if (exception.codonIndex >= sourceProtein.length) {
      diagnostics.push(diagnostic('out_of_bounds', `transl_except ${exception.start}..${exception.end} lies outside the translated CDS.`, rawQualifier));
      continue;
    }
    const previous = seenCodons.get(exception.codonIndex);
    if (previous && previous.residue !== exception.residue) {
      diagnostics.push(diagnostic('duplicate_exception', 'Multiple transl_except entries target the same codon with different amino acids.', rawQualifier));
      continue;
    }
    seenCodons.set(exception.codonIndex, exception);
  }
  if (diagnostics.length > 0) return { ok: false, sequence, sourceProtein, materializedProtein: null, exceptions: applied, receipt: null, diagnostics };
  let materializedProtein = sourceProtein;
  for (const exception of applied) {
    materializedProtein = `${materializedProtein.slice(0, exception.codonIndex)}${exception.residue}${materializedProtein.slice(exception.codonIndex + 1)}`;
  }
  const expectedProtein = typeof options.expectedProtein === 'string' && options.expectedProtein.trim()
    ? options.expectedProtein.replace(/\s+/g, '')
    : null;
  const receipt: TranslationExceptionReceipt = {
    rawQualifier,
    parsed: applied,
    applied,
    sourceProtein,
    materializedProtein,
    expectedProtein,
    proteinIdentity: expectedProtein === null ? null : expectedProtein === materializedProtein,
    translationTableId: table.id,
    codonStart,
    limitations: ['Only local, exact three-base pos locations are materialized.', 'Remote, fuzzy, joined, ordered, and context-dependent exceptions are rejected.'],
  };
  return { ok: true, sequence, sourceProtein, materializedProtein, exceptions: applied, receipt, diagnostics: [] };
}

/**
 * Qualifiers whose value names bases of the record by absolute position:
 * /transl_except and /anticodon hold `(pos:<location>,…)` entries, and
 * /rpt_unit_range and /tag_peptide hold a bare base range. Motif keeps every
 * imported qualifier, both as metadata and in the ordered `motifQualifiers`
 * list that GenBank export replays, so each copy has to move with its feature.
 */
const ENTRY_POSITION_QUALIFIERS = new Set(['transl_except', 'translexcept', 'anticodon']);
const RANGE_POSITION_QUALIFIERS = new Set(['rpt_unit_range', 'tag_peptide']);

export interface QualifierBaseMap {
  /** Where a zero-based source base lands, or null when that base is not carried. */
  base: (index: number) => number | null;
  /** The destination holds the source bases reverse-complemented. */
  flipped?: boolean;
}

/**
 * The base map for a product built from ordered source→destination spans, such
 * as a digest fragment or a PCR product: a base moves with the span holding it.
 */
export function qualifierMapForSpans(spans: readonly FeatureCoordinateMapSpan[]): QualifierBaseMap {
  return {
    base: (index) => {
      const span = spans.find((candidate) => index >= candidate.start && index < candidate.end);
      return span ? span.targetStart + index - span.start : null;
    },
  };
}

/**
 * The base map for a new record holding a feature's own bases, read 5′→3′ as
 * `extractFeatureSequence` reads them, and optionally reverse-complemented
 * after that. A feature whose pieces lie on both strands has no single
 * orientation, so every position in it is dropped.
 */
export function qualifierMapForFeatureSequence(feature: FeatureLocation, reverseComplemented = false): QualifierBaseMap {
  const segments = featureLocationSegments(feature);
  const reverse = segments.length > 0 && segments.every((segment) => segment.strand === -1);
  if (!reverse && segments.some((segment) => segment.strand === -1)) return { base: () => null };
  const length = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  return {
    base: (index) => {
      let offset = 0;
      for (const segment of segments) {
        if (index >= segment.start && index < segment.end) {
          const at = offset + (reverse ? segment.end - 1 - index : index - segment.start);
          return reverseComplemented ? length - 1 - at : at;
        }
        offset += segment.end - segment.start;
      }
      return null;
    },
    flipped: reverse !== reverseComplemented,
  };
}

function remapLocalLocation(location: string, map: QualifierBaseMap, stranded: boolean): string | null {
  let text = location.trim();
  const complemented = /^complement\((.*)\)$/i.exec(text);
  if (complemented && !stranded) return null;
  if (complemented) text = complemented[1].trim();
  const joined = /^join\((.*)\)$/i.exec(text);
  const pieces: Array<[number, number]> = [];
  for (const piece of (joined ? joined[1] : text).split(',')) {
    // A fuzzy, remote, between-base, ordered or nested piece names bases this
    // map cannot vouch for, so the whole location is refused.
    const match = /^\s*(\d+)(?:\.\.(\d+))?\s*$/.exec(piece);
    if (!match) return null;
    const start = Number(match[1]) - 1;
    const end = Number(match[2] ?? match[1]) - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) return null;
    const from = map.base(start);
    const to = map.base(end);
    if (from === null || to === null || Math.abs(to - from) !== end - start) return null;
    // Every base between the ends must move with them too: an edit to the
    // middle base of a codon keeps both ends in place.
    const step = to < from ? -1 : 1;
    for (let index = start + 1; index < end; index += 1) {
      if (map.base(index) !== from + step * (index - start)) return null;
    }
    pieces.push([Math.min(from, to) + 1, Math.max(from, to) + 1]);
  }
  // Mirrored pieces come out in descending order; INSDC lists them ascending
  // inside complement(join(…)), so reversing them keeps biological order.
  if (map.flipped) pieces.reverse();
  // Pieces that now abut, such as a codon split by an intron and then read
  // from the spliced CDS, become one range.
  for (let index = pieces.length - 1; index > 0; index -= 1) {
    if (pieces[index][0] === pieces[index - 1][1] + 1) {
      pieces[index - 1] = [pieces[index - 1][0], pieces[index][1]];
      pieces.splice(index, 1);
    }
  }
  const body = pieces.map(([start, end]) => (start === end ? String(start) : `${start}..${end}`)).join(',');
  const range = pieces.length > 1 ? `join(${body})` : body;
  return stranded && Boolean(complemented) !== Boolean(map.flipped) ? `complement(${range})` : range;
}

function remapEntryQualifier(value: string, map: QualifierBaseMap): string | null {
  const { groups, error } = balancedGroups(value);
  if (error !== undefined || groups.length === 0) return null;
  let kept = '';
  for (const [index, group] of groups.entries()) {
    const head = /^\s*pos\s*:\s*/i.exec(group.text);
    if (!head) continue;
    // The location runs to the first comma outside its own parentheses.
    let depth = 0;
    let stop = head[0].length;
    for (; stop < group.text.length; stop += 1) {
      const character = group.text[stop];
      if (character === '(') depth += 1;
      else if (character === ')') depth -= 1;
      else if (character === ',' && depth === 0) break;
    }
    const location = remapLocalLocation(group.text.slice(head[0].length, stop), map, true);
    if (location === null) continue;
    // Keep each entry's own separator, whether "," or nothing at all.
    const separator = kept ? value.slice(groups[index - 1].end, group.start) : '';
    kept += `${separator}(${head[0]}${location}${group.text.slice(stop)})`;
  }
  return kept || null;
}

type TranslationExceptionEdit = { start: number; deletedLength: number; insertedLength: number };

interface DroppedTranslationException {
  aminoAcid: string;
  /** The entry's location before the edit, as written: "12..14" or "complement(9..11)". */
  location: string;
}

/**
 * The /transl_except entries a sequence edit removed from the features it
 * kept: the remap drops an entry whose codon the edit touched, and the CDS
 * then reads that codon plainly again. `before` and `after` are the record's
 * features either side of the edit; a feature the edit deleted is not
 * reported here.
 *
 * `edit` may be a run of edits in the order they were made, `before` being the
 * features ahead of the first: an entry is dropped when any edit in the run
 * touched its codon, and it is named at its location in `before`, the same
 * coordinates a notice uses to describe the run's net change.
 */
export function droppedTranslationExceptions(
  before: readonly { id: string; metadata: Readonly<Record<string, unknown>> }[],
  after: readonly { id: string; metadata: Readonly<Record<string, unknown>> }[],
  edit: TranslationExceptionEdit | readonly TranslationExceptionEdit[],
): DroppedTranslationException[] {
  const entries = (metadata: Readonly<Record<string, unknown>>) => {
    const value = metadata.transl_except ?? metadata.translExcept;
    return typeof value === 'string' && value.trim() ? translationExceptionEntries(value) : [];
  };
  const keptCounts = new Map(after.map((feature) => [feature.id, entries(feature.metadata).length]));
  const edits: readonly TranslationExceptionEdit[] = Array.isArray(edit) ? edit : [edit as TranslationExceptionEdit];
  const map: QualifierBaseMap = {
    base: (index) => edits.reduce<number | null>((at, step) => (
      at === null || at < step.start
        ? at
        : at >= step.start + step.deletedLength ? at + step.insertedLength - step.deletedLength : null
    ), index),
  };
  return before.flatMap((feature) => {
    const kept = keptCounts.get(feature.id);
    const own = entries(feature.metadata);
    if (kept === undefined || own.length <= kept) return [];
    return own.flatMap((entry) => {
      if (remapEntryQualifier(entry, map) !== null) return [];
      const match = /^\(\s*pos\s*:\s*(.+?)\s*,\s*aa\s*:\s*([^,\s)]+)/i.exec(entry);
      return [{ aminoAcid: match?.[2] ?? 'amino-acid', location: match?.[1] ?? entry }];
    });
  });
}

/** One notice line for the entries an edit dropped, or null when it dropped none. */
export function describeDroppedTranslationExceptions(dropped: readonly DroppedTranslationException[]): string | null {
  if (dropped.length === 0) return null;
  if (dropped.length === 1) {
    return `The ${dropped[0].aminoAcid} override at ${dropped[0].location} was removed: the edit changed its codon.`;
  }
  const aminoAcid = dropped.every((entry) => entry.aminoAcid === dropped[0].aminoAcid) ? `${dropped[0].aminoAcid} ` : 'codon ';
  return `${dropped.length} ${aminoAcid}overrides were removed: the edit changed their codons.`;
}

function isPositionQualifier(key: string): boolean {
  const normalized = key.toLowerCase();
  return ENTRY_POSITION_QUALIFIERS.has(normalized) || RANGE_POSITION_QUALIFIERS.has(normalized);
}

function remapPositionQualifier(key: string, value: unknown, map: QualifierBaseMap): unknown {
  const remap = (text: string) => (ENTRY_POSITION_QUALIFIERS.has(key.toLowerCase())
    ? remapEntryQualifier(text, map)
    : remapLocalLocation(text, map, false));
  if (typeof value === 'string') return remap(value);
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    const kept = value.map(remap).filter((entry): entry is string => entry !== null);
    return kept.length > 0 ? kept : null;
  }
  return value;
}

/**
 * Move the base positions inside a feature's qualifiers along with the
 * feature. `map` says where each source base lands in the new record; a
 * flipped map also turns `pos:a..b` into `complement(…)` and back. An entry
 * whose bases are not all carried, or whose location is remote, fuzzy or
 * otherwise not a plain local range, is dropped rather than left pointing at
 * bases it no longer names: a stale /transl_except recodes the wrong codon.
 * Returns the input itself when it holds no such qualifier.
 */
export function remapPositionQualifiers<M extends Readonly<Record<string, unknown>>>(
  metadata: M,
  map: QualifierBaseMap,
): M {
  const keys = Object.keys(metadata).filter(isPositionQualifier);
  const listed = metadata.motifQualifiers;
  const isListedPosition = (entry: unknown): entry is { key: string; value: unknown } => (
    typeof entry === 'object' && entry !== null
    && typeof (entry as { key?: unknown }).key === 'string'
    && isPositionQualifier((entry as { key: string }).key)
  );
  const listHasPositions = Array.isArray(listed) && listed.some(isListedPosition);
  if (keys.length === 0 && !listHasPositions) return metadata;
  const next: Record<string, unknown> = { ...metadata };
  for (const key of keys) {
    const value = remapPositionQualifier(key, metadata[key], map);
    if (value === null) delete next[key];
    else next[key] = value;
  }
  if (listHasPositions) {
    next.motifQualifiers = (listed as unknown[]).flatMap((entry) => {
      if (!isListedPosition(entry)) return [entry];
      const value = remapPositionQualifier(entry.key, entry.value, map);
      return value === null ? [] : [{ ...entry, value }];
    });
  }
  return next as M;
}
