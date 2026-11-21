// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeArtifactWorkspaceEnvelope } from '../claude-science-workspace-envelope';
import { ArtifactRuntimeErrorBoundary, loadInitialArtifactWorkspace, MotifArtifactRuntimeError } from '../motif-artifact';

vi.mock('../claude-science-workspace-envelope', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../claude-science-workspace-envelope')>();
  return { ...actual, normalizeArtifactWorkspaceEnvelope: vi.fn(actual.normalizeArtifactWorkspaceEnvelope) };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Crash(): never {
  throw new Error('render exploded');
}

function PreloadCrash(): never {
  throw new MotifArtifactRuntimeError(
    'MOTIF_INVALID_PRELOAD',
    'Preloaded workspace could not be opened: malformed state.',
    { operation: 'initialHydration', mutated: false },
  );
}

function mockExpectedBoundaryError(expected: RegExp): void {
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    const message = args.map((argument) => String(argument)).join(' ');
    if (!expected.test(message)) {
      throw new Error(`Unexpected console.error in runtime-boundary test: ${message}`);
    }
  });
}

describe('ArtifactRuntimeErrorBoundary', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps a usable recovery shell when a descendant render fails', () => {
    mockExpectedBoundaryError(/render exploded/);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ArtifactRuntimeErrorBoundary>
          <Crash />
        </ArtifactRuntimeErrorBoundary>,
      );
    });

    const shell = container.querySelector<HTMLElement>('[data-testid="artifact-runtime-error-shell"]');
    expect(shell?.textContent).toContain('Workspace rendering stopped safely');
    expect(shell?.textContent).toContain('Then use Import records to restore the last accepted records.');
    expect(shell?.textContent).toContain('render exploded');
    expect(shell?.querySelector('button')?.textContent).toContain('Copy recovery JSON');

    act(() => root.unmount());
  });

  it('shows recovery even when the thrown error has an empty message', () => {
    function EmptyCrash(): never { throw new Error(''); }
    mockExpectedBoundaryError(/EmptyCrash/);
    const container = document.createElement('div');
    const root = createRoot(container, { onCaughtError: () => {} });
    try {
      try {
        act(() => root.render(<ArtifactRuntimeErrorBoundary><EmptyCrash /></ArtifactRuntimeErrorBoundary>));
      } catch (error) {
        expect(error).toMatchObject({ message: '' });
      }
      expect(container.querySelector('[data-testid="artifact-runtime-error-shell"]')).not.toBeNull();
    } finally {
      act(() => root.unmount());
    }
  });

  it('offers selectable recovery JSON when both clipboard paths are refused', async () => {
    mockExpectedBoundaryError(/render exploded/);
    loadInitialArtifactWorkspace();
    const writeText = vi.fn(async (_text: string) => { throw new Error('Clipboard denied'); });
    const copyCommand = vi.fn((_command: string) => false);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: copyCommand });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(<ArtifactRuntimeErrorBoundary><Crash /></ArtifactRuntimeErrorBoundary>));
      const copy = container.querySelector('button')!;
      await act(async () => { copy.click(); });
      expect(copyCommand).toHaveBeenCalledWith('copy');
      const field = container.querySelector<HTMLTextAreaElement>('textarea[readonly]')!;
      expect(field).not.toBeNull();
      expect(field.value).toBe(writeText.mock.calls[0][0]);
      expect(JSON.parse(field.value)).toHaveProperty('records');
      expect(document.activeElement).toBe(field);
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length]);
      expect(container.querySelector('[role="status"]')?.textContent).not.toContain('window.motif');
    } finally {
      act(() => root.unmount());
      Reflect.deleteProperty(navigator, 'clipboard');
      Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('copies the recovery JSON even when restore validation refuses it, and says so', async () => {
    mockExpectedBoundaryError(/render exploded/);
    loadInitialArtifactWorkspace();
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <ArtifactRuntimeErrorBoundary>
          <Crash />
        </ArtifactRuntimeErrorBoundary>,
      );
    });
    const shell = container.querySelector<HTMLElement>('[data-testid="artifact-runtime-error-shell"]')!;
    const copy = Array.from(shell.querySelectorAll('button')).find((button) => button.textContent === 'Copy recovery JSON')!;
    const status = () => shell.querySelector('[role="status"]')?.textContent ?? '';

    await act(async () => { copy.click(); });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(status()).toBe('Recovery JSON copied. Reload the artifact, then restore it with Import records.');

    vi.mocked(normalizeArtifactWorkspaceEnvelope).mockImplementationOnce(() => {
      throw new Error('Workspace JSON exceeds the restore budget.');
    });
    await act(async () => { copy.click(); });
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writeText.mock.calls[1][0])).toEqual(JSON.parse(writeText.mock.calls[0][0]));
    expect(status()).toBe('Recovery JSON copied. Keep the copy before reloading.');
    // The reason is on screen, not only in a hover tooltip.
    expect(shell.textContent).toContain('Import records cannot restore this recovery JSON as-is. Workspace JSON exceeds the restore budget.');
    expect(shell.querySelector('[title]')).toBeNull();

    act(() => root.unmount());
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('reports preload rejection without claiming samples or recovery data were loaded', () => {
    mockExpectedBoundaryError(/MOTIF_INVALID_PRELOAD|malformed state|Preloaded workspace could not be opened/);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ArtifactRuntimeErrorBoundary>
          <PreloadCrash />
        </ArtifactRuntimeErrorBoundary>,
      );
    });

    const shell = container.querySelector<HTMLElement>('[data-testid="artifact-runtime-error-shell"]');
    expect(shell?.textContent).toContain('Preloaded workspace could not be opened');
    expect(shell?.textContent).toContain('No bundled sample data was substituted');
    expect(shell?.textContent).toContain('No workspace was accepted');
    expect(shell?.textContent).not.toContain('last accepted inventory');
    expect(shell?.textContent).not.toContain('bundled starting inventory');
    expect(Array.from(shell?.querySelectorAll('button') ?? []).map((button) => button.textContent)).toEqual([
      'Reload artifact',
    ]);

    act(() => root.unmount());
  });
});
