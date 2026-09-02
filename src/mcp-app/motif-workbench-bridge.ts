import { App } from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { MotifWorkbenchPayload, MotifWorkbenchResult } from '../../mcp/motif/contracts.js';
import { resolveFeatureColor } from '../bio/feature-palette.js';

type MotifRuntimeWindow = Window & {
  motifReplaceWorkspace?: (payload: MotifWorkbenchPayload) => number;
};

const RUNTIME_WAIT_TIMEOUT_MS = 10_000;
const RUNTIME_WAIT_INTERVAL_MS = 25;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function resolveBridgeFeatureColors(payload: MotifWorkbenchPayload): MotifWorkbenchPayload {
  let changed = false;
  const resolveRecord = (record: unknown): unknown => {
    if (!isPlainObject(record)) return record;
    let next = record;
    for (const field of ['features', 'annotations'] as const) {
      const featureList = record[field];
      if (!Array.isArray(featureList)) continue;
      const colored = featureList.map((feature) => {
        if (!isPlainObject(feature)) return feature;
        const color = resolveFeatureColor(feature);
        if (color === feature.color) return feature;
        changed = true;
        return { ...feature, color };
      });
      if (colored.some((feature, index) => feature !== featureList[index])) {
        next = { ...next, [field]: colored };
      }
    }
    return next;
  };
  let next: MotifWorkbenchPayload = payload;
  for (const field of ['records', 'entries', 'vectors'] as const) {
    const recordList = payload[field];
    if (!Array.isArray(recordList)) continue;
    const records = recordList.map(resolveRecord);
    if (records.some((record, index) => record !== recordList[index])) {
      next = { ...next, [field]: records };
    }
  }
  if (payload.record !== undefined) {
    const record = resolveRecord(payload.record);
    if (record !== payload.record) next = { ...next, record };
  }
  return changed ? next : payload;
}

export function isMotifWorkbenchResult(value: unknown): value is MotifWorkbenchResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<MotifWorkbenchResult>;
  return candidate.schema === 'motif.mcp.workbench.v1'
    && (candidate.mode === 'sample' || candidate.mode === 'payload' || candidate.mode === 'artifact')
    && typeof candidate.recordCount === 'number'
    && typeof candidate.residueCount === 'number';
}

function setBridgeState(state: 'connecting' | 'ready' | 'error', message?: string): void {
  document.documentElement.dataset.motifMcpState = state;
  if (message) document.documentElement.dataset.motifMcpMessage = message.slice(0, 512);
  else delete document.documentElement.dataset.motifMcpMessage;
  window.dispatchEvent(new CustomEvent('motif:mcp-state', { detail: { state, message } }));
}

function waitForRuntime(): Promise<(payload: MotifWorkbenchPayload) => number> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const replaceWorkspace = (window as MotifRuntimeWindow).motifReplaceWorkspace;
      if (replaceWorkspace) {
        resolve(replaceWorkspace.bind(window));
        return;
      }
      if (Date.now() - startedAt >= RUNTIME_WAIT_TIMEOUT_MS) {
        reject(new Error('The Motif workbench runtime did not become ready.'));
        return;
      }
      window.setTimeout(check, RUNTIME_WAIT_INTERVAL_MS);
    };
    check();
  });
}

export async function applyMotifToolResult(result: CallToolResult): Promise<void> {
  if (!isMotifWorkbenchResult(result.structuredContent)) return;
  if (!result.structuredContent.payload) {
    setBridgeState('ready');
    return;
  }
  try {
    const replaceWorkspace = await waitForRuntime();
    replaceWorkspace(resolveBridgeFeatureColors(result.structuredContent.payload));
    setBridgeState('ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The Motif workspace could not be loaded.';
    setBridgeState('error', message);
  }
}

export async function startMotifMcpBridge(): Promise<App> {
  setBridgeState('connecting');
  const app = new App(
    { name: 'Motif', version: '0.4.0' },
    { availableDisplayModes: ['inline', 'fullscreen'] },
    { autoResize: false },
  );
  app.ontoolresult = (result) => {
    void applyMotifToolResult(result);
  };
  app.onteardown = async () => ({});
  await app.connect();
  return app;
}

if (typeof window !== 'undefined' && window.parent !== window) {
  void startMotifMcpBridge().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'The host could not connect to the Motif workbench.';
    setBridgeState('error', message);
  });
}
