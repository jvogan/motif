/**
 * Arrow-key movement through a list of controls that are all in the tab order
 * (the Tools list rows, the Export popover's buttons). Up and Down step to the
 * previous or next control and wrap at the ends, Home and End jump to the first
 * or last, and anything else is left to the page. Left and Right are the same as
 * Up and Down only when `horizontal` is set, for buttons laid out in a row.
 */
export type RovingFocusKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

/**
 * The index to focus next, or null when `key` does not move focus or the list is
 * empty. `current` is the focused control's index, or -1 when focus is not in the list.
 */
export function rovingFocusTarget(key: string, current: number, count: number, horizontal = false): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'ArrowRight':
      return horizontal ? rovingFocusTarget('ArrowDown', current, count) : null;
    case 'ArrowLeft':
      return horizontal ? rovingFocusTarget('ArrowUp', current, count) : null;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

type KeyEventLike = {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
};

const isVisible = (element: HTMLElement) => (
  typeof element.checkVisibility === 'function' ? element.checkVisibility() : element.getClientRects().length > 0
);

/**
 * Moves focus among `controls` for an arrow, Home or End key pressed while
 * focus is on one of them. Returns true when it moved focus. Text fields,
 * selects and text areas keep their own arrow keys, and a key with a modifier
 * is never taken.
 */
export function moveRovingFocus(
  event: KeyEventLike,
  controls: readonly HTMLElement[],
  options: { horizontal?: boolean } = {},
): boolean {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.matches !== 'function') return false;
  if (target.matches('input, select, textarea, [contenteditable="true"]')) return false;
  const list = controls.filter(isVisible);
  const current = list.indexOf(target);
  if (current < 0) return false;
  const next = rovingFocusTarget(event.key, current, list.length, options.horizontal);
  if (next === null) return false;
  event.preventDefault();
  list[next].focus({ preventScroll: false });
  return true;
}
