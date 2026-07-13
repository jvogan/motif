import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MOTIF_LOCAL_CONNECTOR_NAME,
  installMotifLocalServer,
  readLocalMcpConfig,
  removeMotifLocalServer,
  updateLocalMcpConfigFile,
  writeLocalMcpConfigAtomically,
} from '../lib/motif-local-mcp-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryDirectories = [];

function temporaryConfig(initialConfig) {
  const directory = mkdtempSync(join(tmpdir(), 'motif-local-mcp-test-'));
  temporaryDirectories.push(directory);
  const configPath = join(directory, '.claude-science', 'mcp', 'local-mcp.json');
  mkdirSync(dirname(configPath), { recursive: true });
  const bytes = `${JSON.stringify(initialConfig, null, 2)}\n`;
  writeFileSync(configPath, bytes, { mode: 0o644 });
  return { directory, configPath, bytes };
}

function desiredServer() {
  return {
    name: MOTIF_LOCAL_CONNECTOR_NAME,
    command: '/bin/bash',
    args: ['/absolute/example/scripts/run-motif-claude-science-mcp.sh'],
    env: {
      MOTIF_NODE_BIN: '/absolute/example/bin/node',
      MOTIF_ROOT: '/absolute/example',
    },
  };
}

function backupFiles(configPath) {
  const prefix = `${basename(configPath)}.before-motif-local-`;
  return readdirSync(dirname(configPath))
    .filter(name => name.startsWith(prefix))
    .sort();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Motif Claude Science local connector configuration', () => {
  it('preserves unrelated servers, unknown settings, and exact backup bytes', () => {
    const unrelated = {
      name: 'unrelated-local-tool',
      command: '/absolute/unrelated/launcher',
      args: ['--stdio'],
      env: { PRIVATE_MARKER: 's3ns1t1ve-unrelated-value' },
      custom: { enabled: true },
    };
    const initial = {
      schemaVersion: 7,
      hostPreferences: { lazyConnect: true },
      servers: [unrelated],
    };
    const { configPath, bytes } = temporaryConfig(initial);
    const result = updateLocalMcpConfigFile({
      configPath,
      desired: desiredServer(),
      now: new Date('2026-07-13T20:00:00.000Z'),
      nonce: 'preservation',
    });

    expect(result.changed).toBe(true);
    expect(result.backupPath).toBeTruthy();
    expect(readFileSync(result.backupPath, 'utf8')).toBe(bytes);
    const installed = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(installed.schemaVersion).toBe(7);
    expect(installed.hostPreferences).toEqual({ lazyConnect: true });
    expect(installed.servers[0]).toEqual(unrelated);
    expect(installed.servers[1]).toEqual(desiredServer());
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect(statSync(result.backupPath).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(configPath)).mode & 0o777).toBe(0o700);
  });

  it('is byte-stable and creates no backup when registration is already current', () => {
    const { configPath } = temporaryConfig({ servers: [] });
    const first = updateLocalMcpConfigFile({
      configPath,
      desired: desiredServer(),
      now: new Date('2026-07-13T20:01:00.000Z'),
      nonce: 'first',
    });
    const installedBytes = readFileSync(configPath);
    const backupsAfterFirst = backupFiles(configPath);

    const second = updateLocalMcpConfigFile({
      configPath,
      desired: desiredServer(),
      now: new Date('2026-07-13T20:02:00.000Z'),
      nonce: 'second',
    });

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.backupPath).toBeNull();
    expect(readFileSync(configPath)).toEqual(installedBytes);
    expect(backupFiles(configPath)).toEqual(backupsAfterFirst);
    expect(readdirSync(dirname(configPath)).some(name => name.includes('.tmp-'))).toBe(false);
  });

  it('repairs only managed fields while retaining connector-local extensions', () => {
    const desired = desiredServer();
    const existing = {
      name: MOTIF_LOCAL_CONNECTOR_NAME,
      command: '/absolute/stale/command',
      args: ['/absolute/stale/launcher'],
      env: {
        MOTIF_NODE_BIN: '/absolute/stale/node',
        MOTIF_ROOT: '/absolute/stale/root',
        USER_EXTENSION: 'retain-this-value',
      },
      disabled: false,
    };
    const result = installMotifLocalServer({ servers: [existing] }, desired);
    expect(result.changed).toBe(true);
    expect(result.config.servers).toHaveLength(1);
    expect(result.config.servers[0]).toEqual({
      ...existing,
      ...desired,
      env: { ...existing.env, ...desired.env },
    });
  });

  it('removes only the managed registration', () => {
    const first = { name: 'unrelated-a', command: '/one', args: [] };
    const second = { name: 'unrelated-b', command: '/two', args: [] };
    const result = removeMotifLocalServer({
      keep: 'top-level',
      servers: [first, desiredServer(), second],
    });
    expect(result.changed).toBe(true);
    expect(result.config).toEqual({ keep: 'top-level', servers: [first, second] });
  });

  it('refuses a concurrent config change instead of clobbering it', () => {
    const { configPath } = temporaryConfig({ servers: [] });
    const document = readLocalMcpConfig(configPath);
    const concurrent = `${JSON.stringify({ servers: [{ name: 'concurrent-writer' }] }, null, 2)}\n`;
    writeFileSync(configPath, concurrent);

    expect(() => writeLocalMcpConfigAtomically(
      configPath,
      { servers: [desiredServer()] },
      document,
      { now: new Date('2026-07-13T20:03:00.000Z'), nonce: 'race' },
    )).toThrow(/changed during this operation/);
    expect(readFileSync(configPath, 'utf8')).toBe(concurrent);
    expect(backupFiles(configPath)).toHaveLength(0);
  });

  it('refuses to read or replace a symlinked config file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-local-mcp-test-'));
    temporaryDirectories.push(directory);
    const targetPath = join(directory, 'target.json');
    const configPath = join(directory, 'local-mcp.json');
    const targetBytes = `${JSON.stringify({ servers: [{ name: 'unrelated-target' }] }, null, 2)}\n`;
    writeFileSync(targetPath, targetBytes);
    symlinkSync(targetPath, configPath);

    expect(() => readLocalMcpConfig(configPath)).toThrow(/must not be a symbolic link/);
    expect(readFileSync(targetPath, 'utf8')).toBe(targetBytes);
  });

  it('does not disclose malformed JSON or config values in errors and CLI output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-local-mcp-test-'));
    temporaryDirectories.push(directory);
    const malformedPath = join(directory, 'malformed.json');
    const privateMarker = 's3ns1t1ve-malformed-marker';
    writeFileSync(malformedPath, `{ "servers": ["${privateMarker}`);
    expect(() => readLocalMcpConfig(malformedPath)).toThrow('Claude Science local MCP config is not valid JSON');
    try {
      readLocalMcpConfig(malformedPath);
    } catch (error) {
      expect(String(error)).not.toContain(privateMarker);
    }

    const configPath = join(directory, 'local-mcp.json');
    const unrelatedMarker = 's3ns1t1ve-existing-config-marker';
    writeFileSync(configPath, `${JSON.stringify({
      servers: [
        { name: 'unrelated-private-tool', command: '/private', env: { VALUE: unrelatedMarker } },
        { ...desiredServer(), env: { ...desiredServer().env, PRIVATE_VALUE: unrelatedMarker } },
      ],
    }, null, 2)}\n`);
    chmodSync(configPath, 0o600);

    const executed = spawnSync(
      process.execPath,
      [
        join(root, 'scripts', 'configure-motif-claude-science-local.mjs'),
        '--remove',
        '--dry-run',
        '--config',
        configPath,
      ],
      { encoding: 'utf8' },
    );
    expect(executed.status).toBe(0);
    expect(`${executed.stdout}\n${executed.stderr}`).not.toContain(unrelatedMarker);
    expect(JSON.parse(readFileSync(configPath, 'utf8')).servers).toHaveLength(2);
    expect(existsSync(configPath)).toBe(true);
  });
});
