import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

    const result = spawnSync('/bin/bash', [launcher], {
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', MOTIF_NODE_BIN: nodeBinary },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(join(realpathSync(bundle), 'dist-motif', 'claude-science', 'motif-mcp-server.mjs'));
  });
});
