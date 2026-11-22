// Where keyboard focus belongs after a menu, drawer, window or find bar closes:
// back in the sequence view when that is where the user was typing when it
// opened, otherwise on the control that opened it.
//
// A pointer press on a button moves focus to the button before its click opens
// anything, so "where focus was" is read from just before the press. A key
// press clears that record: a control reached and pressed from the keyboard is
// where the keyboard user is.

export const SEQUENCE_VIEW_ID = 'motif-cs-sequence-view';

export type FocusOrigin = {
  /** Focus was in the sequence view. */
  inSequence: boolean;
  /** The sequence view showed a keyboard focus ring then. */
  focusVisible: boolean;
  /** The element that had focus when the thing opened. */
  element: HTMLElement | null;
};

type PressRecord = { inSequence: boolean; focusVisible: boolean } | null;
const pressRecords = new WeakMap<Document, PressRecord>();
const installedDocuments = new WeakSet<Document>();

export function sequenceViewElement(doc: Document = document): HTMLElement | null {
  return doc.getElementById(SEQUENCE_VIEW_ID);
}

function matchesFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
}

function sequenceFocusState(doc: Document): { inSequence: boolean; focusVisible: boolean } {
  const view = sequenceViewElement(doc);
  const active = doc.activeElement;
  const inSequence = Boolean(view && active && view.contains(active));
  return { inSequence, focusVisible: inSequence && !!view && matchesFocusVisible(view) };
}

/** Starts listening for presses on `doc`. Safe to call more than once. */
export function installFocusOriginTracking(doc: Document = document): void {
  if (installedDocuments.has(doc)) return;
  installedDocuments.add(doc);
  doc.addEventListener('pointerdown', () => {
    pressRecords.set(doc, sequenceFocusState(doc));
  }, true);
  doc.addEventListener('keydown', () => {
    pressRecords.set(doc, null);
  }, true);
}

/** Call as a menu, drawer, window or the find bar opens. */
export function captureFocusOrigin(doc: Document = document): FocusOrigin {
  const now = sequenceFocusState(doc);
  const active = doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body ? doc.activeElement : null;
  if (now.inSequence) return { ...now, element: active };
  const press = pressRecords.get(doc);
  if (press?.inSequence) return { inSequence: true, focusVisible: press.focusVisible, element: active };
  return { inSequence: false, focusVisible: false, element: active };
}

function canTakeFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(element && element.isConnected
    && !element.closest('[inert], [hidden]') && !(element as HTMLButtonElement).disabled);
}

// The element that had focus as something opened may since have been hidden
// (a drawer item, a closed panel); only one still drawn takes focus back.
function isDrawn(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** Puts focus in the sequence view without scrolling it. False when it is not on screen. */
export function focusSequenceView(options: { focusVisible?: boolean } = {}, doc: Document = document): boolean {
  const view = sequenceViewElement(doc);
  if (!canTakeFocus(view)) return false;
  view.focus({ preventScroll: true, focusVisible: options.focusVisible ?? false } as FocusOptions);
  return doc.activeElement === view;
}

/**
 * Call as the thing closes, when it hands focus back. Returns the element that
 * received focus, or null when neither the sequence view nor a fallback could.
 */
export function restoreFocusOrigin(
  origin: FocusOrigin | null,
  fallback: HTMLElement | null | undefined,
  doc: Document = document,
): HTMLElement | null {
  if (origin?.inSequence && focusSequenceView({ focusVisible: origin.focusVisible }, doc)) return sequenceViewElement(doc);
  const element = origin?.element;
  const target = canTakeFocus(fallback) ? fallback : canTakeFocus(element) && isDrawn(element) ? element : null;
  if (!target) return null;
  target.focus({ preventScroll: true });
  return target;
}

/**
 * For a sequence-pane control that opens nothing: after a pointer click the
 * keyboard goes back to the sequence view; after Enter or Space (a click with
 * `detail` 0) it stays on the control.
 */
export function returnFocusAfterPointerClick(event: { detail: number }, doc: Document = document): void {
  if (event.detail > 0) focusSequenceView({ focusVisible: false }, doc);
}
