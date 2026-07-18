import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import {
  copyBundledConnectorLicenses,
  copyPublicPluginDocs,
  createDeterministicZipBuffer,
  parseBuildArgs,
  runBuild,
  validatePluginSource,
} from './build-claude-science-artifact.mjs';
import { buildMotifMcpApp } from './build-motif-mcp-app.mjs';
import {
  MAX_ALIGNMENTS,
  MAX_ANALYSIS_ASSETS,
  MAX_ANALYSIS_RESULTS,
  MAX_ALIGNMENT_CELLS,
  MAX_ALIGNMENT_COLUMNS,
  MAX_ALIGNMENT_ROWS,
  MAX_ALIGNMENT_TEXT_CHARACTERS,
  MAX_FEATURES_PER_RECORD,
  MAX_HITS_PER_SITE,
  MAX_METADATA_JSON_DEPTH,
  MAX_METADATA_JSON_NODES,
  MAX_PAYLOAD_JSON_BYTES,
  MAX_RECORDS,
  MAX_RECORD_LENGTH,
  MAX_SHORT_TEXT_LENGTH,
  MAX_SITES_PER_RECORD,
  MAX_TAGS_PER_RECORD,
  MAX_TOTAL_ALIGNMENT_CELLS,
  readAndValidatePayload,
  validatePayload,
} from '../src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/create-artifact.mjs';
import {
  discoverMsaExecutable,
  MAX_MSA_SEQUENCE_LENGTH,
  MAX_MSA_SEQUENCES,
  parseRunMsaArgs,
  parseUnalignedFasta,
  runExternalMsa,
  writeMsaPayload,
} from '../src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/run-msa.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginSource = join(root, 'src/artifacts/motif-for-claude-science-plugin');
const helperRelativePath = join(
  'skills',
  'motif-for-claude-science',
  'scripts',
  'create-artifact.mjs',
);
const runnerRelativePath = join(
  'skills',
  'motif-for-claude-science',
  'scripts',
  'run-msa.mjs',
);
const resourceRelativePath = join(
  'skills',
  'motif-for-claude-science',
  'resources',
  'motif-artifact.html',
);

let failures = 0;

function check(name, callback) {
  try {
    callback();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

function writeFakeMsaExecutable(directory, name) {
  mkdirSync(directory, { recursive: true });
  const executablePath = join(directory, name);
  writeFileSync(executablePath, String.raw`#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const executable = process.argv[1].split(/[\\/]/).at(-1);
if (args.includes('--version') || args.includes('-version')) {
  process.stdout.write((process.env.FAKE_MSA_VERSION || ('fake-' + executable + ' 9.9.9')) + '\n');
  process.exit(0);
}
if (process.env.FAKE_MSA_MODE === 'timeout') {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
}

function flagValue(flag) {
  const separate = args.indexOf(flag);
  if (separate >= 0) return args[separate + 1];
  const combined = args.find((arg) => arg.startsWith(flag + '='));
  return combined ? combined.slice(flag.length + 1) : null;
}

const inputPath = executable === 'mafft' ? args.at(-1) : flagValue(executable === 'muscle' ? '-align' : '--infile');
const outputPath = executable === 'muscle' ? flagValue('-output') : flagValue('--outfile');
const input = readFileSync(inputPath, 'utf8');
const rows = [];
let current = null;
for (const rawLine of input.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line) continue;
  if (line.startsWith('>')) {
    current = { id: line.slice(1), sequence: '' };
    rows.push(current);
  } else {
    current.sequence += line;
  }
}

const renderedRows = process.env.FAKE_MSA_MODE === 'duplicate'
  ? [rows[0], rows[0]]
  : [...rows].reverse();
const output = renderedRows.map((row) => {
  const aligned = row.sequence === 'ATGC' ? 'AT-GC' : row.sequence;
  return '>' + row.id + '\n' + aligned;
}).join('\n') + '\n';

if (executable === 'mafft') process.stdout.write(output);
else writeFileSync(outputPath, output);
`, { mode: 0o755 });
  chmodSync(executablePath, 0o755);
  return executablePath;
}

check('plugin source has a matching, bounded manifest and skill', () => {
  validatePluginSource(pluginSource);
  const manifest = JSON.parse(readFileSync(join(pluginSource, '.claude-plugin/plugin.json'), 'utf8'));
  const skill = readFileSync(join(pluginSource, 'skills/motif-for-claude-science/SKILL.md'), 'utf8');
  const changelog = readFileSync(join(pluginSource, 'CHANGELOG.md'), 'utf8');
  const artifactSource = readFileSync(join(root, 'src/artifacts/motif-artifact.tsx'), 'utf8');
  const skillDescription = skill.match(/^description:\s*(.+)$/m)?.[1] ?? '';
  const artifactVersion = artifactSource.match(/const MOTIF_ARTIFACT_VERSION = '([^']+)'/)?.[1];
  assert.equal(manifest.name, 'motif-for-claude-science');
  assert.ok(manifest.name.length <= 64);
  assert.ok(manifest.description.length < 256);
  assert.ok(skillDescription.length > 0 && skillDescription.length <= 200);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, '0.2.1');
  assert.equal(manifest.version, artifactVersion);
  assert.match(changelog, new RegExp(`^## ${manifest.version.replace(/\./g, '\\.')}(?:\\s|$)`, 'm'));
  assert.ok(existsSync(join(pluginSource, runnerRelativePath)));
  assert.ok(existsSync(join(pluginSource, 'skills/motif-for-claude-science/scripts/analysis-validator.mjs')));
  assert.ok(existsSync(join(pluginSource, 'skills/motif-for-claude-science/scripts/workspace-validator.mjs')));
});

check('release versions stay aligned across package, runtime, bridge, and plugin', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const pluginManifest = JSON.parse(readFileSync(join(pluginSource, '.claude-plugin/plugin.json'), 'utf8'));
  const sources = [
    readFileSync(join(root, 'src/artifacts/motif-artifact.tsx'), 'utf8'),
    readFileSync(join(root, 'src/mcp-app/motif-workbench-bridge.ts'), 'utf8'),
    readFileSync(join(root, 'mcp/motif/stdio-server.ts'), 'utf8'),
  ];
  assert.equal(packageManifest.version, pluginManifest.version);
  for (const source of sources) assert.ok(source.includes(packageManifest.version));
});

check('public setup, troubleshooting, and capability docs ship with the plugin', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-public-docs-'));
  const legacyBrand = ['gene', 'chat'].join('');
  try {
    copyPublicPluginDocs(fixture);
    for (const filename of [
      'CAPABILITIES.md',
      'CLAUDE_SCIENCE_QUICKSTART.md',
      'CLAUDE_SCIENCE_TROUBLESHOOTING.md',
    ]) {
      const packaged = readFileSync(join(fixture, 'docs', filename), 'utf8');
      const canonical = readFileSync(join(root, 'docs', filename), 'utf8');
      assert.equal(packaged, canonical);
      assert.equal(packaged.toLowerCase().includes(legacyBrand), false);
      assert.doesNotMatch(packaged, /\/Users\/|github_3/iu);
    }
    assert.equal(
      readFileSync(join(fixture, 'examples', 'motif-demo.gb'), 'utf8'),
      readFileSync(join(root, 'examples', 'motif-demo.gb'), 'utf8'),
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

check('all bundled connector dependency licenses ship with the plugin', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-connector-licenses-'));
  const expectedLicenses = [
    'ajv-LICENSE.txt',
    'ajv-formats-LICENSE.txt',
    'fast-deep-equal-LICENSE.txt',
    'fast-uri-LICENSE.txt',
    'json-schema-traverse-LICENSE.txt',
    'mcp-ext-apps-LICENSE.txt',
    'mcp-sdk-LICENSE.txt',
    'zod-LICENSE.txt',
    'zod-to-json-schema-LICENSE.txt',
  ];
  try {
    copyBundledConnectorLicenses(fixture);
    assert.deepEqual(readdirSync(join(fixture, 'licenses')).sort(), expectedLicenses);
    for (const filename of expectedLicenses) {
      assert.ok(readFileSync(join(fixture, 'licenses', filename), 'utf8').trim().length > 0);
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

check('plugin helpers can be imported from a stdin ES module without running their CLIs', () => {
  const imported = spawnSync(
    process.execPath,
    ['--input-type=module', '-'],
    {
      cwd: root,
      encoding: 'utf8',
      input: [
        "import './src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/create-artifact.mjs';",
        "import './src/artifacts/motif-for-claude-science-plugin/skills/motif-for-claude-science/scripts/run-msa.mjs';",
      ].join('\n'),
    },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
});

check('bundled analysis validator is generated from the canonical artifact normalizer', () => {
  const generatedPath = join(pluginSource, 'skills/motif-for-claude-science/scripts/analysis-validator.mjs');
  const regenerated = buildSync({
    entryPoints: [join(root, 'src/artifacts/claude-science-analysis-results.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    banner: {
      js: '// Generated from src/artifacts/claude-science-analysis-results.ts. Regenerate with the documented esbuild command; do not edit by hand.',
    },
  }).outputFiles[0].text;
  assert.equal(readFileSync(generatedPath, 'utf8'), regenerated);
});

check('bundled workspace validator is generated from the canonical artifact normalizer', () => {
  const generatedPath = join(pluginSource, 'skills/motif-for-claude-science/scripts/workspace-validator.mjs');
  const regenerated = buildSync({
    entryPoints: [join(root, 'src/artifacts/claude-science-workspace-envelope.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    banner: {
      js: '// Generated from src/artifacts/claude-science-workspace-envelope.ts. Regenerate with the documented esbuild command; do not edit by hand.',
    },
  }).outputFiles[0].text;
  assert.equal(readFileSync(generatedPath, 'utf8'), regenerated);
});

check('payload helper applies canonical notes and durable-state validation', () => {
  const createdAt = '2026-07-12T12:00:00.000Z';
  const base = { records: [{ id: 'record-a', type: 'dna', sequence: 'ATGGAATTCTAA' }] };
  const valid = {
    ...base,
    notes: [{
      id: 'note-a', body: 'Review A.', format: 'plain', scope: 'record', recordId: 'record-a', createdAt, updatedAt: createdAt,
    }],
    artifactState: {
      customEnzymes: [{
        name: 'HelperI', recognitionSequence: 'GAATTC', cutOffset: 1, complementCutOffset: 5, overhang: '5prime',
      }],
      translationLayersByRecord: {
        'record-a': [{ id: 'layer-a', label: 'Layer A', start: 0, end: 6, strand: 1, frame: 0 }],
      },
      enzymeSourcesByRecord: { 'record-a': ['common'] },
    },
  };
  assert.equal(validatePayload(valid), valid);
  const sidecarOnly = { name: 'Workspace label', notes: [] };
  assert.equal(validatePayload(sidecarOnly), sidecarOnly);

  const malformed = [
    { notes: { malformed: true } },
    { notes: [{ id: 'bad', body: 'Bad', format: 'plain', scope: 'elsewhere', createdAt, updatedAt: createdAt }] },
    { artifactState: null },
    { artifactState: { customEnzymes: { malformed: true } } },
    { artifactState: { translationLayersByRecord: {
      'record-a': [{ id: 'bad', label: 'Bad', start: 0, end: 99, strand: 1, frame: 0 }],
    } } },
    { alignments: [{
      id: 'orphaned', molecule: 'dna', rows: [
        { id: 'a', name: 'A', aligned: 'ATGC', sourceRecordId: 'missing' },
        { id: 'b', name: 'B', aligned: 'AT-C' },
      ],
    }] },
  ];
  for (const patch of malformed) {
    assert.throws(() => validatePayload({ ...base, ...patch }), /Payload workspace is invalid/i);
  }
  assert.throws(() => validatePayload({
    records: [
      { id: 'record-a', type: 'dna', sequence: 'ATGC', active: false },
      { id: 'record-a', type: 'dna', sequence: 'ATGC', active: true },
    ],
    notes: [{
      id: 'note-a', body: 'Ambiguous record link.', format: 'plain', scope: 'record', recordId: 'record-a', createdAt, updatedAt: createdAt,
    }],
  }), /duplicate id record-a/i);
  assert.throws(() => validatePayload({
    records: [
      { name: 'record-a', type: 'dna', sequence: 'ATGC', active: false },
      { id: 'record-a', type: 'dna', sequence: 'ATGC', active: true },
    ],
    notes: [{
      id: 'note-a', body: 'Must not relink after id allocation.', format: 'plain', scope: 'record', recordId: 'record-a', createdAt, updatedAt: createdAt,
    }],
  }), /Payload workspace is invalid/i);
  assert.throws(() => validatePayload({
    records: [{ id: 'record-a', type: 'dna', sequence: 'AT*GC' }],
    notes: [{
      id: 'note-a', body: 'Range uses normalized DNA length.', format: 'plain', scope: 'range', recordId: 'record-a', range: { start: 0, end: 5 }, createdAt, updatedAt: createdAt,
    }],
  }), /Payload workspace is invalid/i);
  assert.throws(() => validatePayload({
    records: [{ id: 'inactive-only', type: 'dna', sequence: 'ATGC', active: false }],
  }), /at least one active record/i);
  assert.throws(() => validatePayload({
    schema: 'motif.claude-science.inventory.v99',
    records: [{ id: 'future', type: 'dna', sequence: 'ATGC' }],
  }), /unsupported Motif inventory schema/i);
});

check('payload helper bounds typed analysis results and forbids executable assets', () => {
  const source = {
    records: [{ id: 'construct-1', name: 'Construct', sequence: 'ATGC' }],
    analysisAssets: [{
      id: 'report-body',
      name: 'report.md',
      mediaType: 'text/markdown',
      content: '# Review',
      createdAt: '2026-07-12T20:00:00.000Z',
      provenance: { source: 'packaging-test' },
    }],
    analysisResults: [{
      id: 'report-1',
      kind: 'report',
      name: 'Review',
      status: 'complete',
      inputRecordIds: ['construct-1'],
      dependsOnResultIds: [],
      assetIds: ['report-body'],
      parameters: {},
      data: { format: 'markdown', bodyAssetId: 'report-body' },
      createdAt: '2026-07-12T20:00:00.000Z',
      provenance: { source: 'packaging-test' },
    }],
  };
  assert.equal(validatePayload(source), source);
  assert.throws(
    () => validatePayload({ ...source, analysisAssets: [{ ...source.analysisAssets[0], mediaType: 'text/html' }] }),
    /HTML, SVG, and binary assets are forbidden/,
  );
  assert.throws(
    () => validatePayload({ ...source, analysisResults: Array.from({ length: MAX_ANALYSIS_RESULTS + 1 }, () => null) }),
    /analysisResults cannot contain more than/,
  );
  assert.throws(
    () => validatePayload({ ...source, analysisAssets: Array.from({ length: MAX_ANALYSIS_ASSETS + 1 }, () => null) }),
    /analysisAssets cannot contain more than/,
  );
  assert.throws(
    () => validatePayload({ ...source, analysisResults: [{ ...source.analysisResults[0], assetIds: ['missing'] }] }),
    /references missing asset/,
  );
  assert.throws(
    () => validatePayload({
      ...source,
      analysisResults: [{ ...source.analysisResults[0], data: { format: 'html', body: '<b>unsafe mode</b>' } }],
    }),
    /format must be "plain" or "markdown"/,
  );
  assert.throws(
    () => validatePayload({
      ...source,
      analysisResults: [{ ...source.analysisResults[0], createdAt: 'July 12, 2026' }],
    }),
    /valid ISO 8601 date-time/,
  );
  assert.throws(
    () => validatePayload({
      ...source,
      analysisResults: [{ ...source.analysisResults[0], inputRecordIds: ['missing-record'] }],
    }),
    /does not match a workspace record|references missing record/,
  );
  const cycleA = { ...source.analysisResults[0], id: 'cycle-a', dependsOnResultIds: ['cycle-b'] };
  const cycleB = { ...source.analysisResults[0], id: 'cycle-b', dependsOnResultIds: ['cycle-a'] };
  assert.throws(
    () => validatePayload({ ...source, analysisResults: [cycleA, cycleB] }),
    /dependencies contain a cycle/,
  );
  assert.equal(validatePayload({
    records: source.records,
    analysisAssets: [{ ...source.analysisAssets[0], content: '' }],
  }).analysisAssets[0].content, '');
});

check('default build arguments never select an external handoff', () => {
  assert.deepEqual(parseBuildArgs([]), {
    payloadPath: null,
    outPath: null,
    handoffPath: null,
    help: false,
  });
  assert.equal(parseBuildArgs(['--handoff', '/tmp/artifact.html']).handoffPath, '/tmp/artifact.html');
  assert.throws(() => parseBuildArgs(['--handoff']), /requires a path/);
  assert.throws(() => parseBuildArgs(['--unexpected']), /Unknown option/);
  assert.throws(
    () => runBuild(['--out', join(tmpdir(), 'motif-unapproved-external.html')]),
    /use --handoff for an external copy/,
  );

  const buildSource = readFileSync(join(root, 'scripts/build-claude-science-artifact.mjs'), 'utf8');
  const macHomePrefix = ['', 'Users', ''].join('/');
  assert.equal(buildSource.includes(macHomePrefix), false);
  assert.match(buildSource, /const outDir = join\(root, 'dist-motif'\)/);
  assert.match(buildSource, /const finalDistHtml = join\(outDir, 'motif-artifact\.html'\)/);
  assert.match(buildSource, /const pluginName = 'motif-for-claude-science'/);
  assert.match(buildSource, /use --handoff for an external copy/);
});

check('ZIP bytes are deterministic across file order and timestamp changes', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-plugin-zip-'));
  try {
    mkdirSync(join(fixture, 'nested'));
    writeFileSync(join(fixture, 'z-last.txt'), 'last\n');
    writeFileSync(join(fixture, 'nested', 'a-first.txt'), 'first\n');
    const first = createDeterministicZipBuffer(fixture);

    const oldDate = new Date('2001-02-03T04:05:06Z');
    const newDate = new Date('2026-07-11T12:34:56Z');
    utimesSync(join(fixture, 'z-last.txt'), oldDate, oldDate);
    utimesSync(join(fixture, 'nested', 'a-first.txt'), newDate, newDate);
    const second = createDeterministicZipBuffer(fixture);

    assert.deepEqual(second, first);
    assert.equal(first.readUInt32LE(0), 0x04034b50);
    assert.equal(first.readUInt16LE(10), 0);
    assert.equal(first.readUInt16LE(12), 33);
    assert.equal(first.readUInt32LE(first.length - 22), 0x06054b50);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

check('MCP App bridge is injected only at the terminal body without replacement expansion', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-mcp-app-build-'));
  try {
    const templatePath = join(fixture, 'template.html');
    const entryPath = join(fixture, 'bridge.ts');
    const outputPath = join(fixture, 'app.html');
    const template = [
      '<!doctype html><html><head><title>Motif for Claude Science</title></head><body>',
      '<script type="application/json" id="motif-artifact-data">{}</script>',
      '<script>const embeddedReport = "</body>";</script>',
      '</body></html>',
    ].join('');
    writeFileSync(templatePath, template);
    writeFileSync(entryPath, 'document.documentElement.dataset.schema = "motif.mcp.workbench.v1"; const token = "$\'"; void token;');

    buildMotifMcpApp({ template: templatePath, entry: entryPath, out: outputPath });
    const built = readFileSync(outputPath, 'utf8');
    assert.equal((built.match(/data-motif-mcp-app-bridge/gu) ?? []).length, 1);
    assert.match(built, /const embeddedReport = "<\/body>";/u);
    assert.ok(built.lastIndexOf('data-motif-mcp-app-bridge') > built.indexOf('embeddedReport'));
    assert.ok(Buffer.byteLength(built) < Buffer.byteLength(template) + 100_000);
    assert.match(built, /<\/body>\s*<\/html>\s*$/u);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

check('bundled helper safely injects payloads and refuses accidental overwrite', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-plugin-helper-'));
  try {
    cpSync(pluginSource, fixture, { recursive: true });
    const resourcePath = join(fixture, resourceRelativePath);
    mkdirSync(dirname(resourcePath), { recursive: true });
    writeFileSync(
      resourcePath,
      '<!doctype html><script type="application/json" id="motif-artifact-data">{}</script>',
    );

    const payload = {
      schema: 'motif.claude-science.inventory.v1',
      records: [{ name: '$& </script><script>alert(1)</script>', sequence: 'ATGC' }],
    };
    const payloadPath = join(fixture, 'payload.json');
    const outPath = join(fixture, 'output', 'artifact.html');
    writeFileSync(payloadPath, JSON.stringify(payload));

    const helperPath = join(fixture, helperRelativePath);
    const first = spawnSync(
      process.execPath,
      [helperPath, '--payload', payloadPath, '--out', outPath],
      { encoding: 'utf8' },
    );
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /SHA-256 [a-f0-9]{64}/);

    const generated = readFileSync(outPath, 'utf8');
    assert.doesNotMatch(generated, /<script>alert\(1\)<\/script>/);
    const embedded = generated.match(/motif-artifact-data">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(embedded);
    assert.deepEqual(JSON.parse(embedded), payload);

    const second = spawnSync(process.execPath, [helperPath, '--out', outPath], { encoding: 'utf8' });
    assert.notEqual(second.status, 0);
    assert.match(second.stderr, /Output already exists/);

    const forced = spawnSync(
      process.execPath,
      [helperPath, '--out', outPath, '--force'],
      { encoding: 'utf8' },
    );
    assert.equal(forced.status, 0, forced.stderr);

    const invalidPayloadPath = join(fixture, 'invalid-payload.json');
    const invalidOutPath = join(fixture, 'output', 'invalid.html');
    writeFileSync(invalidPayloadPath, JSON.stringify({ records: [{ sequence: 'hello world' }] }));
    const invalid = spawnSync(
      process.execPath,
      [helperPath, '--payload', invalidPayloadPath, '--out', invalidOutPath],
      { encoding: 'utf8' },
    );
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /Invalid payload: Payload record 1/);

    const invalidAlignmentPayloadPath = join(fixture, 'invalid-alignment.json');
    const invalidAlignmentOutPath = join(fixture, 'output', 'invalid-alignment.html');
    writeFileSync(invalidAlignmentPayloadPath, JSON.stringify({
      alignment: {
        molecule: 'dna',
        rows: [
          { name: 'Alpha', aligned: 'ATGC' },
          { name: 'Beta', aligned: 'ATG' },
        ],
      },
    }));
    const invalidAlignment = spawnSync(
      process.execPath,
      [helperPath, '--payload', invalidAlignmentPayloadPath, '--out', invalidAlignmentOutPath],
      { encoding: 'utf8' },
    );
    assert.notEqual(invalidAlignment.status, 0);
    assert.match(invalidAlignment.stderr, /rows must all have exactly the same aligned length/);
    assert.equal(existsSync(invalidAlignmentOutPath), false, 'invalid alignment must not create a partial output');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

check('bundled helper rejects malformed nested shapes and oversized records', () => {
  const base = { id: 'safe', type: 'dna', sequence: 'GAATTCAAAAAA' };
  assert.doesNotThrow(() => validatePayload({ records: [{
    ...base,
    overhang5: 'AATT',
    overhang5Type: '5prime',
    overhang3: '',
    overhang3Type: 'blunt',
  }] }));
  for (const record of [
    { ...base, tags: 42 },
    { ...base, features: { start: 0, end: 3 } },
    { ...base, features: [null] },
    { ...base, features: [{ start: 0, end: 3, subRanges: 42 }] },
    { ...base, sites: { enzyme: 'EcoRI' } },
    { ...base, sites: [{ enzyme: 'EcoRI', hits: [null] }] },
    { ...base, features: [{ start: 0, end: 3, type: '<script>alert(1)</script>' }] },
    { ...base, overhang5: 'AATT', overhang5Type: 'blunt' },
    { ...base, overhang5Type: '5prime' },
    { ...base, overhang3: 'AX' },
    { ...base, type: 'protein', sequence: 'MPEPTIDE', overhang5: 'AATT', overhang5Type: '5prime' },
  ]) {
    assert.throws(() => validatePayload({ records: [record] }), /Payload record 1/);
  }
  assert.throws(
    () => validatePayload({ records: [{ ...base, sequence: 'A'.repeat(MAX_RECORD_LENGTH + 1) }] }),
    /supports at most 250,000 per record/,
  );
});

check('bundled helper accepts bounded precomputed alignment payloads and aliases', () => {
  const payload = {
    records: [{ id: 'reference', type: 'dna', sequence: 'ATGCCGTTA' }],
    alignment: {
      id: 'mafft-result',
      name: 'Homolog review',
      molecule: 'dna',
      referenceRowId: 'reference-row',
      engine: {
        id: 'mafft',
        label: 'MAFFT',
        version: '7.526',
        mode: 'local-command',
        parameters: ['--auto'],
        usedFallback: false,
      },
      rows: [
        { id: 'reference-row', name: 'Reference', sourceRecordId: 'reference', aligned: 'ATGC.CGTTA' },
        { id: 'variant-row', name: 'Variant', sequence: 'ATGCTCG-TA' },
      ],
    },
  };
  assert.equal(validatePayload(payload), payload);
  assert.doesNotThrow(() => validatePayload({
    alignments: [{
      name: 'Imported FASTA',
      type: 'protein',
      engine: 'Clustal Omega 1.2.4',
      alignedFasta: '>alpha\nMPEP--TIDE\n>beta\nMPEPT.TIDE\n',
    }],
  }));
});

check('bundled helper accepts linked Sanger traces and rejects detached or malformed channels', () => {
  const sangerTrace = {
    schema: 'motif.sanger-trace.v1',
    version: 1,
    baseCalls: 'ACGT',
    sequence: 'ACGT',
    qualityScores: [12, 24, 36, 48],
    peakPositions: [1, 3, 5, 7],
    channels: {
      A: [0, 12, 5, 1, 0, 0, 0, 0],
      C: [0, 0, 2, 14, 4, 0, 0, 0],
      G: [0, 0, 0, 0, 2, 16, 3, 0],
      T: [0, 0, 0, 0, 0, 1, 4, 18],
    },
    sampleCount: 8,
    dyeOrder: 'GATC',
    storedReverseComplement: false,
    warnings: [],
    metadata: {
      format: 'ABIF',
      abifVersion: 101,
      baseCallsTag: 'PBAS2',
      qualityScoresTag: 'PCON2',
      peakPositionsTag: 'PLOC2',
      channelTags: { A: 'DATA10', C: 'DATA12', G: 'DATA9', T: 'DATA11' },
      sampleName: 'read-01',
    },
  };
  const payload = {
    records: [{ id: 'read-01', type: 'dna', sequence: 'ACGT', sangerTrace }],
    alignment: {
      molecule: 'dna',
      referenceRowId: 'template',
      rows: [
        { id: 'template', name: 'Template', aligned: 'ACGT' },
        { id: 'read', name: 'Read 01', sourceRecordId: 'read-01', aligned: 'ACGT' },
      ],
    },
  };
  assert.equal(validatePayload(payload), payload);
  assert.throws(
    () => validatePayload({ records: [{ id: 'read-01', type: 'dna', sequence: 'AAAA', sangerTrace }] }),
    /calls must exactly match/,
  );
  assert.throws(
    () => validatePayload({ records: [{ id: 'read-01', type: 'dna', sequence: 'ACGT', sangerTrace: { ...sangerTrace, channels: { ...sangerTrace.channels, C: 'not-an-array' } } }] }),
    /channels\.C must be an array/,
  );
  assert.throws(
    () => validatePayload({ records: [{
      id: 'protein-like-trace',
      sequence: 'ATG*',
      sangerTrace: {
        ...sangerTrace,
        baseCalls: 'ATG',
        sequence: 'ATG',
        qualityScores: [12, 24, 36],
        peakPositions: [1, 3, 5],
      },
    }] }),
    /can only belong to a DNA record/,
  );
  const channel = Array(63_000).fill(0);
  const boundedLargeTraceRecord = {
    id: 'bounded-large-trace',
    type: 'dna',
    sequence: 'A',
    sangerTrace: {
      ...sangerTrace,
      baseCalls: 'A',
      sequence: 'A',
      qualityScores: [30],
      peakPositions: [1],
      channels: { A: channel, C: channel, G: channel, T: channel },
      sampleCount: channel.length,
    },
  };
  assert.doesNotThrow(() => validatePayload({ records: [boundedLargeTraceRecord] }));
  assert.doesNotThrow(() => validatePayload(boundedLargeTraceRecord));
});

check('external MSA runner validates CLI bounds and unique FASTA headers', () => {
  assert.equal(parseRunMsaArgs([
    '--engine', 'clustal-omega',
    '--molecule', 'dna',
    '--in', '-',
  ]).engine, 'clustal-omega');
  assert.throws(
    () => parseRunMsaArgs(['--engine', 'mafft', '--molecule', 'dna', '--in', '-', '--timeout-ms', '600001']),
    /--timeout-ms must be an integer/,
  );
  assert.throws(
    () => parseUnalignedFasta('>Alpha\nATGC\n>alpha\nATGG\n', 'dna'),
    /headers must be unique/,
  );
  assert.throws(
    () => parseUnalignedFasta(
      `>Alpha\n${'A'.repeat(MAX_MSA_SEQUENCE_LENGTH + 1)}\n>Beta\n${'A'.repeat(MAX_MSA_SEQUENCE_LENGTH + 1)}\n`,
      'dna',
    ),
    /cannot exceed 50,000 symbols/,
  );
  const tooMany = Array.from(
    { length: MAX_MSA_SEQUENCES + 1 },
    (_, index) => `>record-${index}\nA`,
  ).join('\n');
  assert.throws(() => parseUnalignedFasta(tooMany, 'dna'), /more than 100 sequences/);
});

check('external MSA runner discovers the dedicated environment before PATH and honors explicit failure', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-msa-discovery-'));
  try {
    const home = join(fixture, 'home');
    const dedicated = join(home, '.claude-science', 'conda', 'envs', 'msa-tools', 'bin');
    const pathDirectory = join(fixture, 'path-bin');
    const dedicatedMafft = writeFakeMsaExecutable(dedicated, 'mafft');
    writeFakeMsaExecutable(pathDirectory, 'mafft');
    const env = { ...process.env, PATH: pathDirectory };

    assert.deepEqual(discoverMsaExecutable('mafft', {
      env,
      homeDir: home,
      pathValue: pathDirectory,
    }), {
      path: realpathSync(dedicatedMafft),
      source: '~/.claude-science/conda/envs/msa-tools',
    });
    assert.throws(
      () => discoverMsaExecutable('mafft', {
        executablePath: 'missing-mafft',
        env,
        homeDir: home,
        pathValue: pathDirectory,
      }),
      /--executable does not resolve/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

check('external MSA runner maps reordered rows by safe header and records exact provenance', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-msa-runner-'));
  try {
    const inputText = '>Reference alpha\nATGC\n>Variant beta\nATGGC\n';
    for (const [engine, executableName] of [
      ['mafft', 'mafft'],
      ['muscle', 'muscle'],
      ['clustal-omega', 'clustalo'],
    ]) {
      const executablePath = writeFakeMsaExecutable(join(fixture, engine), executableName);
      const payload = runExternalMsa({
        engine,
        molecule: 'dna',
        inputText,
        executablePath,
        env: { ...process.env },
        temporaryRoot: fixture,
        createdAt: '2026-07-12T00:00:00.000Z',
      });
      const alignment = payload.alignments[0];
      assert.deepEqual(payload.records.map((record) => record.name), ['Reference alpha', 'Variant beta']);
      assert.deepEqual(alignment.rows.map((row) => row.name), ['Reference alpha', 'Variant beta']);
      assert.deepEqual(alignment.rows.map((row) => row.aligned), ['AT-GC', 'ATGGC']);
      assert.equal(alignment.engine.id, engine);
      assert.equal(alignment.engine.mode, 'local-command');
      assert.equal(alignment.engine.usedFallback, false);
      assert.equal(alignment.engine.version, `fake-${executableName} 9.9.9`);
      assert.equal(alignment.provenance.executable, executableName);
      assert.match(alignment.provenance.executableSha256, /^[a-f0-9]{64}$/);
      assert.equal(alignment.provenance.argv[0], executableName);
      assert.equal(alignment.provenance.runtimePathsRedacted, true);
      assert.ok(alignment.engine.parameters.some((argument) => argument.includes('<input.fasta>')));
      assert.equal(JSON.stringify(payload).includes(fixture), false);
      assert.match(alignment.provenance.inputFastaSha256, /^[a-f0-9]{64}$/);
      assert.match(alignment.outputSha256, /^[a-f0-9]{64}$/);
      assert.equal(alignment.provenance.outputFastaSha256, alignment.outputSha256);
      assert.equal(validatePayload(payload), payload);
      assert.deepEqual(
        readdirSync(fixture).filter((entry) => entry.startsWith('motif-msa-')),
        [],
        'runner temporary directories must be removed',
      );
    }
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

check('external MSA runner rejects malformed output and never falls back', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-msa-reject-'));
  try {
    const executablePath = writeFakeMsaExecutable(fixture, 'muscle');
    assert.throws(
      () => runExternalMsa({
        engine: 'muscle',
        molecule: 'dna',
        inputText: '>One\nATGC\n>Two\nATGGC\n',
        executablePath,
        env: { ...process.env, FAKE_MSA_MODE: 'duplicate' },
        temporaryRoot: fixture,
      }),
      /repeats header/,
    );
    assert.throws(
      () => runExternalMsa({
        engine: 'muscle',
        molecule: 'dna',
        inputText: '>One\nATGC\n>Two\nATGGC\n',
        executablePath,
        env: { ...process.env, FAKE_MSA_MODE: 'timeout' },
        temporaryRoot: fixture,
        timeoutMs: 100,
      }),
      /timed out after 100 ms/,
    );
    assert.throws(
      () => runExternalMsa({
        engine: 'muscle',
        molecule: 'dna',
        inputText: '>One\nATGC\n>Two\nATGGC\n',
        executablePath,
        env: { ...process.env, FAKE_MSA_VERSION: 'MUSCLE 3.8.31' },
        temporaryRoot: fixture,
      }),
      /MUSCLE 5 or later is required/,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

check('external MSA payload writer refuses races and preserves the old file on no-force', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-msa-output-'));
  try {
    const outputPath = join(fixture, 'payload.json');
    const payload = { schema: 'motif.claude-science.inventory.v1', records: [] };
    writeFileSync(outputPath, 'keep me\n');
    assert.throws(() => writeMsaPayload(outputPath, payload, false), /Output already exists/);
    assert.equal(readFileSync(outputPath, 'utf8'), 'keep me\n');
    assert.equal(readdirSync(fixture).some((entry) => entry.startsWith('.motif-msa-output-')), false);

    assert.equal(writeMsaPayload(outputPath, payload, true), resolve(outputPath));
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), payload);
    assert.equal(readdirSync(fixture).some((entry) => entry.startsWith('.motif-msa-output-')), false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

if (process.env.MOTIF_RUN_MSA_INTEGRATION === '1') {
  check('external MSA runner guarded integration smoke executes installed engines', () => {
    const inputText = '>Reference\nATGC\n>Insertion\nATGGC\n';
    for (const engine of ['mafft', 'muscle', 'clustal-omega']) {
      const payload = runExternalMsa({ engine, molecule: 'dna', inputText, timeoutMs: 30_000 });
      assert.equal(payload.alignments[0].engine.id, engine);
      assert.equal(payload.alignments[0].engine.usedFallback, false);
    }
  });
}

check('bundled helper rejects malformed alignment rows, alphabets, and engine metadata', () => {
  const validRows = [
    { id: 'a', name: 'Alpha', aligned: 'ATGC-' },
    { id: 'b', name: 'Beta', aligned: 'ATGCT' },
  ];
  for (const alignment of [
    { rows: validRows },
    { molecule: 'dna', rows: [validRows[0]] },
    { molecule: 'dna', rows: [{ ...validRows[0], aligned: '' }, validRows[1]] },
    { molecule: 'dna', rows: [validRows[0], { ...validRows[1], aligned: 'ATGC' }] },
    { molecule: 'dna', rows: [validRows[0], { ...validRows[1], aligned: 'ATGE-' }] },
    { molecule: 'dna', rows: validRows, engine: { mode: 'native' } },
    { molecule: 'dna', rows: validRows, engine: { parameters: ['--auto', 42] } },
    { molecule: 'dna', rows: validRows, engine: { usedFallback: 'no' } },
    { molecule: 'dna', rows: [validRows[0], { ...validRows[1], id: 'a' }] },
    { molecule: 'dna', rows: [validRows[0], { ...validRows[1], name: 'alpha' }] },
    { molecule: 'dna', type: 'rna', rows: validRows },
    { molecule: 'dna', referenceRowId: 'missing', rows: validRows },
    { molecule: 'dna', rows: [{ ...validRows[0], aligned: '-----' }, validRows[1]] },
    { name: 'Unsafe\n>alignment', molecule: 'dna', rows: validRows },
    { molecule: 'dna', rows: [{ ...validRows[0], name: 'Unsafe\n>row' }, validRows[1]] },
  ]) {
    assert.throws(() => validatePayload({ alignment }), /Payload alignment 1/);
  }
  assert.throws(
    () => validatePayload({ alignment: { molecule: 'dna', rows: validRows }, alignments: [] }),
    /either alignment or alignments, not both/,
  );
});

check('bundled helper enforces alignment count, row, column, cell, and workspace limits', () => {
  const tinyAlignment = (id) => ({
    id,
    molecule: 'dna',
    rows: [
      { id: `${id}-a`, name: `${id} A`, aligned: 'A' },
      { id: `${id}-b`, name: `${id} B`, aligned: 'A' },
    ],
  });
  const alignmentWith = (id, rowCount, columnCount) => ({
    id,
    molecule: 'dna',
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `${id}-${index}`,
      name: `${id} ${index}`,
      aligned: 'A'.repeat(columnCount),
    })),
  });

  assert.throws(
    () => validatePayload({ alignments: Array.from({ length: MAX_ALIGNMENTS + 1 }, (_, index) => tinyAlignment(`a-${index}`)) }),
    /more than 50 alignments/,
  );
  assert.throws(
    () => validatePayload({ alignment: alignmentWith('rows', MAX_ALIGNMENT_ROWS + 1, 1) }),
    /more than 100 rows/,
  );
  assert.throws(
    () => validatePayload({ alignment: alignmentWith('columns', 2, MAX_ALIGNMENT_COLUMNS + 1) }),
    /more than 50,000 columns/,
  );
  assert.throws(
    () => validatePayload({ alignment: alignmentWith('cells', MAX_ALIGNMENT_ROWS, Math.floor(MAX_ALIGNMENT_CELLS / MAX_ALIGNMENT_ROWS) + 1) }),
    /more than 2,000,000 row-columns/,
  );
  assert.throws(
    () => validatePayload({ alignment: { molecule: 'dna', alignedFasta: `>alpha\n${'A'.repeat(MAX_ALIGNMENT_TEXT_CHARACTERS)}\n>beta\nA` } }),
    /cannot exceed 2,250,000 characters/,
  );
  const totalRows = 50;
  const totalColumns = Math.floor(MAX_TOTAL_ALIGNMENT_CELLS / (totalRows * 3)) + 1;
  assert.throws(
    () => validatePayload({
      alignments: Array.from({ length: 3 }, (_, index) => alignmentWith(`total-${index}`, totalRows, totalColumns)),
    }),
    /more than 4,000,000 row-columns in total/,
  );
});

check('bundled helper enforces the same bounded payload cardinality and traversal limits', () => {
  const base = { id: 'safe', type: 'dna', sequence: 'GAATTCAAAAAA' };
  assert.throws(
    () => validatePayload({ records: Array.from({ length: MAX_RECORDS + 1 }, (_, index) => ({ ...base, id: `r-${index}` })) }),
    /more than 100 records/,
  );
  assert.throws(
    () => validatePayload({ records: [{ ...base, features: Array.from({ length: MAX_FEATURES_PER_RECORD + 1 }, () => ({ start: 0, end: 1 })) }] }),
    /more than 2,000 annotations and features/,
  );
  assert.throws(
    () => validatePayload({ records: [{ ...base, sites: Array.from({ length: MAX_SITES_PER_RECORD + 1 }, () => ({ enzyme: 'EcoRI' })) }] }),
    /more than 2,048 entries/,
  );
  assert.throws(
    () => validatePayload({ records: [{ ...base, sites: [{ enzyme: 'EcoRI', hits: Array.from({ length: MAX_HITS_PER_SITE + 1 }, () => ({ position: 0 })) }] }] }),
    /more than 10,000 entries/,
  );
  assert.throws(
    () => validatePayload({ records: [{ ...base, sites: Array.from({ length: 6 }, () => ({ enzyme: 'EcoRI', hits: Array(9_000).fill({ position: 0 }) })) }] }),
    /more than 50,000 hits in total/,
  );
  assert.throws(
    () => validatePayload({ records: [{ ...base, tags: Array.from({ length: MAX_TAGS_PER_RECORD + 1 }, (_, index) => `tag-${index}`) }] }),
    /more than 100 entries/,
  );
  assert.throws(
    () => validatePayload({ records: [{ ...base, name: 'n'.repeat(MAX_SHORT_TEXT_LENGTH + 1) }] }),
    /cannot exceed 1,024 characters/,
  );
  assert.throws(
    () => validatePayload({ records: [{ ...base, provenance: { nodes: Array(MAX_METADATA_JSON_NODES + 1).fill(null) } }] }),
    /maximum of 10,000 JSON nodes/,
  );
  assert.throws(
    () => validatePayload({ records: [{ ...base, provenance: { chunks: Array(66).fill('x'.repeat(16_000)) } }] }),
    /maximum serialized size of 1 MiB/,
  );
  let nested = {};
  for (let depth = 0; depth <= MAX_METADATA_JSON_DEPTH; depth += 1) nested = { child: nested };
  assert.throws(
    () => validatePayload({ records: [{ ...base, provenance: nested }] }),
    /nesting depth of 16/,
  );
  assert.throws(
    () => readAndValidatePayload(' '.repeat(MAX_PAYLOAD_JSON_BYTES + 1)),
    /maximum of 32 MiB/,
  );
});

if (failures > 0) {
  console.error(`\n${failures} packaging check${failures === 1 ? '' : 's'} failed.`);
  process.exitCode = 1;
} else {
  console.log('\nAll Claude Science plugin packaging checks passed.');
}
