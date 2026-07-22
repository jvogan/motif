import { describe, expect, it } from 'vitest';

import { stampMotifBuildIdentity } from '../motif-build-identity.mjs';

describe('Motif build identity', () => {
  it('stamps a deterministic hash of the unstamped runtime template', () => {
    const template = '<!doctype html><meta name="motif-build-id" content="__MOTIF_BUILD_ID__"><main>Motif</main>';
    const first = stampMotifBuildIdentity(template);
    const second = stampMotifBuildIdentity(template);

    expect(first.runtimeBuildId).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).toEqual(second);
    expect(first.html).toContain(`content="${first.runtimeBuildId}"`);
    expect(first.html).not.toContain('__MOTIF_BUILD_ID__');
  });

  it('rejects HTML without the build identity marker', () => {
    expect(() => stampMotifBuildIdentity('<!doctype html><main>Motif</main>'))
      .toThrow('missing its build identity marker');
  });
});
