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
    expect(inventoryList).toContain('placeholder="Filter records…"');
  });

  it('keeps Import records in a fixed popover with explicit dismissal and focus return', () => {
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
    expect(artifactCss).toMatch(/top:\s*84px/);
    expect(artifactCss).toMatch(/width:\s*min\(344px, calc\(100vw - 64px\)\)/);
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-import-panel:not\(\[open\]\)\s*\{\s*display:\s*none/);
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-import-panel\[open\]\s*\{\s*display:\s*block/);
  });

  it('uses quiet full-surface active states without one-sided accent rails', () => {
    expect(artifactCss).toMatch(/\.motif-cs-record-tab\[data-active="true"\][\s\S]*?background:\s*var\(--bg-primary\)/);
    // The selector has one copy, so the pattern names the one shared rule body and
    // cannot match lazily across to a later rule.
    expect(artifactCss).toMatch(/\.motif-cs-sidebar \.motif-cs-row\.motif-cs-row-compact\[data-active="true"\] \{\s*background-color:\s*var\(--bg-selected\);\s*box-shadow:\s*none;/);
    expect(artifactCss).toMatch(/\.motif-cs-pane-toggle\[data-active="true"\][\s\S]*?box-shadow:\s*none/);
  });

  it('fills the selected record tab with the one "on" fill in every theme', () => {
    // A theme-scoped tab rule would outrank the shared rule: its border shorthand
    // (0,2,1) beats the shared rule (0,2,0). Both themes use the shared rules, so no
    // theme-scoped tab rule may exist. The selected tab takes the same --bg-selected
    // fill as the selected Records row, with no divider and no underline.
    expect(artifactCss).not.toMatch(/html\[data-theme="[a-z-]+"\] \.motif-cs-record-tab(\[data-active="true"\])? \{/);
    // The tab stands 28px tall on the strip's centre line with no
    // underline, so it keeps no clear bottom border either.
    const tab = /\.motif-cs-record-tab \{([^}]*)\}/.exec(artifactCss);
    expect(tab).not.toBeNull();
    expect(tab![1]).toMatch(/height: 28px;[^}]*border-right: 1px solid transparent;/);
    expect(tab![1]).not.toMatch(/border-bottom/);
    // The row and the tab share --bg-selected, the quiet accent tint.
    expect(artifactCss).toMatch(/\.motif-cs-record-tab\[data-active="true"\] \{\s*background-color: var\(--bg-selected\);\s*color: var\(--text-primary\);\s*\}/);
  });

  it('keeps Inventory chrome fixed while only the record groups scroll', () => {
    expect(artifactCss).toMatch(/\.motif-cs-sidebar\s*\{[\s\S]*?display:\s*flex[\s\S]*?flex-direction:\s*column[\s\S]*?overflow:\s*hidden/);
    expect(artifactCss).toMatch(/\.motif-cs-inventory-list-panel\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?overflow:\s*hidden/);
    expect(artifactCss).toMatch(/\.motif-cs-inventory-groups\s*\{[\s\S]*?overflow:\s*auto[\s\S]*?overscroll-behavior:\s*contain/);
  });

  it('keeps Inventory vertical in the split workspace', () => {
    // The stylesheet carries MORE THAN ONE `@media (min-width: 900px) and
    // (max-width: 1535px)` block, so slicing from the first opener to the 1536
    // breakpoint would span everything in between — including the `max-width: 899px`
    // phone block, which is exactly where the record-tab overrides legitimately
    // live, and the negative assertion below would fail on it. Select the block
    // that actually carries the split-workspace inventory rules and brace-match
    // to its own close, so this guard is immune to how many such blocks exist
    // or where they sit.
    const splitWorkspace = mediaBlockContaining(
      artifactCss,
      '@media (min-width: 900px) and (max-width: 1535px) {',
      '.motif-cs-sidebar .motif-cs-inventory-groups',
    );

    expect(splitWorkspace).toContain('flex-wrap: nowrap;');
    expect(splitWorkspace).toContain('.motif-cs-sidebar .motif-cs-inventory-groups');
    expect(splitWorkspace).toContain('display: block;');
    expect(splitWorkspace).toContain('.motif-cs-sidebar .motif-cs-inventory-group-head');
    expect(splitWorkspace).toContain('display: flex;');
    expect(splitWorkspace).not.toContain('--compact-inventory-height');
    expect(splitWorkspace).not.toContain('.motif-cs-record-strip');
  });

  it('hides the record tab strip beside a docked Inventory at every width, and keeps one Import records control', () => {
    // Beside a docked Inventory the strip would list the same 13 records in the
    // same order with the same selection, for 32px of full-width height.
    // It shows beside a floating or hidden Inventory, and only with two or more
    // records (or while the import panel it hosts is open).
    expect(artifactSource).toContain("const recordStripHidden = (paneVisibility.inventory && panePlacements.inventory === 'docked')\n    || (payload.records.length < 2 && !importPanelOpen);");
    expect(artifactSource).toContain('<div className="motif-cs-record-strip" hidden={recordStripHidden || undefined}>');
    expect(artifactCss).toMatch(/\n\.motif-cs-record-strip\[hidden\] \{\s*display: none;/);
    expect(artifactCss).toMatch(/\n\.motif-cs-shell:has\(\.motif-cs-record-strip\[hidden\]\) \{\s*grid-template-rows: auto 1fr;/);
    expect(artifactCss).not.toContain('data-inventory-visible');
    // Hiding the Inventory must leave a visible way to add a record. The top bar's
    // "+" renders only while the Inventory is hidden: the Import records panel finds its
    // trigger with querySelector('.motif-cs-add-entry-button'), so two at once would
    // make one of them close and reopen the panel on a second click. The button sits
    // in the top bar, not the strip's row (there it reads as the bar wrapping); the
    // strip still hosts the panel, under the same condition.
    const strip = sliceBetween(artifactSource, '<div className="motif-cs-record-strip"', '</div>\n\n      <main');
    expect(strip).toContain('{paneVisibility.inventory ? null : importSequencePanel}');
    expect(strip).not.toContain('motif-cs-add-entry-button');
    const topbar = sliceBetween(artifactSource, '<div className="motif-cs-topbar-meta">', '</header>');
    expect(topbar).toContain('{paneVisibility.inventory ? null : (');
    expect(topbar).toContain('className="motif-cs-mini-button motif-cs-add-entry-button"');
    expect(artifactCss).toMatch(/\.motif-cs-record-strip \.motif-cs-import-panel\[open\] \{\s*position: fixed;/);
    // Focus goes to whichever record control shows, not only to the active tab.
    expect(artifactSource.match(/focusActiveRecordControl\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(artifactSource).not.toContain("document.querySelector<HTMLButtonElement>('.motif-cs-record-tab[data-active=\"true\"]')");
  });

  it('gives the inventory scroller a themed scrollbar rather than the platform default', () => {
    // At laptop sizes this list is the only place a session meets its whole
    // vector inventory, and it hides 237px of it at 1440x900 and 303px at
    // 1024x768. `scrollbar-gutter: stable` reserves the lane; without a colour
    // the bar falls through to the platform default and measures 1.72:1 against
    // its own track in light and 2.66:1 in dark, under the 3.0 non-text floor.
    // Measured HEADED — headless macOS Chromium reports a 0px gutter and no bar
    // at all.
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
    // Labels stay visible at every width: only the brand leaves the row, below 470px.
    expect(artifactCss).not.toMatch(/\.motif-cs-pane-toggle > span\s*\{[^}]*display:\s*none/);
    expect(extremeTopbar).toMatch(/@media \(max-width: 469px\) \{\s*\.motif-cs-topbar > \.motif-cs-brand \{\s*display: none;\s*\}\s*\}/);
    // At the 326px minimum the four labels fit beside the Annotate reserve with
    // no sideways scroll: tighter padding and a narrower gap before Tools at
    // 340px. The borders stay; they are what make an off toggle read as a button.
    expect(extremeTopbar).toMatch(
      /@media \(max-width: 340px\) \{\s*\.motif-cs-topbar \{\s*padding-left: 4px;\s*\}\s*\.motif-cs-pane-toggle \{\s*padding-inline: 2px;\s*\}\s*\.motif-cs-pane-toggle\[data-pane-toggle="tools"\] \{\s*margin-inline: 4px;\s*\}\s*\}/,
    );
    expect(extremeTopbar).not.toMatch(/border-inline-width:\s*0/);
    expect(artifactCss).not.toMatch(/\.motif-cs-topbar \{[^}]*grid-template-columns/);
    expect(artifactSource).not.toContain('motif-cs-toggle-state');
    expect(artifactCss).not.toContain('motif-cs-toggle-state');
    expect(artifactSource).not.toContain('data-state={showTranslations');
    expect(artifactCss).toMatch(/\.motif-cs-pane-toggle\[data-active="true"\][\s\S]*?background:\s*transparent/);
    expect(artifactSource).not.toContain('<small className="motif-cs-pane-state">Rail</small>');
    expect(artifactSource).toContain("toolsDocked ? 'expanded' : 'rail'");
  });

  it('keeps the active look on the last open pane, whose toggle is disabled', () => {
    const lastOpen = artifactCss.match(
      /\.motif-cs-pane-toggle\[data-active="true"\]:disabled:focus-visible \{([^}]*)\}/,
    )?.[1] ?? '';
    expect(lastOpen).toContain('background-color: var(--bg-active);');
    expect(lastOpen).toContain('border-color: transparent;');
    expect(lastOpen).toContain('box-shadow: none;');
    expect(lastOpen).toContain('opacity: 1;');
    expect(lastOpen).not.toContain('background: transparent;');
  });
});
