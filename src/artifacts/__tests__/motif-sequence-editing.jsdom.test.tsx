// @vitest-environment jsdom

import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LARGE_SEQUENCE_SELECTION_SETTLE_MS } from '../LargeSequenceViewer';
import type { ArtifactAnalysisResult } from '../claude-science-analysis-results';
import type { ArtifactDurableState } from '../claude-science-session';
import { resizeObservers } from './motif-workbench-jsdom-setup';
import { normalizeRecord, parseImportedRecords, toGenBankLite } from '../motif-artifact';

// The whole workbench, mounted the way the artifact mounts itself: the module
// renders into #root when it is evaluated (the setup import above creates the
// root and the browser APIs jsdom lacks). jsdom has no layout, so keyboard
// paths use a measured line width from the fixture, and the pointer tests
// also stub the bases row and scroller rectangles. Records are
// read back through the page API, and every test loads its own record id,
// because "the first edit to a record" is tracked per id for the session.

type RuntimeRecord = {
  seq: string;
  annotations?: {
    name: string;
    start: number;
    end: number;
    strand: number;
    subRanges?: { start: number; end: number; strand?: number }[];
    metadata?: { motifProposal?: { status: string }; transl_table?: number };
  }[];
  provenance?: { motifAutoAnnotation: Record<string, unknown> };
};
type RuntimeWindow = {
  motifGetInventory: () => RuntimeRecord[];
  motifGetActiveRecord: () => RuntimeRecord;
  motifGetWorkspace: () => { artifactState: ArtifactDurableState };
  motifReplaceWorkspace: (workspace: unknown, options?: { discardUnsavedChanges: boolean }) => void;
  motifRenderInventory: (records: unknown[]) => void;
  motifAddAnalysisResults: (result: ArtifactAnalysisResult) => number;
  motifRemoveAnalysisResults: (id: string) => number;
};

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

afterEach(() => {
  const field = document.querySelector('.motif-cs-sequence');
  if (field) act(() => { fireEvent.pointerCancel(field, { pointerId: 1 }); });
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

// 240 bases, four 60-base lines at the fixture's measured width.
const BASE_SEQUENCE = 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCA'.repeat(4);

async function loadRecord(id: string, seq = BASE_SEQUENCE, fields: Record<string, unknown> = {}) {
  await act(async () => {
    runtime().motifRenderInventory([{ id, name: id, molecule: 'dna', topology: 'linear', seq, ...fields }]);
  });
  await waitFor(() => expect(sequenceOf()).toBe(seq));
  const field = document.querySelector<HTMLElement>('#motif-cs-sequence-view')!;
  act(() => field.focus());
  return field;
}

describe('analysis coordinates', () => {
  it('keeps the start codon first when adding a full-circle ORF', async () => {
    const sequence = `TAAATG${'AAA'.repeat(9)}`;
    await loadRecord('full-circle-orf', sequence, { topology: 'circular', proposeAnnotations: false });
    if (!document.querySelector('[data-rail-tool="analysis"]')) {
      act(() => fireEvent.click(document.querySelector('[data-pane-toggle="tools"]')!));
    }
    const panel = document.querySelector<HTMLDetailsElement>('[data-rail-tool="analysis"]')!;
    act(() => {
      panel.open = true;
      fireEvent(panel, new Event('toggle'));
    });
    const row = await within(panel).findByText('4-3 wrap · 10 aa · ATG to TAA');
    const entry = row.closest('.motif-cs-analysis-row') as HTMLElement;
    act(() => fireEvent.click(within(entry).getByRole('button', { name: /ORF/ })));
    expect(selectionLabel()).toBe('4–3 · 33 bp · across the origin');
    expect(document.querySelector('.motif-cs-map-selection-line')?.textContent).toBe(selectionLabel());
    act(() => fireEvent.click(within(entry).getByRole('button', { name: 'Add feature' })));
    expect(activeRecord().annotations).toMatchObject([{
      start: 0, end: 33, strand: 1,
      subRanges: [{ start: 3, end: 33, strand: 1 }, { start: 0, end: 3, strand: 1 }],
    }]);
    // On export the CDS must read from the ATG at 4, not from the TAA at 1.
    const saved = activeRecord() as unknown as Parameters<typeof normalizeRecord>[0];
    expect(toGenBankLite(normalizeRecord(saved, 0)!, 'circular'))
      .toMatch(/^ {5}CDS {13}join\(4\.\.33,1\.\.3\)$/m);
  });

  it('keeps the start codon first when adding a full-circle ORF on the reverse strand', async () => {
    // The reverse complement of the forward case: the ATG reads from base 30 leftward.
    const sequence = `${'TTT'.repeat(9)}CATTTA`;
    await loadRecord('full-circle-reverse-orf', sequence, { topology: 'circular', proposeAnnotations: false });
    if (!document.querySelector('[data-rail-tool="analysis"]')) {
      act(() => fireEvent.click(document.querySelector('[data-pane-toggle="tools"]')!));
    }
    const panel = document.querySelector<HTMLDetailsElement>('[data-rail-tool="analysis"]')!;
    act(() => {
      panel.open = true;
      fireEvent(panel, new Event('toggle'));
    });
    const row = await within(panel).findByText(/wrap · 10 aa · ATG to TAA/);
    const entry = row.closest('.motif-cs-analysis-row') as HTMLElement;
    act(() => fireEvent.click(within(entry).getByRole('button', { name: 'Add feature' })));
    expect(activeRecord().annotations).toMatchObject([{
      start: 0, end: 33, strand: -1,
      subRanges: [{ start: 0, end: 30, strand: -1 }, { start: 30, end: 33, strand: -1 }],
    }]);
    const saved = activeRecord() as unknown as Parameters<typeof normalizeRecord>[0];
    expect(toGenBankLite(normalizeRecord(saved, 0)!, 'circular'))
      .toMatch(/^ {5}CDS {13}complement\(join\(31\.\.33,1\.\.30\)\)$/m);
  });

  it('numbers both displays from one and formats the short final sequence line', async () => {
    const firstLine = 'ACGTACGTAC'.repeat(6);
    const sequence = `${firstLine}GCTA`;
    const field = await loadRecord('line-numbering', sequence);
    expect([...field.querySelectorAll('.motif-cs-seq-index')].map((line) => line.textContent)).toEqual(['1', '61']);
    expect(field.querySelector('[data-line-start="60"]')?.getAttribute('data-line-len')).toBe('4');
    const record = normalizeRecord({ id: 'line-numbering', sequence, type: 'dna' }, 0)!;
    const origin = toGenBankLite(record, 'linear').split('ORIGIN\n')[1];
    expect(origin.split('\n')).toEqual([
      `        1 ${Array(6).fill('acgtacgtac').join(' ')}`,
      '       61 gcta',
      '//',
    ]);
  });
});

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
  let allowed = true;
  act(() => {
    allowed = fireEvent[type](field, {
      pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0,
      buttons: type === 'pointerUp' ? 0 : 1, clientX: x, clientY: y, ...init,
    });
  });
  return allowed;
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
    expect(selectionLabel()).toBe('2–61 · 60 bp');

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
      // Shift+End stops at the line's end; Shift+Ctrl+End (Shift+Cmd+End
      // on macOS) reaches the record's end.
      await press(field, 'End', { shiftKey: true, ctrlKey: true });
      expect(selectionLabel()).toBe(`1–${BASE_SEQUENCE.length.toLocaleString()} · ${BASE_SEQUENCE.length.toLocaleString()} bp`);
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
    // End is the end of the first line; in Replace mode the caret marks that
    // line's last base (base 60).
    await press(field, 'End');
    expect(caretHint()).toContain('Caret 60');
    // Ctrl+End (Cmd+End on macOS) is the end of the record, after its last base.
    await press(field, 'End', { ctrlKey: true });
    expect(caretHint()).toContain(`Caret ${BASE_SEQUENCE.length + 1}`);
    // Home is the start of the line the caret is on, the last of four.
    await press(field, 'Home');
    expect(caretHint()).toContain('Caret 181');
    await press(field, 'Home', { ctrlKey: true });
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
    expect(selectionLabel()).toBe('1–60 · 60 bp');
    await press(field, 'ArrowDown', { shiftKey: true });
    expect(selectionLabel()).toBe('1–120 · 120 bp');
  });

  it('extends from the caret on Shift+click instead of moving the caret', async () => {
    const field = await loadRecord('shift-click');
    const geometry = stubSequenceGeometry();
    pointer(field, 'pointerDown', geometry.xOfBase(9), geometry.rowY);
    pointer(field, 'pointerUp', geometry.xOfBase(9), geometry.rowY);
    expect(caretHint()).toContain('Caret 10');

    pointer(field, 'pointerDown', geometry.xOfBase(39), geometry.rowY, { shiftKey: true });
    pointer(field, 'pointerUp', geometry.xOfBase(39), geometry.rowY, { shiftKey: true });
    expect(selectionLabel()).toBe('10–40 · 31 bp');

    // Shift+Arrow keeps extending the same selection from the same anchor.
    await press(field, 'ArrowRight', { shiftKey: true });
    expect(selectionLabel()).toBe('10–41 · 32 bp');
  });

  const dragEndings = ['release', 'blur', 'lostpointercapture', 'pointercancel', 'unpressed move'];
  it.each(dragEndings)('stops edge auto-scroll and settles the sequence drag on %s', async (ending) => {
    const field = await loadRecord(`drag-autoscroll-${ending}`);
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
    const range = selectionLabel();
    expect(range).toBe('10–21 · 12 bp');
    const settled = geometry.scrollTop();
    if (ending === 'release') {
      pointer(field, 'pointerUp', geometry.xOfBase(20), 260);
    } else {
      pointer(field, 'pointerMove', geometry.xOfBase(25), 260);
      if (ending === 'blur') act(() => fireEvent.blur(window));
      else if (ending === 'lostpointercapture') act(() => fireEvent.lostPointerCapture(field, { pointerId: 1 }));
      else if (ending === 'pointercancel') act(() => fireEvent.pointerCancel(field, { pointerId: 1 }));
      else pointer(field, 'pointerMove', geometry.xOfBase(30), 260, { buttons: 0 });
    }
    for (let frame = 0; frame < 10; frame += 1) runFrame();
    expect(geometry.scrollTop()).toBe(settled); // stops with the drag
    expect(selectionLabel()).toBe(range);
    pointer(field, 'pointerMove', geometry.xOfBase(40), 260);
    pointer(field, 'pointerUp', geometry.xOfBase(40), 260);
    runFrame();
    expect(selectionLabel()).toBe(range);
    expect(geometry.scrollTop()).toBe(settled);
  });

  it('prevents native text selection on a custom press and still places the caret', async () => {
    const field = await loadRecord('drag-prevent-native-selection');
    const geometry = stubSequenceGeometry();
    expect(pointer(field, 'pointerDown', geometry.xOfBase(9), geometry.rowY)).toBe(false);
    pointer(field, 'pointerUp', geometry.xOfBase(9), geometry.rowY);
    expect(caretHint()).toContain('Caret 10');
  });

  it('lets a touch swipe scroll without selecting bases and still places the caret on tap', async () => {
    const field = await loadRecord('drag-touch-scroll');
    const geometry = stubSequenceGeometry();
    const touch = { pointerType: 'touch' };
    expect(pointer(field, 'pointerDown', geometry.xOfBase(9), geometry.rowY, touch)).toBe(true);
    pointer(field, 'pointerMove', geometry.xOfBase(20), 260, touch);
    pointer(field, 'pointerUp', geometry.xOfBase(20), 260, touch);
    expect(selectionLabel()).not.toContain(' bp');
    expect(caretHint()).toBeNull();

    pointer(field, 'pointerDown', geometry.xOfBase(9), geometry.rowY, touch);
    pointer(field, 'pointerUp', geometry.xOfBase(9), geometry.rowY, touch);
    expect(caretHint()).toContain('Caret 10');
  });

  it('places the caret on a touch tap whose tremor reports no button', async () => {
    const field = await loadRecord('drag-touch-no-buttons');
    const geometry = stubSequenceGeometry();
    const touch = { pointerType: 'touch' };
    pointer(field, 'pointerDown', geometry.xOfBase(9), geometry.rowY, touch);
    pointer(field, 'pointerMove', geometry.xOfBase(9) + 1, geometry.rowY, { ...touch, buttons: 0 });
    pointer(field, 'pointerUp', geometry.xOfBase(9) + 1, geometry.rowY, touch);
    expect(caretHint()).toContain('Caret 10');
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
    expect(selectionLabel()).toBe('1–60 · 60 bp');
    const addFeature = Array.from(document.querySelectorAll<HTMLButtonElement>('.motif-cs-selection-actions button'))
      .find((button) => button.textContent?.includes('Add feature'));
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

const historyButton = (action: 'Undo' | 'Redo') =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${action}"]`)!;
const copyButton = () => document.querySelector<HTMLButtonElement>('.motif-cs-selection-actions .motif-cs-copy-button');
// The map states a range once, in its status line under the drawing.
const mapRangeLine = () => document.querySelector('.motif-cs-map-selection-line')?.textContent ?? '';
const mapHighlight = () => document.querySelector('.motif-pm-selection-layer');
const paste = (field: HTMLElement, text: string) =>
  act(() => fireEvent.paste(field, { clipboardData: { getData: () => text } }));

const codingSequence = 'ATGGAATTCTAA';
const codingFeatures = [
  { id: 'forward', name: 'Forward CDS', type: 'cds', start: 0, end: 3, strand: 1, metadata: { partial: true } },
  { id: 'reverse', name: 'Reverse CDS', type: 'cds', start: 9, end: 12, strand: -1, metadata: { partial: true } },
  {
    id: 'join', name: 'Reverse join', type: 'cds', start: 1, end: 11, strand: -1,
    subRanges: [{ start: 9, end: 11, strand: -1 }, { start: 1, end: 3, strand: -1 }],
    metadata: { motifSubRangeOrder: 'biological', transl_table: 4, note: 'joined peptide' },
  },
  {
    id: 'wrap', name: 'Origin join', type: 'misc_feature', start: 0, end: 12, strand: 1,
    subRanges: [{ start: 9, end: 12, strand: 1 }, { start: 0, end: 3, strand: 1 }],
  },
  { id: 'primer', name: 'Primer', type: 'primer_bind', start: 3, end: 9, strand: 1, metadata: { primerSequence: 'GAATTC' } },
];

async function placeCaret(field: HTMLElement, index: number) {
  await press(field, 'Home');
  for (let position = 0; position < index; position += 1) await press(field, 'ArrowRight');
}

describe('sequence edits through the workbench', () => {
  it.each([
    { action: 'insert', at: 0, seq: 'CATGGAATTCTAA', f: [1, 4], r: [10, 13], j: [2, 4, 10, 12], p: [4, 10], aa: ['M', 'L', 'EF', 'L'], cuts: [5, 9] },
    { action: 'delete', at: 0, seq: 'TGGAATTCTAA', f: [0, 2], r: [8, 11], j: [0, 2, 8, 10], p: [2, 8], aa: ['', 'L', 'EF', 'L'], cuts: [3, 7] },
    { action: 'replace', at: 0, seq: 'CTGGAATTCTAA', f: [0, 3], r: [9, 12], j: [1, 3, 9, 11], p: [3, 9], aa: ['L', 'L', 'EF', 'L'], cuts: [4, 8] },
    { action: 'insert', at: 5, seq: 'ATGGACATTCTAA', f: [0, 3], r: [10, 13], j: [1, 3, 10, 12], p: [3, 10], aa: ['M', 'L', 'DI', 'L'], cuts: [] },
    { action: 'delete', at: 5, seq: 'ATGGATTCTAA', f: [0, 3], r: [8, 11], j: [1, 3, 8, 10], p: [3, 8], aa: ['M', 'L', 'D', 'L'], cuts: [] },
    { action: 'replace', at: 5, seq: 'ATGGACTTCTAA', f: [0, 3], r: [9, 12], j: [1, 3, 9, 11], p: [3, 9], aa: ['M', 'L', 'DF', 'L'], cuts: [] },
    { action: 'insert', at: 12, seq: 'ATGGAATTCTAAC', f: [0, 3], r: [9, 12], j: [1, 3, 9, 11], p: [3, 9], aa: ['M', 'L', 'EF', 'L'], cuts: [4, 8] },
    { action: 'delete', at: 11, seq: 'ATGGAATTCTA', f: [0, 3], r: [9, 11], j: [1, 3, 9, 11], p: [3, 9], aa: ['M', '', 'EF', ''], cuts: [4, 8] },
    { action: 'replace', at: 11, seq: 'ATGGAATTCTAC', f: [0, 3], r: [9, 12], j: [1, 3, 9, 11], p: [3, 9], aa: ['M', 'V', 'EF', 'V'], cuts: [4, 8] },
  ])('$action at index $at, including translations, primers, cuts and history', async ({ action, at, seq, f, r, j, p, aa, cuts }) => {
    const id = `coordinates-${action}-${at}`;
    const field = await loadRecord(id, codingSequence, { topology: 'circular', annotations: codingFeatures });
    const workspace = runtime().motifGetWorkspace();
    const pins = [
      { id: 'pin-forward', label: 'Forward pin', start: 3, end: 9, strand: 1, frame: 0, source: 'layer', translationTableId: 1 },
      { id: 'pin-reverse', label: 'Reverse pin', start: 9, end: 12, strand: -1, frame: 0, source: 'layer', translationTableId: 4 },
    ];
    act(() => runtime().motifReplaceWorkspace({
      ...workspace, artifactState: { ...workspace.artifactState, translationLayersByRecord: { [id]: pins } },
    }, { discardUnsavedChanges: true }));
    const tracks = document.querySelector<HTMLButtonElement>('button[aria-label="Show tracks"]')!;
    const tracksWereHidden = tracks.getAttribute('aria-pressed') === 'false';
    if (tracksWereHidden) act(() => tracks.click());
    const restrictionCuts = () => {
      const site = field.querySelector('.motif-cs-restriction-label[aria-label^="EcoRI,"]');
      const cutsLabel = site?.getAttribute('aria-label')?.match(/cuts (\d+) and (\d+)/);
      return cutsLabel?.slice(1).map((cut) => Number(cut) - 1) ?? [];
    };
    const aminoAcids = () => ['feat:forward', 'feat:reverse', 'pin-forward', 'pin-reverse', 'feat:join']
      .map((track) => Array.from(document.querySelectorAll(`.motif-cs-seq-aa[data-aa-track-id="${track}"]`),
        (residue) => residue.textContent).join(''));
    const layers = () => runtime().motifGetWorkspace().artifactState.translationLayersByRecord[id];
    const state = () => ({ record: activeRecord(), layers: layers(), cuts: restrictionCuts(), amino: aminoAcids(), caret: caretHint() });
    try {
      await placeCaret(field, at);
      const before = state();
      // The reverse join reads TA (bases 10-11) then TG (2-3) on the top strand:
      // reverse complement TACA, one whole codon TAC = Y. Every edit below keeps both parts.
      expect(before.amino).toEqual(['M', 'L', 'EF', 'L', 'Y']);
      expect(before.cuts).toEqual([4, 8]);
      if (action === 'insert') paste(field, 'c');
      else await press(field, action === 'delete' ? 'Delete' : 'c');
      expect(sequenceOf()).toBe(seq);
      expect(caretHint()).toBe(`Caret ${at + (action === 'delete' ? 1 : 2)}`);
      const coordinates = (startEnd: number[], strand: number) => ({ start: startEnd[0], end: startEnd[1], strand });
      expect(activeRecord().annotations).toMatchObject([
        coordinates(f, 1),
        coordinates(r, -1),
        { ...coordinates([j[0], j[3]], -1), subRanges: [coordinates(j.slice(2), -1), coordinates(j, -1)] },
        { ...coordinates([f[0], r[1]], 1), subRanges: [coordinates(r, 1), coordinates(f, 1)] },
        { ...coordinates(p, 1), metadata: { primerSequence: 'GAATTC' } },
      ]);
      expect(layers()).toEqual([
        { ...before.layers[0], ...coordinates(p, 1), ...(at === 5 ? { needsReview: true } : {}) },
        ...(aa[3] ? [{ ...before.layers[1], ...coordinates(r, -1), ...(at === 11 ? { needsReview: true } : {}) }] : []),
      ]);
      expect(aminoAcids()).toEqual([...aa, 'Y']);
      expect(restrictionCuts()).toEqual(cuts);
      const after = state();
      act(() => historyButton('Undo').click());
      expect(state()).toEqual(before);
      act(() => historyButton('Redo').click());
      expect(state()).toEqual(after);
    } finally {
      if (tracksWereHidden) act(() => tracks.click());
      act(() => runtime().motifReplaceWorkspace(workspace, { discardUnsavedChanges: true }));
    }
  });
});

describe('pasting into DNA', () => {
  it('keeps mixed-case IUPAC, ignores whitespace and digits, and reads U as T', async () => {
    const field = await loadRecord('paste-dna-alphabet', 'AACCGGTT', { proposeAnnotations: false });
    await press(field, 'Home');
    paste(field, ' 12 aCgT \n rYsWkMbDhVn 3 u');
    expect(sequenceOf()).toBe('ACGTRYSWKMBDHVNTAACCGGTT');
    // The note takes the caret's slot until the caret moves.
    expect(caretHint()).toBe('U read as T.');
    await press(field, 'ArrowRight');
    expect(caretHint()).toContain('Caret 18');
    act(() => historyButton('Undo').click());
    expect(sequenceOf()).toBe('AACCGGTT');
    act(() => historyButton('Redo').click());
    expect(sequenceOf()).toBe('ACGTRYSWKMBDHVNTAACCGGTT');
  });

  it('refuses letters that are not DNA and names them in the caret slot, with the range kept', async () => {
    // A protein pasted into DNA is refused whole, and the refusal names the letters that are not DNA.
    const field = await loadRecord('paste-refused-protein', 'AACCGGTT', { proposeAnnotations: false });
    await press(field, 'Home');
    await press(field, 'ArrowRight', { shiftKey: true });
    const before = activeRecord();
    const readout = document.querySelector('.motif-cs-selection-label')?.getAttribute('title');
    paste(field, 'uEIPLQF');
    expect(activeRecord()).toEqual(before);
    expect(caretHint()).toBe('Not pasted: E, I, P and 3 more are not DNA bases.');
    expect(document.querySelector('.motif-cs-selection-label [role="status"]')?.textContent).toBe('Not pasted: E, I, P and 3 more are not DNA bases.');
    expect(document.querySelector('.motif-cs-selection-label')?.getAttribute('title')).toBe(readout);
    expect(historyButton('Undo').disabled).toBe(true);
    expect(historyButton('Redo').disabled).toBe(true);
  });

  it('leaves out a letter that upper-cases to bases and names it in the singular', async () => {
    const field = await loadRecord('paste-dna-sharp-s', 'AACCGGTT', { proposeAnnotations: false });
    await press(field, 'Home');
    paste(field, 'ACGTß');
    expect(sequenceOf()).toBe('ACGTAACCGGTT');
    expect(notice()?.textContent).toContain('Pasted 4 bases. 1 character was not DNA and was left out.');
  });

  it.each(['>first\nACG\n>second\nTCA', 'ßſ'])('refuses %s without changing the selection or history', async (text) => {
    const field = await loadRecord(`paste-refused-${encodeURIComponent(text)}`, 'AACCGGTT', { proposeAnnotations: false });
    await press(field, 'Home');
    await press(field, 'ArrowRight', { shiftKey: true });
    const before = activeRecord();
    const range = selectionLabel();
    paste(field, text);
    expect(activeRecord()).toEqual(before);
    expect(selectionLabel()).toBe(range);
    expect(historyButton('Undo').disabled).toBe(true);
    expect(historyButton('Redo').disabled).toBe(true);
    expect(notice()?.dataset.tone).toBe('error');
  });
});

function openExport() {
  const panel = document.querySelector<HTMLDetailsElement>('#motif-cs-export-panel')!;
  act(() => {
    panel.open = true;
    fireEvent(panel, new Event('toggle'));
  });
  return within(panel);
}

function createReverseComplement() {
  // Create > New reverse complement record; the Export popover does not repeat it.
  const menu = within(document.querySelector<HTMLElement>('.motif-cs-selection-bar')!);
  act(() => menu.getByRole('button', { name: 'Create' }).click());
  act(() => menu.getByRole('menuitem', { name: 'New reverse complement record' }).click());
}

describe('edited record export and reverse complement', () => {
  it('re-imports the edited FASTA sequence and GenBank topology, joins and qualifiers', async () => {
    const field = await loadRecord('interchange', codingSequence, {
      topology: 'circular', annotations: codingFeatures, translationTableId: 11,
    });
    await placeCaret(field, 0);
    paste(field, 'C');
    const panel = openExport();
    const format = panel.getByRole('combobox', { name: 'Format' });
    const preview = panel.getByRole<HTMLTextAreaElement>('textbox', { name: 'Export preview' });
    const choose = (value: string) => {
      act(() => fireEvent.change(format, { target: { value } }));
      return preview.value;
    };
    try {
      const [fasta] = parseImportedRecords(choose('record-fasta'), '', 'auto', 'linear');
      expect(normalizeRecord(fasta, 0)).toMatchObject({ sequence: 'CATGGAATTCTAA', topology: 'linear', features: [] });

      const text = choose('record-genbank');
      expect(text).toContain('complement(join(3..4,11..12))');
      expect(text).toContain('join(11..13,2..4)');
      const [genbank] = parseImportedRecords(text, '', 'auto', 'linear');
      const record = normalizeRecord(genbank, 0)!;
      expect(record).toMatchObject({ sequence: 'CATGGAATTCTAA', topology: 'circular' });
      expect(record.features).toMatchObject([
        { name: 'Forward CDS', start: 1, end: 4, strand: 1, metadata: { transl_table: '11' } },
        { name: 'Reverse CDS', start: 10, end: 13, strand: -1, metadata: { transl_table: '11' } },
        { name: 'Reverse join', start: 2, end: 12, strand: -1,
          subRanges: [{ start: 10, end: 12, strand: -1 }, { start: 2, end: 4, strand: -1 }],
          metadata: { note: 'joined peptide', transl_table: '4' } },
        { name: 'Origin join', start: 1, end: 13, strand: 1,
          subRanges: [{ start: 10, end: 13, strand: 1 }, { start: 1, end: 4, strand: 1 }] },
        { name: 'Primer', type: 'primer_bind', start: 4, end: 10, strand: 1 },
      ]);
    } finally {
      act(() => panel.getByRole('button', { name: 'Close export' }).click());
    }
  });

  it('mirrors the edited record’s feature spans in biological order', async () => {
    const field = await loadRecord('rc-edited-record', codingSequence, { topology: 'circular', annotations: codingFeatures });
    await placeCaret(field, 0);
    paste(field, 'C');
    createReverseComplement();
    expect(runtime().motifGetActiveRecord()).toMatchObject({
      seq: 'TTAGAATTCCATG', topology: 'circular',
      annotations: [
        { start: 9, end: 12, strand: -1 },
        { start: 0, end: 3, strand: 1 },
        { start: 1, end: 11, strand: 1, subRanges: [{ start: 1, end: 3, strand: 1 }, { start: 9, end: 11, strand: 1 }] },
        { start: 0, end: 12, strand: -1, subRanges: [{ start: 0, end: 3, strand: -1 }, { start: 9, end: 12, strand: -1 }] },
        { start: 3, end: 9, strand: -1 },
      ],
    });
  });

  it.each([
    { feature: 'Reverse join', seq: 'TGTA' },
    { feature: 'Origin join', seq: 'CATTTA' },
  ])('reverse-complements the selected $feature product into one linear span', async ({ feature, seq }) => {
    const field = await loadRecord(`rc-selected-${feature}`, codingSequence, { topology: 'circular', annotations: codingFeatures });
    const button = [...field.querySelectorAll<HTMLButtonElement>('.motif-cs-feature-block')]
      .find((block) => block.textContent === feature)!;
    act(() => button.click());
    createReverseComplement();
    expect(runtime().motifGetActiveRecord()).toMatchObject({
      seq, topology: 'linear', annotations: [{ start: 0, end: seq.length, strand: -1 }],
    });
    expect(runtime().motifGetActiveRecord().annotations?.[0].subRanges).toBeUndefined();
  });

  it('refuses all edits to an origin-wrapping range but can reverse-complement it', async () => {
    const field = await loadRecord('rc-origin-range', 'AACCGGTT', { topology: 'circular', proposeAnnotations: false });
    const workspace = runtime().motifGetWorkspace();
    try {
      act(() => document.querySelector<HTMLButtonElement>('.motif-cs-find-button')!.click());
      const search = within(document.body).getByRole('searchbox', { name: 'Find in sequence' });
      act(() => fireEvent.change(search, { target: { value: 'GGTTAA' } }));
      await waitFor(() => expect(selectionLabel()).toBe('5–2 · 6 bp · across the origin'));
      await press(search, 'Escape');
      const before = activeRecord();
      for (const key of ['Delete', 'Backspace', 'c']) {
        await press(field, key);
        expect(notice()?.textContent).toContain('wraps the circular origin');
      }
      paste(field, 'A');
      expect(notice()?.textContent).toContain('wraps the circular origin');
      expect(activeRecord()).toEqual(before);
      expect(selectionLabel()).toBe('5–2 · 6 bp · across the origin');
      expect(historyButton('Undo').disabled).toBe(true);
      createReverseComplement();
      expect(runtime().motifGetActiveRecord()).toMatchObject({ seq: 'TTAACC', topology: 'linear', annotations: [] });
    } finally {
      act(() => runtime().motifReplaceWorkspace(workspace, { discardUnsavedChanges: true }));
    }
  });
});

describe('annotation actions share sequence history', () => {
  it.each(['Accept feature', 'Dismiss proposal', 'Genetic code'] as const)('undoes and redoes %s separately from a base edit', async (action) => {
    const proposal = action !== 'Genetic code';
    const initialReview = { status: 'review_required', pendingCount: 1, acceptedCount: 0, dismissedCount: 0 };
    const field = await loadRecord(action, BASE_SEQUENCE, {
      annotations: [{
        id: 'coding-region',
        name: proposal ? 'Proposed coding region' : 'Coding region',
        type: proposal ? 'orf' : 'cds',
        start: 6, end: 30, strand: 1,
        metadata: proposal ? {
          motifProposal: {
            status: 'proposed', proposedBy: 'motif-auto-annotation', detector: 'motif-orf-detection',
            reason: 'Complete ORF',
          },
        } : {},
      }],
      ...(proposal ? { provenance: { motifAutoAnnotation: initialReview } } : {}),
    });
    const before = activeRecord();
    await press(field, 'Home');
    await press(field, 'a');
    const edited = 'A' + BASE_SEQUENCE.slice(1);
    expect(sequenceOf()).toBe(edited);

    const annotations = document.querySelector<HTMLDetailsElement>('details[data-rail-tool="annotations"]')!;
    act(() => {
      annotations.open = true;
      fireEvent(annotations, new Event('toggle'));
    });
    const row = annotations.querySelector<HTMLButtonElement>('.motif-cs-feature-annotation-list button')!;
    act(() => row.click());
    if (proposal) {
      const review = annotations.querySelector('[data-testid="proposed-annotation-review"]');
      const button = [...(review?.querySelectorAll('button') ?? [])].find((button) => button.textContent === action);
      expect(button).toBeDefined();
      act(() => button!.click());
    } else {
      act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Translations window off"]')!.click());
      const table = document.querySelector<HTMLSelectElement>('select[name="translation-table"]')!;
      act(() => fireEvent.change(table, { target: { value: '2' } }));
      act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Translations window on"]')!.click());
    }
    const after = activeRecord();
    if (action === 'Accept feature') {
      expect(after.annotations?.[0].metadata?.motifProposal?.status).toBe('accepted');
      expect(after.provenance?.motifAutoAnnotation).toMatchObject({ status: 'review_complete', pendingCount: 0, acceptedCount: 1, dismissedCount: 0 });
    } else if (action === 'Dismiss proposal') {
      expect(after.annotations).toEqual([]);
      expect(after.provenance?.motifAutoAnnotation).toMatchObject({ status: 'review_complete', pendingCount: 0, acceptedCount: 0, dismissedCount: 1 });
    } else {
      expect(after.annotations?.[0].metadata?.transl_table).toBe(2);
    }

    const earlierEditAction = notice()?.querySelector('button[aria-label="Undo this edit"]');
    act(() => historyButton('Undo').click());
    expect(sequenceOf()).toBe(edited);
    expect(earlierEditAction).toBeNull();
    expect(activeRecord().annotations).toEqual(before.annotations);
    expect(activeRecord().provenance).toEqual(before.provenance);
    act(() => historyButton('Undo').click());
    expect(activeRecord()).toEqual(before);
    act(() => historyButton('Redo').click());
    expect(sequenceOf()).toBe(edited);
    expect(activeRecord().annotations).toEqual(before.annotations);
    expect(activeRecord().provenance).toEqual(before.provenance);
    act(() => historyButton('Redo').click());
    expect(activeRecord()).toEqual(after);
  });
});

describe('restored sequence coordinates', () => {
  it.each([
    { start: 0, end: 3, seq: 'GAATTCTAA', starts: [6, 6, 6, 0], ends: [9, 8, 9, 6] },
    { start: 2, end: 5, seq: 'ATATTCTAA', starts: [0, 6, 1, 0, 2], ends: [2, 9, 8, 9, 6] },
  ])('restores selection and features after deleting the range [$start, $end)', async ({ start, end, seq, starts, ends }) => {
    const field = await loadRecord(`deleted-range-${start}`, codingSequence, { topology: 'circular', annotations: codingFeatures });
    await placeCaret(field, start);
    for (let index = start; index < end; index += 1) await press(field, 'ArrowRight', { shiftKey: true });
    expect(selectionLabel()).toBe(`${start + 1}–${end} · ${end - start} bp`);
    const before = activeRecord();
    const label = selectionLabel();
    await press(field, 'Delete');
    expect(sequenceOf()).toBe(seq);
    expect(activeRecord().annotations?.map((feature) => feature.start)).toEqual(starts);
    expect(activeRecord().annotations?.map((feature) => feature.end)).toEqual(ends);
    expect(caretHint()).toBe(`Caret ${start + 1}`);
    const after = activeRecord();
    act(() => historyButton('Undo').click());
    expect(activeRecord()).toEqual(before);
    expect(selectionLabel()).toBe(label);
    act(() => historyButton('Redo').click());
    expect(activeRecord()).toEqual(after);
    expect(caretHint()).toBe(`Caret ${start + 1}`);
  });

  it('restores each edit’s selection and caret across multiple steps and record switches', async () => {
    const id = 'coordinate-history';
    const seq = 'ATGGAATTCTAA';
    await act(async () => runtime().motifRenderInventory([
      { id, name: id, molecule: 'dna', topology: 'circular', seq, proposeAnnotations: false },
      { id: 'other-record', name: 'other-record', molecule: 'dna', topology: 'linear', seq: 'CCCC', proposeAnnotations: false },
    ]));
    const field = document.querySelector<HTMLElement>('#motif-cs-sequence-view')!;
    const read = () => ({
      seq: runtime().motifGetActiveRecord().seq,
      caret: caretHint(),
      selection: selectionLabel(),
    });
    await press(field, 'Home');
    await press(field, 'ArrowRight', { shiftKey: true });
    await press(field, 'ArrowRight', { shiftKey: true });
    expect(selectionLabel()).toBe('1–2 · 2 bp');
    const before = read();
    await press(field, 'c');
    expect(runtime().motifGetActiveRecord().seq).toBe('CGGAATTCTAA');
    expect(caretHint()).toContain('Caret 2');
    const afterReplacement = read();
    await press(field, 'Delete');
    expect(runtime().motifGetActiveRecord().seq).toBe('CGAATTCTAA');
    const afterDeletion = read();

    const tab = (index: number) => document.querySelector<HTMLButtonElement>(`#motif-cs-record-tab-${index}`)!;
    act(() => tab(1).click());
    expect(runtime().motifGetActiveRecord().seq).toBe('CCCC');
    expect(historyButton('Undo').disabled).toBe(true);
    act(() => tab(0).click());

    const restore = (action: 'Undo' | 'Redo', expected: ReturnType<typeof read>) => {
      act(() => historyButton(action).click());
      expect(read()).toEqual(expected);
    };
    restore('Undo', afterReplacement);
    restore('Undo', before);
    restore('Redo', afterReplacement);
    restore('Redo', afterDeletion);
  });

  it.each(['Undo', 'Redo'] as const)('clears the map range and Copy target after %s', async (action) => {
    const field = await loadRecord(`circular-${action}`, BASE_SEQUENCE.slice(0, 100), { topology: 'circular' });
    // The record's end: Ctrl+End (Cmd+End on macOS). End alone stops at the line's end.
    await press(field, 'End', { ctrlKey: true });
    act(() => fireEvent.paste(field, { clipboardData: { getData: () => 'CCGTCGCTAA' } }));
    expect(sequenceOf()).toHaveLength(110);
    if (action === 'Redo') act(() => historyButton('Undo').click());

    await press(field, 'End', { ctrlKey: true });
    for (let index = 0; index < 12; index += 1) await press(field, 'ArrowLeft', { shiftKey: true });
    expect(selectionLabel()).toBe(action === 'Undo' ? '99–110 · 12 bp' : '89–100 · 12 bp');
    expect(mapRangeLine()).toBe(action === 'Undo' ? '99–110 · 12 bp' : '89–100 · 12 bp');
    expect(mapHighlight()).not.toBeNull();
    expect(copyButton()?.disabled).toBe(false);

    if (action === 'Redo') {
      act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Translations window off"]')!.click());
      act(() => document.querySelector<HTMLElement>('.motif-cs-protein-aa[data-residue-index="0"]')!.click());
      // The window reads the picked codon: its readout names it, its title bar the selection.
      expect(document.querySelector('[data-testid="translation-residue-readout"]')?.hasAttribute('data-picked')).toBe(true);
      expect(document.querySelector('[data-testid="translation-scope"]')?.textContent).not.toMatch(/^Whole sequence/);
    }
    act(() => historyButton(action).click());
    expect(sequenceOf()).toHaveLength(action === 'Undo' ? 100 : 110);
    expect(copyButton()?.disabled).toBe(true);
    expect(mapRangeLine()).toMatch(/drag to select a range$/i);
    expect(mapHighlight()).toBeNull();
    if (action === 'Redo') {
      expect(document.querySelector('[data-testid="translation-scope"]')?.textContent).toMatch(/^Whole sequence · \d+ aa$/);
      expect(document.querySelector('[data-testid="translation-residue-readout"]')?.hasAttribute('data-picked')).toBe(false);
      act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Translations window on"]')!.click());
    }
  });

  it('discards copied amino-acid text when Undo restores the selected track’s sequence', async () => {
    const field = await loadRecord('undo-track-selection', BASE_SEQUENCE, {
      annotations: [{ id: 'track', name: 'Coding region', type: 'cds', start: 0, end: 30, strand: 1 }],
    });
    const tracksToggle = document.querySelector<HTMLButtonElement>('button[aria-label="Show tracks"]')!;
    if (tracksToggle.getAttribute('aria-pressed') === 'false') act(() => tracksToggle.click());
    await press(field, 'Home');
    await press(field, 'a');
    const trackLabel = field.querySelector<HTMLButtonElement>('.motif-cs-aa-row-label')!;
    act(() => trackLabel.click());
    const selectedText = window.getSelection()?.toString();
    expect(selectedText).toBeTruthy();
    expect(trackLabel.getAttribute('aria-pressed')).toBe('true');
    act(() => historyButton('Undo').click());
    expect(sequenceOf()).toBe(BASE_SEQUENCE);
    const setData = vi.fn();
    fireEvent.copy(field, { clipboardData: { setData } });
    expect(setData).not.toHaveBeenCalled();
    expect(window.getSelection()?.toString()).toBe('');
    expect(trackLabel.getAttribute('aria-pressed')).toBe('false');
    act(() => tracksToggle.click());
  });

  it('clears the large-record map, label and Copy target when the native selection collapses', async () => {
    const textarea = await loadRecord('large-selection-history', 'ACGT'.repeat(12_501)) as HTMLTextAreaElement;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const select = (start: number, end: number) => {
        act(() => {
          textarea.setSelectionRange(start, end);
          fireEvent.select(textarea);
        });
        act(() => vi.advanceTimersByTime(LARGE_SEQUENCE_SELECTION_SETTLE_MS));
      };
      select(10, 20);
      expect(selectionLabel()).toBe('11–20 · 10 bp');
      expect(mapRangeLine()).toBe('11–20 · 10 bp');
      expect(mapHighlight()).not.toBeNull();
      expect(copyButton()?.disabled).toBe(false);

      act(() => {
        fireEvent.mouseDown(textarea);
        textarea.setSelectionRange(30, 30);
        fireEvent.mouseUp(textarea);
      });
      expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([30, 30]);
      expect(document.querySelector('[data-testid="large-sequence-selection"]')).toBeNull();
      expect(selectionLabel()).toBe('Drag to select a range');
      expect(mapRangeLine()).toMatch(/drag to select a range$/i);
      expect(mapHighlight()).toBeNull();
      expect(copyButton()?.disabled).toBe(true);

      select(10, 20);
      expect(copyButton()?.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapses the large textarea when the workbench clears its range', async () => {
    const textarea = await loadRecord('large-app-clear', 'ACGT'.repeat(12_501)) as HTMLTextAreaElement;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      act(() => {
        textarea.setSelectionRange(40, 60);
        fireEvent.select(textarea);
      });
      act(() => vi.advanceTimersByTime(LARGE_SEQUENCE_SELECTION_SETTLE_MS));
      expect(copyButton()?.disabled).toBe(false);
      act(() => textarea.blur());
      await press(document.body, 'Escape');
      expect(copyButton()?.disabled).toBe(true);
      expect(textarea.selectionStart).toBe(textarea.selectionEnd);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('saved result range blocks sequence changes', () => {
  it.each(['edit', 'Undo', 'Redo'] as const)('explains a blocked %s and leaves the same step available', async (action) => {
    const id = `result-blocks-${action}`;
    const field = await loadRecord(id, BASE_SEQUENCE.slice(0, action === 'Undo' ? 99 : 100));
    // The record's end: Ctrl+End (Cmd+End on macOS). End alone stops at the line's end.
    await press(field, 'End', { ctrlKey: true });
    if (action === 'Undo') await press(field, 'a');
    if (action === 'Redo') {
      await press(field, 'Backspace');
      act(() => historyButton('Undo').click());
    }
    const before = activeRecord();
    expect(before.seq).toHaveLength(100);
    const result: ArtifactAnalysisResult = {
      id: 'saved-tail',
      name: 'End assay',
      status: 'complete',
      inputRecordIds: [id],
      dependsOnResultIds: [],
      assetIds: [],
      parameters: {},
      createdAt: '2026-01-01T00:00:00Z',
      provenance: { source: 'test' },
      ...(action === 'Redo' ? {
        kind: 'pcr',
        data: { templateRecordId: id, products: [{ id: 'amplicon', lengthBp: 10, templateRange: { start: 90, end: 100 } }] },
      } : {
        kind: 'primer_design',
        data: { targetRecordId: id, targetRange: { start: 90, end: 100 }, pairs: [] },
      }),
    };
    act(() => expect(runtime().motifAddAnalysisResults(result)).toBe(1));
    const historyBefore = [historyButton('Undo').disabled, historyButton('Redo').disabled];
    const attempt = async () => {
      if (action === 'edit') await press(field, 'Backspace');
      else act(() => historyButton(action).click());
    };
    const errors: unknown[] = [];
    const captureError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener('error', captureError);
    try {
      await attempt();
      expect(activeRecord()).toEqual(before);
      expect([historyButton('Undo').disabled, historyButton('Redo').disabled]).toEqual(historyBefore);
      expect(notice()?.getAttribute('role')).toBe('alert');
      expect(notice()?.textContent).toContain('“End assay”');
      expect(errors).toEqual([]);
    } finally {
      window.removeEventListener('error', captureError);
      act(() => expect(runtime().motifRemoveAnalysisResults(result.id)).toBe(1));
    }

    await attempt();
    expect(sequenceOf()).toHaveLength(99);
  });
});
