import { createHash } from 'node:crypto';

import {
  MOTIF_ARTIFACT_EXPORT_SCHEMA,
  motifArtifactExportSummarySchema,
  type MotifArtifactExportSummary,
  type MotifWorkbenchResult,
} from './contracts.js';

const DATA_TAG_PATTERN = /(<script type="application\/json" id="motif-artifact-data">)([\s\S]*?)(<\/script>)/u;
const BUILD_ID_META_PATTERN = /<meta name="motif-build-id" content="([a-f0-9]{64})"\s*\/?>/u;

function jsonForScriptTag(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</gu, '\\u003C')
    .replace(/>/gu, '\\u003E')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
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
  if (!DATA_TAG_PATTERN.test(request.template)) {
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
  const payloadJson = jsonForScriptTag(request.workbench.payload);
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
