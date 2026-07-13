export const SEQUENCE_VARIANT_KINDS = [
  'substitution',
  'insertion',
  'deletion',
  'indel',
  'other',
] as const;

export type SequenceVariantKind = typeof SEQUENCE_VARIANT_KINDS[number];

export interface SequenceVariant {
  id: string;
  /** 0-indexed anchor/start in the current sequence. */
  start: number;
  /** Optional exclusive end. Omitted/collapsed variants render as one-unit anchors. */
  end?: number;
  kind: SequenceVariantKind;
  label?: string;
  reference?: string;
  alternate?: string;
  source?: string;
  confidence?: number;
  color?: string;
  createdAt?: number;
  updatedAt?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isSequenceVariantKind(value: unknown): value is SequenceVariantKind {
  return typeof value === 'string' && (SEQUENCE_VARIANT_KINDS as readonly string[]).includes(value);
}

export function normalizeSequenceVariant(value: unknown): SequenceVariant | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = stringValue(record.id);
  const start = finiteNumber(record.start ?? record.position);
  if (!id || start === null) return null;
  const end = finiteNumber(record.end);
  const rawKind = record.kind ?? record.type;
  const kind = isSequenceVariantKind(rawKind) ? rawKind : 'other';
  const confidence = finiteNumber(record.confidence);
  const createdAt = finiteNumber(record.createdAt);
  const updatedAt = finiteNumber(record.updatedAt);
  return {
    id,
    start: Math.floor(start),
    ...(end === null ? {} : { end: Math.floor(end) }),
    kind,
    ...(stringValue(record.label) ? { label: stringValue(record.label) } : {}),
    ...(stringValue(record.reference ?? record.ref) ? { reference: stringValue(record.reference ?? record.ref) } : {}),
    ...(stringValue(record.alternate ?? record.alt) ? { alternate: stringValue(record.alternate ?? record.alt) } : {}),
    ...(stringValue(record.source) ? { source: stringValue(record.source) } : {}),
    ...(confidence === null ? {} : { confidence }),
    ...(stringValue(record.color) ? { color: stringValue(record.color) } : {}),
    ...(createdAt === null ? {} : { createdAt }),
    ...(updatedAt === null ? {} : { updatedAt }),
  };
}

export function normalizeSequenceVariants(value: unknown): SequenceVariant[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeSequenceVariant)
    .filter((variant): variant is SequenceVariant => Boolean(variant));
}

export function sequenceVariantLabel(variant: SequenceVariant): string {
  if (variant.label?.trim()) return variant.label.trim();
  const position = Math.max(0, Math.floor(variant.start)) + 1;
  const ref = variant.reference?.trim();
  const alt = variant.alternate?.trim();
  if (ref || alt) {
    switch (variant.kind) {
      case 'insertion':
        return `Insertion ${alt ?? ''} at ${position}`.trim();
      case 'deletion':
        return `Deletion ${ref ?? ''} at ${position}`.trim();
      default:
        return `${ref ?? '?'}>${alt ?? '?'} at ${position}`;
    }
  }
  return `Variant at ${position}`;
}

export function shiftSequenceVariants(
  variants: readonly SequenceVariant[],
  pos: number,
  delta: number,
): SequenceVariant[] {
  if (delta === 0 || variants.length === 0) return variants.map((variant) => ({ ...variant }));
  if (delta > 0) {
    return variants.map((variant) => ({
      ...variant,
      start: variant.start > pos ? variant.start + delta : variant.start,
      ...(variant.end === undefined ? {} : { end: variant.end > pos ? variant.end + delta : variant.end }),
    }));
  }

  const count = -delta;
  const endOfDeletion = pos + count;
  const shift = (coord: number): number => {
    if (coord >= endOfDeletion) return coord - count;
    if (coord > pos) return pos;
    return coord;
  };
  return variants.map((variant) => {
    const start = shift(variant.start);
    const end = variant.end === undefined ? undefined : Math.max(start, shift(variant.end));
    return { ...variant, start, ...(end === undefined ? {} : { end }) };
  });
}
