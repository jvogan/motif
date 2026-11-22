import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
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
  MAX_LOCAL_MCP_CONFIG_BYTES,
  MOTIF_LOCAL_CONNECTOR_NAME,
  desiredMotifLocalServer,
  installMotifLocalServer,
  readLocalMcpConfig,
  removeMotifLocalServer,
  resolveNodeBinary,
  updateLocalMcpConfigFile,
  writeLocalMcpConfigAtomically,
} from '../lib/motif-local-mcp-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryDirectories = [];

function temporaryConfig(initialConfig) {
  const directory = mkdtempSync(join(tmpdir(), 'motif-local-mcp-test-'));
  temporaryDirectories.push(directory);
  const configPath = join(directory, 'mcp', 'local-mcp.json');
  mkdirSync(dirname(configPath), { recursive: true });
  const bytes = `${JSON.stringify(initialConfig, null, 2)}\n`;
  writeFileSync(configPath, bytes, { mode: 0o644 });
  return { directory, configPath, bytes };
}

function desiredServer() {
  return {
    name: MOTIF_LOCAL_CONNECTOR_NAME,
    command: '/usr/bin/env',
    args: [
      '-i',
      'MOTIF_NODE_BIN=/absolute/example/bin/node',
      'MOTIF_ROOT=/absolute/example',
      'PATH=/usr/bin:/bin',
      '/bin/bash',
      '--noprofile',
      '--norc',
      '-p',
      '/absolute/example/scripts/run-motif-claude-science-mcp.sh',
    ],
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
  it('registers a fixed pre-sanitized Bash startup command', () => {
    const desired = desiredMotifLocalServer(root, { nodeBinary: process.execPath });
    expect(desired.command).toBe('/usr/bin/env');
    expect(desired.args.slice(0, 8)).toEqual([
      '-i',
      `MOTIF_NODE_BIN=${process.execPath}`,
      `MOTIF_ROOT=${root}`,
      'PATH=/usr/bin:/bin',
      '/bin/bash',
      '--noprofile',
      '--norc',
      '-p',
    ]);
    expect(desired.args.at(-1)).toBe(`${root}/scripts/run-motif-claude-science-mcp.sh`);
    expect(desired.env).toEqual({ MOTIF_NODE_BIN: process.execPath, MOTIF_ROOT: root });
  });

  it('registers the stable package path across a versioned Node upgrade', () => {
    const { directory } = temporaryConfig({ servers: [] });
    const cellar = join(directory, 'Cellar', 'node@22');
    const first = join(cellar, '22.13.0');
    const next = join(cellar, '22.14.0');
    for (const version of [first, next]) {
      mkdirSync(join(version, 'bin'), { recursive: true });
      writeFileSync(join(version, 'bin', 'node'), '', { mode: 0o755 });
    }
    const opt = join(directory, 'opt', 'node@22');
    mkdirSync(dirname(opt));
    symlinkSync(first, opt);
    const nodeBinary = resolveNodeBinary({ environment: {}, current: join(first, 'bin', 'node') });
    expect(nodeBinary).toBe(join(opt, 'bin', 'node'));

    renameSync(opt, opt + '.previous');
    symlinkSync(next, opt);
    rmSync(first, { recursive: true });
    expect(resolveNodeBinary({ environment: {}, current: join(next, 'bin', 'node') })).toBe(nodeBinary);
    expect(realpathSync(nodeBinary)).toBe(realpathSync(join(next, 'bin', 'node')));
  });

  function checkFixture({ nodeExists = true, bootstrapError } = {}) {
    const { directory } = temporaryConfig({ servers: [] });
    const checkout = realpathSync(directory);
    const nodeBinary = join(checkout, 'bin', 'node');
    const entry = desiredMotifLocalServer(checkout, { nodeBinary });
    const { configPath, bytes } = temporaryConfig({ servers: [entry] });
    const marker = join(checkout, 'registered-node-used');
    if (nodeExists) {
      mkdirSync(join(checkout, 'bin'));
      writeFileSync(nodeBinary, `#!/bin/bash\nprintf used > ${JSON.stringify(marker)}\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 });
      mkdirSync(join(checkout, 'scripts'));
      mkdirSync(join(checkout, 'dist-motif', 'claude-science'), { recursive: true });
      copyFileSync(join(root, 'scripts', 'run-motif-claude-science-mcp.sh'), entry.args.at(-1));
      chmodSync(entry.args.at(-1), 0o755);
      writeFileSync(join(checkout, 'dist-motif', 'motif-template.html'), 'fixture');
      writeFileSync(join(checkout, 'dist-motif', 'claude-science', 'motif-mcp-app.html'), 'fixture');
      const server = bootstrapError ? `console.error(${JSON.stringify(bootstrapError)}); process.exitCode = 1;` : `
        import { createInterface } from 'node:readline';
        createInterface({ input: process.stdin }).on('line', line => {
          const { id, method } = JSON.parse(line);
          if (method === 'initialize') {
            console.log(JSON.stringify({
              jsonrpc: '2.0', id,
              result: { protocolVersion: '2025-06-18', serverInfo: { name: 'motif-claude-science' } },
            }));
          }
        });
      `;
      writeFileSync(join(checkout, 'dist-motif', 'claude-science', 'motif-mcp-server.mjs'), server);
    }
    const result = spawnSync(process.execPath, [
      join(root, 'scripts', 'configure-motif-claude-science-local.mjs'), '--check', '--config', configPath,
    ], { cwd: root, encoding: 'utf8', timeout: 12_000 });
    expect(readFileSync(configPath, 'utf8')).toBe(bytes);
    expect(backupFiles(configPath)).toHaveLength(0);
    return { result, marker };
  }

  it('initializes the registered launcher and Node from a different checkout', () => {
    const { result, marker } = checkFixture();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('registered command initialized over stdio');
    expect(readFileSync(marker, 'utf8')).toBe('used');
  });

  it('reports the missing registered Node before inspecting build files', () => {
    const { result } = checkFixture({ nodeExists: false });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Registered MOTIF_NODE_BIN is missing');
  });

  it.each(['motif', 'motif-claude-science'])('reports a recognized %s bootstrap fault without exposing arbitrary stderr', (prefix) => {
    const fault = 'Motif runtime resources have missing or inconsistent build identities.';
    const { result } = checkFixture({ bootstrapError: `[${prefix}] Fatal error: ${fault}\nprivate-stderr-marker` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(fault);
    expect(result.stderr).not.toContain('private-stderr-marker');
  });

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

  it('replaces the managed environment while retaining non-environment extensions', () => {
    const desired = desiredServer();
    const existing = {
      name: MOTIF_LOCAL_CONNECTOR_NAME,
      command: '/absolute/stale/command',
      args: ['/absolute/stale/launcher'],
      env: {
        MOTIF_NODE_BIN: '/absolute/stale/node',
        MOTIF_ROOT: '/absolute/stale/root',
        NODE_OPTIONS: '--require=/untrusted/bootstrap.js',
        USER_EXTENSION: 'remove-this-value',
      },
      disabled: false,
    };
    const result = installMotifLocalServer({ servers: [existing] }, desired);
    expect(result.changed).toBe(true);
    expect(result.config.servers).toHaveLength(1);
    expect(result.config.servers[0]).toEqual({
      ...existing,
      ...desired,
      env: desired.env,
    });
  });

  it('treats every unexpected managed-entry environment key as a mismatch', () => {
    const desired = desiredServer();
    const existing = {
      ...desired,
      env: { ...desired.env, NODE_PATH: '/untrusted/modules' },
    };
    const result = installMotifLocalServer({ servers: [existing] }, desired);
    expect(result.changed).toBe(true);
    expect(result.config.servers[0].env).toEqual(desired.env);
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

  it('refuses to create a config through a symlinked parent directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-local-mcp-parent-link-test-'));
    temporaryDirectories.push(directory);
    const targetDirectory = mkdtempSync(join(tmpdir(), 'motif-local-mcp-parent-target-'));
    temporaryDirectories.push(targetDirectory);
    const linkedDirectory = join(directory, 'linked-config');
    symlinkSync(targetDirectory, linkedDirectory, 'dir');
    const configPath = join(linkedDirectory, 'local-mcp.json');

    expect(() => updateLocalMcpConfigFile({
      configPath,
      desired: desiredServer(),
    })).toThrow(/must not traverse a symbolic link/);
    expect(existsSync(join(targetDirectory, 'local-mcp.json'))).toBe(false);
  });

  it('rejects an oversized config before reading or parsing it', () => {
    const directory = mkdtempSync(join(tmpdir(), 'motif-local-mcp-size-test-'));
    temporaryDirectories.push(directory);
    const configPath = join(directory, 'local-mcp.json');
    writeFileSync(configPath, Buffer.alloc(MAX_LOCAL_MCP_CONFIG_BYTES + 1, 0x20));

    expect(() => readLocalMcpConfig(configPath)).toThrowError(expect.objectContaining({ code: 'config_too_large' }));
  });

  it('refuses a serialized install that would cross the config size limit', () => {
    const initial = {
      // Leave only enough room for the existing document; registering the
      // connector makes the serialized document larger than the reader bound.
      padding: 'x'.repeat(MAX_LOCAL_MCP_CONFIG_BYTES - 200),
      servers: [],
    };
    const { configPath, bytes } = temporaryConfig(initial);
    expect(Buffer.byteLength(bytes, 'utf8')).toBeLessThanOrEqual(MAX_LOCAL_MCP_CONFIG_BYTES);

    expect(() => updateLocalMcpConfigFile({
      configPath,
      desired: desiredServer(),
      now: new Date('2026-07-13T20:03:30.000Z'),
      nonce: 'serialized-limit',
    })).toThrowError(expect.objectContaining({
      code: 'config_too_large',
      limit: MAX_LOCAL_MCP_CONFIG_BYTES,
    }));
    expect(readFileSync(configPath, 'utf8')).toBe(bytes);
    expect(backupFiles(configPath)).toHaveLength(0);
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
