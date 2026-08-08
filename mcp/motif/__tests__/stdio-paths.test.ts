import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { artifactTemplateCandidates } from '../stdio-paths';

describe('MCP stdio packaged paths', () => {
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
