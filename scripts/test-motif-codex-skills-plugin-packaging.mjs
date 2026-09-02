#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { listFilesRecursively } from './build-claude-science-artifact.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const pluginRoot = join(root, 'dist-motif', 'codex-skills', 'motif');
const zipPath = join(root, 'dist-motif', `motif-${packageVersion}-skills-only-plugin.zip`);
const checksumPath = join(root, 'dist-motif', `motif-${packageVersion}-skills-only-plugin.checksums.json`);
const manifest = JSON.parse(readFileSync(join(pluginRoot, '.codex-plugin', 'plugin.json'), 'utf8'));
const skill = readFileSync(join(pluginRoot, 'skills', 'motif', 'SKILL.md'), 'utf8');
const skillInterface = readFileSync(join(pluginRoot, 'skills', 'motif', 'agents', 'openai.yaml'), 'utf8');
const helper = join(pluginRoot, 'skills', 'motif', 'scripts', 'create-workbench.mjs');
const helperSource = readFileSync(helper, 'utf8');
const files = listFilesRecursively(pluginRoot).map(file => file.archivePath);

assert.equal(manifest.name, 'motif');
assert.equal(manifest.skills, './skills/');
assert.equal(manifest.interface.category, 'Education & Research');
assert.equal(Object.hasOwn(manifest, 'mcpServers'), false);
assert.equal(Object.hasOwn(manifest, 'apps'), false);
assert.deepEqual(manifest.interface.capabilities, ['Interactive', 'Read', 'Write']);
assert.equal(manifest.interface.defaultPrompt.length, 3);
for (const prompt of manifest.interface.defaultPrompt) assert.ok(prompt.length <= 128);
assert.match(manifest.interface.longDescription, /find, prepare, analyze, and transform data/u);
assert.match(manifest.interface.longDescription, /annotations, alignments, traces, cloning designs, and results/u);
assert.match(skill, /Use the analysis tools available in the session/u);
assert.match(skill, /Preserve record IDs, annotations, provenance, and result dependencies/u);
assert.match(skillInterface, /short_description: "Build molecular-biology workbenches"/u);

for (const required of [
  '.codex-plugin/plugin.json',
  'LICENSE',
  'PRIVACY.md',
  'README.md',
  'TERMS.md',
  'THIRD_PARTY_NOTICES.md',
  'assets/logo.png',
  'skills/motif/SKILL.md',
  'skills/motif/agents/openai.yaml',
  'skills/motif/assets/logo.png',
  'skills/motif/resources/motif-artifact.html',
  'skills/motif/scripts/create-workbench.mjs',
  'third-party-licenses/lucide-react-LICENSE.txt',
  'third-party-licenses/react-dom-LICENSE.txt',
  'third-party-licenses/react-LICENSE.txt',
]) assert.ok(files.includes(required), `Missing skills-only archive entry: ${required}`);

for (const forbidden of ['.mcp.json', '.app.json', 'server', 'mcp', 'doctor-motif-codex-plugin.mjs']) {
  assert.equal(files.some(file => file === forbidden || file.startsWith(`${forbidden}/`)), false);
}
for (const forbiddenText of ['motif_open_workbench', 'motif_create_workbench_artifact', 'mcpServers', '${PLUGIN_ROOT}']) {
  assert.equal(skill.includes(forbiddenText), false, `Skill contains removed runtime reference: ${forbiddenText}`);
  assert.equal(skillInterface.includes(forbiddenText), false, `Skill interface contains removed runtime reference: ${forbiddenText}`);
  assert.equal(helperSource.includes(forbiddenText), false, `Helper contains removed runtime reference: ${forbiddenText}`);
}
assert.doesNotMatch(skillInterface, /^dependencies:/mu);

const checksums = JSON.parse(readFileSync(checksumPath, 'utf8'));
const zip = readFileSync(zipPath);
assert.equal(checksums.archive, `motif-${packageVersion}-skills-only-plugin.zip`);
assert.equal(createHash('sha256').update(zip).digest('hex'), checksums.archiveSha256);
assert.equal(zip.readUInt16LE(8), 8, 'Skills-only ZIP entries must use DEFLATE compression.');
const uncompressedBytes = listFilesRecursively(pluginRoot)
  .reduce((total, file) => total + readFileSync(file.absolutePath).length, 0);
assert.ok(zip.length < uncompressedBytes, 'Skills-only ZIP must be smaller than its unpacked contents.');

const temporaryRoot = mkdtempSync(join(tmpdir(), 'motif-skills-only-test-'));
try {
  const fastaPath = join(temporaryRoot, 'records.fasta');
  const artifactPath = join(temporaryRoot, 'motif.html');
  writeFileSync(fastaPath, '>alpha </script> marker\nATGAAATTT\n>beta\nATGAAAATT\n');
  const generated = spawnSync(process.execPath, [helper, '--content', fastaPath, '--out', artifactPath], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(generated.status, 0, generated.stderr);
  const receipt = JSON.parse(generated.stdout);
  assert.equal(receipt.recordCount, 2);
  assert.equal(receipt.residueCount, 18);
  assert.equal(receipt.outputPath, artifactPath);
  const html = readFileSync(artifactPath, 'utf8');
  assert.equal(createHash('sha256').update(html).digest('hex'), receipt.htmlSha256);
  const embedded = /<script type="application\/json" id="motif-artifact-data">([\s\S]*?)<\/script>/u.exec(html)?.[1];
  assert.ok(embedded);
  assert.equal(embedded.includes('</script> marker'), false);
  const payload = JSON.parse(embedded);
  assert.deepEqual(payload.records.map(record => record.sequence), ['ATGAAATTT', 'ATGAAAATT']);

  const overwrite = spawnSync(process.execPath, [helper, '--content', fastaPath, '--out', artifactPath], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.notEqual(overwrite.status, 0);
  assert.match(overwrite.stderr, /Output already exists/u);

  writeFileSync(fastaPath, '>replacement\nAUGGCUACGUAA\n');
  const forced = spawnSync(
    process.execPath,
    [helper, '--content', fastaPath, '--molecule', 'rna', '--out', artifactPath, '--force'],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(forced.status, 0, forced.stderr);
  const forcedReceipt = JSON.parse(forced.stdout);
  assert.equal(forcedReceipt.schema, 'motif.local-workbench-receipt.v1');
  assert.equal(forcedReceipt.recordCount, 1);
  assert.equal(forcedReceipt.residueCount, 12);

  const genbankPath = join(temporaryRoot, 'record.gb');
  const genbankArtifactPath = join(temporaryRoot, 'genbank.html');
  writeFileSync(genbankPath, [
    'LOCUS       SYNTHETIC                 12 bp    DNA     linear',
    'DEFINITION  Synthetic packaging fixture.',
    'FEATURES             Location/Qualifiers',
    '     CDS             1..9',
    '                     /label="fixture CDS"',
    'ORIGIN',
    '        1 atgaaattttaa',
    '//',
    '',
  ].join('\n'));
  const genbank = spawnSync(
    process.execPath,
    [helper, '--content', genbankPath, '--out', genbankArtifactPath],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(genbank.status, 0, genbank.stderr);
  const genbankReceipt = JSON.parse(genbank.stdout);
  assert.equal(genbankReceipt.recordCount, 1);
  assert.equal(genbankReceipt.residueCount, 12);

  const payloadPath = join(temporaryRoot, 'workspace.json');
  const payloadArtifactPath = join(temporaryRoot, 'workspace.html');
  writeFileSync(payloadPath, JSON.stringify({
    records: [{
      id: 'payload-record',
      name: 'Payload record',
      sequence: 'MTEYKLVVVG',
      type: 'protein',
      topology: 'linear',
      features: [],
    }],
  }));
  const payloadResult = spawnSync(
    process.execPath,
    [helper, '--payload', payloadPath, '--out', payloadArtifactPath],
    { encoding: 'utf8', timeout: 30_000 },
  );
  assert.equal(payloadResult.status, 0, payloadResult.stderr);
  const payloadReceipt = JSON.parse(payloadResult.stdout);
  assert.equal(payloadReceipt.recordCount, 1);
  assert.equal(payloadReceipt.residueCount, 10);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

process.stdout.write('Motif Codex skills-only plugin packaging checks passed.\n');
