import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LargeSequenceViewer } from '../LargeSequenceViewer';

describe('LargeSequenceViewer', () => {
  it('keeps the exact sequence in one browser-native read-only control', () => {
    const sequence = 'ATGC'.repeat(20_000);
    const html = renderToStaticMarkup(
      <LargeSequenceViewer sequence={sequence} threshold={50_000} />,
    );

    expect(html).toContain('Large-record density view');
    expect(html).toContain('80,000 residues exceed the 50,000-residue interactive Detail limit');
    expect(html).toContain('data-testid="large-sequence-viewer"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain(`>${sequence}</textarea>`);
  });
});
