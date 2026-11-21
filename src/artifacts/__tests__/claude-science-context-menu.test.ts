// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  featureMenuPoint,
  isContextMenuKey,
  keepsNativeContextMenu,
  placeContextMenu,
  returnsFocus,
  selectionMenuItems,
  type SelectionMenuState,
} from '../claude-science-context-menu';

const MENU = { width: 214, height: 135 };

describe('placeContextMenu', () => {
  it('opens right of and below the point when it fits', () => {
    expect(placeContextMenu({ x: 244, y: 300 }, MENU, { width: 700, height: 860 })).toEqual({ left: 244, top: 300, maxHeight: 844 });
  });

  it('opens to the left of a point near the right edge and above a point near the bottom', () => {
    const place = placeContextMenu({ x: 380, y: 800 }, MENU, { width: 400, height: 860 });
    expect(place.left).toBe(380 - 214);
    expect(place.top).toBe(800 - 135);
  });

  it('keeps the whole menu at least 8px inside the viewport, whatever the point', () => {
    for (const [width, height] of [[400, 600], [700, 860], [1040, 760], [1440, 900]]) {
      for (const x of [-20, 0, 5, width / 2, width - 5, width + 20]) {
        for (const y of [-20, 0, 5, height / 2, height - 5, height + 20]) {
          const place = placeContextMenu({ x, y }, MENU, { width, height });
          expect(place.left).toBeGreaterThanOrEqual(8);
          expect(place.top).toBeGreaterThanOrEqual(8);
          expect(place.left + MENU.width).toBeLessThanOrEqual(width - 8);
          expect(place.top + MENU.height).toBeLessThanOrEqual(height - 8);
        }
      }
    }
  });

  it('opens under the clicked row at the pointer\'s x, or over it when there is less room below', () => {
    const row = { top: 300, bottom: 322 };
    expect(placeContextMenu({ x: 244, y: 311 }, MENU, { width: 700, height: 860 }, 8, row)).toEqual({ left: 244, top: 322, maxHeight: 530 });
    const low = { top: 776, bottom: 798 };
    expect(placeContextMenu({ x: 244, y: 787 }, MENU, { width: 700, height: 860 }, 8, low)).toEqual({ left: 244, top: 776 - 135, maxHeight: 768 });
    // It is clamped to the viewport in x and never flips to the pointer's left.
    expect(placeContextMenu({ x: 690, y: 311 }, MENU, { width: 700, height: 860 }, 8, row).left).toBe(700 - 214 - 8);
    // With room on neither side it takes the larger side, capped there, and still covers none of the row.
    const tight = placeContextMenu({ x: 100, y: 160 }, { width: 214, height: 500 }, { width: 400, height: 300 }, 8, { top: 150, bottom: 170 });
    expect(tight).toEqual({ left: 100, top: 8, maxHeight: 142 });
    expect(tight.top + Math.min(500, tight.maxHeight)).toBeLessThanOrEqual(150);
  });

  it('caps a menu taller than the viewport, which then scrolls', () => {
    expect(placeContextMenu({ x: 100, y: 100 }, { width: 214, height: 500 }, { width: 400, height: 300 })).toEqual({ left: 100, top: 8, maxHeight: 284 });
  });
});

describe('isContextMenuKey', () => {
  const key = (key: string, mods: Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean>> = {}) => ({
    key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods,
  });
  it('accepts the Menu key and Shift+F10 only', () => {
    expect(isContextMenuKey(key('ContextMenu'))).toBe(true);
    expect(isContextMenuKey(key('F10', { shiftKey: true }))).toBe(true);
    expect(isContextMenuKey(key('F10'))).toBe(false);
    expect(isContextMenuKey(key('F10', { shiftKey: true, metaKey: true }))).toBe(false);
    expect(isContextMenuKey(key('F10', { shiftKey: true, ctrlKey: true }))).toBe(false);
  });
});

describe('keepsNativeContextMenu', () => {
  it('leaves the browser menu to text fields and editable text', () => {
    document.body.innerHTML = '<input id="a"><textarea id="b"></textarea><div contenteditable="true"><span id="c">x</span></div><div id="d" tabindex="0"></div>';
    expect(keepsNativeContextMenu(document.getElementById('a'))).toBe(true);
    expect(keepsNativeContextMenu(document.getElementById('b'))).toBe(true);
    expect(keepsNativeContextMenu(document.getElementById('c'))).toBe(true);
    expect(keepsNativeContextMenu(document.getElementById('d'))).toBe(false);
  });
});

describe('featureMenuPoint', () => {
  it('opens a feature bar\'s menu under its left edge', () => {
    const bar = document.createElement('button');
    bar.getBoundingClientRect = () => ({ left: 120, top: 300, right: 220, bottom: 318, width: 100, height: 18, x: 120, y: 300, toJSON: () => ({}) });
    expect(featureMenuPoint(bar)).toEqual({ x: 120, y: 318 });
  });
});

describe('returnsFocus', () => {
  it('hands focus back after Escape, Tab or an item, not after an outside press, scroll, resize or blur', () => {
    expect(['escape', 'tab', 'item'].every((reason) => returnsFocus(reason as never))).toBe(true);
    expect(['outside', 'scroll', 'resize', 'blur'].some((reason) => returnsFocus(reason as never))).toBe(false);
  });
});

describe('selectionMenuItems', () => {
  const actions = {
    copy: vi.fn(),
    copyReverseComplement: vi.fn(),
    translate: vi.fn(),
    addFeature: vi.fn(),
    editFeature: vi.fn(),
  };
  const state = (over: Partial<SelectionMenuState> = {}): SelectionMenuState => ({
    target: 'sequence', mac: true, nucleotide: true, translateScope: 'selection', ...over,
  });

  it('lists Copy, Copy reverse complement, Translate and Add feature for a range, with the platform shortcut on Copy', () => {
    const items = selectionMenuItems(state(), actions);
    expect(items.map((item) => item.label)).toEqual(['Copy', 'Copy reverse complement', 'Translate', 'Add feature']);
    expect(items[0].shortcut).toEqual({ text: '⌘C', aria: 'Meta+C' });
    expect(selectionMenuItems(state({ mac: false }), actions)[0].shortcut).toEqual({ text: 'Ctrl+C', aria: 'Control+C' });
    expect(items.every((item) => item.disabledReason === undefined)).toBe(true);
  });

  it('gives a feature Edit feature in place of Add feature', () => {
    const items = selectionMenuItems(state({ target: 'feature' }), actions);
    expect(items.map((item) => item.label)).toEqual(['Copy', 'Copy reverse complement', 'Translate', 'Edit feature']);
    items[3].onSelect();
    expect(actions.editFeature).toHaveBeenCalledTimes(1);
  });

  it('carries the reason an item cannot run, and leaves strand actions off a protein record', () => {
    const items = selectionMenuItems(state({ copyBlocked: 'Select a range or feature to copy', addFeatureBlocked: 'Drag a range to add a feature' }), actions);
    expect(items[0].disabledReason).toBe('Select a range or feature to copy');
    expect(items[3].disabledReason).toBe('Drag a range to add a feature');
    expect(selectionMenuItems(state({ nucleotide: false }), actions).map((item) => item.label)).toEqual(['Copy', 'Add feature']);
  });

  it('says when Translate opens on the whole sequence', () => {
    const translate = selectionMenuItems(state({ translateScope: 'record' }), actions)[2];
    expect(translate.title).toBe('Open the Translation window on the whole sequence');
  });
});
