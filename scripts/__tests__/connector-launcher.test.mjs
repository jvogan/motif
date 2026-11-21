import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { stampConnectorBinding } from '../build-claude-science-artifact.mjs';
import { buildMotifMcpServer } from '../build-motif-mcp-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('connector launcher', () => {
  function runConfiguredLauncher(launcher, bundle, nodeBinary, environment, input) {
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
      input,
      timeout: 10_000,
    });
  }

  it('quotes the absolute Node.js path and invokes it exactly once', () => {
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
    const invocations = join(bundle, 'node-invocations');
    writeFileSync(nodeBinary, `#!/bin/bash\nprintf '%s\\n' "$1" >> ${JSON.stringify(invocations)}\nprintf '%s\\n' "$1"\n`);
    chmodSync(launcher, 0o755);
    chmodSync(nodeBinary, 0o755);

    const result = runConfiguredLauncher(launcher, bundle, nodeBinary, {
      PATH: '/tmp/untrusted-path',
      MOTIF_NODE_BIN: '/tmp/untrusted-node',
      MOTIF_ROOT: '/tmp/untrusted-root',
    });
    expect(result.status).toBe(0);
    const canonicalServer = join(realpathSync(bundle), 'dist-motif', 'claude-science', 'motif-mcp-server.mjs');
    expect(result.stdout.trim()).toBe(canonicalServer);
    expect(readFileSync(invocations, 'utf8')).toBe(`${canonicalServer}\n`);
  });

  it('checks the Node version inside the bundled server before initialization', async () => {
    const bundle = mkdtempSync(join(tmpdir(), 'motif connector version '));
    temporaryDirectories.push(bundle);
    mkdirSync(join(bundle, 'scripts'));
    const launcher = join(bundle, 'scripts', 'run-motif-claude-science-mcp.sh');
    cpSync(join(root, 'scripts', 'run-motif-claude-science-mcp.sh'), launcher);
    const out = join(bundle, 'dist-motif', 'claude-science', 'motif-mcp-server.mjs');
    await buildMotifMcpServer({ out });
    const meta = `<meta name="motif-build-id" content="${'a'.repeat(64)}">`;
    const body = meta + '<body><script type="application/json" id="motif-artifact-data">{}</script>';
    const ending = '</body></html>';
    const version = '1.0.0';
    const app = body + '<script data-motif-mcp-app-bridge>void 0;</script>' + ending;
    writeFileSync(join(bundle, 'package.json'), JSON.stringify({ version }));
    writeFileSync(join(bundle, 'dist-motif', 'claude-science', 'motif-mcp-app.html'),
      stampConnectorBinding(app, readFileSync(out, 'utf8'), version));
    writeFileSync(join(bundle, 'dist-motif', 'motif-template.html'), body + ending);
    const spoof = join(bundle, 'old-version.mjs');
    writeFileSync(spoof, "Object.defineProperty(process.versions, 'node', { value: '22.12.0' });\n");
    const nodeBinary = join(bundle, 'node');
    writeFileSync(nodeBinary,
      `#!/bin/bash\nexec ${JSON.stringify(process.execPath)} --import ${JSON.stringify(spoof)} "$@"\n`,
      { mode: 0o755 });
    const input = JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'launcher-test', version: '1' } },
    }) + '\n';

    const rejected = runConfiguredLauncher(launcher, bundle, nodeBinary, {}, input);
    expect(rejected.status).toBe(1);
    expect(rejected.stdout).toBe('');
    expect(rejected.stderr).toBe('[motif-claude-science] Node.js 22.13 or newer (22.x) or 24 or newer is required.\n');

    const accepted = runConfiguredLauncher(launcher, bundle, process.execPath, {}, input);
    expect(accepted.status).toBe(0);
    expect(JSON.parse(accepted.stdout)).toMatchObject({
      id: 1,
      result: { serverInfo: { name: 'motif-claude-science' } },
    });
  });

  it('clears injected Node, proxy, agent, and credential variables before execution', () => {
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
