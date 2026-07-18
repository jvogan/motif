/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestBrowserBlobDownload,
  requestBrowserTextDownload,
} from '../claude-science-download';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function installObjectUrl(): { create: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> } {
  const create = vi.fn(() => 'blob:motif-test');
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  return { create, revoke };
}

describe('browser download receipts', () => {
  it('reports only a request after dispatching an anchor download', () => {
    installObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const receipt = requestBrowserTextDownload('workspace.json', '{"records":[]}', 'application/json');

    expect(receipt).toEqual({
      status: 'requested',
      channel: 'browser',
      filename: 'workspace.json',
      message: 'Download requested for workspace.json. Verify the file before relying on it as a checkpoint.',
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector('a[download="workspace.json"]')).toBeNull();
  });

  it('returns an explicit failure instead of swallowing blocked downloads', () => {
    installObjectUrl();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('sandbox denied the request');
    });

    const receipt = requestBrowserBlobDownload('workspace.zip', new Blob(['zip']));

    expect(receipt.status).toBe('failed');
    expect(receipt.message).toMatch(/sandbox denied the request/i);
    expect(document.querySelector('a')).toBeNull();
  });
});
