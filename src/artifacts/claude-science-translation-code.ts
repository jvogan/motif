import {
  listTranslationTables,
  resolveTranslationTable,
  VALID_NCBI_TABLE_IDS,
} from '../bio/codon-tables';
import type { CodonTable } from '../bio/types';

export const DEFAULT_ARTIFACT_TRANSLATION_TABLE_ID = 1;

const supportedTranslationTableIds = new Set<number>(VALID_NCBI_TABLE_IDS);

export const ARTIFACT_TRANSLATION_CODE_OPTIONS = Object.freeze(
  [...listTranslationTables()]
    .sort((left, right) => left.id - right.id)
    .map((option) => Object.freeze({ ...option })),
);

export type ArtifactTranslationCodeSource = 'feature' | 'record' | 'default';

export type ArtifactTranslationCodeResolution =
  | Readonly<{
      supported: true;
      id: number;
      name: string;
      source: ArtifactTranslationCodeSource;
      table: CodonTable;
    }>
  | Readonly<{
      supported: false;
      id: null;
      requestedId: number | null;
      source: 'feature' | 'record';
      message: string;
    }>;

type TranslationTableQualifier = Readonly<{
  present: boolean;
  id: number | null;
  rawValue?: unknown;
}>;

function integerTranslationTableId(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** A supported, portable NCBI genetic-code id, or null for malformed/unknown input. */
export function normalizeArtifactTranslationTableId(value: unknown): number | null {
  const id = integerTranslationTableId(value);
  return id !== null && supportedTranslationTableIds.has(id) ? id : null;
}

export function isSupportedArtifactTranslationTableId(value: unknown): boolean {
  return normalizeArtifactTranslationTableId(value) !== null;
}

function featureTranslationTableQualifier(
  metadata: Readonly<Record<string, unknown>> | undefined,
): TranslationTableQualifier {
  if (!metadata) return { present: false, id: null };
  for (const key of ['transl_table', 'translTable', 'translationTableId'] as const) {
    if (!Object.prototype.hasOwnProperty.call(metadata, key)) continue;
    const rawValue = metadata[key];
    return {
      present: true,
      id: normalizeArtifactTranslationTableId(rawValue),
      rawValue,
    };
  }
  return { present: false, id: null };
}

/**
 * The imported/editor qualifier as a select-compatible string. Unsupported
 * numeric values remain visible; malformed values use a sentinel so an
 * unrelated feature edit cannot silently erase the original qualifier.
 */
export function artifactFeatureTranslationTableValue(
  metadata: Readonly<Record<string, unknown>> | undefined,
): string {
  const qualifier = featureTranslationTableQualifier(metadata);
  if (!qualifier.present) return '';
  const integer = integerTranslationTableId(qualifier.rawValue);
  return integer === null ? '__invalid__' : String(integer);
}

/**
 * Feature /transl_table wins over the record default. Unknown explicit values
 * block translation rather than silently falling back to the Standard code.
 */
export function resolveArtifactTranslationCode(
  recordTranslationTableId: unknown,
  featureMetadata?: Readonly<Record<string, unknown>>,
): ArtifactTranslationCodeResolution {
  const qualifier = featureTranslationTableQualifier(featureMetadata);
  if (qualifier.present) {
    if (qualifier.id === null) {
      const requestedId = integerTranslationTableId(qualifier.rawValue);
      return {
        supported: false,
        id: null,
        requestedId,
        source: 'feature',
        message: requestedId === null
          ? 'This feature has a malformed transl_table qualifier. Choose a supported NCBI genetic code in the feature editor before translating.'
          : `This feature requests unsupported NCBI translation table ${requestedId}. Choose a supported genetic code before translating.`,
      };
    }
    const resolved = resolveTranslationTable(qualifier.id);
    if (!resolved.supported) {
      return {
        supported: false,
        id: null,
        requestedId: resolved.requestedId,
        source: 'feature',
        message: resolved.message,
      };
    }
    return { supported: true, id: resolved.id, name: resolved.name, source: 'feature', table: resolved.table };
  }

  if (recordTranslationTableId !== undefined && recordTranslationTableId !== null) {
    const recordId = normalizeArtifactTranslationTableId(recordTranslationTableId);
    if (recordId === null) {
      const requestedId = integerTranslationTableId(recordTranslationTableId);
      return {
        supported: false,
        id: null,
        requestedId,
        source: 'record',
        message: requestedId === null
          ? 'This record has a malformed translationTableId. Choose a supported NCBI genetic code before translating.'
          : `This record requests unsupported NCBI translation table ${requestedId}. Choose a supported genetic code before translating.`,
      };
    }
    const resolved = resolveTranslationTable(recordId);
    if (!resolved.supported) {
      return {
        supported: false,
        id: null,
        requestedId: resolved.requestedId,
        source: 'record',
        message: resolved.message,
      };
    }
    return { supported: true, id: resolved.id, name: resolved.name, source: 'record', table: resolved.table };
  }

  const resolved = resolveTranslationTable(DEFAULT_ARTIFACT_TRANSLATION_TABLE_ID);
  if (!resolved.supported) {
    // The default is a shipped constant, so this is defensive rather than an
    // expected runtime branch. Keep the discriminated result honest if the
    // registry is ever changed independently.
    return {
      supported: false,
      id: null,
      requestedId: resolved.requestedId,
      source: 'record',
      message: resolved.message,
    };
  }
  return { supported: true, id: resolved.id, name: resolved.name, source: 'default', table: resolved.table };
}

export function artifactTranslationCodeLabel(
  code: Pick<Extract<ArtifactTranslationCodeResolution, { supported: true }>, 'id' | 'name'>,
): string {
  return `NCBI table ${code.id} — ${code.name}`;
}
