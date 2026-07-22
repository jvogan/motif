import { describe, expect, it } from 'vitest';

import { parseFeatures } from '../genbank-parser';

describe('GenBank feature colors', () => {
  it('uses safe strand-specific editor color qualifiers', () => {
    const features = parseFeatures([
      '     CDS             1..12',
      '                     /label="forward color"',
      '                     /ApEinfo_fwdcolor="#2EAD67"',
      '                     /ApEinfo_revcolor="#C53D4D"',
      '     CDS             complement(13..24)',
      '                     /label="reverse color"',
      '                     /apeinfo_fwdcolor="#2EAD67"',
      '                     /apeinfo_revcolor="#C53D4D"',
    ].join('\n'));

    expect(features).toHaveLength(2);
    expect(features[0]).toMatchObject({ name: 'forward color', strand: 1, color: '#2EAD67' });
    expect(features[1]).toMatchObject({ name: 'reverse color', strand: -1, color: '#C53D4D' });
    expect(features[0].metadata.ApEinfo_fwdcolor).toBe('#2EAD67');
    expect(features[1].metadata.apeinfo_revcolor).toBe('#C53D4D');
  });

  it('falls back to the feature-type palette for unsafe color qualifiers', () => {
    const [feature] = parseFeatures([
      '     CDS             1..12',
      '                     /label="unsafe color"',
      '                     /ApEinfo_fwdcolor="url(javascript:alert(1))"',
    ].join('\n'));

    expect(feature.color).toBe('#7E9BBF');
    expect(feature.metadata.ApEinfo_fwdcolor).toBe('url(javascript:alert(1))');
  });
});
