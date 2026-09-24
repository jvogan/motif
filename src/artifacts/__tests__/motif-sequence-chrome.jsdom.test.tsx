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
    // The head was a 38px row over an 88px sequence area at 1280x720.
    expect(sequencePanel).not.toContain('className="motif-cs-panel-head"');
    expect(sequencePanel).not.toContain('motif-cs-panel-meta');
    // The strand direction is stated once, in the resting readout.
    expect(sequencePanel.match(/5′→3′/g)).toHaveLength(1);
    expect(sequencePanel).toContain('className="motif-cs-seq-orientation"');
  });

  it('puts the toolbar and the selection dock in one wrapping strip, toolbar first', () => {
    const chrome = sequencePanel.indexOf('<div className="motif-cs-sequence-chrome">');
    const toolbar = sequencePanel.indexOf('<div className="motif-cs-edit-toolbar"');
    const dock = sequencePanel.indexOf('className="motif-cs-selection-bar"');
    expect(chrome).toBeGreaterThanOrEqual(0);
    expect(toolbar).toBeGreaterThan(chrome);
    expect(dock).toBeGreaterThan(toolbar);

    const strip = cssRule('.motif-cs-sequence-chrome');
    expect(strip).toMatch(/display:\s*flex/);
    expect(strip).toMatch(/flex-wrap:\s*wrap/);
    // In a flex column a clipping box has no content floor; without this the
    // strip collapsed to 5px.
    expect(strip).toMatch(/flex:\s*0 0 auto/);
    // The dock grows far faster than the toolbar, so on a shared row the
    // toolbar keeps its content width, and its basis decides when it wraps.
    const dockRule = cssRule('.motif-cs-sequence-chrome > .motif-cs-selection-bar');
    const basis = /flex:\s*(\d+) 1 (\d+)px/.exec(dockRule);
    expect(basis, 'dock flex').not.toBeNull();
    expect(Number(basis![1])).toBeGreaterThanOrEqual(100);
    // Three buttons (222px) and a readout that can hold a feature name.
    expect(Number(basis![2])).toBeGreaterThanOrEqual(400);
    expect(cssRule('.motif-cs-sequence-chrome > .motif-cs-edit-toolbar')).toMatch(/flex:\s*1 1 auto/);
  });

  it('keeps three controls in the dock and the rest in Create, with no short labels', () => {
    const dock = between(sequencePanel, '<div className="motif-cs-selection-actions">', '{selectedFeatureQuarantineStatus');
    expect(dock).toContain('+ Feature');
    expect(dock).toContain('<SequenceActionMenu');
    expect(dock).toContain('label="Create"');
    for (const label of ['Add AA track', 'Design primers', 'New reverse complement record', 'New protein record']) {
      expect(dock).toContain(`'${label}'`);
    }
    expect(artifactSource).not.toContain('motif-cs-label-short');
    expect(artifactSource).not.toMatch(/'(Del AA|\+ RC|\+ Prot)'|>(\+ RC|\+ Prot|Primers|Add AA)</);
  });

  it('says why an unavailable action is off and what to do instead', () => {
    const dock = between(sequencePanel, '<div className="motif-cs-selection-actions">', '{selectedFeatureQuarantineStatus');
    // Copy and + Feature: the title is a disabled button's accessible
    // description, so it has to name the missing step, not the action.
    expect(dock).toContain("'Select a range or a feature to copy its sequence'");
    expect(dock).toContain("'This ordered location cannot be copied as one sequence'");
    expect(dock).toContain("'Drag a range on the sequence to add a feature'");
    expect(dock).toContain("'A feature is selected; drag a range on the sequence to add a new feature'");
    // The translating entries reuse the Translation panel's own reason first.
    expect(dock.match(/translationUnavailableReason \?\? \(selectionSummary/g)).toHaveLength(2);
    expect(dock).toContain("'Select a range or coding feature to translate it'");
  });

  it('gives a protein record no Create menu, since every entry in it needs nucleotides', () => {
    const dock = between(sequencePanel, '<div className="motif-cs-selection-actions">', '{selectedFeatureQuarantineStatus');
    expect(dock).toMatch(/\{isNucleotideRecord \? \(\s*<SequenceActionMenu/);
  });

  it('shows the edited state at every width', () => {
    expect(sequencePanel).toContain('className="motif-cs-chip motif-cs-edit-state"');
    // Nothing may hide it, and the caret readout that used to carry "edited"
    // is no longer display:none in narrow panes either.
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
