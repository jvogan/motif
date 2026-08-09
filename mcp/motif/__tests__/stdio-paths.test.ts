import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { artifactTemplateCandidates, inferredConnectorRoot, trustedConfiguredRoot } from '../stdio-paths';

describe('MCP stdio packaged paths', () => {
  it('infers roots for source, release, and packaged plugin layouts', () => {
    expect(inferredConnectorRoot('/checkout/mcp/motif')).toBe(resolve('/checkout'));
    expect(inferredConnectorRoot('/release/dist-motif/claude-science')).toBe(resolve('/release'));
    expect(inferredConnectorRoot('/plugin/server')).toBe(resolve('/plugin'));
  });

  it('rejects a configured root that names another checkout', () => {
    expect(() => trustedConfiguredRoot('/other-checkout', '/current-checkout'))
      .toThrow(/MOTIF_ROOT must resolve to this connector root/);
  });

  it('accepts a configured root that is the inferred checkout', () => {
    expect(trustedConfiguredRoot('/current-checkout', '/current-checkout'))
      .toBe(resolve('/current-checkout'));
  });

  it('resolves the skill resource after omitting the duplicate server template', () => {
    const moduleDirectory = '/plugin/server';
    const candidates = artifactTemplateCandidates(moduleDirectory, undefined, '/plugin');

    expect(candidates).toEqual([
      resolve(moduleDirectory, 'motif-template.html'),
      resolve(moduleDirectory, '../skills/motif-for-claude-science/resources/motif-artifact.html'),
      resolve('/plugin', 'dist-motif/motif-template.html'),
    ]);
  });

  it('keeps an explicit development root first', () => {
    const candidates = artifactTemplateCandidates('/dist-motif/claude-science', '/checkout', '/dist-motif');

    expect(candidates[0]).toBe(resolve('/checkout', 'dist-motif/motif-template.html'));
    expect(candidates).toContain(resolve('/dist-motif/claude-science', 'motif-template.html'));
    expect(candidates).toContain(resolve('/dist-motif', 'dist-motif/motif-template.html'));
  });

  it('deduplicates configured and inferred roots that resolve to the same path', () => {
    const candidates = artifactTemplateCandidates('/plugin/server', '/plugin', '/plugin');

    expect(candidates).toEqual([
      resolve('/plugin', 'dist-motif/motif-template.html'),
      resolve('/plugin/server', 'motif-template.html'),
      resolve('/plugin/server', '../skills/motif-for-claude-science/resources/motif-artifact.html'),
    ]);
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});
