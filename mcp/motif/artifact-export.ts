import { createHash } from 'node:crypto';

import {
  MAX_MOTIF_ARTIFACT_HTML_BYTES,
  MOTIF_ARTIFACT_EXPORT_SCHEMA,
  motifArtifactExportSummarySchema,
  type MotifArtifactExportSummary,
  type MotifWorkbenchResult,
} from './contracts.js';

const DATA_TAG_PATTERN = /(<script type="application\/json" id="motif-artifact-data">)([\s\S]*?)(<\/script>)/u;
const BUILD_ID_META_PATTERN = /<meta name="motif-build-id" content="([a-f0-9]{64})"\s*\/?>/u;

function escapeJsonForScriptTag(json: string): string {
  return json
    .replace(/</gu, '\\u003C')
    .replace(/>/gu, '\\u003E')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
}

function escapedJsonByteLength(json: string): number {
  let bytes = 0;
  for (const character of json) {
    if (character === '<' || character === '>' || character === '&' || character === '\u2028' || character === '\u2029') {
      bytes += 6;
    } else {
      bytes += Buffer.byteLength(character, 'utf8');
    }
  }
  return bytes;
}

function safeArtifactBase(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
    .slice(0, 120) || 'motif-workbench';
}

export type RenderMotifArtifactRequest = {
  template: string;
  workbench: MotifWorkbenchResult;
  runtimeBuildId: string;
  title?: string;
  filename?: string;
};

export type RenderMotifArtifactResult = {
  html: string;
  summary: MotifArtifactExportSummary;
};

export function renderMotifArtifact(request: RenderMotifArtifactRequest): RenderMotifArtifactResult {
  const dataTag = DATA_TAG_PATTERN.exec(request.template);
  if (!dataTag) {
    throw new Error('Motif artifact template is missing its embedded data tag.');
  }
  if (!request.workbench.payload) {
    throw new Error('A payload or sequence artifact is required to create a shareable Motif workbench.');
  }
  const templateBuildId = request.template.match(BUILD_ID_META_PATTERN)?.[1];
  if (!templateBuildId || templateBuildId !== request.runtimeBuildId) {
    throw new Error('Motif artifact template build identity is missing or inconsistent. Rebuild the connector.');
  }
  const title = request.title?.trim() || request.workbench.sourceName?.replace(/\.[^.]+$/u, '') || 'Motif workbench';
  const requestedFilename = request.filename?.trim().replace(/\.html?$/iu, '');
  const filename = `${safeArtifactBase(requestedFilename || title)}.html`;
  const rawPayloadJson = JSON.stringify(request.workbench.payload);
  const escapedPayloadBytes = escapedJsonByteLength(rawPayloadJson);
  const closingTagStart = dataTag.index + dataTag[0].length;
  const fixedHtmlBytes = Buffer.byteLength(request.template.slice(0, dataTag.index), 'utf8')
    + Buffer.byteLength(dataTag[1], 'utf8')
    + Buffer.byteLength(dataTag[3], 'utf8')
    + Buffer.byteLength(request.template.slice(closingTagStart), 'utf8');
  const estimatedBytes = fixedHtmlBytes + escapedPayloadBytes;
  if (estimatedBytes > MAX_MOTIF_ARTIFACT_HTML_BYTES) {
    throw new Error(`Motif artifact HTML exceeds ${MAX_MOTIF_ARTIFACT_HTML_BYTES.toLocaleString()} bytes after safe payload escaping.`);
  }
  const payloadJson = escapeJsonForScriptTag(rawPayloadJson);
  const html = request.template.replace(
    DATA_TAG_PATTERN,
    (_match, openingTag: string, _payload: string, closingTag: string) => `${openingTag}${payloadJson}${closingTag}`,
  );
  const bytes = Buffer.byteLength(html, 'utf8');
  const summary = motifArtifactExportSummarySchema.parse({
    schema: MOTIF_ARTIFACT_EXPORT_SCHEMA,
    delivery: 'embedded-html-resource',
    visibleMountConfirmed: false,
    runtimeBuildId: request.runtimeBuildId,
    filename,
    ...(request.workbench.sourceName ? { sourceName: request.workbench.sourceName } : {}),
    recordCount: request.workbench.recordCount,
    residueCount: request.workbench.residueCount,
    bytes,
    htmlSha256: createHash('sha256').update(html, 'utf8').digest('hex'),
  });
  return { html, summary };
}
