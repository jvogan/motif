/** @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClaudeScienceFreshnessBadge,
  scientificFreshnessReasonText,
  scientificFreshnessSummary,
} from '../ClaudeScienceFreshnessBadge';

afterEach(cleanup);

describe('ClaudeScienceFreshnessBadge', () => {
  it('states freshness in text instead of relying on color', () => {
    render(<ClaudeScienceFreshnessBadge evaluation={{ state: 'fresh', reasons: [] }} />);
    const badge = screen.getByText('Fresh');
    expect(badge.getAttribute('aria-label')).toContain('Saved inputs match');
    expect(badge.closest('[data-freshness]')?.getAttribute('data-freshness')).toBe('fresh');
  });

  it('names the affected record and summarizes additional reasons', () => {
    render(
      <ClaudeScienceFreshnessBadge
        evaluation={{
          state: 'stale',
          reasons: [
            { code: 'sequence_changed', recordId: 'vector' },
            { code: 'topology_changed', recordId: 'vector' },
          ],
        }}
        recordNames={{ vector: 'pUC19' }}
        showReason
      />,
    );
    expect(screen.getByText('Stale')).toBeTruthy();
    expect(screen.getByText(/pUC19's sequence has changed/).textContent).toContain('1 more issue');
  });

  it('provides stable fallbacks for unverified and future reason codes', () => {
    expect(scientificFreshnessSummary({ state: 'unverified', reasons: [] })).toContain('identity is incomplete');
    expect(scientificFreshnessReasonText({ code: 'future_reason', field: 'source' })).toBe('Future reason (source).');
  });
});
