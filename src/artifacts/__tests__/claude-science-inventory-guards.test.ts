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
    const splitWorkspace = sliceBetween(
      artifactCss,
      '@media (min-width: 768px) and (max-width: 1535px) {',
      '@media (min-width: 1536px) {',
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
