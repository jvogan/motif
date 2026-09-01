import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  inspectInstalledCodexPlugin,
  installedPluginRoot,
  parseInstalledPlugin,
} from '../doctor-motif-codex-installed.mjs';

const plugin = {
  pluginId: 'motif-for-claude-science@motif-local',
  name: 'motif-for-claude-science',
  marketplaceName: 'motif-local',
  version: '0.3.6',
  installed: true,
  enabled: true,
};

function listing(overrides = {}) {
  return JSON.stringify({ installed: [{ ...plugin, ...overrides }], available: [] });
}

describe('installed Motif Codex plugin doctor', () => {
  it('resolves the exact enabled private plugin and its bounded cache path', () => {
    expect(parseInstalledPlugin(listing())).toMatchObject(plugin);
    expect(installedPluginRoot('/tmp/codex-profile', '0.3.6')).toBe(resolve(
      '/tmp/codex-profile/plugins/cache/motif-local/motif-for-claude-science/0.3.6',
    ));
  });

  it('rejects absent, disabled, and malformed installed entries', () => {
    expect(() => parseInstalledPlugin(JSON.stringify({ installed: [] }))).toThrow(/not installed/u);
    expect(() => parseInstalledPlugin(listing({ enabled: false }))).toThrow(/not installed and enabled/u);
    expect(() => parseInstalledPlugin(listing({ version: '../outside' }))).toThrow(/version is missing or invalid/u);
  });

  it('checks Codex MCP aggregation before exercising the installed package', async () => {
    const inspectPackage = vi.fn(async () => ({
      packageInfo: { version: '0.3.6' },
      protocol: {
        tools: ['motif_create_workbench_artifact', 'motif_open_workbench'],
        resources: 1,
        appBytes: 2048,
      },
    }));
    const runCodex = vi.fn(args => (
      args[0] === 'plugin' ? listing() : 'motif\n  enabled: true\n  transport: stdio\n'
    ));
    const result = await inspectInstalledCodexPlugin({
      codexHome: '/tmp/codex-profile',
      runCodex,
      inspectPackage,
    });
    expect(result).toMatchObject({
      pluginId: 'motif-for-claude-science@motif-local',
      version: '0.3.6',
      tools: ['motif_create_workbench_artifact', 'motif_open_workbench'],
      resources: 1,
    });
    expect(runCodex).toHaveBeenCalledWith(['mcp', 'get', 'motif']);
    expect(inspectPackage).toHaveBeenCalledWith(installedPluginRoot('/tmp/codex-profile', '0.3.6'));
  });

  it('fails before starting the package when the aggregated MCP entry is disabled', async () => {
    const inspectPackage = vi.fn();
    const runCodex = args => (
      args[0] === 'plugin' ? listing() : 'motif\n  enabled: false\n'
    );
    await expect(inspectInstalledCodexPlugin({
      codexHome: '/tmp/codex-profile',
      runCodex,
      inspectPackage,
    })).rejects.toThrow(/MCP server is not enabled/u);
    expect(inspectPackage).not.toHaveBeenCalled();
  });
});
