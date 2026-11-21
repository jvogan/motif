import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';

import {
  isContextMenuKey,
  placeContextMenu,
  type ContextMenuCloseReason,
  type ContextMenuItem,
} from './claude-science-context-menu';

/**
 * The right-click menu of the sequence view and the map, drawn with the
 * selection bar's Create menu list. Pointer-opened, the list takes focus;
 * keyboard-opened, its first item does. Arrows, Home and End move, Enter or
 * Space runs an item, and Escape, Tab, an outside press, a scroll or a resize
 * closes it.
 */
export function ContextMenu({
  label,
  point,
  avoid,
  items,
  focusFirstItem,
  onClose,
}: {
  label: string;
  point: { x: number; y: number };
  /** The clicked row's top and bottom, which the menu must not cover. */
  avoid?: { top: number; bottom: number };
  items: readonly ContextMenuItem[];
  /** From the keyboard the first item takes focus; from a pointer the list does. */
  focusFirstItem: boolean;
  onClose: (reason: ContextMenuCloseReason) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];

  // Measure and place before paint, so the menu is never seen off-screen.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    menu.style.maxHeight = '';
    const place = placeContextMenu(
      point,
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      undefined,
      avoid,
    );
    menu.style.left = `${Math.round(place.left)}px`;
    menu.style.top = `${Math.round(place.top)}px`;
    menu.style.maxHeight = `${Math.floor(place.maxHeight)}px`;
  }, [point, avoid]);

  useLayoutEffect(() => {
    // A pointer-opened menu draws no focus ring around itself.
    const target = focusFirstItem ? menuItems()[0] : menuRef.current;
    target?.focus({ preventScroll: true, focusVisible: focusFirstItem } as FocusOptions);
    // Opening only: the items a later render brings must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && Boolean(menuRef.current?.contains(target));
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!inside(event.target)) onCloseRef.current('outside');
    };
    const closeOnScroll = (event: Event) => {
      if (!inside(event.target)) onCloseRef.current('scroll');
    };
    const closeOnResize = () => onCloseRef.current('resize');
    document.addEventListener('pointerdown', closeOnOutsidePress, true);
    // A right-click on a feature selects it, and the sequence view scrolls to a
    // new selection during that same render. Its scroll event arrives with the
    // next frame, so scrolling only closes the menu from the frame after that.
    let armed = false;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        armed = true;
        window.addEventListener('scroll', closeOnScroll, true);
        window.addEventListener('wheel', closeOnScroll, { capture: true, passive: true });
        window.addEventListener('resize', closeOnResize);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('pointerdown', closeOnOutsidePress, true);
      if (!armed) return;
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('wheel', closeOnScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', closeOnResize);
    };
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = menuItems();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (next: number) => {
      event.preventDefault();
      list[(next + list.length) % list.length]?.focus({ preventScroll: true });
    };
    if (event.key === 'ArrowDown') focusAt(index + 1);
    else if (event.key === 'ArrowUp') focusAt(index < 0 ? list.length - 1 : index - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(list.length - 1);
    else if (event.key === 'Escape') {
      // Stop here: the workbench's own Escape would also clear the selection
      // the menu acts on, and a floating window would close.
      event.preventDefault();
      event.stopPropagation();
      onClose('escape');
    } else if (event.key === 'Tab') {
      event.preventDefault();
      onClose('tab');
    } else if (isContextMenuKey(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  return (
    <div
      ref={menuRef}
      className="motif-cs-action-menu-list motif-cs-context-menu"
      role="menu"
      aria-label={label}
      tabIndex={-1}
      data-motif-cs-escape-scope="true"
      style={{ left: point.x, top: point.y }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => event.preventDefault()}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && !event.currentTarget.contains(next)) onClose('blur');
      }}
    >
      {items.flatMap((item) => {
        const disabled = item.disabledReason !== undefined;
        const entry = (
          <button
            key={item.id}
            className="motif-cs-action-menu-item motif-cs-context-menu-item"
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-context-action={item.id}
            aria-disabled={disabled || undefined}
            aria-keyshortcuts={item.shortcut?.aria}
            title={item.disabledReason ?? item.title}
            onClick={() => {
              if (disabled) return;
              onClose('item');
              item.onSelect();
            }}
          >
            <span className="motif-cs-action-menu-label">{item.label}</span>
            {item.shortcut ? (
              <kbd className="motif-cs-context-menu-shortcut" aria-hidden="true">{item.shortcut.text}</kbd>
            ) : null}
          </button>
        );
        return item.separatorBefore
          ? [<div key={`${item.id}-separator`} className="motif-cs-action-menu-separator" role="separator" />, entry]
          : [entry];
      })}
    </div>
  );
}

