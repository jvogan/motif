#!/usr/bin/env node

import { lstatSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareConnectorInventory, loadDependencyPolicy } from './lib/supply-chain-policy.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = join(root, 'dist-motif');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function inventory(directory) {
  const files = [];
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error(`Release output contains a symbolic link: ${relative(output, child)}`);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push({ path: relative(directory, child).split(sep).join('/'), bytes: stat.size });
      else throw new Error(`Release output contains an unsupported file: ${relative(output, child)}`);
    }
  }
  walk(directory);
  return { files, bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

function assertSelfContained(path) {
  const html = readFileSync(path, 'utf8');
  if (/(?:src|href)=['"](?:https?:|\/\/|\.\/assets\/)/iu.test(html)) {
    throw new Error(`Self-contained HTML contains an external/generated asset reference: ${relative(root, path)}`);
  }
}

export function checkReleaseBudgets() {
  const budgets = readJson(join(root, 'security/release-budgets.json'));
  if (budgets.schema !== 'motif.release-budgets.v1') throw new Error('Unsupported release budget schema');
  const plugin = join(output, 'motif-for-claude-science');
  const connector = join(output, 'claude-science');
  const release = join(output, 'motif-for-claude-science-release');
  const html = join(output, 'motif-artifact.html');
  const zip = join(output, 'motif-for-claude-science.zip');
  for (const path of [plugin, connector, release, html, zip]) {
    if (!statSync(path, { throwIfNoEntry: false })) throw new Error(`Build output is missing: ${relative(root, path)}`);
  }
  const pluginInfo = inventory(plugin);
  const connectorInfo = inventory(connector);
  const releaseInfo = inventory(release);
  const artifactBytes = statSync(html).size;
  const zipBytes = statSync(zip).size;
  const limits = budgets.limits;
  if (artifactBytes > limits.artifactHtmlBytes) throw new Error(`Artifact exceeds byte budget (${artifactBytes} > ${limits.artifactHtmlBytes})`);
  if (pluginInfo.bytes > limits.pluginDirectoryBytes) throw new Error(`Plugin exceeds byte budget (${pluginInfo.bytes} > ${limits.pluginDirectoryBytes})`);
  if (pluginInfo.files.length > limits.pluginDirectoryFiles) throw new Error(`Plugin exceeds file budget (${pluginInfo.files.length} > ${limits.pluginDirectoryFiles})`);
  if (zipBytes > limits.pluginZipBytes) throw new Error(`Plugin zip exceeds byte budget (${zipBytes} > ${limits.pluginZipBytes})`);
  if (connectorInfo.bytes > limits.connectorDirectoryBytes) throw new Error(`Connector exceeds byte budget (${connectorInfo.bytes} > ${limits.connectorDirectoryBytes})`);
  if (releaseInfo.bytes > limits.releaseDirectoryBytes) throw new Error(`Release bundle exceeds byte budget (${releaseInfo.bytes} > ${limits.releaseDirectoryBytes})`);
  if (releaseInfo.files.length > limits.releaseDirectoryFiles) throw new Error(`Release bundle exceeds file budget (${releaseInfo.files.length} > ${limits.releaseDirectoryFiles})`);
  assertSelfContained(html);
  assertSelfContained(join(output, 'claude-science/motif-mcp-app.html'));

  const { inventory: reviewed } = loadDependencyPolicy(root);
  const releaseInventory = readJson(join(release, 'connector-inventory.json'));
  compareConnectorInventory(reviewed, releaseInventory);
  const expectedLicenses = reviewed.packages.map((entry) => entry.licenseFile).sort();
  const actualLicenses = readdirSync(join(plugin, 'server/licenses')).sort();
  if (JSON.stringify(actualLicenses) !== JSON.stringify(expectedLicenses)) {
    throw new Error(`Plugin license inventory drift: expected ${expectedLicenses.join(', ')}, found ${actualLicenses.join(', ')}`);
  }
  const report = {
    schema: 'motif.release-confidence.v1',
    version: readJson(join(root, 'package.json')).version,
    status: 'passed',
    components: {
      artifactHtml: { bytes: artifactBytes, limit: limits.artifactHtmlBytes },
      pluginDirectory: { bytes: pluginInfo.bytes, files: pluginInfo.files.length, limits: { bytes: limits.pluginDirectoryBytes, files: limits.pluginDirectoryFiles } },
      pluginZip: { bytes: zipBytes, limit: limits.pluginZipBytes },
      connectorDirectory: { bytes: connectorInfo.bytes, limit: limits.connectorDirectoryBytes },
      releaseDirectory: { bytes: releaseInfo.bytes, files: releaseInfo.files.length, limits: { bytes: limits.releaseDirectoryBytes, files: limits.releaseDirectoryFiles } },
    },
    connectorPackages: reviewed.packages.map((entry) => entry.name).sort(),
  };
  writeFileSync(join(output, 'release-confidence-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = checkReleaseBudgets();
    console.log(`Release budgets passed: artifact ${report.components.artifactHtml.bytes} bytes; plugin ${report.components.pluginDirectory.bytes} bytes/${report.components.pluginDirectory.files} files; release ${report.components.releaseDirectory.bytes} bytes/${report.components.releaseDirectory.files} files.`);
  } catch (error) {
    console.error(`Release budgets failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
