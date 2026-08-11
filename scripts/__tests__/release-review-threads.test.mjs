import { describe, expect, it } from 'vitest';
import { checkReleaseReviewThreads } from '../check-release-review-threads.mjs';

describe('release review-thread check', () => {
  it('passes resolved and outdated threads for a release-labeled pull request', () => {
    expect(checkReleaseReviewThreads({
      pullRequest: {
        number: 35,
        labels: [{ name: 'release' }],
        reviewThreads: [
          { isResolved: true, isOutdated: false },
          { isResolved: false, isOutdated: true },
        ],
      },
    }, { requireRelease: true })).toMatchObject({
      pullRequestNumber: 35,
      threadCount: 2,
      unresolvedCurrent: 0,
    });
  });

  it('fails closed for an unresolved current thread', () => {
    expect(() => checkReleaseReviewThreads({
      pullRequest: {
        labels: [{ name: 'release' }],
        reviewThreads: [{ isResolved: false, isOutdated: false }],
      },
    }, { requireRelease: true })).toThrow(/unresolved current review thread/u);
  });

  it('accepts an explicit release branch and rejects an unrelated pull request', () => {
    expect(checkReleaseReviewThreads({
      pullRequest: {
        number: 36,
        headRefName: 'release/0.3.5',
        labels: [],
        reviewThreads: [],
      },
    }, { requireRelease: true })).toMatchObject({ threadCount: 0 });

    expect(() => checkReleaseReviewThreads({
      pullRequest: { labels: [], reviewThreads: [] },
    }, { requireRelease: true })).toThrow(/release\/ branch or release label/u);
  });
});
