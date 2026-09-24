// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LARGE_SEQUENCE_SELECTION_SETTLE_MS, LargeSequenceViewer } from '../LargeSequenceViewer';

// Over 50 kb the sequence is a native textarea. Its selection used to stay
// inside the textarea: Copy and + Feature never enabled for a record that size.

const sequence = 'ATGC'.repeat(15_000);

describe('LargeSequenceViewer selection', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    Element.prototype.scrollTo = function scrollTo() {};
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('reports a settled user selection once, as [start, end) offsets', () => {
    const onSelectRange = vi.fn();
    const { container } = render(
      <LargeSequenceViewer sequence={sequence} threshold={50_000} selectedRange={null} focusRequest={0} onSelectRange={onSelectRange} />,
    );
    const textarea = container.querySelector('textarea')!;
    act(() => textarea.focus());
    // A drag reports many intermediate selections; only the settled one counts.
    for (const end of [20, 30, 49]) {
      textarea.setSelectionRange(10, end);
      fireEvent.select(textarea);
    }
    expect(onSelectRange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(LARGE_SEQUENCE_SELECTION_SETTLE_MS); });
    expect(onSelectRange).toHaveBeenCalledTimes(1);
    expect(onSelectRange).toHaveBeenCalledWith(10, 49);

    // A collapsed caret is not a range.
    textarea.setSelectionRange(12, 12);
    fireEvent.select(textarea);
    act(() => { vi.advanceTimersByTime(LARGE_SEQUENCE_SELECTION_SETTLE_MS); });
    expect(onSelectRange).toHaveBeenCalledTimes(1);
  });

  it('does not report a range the app put there, and does not re-apply the user range handed back', () => {
    const onSelectRange = vi.fn();
    const { container, rerender } = render(
      <LargeSequenceViewer sequence={sequence} threshold={50_000} selectedRange={{ start: 45_000, end: 49_000 }} focusRequest={1} onSelectRange={onSelectRange} />,
    );
    const textarea = container.querySelector('textarea')!;
    act(() => textarea.focus());
    fireEvent.select(textarea);
    act(() => { vi.advanceTimersByTime(LARGE_SEQUENCE_SELECTION_SETTLE_MS); });
    // Reporting a map feature's range would replace the selected feature with a
    // plain range.
    expect(onSelectRange).not.toHaveBeenCalled();

    textarea.setSelectionRange(100, 160);
    fireEvent.select(textarea);
    act(() => { vi.advanceTimersByTime(LARGE_SEQUENCE_SELECTION_SETTLE_MS); });
    expect(onSelectRange).toHaveBeenCalledWith(100, 160);

    const setSelectionRange = vi.spyOn(textarea, 'setSelectionRange');
    rerender(
      <LargeSequenceViewer sequence={sequence} threshold={50_000} selectedRange={{ start: 100, end: 160 }} focusRequest={1} onSelectRange={onSelectRange} />,
    );
    expect(setSelectionRange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="large-sequence-selection"]')?.textContent)
      .toBe('Selection: 101–160 (60 residues).');
  });
});
