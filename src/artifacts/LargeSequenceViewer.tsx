import { memo } from 'react';

const numberFormatter = new Intl.NumberFormat();

type LargeSequenceViewerProps = {
  sequence: string;
  threshold: number;
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
}: LargeSequenceViewerProps) {
  const lengthLabel = numberFormatter.format(sequence.length);
  const thresholdLabel = numberFormatter.format(threshold);

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
      </div>
      <textarea
        className="motif-cs-large-sequence-value"
        aria-label={`Read-only full sequence, ${lengthLabel} residues`}
        autoComplete="off"
        readOnly
        spellCheck={false}
        value={sequence}
        wrap="soft"
      />
    </section>
  );
});
