import { App } from '@modelcontextprotocol/ext-apps';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessageSchema, PingRequestSchema, type CallToolResult, type JSONRPCMessage, type RequestId } from '@modelcontextprotocol/sdk/types.js';

import {
  MOTIF_WORKBENCH_RESULT_SCHEMA,
  preparedMotifWorkbenchSchema,
  type MotifWorkbenchPayload,
  type MotifWorkbenchResult,
} from '../../mcp/motif/contracts.js';
import { MAX_MOTIF_PRELOAD_BYTES } from '../artifacts/motif-preload-limits.js';
import { resolveFeatureColor } from '../bio/feature-palette.js';

type MotifRuntimeWindow = Window & {
  motifReplaceWorkspace?: (payload: MotifWorkbenchPayload) => number;
  /** Present only while a host that saves files for this frame is connected. */
  motifHostDownload?: (filename: string, text: string, mimeType: string) => Promise<boolean>;
};

const RUNTIME_WAIT_TIMEOUT_MS = 10_000;
const RUNTIME_WAIT_INTERVAL_MS = 25;
let pendingHydration: AbortController | undefined;

class MotifParentTransport implements Transport {
  onclose?: Transport['onclose'];
  onerror?: Transport['onerror'];
  onmessage?: Transport['onmessage'];
  private readonly parent: Window;
  private teardownReplyId?: RequestId;

  constructor(parent: Window) {
    this.parent = parent;
  }

  private readonly receive = (event: MessageEvent): void => {
    if (this.teardownReplyId !== undefined || event.source !== this.parent || event.data?.jsonrpc !== '2.0') return;
    const parsed = JSONRPCMessageSchema.safeParse(event.data);
    if (parsed.success) this.onmessage?.(parsed.data);
    else this.onerror?.(new Error('Invalid JSON-RPC message received.'));
  };

  async start(): Promise<void> {
    window.addEventListener('message', this.receive);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const closing = this.teardownReplyId !== undefined;
    if (closing && (!('result' in message || 'error' in message) || message.id !== this.teardownReplyId)) return;
    try {
      this.parent.postMessage(message, '*');
    } finally {
      if (closing) await this.close();
    }
  }

  closeAfterReply(requestId: RequestId): void {
    // Closing immediately would abort the handler before the SDK sends its reply.
    this.teardownReplyId ??= requestId;
  }

  async close(): Promise<void> {
    window.removeEventListener('message', this.receive);
    this.onclose?.();
  }
}

class MotifApp extends App {
  constructor() {
    super(
      { name: 'Motif', version: '0.5.1' },
      { availableDisplayModes: ['inline', 'fullscreen'] },
      { autoResize: false },
    );
    this.replaceRequestHandler(PingRequestSchema, async () => ({}));
  }
}

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

/** The envelope fields the bridge needs, in the shape every released build has produced. */
export type ReadableMotifWorkbenchResult = Pick<MotifWorkbenchResult, 'schema' | 'mode' | 'recordCount' | 'residueCount'>
  & { payload?: MotifWorkbenchPayload };

type WorkbenchResultCheck =
  | { status: 'unrelated' }
  | { status: 'unsupported' }
  | { status: 'damaged' }
  | { status: 'readable'; result: ReadableMotifWorkbenchResult };

const WORKBENCH_SCHEMA_PATTERN = /^motif\.mcp\.workbench\.v\d+$/u;
// Results outlive the build that made them: a saved conversation can replay an
// older result into a newer frame, or the reverse. Accept any build ID and any
// additional envelope field. Refuse only an unknown schema version or an
// envelope that no released build could have produced.
const readableEnvelopeSchema = preparedMotifWorkbenchSchema.pick({
  schema: true,
  mode: true,
  recordCount: true,
  residueCount: true,
}).loose();

export const MOTIF_BRIDGE_MESSAGES = Object.freeze({
  unsupported: 'This result comes from a newer version of Motif, so update the Motif connector and run the tool again to open it.',
  damaged: 'This Motif result is incomplete or damaged, so run the Motif tool again to recreate the workspace.',
  toolError: 'The Motif tool reported an error, so this view was not updated; read the tool message and try again.',
  tooLarge: 'This workspace is larger than the 32 MiB limit, so split it or reduce its size and run the tool again.',
  notReady: 'The Motif workbench did not finish loading, so close this view and open it again.',
  reusedSample: 'Open a new Motif frame to view the bundled sample; this one keeps the workspace it already shows.',
  unsavedEdits: 'Unsaved changes blocked the new workspace. Download a backup, then run the tool again.',
  unsavedEditsWithoutDownloads: 'Unsaved changes blocked the new workspace. Restore a backup, then run the tool again.',
});

export function checkMotifWorkbenchResult(value: unknown): WorkbenchResultCheck {
  if (!isPlainObject(value) || typeof value.schema !== 'string' || !WORKBENCH_SCHEMA_PATTERN.test(value.schema)) {
    return { status: 'unrelated' };
  }
  if (value.schema !== MOTIF_WORKBENCH_RESULT_SCHEMA) return { status: 'unsupported' };
  const parsed = readableEnvelopeSchema.safeParse(value);
  if (!parsed.success) return { status: 'damaged' };
  const { mode, recordCount, residueCount } = parsed.data;
  const { payload } = value;
  const result = { schema: MOTIF_WORKBENCH_RESULT_SCHEMA, mode, recordCount, residueCount };
  if (mode === 'sample') {
    return payload === undefined && recordCount === 0 && residueCount === 0
      ? { status: 'readable', result }
      : { status: 'damaged' };
  }
  if (!isPlainObject(payload)) return { status: 'damaged' };
  const containers = ['records', 'entries', 'vectors', 'record'].filter(key => payload[key] !== undefined);
  if (containers.length > 1) return { status: 'damaged' };
  const records = containers.length ? payload[containers[0]] : undefined;
  const consistent = containers.length === 0 ? recordCount === 0
    : containers[0] === 'record' ? isPlainObject(records) && recordCount === 1
      : Array.isArray(records) && records.length === recordCount;
  return consistent ? { status: 'readable', result: { ...result, payload } } : { status: 'damaged' };
}

export function isMotifWorkbenchResult(value: unknown): value is ReadableMotifWorkbenchResult {
  return checkMotifWorkbenchResult(value).status === 'readable';
}

const NOTICE_ID = 'motif-mcp-notice';

// Nothing else in the frame reports bridge state, so a refusal must be shown
// here or the viewer sees the bundled sample with no explanation.
function showBridgeNotice(message: string | undefined): void {
  let notice = document.getElementById(NOTICE_ID);
  if (!message) {
    notice?.remove();
    return;
  }
  if (!notice) {
    notice = document.createElement('div');
    notice.id = NOTICE_ID;
    notice.dataset.testid = NOTICE_ID;
    notice.setAttribute('role', 'alert');
    Object.assign(notice.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      right: '8px',
      zIndex: '2147483647',
      display: 'flex',
      gap: '12px',
      alignItems: 'center',
      padding: '8px 12px',
      background: 'var(--bg-secondary)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)',
      borderLeft: '4px solid var(--amber)',
      borderRadius: 'var(--radius-md)',
      font: '13px/1.4 var(--font-ui)',
    });
    const text = document.createElement('span');
    text.style.flex = '1';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Dismiss';
    dismiss.addEventListener('click', () => notice?.remove());
    notice.append(text, dismiss);
    (document.body ?? document.documentElement).append(notice);
  }
  const text = notice.querySelector('span');
  if (text) text.textContent = message;
}

function setBridgeState(state: 'connecting' | 'ready' | 'error', message?: string): void {
  document.documentElement.dataset.motifMcpState = state;
  message = message?.slice(0, 512);
  if (message) document.documentElement.dataset.motifMcpMessage = message;
  else delete document.documentElement.dataset.motifMcpMessage;
  if (state !== 'connecting') showBridgeNotice(state === 'error' ? message : undefined);
  window.dispatchEvent(new CustomEvent('motif:mcp-state', { detail: { state, message } }));
}

function waitForRuntime(signal: AbortSignal): Promise<(payload: MotifWorkbenchPayload) => number> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let timer: number | undefined;
    const abort = () => {
      window.clearTimeout(timer);
      reject(signal.reason);
    };
    const check = () => {
      const replaceWorkspace = (window as MotifRuntimeWindow).motifReplaceWorkspace;
      if (replaceWorkspace) {
        signal.removeEventListener('abort', abort);
        resolve(replaceWorkspace.bind(window));
        return;
      }
      if (Date.now() - startedAt >= RUNTIME_WAIT_TIMEOUT_MS) {
        signal.removeEventListener('abort', abort);
        reject(new Error(MOTIF_BRIDGE_MESSAGES.notReady));
        return;
      }
      timer = window.setTimeout(check, RUNTIME_WAIT_INTERVAL_MS);
    };
    signal.addEventListener('abort', abort, { once: true });
    check();
  });
}

export async function applyMotifToolResult(result: CallToolResult): Promise<void> {
  if (result.isError) {
    pendingHydration?.abort();
    setBridgeState('error', MOTIF_BRIDGE_MESSAGES.toolError);
    return;
  }
  const check = checkMotifWorkbenchResult(result.structuredContent);
  if (check.status === 'unrelated') return;
  pendingHydration?.abort();
  if (check.status !== 'readable') {
    setBridgeState('error', MOTIF_BRIDGE_MESSAGES[check.status]);
    return;
  }
  const { payload } = check.result;
  if (!payload) {
    if (document.documentElement.dataset.motifMcpHydrated === 'true') {
      setBridgeState('error', MOTIF_BRIDGE_MESSAGES.reusedSample);
    } else {
      setBridgeState('ready');
    }
    return;
  }
  const hydration = new AbortController();
  pendingHydration = hydration;
  try {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_MOTIF_PRELOAD_BYTES
      || new TextEncoder().encode(serialized).byteLength > MAX_MOTIF_PRELOAD_BYTES) {
      throw new Error(MOTIF_BRIDGE_MESSAGES.tooLarge);
    }
    const replaceWorkspace = await waitForRuntime(hydration.signal);
    if (hydration.signal.aborted) return;
    replaceWorkspace(resolveBridgeFeatureColors(payload));
    document.documentElement.dataset.motifMcpHydrated = 'true';
    setBridgeState('ready');
  } catch (error) {
    if (hydration.signal.aborted) return;
    // The runtime's own refusal speaks to a caller that can pass options; the
    // viewer gets the steps they can take in this frame.
    // A host-confirmed backup lifts the runtime's guard. Without a host that
    // saves files, restoring a backup is the way to a saved revision.
    const message = error instanceof Error && 'code' in error && error.code === 'MOTIF_UNSAVED_WORKSPACE'
      ? (window as MotifRuntimeWindow).motifHostDownload
        ? MOTIF_BRIDGE_MESSAGES.unsavedEdits
        : MOTIF_BRIDGE_MESSAGES.unsavedEditsWithoutDownloads
      : error instanceof Error ? error.message : 'The Motif workspace could not be loaded.';
    setBridgeState('error', message);
  } finally {
    if (pendingHydration === hydration) pendingHydration = undefined;
  }
}

export async function startMotifMcpBridge(): Promise<App> {
  setBridgeState('connecting');
  const app = new MotifApp();
  const transport = new MotifParentTransport(window.parent);
  app.ontoolresult = (result) => {
    void applyMotifToolResult(result);
  };
  const runtimeWindow = window as MotifRuntimeWindow;
  const stopHydration = () => {
    app.ontoolresult = undefined;
    delete runtimeWindow.motifHostDownload;
    pendingHydration?.abort();
  };
  app.onteardown = async (_, { requestId }) => {
    stopHydration();
    transport.closeAfterReply(requestId);
    return {};
  };
  app.onclose = stopHydration;
  await app.connect(transport);
  // A sandboxed frame cannot download. A host that saves files for it reports
  // whether the user kept the file, which a browser download never does.
  if (app.getHostCapabilities()?.downloadFile) {
    runtimeWindow.motifHostDownload = async (filename, text, mimeType) => {
      const result = await app.downloadFile({
        contents: [{ type: 'resource', resource: { uri: `file:///${encodeURIComponent(filename)}`, mimeType, text } }],
      });
      return result.isError !== true;
    };
  }
  return app;
}

if (typeof window !== 'undefined' && window.parent !== window) {
  void startMotifMcpBridge().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'The host could not connect to the Motif workbench.';
    setBridgeState('error', message);
  });
}
