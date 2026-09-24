// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resizeObservers } from './motif-workbench-jsdom-setup';
import '../motif-artifact';

// The whole workbench, mounted the way the artifact mounts itself: the module
// renders into #root when it is evaluated (the setup import above creates the
// root and the browser APIs jsdom lacks). jsdom has no layout, so keyboard
// paths run as they are, and the few pointer tests stub exactly the geometry
// they read (a ruler width, one row's rect, the scroller's rect). Records are
// read back through the page API, and every test loads its own record id,
// because "the first edit to a record" is tracked per id for the session.

type RuntimeRecord = { seq: string; annotations?: { name: string }[] };
type RuntimeWindow = Window & {
  motifGetInventory: () => RuntimeRecord[];
  motifRenderInventory: (records: unknown[]) => void;
};

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

afterEach(() => {
  vi.restoreAllMocks();
  document.elementFromPoint = () => null;
});

const runtime = () => window as unknown as RuntimeWindow;
const activeRecord = () => {
  const [record] = runtime().motifGetInventory();
  if (!record) throw new Error('no record loaded');
  return record;
};
const sequenceOf = (): string => activeRecord().seq ?? '';
const featureNames = () => activeRecord().annotations?.map((feature) => feature.name) ?? [];
const sequenceField = () => document.querySelector<HTMLElement>('.motif-cs-sequence')!;
const notice = () => document.querySelector<HTMLElement>('.motif-cs-workbench-notice');
const caretHint = () => document.querySelector('.motif-cs-edit-hint')?.textContent ?? null;
const selectionLabel = () => document.querySelector('.motif-cs-selection-name')?.textContent ?? null;
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => act(() => {
  fireEvent.keyDown(target, { key, ...init });
});

// 240 bases, four 60-base lines (jsdom never measures a width, so lines stay 60).
const BASE_SEQUENCE = 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCA'.repeat(4);

async function loadRecord(id: string, seq = BASE_SEQUENCE) {
  await act(async () => {
    runtime().motifRenderInventory([{ id, name: id, molecule: 'dna', topology: 'linear', seq }]);
  });
  await waitFor(() => expect(sequenceOf()).toBe(seq));
  const field = sequenceField();
  act(() => field.focus());
  return field;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height, x: left, y: top, right: left + width, bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

// 7px per base; the first bases row starts at x=100. The sequence field is its
// own 200px-tall scroller over 2,000px of content.
function stubSequenceGeometry() {
  const field = sequenceField();
  const ruler = field.querySelector<HTMLElement>('.motif-cs-seq-ruler')!;
  vi.spyOn(ruler, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 700, 16));
  Object.defineProperty(field, 'clientWidth', { configurable: true, value: 48 + 10 + 10 + 60 * 7 });
  Object.defineProperty(field, 'clientHeight', { configurable: true, value: 200 });
  Object.defineProperty(field, 'scrollHeight', { configurable: true, value: 2000 });
  let scrollTop = 0;
  Object.defineProperty(field, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => { scrollTop = Math.max(0, Math.min(1800, value)); },
  });
  vi.spyOn(field, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 600, 200));
  const row = field.querySelector<HTMLElement>('.motif-cs-seq-bases[data-line-start="0"]')!;
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(100, 50, 420, 20));
  document.elementFromPoint = () => row;
  // Re-run only the observer that measures this field, so the component reads
  // the stubbed ruler (7px per base) the way it would after a real resize.
  act(() => {
    for (const observer of resizeObservers) {
      if (observer.targets.includes(field)) observer.callback([], {} as ResizeObserver);
    }
  });
  return { field, xOfBase: (index: number) => 100 + index * 7 + 3, rowY: 60, scrollTop: () => scrollTop };
}

function pointer(field: HTMLElement, type: 'pointerDown' | 'pointerMove' | 'pointerUp', x: number, y: number, init: PointerEventInit = {}) {
  act(() => {
    fireEvent[type](field, { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, ...init });
  });
}

describe('silent edits are announced (the first edit to a record, and any multi-base replacement)', () => {
  it('announces the first edit with an Undo that reverts it and every later edit', async () => {
    const field = await loadRecord('announce-first');
    await press(field, 'ArrowRight'); // places the caret at 0 (no click needed)
    expect(caretHint()).toContain('Caret 1');

    // Fake only the timers, so the ~1.6 s tint cannot expire while a busy
    // machine renders, and its removal can be checked exactly.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await press(field, 'h');
      expect(sequenceOf().slice(0, 10)).toBe('HCGCGCGTTT');
      expect(notice()?.textContent).toContain('Changed base 1 from T to H.');
      // The edited base is tinted, then the tint goes.
      const flash = field.querySelector<HTMLElement>('.motif-cs-seq-edit-flash');
      expect(flash?.style.left).toBe('0ch');
      expect(flash?.style.width).toBe('1ch');
      act(() => { vi.advanceTimersByTime(1_700); });
      expect(field.querySelector('.motif-cs-seq-edit-flash')).toBeNull();
      expect(notice()).not.toBeNull(); // the Undo notice outlives the tint
    } finally {
      vi.useRealTimers();
    }
    const undo = notice()?.querySelector('button');
    expect(undo?.getAttribute('aria-label')).toBe('Undo this edit');

    for (const key of ['a', 'n', 'd', 's']) await press(field, key);
    expect(sequenceOf().slice(0, 10)).toBe('HANDSCGTTT');
    // Later single-base edits keep the first notice and its Undo, and its text
    // grows to cover every edit that Undo reverts.
    expect(notice()?.textContent).toContain('Replaced 5 bp (1–5) with HANDS.');
    expect(notice()?.textContent).not.toContain('Changed base 1');
    const undoAfterTyping = notice()?.querySelector('button');
    expect(undoAfterTyping?.getAttribute('aria-label')).toBe('Undo this edit');

    act(() => undoAfterTyping!.click());
    expect(sequenceOf()).toBe(BASE_SEQUENCE);
    expect(notice()).toBeNull();
  });

  it('announces a range replaced by one typed base even after the first-edit notice', async () => {
    const field = await loadRecord('announce-range');
    await press(field, 'ArrowRight');
    await press(field, 'a'); // first edit, announced; caret now at 1
    expect(notice()?.textContent).toContain('Changed base 1 from T to A.');
    await press(field, 'ArrowDown', { shiftKey: true });
    expect(selectionLabel()).toBe('2-61 (60)');

    await press(field, 'g');
    expect(sequenceOf().length).toBe(BASE_SEQUENCE.length - 59);
    expect(notice()?.textContent).toContain('Replaced 60 bp (2–61) with G.');
    // This notice's Undo reverts the replacement and leaves the earlier edit.
    act(() => notice()!.querySelector('button')!.click());
    expect(sequenceOf()).toBe(`A${BASE_SEQUENCE.slice(1)}`);
  });

  it('refuses to delete every base with a notice instead of an uncaught error', async () => {
    const field = await loadRecord('refuse-empty');
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault(); };
    window.addEventListener('error', onError);
    try {
      await press(field, 'ArrowRight');
      await press(field, 'End', { shiftKey: true });
      expect(selectionLabel()).toBe(`1-${BASE_SEQUENCE.length} (${BASE_SEQUENCE.length})`);
      await press(field, 'Backspace');
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toEqual([]);
    expect(sequenceOf()).toBe(BASE_SEQUENCE);
    expect(notice()?.dataset.tone).toBe('error');
    expect(notice()?.textContent).toContain('A record needs at least one base');
  });
});

describe('caret and selection from the keyboard and pointer', () => {
  it('gives a keyboard user a caret from Arrow, Home or End when none exists', async () => {
    const field = await loadRecord('keyboard-caret');
    expect(caretHint()).toBeNull();
    await press(field, 'End');
    expect(caretHint()).toContain(`Caret ${BASE_SEQUENCE.length + 1}`);
    await press(field, 'Home');
    expect(caretHint()).toContain('Caret 1');
  });

  it('moves the caret one line with ArrowDown/ArrowUp and extends a line with Shift', async () => {
    const field = await loadRecord('keyboard-lines');
    await press(field, 'ArrowRight');
    await press(field, 'ArrowDown');
    expect(caretHint()).toContain('Caret 61');
    await press(field, 'ArrowUp');
    expect(caretHint()).toContain('Caret 1');
    await press(field, 'ArrowDown', { shiftKey: true });
    expect(selectionLabel()).toBe('1-60 (60)');
    await press(field, 'ArrowDown', { shiftKey: true });
    expect(selectionLabel()).toBe('1-120 (120)');
  });

  it('extends from the caret on Shift+click instead of moving the caret', async () => {
    const field = await loadRecord('shift-click');
    const geometry = stubSequenceGeometry();
    pointer(field, 'pointerDown', geometry.xOfBase(9), geometry.rowY);
    pointer(field, 'pointerUp', geometry.xOfBase(9), geometry.rowY);
    expect(caretHint()).toContain('Caret 10');

    pointer(field, 'pointerDown', geometry.xOfBase(39), geometry.rowY, { shiftKey: true });
    pointer(field, 'pointerUp', geometry.xOfBase(39), geometry.rowY, { shiftKey: true });
    expect(selectionLabel()).toBe('10-40 (31)');

    // Shift+Arrow keeps extending the same selection from the same anchor.
    await press(field, 'ArrowRight', { shiftKey: true });
    expect(selectionLabel()).toBe('10-41 (32)');
  });

  it('auto-scrolls while a drag is held past the bottom edge', async () => {
    const field = await loadRecord('drag-autoscroll');
    const geometry = stubSequenceGeometry();
    // Frames run when the test says so, not on jsdom's 16 ms clock. Every frame
    // re-renders the workbench, and on a loaded machine too few of them fit in
    // waitFor's one second: the scroll stood at 33 of the 40 it waited for.
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(nextFrame, callback);
      return nextFrame++;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
    const runFrame = () => act(() => {
      const due = [...frames.values()];
      frames.clear();
      for (const callback of due) callback(performance.now());
    });

    pointer(field, 'pointerDown', geometry.xOfBase(9), geometry.rowY);
    pointer(field, 'pointerMove', geometry.xOfBase(20), 260); // 60px below the 200px scroller
    for (let frame = 0; frame < 20 && geometry.scrollTop() <= 40; frame += 1) runFrame();
    expect(geometry.scrollTop()).toBeGreaterThan(40);
    const held = geometry.scrollTop();
    runFrame();
    expect(geometry.scrollTop()).toBeGreaterThan(held); // still scrolling while held
    pointer(field, 'pointerUp', geometry.xOfBase(20), 260);
    const settled = geometry.scrollTop();
    for (let frame = 0; frame < 10; frame += 1) runFrame();
    expect(geometry.scrollTop()).toBe(settled); // stops with the drag
  });
});

describe('undo reaches past the sequence field and covers features', () => {
  it('undoes a base edit with Cmd/Ctrl+Z after focus has left the sequence', async () => {
    const field = await loadRecord('document-undo');
    await press(field, 'ArrowRight');
    await press(field, 'a');
    expect(sequenceOf()[0]).toBe('A');
    act(() => field.blur());
    expect(document.activeElement).toBe(document.body);

    await press(document.body, 'z', { ctrlKey: true });
    expect(sequenceOf()).toBe(BASE_SEQUENCE);
    await press(document.body, 'z', { ctrlKey: true, shiftKey: true });
    expect(sequenceOf()[0]).toBe('A');
  });

  it('adds a feature with Enter in the Name field and undoes the addition', async () => {
    const field = await loadRecord('feature-history');
    await press(field, 'ArrowRight');
    await press(field, 'ArrowDown', { shiftKey: true });
    expect(selectionLabel()).toBe('1-60 (60)');
    const addFeature = Array.from(document.querySelectorAll<HTMLButtonElement>('.motif-cs-selection-actions button'))
      .find((button) => button.textContent?.includes('Feature'));
    expect(addFeature).toBeDefined();
    act(() => addFeature!.click());
    const name = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>('details[data-rail-tool="annotations"] input[name="feature-name"]');
      expect(input).not.toBeNull();
      return input!;
    });
    act(() => {
      fireEvent.change(name, { target: { value: 'enter-added' } });
    });
    await press(name, 'Enter');
    expect(featureNames()).toContain('enter-added');

    act(() => field.focus());
    await press(field, 'z', { metaKey: true });
    expect(featureNames()).not.toContain('enter-added');
    await press(field, 'z', { metaKey: true, shiftKey: true });
    expect(featureNames()).toContain('enter-added');
  });
});
