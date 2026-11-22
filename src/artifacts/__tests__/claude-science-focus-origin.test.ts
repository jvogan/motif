// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  captureFocusOrigin,
  installFocusOriginTracking,
  restoreFocusOrigin,
  returnFocusAfterPointerClick,
  SEQUENCE_VIEW_ID,
} from '../claude-science-focus-origin';

// jsdom draws nothing, so every element reports no client rects; the helper
// keeps an element that had focus as a fallback only when it is still drawn.
function drawn<T extends HTMLElement>(element: T): T {
  element.getClientRects = () => [{ width: 10, height: 10 }] as unknown as DOMRectList;
  return element;
}

let sequence: HTMLElement;
let menuButton: HTMLButtonElement;
let mapButton: HTMLButtonElement;

beforeAll(() => {
  installFocusOriginTracking(document);
});

beforeEach(() => {
  document.body.innerHTML = `
    <div id="${SEQUENCE_VIEW_ID}" tabindex="0"><button class="feature">primer</button></div>
    <button id="menu">Create</button>
    <button id="map">Map</button>
  `;
  sequence = document.getElementById(SEQUENCE_VIEW_ID)!;
  menuButton = document.getElementById('menu') as HTMLButtonElement;
  mapButton = drawn(document.getElementById('map') as HTMLButtonElement);
  (document.activeElement as HTMLElement | null)?.blur();
});

// A pointer press as Chrome delivers it: pointerdown first, then the press moves focus.
function press(target: HTMLElement) {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  target.focus();
}

describe('where focus goes when a menu, drawer, window or find bar closes', () => {
  it('back to the sequence view when the user was typing there as it opened, even by pointer', () => {
    sequence.focus();
    press(menuButton);
    expect(document.activeElement).toBe(menuButton);
    const origin = captureFocusOrigin();
    expect(origin.inSequence).toBe(true);
    expect(restoreFocusOrigin(origin, menuButton)).toBe(sequence);
    expect(document.activeElement).toBe(sequence);
  });

  it('a focused feature bar inside the sequence view counts as the sequence', () => {
    (sequence.querySelector('.feature') as HTMLElement).focus();
    expect(captureFocusOrigin().inSequence).toBe(true);
  });

  it('to the control that opened it when focus was elsewhere', () => {
    mapButton.focus();
    press(menuButton);
    const origin = captureFocusOrigin();
    expect(origin.inSequence).toBe(false);
    expect(origin.element).toBe(menuButton);
    expect(restoreFocusOrigin(origin, menuButton)).toBe(menuButton);
  });

  it('a key press forgets the pointer record: a control reached and pressed from the keyboard is where the user is', () => {
    sequence.focus();
    press(menuButton);
    menuButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(captureFocusOrigin().inSequence).toBe(false);
  });

  it('falls back to the element that had focus when no control is named, and to nothing when it is gone', () => {
    mapButton.focus();
    const origin = captureFocusOrigin();
    sequence.focus();
    expect(restoreFocusOrigin(origin, null)).toBe(mapButton);
    mapButton.remove();
    expect(restoreFocusOrigin(origin, null)).toBeNull();
  });

  it('skips a sequence view that cannot take focus and uses the control', () => {
    sequence.focus();
    const origin = captureFocusOrigin();
    sequence.setAttribute('hidden', '');
    expect(restoreFocusOrigin(origin, menuButton)).toBe(menuButton);
  });
});

describe('a sequence-pane control that opens nothing', () => {
  it('hands the keyboard to the sequence view after a pointer click', () => {
    menuButton.focus();
    returnFocusAfterPointerClick({ detail: 1 });
    expect(document.activeElement).toBe(sequence);
  });

  it('keeps it on the control after Enter or Space, whose click has detail 0', () => {
    menuButton.focus();
    returnFocusAfterPointerClick({ detail: 0 });
    expect(document.activeElement).toBe(menuButton);
  });
});
