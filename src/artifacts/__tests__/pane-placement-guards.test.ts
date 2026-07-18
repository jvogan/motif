import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

describe('workspace pane placement guards', () => {
  it('moves each existing pane node instead of rendering a floating duplicate', () => {
    for (const pane of ['inventory', 'map', 'sequence', 'tools']) {
      expect(artifactSource.match(new RegExp(`data-pane-key="${pane}"`, 'g'))).toHaveLength(1);
    }
    expect(artifactSource.match(/data-pane-placement=\{panePlacements\./g)).toHaveLength(4);
  });

  it('excludes floating panes from docked topology and resets every pane to docked', () => {
    expect(artifactSource).toContain("paneVisibility[pane] && panePlacements[pane] === 'docked'");
    expect(artifactSource).toContain('data-content-pane-count={dockedContentPaneCount}');
    expect(artifactSource).toContain("panePlacements.sequence === 'docked' && panePlacements.map === 'docked'");
    expect(artifactSource).toContain('setPanePlacements({ ...DEFAULT_WORKSPACE_LAYOUT.panePlacements });');
    expect(artifactSource).toContain("disabled={dockedContentPaneCount <= 1}");
  });

  it('uses bounded geometry and cleans every pointer termination path', () => {
    expect(artifactSource).toContain('moveFloatingSurfaceRect(');
    expect(artifactSource).toContain('resizeFloatingSurfaceRectFromBottomRight(');
    expect(artifactSource).toContain("window.addEventListener('pointercancel', finishPointer)");
    expect(artifactSource).toContain("window.addEventListener('blur', finishFromBlur)");
    expect(artifactSource).toContain("surface.addEventListener('lostpointercapture', finishPointer)");
    expect(artifactSource).toContain('if (!event.isPrimary || event.button !== 0) return;');
  });

  it('keeps responsive floating overrides last and gives phones a reachable sheet', () => {
    const placementBlock = artifactCss.lastIndexOf('/* Pane placement');
    const lastResponsiveRule = artifactCss.lastIndexOf('@media');
    expect(placementBlock).toBeGreaterThan(0);
    expect(lastResponsiveRule).toBeGreaterThan(placementBlock);
    expect(artifactCss.slice(placementBlock)).toContain('.motif-cs-main > .motif-cs-pane[data-pane-placement="floating"]');
    expect(artifactCss.slice(lastResponsiveRule)).toContain('width: auto !important;');
    expect(artifactCss.slice(lastResponsiveRule)).toContain('.motif-cs-floating-pane-resize');
    expect(artifactCss.slice(lastResponsiveRule)).toContain('display: none;');
  });
});
