/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sequencePanelEditToolbar, stackedSequenceRowFloor } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');

describe('the stacked Sequence row finds its edit toolbar', () => {
  it('finds the toolbar inside the wrapping chrome strip the panel renders', () => {
    // The panel renders the toolbar inside .motif-cs-sequence-chrome.
    expect(artifactSource).toMatch(/className="motif-cs-sequence-chrome">\s*<div className="motif-cs-edit-toolbar"/);
    const panel = document.createElement('div');
    panel.className = 'motif-cs-panel motif-cs-sequence-panel';
    panel.innerHTML = '<div class="motif-cs-sequence-chrome"><div class="motif-cs-edit-toolbar" role="group"></div></div>'
      + '<div class="motif-cs-sequence"><div class="motif-cs-edit-toolbar"></div></div>';
    const toolbar = sequencePanelEditToolbar(panel);
    expect(toolbar).not.toBeNull();
    expect(toolbar?.parentElement?.className).toBe('motif-cs-sequence-chrome');
  });

  it('keeps a 900x700 stacked row within the strip height when the Inventory hides', () => {
    // Measured at 900x700: the column's content needs 390px and the toolbar
    // starts 50px below the column's top. The record tab strip shows once the
    // Inventory hides and takes 33px of the workspace (662 -> 629), which
    // lowers the top row's cap from 413 to 380.
    const minimums = { sequence: 390, toolbarKeep: 390 - 50, map: 85 };
    expect(stackedSequenceRowFloor(minimums, 662, 413)).toBe(390);
    expect(stackedSequenceRowFloor(minimums, 629, 380)).toBe(380);
  });
});
