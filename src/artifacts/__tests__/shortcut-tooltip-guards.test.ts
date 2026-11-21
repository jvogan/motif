import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const findBarSource = readFileSync(resolve(here, '..', 'ClaudeScienceFindBar.tsx'), 'utf8');
const findStateSource = readFileSync(resolve(here, '..', 'claude-science-find-state.ts'), 'utf8');

describe('tooltips name the keyboard shortcut a control has', () => {
  it('Copy names Cmd/Ctrl+C, the key the page copies the selection with', () => {
    expect(artifactSource).toContain("? 'Copy selection (Cmd/Ctrl+C)'");
    expect(artifactSource).toMatch(/Cmd\/Ctrl\+C copies the/);
  });

  it('the Find bar names every key that steps and closes, and the hook handles each of them', () => {
    expect(findBarSource).toContain("'Next match (Enter, Cmd/Ctrl+G or F3)'");
    expect(findBarSource).toContain("'Previous match (Shift+Enter or Shift+Cmd/Ctrl+G)'");
    expect(findBarSource).toContain('title="Close find (Escape)"');
    // The titles promise Cmd/Ctrl+G and F3, so the hook has to take both.
    expect(findStateSource).toMatch(/\(modifier && key === 'g'\) \|\| event\.key === 'F3'/);
  });

  it('Find, Undo, Redo and Close name their shortcuts', () => {
    expect(artifactSource).toContain('title="Find in sequence (Cmd/Ctrl+F)"');
    expect(artifactSource).toContain("'Undo (Cmd/Ctrl+Z)'");
    expect(artifactSource).toContain("'Redo (Cmd/Ctrl+Shift+Z)'");
    expect(artifactSource).toContain('title="Close (Esc)"');
  });
});

describe('arrow keys move through the tool list and the Export popover', () => {
  it('the Tools pane steps between its panel heads and the Export popover between its enabled buttons', () => {
    expect(artifactSource).toContain("from './claude-science-roving-focus'");
    expect(artifactSource).toContain("querySelectorAll<HTMLElement>('summary.motif-cs-panel-head')");
    expect(artifactSource).toMatch(/querySelectorAll<HTMLElement>\('button:not\(:disabled\)'\)\], \{ horizontal: true \}/);
  });
});
