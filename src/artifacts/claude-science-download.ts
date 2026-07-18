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

function failureMessage(filename: string, cause: unknown): string {
  const detail = cause instanceof Error && cause.message.trim() ? ` ${cause.message.trim()}` : '';
  return `Download could not be requested for ${filename}.${detail}`;
}

export function requestBrowserBlobDownload(
  filename: string,
  blob: Blob,
): BrowserDownloadReceipt {
  let url: string | null = null;
  let anchor: HTMLAnchorElement | null = null;
  try {
    url = URL.createObjectURL(blob);
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    return {
      status: 'requested',
      channel: 'browser',
      filename,
      message: `Download requested for ${filename}. Verify the file before relying on it as a checkpoint.`,
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
