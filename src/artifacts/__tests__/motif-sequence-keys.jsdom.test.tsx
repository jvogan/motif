// @vitest-environment jsdom

import { act, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import './motif-workbench-jsdom-setup';
import '../motif-artifact';

// The whole workbench, mounted the way the artifact mounts itself, for the
// keyboard and focus contract of the Sequence pane. jsdom has no layout: the
// setup gives the sequence a 60-base line, and keys go through fireEvent.
// navigator.platform is empty here, so the off-macOS keys apply (Ctrl+End is
// the record's end).

type RuntimeRecord = { seq: string; annotations?: { name: string }[] };
type RuntimeWindow = {
  motifGetInventory: () => RuntimeRecord[];
  motifRenderInventory: (records: unknown[]) => void;
};

beforeAll(async () => {
  await waitFor(() => expect(document.querySelector('.motif-cs-sequence')).not.toBeNull());
});

afterEach(() => {
  vi.restoreAllMocks();
});

const runtime = () => window as unknown as RuntimeWindow;
const sequenceOf = (): string => runtime().motifGetInventory()[0]?.seq ?? '';
const field = () => document.querySelector<HTMLElement>('#motif-cs-sequence-view')!;
const caretHint = () => document.querySelector('.motif-cs-edit-hint')?.textContent ?? null;
const selectionLabel = () => document.querySelector('.motif-cs-selection-name')?.textContent ?? null;
const notice = () => document.querySelector<HTMLElement>('.motif-cs-workbench-notice');
const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
// Typing mode is one button that names the current mode and switches it; its
// data-mode is the mode. Setting a mode clicks it only when it is the other one,
// and checks the mode and the name after.
const typingModeButton = () => document.querySelector<HTMLButtonElement>('button.motif-cs-edit-mode-toggle')!;
const TYPING_MODE_NAME = { replace: 'Typing mode: Replace. Switch to Insert', insert: 'Typing mode: Insert. Switch to Replace' } as const;
function setTypingMode(mode: 'replace' | 'insert') {
  expect(typingModeButton()).toBeTruthy();
  if (typingModeButton().dataset.mode !== mode) act(() => typingModeButton().click());
  expect(typingModeButton().dataset.mode).toBe(mode);
  expect(typingModeButton().getAttribute('aria-label')).toBe(TYPING_MODE_NAME[mode]);
}
const press = (target: Element, key: string, init: KeyboardEventInit = {}) => {
  let allowed = true;
  act(() => { allowed = fireEvent.keyDown(target, { key, ...init }); });
  return allowed;
};

// 240 bases, four 60-base lines.
const BASE_SEQUENCE = 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCA'.repeat(4);
const PROTEIN = 'MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFF';

async function loadRecord(id: string, fields: Record<string, unknown> = {}) {
  await act(async () => {
    runtime().motifRenderInventory([{ id, name: id, molecule: 'dna', topology: 'linear', seq: BASE_SEQUENCE, ...fields }]);
  });
  await waitFor(() => expect(sequenceOf()).toBe(fields.seq ?? BASE_SEQUENCE));
  act(() => field().focus());
  return field();
}

function placeCaret(view: HTMLElement, position: number) {
  press(view, 'Home', { ctrlKey: true });
  for (let step = 0; step < position; step += 1) press(view, 'ArrowRight');
}

function cut(view: HTMLElement) {
  const setData = vi.fn();
  let allowed = true;
  act(() => { allowed = fireEvent.cut(view, { clipboardData: { setData, getData: () => '' } }); });
  return { setData, allowed };
}

describe('typing goes where the caret blinks', () => {
  it('a pointer click on a toolbar control that opens nothing hands the keyboard back to the sequence; Enter or Space keeps it on the control', async () => {
    const view = await loadRecord('k1-focus');
    placeCaret(view, 10);
    const toggle = button(TYPING_MODE_NAME.replace);
    act(() => toggle.focus());
    act(() => { fireEvent.click(toggle, { detail: 1 }); });
    expect(toggle.dataset.mode).toBe('insert');
    expect(document.activeElement).toBe(view);
    expect(caretHint()).toBe('Caret 11');
    act(() => toggle.focus());
    act(() => { fireEvent.click(toggle, { detail: 0 }); });
    expect(toggle.dataset.mode).toBe('replace');
    expect(document.activeElement).toBe(toggle);
  });
});

describe('Cmd/Ctrl+A selects the sequence from anywhere in the workbench', () => {
  it('selects every base and moves the keyboard to the sequence; a text field keeps the key', async () => {
    await loadRecord('k2-select-all');
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(press(document.body, 'a', { ctrlKey: true })).toBe(false);
    expect(selectionLabel()).toBe('1–240 · 240 bp');
    expect(document.activeElement).toBe(field());

    act(() => { fireEvent.keyDown(field(), { key: 'Escape' }); });
    const input = document.createElement('input');
    document.body.append(input);
    act(() => input.focus());
    expect(press(input, 'a', { ctrlKey: true })).toBe(true);
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

describe('cut', () => {
  it('puts the range\'s bases on the clipboard and removes them as one undoable edit with Delete\'s notice', async () => {
    const view = await loadRecord('k3-cut');
    placeCaret(view, 20);
    for (let step = 0; step < 10; step += 1) press(view, 'ArrowRight', { shiftKey: true });
    expect(selectionLabel()).toBe('21–30 · 10 bp');
    const { setData, allowed } = cut(view);
    expect(allowed).toBe(false);
    expect(setData).toHaveBeenCalledWith('text/plain', BASE_SEQUENCE.slice(20, 30));
    expect(sequenceOf()).toBe(BASE_SEQUENCE.slice(0, 20) + BASE_SEQUENCE.slice(30));
    expect(notice()?.textContent).toContain('Deleted 10 bp (21–30)');
    act(() => button('Undo').click());
    expect(sequenceOf()).toBe(BASE_SEQUENCE);
  });

  it('in a read-only record copies only and says so', async () => {
    const view = await loadRecord('k3-cut-protein', { molecule: 'protein', seq: PROTEIN });
    for (let step = 0; step < 5; step += 1) press(view, 'ArrowRight', { shiftKey: true });
    const { setData } = cut(view);
    expect(setData).toHaveBeenCalledWith('text/plain', PROTEIN.slice(0, 5));
    expect(sequenceOf()).toBe(PROTEIN);
    expect(notice()?.textContent).toContain('read-only');
  });

  it('with only a caret leaves the clipboard and the record alone', async () => {
    const view = await loadRecord('k3-cut-caret');
    placeCaret(view, 5);
    const { setData, allowed } = cut(view);
    expect(setData).not.toHaveBeenCalled();
    expect(allowed).toBe(true);
    expect(sequenceOf()).toBe(BASE_SEQUENCE);
  });
});

describe('a selected feature is a starting point', () => {
  it('arrows on the selected feature\'s bar start from its ends and move the keyboard to the sequence; Delete removes nothing', async () => {
    await loadRecord('k4-feature', {
      annotations: [{ id: 'primer', name: 'primer site', type: 'primer_bind', start: 40, end: 60, strand: 1 }],
    });
    const tracks = button('Show tracks');
    if (tracks.getAttribute('aria-pressed') !== 'true') act(() => tracks.click());
    const bar = () => document.querySelector<HTMLButtonElement>('.motif-cs-feature-block')!;
    act(() => bar().click());
    act(() => bar().focus());
    press(bar(), 'ArrowRight', { shiftKey: true });
    expect(selectionLabel()).toBe('41–61 · 21 bp');
    expect(document.activeElement).toBe(field());

    act(() => bar().click());
    act(() => bar().focus());
    press(bar(), 'ArrowLeft');
    expect(caretHint()).toBe('Caret 41');

    act(() => bar().click());
    act(() => bar().focus());
    press(bar(), 'Delete');
    press(bar(), 'Backspace');
    expect(sequenceOf()).toBe(BASE_SEQUENCE);
    expect(bar().getAttribute('aria-pressed')).toBe('true');
  });
});

describe('line keys, and Space', () => {
  it('End in Insert mode draws the caret at the end of the line it acted on', async () => {
    const view = await loadRecord('k5-insert-end');
    setTypingMode('insert');
    act(() => view.focus());
    placeCaret(view, 65);
    press(view, 'End');
    expect(caretHint()).toBe('Caret 121');
    const caret = view.querySelector<HTMLElement>('.motif-cs-seq-caret')!;
    expect(caret.closest<HTMLElement>('.motif-cs-seq-bases')?.dataset.lineStart).toBe('60');
    expect(caret.dataset.mode).toBe('insert');
    press(view, 'Home');
    expect(caretHint()).toBe('Caret 61');
    setTypingMode('replace');
  });

  it('Space is taken by the sequence and changes nothing; modified scroll keys it does not use are taken too', async () => {
    const view = await loadRecord('k6-space');
    placeCaret(view, 5);
    expect(press(view, ' ')).toBe(false);
    expect(press(view, 'ArrowDown', { altKey: true })).toBe(false);
    expect(press(view, 'PageDown', { ctrlKey: true })).toBe(false);
    expect(sequenceOf()).toBe(BASE_SEQUENCE);
    expect(caretHint()).toBe('Caret 6');
  });
});

describe('Replace mode marks the base it will replace', () => {
  it('one typing-mode button names the mode and the switch, and changes the mode on each press', async () => {
    const view = await loadRecord('k7-toggle');
    placeCaret(view, 10);
    expect(document.querySelectorAll('.motif-cs-edit-mode-toggle')).toHaveLength(1);
    const toggle = typingModeButton();
    for (const [step, [mode, word]] of ([['replace', 'Replace'], ['insert', 'Insert'], ['replace', 'Replace']] as const).entries()) {
      if (step > 0) act(() => toggle.click());
      expect(toggle.dataset.mode).toBe(mode);
      expect(toggle.getAttribute('aria-label')).toBe(TYPING_MODE_NAME[mode]);
      expect(toggle.title).toBe(TYPING_MODE_NAME[mode]);
      expect(toggle.querySelector('[data-shown]')?.textContent).toBe(word);
      expect(toggle.hasAttribute('aria-pressed')).toBe(false);
      expect(view.querySelector<HTMLElement>('.motif-cs-seq-caret')?.dataset.mode).toBe(mode);
    }
  });

  it('draws the caret as a mark on the base in Replace mode and as a bar in Insert mode', async () => {
    const view = await loadRecord('k7-marker');
    placeCaret(view, 10);
    expect(view.querySelector<HTMLElement>('.motif-cs-seq-caret')?.dataset.mode).toBe('replace');
    setTypingMode('insert');
    expect(view.querySelector<HTMLElement>('.motif-cs-seq-caret')?.dataset.mode).toBe('insert');
    setTypingMode('replace');
    // After the last base a letter is added, so the caret is a bar there.
    press(view, 'End', { ctrlKey: true });
    expect(view.querySelector<HTMLElement>('.motif-cs-seq-caret')?.dataset.mode).toBe('insert');
  });
});

describe('adding a feature by keyboard', () => {
  it('selects the suggested name, saves on Enter and returns the keyboard to the sequence, where Undo removes the feature', async () => {
    const view = await loadRecord('k8-add-feature');
    placeCaret(view, 100);
    for (let step = 0; step < 20; step += 1) press(view, 'ArrowRight', { shiftKey: true });
    const addFeature = [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === 'Add feature')!;
    act(() => addFeature.click());
    const name = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>('details[data-rail-tool="annotations"] input[name="feature-name"]');
      expect(input).not.toBeNull();
      expect(document.activeElement).toBe(input);
      return input!;
    });
    expect(name.dataset.suggested).toBe('true');
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, name.value.length]);
    act(() => { fireEvent.change(name, { target: { value: 'TagA' } }); });
    press(name, 'Enter');
    expect(document.activeElement).toBe(field());
    expect(runtime().motifGetInventory()[0].annotations?.map((feature) => feature.name)).toContain('TagA');
    press(field(), 'z', { ctrlKey: true });
    expect(runtime().motifGetInventory()[0].annotations?.map((feature) => feature.name) ?? []).not.toContain('TagA');
  });

  it('keeps the keyboard in the name field when Enter meets a range it cannot add', async () => {
    const view = await loadRecord('k8-bad-range');
    placeCaret(view, 100);
    for (let step = 0; step < 20; step += 1) press(view, 'ArrowRight', { shiftKey: true });
    const addFeature = [...document.querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent === 'Add feature')!;
    act(() => addFeature.click());
    const editor = 'details[data-rail-tool="annotations"]';
    const name = await waitFor(() => {
      const input = document.querySelector<HTMLInputElement>(`${editor} input[name="feature-name"]`);
      expect(document.activeElement).toBe(input);
      return input!;
    });
    const before = runtime().motifGetInventory()[0].annotations?.length ?? 0;
    act(() => { fireEvent.change(document.querySelector<HTMLInputElement>(`${editor} input[name="feature-start"]`)!, { target: { value: '0' } }); });
    press(name, 'Enter');
    expect(document.activeElement).toBe(name);
    expect(document.querySelector(editor)?.textContent).toContain('Range must stay within 1-');
    expect(runtime().motifGetInventory()[0].annotations?.length ?? 0).toBe(before);
  });
});

describe('an input method composing in the sequence view', () => {
  it('owns its keys: no move, no edit and no select all while composing', async () => {
    const view = await loadRecord('ime-composing');
    placeCaret(view, 10);
    const before = sequenceOf();
    expect(press(view, 'ArrowRight', { isComposing: true })).toBe(true);
    expect(press(view, 'Process', { keyCode: 229 })).toBe(true);
    expect(press(view, 'g', { isComposing: true })).toBe(true);
    expect(press(view, 'a', { ctrlKey: true, isComposing: true })).toBe(true);
    expect(caretHint()).toBe('Caret 11');
    expect(sequenceOf()).toBe(before);
    press(view, 'ArrowRight');
    expect(caretHint()).toBe('Caret 12');
  });
});

describe('Escape acts where the keyboard is', () => {
  it('in the find bar it closes the find bar and leaves an open Translation window; the next Escape closes the window', async () => {
    const view = await loadRecord('k9-escape-order');
    placeCaret(view, 20);
    for (let step = 0; step < 6; step += 1) press(view, 'ArrowRight', { shiftKey: true });
    act(() => button('Translations window off').click());
    const translation = () => document.querySelector('.motif-cs-window[role="dialog"][aria-label="Translation"]');
    await waitFor(() => expect(translation()).not.toBeNull());
    act(() => field().focus());
    press(field(), 'f', { ctrlKey: true });
    const input = await waitFor(() => {
      const found = document.querySelector<HTMLInputElement>('[role="search"][aria-label="Find in sequence"] input');
      expect(found).not.toBeNull();
      return found!;
    });
    act(() => input.focus());
    press(input, 'Escape');
    await waitFor(() => expect(document.querySelector('[role="search"][aria-label="Find in sequence"]')).toBeNull());
    expect(translation()).not.toBeNull();
    expect(selectionLabel()).toBe('21–26 · 6 bp');
    act(() => field().focus());
    press(field(), 'Escape');
    await waitFor(() => expect(translation()).toBeNull());
    expect(selectionLabel()).toBe('21–26 · 6 bp');
  });
});
