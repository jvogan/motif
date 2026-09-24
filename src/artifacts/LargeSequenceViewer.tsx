import { memo, useCallback, useEffect, useLayoutEffect, useRef } from 'react';

const numberFormatter = new Intl.NumberFormat();

// How long a native textarea selection must settle before it is reported, so
// a drag across 50,000+ residues makes one app update instead of hundreds.
export const LARGE_SEQUENCE_SELECTION_SETTLE_MS = 150;

type LargeSequenceViewerProps = {
  sequence: string;
  threshold: number;
  selectedRange: { start: number; end: number } | null;
  focusRequest: number;
  /** Receives a user's own textarea selection as [start, end) residue offsets. */
  onSelectRange?: (start: number, end: number) => void;
};

/**
 * Native density fallback for records that would otherwise create tens of
 * thousands of React nodes in the annotated, residue-addressable sequence view.
 * A textarea keeps browser-native selection/copy behavior while preserving the
 * exact sequence value (soft wrapping never inserts characters into the value).
 */
export const LargeSequenceViewer = memo(function LargeSequenceViewer({
  sequence,
  threshold,
  selectedRange,
  focusRequest,
  onSelectRange,
}: LargeSequenceViewerProps) {
  const valueRef = useRef<HTMLTextAreaElement | null>(null);
  // The range this component last put into the textarea itself, and the range
  // it last reported from a user selection. Neither may echo back: a
  // programmatic range must not be reported as the user's (it would replace a
  // selected feature with a plain range), and the app handing back the user's
  // own range must not re-centre the scroll under their pointer.
  const appliedRangeRef = useRef<{ start: number; end: number } | null>(null);
  const reportedRangeRef = useRef<{ start: number; end: number } | null>(null);
  const appliedFocusRequestRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const lengthLabel = numberFormatter.format(sequence.length);
  const thresholdLabel = numberFormatter.format(threshold);
  const selectionStart = selectedRange
    ? Math.max(0, Math.min(sequence.length, Math.trunc(selectedRange.start)))
    : null;
  const selectionEnd = selectedRange
    ? Math.max(selectionStart ?? 0, Math.min(sequence.length, Math.trunc(selectedRange.end)))
    : null;

  useLayoutEffect(() => {
    const control = valueRef.current;
    if (!control || selectionStart === null || selectionEnd === null) return undefined;
    const reported = reportedRangeRef.current;
    const focusRequested = appliedFocusRequestRef.current !== focusRequest;
    appliedFocusRequestRef.current = focusRequest;
    if (!focusRequested && reported && reported.start === selectionStart && reported.end === selectionEnd) {
      return undefined;
    }
    appliedRangeRef.current = { start: selectionStart, end: selectionEnd };
    reportedRangeRef.current = null;
    control.setSelectionRange(selectionStart, selectionEnd, 'forward');
    const frame = window.requestAnimationFrame(() => {
      const maxScroll = Math.max(0, control.scrollHeight - control.clientHeight);
      const sequenceRatio = sequence.length > 0 ? selectionStart / sequence.length : 0;
      const centeredTop = sequenceRatio * control.scrollHeight - control.clientHeight / 2;
      control.scrollTo({ top: Math.max(0, Math.min(maxScroll, centeredTop)), behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, selectionEnd, selectionStart, sequence.length]);

  useEffect(() => () => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
  }, []);

  const handleSelect = useCallback(() => {
    if (!onSelectRange) return;
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      const control = valueRef.current;
      // Only a selection the user is making in this field counts.
      if (!control || document.activeElement !== control) return;
      const start = control.selectionStart;
      const end = control.selectionEnd;
      if (end <= start) return;
      const applied = appliedRangeRef.current;
      if (applied && applied.start === start && applied.end === end) return;
      const reported = reportedRangeRef.current;
      if (reported && reported.start === start && reported.end === end) return;
      reportedRangeRef.current = { start, end };
      appliedRangeRef.current = null;
      onSelectRange(start, end);
    }, LARGE_SEQUENCE_SELECTION_SETTLE_MS);
  }, [onSelectRange]);

  return (
    <section
      className="motif-cs-large-sequence"
      aria-labelledby="motif-cs-large-sequence-title"
      data-testid="large-sequence-viewer"
    >
      <div className="motif-cs-large-sequence-notice" role="status">
        <strong id="motif-cs-large-sequence-title">Large-record density view</strong>
        <span>
          {lengthLabel} residues exceed the {thresholdLabel}-residue interactive Detail limit.
          The full sequence remains selectable here and is preserved in every export.
        </span>
        {selectionStart !== null && selectionEnd !== null ? (
          <span data-testid="large-sequence-selection">
            Selection: {numberFormatter.format(selectionStart + 1)}–{numberFormatter.format(selectionEnd)} ({numberFormatter.format(selectionEnd - selectionStart)} residues).
          </span>
        ) : null}
      </div>
      <textarea
        ref={valueRef}
        // "Skip to sequence" lands here when the record is too long for the textbox.
        id="motif-cs-sequence-view"
        className="motif-cs-large-sequence-value"
        aria-label={`Read-only full sequence, ${lengthLabel} residues`}
        data-selection-start={selectionStart ?? undefined}
        data-selection-end={selectionEnd ?? undefined}
        autoComplete="off"
        readOnly
        spellCheck={false}
        value={sequence}
        wrap="soft"
        onSelect={handleSelect}
      />
    </section>
  );
});
