import { z } from 'zod';

export const MOTIF_WORKBENCH_RESOURCE_URI = 'ui://motif/workbench.html' as const;
export const MOTIF_WORKBENCH_RESULT_SCHEMA = 'motif.mcp.workbench.v1' as const;
export const MOTIF_ARTIFACT_EXPORT_SCHEMA = 'motif.mcp.artifact-export.v1' as const;
export const MAX_MOTIF_ARTIFACT_HTML_BYTES = 40 * 1024 * 1024;

export const motifWorkbenchPayloadSchema = z.record(z.string(), z.unknown());

export const preparedMotifWorkbenchSchema = z.object({
  schema: z.literal(MOTIF_WORKBENCH_RESULT_SCHEMA),
  mode: z.enum(['sample', 'payload', 'artifact']),
  sourceName: z.string().min(1).max(512).optional(),
  payload: motifWorkbenchPayloadSchema.optional(),
  recordCount: z.number().int().nonnegative().max(100),
  residueCount: z.number().int().nonnegative().max(25_000_000),
}).strict();

export const motifWorkbenchResultSchema = preparedMotifWorkbenchSchema.extend({
  delivery: z.literal('live-app-request'),
  visibleMountConfirmed: z.literal(false),
  fallbackTool: z.literal('motif_create_workbench_artifact'),
  runtimeBuildId: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export const motifArtifactExportSummarySchema = z.object({
  schema: z.literal(MOTIF_ARTIFACT_EXPORT_SCHEMA),
  delivery: z.literal('embedded-html-resource'),
  visibleMountConfirmed: z.literal(false),
  runtimeBuildId: z.string().regex(/^[a-f0-9]{64}$/u),
  filename: z.string().min(1).max(160),
  sourceName: z.string().min(1).max(512).optional(),
  recordCount: z.number().int().nonnegative().max(100),
  residueCount: z.number().int().nonnegative().max(25_000_000),
  bytes: z.number().int().positive().max(MAX_MOTIF_ARTIFACT_HTML_BYTES),
  htmlSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();

export type MotifWorkbenchPayload = z.infer<typeof motifWorkbenchPayloadSchema>;
export type PreparedMotifWorkbench = z.infer<typeof preparedMotifWorkbenchSchema>;
export type MotifWorkbenchResult = z.infer<typeof motifWorkbenchResultSchema>;
export type MotifArtifactExportSummary = z.infer<typeof motifArtifactExportSummarySchema>;
