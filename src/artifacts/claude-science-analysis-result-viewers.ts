import type {
  ArtifactAnalysisAsset,
  ArtifactAnalysisResult,
  ArtifactBlastHit,
  ArtifactReportData,
  ArtifactTableData,
} from './claude-science-analysis-results';

export type ArtifactBlastSortKey = 'evalue' | 'bit_score' | 'identity' | 'coverage' | 'accession';

export type ArtifactTextPage = {
  pageIndex: number;
  pageCount: number;
  start: number;
  end: number;
  text: string;
};

type ArtifactReportResult = Extract<ArtifactAnalysisResult, { kind: 'report' }>;

export type ResolvedArtifactReport = {
  text: string;
  format: ArtifactReportData['format'];
  sourceAsset?: ArtifactAnalysisAsset;
};

function compareNumbers(left: number, right: number, direction: 1 | -1): number {
  return (left - right) * direction;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBlastHits(
  left: ArtifactBlastHit,
  right: ArtifactBlastHit,
  sortKey: ArtifactBlastSortKey,
): number {
  if (sortKey === 'evalue') return compareNumbers(left.eValue, right.eValue, 1);
  if (sortKey === 'bit_score') return compareNumbers(left.bitScore, right.bitScore, -1);
  if (sortKey === 'identity') return compareNumbers(left.identityPercent, right.identityPercent, -1);
  if (sortKey === 'coverage') return compareNumbers(left.queryCoveragePercent, right.queryCoveragePercent, -1);
  return compareStrings(left.accession, right.accession);
}

/** Return a deterministic copy; never mutate the result payload supplied by the workspace. */
export function sortArtifactBlastHits(
  hits: readonly ArtifactBlastHit[],
  sortKey: ArtifactBlastSortKey,
): ArtifactBlastHit[] {
  return hits.map((hit, originalIndex) => ({ hit, originalIndex }))
    .sort((left, right) => (
      compareBlastHits(left.hit, right.hit, sortKey)
      || compareNumbers(left.hit.eValue, right.hit.eValue, 1)
      || compareNumbers(left.hit.bitScore, right.hit.bitScore, -1)
      || compareStrings(left.hit.accession, right.hit.accession)
      || left.originalIndex - right.originalIndex
    ))
    .map(({ hit }) => hit);
}

/**
 * Result-specific asset references are part of the typed schema even when a
 * producer does not repeat them in the generic assetIds list.
 */
export function artifactAnalysisResultAssetIds(result: ArtifactAnalysisResult): string[] {
  const ids = new Set(result.assetIds);
  if (result.kind === 'blast_search') {
    result.data.hits.forEach((hit) => {
      if (hit.alignmentAssetId) ids.add(hit.alignmentAssetId);
    });
  }
  if (result.kind === 'structure_model') ids.add(result.data.modelAssetId);
  if (result.kind === 'report' && result.data.bodyAssetId) ids.add(result.data.bodyAssetId);
  if (result.kind === 'construct_verification' && result.data.verificationReportAssetId) {
    ids.add(result.data.verificationReportAssetId);
  }
  return Array.from(ids);
}

export function artifactAnalysisResultAssets(
  result: ArtifactAnalysisResult,
  assetsById: ReadonlyMap<string, ArtifactAnalysisAsset>,
): ArtifactAnalysisAsset[] {
  return artifactAnalysisResultAssetIds(result)
    .map((id) => assetsById.get(id))
    .filter((asset): asset is ArtifactAnalysisAsset => asset !== undefined);
}

export function resolveArtifactReport(
  result: ArtifactReportResult,
  assetsById: ReadonlyMap<string, ArtifactAnalysisAsset>,
): ResolvedArtifactReport | null {
  if (result.data.body !== undefined) {
    return { text: result.data.body, format: result.data.format };
  }
  if (!result.data.bodyAssetId) return null;
  const sourceAsset = assetsById.get(result.data.bodyAssetId);
  return sourceAsset
    ? { text: sourceAsset.content, format: result.data.format, sourceAsset }
    : null;
}

function startsWithSpreadsheetFormula(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (/\s/u.test(character) || codePoint < 32 || codePoint === 127) continue;
    return character === '=' || character === '+' || character === '-' || character === '@';
  }
  return false;
}

function tsvCell(value: string | number | boolean | null): string {
  const rawText = value === null ? '' : String(value);
  // Spreadsheet applications can execute string cells beginning with formula
  // markers. Prefix those cells with an apostrophe so copied/downloaded TSV is
  // interpreted as literal scientific data. Numeric values remain numeric.
  const text = typeof value === 'string' && startsWithSpreadsheetFormula(value)
    ? `'${rawText}`
    : rawText;
  return /[\t\r\n"]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** Serialize every row as spreadsheet-safe TSV; callers invoke this only from explicit actions. */
export function artifactTableToTsv(data: ArtifactTableData): string {
  return [
    data.columns.map((column) => tsvCell(column.label)).join('\t'),
    ...data.rows.map((row) => row.map(tsvCell).join('\t')),
  ].join('\n');
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

/** Page bounded text without cutting a UTF-16 surrogate pair between pages. */
export function artifactTextPage(
  text: string,
  requestedPage: number,
  pageSize: number,
): ArtifactTextPage {
  if (!Number.isSafeInteger(pageSize) || pageSize < 2) {
    throw new Error('Text page size must be a safe integer of at least 2.');
  }
  const bounds: Array<{ start: number; end: number }> = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + pageSize);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    if (end <= start) end = Math.min(text.length, start + pageSize);
    bounds.push({ start, end });
    start = end;
  }
  if (bounds.length === 0) bounds.push({ start: 0, end: 0 });
  const normalizedPage = Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0;
  const pageIndex = Math.max(0, Math.min(normalizedPage, bounds.length - 1));
  const active = bounds[pageIndex];
  return {
    pageIndex,
    pageCount: bounds.length,
    start: active.start,
    end: active.end,
    text: text.slice(active.start, active.end),
  };
}

const UNSAFE_FILENAME_CHARACTERS = /[<>:"/\\|?*]+/g;

function replaceFilenameControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 32 || codePoint === 127) return '-';
    return /\p{Cf}/u.test(character) ? '' : character;
  }).join('');
}

export function safeAnalysisFilename(
  name: string,
  fallback: string,
  extension: string,
): string {
  const safeExtension = extension.replace(/^\.+/, '').replace(/[^a-z0-9_-]/gi, '') || 'txt';
  const normalizedStem = replaceFilenameControlCharacters(name)
    .replace(UNSAFE_FILENAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+/g, '')
    .replace(/[. ]+$/g, '')
    .trim();
  const stem = Array.from(normalizedStem).slice(0, 120).join('') || fallback;
  return stem.toLocaleLowerCase().endsWith(`.${safeExtension.toLocaleLowerCase()}`)
    ? stem
    : `${stem}.${safeExtension}`;
}
