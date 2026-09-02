import { describe, expect, it } from 'vitest';
import {
  checkProductLanguage,
  productLanguageViolations,
} from '../check-product-language.mjs';

describe('public product language', () => {
  it('keeps the checked-in product surfaces capability-led', () => {
    expect(checkProductLanguage()).toEqual([]);
  });

  it.each([
    ['Do not use Motif for retrieval.', 'blanket prohibition'],
    ['Records must be supplied by the user.', 'user-supplied input requirement'],
    ['Motif does not retrieve accessions.', 'retrieval prohibition'],
    ['Motif cannot run alignments.', 'alignment prohibition'],
    ['/Users/example/motif-private', 'private filesystem path'],
    ['Portal validation pending.', 'portal readiness metadata'],
  ])('rejects %s', (text, label) => {
    expect(productLanguageViolations('fixture.md', text)).toContain(`fixture.md: ${label}`);
  });
});
