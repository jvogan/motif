import { z } from 'zod';

export const MOTIF_WORKBENCH_RESULT_SCHEMA = 'motif.local-workbench-preparation.v1' as const;

export const motifWorkbenchPayloadSchema = z.record(z.string(), z.unknown());

export const preparedMotifWorkbenchSchema = z.object({
  schema: z.literal(MOTIF_WORKBENCH_RESULT_SCHEMA),
  mode: z.enum(['sample', 'payload', 'artifact']),
  sourceName: z.string().min(1).max(512).optional(),
  payload: motifWorkbenchPayloadSchema.optional(),
  recordCount: z.number().int().nonnegative().max(100),
  residueCount: z.number().int().nonnegative().max(25_000_000),
}).strict();

export type MotifWorkbenchPayload = z.infer<typeof motifWorkbenchPayloadSchema>;
export type PreparedMotifWorkbench = z.infer<typeof preparedMotifWorkbenchSchema>;
