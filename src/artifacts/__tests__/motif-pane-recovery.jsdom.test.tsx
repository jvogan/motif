// @vitest-environment jsdom

import { act, fireEvent, within } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactAlignmentInput } from '../claude-science-msa';
import { LARGE_SEQUENCE_DETAIL_THRESHOLD } from '../claude-science-session';
import { resizeObservers } from './motif-workbench-jsdom-setup';

const fault = vi.hoisted(() => ({ surface: '' }));
const storageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')!;
const storage = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
const getStorage = vi.fn(() => storage);

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return { ...actual, createRoot: vi.fn(actual.createRoot) };
});

vi.mock('../../plasmid-map/readable-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../plasmid-map/readable-layout')>();
  return {
    ...actual,
    computeReadableMapLayout: (...args: Parameters<typeof actual.computeReadableMapLayout>) => {
      if (fault.surface === 'map layout') throw new Error('map layout failed');
      return actual.computeReadableMapLayout(...args);
    },
  };
});

vi.mock('../../components/plasmid-map/SequenceMapView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../components/plasmid-map/SequenceMapView')>();
  return {
    ...actual,
    SequenceMapView: (props: React.ComponentProps<typeof actual.SequenceMapView>) => {
      if (fault.surface === 'map') throw new Error('map failed');
      return <actual.SequenceMapView {...props} />;
    },
  };
});

vi.mock('../LargeSequenceViewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../LargeSequenceViewer')>();
  return {
    ...actual,
    LargeSequenceViewer: (props: React.ComponentProps<typeof actual.LargeSequenceViewer>) => {
      if (fault.surface === 'large sequence') throw new Error('large sequence failed');
      return <actual.LargeSequenceViewer {...props} />;
    },
  };
});

vi.mock('../ClaudeScienceAgentResultsPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ClaudeScienceAgentResultsPanel')>();
  return {
    ...actual,
    ClaudeScienceAgentResultsPanel: (props: React.ComponentProps<typeof actual.ClaudeScienceAgentResultsPanel>) => {
      if (fault.surface === 'results') throw new Error('results failed');
      return <actual.ClaudeScienceAgentResultsPanel {...props} />;
    },
  };
});

vi.mock('../ClaudeScienceMsaViewer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ClaudeScienceMsaViewer')>();
  return {
    ...actual,
    ClaudeScienceMsaViewer: (props: React.ComponentProps<typeof actual.ClaudeScienceMsaViewer>) => {
      if (fault.surface === 'floating workspace') throw new Error('floating workspace failed');
      return <actual.ClaudeScienceMsaViewer {...props} />;
    },
  };
});

function get<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element;
}

const recordSequence = 'A'.repeat(240);
const runtime = () => window as unknown as {
  motifGetInventory: () => { seq: string }[];
  motifRenderInventory: (records: unknown[]) => void;
  motifAddAlignments: (alignment: ArtifactAlignmentInput) => number;
};

function loadRecord(seq: string) {
  act(() => runtime().motifRenderInventory([{ id: 'fixture', name: 'Fixture', molecule: 'dna', topology: 'linear', seq }]));
}

function openExport() {
  const panel = get<HTMLDetailsElement>('#motif-cs-export-panel');
  act(() => { panel.open = true; fireEvent(panel, new Event('toggle')); });
}

beforeEach(async () => {
  vi.resetModules();
  vi.mocked(createRoot).mockClear();
  resizeObservers.length = 0;
  getStorage.mockReset().mockReturnValue(storage);
  storage.setItem.mockReset();
  Object.defineProperty(window, 'localStorage', { configurable: true, get: getStorage });
  fault.surface = '';
  const root = document.createElement('div');
  root.id = 'root';
  document.body.replaceChildren(root);
  await act(async () => { await import('../motif-artifact'); });
  loadRecord(recordSequence);
});

afterEach(() => {
  const root = vi.mocked(createRoot).mock.results[0]?.value;
  if (root) act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'localStorage', storageDescriptor);
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('workbench pane failures', () => {
  it.each([
    ['map', '.motif-cs-map-column', '.motif-cs-map-frame svg'],
    ['map layout', '.motif-cs-map-column', '.motif-cs-map-frame svg'],
    ['sequence', '.motif-cs-sequence-column', '.motif-cs-sequence'],
    ['large sequence', '.motif-cs-sequence-column', '#motif-cs-sequence-view'],
    ['results', '[data-rail-tool="analysis-results"]', '[data-testid="results-elsewhere"]'],
    ['floating workspace', '[role="dialog"][aria-label="Alignment"]', '.motif-cs-window-body'],
  ])('isolates a %s failure and reloads only its pane', async (surface, pane, restored) => {
    const expectedError = surface === 'sequence' ? 'sequence failed' : `${surface} failed`;
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      if (!args.map(String).join(' ').includes(expectedError)) throw new Error(args.map(String).join(' '));
    });
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    if (surface === 'large sequence') loadRecord('A'.repeat(LARGE_SEQUENCE_DETAIL_THRESHOLD + 1));
    const notes = get<HTMLDetailsElement>('[data-rail-tool="notes"]');
    act(() => { notes.open = true; });
    const draft = notes.querySelector('textarea')!;
    fireEvent.change(draft, { target: { value: 'Keep this draft' } });

    let editedSequence = runtime().motifGetInventory()[0].seq;
    if (surface !== 'large sequence') {
      const sequence = get('.motif-cs-sequence');
      fireEvent.keyDown(sequence, { key: 'ArrowRight' });
      fireEvent.keyDown(sequence, { key: 'c' });
      fireEvent.keyDown(sequence, { key: 'ArrowRight', shiftKey: true });
      editedSequence = `C${recordSequence.slice(1)}`;
      expect(runtime().motifGetInventory()[0].seq).toBe(editedSequence);
    }
    const selection = document.querySelector('.motif-cs-selection-name')?.textContent;

    const measure = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (fault.surface === 'sequence' && this.classList.contains('motif-cs-seq-ruler')) {
        throw new Error(expectedError);
      }
      return measure.call(this);
    });
    if (surface === 'sequence') {
      // Force the detailed viewer's render/measurement path to mount again.
      const collapse = get<HTMLButtonElement>('button[aria-label="Collapse sequence pane"]');
      fireEvent.click(collapse);
    }

    fault.surface = surface;
    if (surface === 'floating workspace') {
      fireEvent.click(get('[data-testid="msa-open-button"]'));
    } else if (surface === 'sequence') {
      fireEvent.click(get('[data-pane-toggle="sequence"]'));
    } else if (surface === 'map layout') {
      const frame = get('.motif-cs-map-frame');
      const observer = resizeObservers.find(({ targets }) => targets.includes(frame))!;
      act(() => observer.callback([{ contentRect: new DOMRect(0, 0, 500, 400) } as ResizeObserverEntry], {} as ResizeObserver));
    } else {
      fireEvent.click(get('input[name="settings-theme"][value="dark"]'));
    }

    expect(document.querySelector('[data-testid="artifact-runtime-error-shell"]')).toBeNull();
    const retry = within(get(pane)).getByRole('button', { name: 'Reload this pane', hidden: true });
    await act(async () => { within(get(pane)).getByRole('button', { name: 'Copy details', hidden: true }).click(); });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining(expectedError));
    expect(notes.querySelector('textarea')).toBe(draft);
    expect(draft.value).toBe('Keep this draft');
    expect(document.querySelector('.motif-cs-selection-name')?.textContent).toBe(selection);

    openExport();
    act(() => { fireEvent.change(within(get('.motif-cs-export-body')).getByRole('combobox', { name: 'Format' }), { target: { value: 'record-sequence' } }); });
    await act(async () => { within(get('.motif-cs-export-picker-actions')).getByRole('button', { name: 'Copy' }).click(); });
    expect(writeText).toHaveBeenLastCalledWith(editedSequence);

    fault.surface = '';
    fireEvent.click(retry);
    expect(document.querySelector(restored)).not.toBeNull();
    expect(document.querySelector('[data-testid="artifact-runtime-error-shell"]')).toBeNull();
    expect(retry.isConnected).toBe(false);
    if (surface !== 'large sequence') {
      fireEvent.keyDown(get('.motif-cs-sequence'), { key: 'z', ctrlKey: true });
      expect(runtime().motifGetInventory()[0].seq).toBe(recordSequence);
    }
  });

  it('hands focus to Reload only when the broken pane held it, then back into the pane', () => {
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      const message = args.map(String).join(' ');
      if (!message.includes('results failed')) throw new Error(message);
    });
    const notes = get<HTMLDetailsElement>('[data-rail-tool="notes"]');
    const results = get<HTMLDetailsElement>('[data-rail-tool="analysis-results"]');
    act(() => { notes.open = true; results.open = true; });
    const reloadIn = () => within(results).getByRole('button', { name: 'Reload this pane', hidden: true });

    // A pane breaking elsewhere does not take focus from the user's draft.
    const draft = notes.querySelector('textarea')!;
    draft.focus();
    fault.surface = 'results';
    fireEvent.click(get('input[name="settings-theme"][value="dark"]'));
    expect(document.activeElement).toBe(draft);
    fault.surface = '';
    fireEvent.click(reloadIn());
    expect(document.activeElement).toBe(draft);

    // Focus inside the broken pane goes to Reload, then into the restored pane.
    within(results).getByRole('button', { name: 'Open Workflow results', hidden: true }).focus();
    fault.surface = 'results';
    fireEvent.click(get('input[name="settings-theme"][value="light"]'));
    expect(document.activeElement).toBe(reloadIn());
    fault.surface = '';
    fireEvent.click(reloadIn());
    expect(document.activeElement).toBe(within(results).getByRole('button', { name: 'Open Workflow results', hidden: true }));
  });

  it('keeps a map that fails again while reloading inside its own pane', () => {
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      const message = args.map(String).join(' ');
      // React's cleanup of the refused insertion also reports a missing child; the boundary catches both.
      if (!/map failed|insertion refused|not a child of this node/.test(message)) throw new Error(message);
    });
    fault.surface = 'map';
    fireEvent.click(get('input[name="settings-theme"][value="dark"]'));
    const retry = within(get('.motif-cs-map-column')).getByRole('button', { name: 'Reload this pane', hidden: true });
    fault.surface = '';
    // The remount's own DOM insertion fails once, as a page script or translator can make it do.
    const frame = get('.motif-cs-map-frame');
    let armed = true;
    for (const method of ['insertBefore', 'appendChild'] as const) {
      const original = Node.prototype[method] as (this: Node, ...args: unknown[]) => Node;
      vi.spyOn(Node.prototype, method).mockImplementation(function (this: Node, ...args: unknown[]) {
        if (armed && this instanceof Element && frame.contains(this)) {
          armed = false;
          throw new Error('insertion refused');
        }
        return original.apply(this, args);
      } as never);
    }
    fireEvent.click(retry);
    expect(armed).toBe(false);
    expect(document.querySelector('[data-testid="artifact-runtime-error-shell"]')).toBeNull();
    fireEvent.click(within(get('.motif-cs-map-column')).getByRole('button', { name: 'Reload this pane', hidden: true }));
    expect(document.querySelector('.motif-cs-map-frame svg')).not.toBeNull();
  });

  it.each(['missing', 'throwing', 'partially attached'] as const)('cleans up Export listeners with a %s observer', (observer) => {
    const observe = vi.fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => { throw new Error('Observer setup refused'); });
    const disconnect = vi.fn();
    if (observer === 'missing') vi.stubGlobal('ResizeObserver', undefined);
    else if (observer === 'throwing') vi.stubGlobal('ResizeObserver', class {
      constructor() { throw new Error('Observer setup refused'); }
    });
    else vi.stubGlobal('ResizeObserver', class {
      observe = observe;
      disconnect = disconnect;
    });
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    vi.spyOn(console, 'error').mockImplementation((...args) => {
      const message = args.map(String).join(' ');
      if (!/ResizeObserver is not a constructor|Observer setup refused/.test(message)) throw new Error(message);
    });

    openExport();
    if (observer === 'missing') {
      const panel = document.querySelector<HTMLDetailsElement>('#motif-cs-export-panel');
      if (panel) act(() => { panel.open = false; fireEvent(panel, new Event('toggle')); });
    } else {
      expect(within(get('.motif-cs-sequence-column')).getByRole('button', { name: 'Reload this pane' })).toBeTruthy();
      if (observer === 'partially attached') {
        expect(observe).toHaveBeenCalledTimes(2);
        expect(disconnect).toHaveBeenCalledTimes(1);
      }
    }

    const scroll = add.mock.calls.find(([type, , capture]) => type === 'scroll' && capture === true);
    if (scroll) {
      expect(remove).toHaveBeenCalledWith(...scroll);
      expect(remove).toHaveBeenCalledWith('resize', scroll[1]);
    }
    expect(document.querySelector('[data-testid="artifact-runtime-error-shell"]')).toBeNull();
  });
});

describe('display preference persistence', () => {
  it.each(['denied', 'full'] as const)('says nothing at load when storage is %s from the start, then speaks on a change', async (mode) => {
    act(() => vi.mocked(createRoot).mock.results[0]?.value.unmount());
    vi.mocked(createRoot).mockClear();
    if (mode === 'denied') {
      getStorage.mockImplementation(() => { throw new DOMException('', 'SecurityError'); });
    } else {
      storage.setItem.mockImplementation(() => { throw new DOMException('', 'QuotaExceededError'); });
    }
    vi.resetModules();
    const root = document.createElement('div');
    root.id = 'root';
    document.body.replaceChildren(root);
    await act(async () => { await import('../motif-artifact'); });
    const message = 'Display preferences could not be saved. Changes last until reload.';
    expect(document.querySelector('.motif-cs-workbench-notice')?.textContent).not.toBe(message);
    fireEvent.click(get('input[name="settings-theme"][value="dark"]'));
    expect(get('.motif-cs-workbench-notice').textContent).toBe(message);
  });

  it.each(['denied', 'full'] as const)('shows one notice when storage is %s and still applies preferences', (mode) => {
    if (mode === 'denied') {
      getStorage.mockImplementation(() => { throw new DOMException('', 'SecurityError'); });
    } else {
      storage.setItem.mockImplementation(() => { throw new DOMException('', 'QuotaExceededError'); });
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(get('input[name="settings-theme"][value="dark"]'));
      expect(document.documentElement.dataset.theme).toBe('dark');
      const notice = get('.motif-cs-workbench-notice');
      expect(notice.textContent).toBe('Display preferences could not be saved. Changes last until reload.');
      act(() => { vi.advanceTimersByTime(5_000); });
      expect(notice.isConnected).toBe(false);
      fireEvent.click(get('[data-pane-toggle="map"]'));
      expect(document.querySelector('.motif-cs-map-column')).toBeNull();
      fireEvent.click(get('input[name="settings-theme"][value="light"]'));
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(document.querySelector('.motif-cs-workbench-notice')).toBeNull();
      expect(runtime().motifGetInventory()[0].seq).toBe(recordSequence);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses the same notice for a failed Alignment preference write', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    act(() => {
      runtime().motifAddAlignments({
        id: 'fixture-alignment', molecule: 'dna',
        rows: [
          { id: 'reference', name: 'Reference', aligned: recordSequence },
          { id: 'query', name: 'Query', aligned: recordSequence },
        ],
      });
    });
    const dialog = within(get('[role="dialog"][aria-label="Alignment"]'));
    const textMode = dialog.getByRole('button', { name: 'Text' });
    storage.setItem.mockImplementation((key: string) => {
      if (key.includes('msa-view')) throw new DOMException('', 'QuotaExceededError');
    });
    fireEvent.click(textMode);
    expect(textMode.getAttribute('aria-pressed')).toBe('true');
    expect(get('.motif-cs-workbench-notice').textContent).toBe('Display preferences could not be saved. Changes last until reload.');
  });
});
