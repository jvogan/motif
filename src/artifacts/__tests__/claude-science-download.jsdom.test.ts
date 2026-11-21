/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  downloadsBlockedBySandbox,
  requestBrowserBlobDownload,
  requestBrowserTextDownload,
  SANDBOX_BLOCKED_DOWNLOAD_MESSAGE,
} from '../claude-science-download';
import { printHtmlReport } from '../motif-artifact';

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
      message: 'Download requested for workspace.json. Verify the file before relying on it.',
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

  it('returns a failure receipt when ZIP generation rejects the checkpoint', () => {
    const { create } = installObjectUrl();
    const receipt = requestBrowserBlobDownload('workspace.zip', () => {
      throw new Error('Checkpoint exceeds the restore budget.');
    });
    expect(receipt).toMatchObject({ status: 'failed', message: expect.stringContaining('restore budget') });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports the fallback result when the print frame is denied', () => {
    installObjectUrl();
    const append = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLIFrameElement) throw new Error('Print frame denied');
      return append(node);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('Fallback download denied');
    });
    const receipt = vi.fn();
    printHtmlReport('<p>Report</p>', receipt);
    expect(receipt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      status: 'failed',
      message: expect.stringContaining('Fallback download denied'),
    }));
    expect(document.querySelector('iframe, a')).toBeNull();
  });
});

describe('sandboxed frames', () => {
  it('reports a failure, not a request, when an opaque-origin frame would drop the download', () => {
    const top = {} as Window;
    const framed = { origin: 'null', top } as unknown as Window;
    (framed as unknown as { self: Window }).self = framed;
    expect(downloadsBlockedBySandbox(framed)).toBe(true);
    expect(downloadsBlockedBySandbox({ origin: 'null', self: top, top } as unknown as Window)).toBe(false);
    expect(downloadsBlockedBySandbox({ origin: 'https://example.test', self: framed, top } as unknown as Window)).toBe(false);

    installObjectUrl();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(window, 'origin', 'get').mockReturnValue('null');
    vi.spyOn(window, 'top', 'get').mockReturnValue(top as unknown as WindowProxy);
    const receipt = requestBrowserTextDownload('workspace.json', '{}', 'application/json');
    expect(receipt).toEqual({ status: 'failed', channel: 'browser', filename: 'workspace.json', message: SANDBOX_BLOCKED_DOWNLOAD_MESSAGE });
    expect(click).not.toHaveBeenCalled();
  });
});
