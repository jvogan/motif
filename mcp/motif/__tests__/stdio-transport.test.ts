import { PassThrough, Writable } from 'node:stream';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { describe, expect, it, vi } from 'vitest';

import { MOTIF_MCP_LIMITS } from '../payload.js';
import {
  createMotifStdioServerTransport,
  exitWhenTransportFails,
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

  it('keeps requests queued at the input while stdout is blocked and settles writes on close', async () => {
    const input = new PassThrough();
    const output = new Writable({ write(_bytes, _encoding, _callback) {} });
    const transport = createMotifStdioServerTransport(input, output);
    const receive = vi.fn();
    transport.onmessage = receive;
    await transport.start();
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    const result = { padding: 'x'.repeat(2_500_000) };
    const pending = Promise.allSettled([1, 2, 3, 4].map(id => transport.send({ jsonrpc: '2.0', id, result })));
    expect(output.writableLength).toBeLessThan(2_501_000);
    expect(output.listenerCount('drain')).toBe(0);
    output.destroy();
    expect((await pending).map(write => write.status)).toEqual(Array(4).fill('rejected'));
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it('finishes a stalled write after its output deadline', async () => {
    vi.useFakeTimers();
    try {
      const output = new Writable({ write(_bytes, _encoding, _callback) {} });
      const transport = createMotifStdioServerTransport(new PassThrough(), output);
      await transport.start();
      const rejected = expect(transport.send({ jsonrpc: '2.0', id: 1, result: {} })).rejects.toThrow(/output stalled/u);
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
      expect(output.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a slow client that is still draining a large response', async () => {
    vi.useFakeTimers();
    try {
      const bytesPerSecond = 512 * 1024;
      let drained = 0;
      const output = new Writable({
        write(bytes: Buffer, _encoding, callback) {
          setTimeout(() => {
            drained += bytes.length;
            callback();
          }, Math.ceil((bytes.length / bytesPerSecond) * 1_000));
        },
      });
      const transport = createMotifStdioServerTransport(new PassThrough(), output);
      await transport.start();
      const responseBytes = 24 * 1024 * 1024;
      const sent = transport.send({ jsonrpc: '2.0', id: 1, result: { html: 'x'.repeat(responseBytes) } });
      // Draining takes about 48 seconds, longer than the stall limit, while
      // the client keeps consuming output the whole time.
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(sent).resolves.toBeUndefined();
      expect(drained).toBeGreaterThan(responseBytes);
      expect(output.destroyed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits with status 1 and one stderr line after a stall, and not after input ends cleanly', async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const lines: string[] = [];
      const stalled = createMotifStdioServerTransport(new PassThrough(), new Writable({ write() {} }));
      exitWhenTransportFails(stalled, exit, line => lines.push(line));
      await stalled.start();
      void stalled.send({ jsonrpc: '2.0', id: 1, result: {} }).catch(() => {});
      await vi.advanceTimersByTimeAsync(30_000);
      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
      expect(lines).toEqual([expect.stringMatching(/restart the connector: Motif stdio output stalled/u)]);
      expect(lines[0]).toMatch(/\n$/u);
    } finally {
      vi.useRealTimers();
    }

    const cleanExit = vi.fn();
    const input = new PassThrough();
    const clean = createMotifStdioServerTransport(input, new PassThrough());
    exitWhenTransportFails(clean, cleanExit, () => {});
    const closeAfterExitCheck = clean.onclose;
    const closed = new Promise<void>(resolve => {
      clean.onclose = () => {
        closeAfterExitCheck?.();
        resolve();
      };
    });
    await clean.start();
    input.end();
    await closed;
    expect(cleanExit).not.toHaveBeenCalled();
  });

  it('closes when a client stops reading partway through a response', async () => {
    vi.useFakeTimers();
    try {
      let accepted = 0;
      const output = new Writable({
        write(_bytes, _encoding, callback) {
          accepted += 1;
          if (accepted <= 2) setTimeout(callback, 1_000);
        },
      });
      const transport = createMotifStdioServerTransport(new PassThrough(), output);
      await transport.start();
      const rejected = expect(transport.send({
        jsonrpc: '2.0', id: 1, result: { html: 'x'.repeat(4 * 1024 * 1024) },
      })).rejects.toThrow(/output stalled/u);
      await vi.advanceTimersByTimeAsync(2_000 + 30_000);
      await rejected;
      expect(accepted).toBe(3);
      expect(output.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers from a malformed frame and declines IDs outside the supported size', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = createMotifStdioServerTransport(input, output);
    const replies: Array<{ error: { code: number }; id?: string }> = [];
    output.on('data', line => replies.push(JSON.parse(line.toString())));
    const receive = vi.fn();
    transport.onmessage = receive;
    await transport.start();
    input.end(`not-json\n{"jsonrpc":"2.0","id":"${'x'.repeat(257)}","method":"ping"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n`);
    await vi.waitFor(() => expect(receive).toHaveBeenCalledTimes(1));
    expect(replies.map(reply => reply.error.code)).toEqual([-32700, -32600]);
    expect(replies.every(reply => reply.id === undefined)).toBe(true);
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
