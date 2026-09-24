import type { ArtifactAlignment } from './claude-science-msa';
import {
  alignmentCoverage,
  classifyMsaCell,
  coversColumn,
  isMsaCellDifference,
} from './claude-science-msa-cell-semantics';

/** Maximum retained variants when the caller does not provide a tighter cap. */
export const MSA_VARIANT_DEFAULT_LIMIT = 10_000;

export type MsaVariantKind = 'substitution' | 'insertion' | 'deletion';

export type MsaVariant = {
  /** Stable id of the aligned row carrying the difference. */
  rowId: string;
  /** Display name of the aligned row carrying the difference. */
  rowName: string;
  /** Absolute zero-based column in the full alignment, never a filtered or visible-window index. */
  column: number;
  /** Uppercase template residue, with either supported gap symbol normalized to '-'. */
  templateResidue: string;
  /** Uppercase row residue, with either supported gap symbol normalized to '-'. */
  residue: string;
  /** Biological relationship of the row residue to the template residue. */
  kind: MsaVariantKind;
  /** One-based ungapped template/reference position, or null when the template is gapped. */
  templatePosition: number | null;
  /** Compact residue-position-residue label using the viewer's active coordinate convention. */
  label: string;
};

export type ComputeMsaVariantsOptions = {
  /** Maximum number of variants to retain before returning an explicitly truncated result. */
  maxVariants?: number;
  /** Treat every covered unequal residue as a substitution instead of applying ambiguity compatibility. */
  strictDifferences?: boolean;
};

export type ComputeMsaVariantsResult = {
  /** Differences retained in absolute-column order and then alignment-row order. */
  variants: MsaVariant[];
  /** True when at least one additional difference exists beyond the retained list. */
  truncated: boolean;
};

export type MsaVariantRowSummary = {
  /** Stable id shared by the variants in this row. */
  rowId: string;
  /** Display name shared by the variants in this row. */
  rowName: string;
  /** Total retained variants in this row. */
  total: number;
  /** Retained substitutions in this row. */
  substitutions: number;
  /** Retained insertions in this row. */
  insertions: number;
  /** Retained deletions in this row. */
  deletions: number;
};

export type MsaVariantColumnSummary = {
  /** Absolute zero-based column in the full alignment. */
  column: number;
  /** Total retained variants at this column. */
  total: number;
  /** Retained substitutions at this column. */
  substitutions: number;
  /** Retained insertions at this column. */
  insertions: number;
  /** Retained deletions at this column. */
  deletions: number;
};

export type MsaVariantSummary = {
  /** Total retained variants represented by this summary. */
  total: number;
  /** Total retained substitutions. */
  substitutions: number;
  /** Total retained insertions. */
  insertions: number;
  /** Total retained deletions. */
  deletions: number;
  /** Per-row rollups in first-variant encounter order. */
  rows: MsaVariantRowSummary[];
  /** Per-column rollups in first-variant encounter order. */
  columns: MsaVariantColumnSummary[];
};

const GAP_CODE = '-'.charCodeAt(0);
const DOT_CODE = '.'.charCodeAt(0);
const LOWERCASE_A_CODE = 'a'.charCodeAt(0);
const LOWERCASE_Z_CODE = 'z'.charCodeAt(0);
const ASCII_CASE_OFFSET = 'a'.charCodeAt(0) - 'A'.charCodeAt(0);

function canonicalResidueCodeAt(aligned: string, column: number): number {
  const code = aligned.charCodeAt(column);
  if (!Number.isFinite(code) || code === GAP_CODE || code === DOT_CODE) return GAP_CODE;
  return code >= LOWERCASE_A_CODE && code <= LOWERCASE_Z_CODE ? code - ASCII_CASE_OFFSET : code;
}

function referenceInsertionCode(ordinal: number): string {
  let value = ordinal + 1;
  let code = '';
  while (value > 0) {
    value -= 1;
    code = String.fromCharCode(65 + (value % 26)) + code;
    value = Math.floor(value / 26);
  }
  return code;
}

function normalizedVariantLimit(maxVariants: number | undefined): number {
  if (maxVariants === undefined || !Number.isFinite(maxVariants)) return MSA_VARIANT_DEFAULT_LIMIT;
  return Math.max(0, Math.floor(maxVariants));
}

function incrementKind(
  summary: Pick<MsaVariantSummary, 'substitutions' | 'insertions' | 'deletions'>,
  kind: MsaVariantKind,
): void {
  if (kind === 'substitution') summary.substitutions += 1;
  else if (kind === 'insertion') summary.insertions += 1;
  else summary.deletions += 1;
}

/**
 * Compute row differences in one O(rows × columns) pass with O(variants)
 * retained space. Residue comparison uses numeric character codes so unchanged
 * cells do not allocate temporary strings or objects.
 */
export function computeMsaVariants(
  alignment: ArtifactAlignment,
  options: ComputeMsaVariantsOptions = {},
): ComputeMsaVariantsResult {
  const template = alignment.rows.find((row) => row.id === alignment.referenceRowId)
    ?? alignment.rows[0];
  if (!template) return { variants: [], truncated: false };

  const maxVariants = normalizedVariantLimit(options.maxVariants);
  const strictDifferences = options.strictDifferences ?? false;
  const variants: MsaVariant[] = [];
  // A row's leading and trailing gaps mean the row does not reach that far,
  // not that it lost those residues: a copy cut at base 2,000 of 2,686 would
  // otherwise list 686 deletions while its row badge reads 0 differences.
  // Columns past the template's own ends are skipped for the same reason.
  // This matches the row badge and the difference navigator.
  const templateCoverage = alignmentCoverage(template.aligned);
  const rowCoverage = new Map(alignment.rows.map((row) => [row.id, alignmentCoverage(row.aligned)]));
  const referenceNumbering = alignment.referenceNumbering;
  const numberingRow = referenceNumbering
    ? alignment.rows.find((row) => row.id === referenceNumbering.rowId)
    : undefined;
  const usesReferenceNumbering = referenceNumbering !== undefined && numberingRow !== undefined;
  let templatePosition = 0;
  let referencePosition = referenceNumbering?.firstResiduePosition ?? 1;
  referencePosition -= 1;
  let insertionOrdinal = 0;

  for (let column = 0; column < alignment.alignmentLength; column += 1) {
    const templateCode = canonicalResidueCodeAt(template.aligned, column);
    const templateIsGap = templateCode === GAP_CODE;
    if (!templateIsGap) templatePosition += 1;

    let referenceColumnIsGap = false;
    let currentInsertionOrdinal = 0;
    if (usesReferenceNumbering && numberingRow) {
      referenceColumnIsGap = canonicalResidueCodeAt(numberingRow.aligned, column) === GAP_CODE;
      if (referenceColumnIsGap) {
        currentInsertionOrdinal = insertionOrdinal;
        insertionOrdinal += 1;
      } else {
        referencePosition += 1;
        insertionOrdinal = 0;
      }
    }

    if (alignment.gapOnly[column] || !coversColumn(templateCoverage, column)) continue;

    for (let rowIndex = 0; rowIndex < alignment.rows.length; rowIndex += 1) {
      const row = alignment.rows[rowIndex];
      if (row.id === template.id) continue;
      const residueCode = canonicalResidueCodeAt(row.aligned, column);
      const normalizedTemplateResidue = String.fromCharCode(templateCode);
      const normalizedResidue = String.fromCharCode(residueCode);
      const outcome = classifyMsaCell(
        normalizedTemplateResidue,
        normalizedResidue,
        coversColumn(rowCoverage.get(row.id) ?? null, column),
        alignment.molecule,
        strictDifferences,
      );
      if (!isMsaCellDifference(outcome)) continue;

      if (variants.length >= maxVariants) return { variants, truncated: true };

      const kind: MsaVariantKind = outcome;
      const biologicalPosition = templateIsGap
        ? null
        : usesReferenceNumbering
          ? referencePosition
          : templatePosition;
      const positionLabel = usesReferenceNumbering
        ? `${referencePosition}${referenceColumnIsGap ? referenceInsertionCode(currentInsertionOrdinal) : ''}`
        : String(templateIsGap ? column + 1 : templatePosition);
      variants.push({
        rowId: row.id,
        rowName: row.name,
        // This is deliberately the full-alignment coordinate; viewport filters
        // must never leak relative indices into scientific results.
        column,
        templateResidue: normalizedTemplateResidue,
        residue: normalizedResidue,
        kind,
        templatePosition: biologicalPosition,
        label: `${normalizedTemplateResidue}${positionLabel}${normalizedResidue}`,
      });
    }
  }
  return { variants, truncated: false };
}

/** Summarize retained variants in one O(variants) pass with O(rows + columns) space. */
export function summarizeMsaVariants(variants: readonly MsaVariant[]): MsaVariantSummary {
  const summary: MsaVariantSummary = {
    total: variants.length,
    substitutions: 0,
    insertions: 0,
    deletions: 0,
    rows: [],
    columns: [],
  };
  const rowsById = new Map<string, MsaVariantRowSummary>();
  const columnsByIndex = new Map<number, MsaVariantColumnSummary>();

  for (const variant of variants) {
    incrementKind(summary, variant.kind);

    let row = rowsById.get(variant.rowId);
    if (!row) {
      row = {
        rowId: variant.rowId,
        rowName: variant.rowName,
        total: 0,
        substitutions: 0,
        insertions: 0,
        deletions: 0,
      };
      rowsById.set(variant.rowId, row);
      summary.rows.push(row);
    }
    row.total += 1;
    incrementKind(row, variant.kind);

    let column = columnsByIndex.get(variant.column);
    if (!column) {
      column = {
        column: variant.column,
        total: 0,
        substitutions: 0,
        insertions: 0,
        deletions: 0,
      };
      columnsByIndex.set(variant.column, column);
      summary.columns.push(column);
    }
    column.total += 1;
    incrementKind(column, variant.kind);
  }
  return summary;
}

/** One listed difference: a substitution, or a whole insertion or deletion. */
export type MsaVariantRun = {
  /** The run's first cell; a jump lands here. */
  first: MsaVariant;
  last: MsaVariant;
  /** Differing cells in the run. */
  length: number;
  templateResidues: string;
  residues: string;
  /** `T400C` for one cell, `700–702del` or `1204–1207ins` for a run. */
  label: string;
};

/**
 * Fold each row's consecutive inserted or deleted cells into one run, so a
 * 3 bp deletion lists as `700–702del (3 bp)` rather than three rows. Columns
 * where both the row and the template are gaps do not break a run. Each
 * substitution stays its own entry.
 */
export function groupMsaVariantRuns(
  variants: readonly MsaVariant[],
  alignment: ArtifactAlignment,
): MsaVariantRun[] {
  const template = alignment.rows.find((row) => row.id === alignment.referenceRowId) ?? alignment.rows[0];
  const rows = new Map(alignment.rows.map((row) => [row.id, row.aligned]));
  const open = new Map<string, MsaVariantRun>();
  const runs: MsaVariantRun[] = [];
  const onlyGapsBetween = (aligned: string, from: number, to: number) => {
    for (let column = from + 1; column < to; column += 1) {
      if (canonicalResidueCodeAt(aligned, column) !== GAP_CODE || canonicalResidueCodeAt(template.aligned, column) !== GAP_CODE) return false;
    }
    return true;
  };
  for (const variant of variants) {
    const run = open.get(variant.rowId);
    if (run && variant.kind !== 'substitution' && run.last.kind === variant.kind
      && onlyGapsBetween(rows.get(variant.rowId) ?? '', run.last.column, variant.column)) {
      run.last = variant;
      run.length += 1;
      run.templateResidues += variant.templateResidue;
      run.residues += variant.residue;
      run.label = `${run.first.label.slice(1, -1)}–${variant.label.slice(1, -1)}${variant.kind === 'deletion' ? 'del' : 'ins'}`;
      continue;
    }
    const next = { first: variant, last: variant, length: 1, templateResidues: variant.templateResidue, residues: variant.residue, label: variant.label };
    open.set(variant.rowId, next);
    runs.push(next);
  }
  // Without reference numbering an insertion's label held its alignment
  // column, which reads as a template position: "1548–1551ins" for bases
  // inserted after template 1,199. Name the two template bases it falls
  // between instead, in GenBank's between-bases form.
  if (!alignment.referenceNumbering) {
    let column = 0;
    let position = 0;
    for (const run of runs) {
      for (; column < run.first.column; column += 1) if (canonicalResidueCodeAt(template.aligned, column) !== GAP_CODE) position += 1;
      if (run.first.kind === 'insertion') run.label = `${position}^${position + 1}ins`;
    }
  }
  return runs;
}

export type MsaVariantCounts = Pick<MsaVariantSummary, 'total' | 'substitutions' | 'insertions' | 'deletions'>;

/**
 * Count every difference from the template without retaining any, so a view
 * that lists only the first few hundred can still state the full total.
 * Uses the same comparison as computeMsaVariants.
 */
export function countMsaVariants(
  alignment: ArtifactAlignment,
  options: Pick<ComputeMsaVariantsOptions, 'strictDifferences'> = {},
): MsaVariantCounts {
  const strictDifferences = options.strictDifferences ?? false;
  const counts: MsaVariantCounts = { total: 0, substitutions: 0, insertions: 0, deletions: 0 };
  const template = alignment.rows.find((row) => row.id === alignment.referenceRowId)
    ?? alignment.rows[0];
  if (!template) return counts;
  const templateCoverage = alignmentCoverage(template.aligned);
  const rowCoverage = alignment.rows.map((row) => alignmentCoverage(row.aligned));
  for (let column = 0; column < alignment.alignmentLength; column += 1) {
    if (alignment.gapOnly[column] || !coversColumn(templateCoverage, column)) continue;
    const templateResidue = String.fromCharCode(canonicalResidueCodeAt(template.aligned, column));
    for (let rowIndex = 0; rowIndex < alignment.rows.length; rowIndex += 1) {
      const row = alignment.rows[rowIndex];
      if (row.id === template.id) continue;
      const outcome = classifyMsaCell(
        templateResidue,
        String.fromCharCode(canonicalResidueCodeAt(row.aligned, column)),
        coversColumn(rowCoverage[rowIndex], column),
        alignment.molecule,
        strictDifferences,
      );
      if (!isMsaCellDifference(outcome)) continue;
      counts.total += 1;
      incrementKind(counts, outcome);
    }
  }
  return counts;
}
