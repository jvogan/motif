import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LargeSequenceViewer } from '../LargeSequenceViewer';

describe('LargeSequenceViewer', () => {
  it('keeps the exact sequence in one browser-native read-only control', () => {
    const sequence = 'ATGC'.repeat(20_000);
    const html = renderToStaticMarkup(
      <LargeSequenceViewer sequence={sequence} threshold={50_000} selectedRange={null} focusRequest={0} />,
    );

    expect(html).toContain('Large record');
    expect(html).toContain('Tracks, complement and editing turn off above 50,000 residues. This record has 80,000.');
    expect(html).toContain('data-testid="large-sequence-viewer"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain(`>${sequence}</textarea>`);
  });

  it('reports an exact map-selected range without changing the sequence value', () => {
    const sequence = 'ATGC'.repeat(20_000);
    const html = renderToStaticMarkup(
      <LargeSequenceViewer
        sequence={sequence}
        threshold={50_000}
        selectedRange={{ start: 60_000, end: 62_000 }}
        focusRequest={1}
      />,
    );

    expect(html).toContain('Selection: 60,001–62,000 (2,000 residues).');
    expect(html).toContain('data-selection-start="60000"');
    expect(html).toContain('data-selection-end="62000"');
    expect(html).toContain(`>${sequence}</textarea>`);
  });
});
