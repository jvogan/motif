import type { SequenceType } from '../bio/types';
import {
  alignmentImageCellGeometry,
  resolveResidueCellColor,
  type AlignmentImageLayout,
  type AlignmentImagePalette,
  type MsaColorScheme,
} from './claude-science-msa';

export const MSA_IMAGE_FONT_STACK = "ui-monospace, 'SFMono-Regular', 'Menlo', 'Consolas', monospace";

export type ImageExportRow = { name: string; aligned: string; isTemplate: boolean };

export function fitImageLabel(name: string, labelWidth: number, fontSize: number): string {
  const maxChars = Math.max(1, Math.floor((labelWidth - 12) / Math.max(1, fontSize * 0.6)));
  if (name.length <= maxChars) return name;
  return maxChars <= 1 ? '…' : `${name.slice(0, maxChars - 1)}…`;
}

/** Column-tick spacing (in columns) aimed at roughly one label per ~64px. */
export function imageColumnTickStep(cellWidth: number): number {
  if (!Number.isFinite(cellWidth) || cellWidth <= 0) return 1;
  const target = Math.max(1, Math.ceil(64 / cellWidth));
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

export function imageSubtitle(layout: AlignmentImageLayout): string {
  const absoluteColumns = layout.columns.flatMap((slot) => slot.kind === 'column' ? [slot.column] : []);
  const hiddenCount = layout.columns.reduce((sum, slot) => sum + (slot.kind === 'elision' ? slot.hiddenCount : 0), 0);
  const first = absoluteColumns[0] ?? layout.startColumn;
  const last = absoluteColumns[absoluteColumns.length - 1] ?? first;
  return hiddenCount > 0
    ? `columns ${(first + 1).toLocaleString()}–${(last + 1).toLocaleString()} · ${hiddenCount.toLocaleString()} hidden · ${layout.rowCount} rows`
    : `columns ${(first + 1).toLocaleString()}–${(last + 1).toLocaleString()} · ${layout.rowCount} rows`;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => (
    char === '&' ? '&amp;'
      : char === '<' ? '&lt;'
        : char === '>' ? '&gt;'
          : char === '"' ? '&quot;'
            : '&#39;'
  ));
}

/** Stable decimal output for subpixel SVG geometry without hundredth-pixel collapse. */
function imageSvgNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

/** Build a self-contained SVG document from complete model-backed geometry. */
export function renderAlignmentImageSvg(
  rows: readonly ImageExportRow[],
  molecule: SequenceType,
  scheme: MsaColorScheme | null,
  layout: AlignmentImageLayout,
  title: string,
  palette: AlignmentImagePalette,
): string {
  const bg = palette.background;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}"`
    + ` viewBox="0 0 ${layout.width} ${layout.height}" font-family="${escapeXml(MSA_IMAGE_FONT_STACK)}">`,
  );
  parts.push(`<rect width="${layout.width}" height="${layout.height}" fill="${bg}"/>`);
  parts.push(`<rect width="${layout.labelWidth}" height="${layout.height}" fill="${escapeXml(palette.labelBackground)}"/>`);

  const titleSize = Math.max(10, Math.round(layout.titleHeight * 0.42));
  const subSize = Math.max(9, Math.round(layout.titleHeight * 0.3));
  parts.push(`<text x="8" y="${layout.titleHeight * 0.4}" fill="${escapeXml(palette.text)}" font-size="${titleSize}" font-weight="600" dominant-baseline="middle">${escapeXml(title)}</text>`);
  parts.push(`<text x="8" y="${layout.titleHeight * 0.76}" fill="${escapeXml(palette.muted)}" font-size="${subSize}" dominant-baseline="middle">${escapeXml(imageSubtitle(layout))}</text>`);

  const tickStep = imageColumnTickStep(layout.cellWidth);
  const axisSize = Math.max(8, Math.round(layout.axisHeight * 0.55));
  for (let index = 0; index < layout.columnCount; index += 1) {
    const slot = layout.columns[index];
    if (!slot) continue;
    const x = alignmentImageCellGeometry(layout, index).centerX;
    if (slot.kind === 'elision') {
      parts.push(`<text x="${imageSvgNumber(x)}" y="${layout.titleHeight + layout.axisHeight * 0.5}" fill="${escapeXml(palette.muted)}" font-size="${axisSize}" text-anchor="middle" dominant-baseline="middle">${escapeXml(`⋯${slot.hiddenCount.toLocaleString()}⋯`)}</text>`);
      continue;
    }
    const column = slot.column;
    if (index !== 0 && (column + 1) % tickStep !== 0) continue;
    parts.push(`<text x="${imageSvgNumber(x)}" y="${layout.titleHeight + layout.axisHeight * 0.5}" fill="${escapeXml(palette.muted)}" font-size="${axisSize}" text-anchor="middle" dominant-baseline="middle">${column + 1}</text>`);
  }

  const labelFontSize = Math.max(8, Math.min(layout.fontSize || 11, Math.round(layout.cellHeight * 0.62)));
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const y = layout.headerHeight + rowIndex * layout.cellHeight;
    for (let index = 0; scheme && index < layout.columnCount; index += 1) {
      const slot = layout.columns[index];
      if (!slot || slot.kind === 'elision') continue;
      const symbol = row.aligned[slot.column] ?? '-';
      const fill = resolveResidueCellColor(symbol, molecule, scheme, bg);
      if (!fill) continue;
      const geometry = alignmentImageCellGeometry(layout, index);
      const overdraw = Math.min(0.5, geometry.width * 0.05);
      const paintWidth = Math.min(layout.contentWidth - geometry.x, geometry.width + overdraw);
      parts.push(`<rect x="${imageSvgNumber(geometry.x)}" y="${imageSvgNumber(y)}" width="${imageSvgNumber(paintWidth)}" height="${imageSvgNumber(layout.cellHeight + Math.min(0.5, layout.cellHeight * 0.05))}" fill="${fill}"/>`);
    }
    if (layout.drawLetters) {
      for (let index = 0; index < layout.columnCount; index += 1) {
        const slot = layout.columns[index];
        if (!slot || slot.kind === 'elision') continue;
        const symbol = row.aligned[slot.column] ?? '-';
        if (symbol === '-' || symbol === '.') continue;
        const x = alignmentImageCellGeometry(layout, index).centerX;
        parts.push(`<text x="${imageSvgNumber(x)}" y="${imageSvgNumber(y + layout.cellHeight / 2)}" fill="${escapeXml(palette.text)}" font-size="${layout.fontSize}" text-anchor="middle" dominant-baseline="middle">${escapeXml(symbol)}</text>`);
      }
    }
    parts.push(`<rect x="0" y="${imageSvgNumber(y)}" width="${layout.labelWidth}" height="${imageSvgNumber(layout.cellHeight)}" fill="${escapeXml(palette.labelBackground)}"/>`);
    parts.push(`<text x="8" y="${imageSvgNumber(y + layout.cellHeight / 2)}" fill="${escapeXml(row.isTemplate ? palette.text : palette.muted)}" font-size="${labelFontSize}"${row.isTemplate ? ' font-weight="600"' : ''} dominant-baseline="middle">${escapeXml(fitImageLabel(row.name, layout.labelWidth, labelFontSize))}</text>`);
  }

  parts.push('</svg>');
  return parts.join('');
}
