import { memo, useLayoutEffect, useRef } from 'react';

const numberFormatter = new Intl.NumberFormat();

type LargeSequenceViewerProps = {
  sequence: string;
  threshold: number;
  selectedRange: { start: number; end: number } | null;
  focusRequest: number;
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
}: LargeSequenceViewerProps) {
  const valueRef = useRef<HTMLTextAreaElement | null>(null);
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
    control.setSelectionRange(selectionStart, selectionEnd, 'forward');
    const frame = window.requestAnimationFrame(() => {
      const maxScroll = Math.max(0, control.scrollHeight - control.clientHeight);
      const sequenceRatio = sequence.length > 0 ? selectionStart / sequence.length : 0;
      const centeredTop = sequenceRatio * control.scrollHeight - control.clientHeight / 2;
      control.scrollTo({ top: Math.max(0, Math.min(maxScroll, centeredTop)), behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRequest, selectionEnd, selectionStart, sequence.length]);

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
            Map selection: {numberFormatter.format(selectionStart + 1)}–{numberFormatter.format(selectionEnd)}.
          </span>
        ) : null}
      </div>
      <textarea
        ref={valueRef}
        className="motif-cs-large-sequence-value"
        aria-label={`Read-only full sequence, ${lengthLabel} residues`}
        data-selection-start={selectionStart ?? undefined}
        data-selection-end={selectionEnd ?? undefined}
        autoComplete="off"
        readOnly
        spellCheck={false}
        value={sequence}
        wrap="soft"
      />
    </section>
  );
});
