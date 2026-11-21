// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SequenceActionMenu, type SequenceActionMenuItem } from '../motif-artifact';

const here = dirname(fileURLToPath(import.meta.url));
const artifactSource = readFileSync(resolve(here, '..', 'motif-artifact.tsx'), 'utf8');
const artifactCss = readFileSync(resolve(here, '..', 'motif-artifact.css'), 'utf8');

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

function cssRule(selector: string): string {
  const at = artifactCss.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`));
  expect(at, `missing CSS rule ${selector}`).toBeGreaterThanOrEqual(0);
  const open = artifactCss.indexOf('{', at);
  return artifactCss.slice(open + 1, artifactCss.indexOf('}', open));
}

describe('Sequence pane chrome', () => {
  const sequencePanel = between(
    artifactSource,
    '<section className="motif-cs-panel motif-cs-sequence-panel">',
    '<SequenceToolsPanel',
  );

  it('has no panel head repeating the pane name, the strand and the range', () => {
    // A head would be a 38px row over an 88px sequence area at 1280x720.
    expect(sequencePanel).not.toContain('className="motif-cs-panel-head"');
    expect(sequencePanel).not.toContain('motif-cs-panel-meta');
    // The strand direction is stated once, in the resting readout.
    expect(sequencePanel.match(/5′→3′/g)).toHaveLength(1);
    expect(sequencePanel).toContain('className="motif-cs-seq-orientation"');
  });

  it('puts one toolbar row over the bases and the selection dock at the foot', () => {
    const chrome = sequencePanel.indexOf('<div className="motif-cs-sequence-chrome">');
    const toolbar = sequencePanel.indexOf('<div className="motif-cs-edit-toolbar"');
    const view = sequencePanel.indexOf('<SequenceText');
    const dock = sequencePanel.indexOf('className="motif-cs-selection-bar"');
    expect(chrome).toBeGreaterThanOrEqual(0);
    expect(toolbar).toBeGreaterThan(chrome);
    // The dock is the status line under the bases, not a second row of chrome
    // over them: with the title row, the toolbar is the pane's whole header.
    // It follows the toolbar in the document, so its actions are one Tab stop
    // past it, and CSS `order` draws it at the foot (an e2e pins the drawing).
    expect(view).toBeGreaterThan(toolbar);
    expect(dock).toBeGreaterThan(toolbar);
    expect(dock).toBeLessThan(view);
    expect(between(sequencePanel, '<div className="motif-cs-sequence-chrome">', '{selectedFeatureQuarantineStatus').match(/className="motif-cs-selection-bar"/g)).toHaveLength(1);
    expect(cssRule('.motif-cs-sequence-panel > .motif-cs-selection-bar')).toMatch(/order:\s*1/);

    const strip = cssRule('.motif-cs-sequence-chrome');
    expect(strip).toMatch(/display:\s*flex/);
    expect(strip).toMatch(/flex-direction:\s*column/);
    // In a flex column a clipping box has no content floor; without this the
    // strip collapsed to 5px.
    expect(strip).toMatch(/flex:\s*0 0 auto/);
    // The toolbar wraps its two groups; neither scrolls a control out of reach.
    const toolbarRule = cssRule('.motif-cs-edit-toolbar');
    expect(toolbarRule).toMatch(/flex-wrap:\s*wrap/);
    expect(toolbarRule).not.toMatch(/overflow-x/);
    // The dock keeps one height with or without a selection.
    expect(cssRule('.motif-cs-selection-bar')).toMatch(/min-height:\s*32px/);
  });

  it('keeps three controls in the dock and the rest in Create, with no short labels', () => {
    const dock = between(sequencePanel, '<div className="motif-cs-selection-actions">', '{selectedFeatureQuarantineStatus');
    expect(dock).toContain('Add feature');
    expect(dock).toContain('<SequenceActionMenu');
    expect(dock).toContain('label="Create"');
    for (const label of ['Pin translation', 'Design primers', 'New reverse complement record', 'New protein record']) {
      expect(dock).toContain(`'${label}'`);
    }
    expect(artifactSource).not.toContain('motif-cs-label-short');
    expect(artifactSource).not.toMatch(/'(Del AA|\+ RC|\+ Prot)'|>(\+ RC|\+ Prot|Primers|Add AA)</);
  });

  it('says why an unavailable action is off and what to do instead', () => {
    const dock = between(sequencePanel, '<div className="motif-cs-selection-actions">', '{selectedFeatureQuarantineStatus');
    // Copy and Add feature: the title is a disabled button's accessible
    // description, so it has to name the missing step, not the action.
    expect(dock).toContain("'Select a range or feature to copy'");
    expect(dock).toContain("'Ordered segments cannot be copied together'");
    expect(dock).toContain("'Drag a range to add a feature'");
    // With a feature selected, the reason is that it is one already.
    expect(dock).toContain("'This is already a feature; drag a range to add a feature'");
    // Add feature is drawn in every state and disabled without a range, so Copy
    // and Create keep their places when a range starts or ends.
    expect(dock).not.toContain('{selectedFeature && !selectedMapRange ? null : (');
    expect(dock).toMatch(/<button\s+className="motif-cs-mini-button"\s+type="button"\s+disabled=\{!canAnnotateSelectedMapRange\}/);
    expect(dock).not.toContain("'Drag a range to add another feature'");
    // The translating entries reuse the Translation panel's own reason first.
    expect(dock.match(/translationUnavailableReason \?\? \(selectionSummary/g)).toHaveLength(2);
    expect(dock).toContain("'Select a range or coding feature'");
  });

  it('gives a protein record no Create menu, since every entry in it needs nucleotides', () => {
    const dock = between(sequencePanel, '<div className="motif-cs-selection-actions">', '{selectedFeatureQuarantineStatus');
    expect(dock).toMatch(/\{isNucleotideRecord \? \(\s*<SequenceActionMenu/);
  });

  it('separates sequence blocks with whitespace, not a rule', () => {
    const block = cssRule('.motif-cs-seq-block');
    expect(block).not.toMatch(/border/);
    expect(block).toMatch(/padding:\s*6px 0 8px/);
    expect(artifactCss).not.toMatch(/\.motif-cs-seq-block:last-child\s*\{[^}]*border/);
  });

  it('draws no label shard on a feature block too narrow for four characters', () => {
    // The base label rule comes before the width rules, or at equal
    // specificity it puts back every label they hide.
    const base = artifactCss.indexOf('\n.motif-cs-feature-block span {');
    const tiny = artifactCss.indexOf('@container (max-width: 34px) {\n  .motif-cs-feature-block span {\n    display: none;');
    const shard = artifactCss.indexOf('@container (max-width: 6ch) {\n  .motif-cs-feature-block span:not([data-short]) {\n    display: none;');
    expect(base).toBeGreaterThanOrEqual(0);
    expect(tiny).toBeGreaterThan(base);
    expect(shard).toBeGreaterThan(base);
    // A name of three characters or fewer is whole at that width, so it stays.
    expect(artifactSource).toContain('<span translate="no" data-short={feature.name.length < 4 || undefined}>{feature.name}</span>');
  });

  it('shows the edited state at every width', () => {
    // It sits after the record's name in the title row, above the Undo that
    // reverts it, rather than taking room in the one toolbar row.
    const titleRow = between(artifactSource, 'className="motif-cs-title-row motif-cs-sequence-title"', '<section className="motif-cs-panel motif-cs-sequence-panel">');
    expect(titleRow).toContain('className="motif-cs-chip motif-cs-edit-state"');
    expect(sequencePanel).not.toContain('motif-cs-edit-state');
    // Nothing may hide it: neither the edit-state chip nor the caret readout is
    // display:none in narrow panes.
    expect(artifactCss).not.toMatch(/\.motif-cs-edit-state[^{]*\{[^}]*display:\s*none/);
    expect(artifactCss).not.toMatch(/\.motif-cs-edit-hint\s*\{[^}]*display:\s*none/);
  });
});

const baseItems = (spy: (id: string) => void): SequenceActionMenuItem[] => [
  { id: 'aa', label: 'Add AA track', note: 'Show the translation', onSelect: () => spy('aa') },
  { id: 'primers', label: 'Design primers', onSelect: () => spy('primers') },
  { id: 'rc', label: 'New reverse complement record', separatorBefore: true, onSelect: () => spy('rc') },
  { id: 'protein', label: 'New protein record', disabled: true, note: 'Select a range to translate it', onSelect: () => spy('protein') },
];

function renderMenu(spy = vi.fn()) {
  const view = render(
    <div>
      <button type="button">before</button>
      <SequenceActionMenu label="Create" menuLabel="Create from the sequence" items={baseItems(spy)} />
      <button type="button">after</button>
    </div>,
  );
  const button = screen.getByRole('button', { name: 'Create' });
  return { ...view, button, spy };
}

describe('SequenceActionMenu', () => {
  afterEach(() => cleanup());

  it('is a menu button that opens on its first item and walks the items with arrows, Home and End', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    button.focus();
    await user.keyboard('{ArrowDown}');
    const menu = screen.getByRole('menu', { name: 'Create from the sequence' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(menu.id);
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      'Add AA track', 'Design primers', 'New reverse complement record', 'New protein record',
    ]);
    expect(items.every((item) => item.tabIndex === -1)).toBe(true);
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    expect(document.activeElement).toBe(items[0]);

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[1]);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(items[3]);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(items[0]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(items[3]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(items[0]);
  });

  it('opens on the last item from ArrowUp', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    button.focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('New protein record');
  });

  it('closes on Escape, returns focus to the button, and keeps the key from the document', async () => {
    const user = userEvent.setup();
    const documentEscape = vi.fn();
    document.addEventListener('keydown', documentEscape);
    try {
      const { button } = renderMenu();
      await user.click(button);
      expect(screen.getByRole('menu')).toBeTruthy();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(button.getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(button);
      // The document handler clears the selection on Escape; the menu that was
      // about to act on that selection must not let the key through.
      expect(documentEscape).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', documentEscape);
    }
  });

  it('closes on Tab and lets the browser continue from the button, not into the menu', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    await user.click(button);
    // The browser's own Tab step runs after dispatch, from whatever holds focus
    // then. Record that moment: focus must already be back on the button, and
    // the key must not be cancelled, so the next stop is what follows the button.
    let atDefault: { focused: Element | null; prevented: boolean } | null = null;
    const record = (event: KeyboardEvent) => {
      if (event.key === 'Tab') atDefault = { focused: document.activeElement, prevented: event.defaultPrevented };
    };
    document.addEventListener('keydown', record);
    try {
      await user.keyboard('{Tab}');
    } finally {
      document.removeEventListener('keydown', record);
    }
    expect(screen.queryByRole('menu')).toBeNull();
    expect(atDefault).toEqual({ focused: button, prevented: false });
  });

  it('runs an item after closing, with focus back on the button', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { button } = renderMenu(spy);
    await user.click(button);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(spy).toHaveBeenCalledWith('rc');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('keeps an unavailable item focusable and explained, and does nothing when it is pressed', async () => {
    const user = userEvent.setup();
    const spy = vi.fn();
    const { button } = renderMenu(spy);
    await user.click(button);
    const off = screen.getByRole('menuitem', { name: 'New protein record' });
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(off.hasAttribute('disabled')).toBe(false);
    const note = document.getElementById(off.getAttribute('aria-describedby') ?? '');
    expect(note?.textContent).toBe('Select a range to translate it');
    await user.keyboard('{End}{Enter}');
    expect(document.activeElement).toBe(off);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('closes on a pointer press outside without taking focus', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    await user.click(button);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
