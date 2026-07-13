// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArtifactRuntimeErrorBoundary } from '../motif-artifact';

function Crash(): never {
  throw new Error('render exploded');
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
});
