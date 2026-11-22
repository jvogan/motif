import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { findCountLabel, findPositionPreview, firstMatchAtOrAfter, parseFindPosition, sequenceRowCutAt, type FindMatch } from './claude-science-find';
import type { FindPositionStatus, SequenceFind } from './claude-science-find-state';

type FindBarProps = {
  find: SequenceFind;
  maxLength: number;
};

/** The part of the current match from its start (a match across a circular
 * origin also paints a continuation at base 1, which is not tracked). */
const FIND_CURRENT_START = '[data-find-current]:not([data-find-current="continued"])';

/** The nearest ancestor that can scroll vertically, or the page. */
function scrollingAncestor(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1) return node;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

/** The vertical extent of an element that is on screen: clipped by every
 * scrolling or clipping ancestor and by the window. */
function visibleBox(element: HTMLElement): { top: number; bottom: number } {
  const box = element.getBoundingClientRect();
  let top = box.top;
  let bottom = box.bottom;
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = window.getComputedStyle(node);
    if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
    const clip = node.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  return { top: Math.max(top, 0), bottom: Math.min(bottom, window.innerHeight) };
}

/**
 * The find bar. At the top edge it takes its own row above the sequence view; at the
 * bottom edge it floats over the view from a zero-height anchor. If the current match
 * would sit under it, the view scrolls once or the bar moves to the other edge.
 */
export function ClaudeScienceFindBar({ find, maxLength }: FindBarProps) {
  const { query, result, currentIndex, current, wrapped, pending, focusRequest } = find;
  const anchorRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [placement, setPlacement] = useState<{ edge: 'top' | 'bottom'; top: number }>({ edge: 'top', top: 0 });
  const [scrollbar, setScrollbar] = useState(0);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
    const view = document.getElementById('motif-cs-sequence-view');
    if (view) setScrollbar(Math.max(0, view.offsetWidth - view.clientWidth));
    const bar = barRef.current?.getBoundingClientRect();
    if (bar && (bar.top < 0 || bar.bottom > window.innerHeight)) barRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusRequest]);

  // The current match is never hidden: after a step it must sit inside the part
  // of the view that is on screen and clear of the bar. The view scrolls once
  // when it can; otherwise the bar takes the other edge, at most once per match
  // so it cannot flip back and forth. When the bar opens over a match that is
  // already selected it only changes edge, decided before the first paint, so
  // opening it never moves the sequence.
  const flippedForRef = useRef<string | null>(null);
  const settleCover = (mode: 'open' | 'step', key: string | null): boolean => {
    const anchor = anchorRef.current;
    const bar = barRef.current;
    const view = document.getElementById('motif-cs-sequence-view');
    const parts = [...(anchor?.parentElement?.querySelectorAll<HTMLElement>(FIND_CURRENT_START) ?? [])]
      .map((part) => part.getBoundingClientRect());
    if (!anchor || !bar || !view || parts.length === 0) return false;
    const gap = 8;
    const barBox = bar.getBoundingClientRect();
    const flip = () => {
      if (placement.edge === 'top') {
        const region = visibleBox(view);
        setPlacement({ edge: 'bottom', top: Math.max(0, region.bottom - anchor.getBoundingClientRect().top - barBox.height - gap) });
      } else {
        setPlacement({ edge: 'top', top: 0 });
      }
    };
    const underBar = parts.some((part) => part.top < barBox.bottom && part.bottom > barBox.top
      && part.left < barBox.right && part.right > barBox.left);
    if (mode === 'open') {
      if (underBar) flip();
      return true;
    }
    const region = visibleBox(view);
    const sharesColumns = parts.some((part) => part.left < barBox.right && part.right > barBox.left);
    const bandTop = sharesColumns && placement.edge === 'top' ? Math.max(region.top, barBox.bottom + gap) : region.top;
    const bandBottom = sharesColumns && placement.edge === 'bottom' ? Math.min(region.bottom, barBox.top - gap) : region.bottom;
    const hitTop = Math.min(...parts.map((part) => part.top));
    const hitBottom = Math.max(...parts.map((part) => part.bottom));
    if (hitTop >= bandTop - 0.5 && hitBottom <= bandBottom + 0.5) return true;
    const delta = hitTop < bandTop || hitBottom - hitTop > bandBottom - bandTop ? hitTop - bandTop : hitBottom - bandBottom;
    const maxScroll = Math.max(0, view.scrollHeight - view.clientHeight);
    const nextScroll = view.scrollTop + delta;
    if (maxScroll > 0 && nextScroll >= -0.5 && nextScroll <= maxScroll + 0.5) {
      const before = view.scrollTop;
      view.scrollTop = Math.min(maxScroll, Math.max(0, nextScroll));
      // The first row under the bar is whole: a row the top edge cuts scrolls
      // out, or fully in when the match would then leave the band.
      const cut = placement.edge === 'top' ? sequenceRowCutAt(view, region.top) : null;
      if (cut) {
        const moved = view.scrollTop - before;
        if (hitTop - moved - (cut.bottom - region.top) >= bandTop - 0.5) view.scrollTop += cut.bottom - region.top;
        else if (hitBottom - moved + (region.top - cut.top) <= bandBottom + 0.5) view.scrollTop -= region.top - cut.top;
      }
      return true;
    }
    // The bar is what is in the way: take the other edge, once for this match.
    const barLimits = sharesColumns && (delta < 0 ? placement.edge === 'top' && bandTop > region.top : placement.edge === 'bottom' && bandBottom < region.bottom);
    if (barLimits && flippedForRef.current !== key) {
      flippedForRef.current = key;
      flip();
      return true;
    }
    // Otherwise the view itself runs past the screen (a stacked pane taller
    // than the window): scroll the view as far as it goes, then the nearest
    // scrolling ancestor for the rest. Bar and match move together there.
    const applied = Math.min(maxScroll, Math.max(0, nextScroll)) - view.scrollTop;
    view.scrollTop += applied;
    const rest = delta - applied;
    if (Math.abs(rest) > 0.5) {
      const outer = scrollingAncestor(view);
      if (outer) outer.scrollTop += rest;
    }
    return true;
  };
  const settleCoverRef = useRef(settleCover);
  useLayoutEffect(() => {
    settleCoverRef.current = settleCover;
  });
  const currentKey = current ? `${current.start}:${current.end}` : null;
  const settledOnOpenRef = useRef(false);
  const openKeyRef = useRef(currentKey);
  useLayoutEffect(() => {
    settledOnOpenRef.current = settleCoverRef.current('open', openKeyRef.current);
  }, []);

  const openedRef = useRef(true);
  useEffect(() => {
    const justOpened = openedRef.current;
    openedRef.current = false;
    if (currentKey === null || (justOpened && settledOnOpenRef.current)) return undefined;
    // A step's reveal can take several frames to come to rest; judge the match
    // where it stops, not where it is passing through.
    let frame = 0;
    let frames = 0;
    let still = 0;
    let lastTop: number | null = null;
    const watch = () => {
      frames += 1;
      // The reveal lands in the commit that chose the match, so the first frame
      // usually shows where it rests: settle before that frame paints, so a
      // step is one jump and not a jump and then a nudge. If the match is still
      // moving, it is judged again where it stops (a no-op when it did not move).
      if (frames === 1 && anchorRef.current?.parentElement?.querySelector(FIND_CURRENT_START)) {
        settleCoverRef.current(justOpened ? 'open' : 'step', currentKey);
      }
      const top = anchorRef.current?.parentElement?.querySelector(FIND_CURRENT_START)?.getBoundingClientRect().top ?? null;
      still = top !== null && lastTop !== null && Math.abs(top - lastTop) < 0.5 ? still + 1 : 0;
      lastTop = top;
      if ((top !== null && still >= 2) || frames >= 30) {
        settleCoverRef.current(justOpened ? 'open' : 'step', currentKey);
        return;
      }
      frame = window.requestAnimationFrame(watch);
    };
    frame = window.requestAnimationFrame(watch);
    return () => window.cancelAnimationFrame(frame);
  }, [currentKey, placement.edge]);

  // A number or a range goes to that base on Enter, and the status line says
  // what Enter will do and then what it did, until the field changes.
  const position = find.goToPosition ? parseFindPosition(query) : null;
  const [wentTo, setWentTo] = useState<{ query: string; status: FindPositionStatus } | null>(null);
  const positionStatus: FindPositionStatus | null = position
    ? wentTo?.query === query
      ? wentTo.status
      : findPositionPreview(position, find.sequenceLength, find.circular === true)
    : null;
  const hasMatches = result.matches.length > 0;
  // One match has nowhere to step to, so the arrows are off with 0 or 1.
  const canStep = result.matches.length > 1;
  const noStep = hasMatches ? 'Only one match' : 'No matches to step through';
  const label = positionStatus?.label ?? findCountLabel(result, currentIndex);
  const strandWord = current && result.bothStrands ? (current.strand === -1 ? 'reverse' : 'forward') : null;
  const detail = positionStatus
    ? positionStatus.detail
    : current
      ? strandWord ? `${strandWord} strand` : ''
      : pending && query ? 'Searching…' : '';
  const wrapNote = current && wrapped
    ? currentIndex === 0 ? 'Wrapped to the first match' : 'Wrapped to the last match'
    : null;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      find.closeFind();
      return;
    }
    if (event.key === 'Enter' && event.target === inputRef.current) {
      event.preventDefault();
      if (position && find.goToPosition) {
        setWentTo({ query, status: find.goToPosition(position.first, position.last, position.reversed === true) });
        return;
      }
      find.step(event.shiftKey ? -1 : 1);
    }
  };

  return (
    <div
      ref={anchorRef}
      className="motif-cs-find-anchor"
      style={{ '--motif-cs-find-scrollbar': `${scrollbar}px` } as CSSProperties}
    >
      <div
        ref={barRef}
        className="motif-cs-find-bar"
        role="search"
        aria-label="Find in sequence"
        // Escape belongs to the find bar while the keyboard is in it: an open
        // window's capture listener yields to this scope, so the bar closes first.
        data-motif-cs-escape-scope="true"
        data-placement={placement.edge}
        data-total={result.matches.length}
        data-capped={result.capped || undefined}
        data-current-start={current?.start}
        data-current-strand={current?.strand}
        style={placement.edge === 'bottom' ? { top: placement.top } : undefined}
        onKeyDown={handleKeyDown}
      >
        <div className="motif-cs-find-field">
          <input
            ref={inputRef}
            className="motif-cs-find-input"
            type="text"
            role="searchbox"
            name="find-in-sequence"
            aria-label="Find in sequence"
            aria-keyshortcuts="Enter Shift+Enter Escape"
            autoComplete="off"
            spellCheck={false}
            maxLength={maxLength}
            placeholder={result.bothStrands ? 'Bases or IUPAC codes' : 'Residues'}
            value={query}
            onChange={(event) => find.changeQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              className="motif-cs-find-clear"
              aria-label="Clear search"
              title="Clear search"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                inputRef.current?.focus({ preventScroll: true });
                find.changeQuery('');
              }}
            >
              <X size={14} strokeWidth={2.2} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div
          className="motif-cs-find-count"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          title={[wrapNote, label, detail].filter(Boolean).join(', ')}
        >
          <span className="motif-cs-find-count-main">
            {wrapNote ? <span className="motif-cs-visually-hidden">{wrapNote}, </span> : null}
            {wrapNote ? <span className="motif-cs-find-wrapped" aria-hidden="true">↻ </span> : null}
            {label}
          </span>
          {detail ? <span className="motif-cs-visually-hidden">, </span> : null}
          <span className="motif-cs-find-count-detail">{detail}</span>
        </div>
        <button
          type="button"
          className="motif-cs-find-step"
          aria-label="Previous match"
          title={canStep ? 'Previous match (Shift+Enter or Shift+Cmd/Ctrl+G)' : noStep}
          disabled={!canStep}
          onClick={() => find.step(-1)}
        >
          <ChevronUp size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="motif-cs-find-step"
          aria-label="Next match"
          title={canStep ? 'Next match (Enter, Cmd/Ctrl+G or F3)' : noStep}
          disabled={!canStep}
          onClick={() => find.step(1)}
        >
          <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <button type="button" className="motif-cs-find-done" title="Close find (Escape)" onClick={find.closeFind}>
          Done
        </button>
      </div>
    </div>
  );
}

type LargeFindLayerProps = {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  sequenceLength: number;
  matches: readonly FindMatch[];
  current: FindMatch | null;
};

type LargeFindGeometry = {
  top: number;
  left: number;
  width: number;
  height: number;
  scrollTop: number;
  padTop: number;
  padLeft: number;
  lineHeight: number;
  charWidth: number;
  columns: number;
};

/**
 * Find highlights for the large-record view, which is a native textarea and
 * cannot hold marks of its own. A layer over it paints only the matches on the
 * lines in view, from the textarea's own character grid (monospace, one base
 * per cell, soft-wrapped at a fixed column count).
 */
export function LargeFindLayer({ textareaRef, sequenceLength, matches, current }: LargeFindLayerProps) {
  const rulerRef = useRef<HTMLSpanElement>(null);
  const [geometry, setGeometry] = useState<LargeFindGeometry | null>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const ruler = rulerRef.current;
    if (!textarea || !ruler) return undefined;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const style = window.getComputedStyle(textarea);
      const padTop = parseFloat(style.paddingTop) || 0;
      const padLeft = parseFloat(style.paddingLeft) || 0;
      const padRight = parseFloat(style.paddingRight) || 0;
      const lineHeight = parseFloat(style.lineHeight) || 0;
      const charWidth = ruler.getBoundingClientRect().width / 100;
      if (lineHeight <= 0 || charWidth <= 0) return;
      const columns = Math.max(1, Math.floor((textarea.clientWidth - padLeft - padRight) / charWidth + 1e-6));
      setGeometry({
        top: textarea.offsetTop,
        left: textarea.offsetLeft,
        width: textarea.clientWidth,
        height: textarea.clientHeight,
        scrollTop: textarea.scrollTop,
        padTop,
        padLeft,
        lineHeight,
        charWidth,
        columns,
      });
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    measure();
    textarea.addEventListener('scroll', schedule, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(textarea);
    return () => {
      textarea.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [textareaRef]);

  const rects: { key: string; left: number; top: number; width: number; current: boolean; continued: boolean }[] = [];
  if (geometry && sequenceLength > 0) {
    const { scrollTop, padTop, padLeft, lineHeight, charWidth, columns, height } = geometry;
    const firstLine = Math.max(0, Math.floor((scrollTop - padTop) / lineHeight));
    const lastLine = Math.floor((scrollTop + height - padTop) / lineHeight);
    const low = firstLine * columns;
    const high = Math.min(sequenceLength, (lastLine + 1) * columns);
    const paint = (start: number, end: number, key: string, isCurrent: boolean, continued = false) => {
      for (let position = Math.max(start, low); position < Math.min(end, high);) {
        const line = Math.floor(position / columns);
        const segmentEnd = Math.min(end, high, (line + 1) * columns);
        rects.push({
          key: `${key}:${position}`,
          left: padLeft + (position - line * columns) * charWidth,
          top: padTop + line * lineHeight - scrollTop,
          width: (segmentEnd - position) * charWidth,
          current: isCurrent,
          continued,
        });
        position = segmentEnd;
      }
    };
    const visit = (match: FindMatch, isCurrent: boolean) => {
      const key = isCurrent ? 'current' : `${match.start}`;
      paint(match.start, Math.min(match.end, sequenceLength), key, isCurrent);
      // A match across the origin of a circular record continues at base 1.
      if (match.end > sequenceLength) paint(0, match.end - sequenceLength, `${key}:wrap`, isCurrent, true);
    };
    const length = matches.length > 0 ? matches[0].end - matches[0].start : 0;
    const first = firstMatchAtOrAfter(matches, low - length + 1);
    for (let index = first; index >= 0 && index < matches.length && matches[index].start < high; index += 1) {
      if (matches[index].start !== current?.start) visit(matches[index], false);
    }
    for (let index = matches.length - 1; index >= 0 && matches[index].end > sequenceLength; index -= 1) {
      if (matches[index].start !== current?.start && low < matches[index].end - sequenceLength) {
        paint(0, matches[index].end - sequenceLength, `${matches[index].start}:wrap`, false);
      }
    }
    if (current) visit(current, true);
  }

  return (
    <div
      className="motif-cs-find-large-layer"
      aria-hidden="true"
      style={geometry ? { top: geometry.top, left: geometry.left, width: geometry.width, height: geometry.height } : undefined}
    >
      <span ref={rulerRef} className="motif-cs-find-large-ruler">{'0'.repeat(100)}</span>
      {geometry ? rects.map((rect) => (
        <div
          key={rect.key}
          className={rect.current ? 'motif-cs-find-current motif-cs-find-large-current' : 'motif-cs-find-hit motif-cs-find-large-hit'}
          data-find-current={rect.current ? (rect.continued ? 'continued' : '') : undefined}
          style={{ left: rect.left, top: rect.top + 2, width: rect.width, height: Math.max(1, geometry.lineHeight - 4) }}
        />
      )) : null}
    </div>
  );
}
