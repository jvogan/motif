#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createDeterministicZipBuffer,
  listFilesRecursively,
} from './build-claude-science-artifact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginName = 'motif-for-claude-science';
const bundleDirectoryName = 'motif-for-codex';
const sourceDirectory = join(root, 'src', 'artifacts', bundleDirectoryName + '-plugin', pluginName);
const defaultOutputDirectory = join(root, 'dist-motif', 'codex', pluginName);
const defaultZipPath = join(root, 'dist-motif', `${bundleDirectoryName}.zip`);
const defaultChecksumPath = join(root, 'dist-motif', `${bundleDirectoryName}.checksums.json`);

const requiredSourceFiles = [
  '.codex-plugin/plugin.json',
  '.mcp.json',
  'README.md',
  'assets/logo.png',
  'skills/motif-for-codex/SKILL.md',
  'skills/motif-for-codex/agents/openai.yaml',
  'skills/motif-for-codex/assets/logo.png',
];

const runtimeFiles = [
  ['dist-motif/claude-science/motif-mcp-server.mjs', 'server/motif-mcp-server.mjs'],
  ['dist-motif/claude-science/motif-mcp-app.html', 'server/motif-mcp-app.html'],
  ['dist-motif/motif-template.html', 'server/motif-template.html'],
];

const exampleFiles = [
  'motif-demo.gb',
  'synthetic-proteins.fasta',
  'synthetic-proteins.aln',
  'synthetic-alignment-workspace.json',
];

const documentationFiles = ['CAPABILITIES.md'];

const supportFiles = [
  ['scripts/doctor-motif-codex-plugin.mjs', 'doctor-motif-codex-plugin.mjs'],
  ['PRIVACY.md', 'PRIVACY.md'],
  ['TERMS.md', 'TERMS.md'],
];

const integrityFiles = [
  '.codex-plugin/plugin.json',
  '.mcp.json',
  'PRIVACY.md',
  'TERMS.md',
  'assets/logo.png',
  'doctor-motif-codex-plugin.mjs',
  'package.json',
  'server/motif-mcp-app.html',
  'server/motif-mcp-server.mjs',
  'server/motif-template.html',
  'skills/motif-for-codex/SKILL.md',
  'skills/motif-for-codex/agents/openai.yaml',
  'skills/motif-for-codex/assets/logo.png',
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function requireFile(path, label = path) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function copyFile(rootDirectory, sourceRelativePath, targetDirectory, targetRelativePath = sourceRelativePath) {
  const sourcePath = join(rootDirectory, sourceRelativePath);
  const targetPath = join(targetDirectory, targetRelativePath);
  requireFile(sourcePath);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
}

function readPackageVersion(rootDirectory) {
  const packageJsonPath = join(rootDirectory, 'package.json');
  requireFile(packageJsonPath, 'root package metadata');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (typeof packageJson.version !== 'string' || !packageJson.version) {
    throw new Error('Root package metadata must contain a version.');
  }
  return packageJson.version;
}

function validatePluginSource({ rootDirectory = root, sourcePath = sourceDirectory } = {}) {
  for (const relativePath of requiredSourceFiles) {
    requireFile(join(sourcePath, relativePath), `Codex plugin source file ${relativePath}`);
  }

  const packageVersion = readPackageVersion(rootDirectory);
  const manifestPath = join(sourcePath, '.codex-plugin', 'plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== pluginName) {
    throw new Error(`Codex plugin manifest name must be ${pluginName}.`);
  }
  if (manifest.version !== packageVersion) {
    throw new Error(
      `Codex plugin manifest version (${manifest.version}) must match package version (${packageVersion}).`,
    );
  }
  if (manifest.mcpServers !== './.mcp.json' || manifest.skills !== './skills/') {
    throw new Error('Codex plugin manifest must reference its MCP manifest and skills directory.');
  }

  const mcpManifest = JSON.parse(readFileSync(join(sourcePath, '.mcp.json'), 'utf8'));
  const args = mcpManifest?.mcpServers?.motif?.args;
  if (!Array.isArray(args) || args[0] !== '${PLUGIN_ROOT}/server/motif-mcp-server.mjs') {
    throw new Error('Codex MCP manifest must launch the bundled server from PLUGIN_ROOT.');
  }
}

function copyBundledConnectorLicenses(rootDirectory, targetDirectory) {
  const inventoryPath = join(rootDirectory, 'security', 'connector-inventory.json');
  requireFile(inventoryPath, 'connector license inventory');
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  const licensesDirectory = join(targetDirectory, 'third-party-licenses');
  mkdirSync(licensesDirectory, { recursive: true });

  for (const entry of inventory.packages ?? []) {
    const packageDirectory = join(rootDirectory, 'node_modules', ...entry.packagePath);
    const licensePath = join(packageDirectory, 'LICENSE');
    requireFile(licensePath, `license for ${entry.name}`);
    cpSync(licensePath, join(licensesDirectory, entry.licenseFile));
  }
}

export function buildMotifCodexPlugin({
  rootDirectory = root,
  runtimeRootDirectory = rootDirectory,
  sourcePath = sourceDirectory,
  outputDirectory = defaultOutputDirectory,
  zipPath = defaultZipPath,
  checksumPath = defaultChecksumPath,
} = {}) {
  validatePluginSource({ rootDirectory, sourcePath });
  rmSync(outputDirectory, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  rmSync(checksumPath, { force: true });

  cpSync(sourcePath, outputDirectory, { recursive: true });
  for (const [sourceRelativePath, targetRelativePath] of runtimeFiles) {
    copyFile(runtimeRootDirectory, sourceRelativePath, outputDirectory, targetRelativePath);
  }
  for (const filename of exampleFiles) {
    copyFile(rootDirectory, join('examples', filename), outputDirectory, join('examples', filename));
  }
  for (const filename of documentationFiles) {
    copyFile(rootDirectory, join('docs', filename), outputDirectory, join('docs', filename));
  }
  for (const [sourceRelativePath, targetRelativePath] of supportFiles) {
    copyFile(rootDirectory, sourceRelativePath, outputDirectory, targetRelativePath);
  }
  copyFile(rootDirectory, 'LICENSE', outputDirectory);
  copyFile(rootDirectory, 'THIRD_PARTY_NOTICES.md', outputDirectory);
  copyBundledConnectorLicenses(rootDirectory, outputDirectory);

  const version = readPackageVersion(rootDirectory);
  writeFileSync(
    join(outputDirectory, 'package.json'),
    `${JSON.stringify({
      name: pluginName,
      version,
      private: true,
      license: 'MIT',
      engines: { node: '^22.13.0 || >=24.0.0' },
      scripts: { doctor: 'node doctor-motif-codex-plugin.mjs --plugin-root .' },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(outputDirectory, 'motif-runtime-integrity.json'),
    `${JSON.stringify({
      schema: 'motif.codex-runtime-integrity.v1',
      algorithm: 'sha256',
      version,
      files: Object.fromEntries(integrityFiles.map(relativePath => [
        relativePath,
        sha256(readFileSync(join(outputDirectory, relativePath))),
      ])),
    }, null, 2)}\n`,
  );

  const zip = createDeterministicZipBuffer(outputDirectory);
  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, zip);
  const files = Object.fromEntries(
    listFilesRecursively(outputDirectory).map((file) => [
      file.archivePath,
      sha256(readFileSync(file.absolutePath)),
    ]),
  );
  const checksums = {
    schema: 'motif.codex-plugin-checksums.v1',
    algorithm: 'sha256',
    archive: `${bundleDirectoryName}.zip`,
    archiveSha256: sha256(zip),
    files,
  };
  writeFileSync(checksumPath, `${JSON.stringify(checksums, null, 2)}\n`);

  return { outputDirectory, zipPath, checksumPath, checksums };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = buildMotifCodexPlugin();
    console.log(`Wrote Codex plugin ${result.outputDirectory}`);
    console.log(`Wrote ${result.zipPath}`);
    console.log(`Wrote ${result.checksumPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
