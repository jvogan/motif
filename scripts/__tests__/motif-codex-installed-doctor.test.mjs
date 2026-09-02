import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  inspectInstalledCodexPlugin,
  installedPluginRoot,
  parseInstalledDoctorArgs,
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
  it('derives the cache marketplace segment from the exact enabled installed entry', () => {
    expect(parseInstalledPlugin(listing())).toMatchObject(plugin);
    expect(installedPluginRoot('/tmp/codex-profile', plugin)).toBe(resolve(
      '/tmp/codex-profile/plugins/cache/motif-local/motif-for-claude-science/0.3.6',
    ));
    const privateMarketplacePlugin = {
      ...plugin,
      pluginId: 'motif-for-claude-science@jacob-private.2026',
      marketplaceName: 'jacob-private.2026',
    };
    expect(parseInstalledPlugin(listing(privateMarketplacePlugin))).toMatchObject(privateMarketplacePlugin);
    expect(installedPluginRoot('/tmp/codex-profile', privateMarketplacePlugin)).toBe(resolve(
      '/tmp/codex-profile/plugins/cache/jacob-private.2026/motif-for-claude-science/0.3.6',
    ));
  });

  it('rejects absent, disabled, malformed, or internally inconsistent installed entries', () => {
    expect(() => parseInstalledPlugin(JSON.stringify({ installed: [] }))).toThrow(/not installed/u);
    expect(() => parseInstalledPlugin(listing({ enabled: false }))).toThrow(/not installed and enabled/u);
    expect(() => parseInstalledPlugin(listing({ version: '../outside' }))).toThrow(/version is missing or invalid/u);
    expect(() => parseInstalledPlugin(listing({ marketplaceName: '../outside' }))).toThrow(/marketplace name is missing or invalid/u);
    expect(() => parseInstalledPlugin(listing({ pluginId: 'motif-for-claude-science@other' }))).toThrow(/identity does not match/u);
    expect(() => installedPluginRoot('/tmp/codex-profile', {
      ...plugin,
      marketplaceName: '../outside',
    })).toThrow(/marketplace name is missing or invalid/u);
  });

  it('requires an explicit safe marketplace selector when more than one installed Motif copy exists', () => {
    const secondPlugin = {
      ...plugin,
      pluginId: 'motif-for-claude-science@team-private',
      marketplaceName: 'team-private',
    };
    const multiListing = JSON.stringify({ installed: [plugin, secondPlugin] });
    expect(() => parseInstalledPlugin(multiListing)).toThrow(/More than one Motif plugin/u);
    expect(parseInstalledPlugin(multiListing, { marketplaceName: 'team-private' })).toMatchObject(secondPlugin);
    expect(() => parseInstalledPlugin(multiListing, { marketplaceName: '../../escape' }))
      .toThrow(/Requested marketplace name is missing or invalid/u);
    expect(parseInstalledDoctorArgs(['--marketplace', 'team-private']))
      .toEqual({ marketplaceName: 'team-private', help: false });
    expect(() => parseInstalledDoctorArgs(['--marketplace', '../../escape']))
      .toThrow(/Requested marketplace name is missing or invalid/u);
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
    expect(inspectPackage).toHaveBeenCalledWith(installedPluginRoot('/tmp/codex-profile', plugin));
  });

  it('opens only the selected arbitrary marketplace cache snapshot', async () => {
    const privateMarketplacePlugin = {
      ...plugin,
      pluginId: 'motif-for-claude-science@private-team',
      marketplaceName: 'private-team',
    };
    const inspectPackage = vi.fn(async () => ({
      packageInfo: { version: '0.3.6' },
      protocol: { tools: [], resources: 0, appBytes: 0 },
    }));
    const runCodex = args => (
      args[0] === 'plugin' ? listing(privateMarketplacePlugin) : 'motif\n  enabled: true\n'
    );
    await expect(inspectInstalledCodexPlugin({
      codexHome: '/tmp/codex-profile',
      runCodex,
      inspectPackage,
    })).resolves.toMatchObject({ pluginId: privateMarketplacePlugin.pluginId });
    expect(inspectPackage).toHaveBeenCalledWith(resolve(
      '/tmp/codex-profile/plugins/cache/private-team/motif-for-claude-science/0.3.6',
    ));
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
