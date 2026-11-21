import type { Feature, FeatureStrand, Topology } from './types';
import { hasFastaHeader } from './fasta-parser';

export const GFF3_WITHOUT_SEQUENCE = 'this GFF3 has features but no sequence, so import a GenBank or FASTA file, or a GFF3 with a ##FASTA section';

export function isGff3(text: string): boolean {
  // Version 3 may carry a minor and a patch number (`##gff-version 3.1.26`).
  return /^\s*##gff-version[ \t]+3(?:\.\d+){0,2}(?:\s|$)/.test(text);
}

/**
 * The length each `##sequence-region` directive declares, by sequence ID. A
 * ##FASTA sequence shorter than its declared region was cut off.
 */
export function gff3SequenceRegionEnds(annotations: string): Map<string, number> {
  const ends = new Map<string, number>();
  for (const match of annotations.matchAll(/^[ \t]*##sequence-region[ \t]+(\S+)[ \t]+(\d+)[ \t]+(\d+)[ \t]*\r?$/gm)) {
    ends.set(match[1], Number(match[3]));
  }
  return ends;
}

export function splitGff3(text: string): { annotations: string; fasta: string } | null {
  const marker = /^[ \t]*##FASTA[ \t]*\r?$/m.exec(text);
  if (!marker) return null;
  const fasta = text.slice(marker.index + marker[0].length).replace(/^\n/, '');
  return hasFastaHeader(fasta) ? { annotations: text.slice(0, marker.index), fasta } : null;
}

type Gff3Feature = Omit<Feature, 'type' | 'color'> & { type: string };
type FeatureRow = Omit<Gff3Feature, 'subRanges' | 'metadata'> & {
  attributes: Map<string, string>;
  phase: string;
};

// GFF3 escapes reserved characters as %XX. A bare `%` (as in `45% identity`)
// is common in real files and stays as written rather than refusing the file.
function decodeAttributeValue(value: string): string {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function readAttributes(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const field of text.split(';')) {
    const equals = field.indexOf('=');
    if (equals > 0) attributes.set(field.slice(0, equals).trim(), decodeAttributeValue(field.slice(equals + 1)));
  }
  return attributes;
}

function assembleFeature(rows: FeatureRow[]): Gff3Feature {
  rows.sort((a, b) => {
    const aPart = a.attributes.get('motif_part');
    const bPart = b.attributes.get('motif_part');
    if (aPart && bPart) return Number(aPart.split('/')[0]) - Number(bPart.split('/')[0]);
    return a.strand === -1 && b.strand === -1 ? b.end - a.end : a.start - b.start;
  });
  const [{ attributes, phase, ...feature }] = rows;
  const metadata: Record<string, unknown> = {};
  const table = attributes.get('transl_table');
  if (table) metadata.transl_table = table;
  if (feature.type.toLowerCase() === 'cds' && /^[012]$/.test(phase)) {
    metadata.codon_start = String(Number(phase) + 1);
  }
  const note = attributes.get('Note');
  if (note) metadata.note = note;

  if (rows.length > 1) {
    const subRanges = rows.map(({ start, end, strand }) => ({ start, end, strand }));
    feature.start = rows.reduce((start, row) => Math.min(start, row.start), feature.start);
    feature.end = rows.reduce((end, row) => Math.max(end, row.end), feature.end);
    const operator = attributes.get('motif_location_operator');
    if (operator === 'ambiguous') metadata.motifSubRangeOrderAmbiguous = true;
    else metadata.motifSubRangeOrder = 'biological';
    if (operator === 'order') metadata.motifLocationOperator = operator;
    return { ...feature, subRanges, metadata };
  }
  return { ...feature, metadata };
}

export function parseGff3Features(text: string): Map<string, Gff3Feature[]> {
  return parseGff3Annotations(text).features;
}

export function parseGff3Annotations(text: string, sequenceLengths?: ReadonlyMap<string, number>) {
  const bySequence = new Map<string, Map<string | number, FeatureRow[]>>();
  const landmarks = new Map<string, { name?: string; topology: Topology }>();
  for (const [index, line] of text.split(/\r\n?|\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const columns = line.split('\t');
    const [sequenceId, , type, first, last, , orientation, phase, attributeText = ''] = columns;
    const start = Number(first) - 1;
    const end = Number(last);
    const lineNumber = index + 1;
    // The ninth column holds attributes; a line that leaves it off has none.
    if ((columns.length !== 9 && columns.length !== 8) || !sequenceId || !type) {
      throw new Error(`GFF3 line ${lineNumber} has ${columns.length} tab-separated columns, not 9. Fix the line and retry.`);
    }
    if (!/^\d+$/.test(first) || !/^\d+$/.test(last) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start < 0 || end <= start) {
      throw new Error(`GFF3 line ${lineNumber} needs a start and end from 1 up, with the start no greater than the end. Fix the line and retry.`);
    }
    if (!['+', '-', '.', '?'].includes(orientation)) {
      throw new Error(`GFF3 line ${lineNumber} has strand "${orientation}"; use +, -, . or ?. Fix the line and retry.`);
    }
    const strand: FeatureStrand = orientation === '+' ? 1 : orientation === '-' ? -1 : 0;
    const attributes = readAttributes(attributeText);
    // The landmark feature spans its whole sequence and carries Is_circular. A
    // region landmark is the record itself, so it names the record and is not
    // kept as a feature; a landmark of another type (chromosome, plasmid) stays.
    const circular = attributes.get('Is_circular');
    if (start === 0 && end === sequenceLengths?.get(sequenceId) && (circular === 'true' || circular === 'false')) {
      const topology: Topology = circular === 'true' ? 'circular' : 'linear';
      if (type === 'region' || type === 'SO:0000001') {
        landmarks.set(sequenceId, { name: attributes.get('Name'), topology });
        continue;
      }
      if (!landmarks.has(sequenceId)) landmarks.set(sequenceId, { topology });
    }
    const id = attributes.get('ID');
    const name = attributes.get('Name') || attributes.get('gene') || id || type;
    let features = bySequence.get(sequenceId);
    if (!features) bySequence.set(sequenceId, features = new Map());
    const key = id || index;
    const row = { id: id || `gff3-feature-${index + 1}`, name, type, start, end, strand, attributes, phase };
    const parts = features.get(key);
    if (parts) parts.push(row);
    else features.set(key, [row]);
  }
  const features = new Map([...bySequence].map(([id, rows]) => [id, [...rows.values()].map(assembleFeature)]));
  return { features, landmarks };
}
