// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SequenceCopyButton } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

describe('copyText confirmation', () => {
  const copyText = artifactSource.slice(
    artifactSource.indexOf('const copyText = useCallback'),
    artifactSource.indexOf('const saveAlignment = useCallback'),
  );

  it('confirms every successful copy through the workbench notice, not only the Export chip', () => {
    // The Export chip alone is not a confirmation: it is hidden below the pane at
    // 1024x768, 1280x720 and 1440x900, and 886-1298px from the button at 1920x1080. The
    // notice is a role=status region painted over every pane and popover.
    // The notice keeps the status tone, named, and sits over the status
    // line's readout ('status' anchor) so it covers no base.
    expect(copyText).toContain("else if (options?.notice !== false) showWorkbenchNotice(`${label} copied`, 'status', undefined, 'status');");
    expect(copyText.match(/showWorkbenchNotice\(`\$\{label\} copied`/g)).toHaveLength(1);
    expect(copyText).toContain("setCopyStatus(ok ? `${label} copied` : 'Copy blocked');");
  });

  it('leaves the MSA window to its own in-place status so a copy is announced once', () => {
    expect(artifactSource).toContain('onCopy={(label, value) => copyText(label, value, { notice: false })}');
    expect(artifactSource.match(/copyText\([^)]*\{ notice: false \}\)/g)).toHaveLength(1);
  });

  it('swaps Copy for Copied inside one grid cell, so the dock does not shift', () => {
    expect(artifactCss).toMatch(/\.motif-cs-copy-button\s*\{[^}]*display:\s*inline-grid/);
    expect(artifactCss).toMatch(/\.motif-cs-copy-button > span\s*\{[^}]*grid-area:\s*1 \/ 1/);
    expect(artifactSource).toContain('<SequenceCopyButton');
  });
});

describe('SequenceCopyButton', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says Copied where the reader pressed it, then returns to Copy', async () => {
    vi.useFakeTimers();
    const onCopy = vi.fn(async () => true);
    render(<SequenceCopyButton disabled={false} title="Copy the selected sequence" onCopy={onCopy} />);
    const button = screen.getByRole('button', { name: 'Copy' });
    expect(button.hasAttribute('data-copied')).toBe(false);

    await act(async () => {
      button.click();
    });
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('data-copied')).toBe(true);
    // The accessible name follows the painted word.
    expect(screen.getByRole('button', { name: 'Copied' })).toBe(button);

    await act(async () => {
      vi.advanceTimersByTime(1600);
    });
    expect(button.hasAttribute('data-copied')).toBe(false);
    expect(screen.getByRole('button', { name: 'Copy' })).toBe(button);
  });

  it('does not claim a copy the clipboard refused', async () => {
    const onCopy = vi.fn(async () => false);
    render(<SequenceCopyButton disabled={false} title="Copy the selected sequence" onCopy={onCopy} />);
    const button = screen.getByRole('button', { name: 'Copy' });
    await act(async () => {
      button.click();
    });
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(button.hasAttribute('data-copied')).toBe(false);
  });
});
