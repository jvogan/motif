/**
 * The right-click menu of the sequence view and the map: one list, the same
 * look as the selection bar's Create menu, for a range or a base and for a
 * feature. It offers only actions the workbench already has.
 */

export type ContextMenuItem = {
  id: string;
  label: string;
  /** The key that runs the same action, as printed and as `aria-keyshortcuts`. */
  shortcut?: { text: string; aria: string };
  /** Set when the item cannot run: why, and what to do instead. */
  disabledReason?: string;
  /** What an item that can run will do. */
  title?: string;
  separatorBefore?: boolean;
  onSelect: () => void;
};

/** How the menu closed. The first three hand focus back to where it was. */
export type ContextMenuCloseReason = 'escape' | 'tab' | 'item' | 'outside' | 'scroll' | 'resize' | 'blur';

export function returnsFocus(reason: ContextMenuCloseReason): boolean {
  return reason === 'escape' || reason === 'tab' || reason === 'item';
}

const MARGIN = 8;

/**
 * Where a menu of `size` opened at `point` goes: right of and below the point,
 * and to its left or above it when that side would leave the viewport. It
 * always ends at least `margin` inside the viewport, and a menu taller than
 * the viewport is capped there and scrolls.
 */
export function placeContextMenu(
  point: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = MARGIN,
  avoid?: { top: number; bottom: number },
): { left: number; top: number; maxHeight: number } {
  // A menu from a sequence row never covers that row: it opens under the row,
  // or over it when there is less room below, at the pointer's x, clamped.
  if (avoid) {
    const below = viewport.height - margin - avoid.bottom;
    const above = avoid.top - margin;
    const down = size.height <= below || below >= above;
    const room = Math.max(0, down ? below : above);
    const menuWidth = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
    return {
      left: Math.min(Math.max(margin, point.x), Math.max(margin, viewport.width - menuWidth - margin)),
      top: down ? avoid.bottom : avoid.top - Math.min(size.height, room),
      maxHeight: room,
    };
  }
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const height = Math.min(size.height, maxHeight);
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const left = point.x + width <= viewport.width - margin ? point.x : point.x - width;
  const top = point.y + height <= viewport.height - margin ? point.y : point.y - height;
  return {
    left: Math.min(Math.max(margin, left), Math.max(margin, viewport.width - width - margin)),
    top: Math.min(Math.max(margin, top), Math.max(margin, viewport.height - height - margin)),
    maxHeight,
  };
}

/** Text fields keep the browser's own menu (spelling, paste, look up). */
export function keepsNativeContextMenu(target: Element | null): boolean {
  if (!target) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return Boolean(target.closest('[contenteditable=""], [contenteditable="true"]'));
}

/** Shift+F10 and the Menu key, the keyboard's way to open a context menu. */
export function isContextMenuKey(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>): boolean {
  if (event.key === 'ContextMenu') return true;
  return event.key === 'F10' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
}

/**
 * The screen point of base `index` in the sequence view, for a menu opened from
 * the keyboard: the bottom-left corner of that base when it is in view, and
 * otherwise a point just inside the view's top-left corner.
 */
function glyphRect(text: Node, offset: number): { left: number; top: number; bottom: number } {
  const range = document.createRange();
  range.setStart(text, offset);
  range.setEnd(text, offset + 1);
  return range.getBoundingClientRect();
}

function lineFractionRect(line: HTMLElement, fraction: number): { left: number; top: number; bottom: number } {
  const box = line.getBoundingClientRect();
  return { left: box.left + fraction * box.width, top: box.top, bottom: box.bottom };
}

/**
 * Where a feature's menu opens from the keyboard: under a feature bar's left
 * edge, or on a map feature's outer edge a quarter of the way along its outline
 * (the middle of the box can fall in the middle of a ring, off the feature).
 */
export function featureMenuPoint(feature: Element): { x: number; y: number } {
  const box = feature.getBoundingClientRect();
  const body = feature.querySelector<SVGGeometryElement>('.motif-pm-feature-body');
  const matrix = body?.getScreenCTM?.();
  if (body && matrix && typeof body.getTotalLength === 'function') {
    const length = body.getTotalLength();
    if (length > 0) {
      const p = body.getPointAtLength(length / 4);
      return { x: p.x * matrix.a + p.y * matrix.c + matrix.e, y: p.x * matrix.b + p.y * matrix.d + matrix.f };
    }
  }
  if (feature instanceof HTMLElement) return { x: box.left, y: box.bottom };
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

export function sequenceBasePoint(view: HTMLElement, index: number | null): { x: number; y: number } {
  const box = view.getBoundingClientRect();
  const fallback = { x: box.left + 16, y: box.top + 16 };
  if (index === null) return fallback;
  for (const line of view.querySelectorAll<HTMLElement>('.motif-cs-seq-bases[data-line-start]')) {
    const start = Number(line.dataset.lineStart);
    const length = Number(line.dataset.lineLen);
    if (!(index >= start && index < start + length)) continue;
    const glyphs = line.querySelector('.motif-cs-seq-glyphs');
    const text = glyphs ? [...glyphs.childNodes].find((node) => node.nodeType === 3) : undefined;
    const rect = text && (text.textContent?.length ?? 0) >= index - start + 1
      ? glyphRect(text, index - start)
      : lineFractionRect(line, (index - start) / Math.max(1, length));
    if (rect.bottom <= box.top || rect.top >= box.bottom || rect.left < box.left || rect.left >= box.right) return fallback;
    return { x: rect.left, y: rect.bottom };
  }
  return fallback;
}

export type SelectionMenuState = {
  /** What was right-clicked: the bases of the sequence view, or a feature. */
  target: 'sequence' | 'feature';
  mac: boolean;
  nucleotide: boolean;
  /** Why Copy cannot run; undefined when it can. */
  copyBlocked?: string;
  /** Why Copy reverse complement cannot run; undefined when it can. */
  reverseComplementBlocked?: string;
  /** Why Translate cannot run; undefined when it can. */
  translateBlocked?: string;
  /** Whether Translate opens on the selection or on the whole sequence. */
  translateScope: 'selection' | 'record';
  /** Why Add feature cannot run; undefined when it can. */
  addFeatureBlocked?: string;
};

export type SelectionMenuActions = {
  copy: () => void;
  copyReverseComplement: () => void;
  translate: () => void;
  addFeature: () => void;
  editFeature: () => void;
};

/**
 * The items for a range or a base, and for a feature. Copy, Copy reverse
 * complement and Translate act on the selection; a protein record has no
 * strand actions, so it gets no entries for them.
 */
export function selectionMenuItems(state: SelectionMenuState, actions: SelectionMenuActions): ContextMenuItem[] {
  const feature = state.target === 'feature';
  const items: ContextMenuItem[] = [
    {
      id: 'copy',
      label: 'Copy',
      shortcut: state.mac ? { text: '⌘C', aria: 'Meta+C' } : { text: 'Ctrl+C', aria: 'Control+C' },
      disabledReason: state.copyBlocked,
      title: feature ? 'Copy the feature’s sequence' : 'Copy the selection',
      onSelect: actions.copy,
    },
  ];
  if (state.nucleotide) {
    items.push({
      id: 'copy-reverse-complement',
      label: 'Copy reverse complement',
      disabledReason: state.reverseComplementBlocked,
      title: feature ? 'Copy the opposite strand of the feature, 5′ to 3′' : 'Copy the opposite strand of the selection, 5′ to 3′',
      onSelect: actions.copyReverseComplement,
    }, {
      id: 'translate',
      label: 'Translate',
      disabledReason: state.translateBlocked,
      title: state.translateScope === 'record'
        ? 'Open the Translation window on the whole sequence'
        : feature ? 'Open the Translation window on this feature' : 'Open the Translation window on this selection',
      onSelect: actions.translate,
    });
  }
  items.push(feature
    ? {
      id: 'edit-feature',
      label: 'Edit feature',
      separatorBefore: true,
      title: 'Edit this feature in Annotations',
      onSelect: actions.editFeature,
    }
    : {
      id: 'add-feature',
      label: 'Add feature',
      separatorBefore: true,
      disabledReason: state.addFeatureBlocked,
      title: 'Add a feature on this range',
      onSelect: actions.addFeature,
    });
  return items;
}

/** What the sequence view asks for on a right-click. */
export type SequenceContextMenuRequest = {
  target: 'sequence' | 'feature';
  featureId?: string;
  point: { x: number; y: number };
  /** The clicked row's top and bottom, which the menu must not cover. */
  avoid?: { top: number; bottom: number };
  /** The element the press focused, which takes focus back when the menu closes. */
  origin: Element | null;
};
