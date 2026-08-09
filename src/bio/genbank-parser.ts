import type { Feature, FeatureStrand, FeatureType, Topology } from './types';
import { featureLocationCoordinateSignature } from './feature-location';

// Individual qualifier values larger than 1 MB are
// truncated to this cap and tagged with a suffix so consumers can detect
// the truncation. The retained accumulator is bounded in UTF-8 bytes and the
// original byte count is tracked separately so huge values cannot grow it.
export const QUALIFIER_VALUE_MAX_BYTES = 1_048_576;
export const QUALIFIER_TRUNCATED_SUFFIX = '...[truncated]';

/**
 * Browser-safe UTF-8 accounting. TextEncoder's replacement behavior for lone
 * surrogates is reproduced explicitly so parsing does not depend on Buffer or
 * retain malformed UTF-16 in a supposedly bounded exported value.
 */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else if (code >= 0xd800 && code <= 0xdfff) bytes += 3;
    else bytes += 3;
  }
  return bytes;
}

/** Append complete Unicode scalars, replacing malformed surrogates. */
function appendUtf8WithinLimit(current: string, incoming: string, limit: number): string {
  let output = current;
  let bytes = utf8ByteLength(current);
  if (bytes >= limit) return output;
  for (let index = 0; index < incoming.length; index += 1) {
    const code = incoming.charCodeAt(index);
    let fragment = incoming[index];
    let fragmentBytes: number;
    if (code <= 0x7f) {
      fragmentBytes = 1;
    } else if (code <= 0x7ff) {
      fragmentBytes = 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < incoming.length) {
      const next = incoming.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        fragment = incoming.slice(index, index + 2);
        fragmentBytes = 4;
        index += 1;
      } else {
        fragment = '\ufffd';
        fragmentBytes = 3;
      }
    } else if (code >= 0xd800 && code <= 0xdfff) {
      fragment = '\ufffd';
      fragmentBytes = 3;
    } else if (code <= 0xffff) {
      fragmentBytes = 3;
    } else {
      // Unreachable for UTF-16 code units, retained as a defensive fallback.
      fragment = '\ufffd';
      fragmentBytes = 3;
    }
    if (bytes + fragmentBytes > limit) break;
    output += fragment;
    bytes += fragmentBytes;
  }
  return output;
}

function truncateUtf8(value: string, limit: number): string {
  return appendUtf8WithinLimit('', value, limit);
}

const QUALIFIER_TRUNCATED_SUFFIX_BYTES = utf8ByteLength(QUALIFIER_TRUNCATED_SUFFIX);

function hasOddTrailingQuoteRun(value: string): boolean {
  let count = 0;
  for (let index = value.length - 1; index >= 0 && value[index] === '"'; index -= 1) count += 1;
  return count > 0 && count % 2 === 1;
}

function qualifierChunkStats(value: string, opening: boolean, closing: boolean): { bytes: number; retained: string } {
  const start = opening && value.startsWith('"') ? 1 : 0;
  let end = value.length;
  if (closing && end > start && value.endsWith('"')) end -= 1;
  if (end < start) end = start;
  let bytes = 0;
  let retainedBytes = 0;
  const retained: string[] = [];
  for (let index = start; index < end; index += 1) {
    let fragment = value[index];
    let fragmentBytes: number;
    if (fragment === '"' && index + 1 < end && value[index + 1] === '"') {
      fragment = '"';
      fragmentBytes = 1;
      index += 1;
    } else {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) fragmentBytes = 1;
      else if (code <= 0x7ff) fragmentBytes = 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < end) {
        const next = value.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          fragment = value.slice(index, index + 2);
          fragmentBytes = 4;
          index += 1;
        } else {
          fragment = '\ufffd';
          fragmentBytes = 3;
        }
      } else if (code >= 0xd800 && code <= 0xdfff) {
        fragment = '\ufffd';
        fragmentBytes = 3;
      } else {
        fragmentBytes = 3;
      }
    }
    bytes += fragmentBytes;
    if (retainedBytes + fragmentBytes <= QUALIFIER_VALUE_MAX_BYTES) {
      retained.push(fragment);
      retainedBytes += fragmentBytes;
    }
  }
  return { bytes, retained: retained.join('') };
}

/**
 * NCBI strand qualifier from the LOCUS line: `ss-` (single-stranded),
 * `ds-` (double-stranded), or `ms-` (mixed). Absent on most modern records.
 * Preserving the literal token lets a parsed-then-exported record round-trip
 * the strand field that downstream GenBank consumers read from column 22-23.
 */
export type GenBankStrandedness = 'ss' | 'ds' | 'ms';

/**
 * A GenBank file is "truncated" when the source is cut off before
 * the ORIGIN block finishes — either no ORIGIN section at all, or ORIGIN
 * present but missing most/all sequence rows. Without a guard the parser
 * silently emits a record with a non-zero LOCUS length, partial features,
 * and an empty (or near-empty) `sequence` field — the user gets a 0-bp
 * block with annotations attached to addresses that don't resolve. The
 * intake pipeline inspects these flags to surface a `partial_record`
 * warning and refuses to import a zero-byte record.
 */
export interface GenBankTruncationInfo {
  /** Did we ever enter the ORIGIN section? */
  originSeen: boolean;
  /** LOCUS-declared length (`0` when absent). */
  declaredLength: number;
  /** Bases actually parsed from ORIGIN. */
  parsedSequenceLength: number;
  /** Human-readable reason — empty when not truncated. */
  reason: string;
}

export interface GenBankQualifier {
  key: string;
  value: string | true;
}

/** Structured evidence that an imported qualifier exceeded the parser cap. */
export interface GenBankQualifierTruncation {
  key: string;
  /** UTF-8 byte count before truncation. Kept as `originalLength` for API compatibility. */
  originalLength: number;
  /** UTF-8 byte count after truncation and the detection suffix. */
  retainedLength: number;
  /** Explicit aliases for consumers that should not infer the unit from Length. */
  originalBytes?: number;
  retainedBytes?: number;
  limit: number;
}

export interface GenBankImportDiagnostic {
  severity: 'warning';
  code: 'between_base_location' | 'remote_location' | 'ambiguous_location';
  featureKey: string;
  location: string;
  message: string;
}

export interface GenBankRecord {
  name: string;
  length: number;
  topology: Topology;
  moleculeType: string;
  features: Feature[];
  sequence: string;
  definition?: string;
  accession?: string;
  /**
   * Present only when the parser detected a truncated record.
   * The intake pipeline surfaces a `partial_record` warning and refuses
   * to materialize 0-bp blocks. Absent on healthy records to keep the
   * import metadata payload lean.
   */
  truncated?: GenBankTruncationInfo;
  /**
   * Free-form COMMENT block. Preserved as a single string with embedded
   * newlines so multi-line comments survive a round-trip.
   */
  comment?: string;
  /** SOURCE line (one-line summary above ORGANISM). */
  source?: string;
  /**
   * ORGANISM block. The first line is the organism name; subsequent
   * indented lines form the taxonomic lineage joined with `; `. We retain
   * the parsed name+lineage as a single string so the exporter can re-emit
   * the original layout.
   */
  organism?: string;
  /** KEYWORDS line, semicolon-separated, period-terminated upstream. */
  keywords?: string;
  /**
   * VERSION line value (e.g. `NM_001234.1` or `1`). Distinct from
   * `accession` because the version suffix is independent. Protein records
   * sometimes omit VERSION entirely; we record the absence as `undefined`
   * (vs `''`) so the exporter can decide whether to emit a fallback.
   */
  version?: string;
  /** LOCUS strand qualifier (`ss-` / `ds-` / `ms-`). */
  strandedness?: GenBankStrandedness;
  /**
   * LOCUS division code (3-letter NCBI division like `BCT`, `PLN`, `SYN`,
   * or `UNK`).
   */
  division?: string;
  /** LOCUS date in `DD-MMM-YYYY` form, preserved verbatim. */
  date?: string;
  /** Feature-specific warnings raised while retaining valid but unprojectable locations. */
  importDiagnostics?: GenBankImportDiagnostic[];
  /** Qualifiers capped during import, retained as a structured loss receipt. */
  qualifierTruncations?: Array<GenBankQualifierTruncation & { featureIndex: number }>;
}

/**
 * Qualifiers whose value is a continuous sequence (no
 * intra-value whitespace) must NOT have a space inserted when joining
 * continuation lines. Today this is just `/translation` (protein
 * sequence). Without this special-case, a parsed protein sequence ends
 * up as `MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLT LKFICTTGKLPVP...`
 * (spaces between original 58-char lines), which (a) breaks any
 * downstream consumer that uses the value as a protein sequence and
 * (b) causes the exporter to mis-wrap with col-22 leading spaces and
 * orphan single-char continuation lines.
 */
const CONTINUOUS_SEQUENCE_QUALIFIERS: ReadonlySet<string> = new Set(['translation']);

const FEATURE_TYPE_MAP: Record<string, FeatureType> = {
  gene: 'gene',
  cds: 'cds',
  promoter: 'promoter',
  terminator: 'terminator',
  misc_feature: 'misc_feature',
  rep_origin: 'origin',
  primer_bind: 'primer_bind',
  mrna: 'mRNA',
  rrna: 'rRNA',
  trna: 'tRNA',
  ncrna: 'ncRNA',
  regulatory: 'regulatory',
  repeat_region: 'repeat_region',
  sig_peptide: 'sig_peptide',
  mat_peptide: 'mat_peptide',
  transit_peptide: 'transit_peptide',
  intron: 'intron',
  exon: 'exon',
  polya_signal: 'polyA_signal',
  enhancer: 'enhancer',
  // Motif's GenBank exporter writes these internal
  // FeatureType keys verbatim (export.ts FEATURES table). Map them back so a
  // GenBank round-trip preserves the type instead of collapsing to `custom`.
  // (`rep_origin` above still maps to `origin` for standard external files.)
  orf: 'orf',
  rbs: 'rbs',
  origin: 'origin',
  resistance: 'resistance',
  restriction_site: 'restriction_site',
};

// Imported features use the muted palette by type unless the record supplies a
// safe explicit feature color. The renderer adapts the palette defaults across
// themes while preserving an explicit annotation color.
const FEATURE_COLORS: Record<FeatureType, string> = {
  gene: '#7E9BBF',
  cds: '#7E9BBF',
  promoter: '#C6A86B',
  terminator: '#C28C88',
  misc_feature: '#8B8F99',
  origin: '#9E96B4',
  primer_bind: '#C49374',
  orf: '#7FA98F',
  rbs: '#C6A86B',
  resistance: '#C49374',
  restriction_site: '#8B8F99',
  mRNA: '#6FB0A4',
  rRNA: '#6FB0A4',
  tRNA: '#6FB0A4',
  ncRNA: '#9E96B4',
  regulatory: '#C6A86B',
  repeat_region: '#9E96B4',
  sig_peptide: '#9DB585',
  mat_peptide: '#9DB585',
  transit_peptide: '#9DB585',
  intron: '#8B8F99',
  exon: '#6FB0A4',
  polyA_signal: '#C28C88',
  enhancer: '#C6A86B',
  custom: '#8B8F99',
};

const SAFE_IMPORTED_FEATURE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%+\-/]+\)|[a-z]+)$/i;

function importedFeatureColor(
  qualifiers: Readonly<Record<string, string | true>>,
  strand: FeatureStrand,
  fallback: string,
): string {
  const values = new Map(Object.entries(qualifiers).map(([key, value]) => [key.toLowerCase(), value]));
  const preferredKeys = strand === -1
    ? ['apeinfo_revcolor', 'apeinfo_fwdcolor']
    : ['apeinfo_fwdcolor', 'apeinfo_revcolor'];
  for (const key of preferredKeys) {
    const value = values.get(key);
    if (typeof value !== 'string') continue;
    const color = value.trim();
    if (color.length <= 80 && SAFE_IMPORTED_FEATURE_COLOR.test(color)) return color;
  }
  return fallback;
}

/**
 * Parse a location string like "100..200", "complement(100..200)",
 * "join(1..100,200..300)", or a single position "100".
 * Returns 0-indexed start (inclusive) and end (exclusive), plus strand.
 */
type ParsedLocation = Pick<Feature, 'start' | 'end' | 'strand' | 'subRanges'> & {
  locationOperator?: 'join' | 'order';
};

function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;

  for (const char of expr) {
    if (char === '(') depth++;
    if (char === ')') depth--;

    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function splitTopLevelRange(expr: string): [string, string] | null {
  let depth = 0;
  for (let index = 0; index < expr.length - 1; index += 1) {
    const character = expr[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (depth === 0 && character === '.' && expr[index + 1] === '.') {
      const left = expr.slice(0, index).trim();
      const right = expr.slice(index + 2).trim();
      return left && right ? [left, right] : null;
    }
  }
  return null;
}

type LocationSyntaxAnalysis = {
  valid: boolean;
  hasOneOf: boolean;
};

const INVALID_LOCATION_SYNTAX: LocationSyntaxAnalysis = { valid: false, hasOneOf: false };

function analyzeUnprojectableLocationSyntax(expression: string, depth = 0): LocationSyntaxAnalysis {
  if (depth > 32) return INVALID_LOCATION_SYNTAX;
  const inner = expression.trim();
  if (/^[<>]?\d+\^[<>]?\d+$/.test(inner)) return { valid: true, hasOneOf: false };
  if (/^[<>]?\d+$/.test(inner)) return { valid: true, hasOneOf: false };

  const oneOf = inner.match(/^one-of\((.*)\)$/i);
  if (oneOf) {
    const alternatives = splitTopLevel(oneOf[1]);
    const valid = alternatives.length >= 2 && alternatives.every((part) => /^[<>]?\d+$/.test(part.trim()));
    return { valid, hasOneOf: valid };
  }

  const range = splitTopLevelRange(inner);
  if (range) {
    const left = analyzeUnprojectableLocationSyntax(range[0], depth + 1);
    const right = analyzeUnprojectableLocationSyntax(range[1], depth + 1);
    return {
      valid: left.valid && right.valid,
      hasOneOf: left.hasOneOf || right.hasOneOf,
    };
  }

  if (inner.startsWith('complement(') && inner.endsWith(')')) {
    return analyzeUnprojectableLocationSyntax(inner.slice(11, -1), depth + 1);
  }
  for (const [operator, offset] of [['join(', 5], ['order(', 6]] as const) {
    if (!inner.startsWith(operator) || !inner.endsWith(')')) continue;
    const parts = splitTopLevel(inner.slice(offset, -1)).map((part) => (
      analyzeUnprojectableLocationSyntax(part, depth + 1)
    ));
    return {
      valid: parts.length > 0 && parts.every((part) => part.valid),
      hasOneOf: parts.some((part) => part.hasOneOf),
    };
  }
  return INVALID_LOCATION_SYNTAX;
}

function invertParsedLocation(location: ParsedLocation): ParsedLocation {
  return {
    ...location,
    strand: location.strand === 1 ? -1 : location.strand === -1 ? 1 : 0,
    // subRanges are stored in biological 5′→3′ order. Complementing a joined
    // product reverses the order as well as each piece's strand:
    // RC(a + b) = RC(b) + RC(a).
    subRanges: location.subRanges ? [...location.subRanges].reverse().map((subRange) => ({
      ...subRange,
      strand: (subRange.strand ?? 1) === 1 ? -1 : 1,
    })) : undefined,
  };
}

function collectLeafRanges(locations: ParsedLocation[]): NonNullable<Feature['subRanges']> {
  return locations.flatMap((location) =>
    location.subRanges ?? [{ start: location.start, end: location.end, strand: location.strand }]
  );
}

function assertValidLocation(location: ParsedLocation, rawLocation: string): ParsedLocation {
  const ranges = location.subRanges ?? [{ start: location.start, end: location.end, strand: location.strand }];
  const valid = ranges.length > 0 && ranges.every((range) =>
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    range.start >= 0 &&
    range.end > range.start
  );
  if (!valid || !Number.isFinite(location.start) || !Number.isFinite(location.end) || location.end <= location.start) {
    throw new Error(`Invalid GenBank location: ${rawLocation}`);
  }
  return location;
}

function isCoordinateExpression(expression: string, depth = 0): boolean {
  if (depth > 16) return false;
  const inner = expression.trim();
  if (/^[<>]?\d+\^[<>]?\d+$/.test(inner) || /^[<>]?\d+(?:\.\.[<>]?\d+)?$/.test(inner)) return true;
  for (const [operator, offset] of [['complement(', 11], ['join(', 5], ['order(', 6]] as const) {
    if (!inner.startsWith(operator) || !inner.endsWith(')')) continue;
    const body = inner.slice(offset, -1);
    if (operator === 'complement(') return isCoordinateExpression(body, depth + 1);
    const parts = splitTopLevel(body);
    return parts.length > 0 && parts.every((part) => isCoordinateExpression(part, depth + 1));
  }
  return false;
}

function unprojectableLocationDiagnostic(location: string, featureKey: string): GenBankImportDiagnostic | null {
  const inner = location.trim();
  if (/^[<>]?\d+\^[<>]?\d+$/.test(inner)) {
    return {
      severity: 'warning',
      code: 'between_base_location',
      featureKey,
      location,
      message: `Feature ${featureKey} retains valid between-base location ${location}, but that zero-width location cannot be projected onto a Motif feature range.`,
    };
  }

  const remote = inner.match(/^[A-Za-z][A-Za-z0-9_.-]*:(.+)$/);
  if (remote && (isCoordinateExpression(remote[1]) || analyzeUnprojectableLocationSyntax(remote[1]).valid)) {
    return {
      severity: 'warning',
      code: 'remote_location',
      featureKey,
      location,
      message: `Feature ${featureKey} retains remote INSDC location ${location}, but a remote accession cannot be projected onto this record's local sequence.`,
    };
  }

  const analysis = analyzeUnprojectableLocationSyntax(inner);
  if (analysis.valid && analysis.hasOneOf) {
    return {
      severity: 'warning',
      code: 'ambiguous_location',
      featureKey,
      location,
      message: `Feature ${featureKey} retains valid ambiguous INSDC location ${location}, but one-of alternatives cannot be projected onto one authoritative Motif feature range.`,
    };
  }

  if ((inner.startsWith('complement(') && inner.endsWith(')'))
    || (inner.startsWith('join(') && inner.endsWith(')'))
    || (inner.startsWith('order(') && inner.endsWith(')'))) {
    const offset = inner.startsWith('complement(') ? 11 : inner.startsWith('join(') ? 5 : 6;
    const parts = inner.startsWith('complement(')
      ? [inner.slice(offset, -1)]
      : splitTopLevel(inner.slice(offset, -1));
    return parts.map((part) => unprojectableLocationDiagnostic(part, featureKey)).find(Boolean) ?? null;
  }
  return null;
}

function parseLocation(loc: string, depth = 0): ParsedLocation {
  if (depth > 32) {
    throw new Error('parseLocation: maximum nesting depth exceeded');
  }
  const inner = loc.trim();

  if (inner.startsWith('complement(') && inner.endsWith(')')) {
    return invertParsedLocation(parseLocation(inner.slice(11, -1), depth + 1));
  }

  if ((inner.startsWith('join(') || inner.startsWith('order(')) && inner.endsWith(')')) {
    const locationOperator = inner.startsWith('join(') ? 'join' : 'order';
    const offset = locationOperator === 'join' ? 5 : 6;
    const parts = splitTopLevel(inner.slice(offset, -1)).map((p) => parseLocation(p, depth + 1));
    const subRanges = collectLeafRanges(parts);
    const start = Math.min(...subRanges.map((part) => part.start));
    const end = Math.max(...subRanges.map((part) => part.end));
    const strand: FeatureStrand = subRanges.every((part) => (part.strand ?? 1) === -1)
      ? -1
      : subRanges.every((part) => (part.strand ?? 1) === 1)
        ? 1
        : 0;
    return assertValidLocation({ start, end, strand, subRanges, locationOperator }, loc);
  }

  const rangeMatch = inner.match(/^[<>]?(\d+)\.\.[<>]?(\d+)$/);
  if (rangeMatch) {
    return assertValidLocation({
      start: parseInt(rangeMatch[1], 10) - 1,
      end: parseInt(rangeMatch[2], 10),
      strand: 1,
    }, loc);
  }

  if (!/^[<>]?\d+$/.test(inner)) {
    throw new Error(`Unsupported GenBank location syntax: ${loc}`);
  }
  const pos = parseInt(inner.replace(/[<>]/g, ''), 10);
  return assertValidLocation({ start: pos - 1, end: pos, strand: 1 }, loc);
}

/**
 * Parse the FEATURES section of a GenBank record.
 *
 * Exported so the EMBL parser can reuse the identical location + qualifier
 * engine: the EMBL `FT` feature table uses the same NCBI/INSDC feature-table
 * syntax as GenBank, just with an `FT` line prefix instead of 5 leading
 * spaces. `parseEmbl` rewrites the prefix to the GenBank column layout and
 * delegates here, so location parsing, multi-line qualifiers, `""` escaping,
 * and the `/label`-first naming rule stay in one place.
 */
export function parseFeatures(featuresText: string): Feature[] {
  const features: Feature[] = [];
  // Split into individual feature entries. Features start with a type at column 5
  // (i.e. 5 spaces followed by a non-space character).
  const featureBlocks: string[] = [];
  const lines = featuresText.split(/\r?\n/);
  let current = '';

  for (const line of lines) {
    // Feature type line: exactly 5 spaces then a non-space
    if (/^ {5}\S/.test(line)) {
      if (current) featureBlocks.push(current);
      current = line + '\n';
    } else if (current) {
      current += line + '\n';
    }
  }
  if (current) featureBlocks.push(current);

  for (const block of featureBlocks) {
    const blockLines = block.split('\n');
    const firstLine = blockLines[0];

    // Extract feature key and location from first line
    const match = firstLine.match(/^\s{5}(\S+)\s+(.*)/);
    if (!match) continue;

    const featureKey = match[1].toLowerCase();
    let locationStr = match[2].trim();

    // Location can span multiple lines (before qualifiers start)
    let lineIdx = 1;
    while (lineIdx < blockLines.length) {
      const l = blockLines[lineIdx].trim();
      if (l.startsWith('/') || l === '') break;
      locationStr += l;
      lineIdx++;
    }

    // Parse qualifiers.
    // Use a null-prototype map so a malicious /__proto__= or
    // /constructor= qualifier key cannot reach Object.prototype. Not exploitable
    // in V8 today (special-cased), but defense in depth.
    // Cap individual qualifier values at 1 MB to defend
    // against malicious input. Larger values are truncated with a suffix.
    // Decode embedded `""` → `"` per NCBI feature-table spec
    // §3.4.2. The previous strip-outer-quotes-only behavior preserved `""`
    // as `""` in metadata, so spec-compliant input round-tripped wrong.
    // We also detect when a continuation line beginning with `/` is actually
    // INSIDE an unclosed quoted value, and treat it as a continuation.
    const qualifiers: Record<string, string | true> = Object.create(null) as Record<string, string | true>;
    const qualifierEntries: GenBankQualifier[] = [];
    const qualifierTruncations: GenBankQualifierTruncation[] = [];
    let currentQualKey = '';
    let currentQualRetainedValue = '';
    let currentQualOriginalBytes = 0;
    let currentQualIsQuoted = false;
    let currentQualClosed = false;
    let currentQualValueless = false;

    const appendQualifierChunk = (rawChunk: string, separator = '', opening = false, closing = false) => {
      const separatorStats = qualifierChunkStats(separator, false, false);
      const chunkStats = qualifierChunkStats(rawChunk, opening, closing);
      currentQualOriginalBytes += separatorStats.bytes + chunkStats.bytes;
      const retainedLimit = currentQualOriginalBytes > QUALIFIER_VALUE_MAX_BYTES
        ? QUALIFIER_VALUE_MAX_BYTES - QUALIFIER_TRUNCATED_SUFFIX_BYTES
        : QUALIFIER_VALUE_MAX_BYTES;
      if (utf8ByteLength(currentQualRetainedValue) > retainedLimit) {
        currentQualRetainedValue = truncateUtf8(currentQualRetainedValue, retainedLimit);
      }
      currentQualRetainedValue = appendUtf8WithinLimit(
        currentQualRetainedValue,
        `${separator}${chunkStats.retained}`,
        retainedLimit,
      );
    };

    const saveQualifier = () => {
      if (!currentQualKey) return;
      let value: string | true;
      if (currentQualValueless) {
        // Valueless GenBank qualifier (/pseudo, /partial, /ribosomal_slippage,
        // /trans_splicing, …). Store `true` — NOT '' — so the exporter emits a
        // bare `/key` and the flag survives a round-trip. export.ts filters out
        // '' BEFORE reaching its `value === true` bare-flag branch, which is how
        // these flags were being dropped. Feature.metadata is
        // Record<string, unknown>, so the boolean is type-safe downstream.
        value = true;
      } else {
        const truncated = currentQualOriginalBytes > QUALIFIER_VALUE_MAX_BYTES;
        const raw = truncated
          ? `${currentQualRetainedValue}${QUALIFIER_TRUNCATED_SUFFIX}`
          : currentQualRetainedValue;
        if (truncated) {
          const originalBytes = currentQualOriginalBytes;
          const retainedBytes = utf8ByteLength(raw);
          qualifierTruncations.push({
            key: currentQualKey,
            originalLength: originalBytes,
            retainedLength: retainedBytes,
            originalBytes,
            retainedBytes,
            limit: QUALIFIER_VALUE_MAX_BYTES,
          });
        }
        value = raw;
      }
      qualifiers[currentQualKey] = value;
      qualifierEntries.push({ key: currentQualKey, value });
    };

    /**
     * A quoted multi-line value is "closed" when the trailing run of `"`
     * chars (after the leading quote) has odd length — the final `"` is the
     * terminator and each preceding `""` is an escaped internal quote.
     */
    const isQuotedValueClosed = (val: string): boolean => {
      if (!val.startsWith('"')) return false;
      if (val.length < 2) return false;
      const tail = val.slice(1);
      let trailing = 0;
      for (let i = tail.length - 1; i >= 0 && tail[i] === '"'; i--) trailing++;
      return trailing % 2 === 1;
    };

    for (let i = lineIdx; i < blockLines.length; i++) {
      const l = blockLines[i].trim();
      if (!l) continue;

      // A line starting with `/` opens a new qualifier ONLY if the current
      // quoted value is closed (or we're not in a quoted value at all).
      const isQuotedAndStillOpen =
        currentQualIsQuoted && !currentQualClosed;

      if (l.startsWith('/') && !isQuotedAndStillOpen) {
        // Save previous qualifier
        saveQualifier();
        const eqIdx = l.indexOf('=');
        if (eqIdx === -1) {
          currentQualKey = l.slice(1);
          currentQualRetainedValue = '';
          currentQualOriginalBytes = 0;
          currentQualIsQuoted = false;
          currentQualClosed = true;
          currentQualValueless = true; // no '=' → a bare flag like /pseudo
        } else {
          currentQualKey = l.slice(1, eqIdx);
          const value = l.slice(eqIdx + 1);
          currentQualRetainedValue = '';
          currentQualOriginalBytes = 0;
          currentQualIsQuoted = value.startsWith('"');
          currentQualClosed = !currentQualIsQuoted || isQuotedValueClosed(value);
          currentQualValueless = false;
          appendQualifierChunk(
            value,
            '',
            currentQualIsQuoted || value.startsWith('"'),
            currentQualIsQuoted ? currentQualClosed : value.endsWith('"'),
          );
        }
      } else if (currentQualKey) {
        // Continuation of a multi-line qualifier value. The retained value is
        // capped in UTF-8 bytes while the original byte count continues to be
        // measured, so a malicious 100 MB qualifier cannot grow the parser's
        // accumulator or lose its loss receipt.
        //
        // `/translation` is a continuous protein sequence —
        // line breaks in the source are pure formatting and must NOT
        // introduce whitespace into the parsed value (or downstream consumers
        // would see `MVSK LKFI ...` instead of `MVSKLKFI...`, and the exporter
        // would later mis-wrap the value with col-22 leading spaces and
        // orphan single-char continuation lines). All other qualifiers
        // (/note, /product, /function, etc.) join with a space to preserve
        // word boundaries.
        const separator = CONTINUOUS_SEQUENCE_QUALIFIERS.has(currentQualKey) ? '' : ' ';
        const closes = currentQualIsQuoted ? hasOddTrailingQuoteRun(l) : true;
        appendQualifierChunk(l, separator, false, currentQualIsQuoted && closes);
        currentQualClosed = closes;
      }
    }
    // Save last qualifier
    saveQualifier();

    // Determine feature type
    const mappedType: FeatureType = FEATURE_TYPE_MAP[featureKey] ?? 'custom';

    // Determine name from qualifiers. Each read is string-guarded: a valueless
    // qualifier is stored as `true` (see saveQualifier) and `name.replace()`
    // below assumes a string, so only adopt a qualifier whose value is a string.
    // `/label` is the canonical display-name carrier and MUST win — the
    // exporter (src/persistence/export.ts) always writes feature.name to /label,
    // so reading /gene first silently reverted a user-renamed feature to its
    // gene/product name on an export→import round-trip. /label-first matches
    // common editor behavior; gene-before-product order is preserved for the
    // no-/label case so existing fixtures are unaffected.
    const name =
      (typeof qualifiers['label'] === 'string' && qualifiers['label']) ||
      (typeof qualifiers['gene'] === 'string' && qualifiers['gene']) ||
      (typeof qualifiers['product'] === 'string' && qualifiers['product']) ||
      (typeof qualifiers['note'] === 'string' && qualifiers['note']) ||
      featureKey;

    // Parse location
    let locationResult: ParsedLocation;
    let locationDiagnostic: GenBankImportDiagnostic | null = null;
    try {
      locationResult = parseLocation(locationStr);
    } catch (error) {
      locationDiagnostic = unprojectableLocationDiagnostic(locationStr, featureKey);
      if (locationDiagnostic) {
        // A quarantined feature remains visible and exportable, but its
        // placeholder range is never authoritative for sequence operations.
        locationResult = { start: 0, end: 1, strand: 0 };
      } else {
        const message = error instanceof Error ? error.message : 'unsupported syntax';
        throw new Error(`GenBank feature ${featureKey} has an unsupported location "${locationStr}": ${message}`);
      }
    }
    const { start, end, strand, subRanges, locationOperator } = locationResult;
    const parsedLocationFeature = { start, end, strand, subRanges };
    const fuzzyLocation = /[<>]/.test(locationStr);

    features.push({
      id: crypto.randomUUID(),
      name: name.replace(/^"|"$/g, ''),
      type: mappedType,
      start,
      end,
      strand,
      subRanges,
      color: importedFeatureColor(qualifiers, strand, FEATURE_COLORS[mappedType]),
      metadata: {
        ...qualifiers,
        ...(qualifierEntries.length > 0 ? { motifQualifiers: qualifierEntries } : {}),
        ...(qualifierTruncations.length > 0 ? { motifQualifierTruncations: qualifierTruncations } : {}),
        motifOriginalFeatureKey: featureKey,
        motifOriginalLocation: locationStr,
        motifOriginalLocationSignature: featureLocationCoordinateSignature(parsedLocationFeature),
        ...(locationOperator ? { motifLocationOperator: locationOperator } : {}),
        ...(subRanges ? { motifSubRangeOrder: 'biological' } : {}),
        ...(fuzzyLocation ? {
          motifLocationFuzzy: true,
        } : {}),
        ...(locationDiagnostic?.code === 'ambiguous_location' ? {
          motifLocationAmbiguous: true,
        } : {}),
        ...(locationDiagnostic ? {
          motifLocationQuarantined: true,
          motifImportDiagnostics: [locationDiagnostic],
        } : {}),
      },
    });
  }

  return features;
}

/**
 * Parse one or more GenBank records from a string.
 * Records are separated by `//`.
 */
export function parseGenBank(input: string): GenBankRecord[] {
  return parseMultiGenBank(input);
}

function splitGenBankRecords(input: string): string[] {
  const records: string[] = [];
  const lines = input.split(/\r?\n/);
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.trim() === '//') {
      const record = currentLines.join('\n').trim();
      if (record.length > 0) {
        records.push(record);
      }
      currentLines = [];
      continue;
    }

    currentLines.push(line);
  }

  const trailingRecord = currentLines.join('\n').trim();
  if (trailingRecord.length > 0) {
    records.push(trailingRecord);
  }

  return records;
}

/**
 * Parse the LOCUS line. NCBI defines fixed-position columns but real-world
 * files vary, so we use a regex+whitespace-split combination:
 *
 *   LOCUS  <name>  <length> bp/aa  [strand-]<moltype>  <topology>  <division>  <date>
 *
 * Examples we must handle:
 *   LOCUS       pBR322     4361 bp    ds-DNA   circular SYN 26-APR-2010
 *   LOCUS       NC_001416  48502 bp    DNA     linear   PHG 10-FEB-2015
 *   LOCUS       MYSEQ        500 aa            linear            01-JAN-2020
 *   LOCUS       pUC19      2578 bp    DNA     circular UNK
 */
interface LocusFields {
  name: string;
  length: number;
  topology: Topology;
  moleculeType: string;
  strandedness?: GenBankStrandedness;
  division?: string;
  date?: string;
}

function parseLocusLine(line: string): LocusFields {
  const result: LocusFields = {
    name: 'Unknown',
    length: 0,
    topology: 'linear',
    moleculeType: '',
  };
  // Strip the leading "LOCUS" keyword (first whitespace token only).
  const body = line.replace(/^LOCUS\s+/, '');
  const tokens = body.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return result;

  result.name = tokens[0];

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1] ?? '';
    if (/^\d+$/.test(tok) && /^(bp|aa)$/i.test(next)) {
      result.length = parseInt(tok, 10);
    }
  }

  // Strandedness — `ss-`, `ds-`, `ms-` prefix on the molecule type field.
  // We strip the prefix from `moleculeType` so the rest of the codebase
  // continues to receive plain `DNA` / `RNA`.
  const strandMatch = line.match(/\b(ss|ds|ms)-(DNA|RNA|mRNA)\b/i);
  if (strandMatch) {
    result.strandedness = strandMatch[1].toLowerCase() as GenBankStrandedness;
    result.moleculeType = strandMatch[2].toUpperCase();
  } else {
    const molMatch = line.match(/\b(DNA|RNA|mRNA|cDNA|tRNA|rRNA|ncRNA)\b/i);
    if (molMatch) result.moleculeType = molMatch[1];
  }

  // Topology — explicit token only; the GenBank spec defaults linear when
  // omitted, but we record only what we observed.
  if (/\bcircular\b/i.test(line)) result.topology = 'circular';
  else if (/\blinear\b/i.test(line)) result.topology = 'linear';

  // Date — DD-MMM-YYYY in trailing column.
  const dateMatch = line.match(/(\d{2}-[A-Z]{3}-\d{4})\s*$/);
  if (dateMatch) result.date = dateMatch[1];

  // Division — 3 uppercase letters preceding the date (or trailing if
  // date absent). NCBI divisions: BCT PRI ROD MAM VRT INV PLN BCT VRL PHG
  // RNA SYN UNA EST PAT STS GSS HTG HTC ENV CON TSA UNK. Match any
  // 3-letter uppercase token in that slot.
  const divMatch = result.date
    ? line.match(/\b([A-Z]{3})\s+\d{2}-[A-Z]{3}-\d{4}\s*$/)
    : line.match(/\b([A-Z]{3})\s*$/);
  if (divMatch) result.division = divMatch[1];

  return result;
}

function parseSingleGenBankRecord(raw: string): GenBankRecord | null {
  if (raw.trim().length === 0) {
    return null;
  }

  const lines = raw.split(/\r?\n/);
  let locus: LocusFields = {
    name: 'Unknown',
    length: 0,
    topology: 'linear',
    moleculeType: '',
  };
  let definition = '';
  let accession = '';
  let version = '';
  let keywords = '';
  let source = '';
  let organism = '';
  let comment = '';
  let featuresText = '';
  let sequence = '';

  let section: 'header' | 'features' | 'origin' | 'none' = 'header';
  let definitionLines: string[] = [];
  let inDefinition = false;
  let commentLines: string[] = [];
  let inComment = false;
  let organismLines: string[] = [];
  let inOrganism = false;
  let keywordsLines: string[] = [];
  let inKeywords = false;
  // Track whether the input ever entered ORIGIN. Combined with
  // `locus.length` (the LOCUS-declared length) we use this to detect
  // truncation. A GenBank export that was cut off
  // mid-FEATURES (or mid-ORIGIN) shows up here as `originSeen = false`
  // (or as a `parsedSequenceLength` significantly smaller than declared)
  // and the intake pipeline refuses the import instead of materializing
  // a 0-bp block with phantom features.
  let originSeen = false;

  const flushDefinition = () => {
    if (inDefinition) {
      definition = definitionLines.join(' ').trim();
      inDefinition = false;
    }
  };
  const flushComment = () => {
    if (inComment) {
      // Preserve embedded newlines so multi-line COMMENTs round-trip.
      comment = commentLines.join('\n').replace(/\s+$/g, '');
      inComment = false;
    }
  };
  const flushOrganism = () => {
    if (inOrganism) {
      // First line = organism name; remaining lines = taxonomy lineage.
      // Join with ' ' but keep them retrievable; we store the full block
      // with a single space between lines (the canonical NCBI rendering).
      organism = organismLines.join(' ').replace(/\s+/g, ' ').trim();
      inOrganism = false;
    }
  };
  const flushKeywords = () => {
    if (inKeywords) {
      keywords = keywordsLines.join(' ').replace(/\s+/g, ' ').trim();
      // Trim trailing period per NCBI convention so callers get a
      // normalized list; we re-add the period on export.
      if (keywords.endsWith('.')) keywords = keywords.slice(0, -1);
      inKeywords = false;
    }
  };
  const flushAllHeaderBuffers = () => {
    flushDefinition();
    flushComment();
    flushOrganism();
    flushKeywords();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('LOCUS')) {
      flushAllHeaderBuffers();
      locus = parseLocusLine(line);
      section = 'header';
      continue;
    }

    // Continuation lines (>=12 leading spaces) belong to the most recent
    // header section. We check the section flags first to route them.
    const isContinuation = /^ {12,}\S/.test(line);

    if (inDefinition) {
      if (isContinuation) { definitionLines.push(line.trim()); continue; }
      flushDefinition();
    }
    if (inComment) {
      // COMMENT continuation lines start at column 13 (12 spaces). Blank
      // lines are allowed inside the block per NCBI examples (e.g. NCBI
      // RefSeq Annotation block).
      if (isContinuation || line.trim() === '') {
        commentLines.push(line.replace(/^ {0,12}/, ''));
        continue;
      }
      flushComment();
    }
    if (inOrganism) {
      if (isContinuation) { organismLines.push(line.trim()); continue; }
      flushOrganism();
    }
    if (inKeywords) {
      if (isContinuation) { keywordsLines.push(line.trim()); continue; }
      flushKeywords();
    }

    if (line.startsWith('DEFINITION')) {
      definition = line.replace(/^DEFINITION\s+/, '').trim();
      inDefinition = true;
      definitionLines = [definition];
      continue;
    }

    if (line.startsWith('ACCESSION')) {
      const rawAccession = line.replace(/^ACCESSION\s+/, '').trim();
      // `ACCESSION unknown` is a placeholder used by
      // Motif (and other tools) when no real NCBI accession exists.
      // Treat it as no-accession so the exporter doesn't later emit a
      // phantom `VERSION unknown.1`. NCBI uses
      // the same convention — accession is absent when no submission ID
      // has been assigned.
      accession = rawAccession.toLowerCase() === 'unknown' ? '' : rawAccession;
      continue;
    }

    if (line.startsWith('VERSION')) {
      // VERSION may carry a GI suffix on legacy records; we keep the
      // first whitespace-separated token (the accession.version pair).
      const rest = line.replace(/^VERSION\s+/, '').trim();
      version = rest.split(/\s+/)[0] ?? '';
      continue;
    }

    if (line.startsWith('KEYWORDS')) {
      const rest = line.replace(/^KEYWORDS\s*/, '').trim();
      keywordsLines = rest ? [rest] : [];
      inKeywords = true;
      continue;
    }

    if (line.startsWith('SOURCE')) {
      source = line.replace(/^SOURCE\s+/, '').trim();
      continue;
    }

    if (/^ {2}ORGANISM/.test(line)) {
      const rest = line.replace(/^ {2}ORGANISM\s+/, '').trim();
      organismLines = rest ? [rest] : [];
      inOrganism = true;
      continue;
    }

    if (line.startsWith('COMMENT')) {
      const rest = line.replace(/^COMMENT\s*/, '');
      commentLines = rest ? [rest] : [];
      inComment = true;
      continue;
    }

    if (line.startsWith('FEATURES')) {
      flushAllHeaderBuffers();
      section = 'features';
      continue;
    }

    if (line.startsWith('ORIGIN')) {
      flushAllHeaderBuffers();
      section = 'origin';
      originSeen = true;
      continue;
    }

    if (section === 'features') {
      featuresText += line + '\n';
    }

    if (section === 'origin') {
      // Sequence lines: strip leading numbers and spaces
      const seqLine = line.replace(/[\s\d/]/g, '');
      sequence += seqLine;
    }
  }

  flushAllHeaderBuffers();

  const features = featuresText ? parseFeatures(featuresText) : [];
  const importDiagnostics = features.flatMap((feature) => {
    const diagnostics = feature.metadata.motifImportDiagnostics;
    return Array.isArray(diagnostics) ? diagnostics as GenBankImportDiagnostic[] : [];
  });
  const qualifierTruncations = features.flatMap((feature, featureIndex) => {
    const raw = feature.metadata.motifQualifierTruncations;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((value): value is GenBankQualifierTruncation => (
        value !== null
        && typeof value === 'object'
        && typeof (value as GenBankQualifierTruncation).key === 'string'
        && Number.isSafeInteger((value as GenBankQualifierTruncation).originalLength)
        && Number.isSafeInteger((value as GenBankQualifierTruncation).retainedLength)
        && Number.isSafeInteger((value as GenBankQualifierTruncation).limit)
      ))
      .map((value) => ({ ...value, featureIndex }));
  });
  let length = locus.length;
  if (!length && sequence.length > 0) {
    length = sequence.length;
  }

  // Preserve source case verbatim. The exporter also preserves it, so a
  // round-trip through GenBank survives case identity for all inputs,
  // including uniformly uppercase records.
  const preservedSequence = sequence;

  // Detect truncation with three checks, in order of severity:
  //   (1) LOCUS declared a positive length but ORIGIN never appeared —
  //       the file was cut off before (or during) FEATURES emit. This is
  //       the canonical "0-bp block with partial features" reproducer.
  //   (2) ORIGIN appeared but the parsed sequence length is below 50% of
  //       the LOCUS declaration — likely mid-ORIGIN truncation, where
  //       the first N rows landed in the file before the writer was
  //       interrupted. Sub-50% is a conservative threshold; legitimate
  //       NCBI records always match their LOCUS length exactly.
  //   (3) ORIGIN appeared but the parsed sequence is empty AND LOCUS
  //       declared a positive length — likely an `ORIGIN\n//` shell with
  //       no rows, which is structurally identical to (1) from a
  //       downstream view but separates cleanly here for the reason
  //       message.
  let truncated: GenBankTruncationInfo | undefined;
  const declared = locus.length;
  const parsed = preservedSequence.length;
  if (declared > 0 && !originSeen) {
    truncated = {
      originSeen: false,
      declaredLength: declared,
      parsedSequenceLength: parsed,
      reason: `LOCUS declared ${declared} bp but the ORIGIN block is missing — the file was truncated before the sequence emit.`,
    };
  } else if (declared > 0 && originSeen && parsed === 0) {
    truncated = {
      originSeen: true,
      declaredLength: declared,
      parsedSequenceLength: 0,
      reason: `LOCUS declared ${declared} bp but ORIGIN contains no sequence rows — the file was truncated immediately after ORIGIN.`,
    };
  } else if (declared > 0 && originSeen && parsed > 0 && parsed < declared * 0.5) {
    truncated = {
      originSeen: true,
      declaredLength: declared,
      parsedSequenceLength: parsed,
      reason: `LOCUS declared ${declared} bp but only ${parsed} bp parsed (${Math.round((parsed / declared) * 100)}%). ORIGIN is partial — the file was truncated mid-sequence.`,
    };
  }

  return {
    name: locus.name,
    length,
    topology: locus.topology,
    moleculeType: locus.moleculeType,
    features,
    sequence: preservedSequence,
    definition: definition || undefined,
    accession: accession || undefined,
    version: version || undefined,
    keywords: keywords || undefined,
    source: source || undefined,
    organism: organism || undefined,
    comment: comment || undefined,
    strandedness: locus.strandedness,
    division: locus.division,
    date: locus.date,
    truncated,
    importDiagnostics: importDiagnostics.length > 0 ? importDiagnostics : undefined,
    qualifierTruncations: qualifierTruncations.length > 0 ? qualifierTruncations : undefined,
  };
}

/**
 * Parse multiple GenBank records from a string.
 * Records are separated by `//`.
 */
export function parseMultiGenBank(input: string): GenBankRecord[] {
  return splitGenBankRecords(input)
    .map(parseSingleGenBankRecord)
    .filter((record): record is GenBankRecord => record !== null);
}
