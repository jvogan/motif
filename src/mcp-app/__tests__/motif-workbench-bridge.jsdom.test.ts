// @vitest-environment jsdom

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MotifWorkbenchPayload } from '../../../mcp/motif/contracts.js';
import { applyMotifToolResult } from '../motif-workbench-bridge.js';

type TestRuntimeWindow = Window & {
  motifReplaceWorkspace?: (payload: MotifWorkbenchPayload) => number;
};

function result(structuredContent: Record<string, unknown>): CallToolResult {
  return { structuredContent, content: [{ type: 'text', text: 'test' }] };
}

afterEach(() => {
  delete (window as TestRuntimeWindow).motifReplaceWorkspace;
  delete document.documentElement.dataset.motifMcpState;
  delete document.documentElement.dataset.motifMcpMessage;
});

describe('Motif MCP App bridge hydration', () => {
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

  it('ignores unrelated tool results without mutating the runtime', async () => {
    const replaceWorkspace = vi.fn((_payload: MotifWorkbenchPayload): number => 0);
    (window as TestRuntimeWindow).motifReplaceWorkspace = replaceWorkspace;

    await applyMotifToolResult(result({ schema: 'another.tool.v1' }));

    expect(replaceWorkspace).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.motifMcpState).toBeUndefined();
  });
});
