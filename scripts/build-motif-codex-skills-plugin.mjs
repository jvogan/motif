#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { createDeterministicZipBuffer, listFilesRecursively } from './build-claude-science-artifact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const pluginName = 'motif';
const sourceDirectory = join(root, 'src', 'artifacts', 'motif-codex-skills-only-plugin', pluginName);
const outputDirectory = join(root, 'dist-motif', 'codex-skills', pluginName);
const zipPath = join(root, 'dist-motif', `motif-${packageVersion}-skills-only-plugin.zip`);
const checksumPath = join(root, 'dist-motif', `motif-${packageVersion}-skills-only-plugin.checksums.json`);
const logoPath = join(root, 'src', 'artifacts', 'motif-for-codex-plugin', 'motif-for-claude-science', 'assets', 'logo.png');
const templatePath = join(root, 'dist-motif', 'motif-template.html');
const cliEntryPath = join(root, 'src', 'artifacts', 'motif-codex-skills-only-cli.ts');
const localContractsPath = join(root, 'src', 'artifacts', 'motif-codex-skills-only-contracts.ts');

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`Missing ${label}: ${path}`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function buildMotifCodexSkillsPlugin() {
  for (const [path, label] of [
    [join(sourceDirectory, '.codex-plugin', 'plugin.json'), 'skills-only plugin manifest'],
    [join(sourceDirectory, 'skills', 'motif', 'SKILL.md'), 'Motif skill'],
    [join(sourceDirectory, 'skills', 'motif', 'agents', 'openai.yaml'), 'Motif skill interface'],
    [logoPath, 'reviewed Motif logo'],
    [templatePath, 'built Motif artifact'],
    [cliEntryPath, 'skills-only artifact helper'],
    [localContractsPath, 'skills-only workbench contracts'],
  ]) requireFile(path, label);

  const manifest = JSON.parse(readFileSync(join(sourceDirectory, '.codex-plugin', 'plugin.json'), 'utf8'));
  if (manifest.name !== pluginName) throw new Error(`Skills-only plugin manifest name must be ${pluginName}.`);
  if (manifest.version !== packageVersion) throw new Error('Skills-only plugin version must match package.json.');
  if (manifest.skills !== './skills/') throw new Error('Skills-only plugin must discover ./skills/.');
  if (Object.hasOwn(manifest, 'mcpServers') || Object.hasOwn(manifest, 'apps')) {
    throw new Error('Skills-only plugin must not declare connector or app configuration.');
  }

  rmSync(outputDirectory, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  rmSync(checksumPath, { force: true });
  cpSync(sourceDirectory, outputDirectory, { recursive: true });

  const skillDirectory = join(outputDirectory, 'skills', 'motif');
  mkdirSync(join(outputDirectory, 'assets'), { recursive: true });
  mkdirSync(join(skillDirectory, 'assets'), { recursive: true });
  mkdirSync(join(skillDirectory, 'resources'), { recursive: true });
  mkdirSync(join(skillDirectory, 'scripts'), { recursive: true });
  cpSync(logoPath, join(outputDirectory, 'assets', 'logo.png'));
  cpSync(logoPath, join(skillDirectory, 'assets', 'logo.png'));
  cpSync(templatePath, join(skillDirectory, 'resources', 'motif-artifact.html'));
  for (const filename of ['LICENSE', 'PRIVACY.md', 'TERMS.md']) {
    cpSync(join(root, filename), join(outputDirectory, filename));
  }
  cpSync(
    join(sourceDirectory, 'THIRD_PARTY_NOTICES.md'),
    join(outputDirectory, 'THIRD_PARTY_NOTICES.md'),
  );
  const thirdPartyLicenseDirectory = join(outputDirectory, 'third-party-licenses');
  mkdirSync(thirdPartyLicenseDirectory, { recursive: true });
  for (const [packageName, outputName] of [
    ['react', 'react-LICENSE.txt'],
    ['react-dom', 'react-dom-LICENSE.txt'],
    ['lucide-react', 'lucide-react-LICENSE.txt'],
  ]) {
    cpSync(
      join(root, 'node_modules', packageName, 'LICENSE'),
      join(thirdPartyLicenseDirectory, outputName),
    );
  }

  const cliOutputPath = join(skillDirectory, 'scripts', 'create-workbench.mjs');
  await build({
    entryPoints: [cliEntryPath],
    outfile: cliOutputPath,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    plugins: [{
      name: 'motif-local-contracts',
      setup(buildContext) {
        buildContext.onResolve({ filter: /^\.\/contracts\.js$/ }, (args) => {
          if (args.importer === join(root, 'mcp', 'motif', 'payload.ts')) {
            return { path: localContractsPath };
          }
          return null;
        });
      },
    }],
  });
  chmodSync(cliOutputPath, 0o755);

  const forbiddenPaths = ['.mcp.json', '.app.json', 'server', 'mcp', 'doctor-motif-codex-plugin.mjs'];
  const files = listFilesRecursively(outputDirectory);
  for (const file of files) {
    if (forbiddenPaths.some(path => file.archivePath === path || file.archivePath.startsWith(`${path}/`))) {
      throw new Error(`Skills-only archive contains a forbidden runtime path: ${file.archivePath}`);
    }
  }

  const zip = createDeterministicZipBuffer(outputDirectory);
  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, zip);
  const checksums = {
    schema: 'motif.codex-skills-plugin-checksums.v1',
    algorithm: 'sha256',
    archive: basename(zipPath),
    archiveSha256: sha256(zip),
    files: Object.fromEntries(files.map(file => [file.archivePath, sha256(readFileSync(file.absolutePath))])),
  };
  writeFileSync(checksumPath, `${JSON.stringify(checksums, null, 2)}\n`);
  return { outputDirectory, zipPath, checksumPath, checksums };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = await buildMotifCodexSkillsPlugin();
    process.stdout.write(`Wrote skills-only plugin ${result.outputDirectory}\n`);
    process.stdout.write(`Wrote ${result.zipPath}\n`);
    process.stdout.write(`Wrote ${result.checksumPath}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
