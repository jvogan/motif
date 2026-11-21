import { createHash } from 'node:crypto';
import { MAX_MOTIF_PRELOAD_BYTES } from '../../src/artifacts/motif-preload-limits.js';

import {
  MAX_MOTIF_ARTIFACT_HTML_BYTES,
  MOTIF_ARTIFACT_EXPORT_SCHEMA,
  MotifPreloadSizeError,
  motifArtifactExportSummarySchema,
  type MotifArtifactExportSummary,
  type PreparedMotifWorkbench,
} from './contracts.js';

const DATA_TAG_PATTERN = /(<script type="application\/json" id="motif-artifact-data">)([\s\S]*?)(<\/script>)/u;
const BUILD_ID_META_PATTERN = /<meta name="motif-build-id" content="([a-f0-9]{64})"\s*\/?>/u;

const SCRIPT_JSON_ESCAPES: Readonly<Record<string, string>> = {
  '<': '\\u003C',
  '>': '\\u003E',
  '&': '\\u0026',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029',
};

function escapedJsonByteLength(json: string): number {
  let bytes = Buffer.byteLength(json, 'utf8');
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index);
    if (code === 0x3c || code === 0x3e || code === 0x26) bytes += 5;
    if (code === 0x2028 || code === 0x2029) bytes += 3;
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
  workbench: PreparedMotifWorkbench;
  runtimeBuildId: string;
  title?: string;
  filename?: string;
};

export type RenderMotifArtifactResult = {
  html: string;
  summary: MotifArtifactExportSummary;
};

export function prepareMotifArtifactTemplate(template: string, runtimeBuildId: string) {
  const dataTag = DATA_TAG_PATTERN.exec(template);
  if (!dataTag) throw new Error('Motif artifact template is missing its embedded data tag.');
  const templateBuildId = template.match(BUILD_ID_META_PATTERN)?.[1];
  if (!templateBuildId || templateBuildId !== runtimeBuildId) {
    throw new Error('Motif artifact template build identity is missing or inconsistent. Rebuild the connector.');
  }
  const prefix = template.slice(0, dataTag.index + dataTag[1].length);
  const suffix = template.slice(dataTag.index + dataTag[0].length - dataTag[3].length);
  const fixedBytes = Buffer.byteLength(prefix) + Buffer.byteLength(suffix);
  return (request: Pick<RenderMotifArtifactRequest, 'workbench' | 'title' | 'filename'>): RenderMotifArtifactResult => {
    return renderWithTemplate(request, runtimeBuildId, prefix, suffix, fixedBytes);
  };
}

function renderWithTemplate(
  request: Pick<RenderMotifArtifactRequest, 'workbench' | 'title' | 'filename'>,
  runtimeBuildId: string,
  prefix: string,
  suffix: string,
  fixedBytes: number,
): RenderMotifArtifactResult {
  if (!request.workbench.payload) {
    throw new Error('A payload or sequence artifact is required to create a shareable Motif workbench.');
  }
  const title = request.title?.trim() || request.workbench.sourceName?.replace(/\.[^.]+$/u, '') || 'Motif workbench';
  const requestedFilename = request.filename?.trim().replace(/\.html?$/iu, '');
  const filename = `${safeArtifactBase(requestedFilename || title)}.html`;
  const rawPayloadJson = JSON.stringify(request.workbench.payload);
  const escapedPayloadBytes = escapedJsonByteLength(rawPayloadJson);
  if (escapedPayloadBytes > MAX_MOTIF_PRELOAD_BYTES) throw new MotifPreloadSizeError();
  const bytes = fixedBytes + escapedPayloadBytes;
  if (bytes > MAX_MOTIF_ARTIFACT_HTML_BYTES) {
    throw new Error(`Motif artifact HTML exceeds ${MAX_MOTIF_ARTIFACT_HTML_BYTES.toLocaleString()} bytes after safe payload escaping.`);
  }
  const html = prefix + rawPayloadJson.replace(/[<>&\u2028\u2029]/gu, char => SCRIPT_JSON_ESCAPES[char]) + suffix;
  const summary = motifArtifactExportSummarySchema.parse({
    schema: MOTIF_ARTIFACT_EXPORT_SCHEMA,
    delivery: 'embedded-html-resource',
    visibleMountConfirmed: false,
    runtimeBuildId,
    filename,
    ...(request.workbench.sourceName ? { sourceName: request.workbench.sourceName } : {}),
    recordCount: request.workbench.recordCount,
    residueCount: request.workbench.residueCount,
    bytes,
    htmlSha256: createHash('sha256').update(html, 'utf8').digest('hex'),
  });
  return { html, summary };
}


export function renderMotifArtifact(request: RenderMotifArtifactRequest): RenderMotifArtifactResult {
  return prepareMotifArtifactTemplate(request.template, request.runtimeBuildId)(request);
}
