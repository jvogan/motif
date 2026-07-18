/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClaudeScienceConstructVerificationPanel,
  type ArtifactConstructVerificationPresentationResult,
} from '../ClaudeScienceConstructVerificationPanel';

function resultFixture(
  override: Partial<ArtifactConstructVerificationPresentationResult> = {},
): ArtifactConstructVerificationPresentationResult {
  return {
    schema: 'motif.construct-verification.v1',
    version: 1,
    state: 'consistent',
    reasons: [],
    reference: {
      id: 'predicted-plasmid',
      name: 'pTarget predicted construct',
      length: 4_812,
      topology: 'circular',
    },
    reads: [{
      id: 'read-forward-1',
      name: 'Forward read 1',
      rawLength: 720,
      meanQuality: 34.2,
      status: 'mapped',
      trim: { rawStart: 16, rawEnd: 688, trimmedLength: 672, removedFromStart: 16, removedFromEnd: 32 },
      mapping: { orientation: 'forward', referenceStart: 1, referenceEnd: 672, alignedLength: 672, identity: 1 },
    }, {
      id: 'read-forward-2',
      name: 'Forward read 2',
      rawLength: 705,
      meanQuality: 31.8,
      status: 'mapped',
      mapping: { orientation: 'forward', referenceStart: 650, referenceEnd: 1_304, alignedLength: 655, identity: 1 },
    }, {
      id: 'read-reverse-1',
      name: 'Reverse read 1',
      rawLength: 698,
      meanQuality: 33.5,
      status: 'mapped',
      mapping: { orientation: 'reverse', referenceStart: 1_270, referenceEnd: 1_910, alignedLength: 641, identity: 1 },
    }],
    coverage: {
      depth: [1, 2, 3, 2],
      forward: [1, 1, 2, 1],
      reverse: [0, 1, 1, 1],
      coveredBases: 4_812,
      basesMeetingMinDepth: 4_812,
      coveredFraction: 1,
      meanDepth: 2,
      requiredRegions: [],
    },
    consensus: { calls: [] },
    variants: { observed: [], expected: [], unexpected: [], missingExpected: [] },
    provenance: { engine: 'motif-construct-verification', engineVersion: '1' },
    ...override,
  };
}

afterEach(cleanup);

describe('ClaudeScienceConstructVerificationPanel', () => {
  it('states a consistent verdict and presents compact coverage, strand, and read facts', () => {
    render(<ClaudeScienceConstructVerificationPanel result={resultFixture()} />);

    expect(screen.getByLabelText('Construct verification: Consistent')).toBeTruthy();
    expect(screen.getByText('Consistent')).toBeTruthy();
    expect(screen.getByText('pTarget predicted construct')).toBeTruthy();
    expect(screen.getByText('3 / 3')).toBeTruthy();
    expect(screen.getByText('2 F · 1 R')).toBeTruthy();
    expect(screen.getByText('2.0×')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Reference coverage 100.0%' }).getAttribute('value')).toBe('100');
    expect(screen.getByText('No review findings were recorded for this result.')).toBeTruthy();
  });

  it('keeps findings inert, bounds their initial presentation, and filters variant evidence accessibly', async () => {
    const user = userEvent.setup();
    const malicious = '<img src=x onerror=alert(1)> needs manual review';
    const reasons = Array.from({ length: 7 }, (_, index) => ({
      code: `reason_${index + 1}`,
      severity: 'warning',
      message: index === 0 ? malicious : `Secondary reason ${index + 1}`,
      readId: `read-${index + 1}`,
    }));
    const expected = { id: 'expected-1', referenceStart: 170, type: 'substitution', reference: 'A', alternate: 'G', status: 'observed' as const, depth: 2, observedVariantId: 'observed-expected-1' };
    const observedExpected = { id: 'observed-expected-1', referenceStart: 170, type: 'substitution', reference: 'A', alternate: 'G', supportingReadIds: ['read-forward-1', 'read-forward-2'], support: 2, meanQuality: 38 };
    const unexpected = { id: 'unexpected-1', referenceStart: 420, type: 'deletion', reference: 'AT', alternate: 'A', supportingReadIds: ['read-forward-1'], support: 1, meanQuality: 31 };

    const view = render(
      <ClaudeScienceConstructVerificationPanel
        result={resultFixture({
          state: 'needs_review',
          reasons,
          variants: {
            observed: [observedExpected, unexpected],
            expected: [expected],
            unexpected: [unexpected],
            missingExpected: [],
          },
        })}
      />,
    );

    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText(malicious)).toBeTruthy();
    expect(view.container.querySelector('img')).toBeNull();
    expect(screen.getByText('Secondary reason 7').closest('details')?.open).toBe(false);
    await user.click(screen.getByText('Show 3 more findings'));
    expect(screen.getByText('Secondary reason 7').closest('details')?.open).toBe(true);

    await user.selectOptions(screen.getByLabelText('Show'), 'unexpected');
    const variantTable = screen.getByLabelText('Scrollable variant evidence table');
    expect(within(variantTable).getByText('Unexpected')).toBeTruthy();
    expect(within(variantTable).getByText('420')).toBeTruthy();
    expect(within(variantTable).queryByText('170')).toBeNull();
  });

  it('separates low-confidence unexpected evidence from supported contradictions', async () => {
    const user = userEvent.setup();
    const uncertain = {
      id: 'unexpected-low',
      referenceStart: 42,
      type: 'substitution',
      reference: 'A',
      alternate: 'G',
      confidence: 'low' as const,
      support: 1,
      meanQuality: 12,
    };
    render(
      <ClaudeScienceConstructVerificationPanel
        result={resultFixture({
          state: 'needs_review',
          variants: { observed: [uncertain], expected: [], unexpected: [uncertain], missingExpected: [] },
        })}
      />,
    );

    expect(screen.getByText('Unexpected').nextElementSibling?.textContent).toBe('0');
    await user.selectOptions(screen.getByLabelText('Show'), 'uncertain');
    expect(within(screen.getByLabelText('Scrollable variant evidence table')).getByText('Low confidence')).toBeTruthy();
  });

  it('discloses required-region and per-read evidence without exposing mutations', async () => {
    const user = userEvent.setup();
    const frozen = Object.freeze(resultFixture({
      state: 'inconsistent',
      reference: Object.freeze({ id: 'reference-1', length: 5_000, topology: 'linear' }),
      coverage: Object.freeze({
        coveredBases: 4_100,
        coveredFraction: 0.82,
        requiredRegions: Object.freeze([{
          id: 'junction-a',
          name: 'Insert–backbone junction',
          start: 1_990,
          end: 2_030,
          coveredFraction: 0.5,
          forwardCoveredBases: 20,
          reverseCoveredBases: 0,
          status: 'insufficient',
        }]),
      }),
    }));

    const view = render(
      <ClaudeScienceConstructVerificationPanel
        result={frozen}
        referenceName="Expected pTarget"
        readNames={{ 'read-forward-1': '<script>bad()</script>' }}
      />,
    );

    expect(screen.getByText('Inconsistent')).toBeTruthy();
    expect(screen.getByText('Insert–backbone junction')).toBeTruthy();
    expect(screen.getByText('Forward only')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Reference coverage 82.0%' })).toBeTruthy();

    await user.click(screen.getByText('Inspect mapped reads and quality'));
    expect(screen.getByText('<script>bad()</script>')).toBeTruthy();
    expect(view.container.querySelector('script')).toBeNull();
    expect(frozen.coverage.coveredFraction).toBe(0.82);
  });

  it('caps large variant previews while preserving the matching count', () => {
    const observed = Array.from({ length: 105 }, (_, index) => ({
      id: `variant-${index}`,
      referenceStart: index + 1,
      type: 'substitution',
      reference: 'A',
      alternate: 'C',
    }));
    render(
      <ClaudeScienceConstructVerificationPanel
        result={resultFixture({ variants: { observed, expected: [], unexpected: observed, missingExpected: [] } })}
      />,
    );

    const table = screen.getByLabelText('Scrollable variant evidence table');
    expect(within(table).getAllByRole('row')).toHaveLength(101);
    expect(screen.getByText('Showing the first 100 of 105 matching variants.')).toBeTruthy();
  });
});
