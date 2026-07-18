import type { Feature, FeatureStrand, FeatureType, Topology } from './types';
import { featureLocationCoordinateSignature } from './feature-location';

// Phase 35 P-H (P2-E2): individual qualifier values larger than 1 MB are
// truncated to this cap and tagged with a suffix so consumers can detect
// the truncation. The accumulator soft-caps at 2x this value to avoid
// quadratic string concat on adversarial input.
export const QUALIFIER_VALUE_MAX_BYTES = 1_048_576;
export const QUALIFIER_TRUNCATED_SUFFIX = '...[truncated]';

/**
 * NCBI strand qualifier from the LOCUS line: `ss-` (single-stranded),
 * `ds-` (double-stranded), or `ms-` (mixed). Absent on most modern records.
 * Preserving the literal token lets a parsed-then-exported record round-trip
 * the strand field that downstream tools (Snapgene, Benchling, BioPython)
 * read from column 22-23. VOG-2000.
 */
export type GenBankStrandedness = 'ss' | 'ds' | 'ms';

/**
 * VOG-1973: a GenBank file is "truncated" when the source is cut off before
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
   * VOG-1973: present only when the parser detected a truncated record.
   * The intake pipeline surfaces a `partial_record` warning and refuses
   * to materialize 0-bp blocks. Absent on healthy records to keep the
   * import metadata payload lean.
   */
  truncated?: GenBankTruncationInfo;
  /**
   * Free-form COMMENT block. Preserved as a single string with embedded
   * newlines so multi-line comments survive a round-trip. VOG-2004.
   */
  comment?: string;
  /** SOURCE line (one-line summary above ORGANISM). VOG-2004. */
  source?: string;
  /**
   * ORGANISM block. The first line is the organism name; subsequent
   * indented lines form the taxonomic lineage joined with `; `. We retain
   * the parsed name+lineage as a single string so the exporter can re-emit
   * the original layout. VOG-2004.
   */
  organism?: string;
  /** KEYWORDS line, semicolon-separated, period-terminated upstream. VOG-2004. */
  keywords?: string;
  /**
   * VERSION line value (e.g. `NM_001234.1` or `1`). Distinct from
   * `accession` because the version suffix is independent. Protein records
   * sometimes omit VERSION entirely; we record the absence as `undefined`
   * (vs `''`) so the exporter can decide whether to emit a fallback.
   * VOG-2001.
   */
  version?: string;
  /** LOCUS strand qualifier (`ss-` / `ds-` / `ms-`). VOG-2000. */
  strandedness?: GenBankStrandedness;
  /**
   * LOCUS division code (3-letter NCBI division like `BCT`, `PLN`, `SYN`,
   * or `UNK`). VOG-1974.
   */
  division?: string;
  /** LOCUS date in `DD-MMM-YYYY` form, preserved verbatim. VOG-1974. */
  date?: string;
}

/**
 * VOG-2039 hotfix: qualifiers whose value is a continuous sequence (no
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
  // QA2 W16c (export agent F1): Motif's GenBank exporter writes these internal
  // FeatureType keys verbatim (export.ts FEATURES table). Map them back so a
  // GenBank round-trip preserves the type instead of collapsing to `custom`.
  // (`rep_origin` above still maps to `origin` for standard external files.)
  orf: 'orf',
  rbs: 'rbs',
  origin: 'origin',
  resistance: 'resistance',
  restriction_site: 'restriction_site',
};

// De-color sweep: persisted feature.color uses the muted DARK palette keyed by
// type. The renderer remaps these to the light --feature-* tokens on a light
// theme, so this is the single canonical hex an imported feature carries.
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
 * and the `/label`-first naming rule stay in one place. VOG-2149.
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
    // Phase 35 P-H (P2-E1): null-prototype map so a malicious /__proto__= or
    // /constructor= qualifier key cannot reach Object.prototype. Not exploitable
    // in V8 today (special-cased), but defense in depth.
    // Phase 35 P-H (P2-E2): cap individual qualifier values at 1 MB to defend
    // against malicious input. Larger values are truncated with a suffix.
    // Phase 35 P1-A7: decode embedded `""` → `"` per NCBI feature-table spec
    // §3.4.2. The previous strip-outer-quotes-only behavior preserved `""`
    // as `""` in metadata, so spec-compliant input round-tripped wrong.
    // We also detect when a continuation line beginning with `/` is actually
    // INSIDE an unclosed quoted value, and treat it as a continuation.
    const qualifiers: Record<string, string | true> = Object.create(null) as Record<string, string | true>;
    let currentQualKey = '';
    let currentQualVal = '';
    let currentQualIsQuoted = false;
    let currentQualValueless = false;

    const saveQualifier = () => {
      if (!currentQualKey) return;
      if (currentQualValueless) {
        // Valueless GenBank qualifier (/pseudo, /partial, /ribosomal_slippage,
        // /trans_splicing, …). Store `true` — NOT '' — so the exporter emits a
        // bare `/key` and the flag survives a round-trip. export.ts filters out
        // '' BEFORE reaching its `value === true` bare-flag branch, which is how
        // these flags were being dropped. Feature.metadata is
        // Record<string, unknown>, so the boolean is type-safe downstream.
        // (QA2 W21, import/export agent F2.)
        qualifiers[currentQualKey] = true;
        return;
      }
      let raw = currentQualVal;
      if (currentQualIsQuoted) {
        if (raw.startsWith('"')) raw = raw.slice(1);
        if (raw.endsWith('"')) raw = raw.slice(0, -1);
        // Phase 35 P1-A7: decode `""` → `"`
        raw = raw.replace(/""/g, '"');
      } else {
        raw = raw.replace(/^"|"$/g, '');
      }
      if (raw.length > QUALIFIER_VALUE_MAX_BYTES) {
        raw = raw.slice(0, QUALIFIER_VALUE_MAX_BYTES) + QUALIFIER_TRUNCATED_SUFFIX;
      }
      qualifiers[currentQualKey] = raw;
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
        currentQualIsQuoted && !isQuotedValueClosed(currentQualVal);

      if (l.startsWith('/') && !isQuotedAndStillOpen) {
        // Save previous qualifier
        saveQualifier();
        const eqIdx = l.indexOf('=');
        if (eqIdx === -1) {
          currentQualKey = l.slice(1);
          currentQualVal = '';
          currentQualIsQuoted = false;
          currentQualValueless = true; // no '=' → a bare flag like /pseudo
        } else {
          currentQualKey = l.slice(1, eqIdx);
          currentQualVal = l.slice(eqIdx + 1);
          currentQualIsQuoted = currentQualVal.startsWith('"');
          currentQualValueless = false;
        }
      } else if (currentQualKey) {
        // Continuation of a multi-line qualifier value. Soft-cap accumulation
        // to avoid quadratic string concat on a malicious 100 MB qualifier;
        // the saveQualifier truncate handles the final length.
        //
        // VOG-2039 hotfix: `/translation` is a continuous protein sequence —
        // line breaks in the source are pure formatting and must NOT
        // introduce whitespace into the parsed value (or downstream consumers
        // would see `MVSK LKFI ...` instead of `MVSKLKFI...`, and the exporter
        // would later mis-wrap the value with col-22 leading spaces and
        // orphan single-char continuation lines). All other qualifiers
        // (/note, /product, /function, etc.) join with a space to preserve
        // word boundaries.
        if (currentQualVal.length < QUALIFIER_VALUE_MAX_BYTES * 2) {
          const separator = CONTINUOUS_SEQUENCE_QUALIFIERS.has(currentQualKey) ? '' : ' ';
          currentQualVal += separator + l;
        }
      }
    }
    // Save last qualifier
    saveQualifier();

    // Determine feature type
    const mappedType: FeatureType = FEATURE_TYPE_MAP[featureKey] ?? 'custom';

    // Determine name from qualifiers. Each read is string-guarded: a valueless
    // qualifier is stored as `true` (see saveQualifier) and `name.replace()`
    // below assumes a string, so only adopt a qualifier whose value is a string.
    // R11: /label is the canonical display-name carrier and MUST win — the
    // exporter (src/persistence/export.ts) always writes feature.name to /label,
    // so reading /gene first silently reverted a user-renamed feature to its
    // gene/product name on an export→import round-trip. /label-first matches
    // SnapGene/Benchling; gene-before-product order is preserved for the
    // no-/label case so existing fixtures are unaffected.
    const name =
      (typeof qualifiers['label'] === 'string' && qualifiers['label']) ||
      (typeof qualifiers['gene'] === 'string' && qualifiers['gene']) ||
      (typeof qualifiers['product'] === 'string' && qualifiers['product']) ||
      (typeof qualifiers['note'] === 'string' && qualifiers['note']) ||
      featureKey;

    // Parse location
    let locationResult: ParsedLocation;
    try {
      locationResult = parseLocation(locationStr);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unsupported syntax';
      throw new Error(`GenBank feature ${featureKey} has an unsupported location "${locationStr}": ${message}`);
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
      color: FEATURE_COLORS[mappedType],
      metadata: {
        ...qualifiers,
        ...(locationOperator ? { motifLocationOperator: locationOperator } : {}),
        ...(subRanges ? { motifSubRangeOrder: 'biological' } : {}),
        ...(fuzzyLocation ? {
          motifOriginalLocation: locationStr,
          motifOriginalLocationSignature: featureLocationCoordinateSignature(parsedLocationFeature),
          motifLocationFuzzy: true,
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
  // continues to receive plain `DNA` / `RNA`. VOG-2000.
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

  // Date — DD-MMM-YYYY in trailing column. VOG-1974.
  const dateMatch = line.match(/(\d{2}-[A-Z]{3}-\d{4})\s*$/);
  if (dateMatch) result.date = dateMatch[1];

  // Division — 3 uppercase letters preceding the date (or trailing if
  // date absent). NCBI divisions: BCT PRI ROD MAM VRT INV PLN BCT VRL PHG
  // RNA SYN UNA EST PAT STS GSS HTG HTC ENV CON TSA UNK. Match any
  // 3-letter uppercase token in that slot. VOG-1974.
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
  // VOG-1973: track whether the input ever entered ORIGIN. Combined with
  // `locus.length` (the LOCUS-declared length) we use this to detect
  // truncation. A NCBI / SnapGene / Geneious export that was cut off
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
      // VOG-2039 hotfix: `ACCESSION unknown` is a placeholder used by
      // Motif (and other tools) when no real NCBI accession exists.
      // Treat it as no-accession so the exporter doesn't later emit a
      // phantom `VERSION unknown.1` (the VOG-2001 pathology). NCBI uses
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
  let length = locus.length;
  if (!length && sequence.length > 0) {
    length = sequence.length;
  }

  // Phase 32 (Pass-Export P0-3): preserve source case verbatim. Phase 31 W13
  // only preserved mixed-case; uniformly UPPERCASE input was still flattened
  // to lowercase. Exporter now also preserves verbatim (export.ts), so a
  // round-trip through GenBank now survives case identity for all inputs.
  const preservedSequence = sequence;

  // VOG-1973: detect truncation. Three trip-wires, in order of severity:
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
