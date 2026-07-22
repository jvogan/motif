import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LargeSequenceViewer } from '../LargeSequenceViewer';

describe('LargeSequenceViewer', () => {
  it('keeps the exact sequence in one browser-native read-only control', () => {
    const sequence = 'ATGC'.repeat(20_000);
    const html = renderToStaticMarkup(
      <LargeSequenceViewer sequence={sequence} threshold={50_000} selectedRange={null} focusRequest={0} />,
    );

    expect(html).toContain('Large-record density view');
    expect(html).toContain('80,000 residues exceed the 50,000-residue interactive Detail limit');
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

    expect(html).toContain('Map selection: 60,001–62,000.');
    expect(html).toContain('data-selection-start="60000"');
    expect(html).toContain('data-selection-end="62000"');
    expect(html).toContain(`>${sequence}</textarea>`);
  });
});
