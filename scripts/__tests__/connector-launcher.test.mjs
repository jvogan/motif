import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('connector launcher', () => {
  function runConfiguredLauncher(launcher, bundle, nodeBinary, environment) {
    return spawnSync('/usr/bin/env', [
      '-i',
      `MOTIF_NODE_BIN=${nodeBinary}`,
      `MOTIF_ROOT=${realpathSync(bundle)}`,
      'PATH=/usr/bin:/bin',
      '/bin/bash',
      '--noprofile',
      '--norc',
      '-p',
      launcher,
    ], {
      encoding: 'utf8',
      env: environment,
    });
  }

  it('quotes an absolute Node.js path during both version probing and execution', () => {
    const bundle = mkdtempSync(join(tmpdir(), 'motif connector launcher '));
    temporaryDirectories.push(bundle);
    mkdirSync(join(bundle, 'scripts'), { recursive: true });
    mkdirSync(join(bundle, 'dist-motif', 'claude-science'), { recursive: true });
    mkdirSync(join(bundle, 'bin with spaces'), { recursive: true });
    const launcher = join(bundle, 'scripts', 'run-motif-claude-science-mcp.sh');
    const server = join(bundle, 'dist-motif', 'claude-science', 'motif-mcp-server.mjs');
    const nodeBinary = join(bundle, 'bin with spaces', 'node');
    cpSync(join(root, 'scripts', 'run-motif-claude-science-mcp.sh'), launcher);
    writeFileSync(server, 'server fixture\n');
    writeFileSync(join(bundle, 'dist-motif', 'claude-science', 'motif-mcp-app.html'), 'app fixture\n');
    writeFileSync(join(bundle, 'dist-motif', 'motif-template.html'), 'template fixture\n');
    writeFileSync(nodeBinary, '#!/usr/bin/env bash\nif [[ "$1" == "-p" ]]; then printf "1\\n"; else printf "%s\\n" "$1"; fi\n');
    chmodSync(launcher, 0o755);
    chmodSync(nodeBinary, 0o755);

    const result = runConfiguredLauncher(launcher, bundle, nodeBinary, {
      PATH: '/tmp/untrusted-path',
      MOTIF_NODE_BIN: '/tmp/untrusted-node',
      MOTIF_ROOT: '/tmp/untrusted-root',
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(join(realpathSync(bundle), 'dist-motif', 'claude-science', 'motif-mcp-server.mjs'));
  });

  it('clears injected Node, proxy, agent, and credential variables before probing and execution', () => {
    const bundle = mkdtempSync(join(tmpdir(), 'motif connector env '));
    temporaryDirectories.push(bundle);
    mkdirSync(join(bundle, 'scripts'), { recursive: true });
    mkdirSync(join(bundle, 'dist-motif', 'claude-science'), { recursive: true });
    const launcher = join(bundle, 'scripts', 'run-motif-claude-science-mcp.sh');
    const server = join(bundle, 'dist-motif', 'claude-science', 'motif-mcp-server.mjs');
    const observed = join(bundle, 'observed-env.json');
    const marker = join(bundle, 'injection-ran');
    const nodeInjection = join(bundle, 'node-injection.cjs');
    const bashEnv = join(bundle, 'bash-env.sh');
    const envStartup = join(bundle, 'env-startup.sh');
    cpSync(join(root, 'scripts', 'run-motif-claude-science-mcp.sh'), launcher);
    writeFileSync(server, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(observed)}, JSON.stringify(process.env));\n`);
    writeFileSync(nodeInjection, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'node');\n`);
    writeFileSync(bashEnv, `printf bash-env > ${JSON.stringify(marker)}\n`);
    writeFileSync(envStartup, `printf env-startup > ${JSON.stringify(marker)}\n`);
    writeFileSync(join(bundle, 'dist-motif', 'claude-science', 'motif-mcp-app.html'), 'app fixture\n');
    writeFileSync(join(bundle, 'dist-motif', 'motif-template.html'), 'template fixture\n');
    chmodSync(launcher, 0o755);

    const result = runConfiguredLauncher(launcher, bundle, process.execPath, {
      PATH: '/tmp/untrusted-path',
      HOME: process.env.HOME ?? '',
      MOTIF_NODE_BIN: '/tmp/untrusted-node',
      MOTIF_ROOT: '/tmp/untrusted-root',
      MOTIF_MCP_TRACE: 'true',
      BASH_ENV: bashEnv,
      ENV: envStartup,
      'BASH_FUNC_cd%%': `() { printf function > ${JSON.stringify(marker)}; }`,
      NODE_OPTIONS: '--require=' + nodeInjection,
      NODE_PATH: '/tmp/injected-node-path',
      NODE_NO_WARNINGS: '1',
      HTTP_PROXY: 'http://proxy.invalid:8080',
      HTTPS_PROXY: 'https://proxy.invalid:8443',
      ALL_PROXY: 'socks5://proxy.invalid:1080',
      NO_PROXY: 'localhost',
      http_proxy: 'http://lower-proxy.invalid:8080',
      https_proxy: 'https://lower-proxy.invalid:8443',
      all_proxy: 'socks5://lower-proxy.invalid:1080',
      no_proxy: 'localhost',
      SSH_AUTH_SOCK: '/tmp/injected-agent.sock',
      AWS_ACCESS_KEY_ID: 'injected-access-key',
      AWS_SECRET_ACCESS_KEY: 'injected-secret-key',
      GIT_SSH_COMMAND: 'injected-ssh',
      GH_TOKEN: 'injected-token',
    });
    expect(result.status).toBe(0);
    expect(() => readFileSync(marker)).toThrow();
    const environment = JSON.parse(readFileSync(observed, 'utf8'));
    for (const variable of [
      'BASH_ENV', 'ENV', 'BASH_FUNC_cd%%',
      'NODE_OPTIONS', 'NODE_PATH', 'NODE_NO_WARNINGS',
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
      'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
      'SSH_AUTH_SOCK', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'GIT_SSH_COMMAND',
      'GH_TOKEN',
    ]) expect(environment[variable]).toBeUndefined();
    expect(environment.MOTIF_ROOT).toBe(realpathSync(bundle));
    expect(environment.MOTIF_NODE_BIN).toBe(process.execPath);
    expect(environment.MOTIF_MCP_TRACE).toBeUndefined();
    expect(environment.PATH).toBe('/usr/bin:/bin');
  });
});
