import { PassThrough } from 'node:stream';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describe, expect, it } from 'vitest';

import { MOTIF_MCP_LIMITS } from '../payload.js';
import {
  createMotifStdioServerTransport,
  MCP_SDK_STDIO_DEFAULT_MAX_BUFFER_BYTES,
  MOTIF_STDIO_MAX_BUFFER_BYTES,
} from '../stdio-transport.js';

const TIMEOUT_MS = 5_000;

function notificationLine(dataBytes: number): string {
  return `${JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/message',
    params: { level: 'info', data: 'x'.repeat(dataBytes) },
  })}\n`;
}

describe('Motif MCP stdio transport boundary', () => {
  it('documents the installed 10 MiB default and configures room for advertised Motif payloads', () => {
    expect(MCP_SDK_STDIO_DEFAULT_MAX_BUFFER_BYTES).toBe(10 * 1024 * 1024);
    expect(MOTIF_STDIO_MAX_BUFFER_BYTES).toBeGreaterThan(MOTIF_MCP_LIMITS.maxPayloadBytes);
  });

  it('rejects a greater-than-10-MiB request on the SDK default transport', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = new StdioServerTransport(input, output);
    const failure = new Promise<Error>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for stdio overflow')), TIMEOUT_MS);
      transport.onerror = (error) => {
        clearTimeout(timer);
        resolve(error);
      };
    });
    await transport.start();
    input.end(notificationLine(MCP_SDK_STDIO_DEFAULT_MAX_BUFFER_BYTES));
    expect((await failure).message).toMatch(/exceeded maximum size of 10485760/u);
    await transport.close();
  });

  it('accepts the same request through Motif configured stdio streams', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = createMotifStdioServerTransport(input, output);
    const received = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for stdio message')), TIMEOUT_MS);
      transport.onerror = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      transport.onmessage = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
    await transport.start();
    input.end(notificationLine(MCP_SDK_STDIO_DEFAULT_MAX_BUFFER_BYTES));
    await expect(received).resolves.toMatchObject({
      jsonrpc: '2.0',
      method: 'notifications/message',
    });
    await transport.close();
  });
});
