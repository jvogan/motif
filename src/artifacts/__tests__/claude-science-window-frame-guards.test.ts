import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

function sliceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  expect(start, `missing source marker: ${startNeedle}`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start);
  expect(end, `missing end marker after ${startNeedle}: ${endNeedle}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

function rule(selector: string): string {
  const escaped = selector.replace(/[\\.[\]()*+?^${}|:"=-]/g, '\\$&');
  return artifactCss.match(new RegExp(`\\n${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('floating window frame', () => {
  const frame = sliceBetween(artifactSource, 'function FloatingWindow({', '// One stable Translate panel:');

  it('has one title bar with a 16px 600 title on one line', () => {
    const title = rule('.motif-cs-window-title strong');
    expect(title).toContain('font-size: var(--fs-lg);');
    expect(title).toContain('font-weight: 600;');
    expect(title).toContain('white-space: nowrap;');
    expect(title).toContain('text-overflow: ellipsis;');
    // A window title is a short noun phrase with no subtitle beside it.
    expect(frame).not.toContain('subtitle');
    expect(artifactCss).not.toContain('.motif-cs-window-title small');
    // The bar is flat: one border, no gradient.
    const head = rule('.motif-cs-window-head');
    expect(head).toContain('background: var(--bg-secondary);');
    expect(head).not.toContain('gradient');
  });

  it('gives close, collapse and maximize a name, a title and a 28px target', () => {
    const icon = rule('.motif-cs-window-icon');
    expect(icon).toContain('width: var(--control-h-sm);');
    expect(icon).toContain('height: var(--control-h-sm);');
    expect(frame).toContain('aria-label={`Close ${title}`} title="Close"');
    expect(frame).toContain("title={collapsed ? 'Expand' : 'Collapse'}");
    expect(frame).toContain("title={maximized ? 'Restore' : 'Maximize'}");
  });

  it('is an edge-to-edge bottom sheet below 600px and then offers no move, resize or maximize', () => {
    expect(artifactSource).toContain("const WINDOW_FILL_QUERY = '(max-width: 599.98px)';");
    expect(frame).toContain('data-fill={fillsPanel || undefined}');
    expect(frame).toContain('if (maximized || fillsPanel ||');
    // Nor in the Translation window drawn in the Sequence column's flow (inFlow).
    expect(frame).toContain('if (maximized || fillsPanel || inFlow ||');
    expect(frame).toContain('{maximizable && !collapsed && !fillsPanel && !inFlow ? (');
    // No resize grip on a sheet, a maximized window, a collapsed one or one in the flow.
    expect(frame).toContain('{!collapsed && !maximized && !fillsPanel && !inFlow ? <button');
    const fill = rule('.motif-cs-window[data-fill][data-sheet]:not([data-placed]):not([data-collapsed]):not([data-maximized])');
    for (const declaration of [
      'left: 0 !important;',
      'width: auto !important;',
      'right: var(--motif-cs-floating-right-inset, 0px);',
      'bottom: 0;',
      'border-radius: var(--radius-md) var(--radius-md) 0 0;',
    ]) {
      expect(fill, declaration).toContain(declaration);
    }
  });

  it('opens a window the user has not placed as a bottom sheet below 900px, no taller than 45% of the panel', () => {
    expect(artifactSource).toContain("const WINDOW_SHEET_QUERY = '(max-width: 899.98px)';");
    const sheet = artifactCss.match(
      /@media \(max-width: 899\.98px\) \{\s*\.motif-cs-window\[data-sheet\]:not\(\[data-placed\]\):not\(\[data-collapsed\]\):not\(\[data-maximized\]\) \{([^}]*)\}/,
    )?.[1] ?? '';
    for (const declaration of ['top: auto !important;', 'bottom: 8px;', 'height: 45vh !important;', 'max-height: 45vh !important;']) {
      expect(sheet, declaration).toContain(declaration);
    }
    // The instruments that fill their window keep the whole panel instead.
    expect(frame).toContain('data-sheet={sheet || undefined}');
    expect(artifactSource.match(/\n\s+sheet=\{false\}\n/g)?.length).toBe(3);
    const whole = rule('.motif-cs-window[data-fill]:not([data-sheet]):not([data-collapsed])');
    expect(whole).toContain('top: var(--motif-cs-topbar-height, 38px) !important;');
    expect(whole).toContain('height: auto !important;');
    // A move or resize starts from the box on screen, and from then on the user's rect is drawn.
    expect(frame).toContain('base: takeDrawnRect(mode),');
    expect(frame).toContain('data-placed={placed || undefined}');
  });

  it('keeps the top bar and the Tools drawer above a window that fills the panel', () => {
    // The sheet hangs from the bottom edge and stops at 45% of the panel, so the top bar and Tools stay reachable.
    expect(artifactCss).toMatch(/@media \(max-width: 899\.98px\) \{\s*\.motif-cs-window\[data-sheet\]:not\(\[data-placed\]\):not\(\[data-collapsed\]\):not\(\[data-maximized\]\) \{\s*top: auto !important;[^}]*max-height: 45vh !important;/);
    // The drawer sits above every window, and launching a workspace from it closes it.
    const drawer = rule('.motif-cs-inspector.motif-cs-pane[data-tools-drawer="open"]');
    expect(Number(drawer.match(/z-index:\s*(\d+);/)?.[1])).toBeGreaterThan(Number(rule('.motif-cs-window').match(/z-index:\s*(\d+);/)?.[1]));
    expect(artifactSource).toContain('if (opened) closeDrawerForWindow();');
    expect(artifactSource).toContain('if (toolsDrawerRef.current) closeToolsDrawer(false);');
  });

  it('gives the tools drawer the whole width of a phone-width panel', () => {
    const phone = artifactCss.match(
      /@media \(max-width: 479px\) \{\s*\.motif-cs-inspector\.motif-cs-pane\[data-tools-drawer="open"\] \{([^}]*)\}/,
    )?.[1] ?? '';
    expect(phone).toContain('width: 100vw !important;');
  });
});

describe('collapsing a floating window keeps its work', () => {
  const frame = sliceBetween(artifactSource, 'function FloatingWindow({', '// One stable Translate panel:');
  const msaSource = readFileSync(resolve(here, '..', 'ClaudeScienceMsaViewer.tsx'), 'utf8');

  it('keeps the body mounted and hides it, instead of unmounting the children', () => {
    // A workspace holds typed text, a name and settings that exist nowhere else.
    expect(frame).not.toContain('{collapsed ? null : (');
    expect(frame).toContain('hidden={collapsed || undefined}');
    expect(frame).toContain('inert={collapsed || undefined}');
    expect(frame).toContain('data-window-collapsed={collapsed || undefined}');
    // Always rendered inside the body; the pane boundary only swaps in a notice on a crash.
    expect(frame).toContain('><ArtifactPaneBoundary pane={title}>{children}</ArtifactPaneBoundary></div>');
    // The resize grip is chrome, not content: it goes while collapsed.
    expect(frame).toContain('{!collapsed && !maximized && !fillsPanel && !inFlow ? <button');
    const hidden = rule('.motif-cs-window[data-collapsed] > .motif-cs-window-body[hidden]');
    expect(hidden).toContain('display: none;');
  });

  it('stands the alignment viewer down while its window is collapsed', () => {
    expect(msaSource).toContain("return Boolean(node?.closest('[data-window-collapsed]'));");
    // Selection Escape, search Escape, and the N / P / slash shortcuts are all window-level.
    expect(msaSource.match(/if \(isInCollapsedWindow\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
