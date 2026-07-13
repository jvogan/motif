#!/usr/bin/env node

import { buildSync } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = join(root, 'dist-motif', 'motif-template.html');
const entryPath = join(root, 'src', 'mcp-app', 'motif-workbench-bridge.ts');
const outputPath = join(root, 'dist-motif', 'claude-science', 'motif-mcp-app.html');

export function buildMotifMcpApp({ template = templatePath, entry = entryPath, out = outputPath } = {}) {
  if (!existsSync(template)) {
    throw new Error(`Motif template is missing at ${template}. Run npm run build:motif first.`);
  }
  if (!existsSync(entry)) throw new Error(`Motif MCP App bridge is missing at ${entry}.`);

  const bridge = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2022'],
    legalComments: 'none',
    minify: true,
    write: false,
  }).outputFiles[0].text.replace(/<\/script/giu, '<\\/script');

  let html = readFileSync(template, 'utf8');
  if (!html.includes('id="motif-artifact-data"')) {
    throw new Error('Motif template is missing its embedded data tag.');
  }
  const documentClosePattern = /<\/body>\s*<\/html>\s*$/u;
  if (!documentClosePattern.test(html)) throw new Error('Motif template is missing its terminal body closing tag.');
  html = html.replace(
    documentClosePattern,
    () => `<script data-motif-mcp-app-bridge>\n${bridge}\n</script>\n</body>\n</html>`,
  );

  if (/(?:src|href)=["'](?:https?:|\.\/assets\/)/iu.test(html)) {
    throw new Error('Motif MCP App must not retain external or generated asset references.');
  }
  for (const marker of [
    'Motif for Claude Science',
    'motif.mcp.workbench.v1',
    'data-motif-mcp-app-bridge',
  ]) {
    if (!html.includes(marker)) throw new Error(`Motif MCP App bundle is missing ${marker}.`);
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const out = buildMotifMcpApp();
    console.log(`Wrote Motif MCP App ${out}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
