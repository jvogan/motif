import { resolveTranslationTable } from './codon-tables';
import { extractFeatureSequence, featureLocationSegments, type FeatureLocation } from './feature-location';
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
