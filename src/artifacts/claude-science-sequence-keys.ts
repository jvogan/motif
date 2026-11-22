// Caret and selection movement in the sequence view, kept free of the DOM so
// every key can be checked against plain numbers.
//
// Positions are caret positions: 0 is before the first base and `length` is
// after the last. A line holds `basesPerLine` bases, so a position that is a
// multiple of `basesPerLine` is both the end of one line and the start of the
// next. `atLineEnd` says which of the two the caret is drawn at.

export type SequenceMove =
  | 'char-prev'
  | 'char-next'
  | 'line-up'
  | 'line-down'
  | 'page-up'
  | 'page-down'
  | 'line-start'
  | 'line-end'
  | 'record-start'
  | 'record-end'
  | 'group-prev'
  | 'group-next';

export type SequenceKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type CaretPlace = { position: number; atLineEnd: boolean };

export type SequenceLayout = {
  length: number;
  basesPerLine: number;
  /** Whole lines the view shows, for Page Up and Page Down. */
  pageLines: number;
};

/** Bases between the boundaries Option+Arrow (Ctrl+Arrow off macOS) stops at. */
export const SEQUENCE_GROUP_SIZE = 10;

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function isMacPlatform(nav: { platform?: string; userAgentData?: { platform?: string } } | undefined
  = typeof navigator === 'undefined' ? undefined : navigator as Navigator & { userAgentData?: { platform?: string } }): boolean {
  const platform = nav?.userAgentData?.platform || nav?.platform || '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** A key the browser would scroll the view with. */
export function isScrollKey(key: string): boolean {
  return NAVIGATION_KEYS.has(key) || key === ' ' || key === 'Spacebar';
}

/**
 * The caret move a key asks for, or null when the sequence leaves the key
 * alone. Shift is not part of the choice; it only says "extend the selection".
 */
export function sequenceMoveForKey(event: SequenceKeyEvent, mac: boolean): SequenceMove | null {
  const { key, metaKey, ctrlKey, altKey } = event;
  if (!NAVIGATION_KEYS.has(key)) return null;
  if (mac) {
    if (ctrlKey || (metaKey && altKey)) return null;
    if (metaKey) {
      switch (key) {
        case 'ArrowLeft': return 'line-start';
        case 'ArrowRight': return 'line-end';
        case 'ArrowUp':
        case 'Home': return 'record-start';
        case 'ArrowDown':
        case 'End': return 'record-end';
        default: return null;
      }
    }
    if (altKey) {
      if (key === 'ArrowLeft') return 'group-prev';
      if (key === 'ArrowRight') return 'group-next';
      return null;
    }
  } else {
    if (metaKey || altKey) return null;
    if (ctrlKey) {
      switch (key) {
        case 'ArrowLeft': return 'group-prev';
        case 'ArrowRight': return 'group-next';
        case 'Home': return 'record-start';
        case 'End': return 'record-end';
        default: return null;
      }
    }
  }
  switch (key) {
    case 'ArrowLeft': return 'char-prev';
    case 'ArrowRight': return 'char-next';
    case 'ArrowUp': return 'line-up';
    case 'ArrowDown': return 'line-down';
    case 'PageUp': return 'page-up';
    case 'PageDown': return 'page-down';
    case 'Home': return 'line-start';
    case 'End': return 'line-end';
    default: return null;
  }
}

/** True for the moves that travel toward base 1. */
export function isBackwardMove(move: SequenceMove): boolean {
  return move === 'char-prev' || move === 'line-up' || move === 'page-up'
    || move === 'line-start' || move === 'record-start' || move === 'group-prev';
}

function clampPosition(value: number, length: number): number {
  return Math.max(0, Math.min(length, value));
}

/** Index of the line a caret position is drawn on. */
export function caretLineIndex(place: CaretPlace, layout: Pick<SequenceLayout, 'length' | 'basesPerLine'>): number {
  const { length, basesPerLine } = layout;
  if (basesPerLine <= 0 || length <= 0) return 0;
  const position = clampPosition(place.position, length);
  const lastLine = Math.floor((length - 1) / basesPerLine);
  if (place.atLineEnd && position > 0 && position % basesPerLine === 0) return Math.min(lastLine, position / basesPerLine - 1);
  return Math.min(lastLine, Math.floor(position / basesPerLine));
}

/** Where a move takes the caret from `from`. */
export function sequenceMoveTarget(move: SequenceMove, from: CaretPlace, layout: SequenceLayout): CaretPlace {
  const { length, basesPerLine } = layout;
  const position = clampPosition(from.position, length);
  const line = Math.max(1, basesPerLine);
  const boundary = (value: number) => value > 0 && value < length && value % line === 0;
  switch (move) {
    case 'char-prev': return { position: clampPosition(position - 1, length), atLineEnd: false };
    case 'char-next': return { position: clampPosition(position + 1, length), atLineEnd: false };
    case 'record-start': return { position: 0, atLineEnd: false };
    case 'record-end': return { position: length, atLineEnd: false };
    case 'group-prev': {
      const target = Math.ceil(position / SEQUENCE_GROUP_SIZE) * SEQUENCE_GROUP_SIZE - SEQUENCE_GROUP_SIZE;
      return { position: clampPosition(target, length), atLineEnd: false };
    }
    case 'group-next': {
      const target = Math.floor(position / SEQUENCE_GROUP_SIZE) * SEQUENCE_GROUP_SIZE + SEQUENCE_GROUP_SIZE;
      return { position: clampPosition(target, length), atLineEnd: false };
    }
    case 'line-start': {
      const index = caretLineIndex({ position, atLineEnd: from.atLineEnd }, layout);
      return { position: clampPosition(index * line, length), atLineEnd: false };
    }
    case 'line-end': {
      const index = caretLineIndex({ position, atLineEnd: from.atLineEnd }, layout);
      const end = clampPosition((index + 1) * line, length);
      return { position: end, atLineEnd: boundary(end) };
    }
    case 'line-up':
    case 'line-down':
    case 'page-up':
    case 'page-down': {
      const lines = move === 'line-up' || move === 'line-down' ? 1 : Math.max(1, layout.pageLines);
      const step = (move === 'line-up' || move === 'page-up' ? -1 : 1) * line * lines;
      const target = clampPosition(position + step, length);
      // A caret drawn at a line's end stays at the end of the line it reaches.
      return { position: target, atLineEnd: from.atLineEnd && boundary(target) };
    }
    default: return { position, atLineEnd: false };
  }
}

/**
 * Where a plain (unshifted) move puts the caret when something is selected.
 * Left and Right collapse to the near edge, as a text editor does; every other
 * move starts from the edge on its side.
 */
export function collapsedMoveTarget(
  move: SequenceMove,
  selection: { start: number; end: number },
  layout: SequenceLayout,
): CaretPlace {
  if (move === 'char-prev') return { position: clampPosition(selection.start, layout.length), atLineEnd: false };
  if (move === 'char-next') return { position: clampPosition(selection.end, layout.length), atLineEnd: false };
  const backward = isBackwardMove(move);
  const edge = backward ? selection.start : selection.end;
  // From a selection that ends on a line boundary, line keys act on the line
  // that holds its last base.
  return sequenceMoveTarget(move, { position: edge, atLineEnd: !backward }, layout);
}

/**
 * A Shift+move from a selection. `anchor` stays put; the focus moves. A focus
 * past the anchor that sits on a line boundary belongs to the line of its last
 * selected base, so Shift+End twice stays on one line.
 */
export function extendSelectionTarget(
  move: SequenceMove,
  extent: { anchor: number; focus: number },
  layout: SequenceLayout,
): number {
  const { anchor, focus } = extent;
  return sequenceMoveTarget(move, { position: focus, atLineEnd: focus > anchor }, layout).position;
}

/**
 * A selected feature as the start of a range: the end away from the direction
 * of travel becomes the anchor, and the move starts from the other end.
 */
export function featureExtendStart(
  move: SequenceMove,
  feature: { start: number; end: number },
): { anchor: number; focus: number } {
  return isBackwardMove(move)
    ? { anchor: feature.end, focus: feature.start }
    : { anchor: feature.start, focus: feature.end };
}

/**
 * The anchor for Shift+click on base `index` with a feature selected: a click
 * past the feature's end, or in its second half, extends from its start; a click
 * before it, or in its first half, extends from its end.
 */
export function featureClickAnchor(index: number, feature: { start: number; end: number }): number {
  if (index >= feature.end) return feature.start;
  if (index < feature.start) return feature.end;
  return index >= (feature.start + feature.end) / 2 ? feature.start : feature.end;
}

/**
 * The single stretch of bases a feature covers, or null when no range can
 * start from it: it has no bases, or two consecutive pieces meet at the origin
 * of a circular record (the map draws those as one piece across the origin).
 * A joined feature's stretch includes the bases between its pieces.
 */
export function featureStretch(
  spans: readonly { start: number; end: number }[],
  length: number,
  circular: boolean,
): { start: number; end: number } | null {
  if (spans.length === 0 || length <= 0) return null;
  if (circular) {
    for (let index = 1; index < spans.length; index += 1) {
      const previous = spans[index - 1];
      const span = spans[index];
      if ((previous.end === length && span.start === 0) || (previous.start === 0 && span.end === length)) return null;
    }
  }
  const start = clampPosition(Math.min(...spans.map((span) => span.start)), length);
  const end = clampPosition(Math.max(...spans.map((span) => span.end)), length);
  return end > start ? { start, end } : null;
}

/**
 * In Replace mode the caret marks the base the next letter replaces, so the
 * end of a line is its last base: the gap after it is the next line's first
 * base, which a letter would replace. The last line ends after the record's
 * last base, where a typed letter is added, as the record's end does.
 */
export function replaceModeLineEnd(move: SequenceMove, target: CaretPlace, length: number): CaretPlace {
  if (move !== 'line-end' || target.position <= 0 || target.position >= length) return target;
  return { position: target.position - 1, atLineEnd: false };
}

/**
 * Places where Cmd/Ctrl+A keeps its own meaning instead of selecting the
 * record's sequence: text fields (the export preview is one), editable text,
 * the alignment window, and a modal dialog.
 */
export function keepsNativeSelectAll(target: Element | null): boolean {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  if (target.closest('[contenteditable=""], [contenteditable="true"], .motif-cs-modal-backdrop, .motif-cs-msa-workspace')) return true;
  return Boolean(target.closest('.motif-cs-window')?.querySelector('.motif-cs-msa-workspace'));
}

/**
 * Shift+click on base `index` of a circular record whose selection already
 * runs across the origin. The anchor stays, as for any range, and the range
 * goes the shorter way round from it to the clicked base, so it keeps crossing
 * the origin when that way is shorter. Stored form: 0 <= start < length and
 * start < end <= start + length.
 */
export function circularRangeToBase(anchor: number, index: number, length: number): { start: number; end: number } {
  const from = ((anchor % length) + length) % length;
  const forwardEnd = index >= from ? index + 1 : index + 1 + length;
  const backwardStart = index < from ? index : index - length;
  if (forwardEnd - from <= from - backwardStart) return { start: from, end: forwardEnd };
  return backwardStart >= 0 ? { start: backwardStart, end: from } : { start: backwardStart + length, end: from + length };
}

type NativeSelectionEnds =Pick<Selection, 'rangeCount' | 'isCollapsed' | 'anchorNode' | 'focusNode'>;

/**
 * A native text selection the user cannot see: one that touches the sequence
 * view, where `::selection` is transparent. A right-click on the bases selects
 * a whole line this way. Copy then takes the app's own selection instead. The
 * amino-acid copy buffer is the app's own selection, so it is never stray.
 */
export function isStrayNativeSelection(selection: NativeSelectionEnds | null | undefined): boolean {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const elementOf = (node: Node | null): Element | null => (
    node && node.nodeType === 1 ? node as Element : node?.parentElement ?? null
  );
  const ends = [elementOf(selection.anchorNode), elementOf(selection.focusNode)];
  if (ends.some((end) => end?.closest('.motif-cs-aa-copy-buffer'))) return false;
  return ends.some((end) => Boolean(end?.closest('.motif-cs-sequence')));
}

/**
 * Shift+Left past base 1, or Shift+Right past the last base, of a circular
 * record continues across the origin, as a pointer drag on the circular map
 * can. Positions here are unwrapped: a focus below 0 or above `length` lies
 * past the origin, and the selection never exceeds one full turn.
 */
export function extendSelectionAcrossOrigin(
  move: SequenceMove,
  extent: { anchor: number; focus: number },
  layout: SequenceLayout,
): number {
  const { anchor, focus } = extent;
  const { length } = layout;
  const turn = (value: number) => Math.max(anchor - length, Math.min(anchor + length, value));
  if (move === 'char-prev' || move === 'char-next') return turn(focus + (move === 'char-next' ? 1 : -1));
  // Other keys act on the base the focus is at, then keep it on the same side
  // of the origin.
  const offset = focus < 0 ? -length : focus > length ? length : 0;
  return turn(extendSelectionTarget(move, { anchor: anchor - offset, focus: focus - offset }, layout) + offset);
}

/**
 * The selected range for an anchor and an unwrapped focus, in the form the
 * workbench stores: `end` past `length` for a range across the origin.
 */
export function rangeFromExtent(anchor: number, focus: number, length: number): { start: number; end: number } {
  const low = Math.min(anchor, focus);
  const high = Math.max(anchor, focus);
  return low < 0 ? { start: low + length, end: high + length } : { start: low, end: high };
}
