/** @vitest-environment jsdom */

import { act } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ClaudeScienceMsaViewer,
  msaRowLabelWidth,
  type ClaudeScienceMsaViewerProps,
} from '../ClaudeScienceMsaViewer';
import { normalizeArtifactAlignment } from '../claude-science-msa';
import { DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES } from '../claude-science-msa-view-preferences';

type ObservedResize = {
  callback: ResizeObserverCallback;
  element: Element;
};

const observedResizes: ObservedResize[] = [];
const animationFrames = new Map<number, FrameRequestCallback>();
let nextAnimationFrame = 1;

class StubResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    observedResizes.push({ callback: this.callback, element });
  }

  unobserve() {}
  disconnect() {}
}

function resizeElement(element: Element, width: number, height = 300): void {
  const observation = observedResizes.find((candidate) => candidate.element === element);
  if (!observation) throw new Error('Expected the matrix viewport to be observed.');
  const entry = { target: element, contentRect: { width, height } } as ResizeObserverEntry;
  observation.callback([entry], {} as ResizeObserver);
}

function measuredAlignment(id = 'resize-position-regression') {
  const reference = 'A'.repeat(1_500);
  const firstDifference = `T${reference.slice(1)}`;
  return normalizeArtifactAlignment({
    id,
    name: 'Resize position regression',
    molecule: 'dna',
    referenceRowId: 'reference',
    rows: Array.from({ length: 100 }, (_, index) => ({
      id: index === 0 ? 'reference' : `row-${index}`,
      name: index === 0 ? 'Reference' : `Row ${index}`,
      aligned: index === 1 ? firstDifference : reference,
    })),
  });
}

function renderViewer(id?: string) {
  const alignment = measuredAlignment(id);
  const props: ClaudeScienceMsaViewerProps = {
    records: [],
    alignments: [alignment],
    activeAlignmentId: alignment.id,
    viewPreferences: DEFAULT_CLAUDE_SCIENCE_MSA_VIEW_PREFERENCES,
    onActiveAlignmentChange: vi.fn(),
    onViewPreferencesChange: vi.fn(),
    onSaveAlignment: (next) => next,
    onUpdateAlignmentTemplate: () => null,
    onDeleteAlignment: vi.fn(),
    onImportRecords: async () => ({ records: [], message: '', tone: 'status' }),
    onCopy: async () => true,
    onDownload: vi.fn(),
  };
  return render(<ClaudeScienceMsaViewer {...props} />);
}

function clampMatrixScrollUntilLayout(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollLeft');
  const positions = new WeakMap<HTMLElement, number>();
  let layoutReady = false;
  Object.defineProperty(HTMLElement.prototype, 'scrollLeft', {
    configurable: true,
    get() { return positions.get(this) ?? 0; },
    set(value: number) {
      const isMatrix = this.classList.contains('motif-cs-msa-matrix-scroll');
      positions.set(this, isMatrix && !layoutReady ? 0 : Number(value));
    },
  });
  return () => {
    layoutReady = true;
    if (descriptor) Object.defineProperty(HTMLElement.prototype, 'scrollLeft', descriptor);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).scrollLeft;
  };
}

function installScrollModel(viewport: HTMLElement): void {
  Object.defineProperty(viewport, 'scrollLeft', { configurable: true, writable: true, value: 0 });
  Object.defineProperty(viewport, 'scrollTop', { configurable: true, writable: true, value: 0 });
  Object.defineProperty(viewport, 'scrollTo', {
    configurable: true,
    value: ({ left, top }: ScrollToOptions) => {
      if (typeof left === 'number') viewport.scrollLeft = left;
      if (typeof top === 'number') viewport.scrollTop = top;
      viewport.dispatchEvent(new Event('scroll'));
    },
  });
}

function flushAnimationFrames(): void {
  while (animationFrames.size > 0) {
    const pending = [...animationFrames.entries()];
    animationFrames.clear();
    for (const [, callback] of pending) callback(performance.now());
  }
}

function enableReactActEnvironment(): void {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
}

afterEach(() => {
  observedResizes.length = 0;
  animationFrames.clear();
  nextAnimationFrame = 1;
  vi.unstubAllGlobals();
  cleanup();
  vi.restoreAllMocks();
});

describe('ClaudeScienceMsaViewer resize position', () => {
  it('keeps the biological column being read in view when the matrix narrows', () => {
    enableReactActEnvironment();
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frame = nextAnimationFrame;
      nextAnimationFrame += 1;
      animationFrames.set(frame, callback);
      return frame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => animationFrames.delete(frame));
    renderViewer();
    const frame = screen.getByTestId('msa-alignment-view');
    const viewport = frame.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
    if (!viewport) throw new Error('Expected the matrix viewport.');
    installScrollModel(viewport);

    const wideWidth = 893;
    act(() => resizeElement(viewport, wideWidth));
    const cellWidth = Number.parseFloat(frame.style.getPropertyValue('--motif-cs-msa-cell-width'));
    const wideSequenceWidth = wideWidth - msaRowLabelWidth(wideWidth);

    fireEvent.pointerDown(viewport, { button: 0, clientX: -100, clientY: -100, pointerId: 7 });
    viewport.scrollLeft = 8_000;
    fireEvent.scroll(viewport);
    fireEvent.pointerUp(viewport, { button: 0, clientX: -100, clientY: -100, pointerId: 7 });
    act(() => flushAnimationFrames());
    const readingColumn = Math.floor((viewport.scrollLeft + wideSequenceWidth / 2) / cellWidth);
    expect(frame.querySelector(`[data-alignment-column="${readingColumn + 1}"]`)).not.toBeNull();

    act(() => resizeElement(viewport, 537));
    act(() => flushAnimationFrames());

    expect(viewport.scrollLeft).not.toBe(0);
    expect(frame.querySelector(`[data-alignment-column="${readingColumn + 1}"]`)).not.toBeNull();
  });

  it('retries a saved-column restore after transient layout clamping', () => {
    enableReactActEnvironment();
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frame = nextAnimationFrame;
      nextAnimationFrame += 1;
      animationFrames.set(frame, callback);
      return frame;
    });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => animationFrames.delete(frame));

    const first = renderViewer('resize-position-restore');
    const firstFrame = screen.getByTestId('msa-alignment-view');
    const firstViewport = firstFrame.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
    if (!firstViewport) throw new Error('Expected the first matrix viewport.');
    installScrollModel(firstViewport);
    act(() => resizeElement(firstViewport, 893));
    const cellWidth = Number.parseFloat(firstFrame.style.getPropertyValue('--motif-cs-msa-cell-width'));
    const sequenceWidth = 893 - msaRowLabelWidth(893);

    fireEvent.pointerDown(firstViewport, { button: 0, clientX: -100, clientY: -100, pointerId: 9 });
    firstViewport.scrollLeft = 8_000;
    fireEvent.scroll(firstViewport);
    fireEvent.pointerUp(firstViewport, { button: 0, clientX: -100, clientY: -100, pointerId: 9 });
    act(() => flushAnimationFrames());
    const readingColumn = Math.floor((8_000 + sequenceWidth / 2) / cellWidth);

    first.unmount();

    const releaseLayoutClamp = clampMatrixScrollUntilLayout();
    try {
      renderViewer('resize-position-restore');
      const restoredFrame = screen.getByTestId('msa-alignment-view');
      const restoredViewport = restoredFrame.querySelector<HTMLElement>('.motif-cs-msa-matrix-scroll');
      if (!restoredViewport) throw new Error('Expected the restored matrix viewport.');
      expect(restoredViewport.scrollLeft).toBe(0);

      releaseLayoutClamp();
      act(() => flushAnimationFrames());

      expect(restoredViewport.scrollLeft).toBeGreaterThan(0);
      expect(restoredFrame.querySelector(`[data-alignment-column="${readingColumn + 1}"]`)).not.toBeNull();
    } finally {
      releaseLayoutClamp();
    }
  });
});
