// @vitest-environment jsdom

/**
 * The Digest Preview dock. Its collapsed heading read "4 cuts · 4 fragments" without
 * saying which enzymes; its gel button read "Save and open gel" while one press added
 * every fragment to Inventory; and Escape did nothing on it or on Map Visibility, while
 * it closed the rail's popovers.
 */
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeMapDockPanelOnEscape, DigestPanel } from '../motif-artifact';
import { RESTRICTION_ENZYMES_FULL } from '../../bio/enzyme-data';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// One site each for five enzymes, spaced by filler no six-cutter recognises.
const FILLER = 'AT'.repeat(50);
const SEQUENCE = [FILLER, 'GAATTC', FILLER, 'GGATCC', FILLER, 'AAGCTT', FILLER, 'CTGCAG', FILLER, 'TCTAGA', FILLER].join('');

type DigestProps = ComponentProps<typeof DigestPanel>;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(overrides: Partial<DigestProps> = {}) {
  const props: DigestProps = {
    record: {
      id: 'digest-fixture',
      name: 'digest fixture',
      sequence: SEQUENCE,
      topology: 'circular',
      type: 'dna',
      features: [],
      sites: [],
      active: true,
    },
    sequenceType: 'dna',
    topology: 'circular',
    enzymeCatalog: RESTRICTION_ENZYMES_FULL,
    visibleMapEnzymes: [],
    workflowResults: [],
    onCopy: vi.fn(),
    onSave: vi.fn(() => ({ workflowResultId: 'result-1', recordCount: 3 })),
    onOpenGel: vi.fn(),
    onSelectRange: vi.fn(),
    ...overrides,
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<DigestPanel {...props} />));
  return props;
}

function details(): HTMLDetailsElement {
  return host!.querySelector('details')!;
}

function headingMeta(): HTMLElement {
  return details().querySelector<HTMLElement>(':scope > summary .motif-cs-chip')!;
}

function setEnzymes(text: string) {
  const input = details().querySelector<HTMLInputElement>('input[name="digest-enzymes"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('Digest Preview dock', () => {
  it('names the enzymes in its heading, three and then a count', () => {
    render();
    const full = headingMeta().querySelector('.motif-cs-full-label')!;
    expect(full.textContent).toBe('EcoRI · BamHI · HindIII — 3 cuts · 3 fragments');
    expect(headingMeta().title).toBe('');

    setEnzymes('EcoRI, BamHI, HindIII, PstI, XbaI');
    expect(full.textContent).toBe('EcoRI · BamHI · HindIII +2 — 5 cuts · 5 fragments');
    expect(headingMeta().title).toBe('Cut with EcoRI, BamHI, HindIII, PstI, XbaI');
    // An open panel shows the recipe itself; the names sit in their own span so the
    // open heading can drop them.
    expect(full.querySelector('.motif-cs-digest-summary-enzymes')!.textContent).toBe('EcoRI · BamHI · HindIII +2 — ');
  });

  it('counts a name that does not fit on the heading line into its "+N"', () => {
    // Measured before: the heading centred text wider than itself, and at 1280x720
    // EcoRI, the first enzyme, was cut off with nothing to say it was there. jsdom lays
    // nothing out, so stand in for a heading line with room for EcoRI and BamHI: any
    // later name wraps to the line below.
    const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')!;
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const inRow = this.parentElement?.classList.contains('motif-cs-digest-summary-names');
        return inRow && /HindIII|PstI|XbaI/.test(this.textContent ?? '') ? 14 : 0;
      },
    });
    try {
      render();
      const enzymes = () => headingMeta().querySelector<HTMLElement>('.motif-cs-digest-summary-enzymes')!;
      expect(enzymes().textContent).toBe('EcoRI · BamHI +1 — ');
      expect(enzymes().title).toBe('Cut with EcoRI, BamHI, HindIII');
      expect(headingMeta().querySelector('.motif-cs-full-label')!.textContent).toBe('EcoRI · BamHI +1 — 3 cuts · 3 fragments');

      setEnzymes('EcoRI, BamHI, HindIII, PstI, XbaI');
      expect(enzymes().textContent).toBe('EcoRI · BamHI +3 — ');
      expect(enzymes().title).toBe('Cut with EcoRI, BamHI, HindIII, PstI, XbaI');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop);
    }
  });

  it('leaves a recipe that does not resolve unnamed', () => {
    render();
    setEnzymes('NotAnEnzymeI');
    const full = headingMeta().querySelector('.motif-cs-full-label')!;
    expect(full.textContent).toBe('Check recipe');
    expect(full.querySelector('.motif-cs-digest-summary-enzymes')).toBeNull();
  });

  it('says how many records the gel button saves before it opens the gel', () => {
    const props = render();
    const save = host!.querySelector<HTMLButtonElement>('[data-testid="digest-save"]')!;
    const gel = host!.querySelector<HTMLButtonElement>('[data-testid="digest-open-gel"]')!;
    expect(save.textContent).toBe('Save 3 fragments');
    expect(gel.textContent).toBe('Save 3 fragments and open gel');

    setEnzymes('EcoRI');
    expect(save.textContent).toBe('Save linearized copy');
    expect(gel.textContent).toBe('Save linearized copy and open gel');

    setEnzymes('EcoRI, BamHI, HindIII');
    act(() => gel.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onOpenGel).toHaveBeenCalledWith('result-1');
  });

  it('closes on Escape, returns focus to its heading, and keeps the key to itself', () => {
    render();
    const panel = details();
    const summary = panel.querySelector<HTMLElement>(':scope > summary')!;
    const input = panel.querySelector<HTMLInputElement>('input[name="digest-enzymes"]')!;
    const reachedDocument = vi.fn();
    document.addEventListener('keydown', reachedDocument);
    try {
      panel.open = true;
      input.focus();
      const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      act(() => input.dispatchEvent(escape));
      expect(panel.open).toBe(false);
      expect(document.activeElement).toBe(summary);
      expect(escape.defaultPrevented).toBe(true);
      expect(reachedDocument).not.toHaveBeenCalled();

      // Closed, the key is not the panel's: it goes on to the map's own Escape.
      const next = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      act(() => summary.dispatchEvent(next));
      expect(next.defaultPrevented).toBe(false);
      expect(reachedDocument).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', reachedDocument);
    }
  });

  it('lets a search field with text in it clear on Escape before its panel closes', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(
      <details open onKeyDown={closeMapDockPanelOnEscape}>
        <summary>Map Visibility</summary>
        <input type="search" aria-label="Filter" defaultValue="Eco" />
      </details>,
    ));
    const panel = details();
    const search = panel.querySelector('input')!;
    act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(panel.open).toBe(true);
    search.value = '';
    act(() => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(panel.open).toBe(false);
  });
});
