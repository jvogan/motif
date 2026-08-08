#!/usr/bin/env node

import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entryPath = join(root, 'mcp', 'motif', 'stdio-server.ts');
const outputPath = join(root, 'dist-motif', 'claude-science', 'motif-mcp-server.mjs');

export async function buildMotifMcpServer({ entry = entryPath, out = outputPath } = {}) {
  mkdirSync(dirname(out), { recursive: true });
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    // The connector server is a self-contained offline artifact. Whitespace
    // minification removes repeated esbuild module-path comments and padding
    // without changing the executable module or its dependency inventory.
    minifyWhitespace: true,
    legalComments: 'none',
    logLevel: 'info',
  });
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const out = await buildMotifMcpServer();
    console.log(`Wrote Motif MCP server ${out}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
