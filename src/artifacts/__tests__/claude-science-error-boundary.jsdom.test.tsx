// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactRuntimeErrorBoundary, MotifArtifactRuntimeError } from '../motif-artifact';

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

describe('ArtifactRuntimeErrorBoundary', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('keeps a usable recovery shell when a descendant render fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
    expect(shell?.textContent).toContain('last accepted inventory');
    expect(shell?.textContent).toContain('render exploded');
    expect(shell?.querySelector('button')?.textContent).toContain('Copy recovery JSON');

    act(() => root.unmount());
  });

  it('reports preload rejection without claiming samples or recovery data were loaded', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
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
