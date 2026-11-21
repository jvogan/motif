import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  firstMatchAtOrAfter,
  indexOfMatchStart,
  stepFindMatch,
  type FindMatch,
  type FindResult,
} from './claude-science-find';

/** A selected range this short or shorter seeds the field when find opens. */
export const FIND_PREFILL_LIMIT = 200;

/**
 * Typing jumps to a match once the keys pause, not on every keystroke: each
 * prefix of a query matches somewhere else, so jumping on each key would scroll
 * the view through unrelated lines.
 */
export const FIND_TYPING_JUMP_DELAY_MS = 250;

/** The value after it has been still for `delay` ms; immediate when delay is 0. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (delay <= 0) return undefined;
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return delay <= 0 ? value : settled;
}

export type SequenceFindOptions = {
  /** A record is open and nothing modal owns the page. */
  enabled: boolean;
  recordId: string;
  /** The shared query text (the Sequence search panel edits the same value). */
  query: string;
  result: FindResult;
  /** False while the result still describes an older query. */
  resultIsCurrent: boolean;
  selection: { start: number; end: number } | null;
  /** Residues of the selection when it is one contiguous range, else null. */
  selectionText: string | null;
  caret: number | null;
  onQueryChange: (value: string) => void;
  onSelectMatch: (match: FindMatch) => void;
  onOpen: () => void;
  onFocusSequence: () => void;
  /** Goes to a 1-based base or inclusive range typed into the field (`reversed` when typed high to low); returns the status line's two lines. */
  onGoToPosition?: (first: number, last: number, reversed?: boolean) => FindPositionStatus;
  /** Residues in the record, so a position past the end is named before Enter. */
  sequenceLength?: number;
  /** A circular record reads a range typed high to low as running across the origin. */
  circular?: boolean;
};

export type SequenceFind = {
  open: boolean;
  query: string;
  result: FindResult;
  pending: boolean;
  currentIndex: number | null;
  current: FindMatch | null;
  wrapped: boolean;
  focusRequest: number;
  openFind: () => void;
  closeFind: () => void;
  changeQuery: (value: string) => void;
  step: (direction: 1 | -1) => void;
  selectMatch: (match: FindMatch) => void;
  goToPosition?: (first: number, last: number, reversed?: boolean) => FindPositionStatus;
  sequenceLength?: number;
  circular?: boolean;
};

/** The find bar's status line after Enter on a position: the main line and the line under it. */
export type FindPositionStatus = { label: string; detail: string };

function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * State and keys for the find bar. The current match is the selection, so the
 * map, Copy and Add feature act on it. Cmd/Ctrl+F opens (or refocuses) the bar;
 * Enter, Cmd/Ctrl+G and F3 step forward, with Shift they step back.
 */
export function useSequenceFind(options: SequenceFindOptions): SequenceFind {
  const { enabled, recordId, query, result, resultIsCurrent, onQueryChange, onSelectMatch } = options;
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [current, setCurrentState] = useState<FindMatch | null>(null);
  const [wrapped, setWrapped] = useState(false);
  const currentRef = useRef<FindMatch | null>(null);
  const anchorRef = useRef(0);
  const jumpPendingRef = useRef(false);
  const lastMatchRef = useRef<FindMatch | null>(null);

  const setCurrent = useCallback((match: FindMatch | null) => {
    currentRef.current = match;
    setCurrentState(match);
  }, []);

  useEffect(() => {
    setCurrent(null);
    setWrapped(false);
    anchorRef.current = 0;
    jumpPendingRef.current = false;
    lastMatchRef.current = null;
  }, [recordId, setCurrent]);

  const selectMatch = useCallback((match: FindMatch) => {
    setCurrent(match);
    lastMatchRef.current = match;
    anchorRef.current = match.start;
    onSelectMatch(match);
  }, [onSelectMatch, setCurrent]);

  // Typing jumps to the first match at or after where the search began, once
  // the result for what was typed has arrived and the keys have paused.
  useEffect(() => {
    if (!open || !resultIsCurrent || !jumpPendingRef.current) return undefined;
    const timer = window.setTimeout(() => {
      if (!jumpPendingRef.current) return;
      jumpPendingRef.current = false;
      setWrapped(false);
      if (result.matches.length === 0) {
        setCurrent(null);
        return;
      }
      const index = firstMatchAtOrAfter(result.matches, anchorRef.current);
      const match = result.matches[index >= 0 ? index : 0];
      // The next edit searches on from here, as stepping does.
      anchorRef.current = match.start;
      setCurrent(match);
      lastMatchRef.current = match;
      onSelectMatch(match);
    }, FIND_TYPING_JUMP_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [onSelectMatch, open, result, resultIsCurrent, setCurrent]);

  const currentIndexFor = (matches: readonly FindMatch[], match: FindMatch | null) => {
    if (!match) return null;
    const index = indexOfMatchStart(matches, match.start);
    return index >= 0 ? index : null;
  };

  const latest = useLatest({ options, open, result });

  const openFind = useCallback(() => {
    const { options: now, open: isOpen, result: found } = latest.current;
    if (!now.enabled) return;
    now.onOpen();
    if (!isOpen) {
      const { selection, selectionText, caret } = now;
      anchorRef.current = selection?.start ?? caret ?? 0;
      setWrapped(false);
      const last = lastMatchRef.current;
      const selectionIsLastMatch = !!selection && !!last && last.start === selection.start && last.end === selection.end;
      const atSelection = selection && now.resultIsCurrent ? indexOfMatchStart(found.matches, selection.start) : -1;
      setCurrent(atSelection >= 0 && found.matches[atSelection].end === selection?.end ? found.matches[atSelection] : null);
      if (selectionText && selectionText.length <= FIND_PREFILL_LIMIT && !selectionIsLastMatch && selectionText !== now.query) {
        jumpPendingRef.current = true;
        now.onQueryChange(selectionText);
      }
      setOpen(true);
    }
    setFocusRequest((request) => request + 1);
  }, [latest, setCurrent]);

  const closeFind = useCallback(() => {
    setOpen(false);
    setWrapped(false);
    jumpPendingRef.current = false;
    latest.current.options.onFocusSequence();
  }, [latest]);

  const changeQuery = useCallback((value: string) => {
    jumpPendingRef.current = true;
    setCurrent(null);
    setWrapped(false);
    onQueryChange(value);
  }, [onQueryChange, setCurrent]);

  const step = useCallback((direction: 1 | -1) => {
    const { options: now, result: found } = latest.current;
    // A query typed a moment ago may still be searching. Stepping through the
    // previous query's matches would select one the new query does not have and
    // cancel the jump to its first match, so the step waits for that jump.
    if (!now.resultIsCurrent) return;
    const matches = found.matches;
    const index = currentIndexFor(matches, currentRef.current);
    const next = stepFindMatch(matches, index === null ? null : matches[index].start, anchorRef.current, direction);
    if (!next) return;
    jumpPendingRef.current = false;
    setWrapped(next.wrapped);
    selectMatch(matches[next.index]);
  }, [latest, selectMatch]);

  const keys = useLatest({ openFind, step, open, enabled });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey) return;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const isFind = modifier && !event.shiftKey && key === 'f';
      const isStep = (modifier && key === 'g') || event.key === 'F3';
      if (!isFind && !isStep) return;
      const now = keys.current;
      if (!now.enabled) return;
      // A floating workspace window (the alignment viewer has its own search)
      // and a modal dialog keep their keys.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.motif-cs-window, .motif-cs-modal-backdrop')) return;
      event.preventDefault();
      if (isFind) {
        now.openFind();
        return;
      }
      if (!now.open) now.openFind();
      now.step(event.shiftKey ? -1 : 1);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [keys]);

  const currentIndex = currentIndexFor(result.matches, current);
  return {
    open: open && enabled,
    query,
    result,
    pending: !resultIsCurrent,
    currentIndex,
    current: currentIndex === null ? null : result.matches[currentIndex],
    wrapped,
    focusRequest,
    openFind,
    closeFind,
    changeQuery,
    step,
    selectMatch,
    goToPosition: options.onGoToPosition,
    sequenceLength: options.sequenceLength,
    circular: options.circular,
  };
}
