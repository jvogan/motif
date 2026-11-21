import { writeSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';

import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from '@modelcontextprotocol/sdk/shared/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, JSONRPCMessageSchema, type RequestId } from '@modelcontextprotocol/sdk/types.js';

import { MAX_MOTIF_ARTIFACT_HTML_BYTES } from './contracts.js';
import { MOTIF_MCP_LIMITS } from './payload.js';

/** The MCP TypeScript SDK's installed default for one newline-delimited message. */
export const MCP_SDK_STDIO_DEFAULT_MAX_BUFFER_BYTES = STDIO_DEFAULT_MAX_BUFFER_SIZE;

// Leave room for the JSON-RPC envelope and for escaping the embedded HTML.
export const MOTIF_STDIO_MAX_BUFFER_BYTES = MOTIF_MCP_LIMITS.maxPayloadBytes + 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * MAX_MOTIF_ARTIFACT_HTML_BYTES + 1024 * 1024;
const MAX_PENDING_WRITES = 4;
// The deadline detects a client that stops reading. It restarts after every
// slice the client drains, so a slow client that keeps reading is not dropped.
const WRITE_TIMEOUT_MS = 30_000;
const OUTPUT_SLICE_BYTES = 1024 * 1024;

type PendingWrite = {
  bytes: Buffer;
  written: number;
  responseId?: RequestId;
  resolve: () => void;
  reject: (error: Error) => void;
};

export function createMotifStdioServerTransport(
  stdin: Readable = process.stdin,
  stdout: Writable = process.stdout,
): Transport {
  let started = false;
  let closed = false;
  let ended = false;
  let activeRequest: RequestId | undefined;
  let remaining: Buffer | undefined;
  let frameBytes = 0;
  let fragments: Buffer[] = [];
  const writes: PendingWrite[] = [];
  let outputBytes = 0;
  let writeDeadline: ReturnType<typeof setTimeout> | undefined;

  const close = (failure?: Error) => {
    if (closed) return;
    closed = true;
    stdin.off('readable', read);
    stdin.off('end', end);
    stdin.off('close', inputClosed);
    stdin.off('error', inputError);
    stdout.off('error', outputError);
    stdout.off('close', outputError);
    stdout.off('finish', outputError);
    clearTimeout(writeDeadline);
    fragments = [];
    remaining = undefined;
    activeRequest = undefined;
    const reason = failure ?? new Error('Motif stdio transport closed.');
    for (const write of writes.splice(0)) write.reject(reason);
    if (failure) transport.onerror?.(failure);
    transport.onclose?.();
  };

  const inputError = () => close(new Error('Could not read Motif stdio input.'));
  const inputClosed = () => { if (!ended) inputError(); };
  const outputError = () => close(new Error('Could not write Motif stdio output.'));
  const end = () => {
    ended = true;
    read();
  };

  function writeNext() {
    const write = writes[0];
    if (!write) return;
    writeDeadline = setTimeout(() => {
      close(new Error('Motif stdio output stalled while writing a response.'));
      stdout.destroy();
    }, WRITE_TIMEOUT_MS);
    writeDeadline.unref();
    const slice = write.bytes.subarray(write.written, write.written + OUTPUT_SLICE_BYTES);
    stdout.write(slice, error => {
      // A Writable emits its error after invoking pending write callbacks.
      if (closed || error) return;
      clearTimeout(writeDeadline);
      write.written += slice.length;
      if (write.written < write.bytes.length) {
        writeNext();
        return;
      }
      writes.shift();
      outputBytes -= write.bytes.length;
      if (write.responseId !== undefined && write.responseId === activeRequest) activeRequest = undefined;
      write.resolve();
      if (writes.length) writeNext();
      else read();
    });
  }

  function invalidFrame(code: ErrorCode, message: string, id?: RequestId) {
    void transport.send({ jsonrpc: '2.0', error: { code, message }, ...(id === undefined ? {} : { id }) })
      .catch(() => {});
  }

  function dispatch(bytes: Buffer) {
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      invalidFrame(ErrorCode.ParseError, 'Invalid JSON in Motif stdio frame.');
      return;
    }
    const parsed = JSONRPCMessageSchema.safeParse(value);
    if (!parsed.success) {
      invalidFrame(ErrorCode.InvalidRequest, 'Invalid Motif JSON-RPC request.');
      return;
    }
    const message = parsed.data;
    if ('method' in message && 'id' in message) {
      if ((typeof message.id === 'string' && Buffer.byteLength(message.id) > 256)
        || (typeof message.id === 'number' && !Number.isSafeInteger(message.id))) {
        invalidFrame(ErrorCode.InvalidRequest, 'Motif JSON-RPC request ID exceeds supported bounds.');
        return;
      }
      if (message.method.length > 256) {
        invalidFrame(ErrorCode.InvalidRequest, 'Motif JSON-RPC method exceeds supported bounds.', message.id);
        return;
      }
      activeRequest = message.id;
    }
    transport.onmessage?.(message);
  }

  function read() {
    // The installed tools do not make client requests. Admit the next request
    // only after the current reply has cleared the output stream.
    while (!closed && activeRequest === undefined && writes.length === 0) {
      remaining ??= stdin.read() ?? undefined;
      if (!remaining) {
        if (ended) {
          if (frameBytes) close(new Error('Motif stdio input ended with an incomplete frame.'));
          else close();
        }
        return;
      }
      const newline = remaining.indexOf(0x0a);
      const length = newline < 0 ? remaining.length : newline;
      frameBytes += length;
      if (frameBytes > MOTIF_STDIO_MAX_BUFFER_BYTES) {
        close(new Error('Motif stdio frame exceeds 33 MiB. Split the workspace or reduce its size.'));
        return;
      }
      fragments.push(remaining.subarray(0, length));
      if (newline < 0) {
        remaining = undefined;
        continue;
      }
      remaining = newline + 1 < remaining.length ? remaining.subarray(newline + 1) : undefined;
      const frame = fragments.length === 1 ? fragments[0] : Buffer.concat(fragments, frameBytes);
      fragments = [];
      frameBytes = 0;
      dispatch(frame);
    }
  }

  const transport: Transport = {
    async start() {
      if (started || closed) throw new Error('Motif stdio transport cannot be started twice.');
      started = true;
      stdout.on('error', outputError);
      stdout.on('close', outputError);
      stdout.on('finish', outputError);
      stdin.on('error', inputError);
      stdin.on('close', inputClosed);
      stdin.on('end', end);
      stdin.on('readable', read);
    },
    async close() {
      close();
    },
    async send(message) {
      if (closed || stdout.destroyed || stdout.writableEnded) throw new Error('Motif stdio output is closed.');
      const bytes = Buffer.from(JSON.stringify(message) + '\n');
      if (writes.length >= MAX_PENDING_WRITES || bytes.length + outputBytes > MAX_OUTPUT_BYTES) {
        const error = new Error('Motif stdio output exceeds the response queue limit.');
        close(error);
        throw error;
      }
      return new Promise<void>((resolve, reject) => {
        const responseId = 'method' in message ? undefined : message.id;
        writes.push({ bytes, written: 0, responseId, resolve, reject });
        outputBytes += bytes.length;
        if (writes.length === 1) writeNext();
      });
    },
  };
  return transport;
}

function writeStderrLine(line: string): void {
  try {
    // Write synchronously: an asynchronous stderr write can be lost on exit.
    writeSync(2, line);
  } catch {
    // The host may have closed stderr as well; the exit status still reports it.
  }
}

/**
 * A transport that closed after a failure cannot answer again, and a stalled
 * stdout keeps the event loop running, so the process would stay alive but
 * silent. Exit with status 1 and one stderr line so the host can restart the
 * connector. Install before connecting; a clean close (input ended) does not
 * exit early.
 */
export function exitWhenTransportFails(
  transport: Transport,
  exit: (code: number) => void = code => process.exit(code),
  writeStderr: (line: string) => void = writeStderrLine,
): void {
  let failure: Error | undefined;
  const previousError = transport.onerror;
  const previousClose = transport.onclose;
  transport.onerror = (error) => {
    failure ??= error;
    previousError?.(error);
  };
  transport.onclose = () => {
    previousClose?.();
    if (!failure) return;
    writeStderr(`[motif-claude-science] Stopping after a stdio failure so the host can restart the connector: ${failure.message}\n`);
    exit(1);
  };
}
