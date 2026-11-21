// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  caretLineIndex,
  circularRangeToBase,
  collapsedMoveTarget,
  extendSelectionAcrossOrigin,
  extendSelectionTarget,
  featureClickAnchor,
  featureExtendStart,
  featureStretch,
  isMacPlatform,
  isScrollKey,
  isStrayNativeSelection,
  keepsNativeSelectAll,
  rangeFromExtent,
  replaceModeLineEnd,
  sequenceMoveForKey,
  sequenceMoveTarget,
  type SequenceKeyEvent,
} from '../claude-science-sequence-keys';

const key = (name: string, modifiers: Partial<SequenceKeyEvent> = {}): SequenceKeyEvent => ({
  key: name, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers,
});

// 240 bases in four lines of 60.
const layout = { length: 240, basesPerLine: 60, pageLines: 2 };
const at = (position: number, atLineEnd = false) => ({ position, atLineEnd });

describe('which move a key asks for', () => {
  it('maps the plain keys the same everywhere', () => {
    for (const mac of [true, false]) {
      expect(sequenceMoveForKey(key('ArrowLeft'), mac)).toBe('char-prev');
      expect(sequenceMoveForKey(key('ArrowRight'), mac)).toBe('char-next');
      expect(sequenceMoveForKey(key('ArrowUp'), mac)).toBe('line-up');
      expect(sequenceMoveForKey(key('ArrowDown'), mac)).toBe('line-down');
      expect(sequenceMoveForKey(key('PageUp'), mac)).toBe('page-up');
      expect(sequenceMoveForKey(key('PageDown'), mac)).toBe('page-down');
      expect(sequenceMoveForKey(key('Home'), mac)).toBe('line-start');
      expect(sequenceMoveForKey(key('End'), mac)).toBe('line-end');
      // Shift says "extend"; it does not change the move.
      expect(sequenceMoveForKey(key('End', { shiftKey: true }), mac)).toBe('line-end');
      expect(sequenceMoveForKey(key('a'), mac)).toBeNull();
      expect(sequenceMoveForKey(key(' '), mac)).toBeNull();
    }
  });

  it('on macOS: Cmd+Left and Cmd+Right are the line, Cmd+Up, Cmd+Down, Cmd+Home and Cmd+End the record, Option+Left and Option+Right the 10-base groups', () => {
    expect(sequenceMoveForKey(key('ArrowLeft', { metaKey: true }), true)).toBe('line-start');
    expect(sequenceMoveForKey(key('ArrowRight', { metaKey: true }), true)).toBe('line-end');
    expect(sequenceMoveForKey(key('ArrowUp', { metaKey: true }), true)).toBe('record-start');
    expect(sequenceMoveForKey(key('ArrowDown', { metaKey: true }), true)).toBe('record-end');
    expect(sequenceMoveForKey(key('Home', { metaKey: true }), true)).toBe('record-start');
    expect(sequenceMoveForKey(key('End', { metaKey: true }), true)).toBe('record-end');
    expect(sequenceMoveForKey(key('ArrowLeft', { altKey: true }), true)).toBe('group-prev');
    expect(sequenceMoveForKey(key('ArrowRight', { altKey: true }), true)).toBe('group-next');
    // Combinations the sequence leaves alone.
    expect(sequenceMoveForKey(key('ArrowLeft', { ctrlKey: true }), true)).toBeNull();
    expect(sequenceMoveForKey(key('ArrowDown', { altKey: true }), true)).toBeNull();
    expect(sequenceMoveForKey(key('PageDown', { metaKey: true }), true)).toBeNull();
    expect(sequenceMoveForKey(key('ArrowLeft', { metaKey: true, altKey: true }), true)).toBeNull();
  });

  it('elsewhere: Ctrl+Home and Ctrl+End are the record, Ctrl+Left and Ctrl+Right the 10-base groups', () => {
    expect(sequenceMoveForKey(key('Home', { ctrlKey: true }), false)).toBe('record-start');
    expect(sequenceMoveForKey(key('End', { ctrlKey: true }), false)).toBe('record-end');
    expect(sequenceMoveForKey(key('ArrowLeft', { ctrlKey: true }), false)).toBe('group-prev');
    expect(sequenceMoveForKey(key('ArrowRight', { ctrlKey: true }), false)).toBe('group-next');
    expect(sequenceMoveForKey(key('ArrowDown', { ctrlKey: true }), false)).toBeNull();
    expect(sequenceMoveForKey(key('ArrowLeft', { metaKey: true }), false)).toBeNull();
    expect(sequenceMoveForKey(key('ArrowLeft', { altKey: true }), false)).toBeNull();
  });

  it('knows which keys the browser scrolls with, and the platform', () => {
    for (const name of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) expect(isScrollKey(name)).toBe(true);
    expect(isScrollKey('a')).toBe(false);
    expect(isMacPlatform({ platform: 'MacIntel' })).toBe(true);
    expect(isMacPlatform({ platform: 'Linux x86_64', userAgentData: { platform: 'macOS' } })).toBe(true);
    expect(isMacPlatform({ platform: 'Win32' })).toBe(false);
    expect(isMacPlatform({ platform: '' })).toBe(false);
  });
});

describe('where a move takes the caret', () => {
  it('Home and End reach the start and end of the caret\'s line', () => {
    expect(sequenceMoveTarget('line-start', at(65), layout)).toEqual(at(60));
    expect(sequenceMoveTarget('line-end', at(65), layout)).toEqual(at(120, true));
    // The last line ends at the record's end, which is not a line boundary.
    expect(sequenceMoveTarget('line-end', at(200), layout)).toEqual(at(240));
    expect(sequenceMoveTarget('line-start', at(240), layout)).toEqual(at(180));
  });

  it('a caret drawn at a line\'s end belongs to that line', () => {
    expect(caretLineIndex(at(120, true), layout)).toBe(1);
    expect(caretLineIndex(at(120), layout)).toBe(2);
    expect(sequenceMoveTarget('line-start', at(120, true), layout)).toEqual(at(60));
    expect(sequenceMoveTarget('line-end', at(120, true), layout)).toEqual(at(120, true));
    expect(sequenceMoveTarget('line-start', at(120), layout)).toEqual(at(120));
  });

  it('record keys reach the ends of the record', () => {
    expect(sequenceMoveTarget('record-start', at(130, true), layout)).toEqual(at(0));
    expect(sequenceMoveTarget('record-end', at(5), layout)).toEqual(at(240));
  });

  it('10-base keys stop at the previous and next multiple of ten', () => {
    expect(sequenceMoveTarget('group-next', at(15), layout)).toEqual(at(20));
    expect(sequenceMoveTarget('group-next', at(20), layout)).toEqual(at(30));
    expect(sequenceMoveTarget('group-prev', at(15), layout)).toEqual(at(10));
    expect(sequenceMoveTarget('group-prev', at(10), layout)).toEqual(at(0));
    expect(sequenceMoveTarget('group-prev', at(0), layout)).toEqual(at(0));
    expect(sequenceMoveTarget('group-next', at(235), layout)).toEqual(at(240));
  });

  it('arrows, lines and pages clamp to the record and keep a line-end caret at the end of its line', () => {
    expect(sequenceMoveTarget('char-prev', at(0), layout)).toEqual(at(0));
    expect(sequenceMoveTarget('char-next', at(240), layout)).toEqual(at(240));
    expect(sequenceMoveTarget('char-next', at(120, true), layout)).toEqual(at(121));
    expect(sequenceMoveTarget('line-down', at(65), layout)).toEqual(at(125));
    expect(sequenceMoveTarget('line-down', at(120, true), layout)).toEqual(at(180, true));
    expect(sequenceMoveTarget('line-up', at(10), layout)).toEqual(at(0));
    expect(sequenceMoveTarget('page-down', at(5), layout)).toEqual(at(125));
    expect(sequenceMoveTarget('page-up', at(100), layout)).toEqual(at(0));
  });

  it('a plain move from a selection starts at its edge: Left and Right collapse to it', () => {
    const selection = { start: 70, end: 120 };
    expect(collapsedMoveTarget('char-prev', selection, layout)).toEqual(at(70));
    expect(collapsedMoveTarget('char-next', selection, layout)).toEqual(at(120));
    expect(collapsedMoveTarget('line-start', selection, layout)).toEqual(at(60));
    // The selection's last base is on line 1, so End stays on line 1.
    expect(collapsedMoveTarget('line-end', selection, layout)).toEqual(at(120, true));
    expect(collapsedMoveTarget('line-up', selection, layout)).toEqual(at(10));
    expect(collapsedMoveTarget('line-down', selection, layout)).toEqual(at(180, true));
    // A selection starting on a line's first base: Home stays on that line.
    expect(collapsedMoveTarget('line-start', { start: 60, end: 70 }, layout)).toEqual(at(60));
  });

  it('Shift moves the focus and keeps the anchor; Shift+End twice stays on the line', () => {
    expect(extendSelectionTarget('line-end', { anchor: 65, focus: 65 }, layout)).toBe(120);
    expect(extendSelectionTarget('line-end', { anchor: 65, focus: 120 }, layout)).toBe(120);
    expect(extendSelectionTarget('line-start', { anchor: 65, focus: 120 }, layout)).toBe(60);
    expect(extendSelectionTarget('line-start', { anchor: 65, focus: 65 }, layout)).toBe(60);
    expect(extendSelectionTarget('record-end', { anchor: 15, focus: 15 }, layout)).toBe(240);
    expect(extendSelectionTarget('group-next', { anchor: 10, focus: 10 }, layout)).toBe(20);
    // A focus before the anchor on a line boundary is the start of its line.
    expect(extendSelectionTarget('line-end', { anchor: 150, focus: 120 }, layout)).toBe(180);
  });

  it('Replace mode ends a line on its last base; the last line and the record end after the last base', () => {
    expect(replaceModeLineEnd('line-end', at(120, true), 240)).toEqual(at(119));
    expect(replaceModeLineEnd('line-end', at(240), 240)).toEqual(at(240));
    expect(replaceModeLineEnd('record-end', at(240), 240)).toEqual(at(240));
    expect(replaceModeLineEnd('line-start', at(60), 240)).toEqual(at(60));
  });
});

describe('Shift+Left and Shift+Right across a circular origin', () => {
  it('continues past base 1 and past the last base, up to one full turn', () => {
    // Caret before base 3; Shift+Left four times reaches past base 1.
    let focus = 2;
    for (let step = 0; step < 4; step += 1) focus = extendSelectionAcrossOrigin('char-prev', { anchor: 2, focus }, layout);
    expect(focus).toBe(-2);
    expect(rangeFromExtent(2, focus, 240)).toEqual({ start: 238, end: 242 });
    // Back again over the origin.
    for (let step = 0; step < 3; step += 1) focus = extendSelectionAcrossOrigin('char-next', { anchor: 2, focus }, layout);
    expect(rangeFromExtent(2, focus, 240)).toEqual({ start: 1, end: 2 });
    expect(extendSelectionAcrossOrigin('char-next', { anchor: 238, focus: 240 }, layout)).toBe(241);
    expect(rangeFromExtent(238, 241, 240)).toEqual({ start: 238, end: 241 });
    expect(extendSelectionAcrossOrigin('char-prev', { anchor: 2, focus: -238 }, layout)).toBe(-238);
  });

  it('other keys act on the base the focus is at and stay on its side of the origin', () => {
    // Focus 3 bases before base 1 (on the last line): Shift+Home reaches that line's start.
    expect(extendSelectionAcrossOrigin('line-start', { anchor: 2, focus: -3 }, layout)).toBe(-60);
    expect(extendSelectionAcrossOrigin('line-end', { anchor: 2, focus: -3 }, layout)).toBe(0);
    // Inside the record they match the linear keys.
    expect(extendSelectionAcrossOrigin('line-end', { anchor: 65, focus: 65 }, layout)).toBe(120);
  });
});

describe('a selected feature as a starting point', () => {
  const primer = { start: 40, end: 60 };

  it('Shift+arrows anchor the end away from the direction of travel', () => {
    expect(featureExtendStart('char-next', primer)).toEqual({ anchor: 40, focus: 60 });
    expect(featureExtendStart('char-prev', primer)).toEqual({ anchor: 60, focus: 40 });
    expect(extendSelectionTarget('char-next', featureExtendStart('char-next', primer), layout)).toBe(61);
    expect(extendSelectionTarget('char-prev', featureExtendStart('char-prev', primer), layout)).toBe(39);
    expect(featureExtendStart('line-end', primer)).toEqual({ anchor: 40, focus: 60 });
    expect(featureExtendStart('record-start', primer)).toEqual({ anchor: 60, focus: 40 });
  });

  it('Shift+click extends from the far end, and plain Left and Right go to the feature\'s ends', () => {
    expect(featureClickAnchor(79, primer)).toBe(40);
    expect(featureClickAnchor(20, primer)).toBe(60);
    expect(featureClickAnchor(55, primer)).toBe(40);
    expect(featureClickAnchor(42, primer)).toBe(60);
    expect(collapsedMoveTarget('char-prev', primer, layout)).toEqual(at(40));
    expect(collapsedMoveTarget('char-next', primer, layout)).toEqual(at(60));
  });

  it('a joined feature is one stretch including the bases between its pieces; pieces meeting at a circular origin are none', () => {
    expect(featureStretch([{ start: 10, end: 50 }, { start: 80, end: 120 }], 240, false)).toEqual({ start: 10, end: 120 });
    expect(featureStretch([{ start: 220, end: 240 }, { start: 0, end: 14 }], 240, true)).toBeNull();
    expect(featureStretch([{ start: 0, end: 14 }, { start: 220, end: 240 }], 240, true)).toBeNull();
    // On a linear record the same pieces are an ordinary joined feature.
    expect(featureStretch([{ start: 0, end: 14 }, { start: 220, end: 240 }], 240, false)).toEqual({ start: 0, end: 240 });
    expect(featureStretch([], 240, false)).toBeNull();
  });
});

describe('where Cmd/Ctrl+A keeps its own meaning', () => {
  const make = (html: string) => {
    document.body.innerHTML = html;
    return (selector: string) => document.querySelector(selector);
  };

  it('text fields, editable text, the alignment window and a modal dialog keep it; the rest of the workbench does not', () => {
    const find = make(`
      <input id="field"><textarea id="preview" aria-label="Export preview"></textarea><select id="choice"></select>
      <div contenteditable="true"><span id="rich">text</span></div>
      <div class="motif-cs-window" aria-label="Alignment"><div class="motif-cs-window-head"><button id="alignment-head">Move</button></div><div class="motif-cs-msa-workspace"><button id="alignment-cell">A</button></div></div>
      <div class="motif-cs-window" aria-label="Translation"><button id="translation">Copy</button></div>
      <div class="motif-cs-modal-backdrop"><button id="modal">Cancel</button></div>
      <button id="toolbar">Show tracks</button><div id="sequence" tabindex="0"></div>
    `);
    for (const id of ['field', 'preview', 'choice', 'rich', 'alignment-head', 'alignment-cell', 'modal']) {
      expect(keepsNativeSelectAll(find(`#${id}`)), id).toBe(true);
    }
    for (const id of ['translation', 'toolbar', 'sequence']) {
      expect(keepsNativeSelectAll(find(`#${id}`)), id).toBe(false);
    }
    expect(keepsNativeSelectAll(document.body)).toBe(false);
    expect(keepsNativeSelectAll(null)).toBe(false);
  });
});

describe('which native text selection Copy treats as stray', () => {
  const build = () => {
    const root = document.createElement('div');
    root.innerHTML = '<p class="meta">pUC19 · 2,686 bp</p>'
      + '<div class="motif-cs-sequence"><div class="motif-cs-seq-glyphs">ACGTACGTAC</div>'
      + '<span class="motif-cs-aa-copy-buffer">MKV</span></div>';
    document.body.append(root);
    return {
      root,
      meta: root.querySelector('.meta')!.firstChild!,
      bases: root.querySelector('.motif-cs-seq-glyphs')!.firstChild!,
      protein: root.querySelector('.motif-cs-aa-copy-buffer')!.firstChild!,
    };
  };
  const select = (anchor: Node, focus: Node, collapsed = false) => {
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.setBaseAndExtent(anchor, 0, focus, collapsed ? 0 : 3);
    return selection;
  };

  it('a selection in the bases, which the user cannot see, is stray', () => {
    const { root, bases, meta } = build();
    expect(isStrayNativeSelection(select(bases, bases))).toBe(true);
    expect(isStrayNativeSelection(select(meta, bases)), 'one end in the bases is enough').toBe(true);
    root.remove();
  });

  it('visible text, the amino-acid copy buffer, a bare caret and no selection are not', () => {
    const { root, meta, protein, bases } = build();
    expect(isStrayNativeSelection(select(meta, meta))).toBe(false);
    expect(isStrayNativeSelection(select(protein, protein))).toBe(false);
    expect(isStrayNativeSelection(select(bases, bases, true))).toBe(false);
    window.getSelection()!.removeAllRanges();
    expect(isStrayNativeSelection(window.getSelection())).toBe(false);
    expect(isStrayNativeSelection(null)).toBe(false);
    root.remove();
  });
});

describe('Shift+click from a selection across a circular origin', () => {
  // pUC19: 2,686 bases; a map drag selected 2,463–104 (stored 2462..2790), anchored at its start.
  const length = 2686;
  const anchor = 2462;
  it('goes on across the origin to a base past the end, or inside it past the origin', () => {
    expect(circularRangeToBase(anchor, 499, length)).toEqual({ start: 2462, end: 499 + 1 + length });
    expect(circularRangeToBase(anchor, 49, length)).toEqual({ start: 2462, end: 49 + 1 + length });
  });
  it('goes back to a base just before the anchor, and forward to one just after it, without crossing', () => {
    expect(circularRangeToBase(anchor, 2399, length)).toEqual({ start: 2399, end: 2462 });
    expect(circularRangeToBase(anchor, 2600, length)).toEqual({ start: 2462, end: 2601 });
  });
  it('an anchor at base 1 reaches the last base backwards across the origin, in stored form', () => {
    expect(circularRangeToBase(0, length - 1, length)).toEqual({ start: length - 1, end: length });
    expect(circularRangeToBase(2, length - 3, length)).toEqual({ start: length - 3, end: length + 2 });
  });
});
