// Workspace-local preview build for the Motif for Claude Science artifact.
//
// Isolated sibling of build-claude-science-artifact.mjs: it builds the exact
// same self-contained artifact HTML, but its default output lives inside this
// workspace's ./preview/ folder and never writes to an external handoff path.
// Safe to run on every iteration.
//
//   node scripts/build-preview.mjs                  -> preview/motif-artifact.html
//   node scripts/build-preview.mjs --payload x.json -> bakes an inventory payload
//   node scripts/build-preview.mjs --out some.html  -> custom output path
//
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { stampMotifBuildIdentity } from './motif-build-identity.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const previewDir = join(root, 'preview');
const previewHtml = join(previewDir, 'motif-artifact.html');
const buildDir = mkdtempSync(join(tmpdir(), 'motif-preview-'));

const args = process.argv.slice(2);
function readArg(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}
const payloadPath = readArg('--payload');
const outPath = readArg('--out');

function inlineAssetTags(html) {
  let inlined = html.replace(
    /<link rel="stylesheet" crossorigin href="([^"]+)">/g,
    (_m, href) => `<style>\n${readFileSync(join(buildDir, href.replace(/^\.\//, '')), 'utf8')}\n</style>`,
  );
  inlined = inlined.replace(
    /<script type="module" crossorigin src="([^"]+)"><\/script>/g,
    (_m, src) => `<script type="module">\n${readFileSync(join(buildDir, src.replace(/^\.\//, '')), 'utf8')}\n</script>`,
  );
  return inlined;
}

function jsonForScriptTag(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function injectPayload(html, payloadJson) {
  const pattern = /(<script type="application\/json" id="motif-artifact-data">)([\s\S]*?)(<\/script>)/;
  if (!pattern.test(html)) throw new Error('Could not find motif-artifact-data script tag');
  return html.replace(
    pattern,
    (_match, openTag, _existingPayload, closeTag) => `${openTag}${payloadJson}${closeTag}`,
  );
}

try {
  const build = spawnSync(
    'npx',
    ['vite', 'build', '--config', 'vite.claude-science.config.ts', '--configLoader', 'runner', '--outDir', buildDir, '--emptyOutDir'],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
  if (build.status !== 0) process.exitCode = build.status ?? 1;
  else {
    const distHtml = join(buildDir, 'motif.html');
    const stamped = stampMotifBuildIdentity(inlineAssetTags(readFileSync(distHtml, 'utf8')));
    let html = stamped.html;
    if (payloadPath) {
      const payload = JSON.parse(readFileSync(resolve(payloadPath), 'utf8'));
      html = injectPayload(html, jsonForScriptTag(payload));
    }

    const finalPath = outPath ? resolve(outPath) : previewHtml;
    mkdirSync(dirname(finalPath), { recursive: true });
    writeFileSync(finalPath, html);

    console.log(`\n✓ preview written: ${finalPath}`);
    console.log(`  runtime build: ${stamped.runtimeBuildId}`);
    console.log(`  open: file://${finalPath}`);
  }
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}
