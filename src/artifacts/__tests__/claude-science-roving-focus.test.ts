import { describe, expect, it } from 'vitest';
import { moveRovingFocus, rovingFocusTarget } from '../claude-science-roving-focus';

describe('rovingFocusTarget', () => {
  it('steps down and up, and wraps at the ends', () => {
    expect(rovingFocusTarget('ArrowDown', 0, 4)).toBe(1);
    expect(rovingFocusTarget('ArrowDown', 3, 4)).toBe(0);
    expect(rovingFocusTarget('ArrowUp', 2, 4)).toBe(1);
    expect(rovingFocusTarget('ArrowUp', 0, 4)).toBe(3);
  });

  it('jumps to the first and last with Home and End', () => {
    expect(rovingFocusTarget('Home', 2, 4)).toBe(0);
    expect(rovingFocusTarget('End', 1, 4)).toBe(3);
  });

  it('enters the list from outside on the first row for Down and the last for Up', () => {
    expect(rovingFocusTarget('ArrowDown', -1, 4)).toBe(0);
    expect(rovingFocusTarget('ArrowUp', -1, 4)).toBe(3);
  });

  it('uses Left and Right only for buttons laid out in a row', () => {
    expect(rovingFocusTarget('ArrowRight', 0, 3)).toBeNull();
    expect(rovingFocusTarget('ArrowLeft', 1, 3)).toBeNull();
    expect(rovingFocusTarget('ArrowRight', 0, 3, true)).toBe(1);
    expect(rovingFocusTarget('ArrowLeft', 0, 3, true)).toBe(2);
  });

  it('ignores other keys and an empty list', () => {
    expect(rovingFocusTarget('Enter', 0, 4)).toBeNull();
    expect(rovingFocusTarget('a', 0, 4)).toBeNull();
    expect(rovingFocusTarget('ArrowDown', 0, 0)).toBeNull();
  });
});

function fakeControl(tag: string, log: string[], name: string): HTMLElement {
  return {
    matches: (selector: string) => selector.split(',').map((part) => part.trim()).includes(tag),
    getClientRects: () => [{}] as unknown as DOMRectList,
    focus: () => { log.push(name); },
  } as unknown as HTMLElement;
}

function press(key: string, target: HTMLElement, extra: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) {
  let prevented = false;
  const event = {
    key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, defaultPrevented: false, target,
    preventDefault: () => { prevented = true; },
    ...extra,
  };
  return { event, wasPrevented: () => prevented };
}

describe('moveRovingFocus', () => {
  it('focuses the next control and takes the key', () => {
    const log: string[] = [];
    const controls = ['a', 'b', 'c'].map((name) => fakeControl('button', log, name));
    const { event, wasPrevented } = press('ArrowDown', controls[0]);
    expect(moveRovingFocus(event, controls)).toBe(true);
    expect(log).toEqual(['b']);
    expect(wasPrevented()).toBe(true);
  });

  it('leaves a select, text field or text area its own arrow keys', () => {
    for (const tag of ['select', 'input', 'textarea']) {
      const log: string[] = [];
      const field = fakeControl(tag, log, 'field');
      const controls = [fakeControl('button', log, 'a'), field];
      const { event, wasPrevented } = press('ArrowDown', field);
      expect(moveRovingFocus(event, controls)).toBe(false);
      expect(log).toEqual([]);
      expect(wasPrevented()).toBe(false);
    }
  });

  it('never takes a key pressed with a modifier, or one already handled', () => {
    const log: string[] = [];
    const controls = ['a', 'b'].map((name) => fakeControl('button', log, name));
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'] as const) {
      expect(moveRovingFocus(press('ArrowDown', controls[0], { [modifier]: true }).event, controls)).toBe(false);
    }
    expect(moveRovingFocus({ ...press('ArrowDown', controls[0]).event, defaultPrevented: true }, controls)).toBe(false);
    expect(log).toEqual([]);
  });

  it('ignores a key pressed on something outside the list', () => {
    const log: string[] = [];
    const controls = ['a', 'b'].map((name) => fakeControl('button', log, name));
    const stranger = fakeControl('button', log, 'stranger');
    expect(moveRovingFocus(press('ArrowDown', stranger).event, controls)).toBe(false);
    expect(log).toEqual([]);
  });

  it('skips controls that are not visible', () => {
    const log: string[] = [];
    const hidden = { ...fakeControl('button', log, 'hidden'), getClientRects: () => [] } as unknown as HTMLElement;
    const controls = [fakeControl('button', log, 'a'), hidden, fakeControl('button', log, 'c')];
    expect(moveRovingFocus(press('ArrowDown', controls[0]).event, controls)).toBe(true);
    expect(log).toEqual(['c']);
  });
});
