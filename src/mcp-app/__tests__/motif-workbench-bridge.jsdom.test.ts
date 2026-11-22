// @vitest-environment jsdom

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MotifWorkbenchPayload } from '../../../mcp/motif/contracts.js';
import { applyMotifToolResult, MOTIF_BRIDGE_MESSAGES, startMotifMcpBridge } from '../motif-workbench-bridge.js';

type TestRuntimeWindow = Window & {
  motifReplaceWorkspace?: (payload: MotifWorkbenchPayload) => number;
  motifHostDownload?: (filename: string, text: string, mimeType: string) => Promise<boolean>;
};

const buildId = 'a'.repeat(64);

function result(structuredContent: Record<string, unknown>): CallToolResult {
  return {
    structuredContent: {
      delivery: 'live-app-request',
      visibleMountConfirmed: false,
      fallbackTool: 'motif_create_workbench_artifact',
      runtimeBuildId: buildId,
      ...structuredContent,
    },
    content: [{ type: 'text', text: 'test' }],
  };
}

beforeEach(() => {
  document.head.insertAdjacentHTML('beforeend', `<meta name="motif-build-id" content="${buildId}">`);
});

afterEach(() => {
  document.querySelector('meta[name="motif-build-id"]')?.remove();
  delete document.documentElement.dataset.motifMcpHydrated;
  delete (window as TestRuntimeWindow).motifReplaceWorkspace;
  delete document.documentElement.dataset.motifMcpState;
  delete document.documentElement.dataset.motifMcpMessage;
  document.getElementById('motif-mcp-notice')?.remove();
});

describe('Motif MCP App bridge hydration', () => {
  it('validates parent messages without logging their data', async () => {
    const sentinel = 'private-workspace-message-marker';
    const payload = { records: [], inventory: { title: sentinel } };
    const logs = (['debug', 'log', 'info', 'warn', 'error'] as const).map(level => (
      vi.spyOn(console, level).mockImplementation(() => {})
    ));
    const receive = (data: unknown, source: Window | null = window.parent) => {
      window.dispatchEvent(new MessageEvent('message', { source, data }));
    };
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(message => {
      if (message.method !== 'ui/initialize') return;
      queueMicrotask(() => receive({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params.protocolVersion,
          hostInfo: { name: 'test-host', version: '1' },
          hostCapabilities: {},
          hostContext: {},
        },
      }));
    });
    const replaceWorkspace = vi.fn(() => 0);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;
    const toolResult = {
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: result({ schema: 'motif.mcp.workbench.v1', mode: 'payload', payload, recordCount: 0, residueCount: 0 }),
    };
    let app: Awaited<ReturnType<typeof startMotifMcpBridge>> | undefined;
    try {
      app = await startMotifMcpBridge();
      receive(toolResult, null);
      receive({ jsonrpc: '2.0', method: { sentinel }, params: toolResult.params });
      await Promise.resolve();
      expect(replaceWorkspace).not.toHaveBeenCalled();
      receive(toolResult);
      await vi.waitFor(() => expect(replaceWorkspace).toHaveBeenCalledExactlyOnceWith(payload));
      receive({ jsonrpc: '2.0', id: 'ping-test', method: 'ping', params: { _meta: { marker: sentinel } } });
      await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({
        jsonrpc: '2.0', id: 'ping-test', result: {},
      }, '*'));
      await app.close();
      app = undefined;
      receive(toolResult);
      await Promise.resolve();
      expect(replaceWorkspace).toHaveBeenCalledTimes(1);
      for (const log of logs) expect(inspect(log.mock.calls, { depth: null })).not.toContain(sentinel);
    } finally {
      await app?.close();
      postMessage.mockRestore();
      logs.forEach(log => log.mockRestore());
    }
  });

  it('cancels runtime polling, replies to teardown, and closes the transport', async () => {
    vi.useFakeTimers();
    const receive = (data: unknown) => {
      window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }));
    };
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(message => {
      if (message.method !== 'ui/initialize') return;
      receive({
        jsonrpc: '2.0', id: message.id,
        result: {
          protocolVersion: message.params.protocolVersion,
          hostInfo: { name: 'test-host', version: '1' },
          hostCapabilities: {}, hostContext: {},
        },
      });
    });
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const toolResult = {
      jsonrpc: '2.0', method: 'ui/notifications/tool-result',
      params: result({ schema: 'motif.mcp.workbench.v1', mode: 'payload', payload: { records: [] }, recordCount: 0, residueCount: 0 }),
    };
    let app: Awaited<ReturnType<typeof startMotifMcpBridge>> | undefined;
    try {
      app = await startMotifMcpBridge();
      const listener = addListener.mock.calls.find(([type]) => type === 'message')?.[1];
      expect(listener).toBeTypeOf('function');
      postMessage.mockClear();
      receive(toolResult);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);

      receive({ jsonrpc: '2.0', id: 'teardown', method: 'ui/resource-teardown', params: {} });
      await vi.advanceTimersByTimeAsync(0);
      expect(postMessage).toHaveBeenCalledExactlyOnceWith({ jsonrpc: '2.0', id: 'teardown', result: {} }, '*');
      expect(vi.getTimerCount()).toBe(0);
      expect.soft(removeListener).toHaveBeenCalledWith('message', listener);
      expect.soft(removeListener).toHaveBeenCalledAfter(postMessage);
      expect.soft(app.transport).toBeUndefined();

      const replaceWorkspace = vi.fn(() => 0);
      (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;
      const rootData = { ...document.documentElement.dataset };
      receive(toolResult);
      receive({ jsonrpc: '2.0', id: 'late-ping', method: 'ping', params: {} });
      await vi.advanceTimersByTimeAsync(10_000);
      expect.soft(replaceWorkspace).not.toHaveBeenCalled();
      expect.soft({ ...document.documentElement.dataset }).toEqual(rootData);
      expect.soft(postMessage).toHaveBeenCalledTimes(1);
    } finally {
      await app?.close();
      postMessage.mockRestore();
      addListener.mockRestore();
      removeListener.mockRestore();
      vi.useRealTimers();
    }
  });

  it.each([true, false])('offers a host download that reports the host outcome when the host saves files: %s', async (hostSavesFiles) => {
    const receive = (data: unknown) => {
      window.dispatchEvent(new MessageEvent('message', { source: window.parent, data }));
    };
    let downloadReply: Record<string, unknown> = {};
    const postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(message => {
      if (message.method === 'ui/initialize') {
        receive({
          jsonrpc: '2.0', id: message.id,
          result: {
            protocolVersion: message.params.protocolVersion,
            hostInfo: { name: 'test-host', version: '1' },
            hostCapabilities: hostSavesFiles ? { downloadFile: {} } : {}, hostContext: {},
          },
        });
      }
      if (message.method === 'ui/download-file') receive({ jsonrpc: '2.0', id: message.id, result: downloadReply });
    });
    const runtime = window as TestRuntimeWindow;
    let app: Awaited<ReturnType<typeof startMotifMcpBridge>> | undefined;
    try {
      app = await startMotifMcpBridge();
      if (!hostSavesFiles) {
        expect(runtime.motifHostDownload).toBeUndefined();
        return;
      }
      expect(await runtime.motifHostDownload!('backup.json', '{"records":[]}', 'application/json')).toBe(true);
      expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
        method: 'ui/download-file',
        params: { contents: [{ type: 'resource', resource: { uri: 'file:///backup.json', mimeType: 'application/json', text: '{"records":[]}' } }] },
      }), '*');
      downloadReply = { isError: true };
      expect(await runtime.motifHostDownload!('backup.json', '{}', 'application/json')).toBe(false);

      receive({ jsonrpc: '2.0', id: 'teardown', method: 'ui/resource-teardown', params: {} });
      await vi.waitFor(() => expect(runtime.motifHostDownload).toBeUndefined());
    } finally {
      await app?.close();
      delete runtime.motifHostDownload;
      postMessage.mockRestore();
    }
  });

  it('replaces the full runtime workspace with the exact tool payload', async () => {
    const payload: MotifWorkbenchPayload = {
      schema: 'motif.claude-science.inventory.v2',
      inventory: { title: 'Bridge fixture' },
      records: [{ id: 'fixture', name: 'Fixture', sequence: 'ATGCGT', molecule: 'dna' }],
    };
    const replaceWorkspace = vi.fn((_payload: MotifWorkbenchPayload): number => 1);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;

    await applyMotifToolResult(result({
      schema: 'motif.mcp.workbench.v1',
      mode: 'payload',
      payload,
      recordCount: 1,
      residueCount: 6,
    }));

    expect(replaceWorkspace).toHaveBeenCalledTimes(1);
    expect(replaceWorkspace).toHaveBeenCalledWith(payload);
    expect(replaceWorkspace.mock.calls[0]?.[0]).toBe(payload);
    expect(document.documentElement.dataset.motifMcpState).toBe('ready');
    expect(document.documentElement.dataset.motifMcpMessage).toBeUndefined();
  });

  it('leaves the bundled sample inventory untouched when no payload is supplied', async () => {
    const replaceWorkspace = vi.fn((_payload: MotifWorkbenchPayload): number => 0);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;

    await applyMotifToolResult(result({
      schema: 'motif.mcp.workbench.v1',
      mode: 'sample',
      recordCount: 0,
      residueCount: 0,
    }));

    expect(replaceWorkspace).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.motifMcpState).toBe('ready');
  });

  it('colors an uncolored feature before handing the payload to the runtime', async () => {
    const payload: MotifWorkbenchPayload = {
      records: [{
        id: 'feature-fixture',
        sequence: 'ATGCGT',
        features: [{ name: 'bridge CDS', type: 'cds', start: 0, end: 6 }],
      }],
    };
    const replaceWorkspace = vi.fn((_payload: MotifWorkbenchPayload): number => 1);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;

    await applyMotifToolResult(result({
      schema: 'motif.mcp.workbench.v1',
      mode: 'payload',
      payload,
      recordCount: 1,
      residueCount: 6,
    }));

    expect(replaceWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      records: [expect.objectContaining({
        features: [expect.objectContaining({
          color: 'var(--accent, #7E9BBF)',
        })],
      })],
    }));
  });

  it('opens a result made by an older build, including one without the newer envelope fields', async () => {
    const record = { id: 'older', name: 'Older', sequence: 'ATGCGT', molecule: 'dna' };
    const fields = { schema: 'motif.mcp.workbench.v1', mode: 'payload', recordCount: 1, residueCount: 6 };
    for (const older of [
      // A compatible envelope that omits the optional build ID.
      { structuredContent: { ...fields, payload: { records: [record] } }, content: [] },
      result({ ...fields, payload: { records: [record] }, runtimeBuildId: 'b'.repeat(64) }),
    ] satisfies CallToolResult[]) {
      const replaceWorkspace = vi.fn((_payload: MotifWorkbenchPayload): number => 1);
      (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;
      await applyMotifToolResult(older);
      expect(replaceWorkspace).toHaveBeenCalledExactlyOnceWith({ records: [record] });
      expect(document.documentElement.dataset.motifMcpState).toBe('ready');
      expect(document.getElementById('motif-mcp-notice')).toBeNull();
    }
  });

  it('opens a result made by a newer build that adds envelope fields', async () => {
    const payload = { records: [{ id: 'newer', sequence: 'ATG', molecule: 'dna' }] };
    const replaceWorkspace = vi.fn((_payload: MotifWorkbenchPayload): number => 1);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;
    await applyMotifToolResult(result({
      schema: 'motif.mcp.workbench.v1',
      mode: 'payload',
      payload,
      recordCount: 1,
      residueCount: 3,
      runtimeBuildId: 'c'.repeat(64),
      deliveryHints: { preferredPanel: 'side' },
    }));
    expect(replaceWorkspace).toHaveBeenCalledExactlyOnceWith(payload);
    expect(document.documentElement.dataset.motifMcpState).toBe('ready');
  });

  it('shows one plain sentence for an unknown schema version or a damaged envelope, then clears it', async () => {
    const replaceWorkspace = vi.fn((_payload: MotifWorkbenchPayload): number => 0);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;
    const valid = { schema: 'motif.mcp.workbench.v1', mode: 'payload', payload: { records: [] }, recordCount: 0, residueCount: 0 };
    const notice = () => document.getElementById('motif-mcp-notice');

    await applyMotifToolResult(result({ ...valid, schema: 'motif.mcp.workbench.v2' }));
    expect(notice()?.getAttribute('role')).toBe('alert');
    expect(notice()?.textContent).toContain(MOTIF_BRIDGE_MESSAGES.unsupported);
    expect(MOTIF_BRIDGE_MESSAGES.unsupported).toMatch(/^[^.;]+\.$/u);

    for (const damaged of [
      result({ ...valid, recordCount: -1 }),
      result({ ...valid, recordCount: 101 }),
      result({ ...valid, recordCount: 1 }),
      result({ ...valid, residueCount: 0.5 }),
      result({ ...valid, mode: 'sample' }),
      result({ ...valid, mode: 'unknown' }),
      result({ ...valid, payload: { records: [], entries: [] } }),
      result({ ...valid, payload: 'not an object' }),
    ]) {
      await applyMotifToolResult(damaged);
      expect(document.documentElement.dataset.motifMcpState).toBe('error');
      expect(notice()?.textContent).toContain(MOTIF_BRIDGE_MESSAGES.damaged);
    }
    for (const [refused, message] of [
      [result({ ...valid, payload: { records: [], padding: 'é'.repeat(17 * 1024 * 1024) } }), MOTIF_BRIDGE_MESSAGES.tooLarge],
      [{ ...result(valid), isError: true }, MOTIF_BRIDGE_MESSAGES.toolError],
    ] as const) {
      await applyMotifToolResult(refused);
      expect(notice()?.textContent).toContain(message);
    }
    expect(replaceWorkspace).not.toHaveBeenCalled();

    notice()?.querySelector('button')?.click();
    expect(notice()).toBeNull();
    await applyMotifToolResult(result({ ...valid, schema: 'motif.mcp.workbench.v9' }));
    expect(notice()).not.toBeNull();
    await applyMotifToolResult(result(valid));
    expect(replaceWorkspace).toHaveBeenCalledTimes(1);
    expect(notice()).toBeNull();
  });

  it('hydrates only the latest pending workspace and reports a reused sample frame', async () => {
    const valid = { schema: 'motif.mcp.workbench.v1', mode: 'payload', recordCount: 0, residueCount: 0 };
    const older = applyMotifToolResult(result({ ...valid, payload: { records: [], title: 'Older' } }));
    const newer = applyMotifToolResult(result({ ...valid, payload: { records: [], title: 'Newer' } }));
    const replaceWorkspace = vi.fn(() => 0);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;
    await Promise.all([older, newer]);
    expect(replaceWorkspace).toHaveBeenCalledExactlyOnceWith({ records: [], title: 'Newer' });
    await applyMotifToolResult(result({ ...valid, mode: 'sample' }));
    expect(document.documentElement.dataset.motifMcpState).toBe('error');
    expect(document.documentElement.dataset.motifMcpMessage).toMatch(/new Motif frame/u);
  });

  it('ignores unrelated tool results without mutating the runtime', async () => {
    const replaceWorkspace = vi.fn((_payload: MotifWorkbenchPayload): number => 0);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;

    await applyMotifToolResult(result({ schema: 'another.tool.v1' }));

    expect(replaceWorkspace).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.motifMcpState).toBeUndefined();
  });
});
