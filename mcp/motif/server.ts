import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ReadResourceResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { renderMotifArtifact } from './artifact-export.js';
import {
  MOTIF_WORKBENCH_RESOURCE_URI,
  motifArtifactExportSummarySchema,
  motifWorkbenchResultSchema,
} from './contracts.js';
import {
  MOTIF_MCP_LIMITS,
  prepareMotifWorkbench,
  type MotifWorkbenchInput,
} from './payload.js';

export type MotifClaudeScienceServerOptions = {
  version: string;
  readWorkbenchHtml: () => Promise<string>;
  readArtifactTemplate: () => Promise<string>;
  trace?: (event: MotifMcpTraceEvent) => void;
};

export type MotifMcpTraceEvent = {
  event: 'resource.registered' | 'resource.read.start' | 'resource.read.finish' | 'tool.start' | 'tool.finish';
  requestId?: string;
  tool?: string;
  uri?: string;
  mode?: 'sample' | 'payload' | 'artifact';
  status?: 'ok' | 'error';
  recordCount?: number;
  residueCount?: number;
  durationMs?: number;
  error?: string;
};

const readOnlyAnnotations = (title: string): ToolAnnotations => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const workbenchInputShape = {
  payload: z.record(z.string(), z.unknown()).optional()
    .describe('A bounded Motif inventory payload. Use content instead when opening FASTA, GenBank, or raw sequence text.'),
  content: z.string().min(1).max(MOTIF_MCP_LIMITS.maxContentBytes).optional()
    .describe('FASTA, GenBank, raw sequence, or Motif inventory JSON content.'),
  filename: z.string().min(1).max(512).optional()
    .describe('Source filename used for format hints and a visible provenance label.'),
  title: z.string().min(1).max(512).optional(),
  molecule: z.enum(['dna', 'rna', 'protein']).optional()
    .describe('Explicit molecule type for raw or ambiguous FASTA sequence text.'),
  topology: z.enum(['linear', 'circular']).optional(),
};

const workbenchInputSchema = z.object(workbenchInputShape).strict().superRefine((input, context) => {
  if (input.payload !== undefined && input.content !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['content'],
      message: 'Provide either payload or content, not both.',
    });
  }
});

const artifactInputSchema = z.object({
  ...workbenchInputShape,
  outputFilename: z.string().min(1).max(160).optional()
    .describe('Safe suggested filename for the returned embedded HTML resource.'),
}).strict().superRefine((input, context) => {
  if (input.payload !== undefined && input.content !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['content'],
      message: 'Provide either payload or content, not both.',
    });
  }
  if (input.payload === undefined && input.content === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['payload'],
      message: 'A payload or sequence artifact is required.',
    });
  }
});

const workbenchCsp = {
  connectDomains: [] as string[],
  resourceDomains: [] as string[],
  frameDomains: [] as string[],
  baseUriDomains: [] as string[],
};

const motifArtifactViewerBinding = {
  opensMimeTypes: [
    'text/plain',
    'text/x-fasta',
    'application/x-fasta',
    'text/x-genbank',
    'application/x-genbank',
    'chemical/seq-na-fasta',
    'chemical/seq-na-genbank',
  ],
  opensExtensions: [
    '.gb', '.gbk', '.gbff', '.genbank',
    '.fa', '.fasta', '.fna', '.faa', '.seq',
  ],
  contentParam: 'content',
  nameParam: 'filename',
  promptHint:
    'Open FASTA and GenBank artifacts in Motif for Claude Science. Preserve exact sequence data and use the registered viewer.',
};

function appToolMetadata(visibility: Array<'model' | 'app'>) {
  return {
    ui: {
      resourceUri: MOTIF_WORKBENCH_RESOURCE_URI,
      visibility,
    },
    'ui/resourceUri': MOTIF_WORKBENCH_RESOURCE_URI,
  };
}

function appendWorkbenchResourceLink(result: CallToolResult): CallToolResult {
  if (result.isError || result.content.some(item => (
    item.type === 'resource_link' && item.uri === MOTIF_WORKBENCH_RESOURCE_URI
  ))) {
    return result;
  }
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: 'resource_link',
        uri: MOTIF_WORKBENCH_RESOURCE_URI,
        name: 'Motif for Claude Science workbench',
        description: 'Open the interactive Motif molecular-biology workbench.',
        mimeType: RESOURCE_MIME_TYPE,
      },
    ],
  };
}

function publicToolFailure(error: unknown): CallToolResult {
  const message = error instanceof Error && error.message.trim()
    ? error.message
    : 'Motif could not complete the request.';
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function emitTrace(options: MotifClaudeScienceServerOptions, event: MotifMcpTraceEvent): void {
  try {
    options.trace?.(event);
  } catch {
    // Diagnostics must never affect the MCP protocol.
  }
}

function workbenchSummaryText(result: ReturnType<typeof prepareMotifWorkbench>): string {
  if (result.mode === 'sample') {
    return 'Motif for Claude Science workbench requested with its bundled sample inventory. Host rendering is a separate client action.';
  }
  const source = result.sourceName ? ` from ${result.sourceName}` : '';
  return `Motif for Claude Science workbench requested${source} with ${result.recordCount} record${result.recordCount === 1 ? '' : 's'} and ${result.residueCount.toLocaleString()} residues. Host rendering is a separate client action.`;
}

export function createMotifClaudeScienceServer(options: MotifClaudeScienceServerOptions): McpServer {
  const server = new McpServer({
    name: 'motif-claude-science',
    version: options.version,
  });
  let traceSequence = 0;
  const startTrace = (tool: string) => {
    const span = { requestId: `tool-${++traceSequence}`, tool, startedAt: Date.now() };
    emitTrace(options, { event: 'tool.start', requestId: span.requestId, tool });
    return span;
  };
  const finishTrace = (
    span: { requestId: string; tool: string; startedAt: number },
    status: 'ok' | 'error',
    fields: Omit<MotifMcpTraceEvent, 'event' | 'requestId' | 'tool' | 'status' | 'durationMs'> = {},
  ) => emitTrace(options, {
    event: 'tool.finish',
    requestId: span.requestId,
    tool: span.tool,
    status,
    durationMs: Math.max(0, Date.now() - span.startedAt),
    ...fields,
  });

  registerAppTool(
    server,
    'motif_open_workbench',
    {
      title: 'Open Motif for Claude Science',
      description:
        'Open the interactive Motif molecular-biology workbench. Accepts a bounded Motif inventory payload or exact FASTA, GenBank, raw sequence, or Motif JSON content. With no data, opens the bundled sample inventory. This read-only tool does not write a database or run external executables.',
      inputSchema: workbenchInputSchema,
      outputSchema: motifWorkbenchResultSchema,
      annotations: readOnlyAnnotations('Open Motif for Claude Science'),
      _meta: {
        ...appToolMetadata(['model', 'app']),
        'operon.dev/viewer': motifArtifactViewerBinding,
      },
    },
    async (args): Promise<CallToolResult> => {
      const trace = startTrace('motif_open_workbench');
      try {
        const input = workbenchInputSchema.parse(args) as MotifWorkbenchInput;
        const result = prepareMotifWorkbench(input);
        finishTrace(trace, 'ok', {
          mode: result.mode,
          recordCount: result.recordCount,
          residueCount: result.residueCount,
        });
        return appendWorkbenchResourceLink({
          structuredContent: result,
          content: [{ type: 'text', text: workbenchSummaryText(result) }],
        });
      } catch (error) {
        finishTrace(trace, 'error', { error: error instanceof Error ? error.name : 'Error' });
        return publicToolFailure(error);
      }
    },
  );

  server.registerTool(
    'motif_create_workbench_artifact',
    {
      title: 'Create a shareable Motif workbench artifact',
      description:
        'Return a self-contained Motif for Claude Science HTML workbench containing a bounded inventory payload or exact FASTA, GenBank, raw sequence, or Motif JSON content. This reliable fallback is useful when a host does not mount the live MCP App. It returns an embedded resource and does not write a file.',
      inputSchema: artifactInputSchema,
      outputSchema: motifArtifactExportSummarySchema,
      annotations: readOnlyAnnotations('Create a shareable Motif workbench artifact'),
    },
    async (args): Promise<CallToolResult> => {
      const trace = startTrace('motif_create_workbench_artifact');
      try {
        const input = artifactInputSchema.parse(args) as MotifWorkbenchInput & { outputFilename?: string };
        const workbench = prepareMotifWorkbench(input);
        const artifact = renderMotifArtifact({
          template: await options.readArtifactTemplate(),
          workbench,
          ...(input.title ? { title: input.title } : {}),
          ...(input.outputFilename ? { filename: input.outputFilename } : {}),
        });
        finishTrace(trace, 'ok', {
          mode: workbench.mode,
          recordCount: artifact.summary.recordCount,
          residueCount: artifact.summary.residueCount,
        });
        return {
          structuredContent: artifact.summary,
          content: [
            {
              type: 'text',
              text: `Prepared self-contained Motif for Claude Science workbench ${artifact.summary.filename} with ${artifact.summary.recordCount} record${artifact.summary.recordCount === 1 ? '' : 's'}. No file was written. Save or open the attached HTML resource in Claude Science.`,
            },
            {
              type: 'resource',
              resource: {
                uri: `motif://artifact/${encodeURIComponent(artifact.summary.filename)}`,
                mimeType: 'text/html',
                text: artifact.html,
              },
            },
          ],
        };
      } catch (error) {
        finishTrace(trace, 'error', { error: error instanceof Error ? error.name : 'Error' });
        return publicToolFailure(error);
      }
    },
  );

  emitTrace(options, { event: 'resource.registered', uri: MOTIF_WORKBENCH_RESOURCE_URI });
  registerAppResource(
    server,
    'Motif for Claude Science workbench',
    MOTIF_WORKBENCH_RESOURCE_URI,
    {
      description: 'Interactive Motif molecular-biology workbench for Claude Science.',
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        csp: workbenchCsp,
        prefersBorder: false,
        ui: { prefersBorder: false, csp: workbenchCsp },
      },
    },
    async (): Promise<ReadResourceResult> => {
      const requestId = `resource-${++traceSequence}`;
      const startedAt = Date.now();
      emitTrace(options, { event: 'resource.read.start', requestId, uri: MOTIF_WORKBENCH_RESOURCE_URI });
      try {
        const text = await options.readWorkbenchHtml();
        emitTrace(options, {
          event: 'resource.read.finish',
          requestId,
          uri: MOTIF_WORKBENCH_RESOURCE_URI,
          status: 'ok',
          durationMs: Math.max(0, Date.now() - startedAt),
        });
        return {
          contents: [{
            uri: MOTIF_WORKBENCH_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text,
            _meta: {
              csp: workbenchCsp,
              prefersBorder: false,
              ui: { prefersBorder: false, csp: workbenchCsp },
            },
          }],
        };
      } catch (error) {
        emitTrace(options, {
          event: 'resource.read.finish',
          requestId,
          uri: MOTIF_WORKBENCH_RESOURCE_URI,
          status: 'error',
          durationMs: Math.max(0, Date.now() - startedAt),
          error: error instanceof Error ? error.name : 'Error',
        });
        throw error;
      }
    },
  );

  return server;
}
