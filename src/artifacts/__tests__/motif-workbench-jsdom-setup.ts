// Imported before '../motif-artifact' by jsdom tests that mount the whole
// workbench. The artifact renders itself into #root when its module is
// evaluated, so the root and the browser APIs jsdom lacks must exist first.

export const resizeObservers: { callback: ResizeObserverCallback; targets: Element[] }[] = [];

class StubResizeObserver {
  private readonly entry: { callback: ResizeObserverCallback; targets: Element[] };
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [] };
    resizeObservers.push(this.entry);
  }
  observe(target: Element) { this.entry.targets.push(target); }
  unobserve() {}
  disconnect() { this.entry.targets = []; }
}

class StubPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver;
if (typeof window.PointerEvent !== 'function') {
  window.PointerEvent = StubPointerEvent as unknown as typeof PointerEvent;
}
window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
Element.prototype.scrollTo = function scrollTo() {};
Element.prototype.scrollIntoView = function scrollIntoView() {};
document.elementFromPoint = () => null;

// The sequence waits for its first width measurement before building rows.
// Give the layout-free fixture a 60-base content width and a 7px character.
const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!;
Object.defineProperty(Element.prototype, 'clientWidth', {
  ...clientWidth,
  get(this: Element) {
    return this.classList.contains('motif-cs-sequence') ? 48 + 10 + 10 + 60 * 7 : clientWidth.get!.call(this);
  },
});
const getBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function measureFixtureElement(this: Element) {
  return this.classList.contains('motif-cs-seq-ruler')
    ? new DOMRect(0, 0, 700, 16)
    : getBoundingClientRect.call(this);
};

const root = document.createElement('div');
root.id = 'root';
document.body.appendChild(root);
