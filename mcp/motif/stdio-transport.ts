import type { Readable, Writable } from 'node:stream';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js';

import { MOTIF_MCP_LIMITS } from './payload.js';

/** The MCP TypeScript SDK's installed default for one newline-delimited message. */
export const MCP_SDK_STDIO_DEFAULT_MAX_BUFFER_BYTES = STDIO_DEFAULT_MAX_BUFFER_SIZE;

/**
 * Allow the advertised 32 MiB Motif payload plus a bounded JSON-RPC envelope.
 * This controls requests received by the server; a host's receive limit remains
 * independently controlled by that host.
 */
export const MOTIF_STDIO_MAX_BUFFER_BYTES = MOTIF_MCP_LIMITS.maxPayloadBytes + (1024 * 1024);

export function createMotifStdioServerTransport(
  stdin?: Readable,
  stdout?: Writable,
): StdioServerTransport {
  return new StdioServerTransport(stdin, stdout, {
    maxBufferSize: MOTIF_STDIO_MAX_BUFFER_BYTES,
  });
}
