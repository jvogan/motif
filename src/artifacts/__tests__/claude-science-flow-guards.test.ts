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

describe('record tab strip keeps the active tab in view', () => {
  const effect = sliceBetween(
    artifactSource,
    "const activeTab = tabs?.querySelector<HTMLElement>('.motif-cs-record-tab[data-active=\"true\"]');",
    'const scanEnzymes = useMemo(',
  );

  it('measures the tab against the strip, not against a positioned ancestor', () => {
    // Measure the active tab relative to the scrolling strip: offsetLeft is relative to a
    // positioned ancestor and would include the Import records button before the strip.
    expect(effect).not.toContain('activeTab.offsetLeft');
    expect(effect).toContain('const tabLeft = tabBox.left - stripBox.left + tabs.scrollLeft;');
  });

  it('runs again when the record list or the Records pane changes', () => {
    expect(effect).toContain('}, [recordId, payload.records.length, paneVisibility.inventory]);');
  });
});

describe('docked panes take the free height below 900px', () => {
  const marker = '/* Below 900px a docked pane takes the free height instead of leaving it blank.';
  const block = sliceBetween(artifactCss, marker, '/* Pane placement');
  const unresized = '.motif-cs-sequence-column:not([data-stacked-resized="true"])';

  it('grows an unresized stacked sequence into the free height and scrolls inside it', () => {
    expect(block).toContain('@media (max-width: 899px) {');
    expect(block).toMatch(/\.motif-cs-sequence-column:not\(\[data-stacked-resized="true"\]\) \{\s*display: flex;\s*flex-direction: column;\s*flex-grow: 1 !important;/);
    expect(block).toContain(`${unresized} .motif-cs-sequence-panel > .motif-cs-sequence {`);
    expect(block).toMatch(/\.motif-cs-sequence-panel > \.motif-cs-sequence \{\s*flex: 1 1 auto;\s*min-height: 160px;\s*max-height: none;/);
    // A height the user dragged stays as dragged.
    expect(block).not.toContain('flex-basis: 0 !important;\n    min-height: 360px');
  });

  it('lets a lone record list or map fill the workspace, with a floor for the list', () => {
    expect(block).toMatch(/\[data-content-pane-count="1"\] > \.motif-cs-sidebar,\s*\.motif-cs-main\[data-content-pane-count="1"\] > \.motif-cs-map-column \{\s*flex: 1 0 auto !important;\s*max-height: none;/);
    expect(block).toMatch(/> \.motif-cs-sidebar \{\s*flex-basis: 0 !important;\s*min-height: 240px;/);
  });

  it('drops the resize handle of a lone pane and leaves the map drawing size alone', () => {
    expect(block).toMatch(/\[data-content-pane-count="1"\] > \.motif-cs-stacked-resize-handle \{\s*display: none;/);
    expect(block).not.toContain('.motif-cs-map-frame');
  });

  it('sits above the pane placement rules', () => {
    expect(artifactCss.indexOf(marker)).toBeGreaterThan(0);
    expect(artifactCss.indexOf(marker)).toBeLessThan(artifactCss.indexOf('/* Pane placement'));
  });
});

describe('Import records button in a narrow panel', () => {
  it('shortens its visible label below 480px and keeps the accessible name', () => {
    expect(artifactSource.match(/<span>Import<span className="motif-cs-add-entry-tail"> records<\/span><\/span>/g)).toHaveLength(2);
    const block = sliceBetween(artifactCss, 'Below 480px the Import records button reads', '/* Pane placement');
    expect(block).toMatch(/@media \(max-width: 479px\) \{\s*\.motif-cs-add-entry-button \.motif-cs-add-entry-tail \{\s*display: none;/);
    const buttons = artifactSource.match(/className="motif-cs-mini-button motif-cs-add-entry-button"[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button).toContain('aria-label="Import records"');
  });
});
