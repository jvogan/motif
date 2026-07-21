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

/**
 * Return the `@media` block opened by `condition` that contains `marker`,
 * brace-matched to its own close.
 *
 * `sliceBetween` takes the FIRST occurrence of its start needle and runs to the
 * next end needle, which silently spans unrelated rules once a second block
 * shares a media condition — and a stylesheet is free to carry several. Matching
 * braces keeps a block's assertions about that block.
 */
function mediaBlockContaining(css: string, condition: string, marker: string): string {
  for (let from = 0; ; ) {
    const open = css.indexOf(condition, from);
    expect(open, `no ${condition} block contains ${marker}`).toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = -1;
    for (let i = css.indexOf('{', open); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    expect(end, `unbalanced braces after ${condition}`).toBeGreaterThan(open);
    const block = css.slice(open, end + 1);
    if (block.includes(marker)) return block;
    from = open + condition.length;
  }
}

describe('Claude Science Inventory regression guards', () => {
  it('renders no record rows while an Inventory group is collapsed', () => {
    const inventoryList = sliceBetween(
      artifactSource,
      'function InventoryList({',
      'function ImportSequencePanel({',
    );

    expect(inventoryList).not.toContain('selectedCollapsedRecord');
    expect(inventoryList).toContain(')) : null}');
  });

  it('keeps feature counts out of record navigation', () => {
    const inventoryList = sliceBetween(
      artifactSource,
      'function InventoryList({',
      'function ImportSequencePanel({',
    );

    expect(inventoryList).not.toContain('{record.features.length} feat');
    expect(inventoryList).toContain('{record.name}');
    expect(inventoryList).not.toContain('motif-cs-record-dot');
    expect(inventoryList).toContain('motif-cs-inventory-record-row');
  });

  it('reports only usable imports and lets project groups participate in search', () => {
    const importParser = sliceBetween(
      artifactSource,
      'function parseImportedRecords(',
      'function applyImportDefaults(',
    );
    const inventoryList = sliceBetween(
      artifactSource,
      'function InventoryList({',
      'function ImportSequencePanel({',
    );

    expect(importParser).toContain('}).filter((record) => Boolean(record.seq));');
    expect(inventoryList).toContain('record.group,');
    expect(inventoryList).toContain('record.organism,');
    expect(inventoryList).toContain('placeholder="Filter inventory…"');
  });

  it('keeps Add Entry in a fixed popover with explicit dismissal and focus return', () => {
    const importPanel = sliceBetween(
      artifactSource,
      'function ImportSequencePanel({',
      'function FeatureList({',
    );

    expect(importPanel).toContain("document.addEventListener('pointerdown', closeFromOutside, true)");
    expect(importPanel).toContain("document.addEventListener('keydown', closeFromEscape)");
    expect(importPanel).toContain("trigger?.contains(event.target)");
    expect(importPanel).toContain('onOpenChange(false)');
    expect(importPanel).toContain("document.querySelector<HTMLButtonElement>('.motif-cs-add-entry-button')?.focus()");
    expect(importPanel).toContain('window.requestAnimationFrame(() => {');
    expect(importPanel).toContain('open={open}');
    expect(importPanel).toContain('className="motif-cs-import-slot"');
    expect(artifactSource).toContain('aria-expanded={importPanelOpen}');
    expect(artifactSource).toContain('onClick={() => setImportPanelOpen((open) => !open)}');
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-import-slot\s*\{[\s\S]*?min-height:\s*36px/);
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-import-panel\[open\][\s\S]*?position:\s*fixed/);
    expect(artifactCss).toMatch(/top:\s*113px/);
    expect(artifactCss).toMatch(/width:\s*min\(344px, calc\(100vw - 64px\)\)/);
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-import-panel:not\(\[open\]\)\s*\{\s*display:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-import-panel\[open\]\s*\{\s*display:\s*block/);
  });

  it('uses quiet full-surface active states without one-sided accent rails', () => {
    expect(artifactCss).toMatch(/\.motif-cs-record-tab\[data-active="true"\][\s\S]*?background:\s*var\(--bg-primary\)/);
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-row\.motif-cs-row-compact\[data-active="true"\][\s\S]*?background:\s*color-mix\(in srgb, var\(--accent\) 10%, var\(--bg-primary\)\)[\s\S]*?box-shadow:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-pane-toggle\[data-active="true"\][\s\S]*?box-shadow:\s*none/);
  });

  it('keeps Inventory chrome fixed while only the record groups scroll', () => {
    expect(artifactCss).toMatch(/\.motif-cs-sidebar\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column[\s\S]*?overflow:\s*hidden/);
    expect(artifactCss).toMatch(/\.motif-cs-inventory-list-panel\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?overflow:\s*hidden/);
    expect(artifactCss).toMatch(/\.motif-cs-inventory-groups\s*\{[\s\S]*?overflow:\s*auto[\s\S]*?overscroll-behavior:\s*contain/);
  });

  it('keeps Inventory vertical and record tabs visible in the split workspace', () => {
    // The stylesheet carries MORE THAN ONE `@media (min-width: 768px) and
    // (max-width: 1535px)` block, so slicing from the first opener to the 1536
    // breakpoint spans everything in between — including the `max-width: 767px`
    // phone block, which is exactly where the record-tab overrides legitimately
    // live. That made the negative assertion below fail on a stylesheet whose
    // split-workspace rules were untouched. Select the block that actually
    // carries the split-workspace inventory rules and brace-match to its own
    // close, so this guard is immune to how many such blocks exist or where
    // they sit.
    const splitWorkspace = mediaBlockContaining(
      artifactCss,
      '@media (min-width: 768px) and (max-width: 1535px) {',
      '.motif-cs-sidebar .motif-cs-inventory-groups',
    );

    expect(splitWorkspace).toContain('flex-wrap: nowrap;');
    expect(splitWorkspace).toContain('.motif-cs-sidebar .motif-cs-inventory-groups');
    expect(splitWorkspace).toContain('display: block;');
    expect(splitWorkspace).toContain('.motif-cs-sidebar .motif-cs-inventory-group-head');
    expect(splitWorkspace).toContain('display: flex;');
    expect(splitWorkspace).not.toContain('--compact-inventory-height');
    expect(splitWorkspace).not.toContain('.motif-cs-record-tabs[data-inventory-visible="true"]');
    expect(artifactCss).toContain(
      '.motif-cs-shell:has(> .motif-cs-record-tabs[data-inventory-visible="true"])',
    );
    expect(artifactCss).toMatch(/@media \(max-width: 767px\)[\s\S]*?data-inventory-visible="true"\]\)\s*\{\s*grid-template-rows:\s*auto 1fr/);
  });

  it('gives the inventory scroller a themed scrollbar rather than the platform default', () => {
    // At laptop sizes this list is the only place a session meets its whole
    // vector inventory, and it hides 237px of it at 1440x900 and 303px at
    // 1024x768. `scrollbar-gutter: stable` reserves the lane; without a colour
    // the bar fell through to the platform default and measured 1.72:1 against
    // its own track in BOTH light themes and 2.66:1 in both dark ones, under the
    // 3.0 non-text floor. Identical rgb across all four themes is the tell that
    // it was never themed rather than themed badly. Measured HEADED — headless
    // macOS Chromium reports a 0px gutter and no bar at all.
    const list = sliceBetween(artifactCss, '.motif-cs-inventory-groups {', '}');
    expect(list).toContain('overflow: auto');
    expect(list).toContain('scrollbar-gutter: stable');
    expect(list, 'inventory scroller left on the platform default scrollbar').toContain('scrollbar-color:');

    // One scrollbar for the app, not two: the same two tokens the alignment
    // matrix's scroller already uses.
    const matrix = sliceBetween(artifactCss, '.motif-cs-msa-matrix-scroll {', '}');
    const colourOf = (rule: string) => /scrollbar-color:\s*([^;]+);/.exec(rule)?.[1].replace(/\s+/g, ' ').trim();
    expect(colourOf(list)).toBeTruthy();
    expect(colourOf(list)).toBe(colourOf(matrix));
  });

  it('keeps the extreme-width topbar on one row without hiding stateful controls', () => {
    const extremeTopbar = sliceBetween(
      artifactCss,
      '@media (max-width: 520px) {',
      '@media (max-width: 640px) {',
    );

    expect(extremeTopbar).toContain('flex-wrap: nowrap;');
    expect(extremeTopbar).toContain('.motif-cs-pane-toggle > span');
    expect(extremeTopbar).toContain('display: none;');
    expect(artifactSource).not.toContain('motif-cs-toggle-state');
    expect(artifactCss).not.toContain('motif-cs-toggle-state');
    expect(artifactSource).not.toContain('data-state={showTranslations');
    expect(artifactCss).toMatch(/\.motif-cs-pane-toggle\[data-active="true"\][\s\S]*?background:\s*transparent/);
    expect(artifactSource).toContain('<small className="motif-cs-pane-state">Rail</small>');
  });
});
