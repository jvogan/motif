export type BrowserDownloadReceipt =
  | {
      status: 'requested';
      channel: 'browser';
      filename: string;
      message: string;
    }
  | {
      status: 'failed';
      channel: 'browser';
      filename: string;
      message: string;
    };

/** A host that saves files for a sandboxed frame says whether the user kept the file. */
export type HostDownloadReceipt = {
  status: 'saved' | 'failed';
  channel: 'host';
  filename: string;
  message: string;
};

function failureMessage(filename: string, cause: unknown): string {
  const detail = cause instanceof Error && cause.message.trim() ? ` ${cause.message.trim()}` : '';
  return `Download could not be requested for ${filename}.${detail}`;
}

export const SANDBOX_BLOCKED_DOWNLOAD_MESSAGE = 'Downloads are off in this panel. Use Copy instead.';

/**
 * A framed page with an opaque origin runs in a sandbox. Hosts that sandbox an
 * artifact this way drop anchor downloads without any error, so a click there
 * must not be reported as a requested download.
 */
export function downloadsBlockedBySandbox(view: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!view) return false;
  try {
    return view.origin === 'null' && view.self !== view.top;
  } catch {
    return true;
  }
}

export function requestBrowserBlobDownload(
  filename: string,
  blob: Blob | (() => Blob),
): BrowserDownloadReceipt {
  if (downloadsBlockedBySandbox()) {
    return { status: 'failed', channel: 'browser', filename, message: SANDBOX_BLOCKED_DOWNLOAD_MESSAGE };
  }
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(typeof blob === 'function' ? blob() : blob);
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    return {
      status: 'requested',
      channel: 'browser',
      filename,
      message: `Download requested for ${filename}. Verify the file before relying on it.`,
    };
  } catch (cause) {
    return {
      status: 'failed',
      channel: 'browser',
      filename,
      message: failureMessage(filename, cause),
    };
  } finally {
    anchor?.remove();
    if (url) {
      const objectUrl = url;
      const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
      window.setTimeout(() => revokeObjectUrl(objectUrl), 1_000);
    }
  }
}

export function requestBrowserTextDownload(
  filename: string,
  content: string,
  mime = 'text/plain',
): BrowserDownloadReceipt {
  try {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` });
    return requestBrowserBlobDownload(filename, blob);
  } catch (cause) {
    return {
      status: 'failed',
      channel: 'browser',
      filename,
      message: failureMessage(filename, cause),
    };
  }
}
