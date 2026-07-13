#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_ALIGNMENT_COLUMNS, validatePayload } from './create-artifact.mjs';

export const MAX_MSA_SEQUENCES = 100;
export const MAX_MSA_SEQUENCE_LENGTH = MAX_ALIGNMENT_COLUMNS;
export const MAX_MSA_TOTAL_BASES = 2_000_000;
export const MAX_MSA_INPUT_BYTES = 4_000_000;
export const MAX_MSA_OUTPUT_BYTES = 4_500_000;
export const DEFAULT_MSA_TIMEOUT_MS = 120_000;
export const MAX_MSA_TIMEOUT_MS = 600_000;
const MAX_CAPTURE_BYTES = 1_048_576;
const MAX_HEADER_LENGTH = 1_024;

const ENGINE_CONFIG = Object.freeze({
  mafft: Object.freeze({
    id: 'mafft',
    label: 'MAFFT',
    binaries: Object.freeze(['mafft']),
    envVar: 'MOTIF_MSA_MAFFT_PATH',
    versionArgs: Object.freeze(['--version']),
  }),
  muscle: Object.freeze({
    id: 'muscle',
    label: 'MUSCLE',
    binaries: Object.freeze(['muscle']),
    envVar: 'MOTIF_MSA_MUSCLE_PATH',
    versionArgs: Object.freeze(['-version']),
  }),
  'clustal-omega': Object.freeze({
    id: 'clustal-omega',
    label: 'Clustal Omega',
    binaries: Object.freeze(['clustalo', 'clustalomega']),
    envVar: 'MOTIF_MSA_CLUSTAL_OMEGA_PATH',
    versionArgs: Object.freeze(['--version']),
  }),
});

function usage() {
  return `Run a real external MSA engine and produce a Motif artifact payload.

Usage:
  node run-msa.mjs --engine <mafft|muscle|clustal-omega> \\
    --molecule <dna|protein> --in <fasta|-> [--out <json|->] [options]

Options:
  --engine <id>       Required external engine. No fallback is performed.
  --molecule <type>   Required input type: dna or protein.
  --in <fasta|->      Required unaligned FASTA path, or - for standard input.
  --out <json|->      Payload JSON path, or - for standard output (default: -).
  --name <text>       Alignment display name.
  --executable <path> Explicit engine executable; takes precedence over discovery.
  --timeout-ms <ms>   Process timeout, 100-${MAX_MSA_TIMEOUT_MS} (default: ${DEFAULT_MSA_TIMEOUT_MS}).
  --force             Replace an existing JSON output file.
  --help              Show this help.

Discovery order:
  1. --executable
  2. The engine-specific MOTIF_MSA_*_PATH or MOTIF_MSA_EXECUTABLE
  3. MOTIF_MSA_TOOLS_DIR
  4. ~/.claude-science/conda/envs/msa-tools/bin
  5. PATH
`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function sha256File(path) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1_048_576);
  const descriptor = openSync(path, 'r');
  try {
    while (true) {
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest('hex');
}

function boundedInteger(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}`);
  }
  return parsed;
}

export function normalizeExternalMsaEngine(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (normalized === 'clustalo' || normalized === 'clustalomega' || normalized === 'clustal') {
    return 'clustal-omega';
  }
  if (Object.hasOwn(ENGINE_CONFIG, normalized)) return normalized;
  throw new Error('MSA engine must be mafft, muscle, or clustal-omega');
}

export function parseRunMsaArgs(args) {
  const options = {
    engine: null,
    molecule: null,
    inputPath: null,
    outputPath: '-',
    name: null,
    executablePath: null,
    timeoutMs: DEFAULT_MSA_TIMEOUT_MS,
    force: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (['--engine', '--molecule', '--in', '--out', '--name', '--executable', '--timeout-ms'].includes(arg)) {
      const value = args[index + 1];
      if (!value || (value.startsWith('--') && value !== '-')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--engine') options.engine = normalizeExternalMsaEngine(value);
      if (arg === '--molecule') options.molecule = value.trim().toLowerCase();
      if (arg === '--in') options.inputPath = value;
      if (arg === '--out') options.outputPath = value;
      if (arg === '--name') options.name = value;
      if (arg === '--executable') options.executablePath = value;
      if (arg === '--timeout-ms') {
        options.timeoutMs = boundedInteger(value, '--timeout-ms', 100, MAX_MSA_TIMEOUT_MS);
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.help) {
    if (!options.engine) throw new Error('--engine is required');
    if (options.molecule !== 'dna' && options.molecule !== 'protein') {
      throw new Error('--molecule must be dna or protein');
    }
    if (!options.inputPath) throw new Error('--in is required');
    if (typeof options.name === 'string') validateHeader(options.name, 'Alignment name');
  }
  return options;
}

function validateHeader(value, label) {
  const header = String(value).trim();
  if (!header) throw new Error(`${label} must not be empty`);
  if (header.length > MAX_HEADER_LENGTH) {
    throw new Error(`${label} cannot exceed ${MAX_HEADER_LENGTH.toLocaleString()} characters`);
  }
  if (Array.from(header).some((symbol) => {
    const code = symbol.charCodeAt(0);
    return symbol === '>' || code < 32 || code === 127 || code === 0x2028 || code === 0x2029;
  })) {
    throw new Error(`${label} cannot contain FASTA markers, line breaks, or control characters`);
  }
  return header;
}

function validInputAlphabet(sequence, molecule) {
  if (molecule === 'dna') return /^[ACGTRYSWKMBDHVN]+$/i.test(sequence);
  return /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*]+$/i.test(sequence);
}

export function parseUnalignedFasta(text, molecule) {
  if (molecule !== 'dna' && molecule !== 'protein') throw new Error('molecule must be dna or protein');
  if (typeof text !== 'string' || !text.trim()) throw new Error('Input FASTA is empty');
  if (Buffer.byteLength(text, 'utf8') > MAX_MSA_INPUT_BYTES) {
    throw new Error(`Input FASTA cannot exceed ${MAX_MSA_INPUT_BYTES.toLocaleString()} bytes`);
  }

  const records = [];
  let current = null;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    if (trimmed.startsWith('>')) {
      const name = validateHeader(trimmed.slice(1), `FASTA header ${records.length + 1}`);
      current = { name, sequence: '' };
      records.push(current);
      if (records.length > MAX_MSA_SEQUENCES) {
        throw new Error(`MSA input cannot contain more than ${MAX_MSA_SEQUENCES} sequences`);
      }
      continue;
    }
    if (!current) throw new Error('Input FASTA must begin with a >header line');
    current.sequence += rawLine.replace(/\s+/g, '');
    if (current.sequence.length > MAX_MSA_SEQUENCE_LENGTH) {
      throw new Error(`Sequence “${current.name}” cannot exceed ${MAX_MSA_SEQUENCE_LENGTH.toLocaleString()} symbols`);
    }
  }

  if (records.length < 2) throw new Error('MSA input requires at least 2 FASTA records');
  const seenNames = new Set();
  let totalBases = 0;
  for (const record of records) {
    if (!record.sequence) throw new Error(`Sequence “${record.name}” is empty`);
    if (!validInputAlphabet(record.sequence, molecule)) {
      throw new Error(`Sequence “${record.name}” contains symbols that are not valid for ${molecule.toUpperCase()}`);
    }
    const nameKey = record.name.toLowerCase();
    if (seenNames.has(nameKey)) throw new Error(`FASTA headers must be unique; “${record.name}” appears more than once`);
    seenNames.add(nameKey);
    totalBases += record.sequence.length;
    if (totalBases > MAX_MSA_TOTAL_BASES) {
      throw new Error(`MSA input cannot exceed ${MAX_MSA_TOTAL_BASES.toLocaleString()} total symbols`);
    }
  }

  return records.map((record, index) => ({
    ...record,
    toolId: `motif-msa-${String(index + 1).padStart(4, '0')}`,
    recordId: `msa-record-${index + 1}`,
    rowId: `msa-row-${index + 1}`,
    inputSha256: sha256(record.sequence),
  }));
}

function wrapSequence(sequence, width = 80) {
  const lines = [];
  for (let offset = 0; offset < sequence.length; offset += width) {
    lines.push(sequence.slice(offset, offset + width));
  }
  return lines.join('\n');
}

function createToolFasta(records) {
  return `${records.map((record) => `>${record.toolId}\n${wrapSequence(record.sequence)}`).join('\n')}\n`;
}

function executableVariants(name, env) {
  if (process.platform !== 'win32' || extname(name)) return [name];
  const extensions = String(env.PATHEXT ?? '.EXE;.COM')
    .split(';')
    .filter((extension) => ['.EXE', '.COM'].includes(extension.toUpperCase()));
  return [name, ...extensions.map((extension) => `${name}${extension.toLowerCase()}`)];
}

function checkedExecutable(candidate) {
  if (!candidate || !existsSync(candidate)) return null;
  try {
    const physical = realpathSync(candidate);
    if (!statSync(physical).isFile()) return null;
    if (process.platform === 'win32' && !['.exe', '.com'].includes(extname(physical).toLowerCase())) return null;
    accessSync(physical, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return physical;
  } catch {
    return null;
  }
}

function findOnPath(binaryNames, pathValue, env) {
  const directories = String(pathValue ?? '').split(delimiter).filter(Boolean);
  for (const directory of directories) {
    for (const binary of binaryNames) {
      for (const variant of executableVariants(binary, env)) {
        const executable = checkedExecutable(join(directory, variant));
        if (executable) return executable;
      }
    }
  }
  return null;
}

function resolveConfiguredExecutable(value, pathValue, env, cwd) {
  const configured = String(value).trim();
  if (!configured) return null;
  if (isAbsolute(configured) || configured.includes('/') || configured.includes('\\') || configured.includes(sep)) {
    return checkedExecutable(resolve(cwd, configured));
  }
  return findOnPath([configured], pathValue, env);
}

export function discoverMsaExecutable(engineValue, options = {}) {
  const engine = normalizeExternalMsaEngine(engineValue);
  const config = ENGINE_CONFIG[engine];
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const pathValue = options.pathValue ?? env.PATH ?? env.Path ?? '';

  const explicitSources = [
    ['--executable', options.executablePath],
    [config.envVar, env[config.envVar]],
    ['MOTIF_MSA_EXECUTABLE', env.MOTIF_MSA_EXECUTABLE],
  ];
  for (const [source, value] of explicitSources) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    const executable = resolveConfiguredExecutable(value, pathValue, env, cwd);
    if (!executable) throw new Error(`${source} does not resolve to an executable ${config.label} binary: ${value}`);
    return { path: executable, source };
  }

  if (env.MOTIF_MSA_TOOLS_DIR) {
    for (const binary of config.binaries) {
      for (const variant of executableVariants(binary, env)) {
        const executable = checkedExecutable(join(resolve(cwd, env.MOTIF_MSA_TOOLS_DIR), variant));
        if (executable) return { path: executable, source: 'MOTIF_MSA_TOOLS_DIR' };
      }
    }
    throw new Error(`MOTIF_MSA_TOOLS_DIR does not contain an executable ${config.label} binary`);
  }

  const home = options.homeDir ?? homedir();
  for (const directory of [
    join(home, '.claude-science', 'conda', 'envs', 'msa-tools', 'bin'),
    join(home, '.claude-science', 'conda', 'envs', 'msa-tools', 'Scripts'),
  ]) {
    for (const binary of config.binaries) {
      for (const variant of executableVariants(binary, env)) {
        const executable = checkedExecutable(join(directory, variant));
        if (executable) return { path: executable, source: '~/.claude-science/conda/envs/msa-tools' };
      }
    }
  }

  const fromPath = findOnPath(config.binaries, pathValue, env);
  if (fromPath) return { path: fromPath, source: 'PATH' };
  throw new Error(
    `${config.label} was not found. Use --executable, ${config.envVar}, MOTIF_MSA_TOOLS_DIR, the Claude Science msa-tools environment, or PATH.`,
  );
}

function processFailure(result, label, timeoutMs) {
  if (result.error?.code === 'ETIMEDOUT') return `${label} timed out after ${timeoutMs} ms`;
  if (result.error) return `${label} could not start: ${result.error.message}`;
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim().slice(0, 4_096);
    return `${label} exited with status ${String(result.status)}${stderr ? `: ${stderr}` : ''}`;
  }
  return null;
}

function spawnChecked(executable, args, options) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    maxBuffer: options.maxBuffer ?? MAX_CAPTURE_BYTES,
    windowsHide: true,
  });
  const failure = processFailure(result, options.label, options.timeoutMs);
  if (failure) throw new Error(failure);
  return result;
}

function detectEngineVersion(executable, config, options) {
  const result = spawnChecked(executable, [...config.versionArgs], {
    ...options,
    timeoutMs: Math.min(options.timeoutMs, 10_000),
    label: `${config.label} version check`,
  });
  const version = `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!version) throw new Error(`${config.label} version check returned no version text`);
  return validateHeader(version.slice(0, MAX_HEADER_LENGTH), `${config.label} version`);
}

function validateEngineVersion(engine, version) {
  if (engine !== 'muscle') return;
  const major = version.match(/\bmuscle\s+v?(\d+)(?:\.|\s|$)/i)?.[1];
  if (!major || Number(major) < 5) {
    throw new Error(`MUSCLE 5 or later is required; detected version text: ${version}`);
  }
}

function engineInvocation(engine, molecule, inputPath, outputPath) {
  if (engine === 'mafft') {
    return {
      args: [molecule === 'protein' ? '--amino' : '--nuc', '--auto', '--thread', '1', inputPath],
      outputMode: 'stdout',
    };
  }
  if (engine === 'muscle') {
    return {
      args: ['-align', inputPath, '-output', outputPath, '-threads', '1'],
      outputMode: 'file',
    };
  }
  return {
    args: [
      `--infile=${inputPath}`,
      `--outfile=${outputPath}`,
      '--outfmt=fasta',
      '--output-order=input-order',
      '--threads=1',
      `--seqtype=${molecule === 'protein' ? 'Protein' : 'DNA'}`,
      '--force',
    ],
    outputMode: 'file',
  };
}

function portableInvocationArgs(args, inputPath, outputPath) {
  return args.map((arg) => arg
    .replace(inputPath, '<input.fasta>')
    .replace(outputPath, '<output.fasta>'));
}

function readBoundedOutput(path) {
  if (!existsSync(path)) throw new Error('MSA engine did not create its declared output file');
  const size = statSync(path).size;
  if (size > MAX_MSA_OUTPUT_BYTES) {
    throw new Error(`MSA output cannot exceed ${MAX_MSA_OUTPUT_BYTES.toLocaleString()} bytes`);
  }
  return readFileSync(path, 'utf8');
}

function parseToolAlignment(text, records, molecule) {
  if (!text.trim()) throw new Error('MSA engine returned an empty alignment');
  if (Buffer.byteLength(text, 'utf8') > MAX_MSA_OUTPUT_BYTES) {
    throw new Error(`MSA output cannot exceed ${MAX_MSA_OUTPUT_BYTES.toLocaleString()} bytes`);
  }
  const expected = new Map(records.map((record) => [record.toolId, record]));
  const alignedById = new Map();
  let currentId = null;

  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;
    if (trimmed.startsWith('>')) {
      const toolId = validateHeader(trimmed.slice(1), 'MSA output header');
      if (!expected.has(toolId)) throw new Error(`MSA output contains an unknown header: ${toolId}`);
      if (alignedById.has(toolId)) throw new Error(`MSA output repeats header: ${toolId}`);
      currentId = toolId;
      alignedById.set(toolId, '');
      continue;
    }
    if (!currentId) throw new Error('MSA output must begin with a >header line');
    alignedById.set(currentId, `${alignedById.get(currentId)}${rawLine.replace(/\s+/g, '')}`);
  }

  if (alignedById.size !== records.length) {
    const missing = records.filter((record) => !alignedById.has(record.toolId)).map((record) => record.name);
    throw new Error(`MSA output is missing ${missing.length} input sequence(s): ${missing.join(', ')}`);
  }

  let columns = null;
  return records.map((record) => {
    const aligned = String(alignedById.get(record.toolId)).toUpperCase().replace(/\./g, '-');
    if (!aligned || !aligned.replace(/-/g, '')) throw new Error(`MSA output row “${record.name}” is empty or gaps only`);
    const valid = molecule === 'dna'
      ? /^[ACGTRYSWKMBDHVN-]+$/.test(aligned)
      : /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*-]+$/.test(aligned);
    if (!valid) throw new Error(`MSA output row “${record.name}” contains invalid ${molecule.toUpperCase()} symbols`);
    if (aligned.replace(/-/g, '') !== record.sequence.toUpperCase()) {
      throw new Error(`MSA output row “${record.name}” no longer matches its input sequence`);
    }
    if (columns === null) columns = aligned.length;
    if (aligned.length !== columns) throw new Error('MSA output rows do not have a consistent aligned length');
    if (records.length * aligned.length > MAX_MSA_TOTAL_BASES) {
      throw new Error(`MSA output cannot exceed ${MAX_MSA_TOTAL_BASES.toLocaleString()} row-columns`);
    }
    return {
      id: record.rowId,
      name: record.name,
      sourceRecordId: record.recordId,
      inputSha256: record.inputSha256,
      aligned,
    };
  });
}

function safeAlignmentName(value, label, count) {
  return validateHeader(value ?? `${label} alignment of ${count} sequences`, 'Alignment name');
}

export function runExternalMsa(options) {
  const engine = normalizeExternalMsaEngine(options.engine);
  const molecule = options.molecule;
  if (molecule !== 'dna' && molecule !== 'protein') throw new Error('molecule must be dna or protein');
  const timeoutMs = options.timeoutMs === undefined
    ? DEFAULT_MSA_TIMEOUT_MS
    : boundedInteger(options.timeoutMs, 'timeoutMs', 100, MAX_MSA_TIMEOUT_MS);
  const records = parseUnalignedFasta(options.inputText, molecule);
  const config = ENGINE_CONFIG[engine];
  const discovery = discoverMsaExecutable(engine, {
    executablePath: options.executablePath,
    env: options.env,
    cwd: options.cwd,
    homeDir: options.homeDir,
    pathValue: options.pathValue,
  });
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const temporaryRoot = options.temporaryRoot ?? tmpdir();
  const temporaryDirectory = mkdtempSync(join(temporaryRoot, 'motif-msa-'));

  try {
    const inputPath = join(temporaryDirectory, 'input.fasta');
    const outputPath = join(temporaryDirectory, 'output.fasta');
    const inputFasta = createToolFasta(records);
    writeFileSync(inputPath, inputFasta, { encoding: 'utf8', mode: 0o600 });
    const version = detectEngineVersion(discovery.path, config, { cwd, env, timeoutMs });
    validateEngineVersion(engine, version);
    const invocation = engineInvocation(engine, molecule, inputPath, outputPath);
    const result = spawnChecked(discovery.path, invocation.args, {
      cwd: temporaryDirectory,
      env,
      timeoutMs,
      label: config.label,
      maxBuffer: invocation.outputMode === 'stdout' ? MAX_MSA_OUTPUT_BYTES : MAX_CAPTURE_BYTES,
    });
    const rawOutput = invocation.outputMode === 'stdout'
      ? String(result.stdout ?? '')
      : readBoundedOutput(outputPath);
    const rows = parseToolAlignment(rawOutput, records, molecule);
    const inputFastaSha256 = sha256(inputFasta);
    const outputFastaSha256 = sha256(rawOutput);
    const createdAt = options.createdAt ?? new Date().toISOString();
    const alignmentName = safeAlignmentName(options.name, config.label, records.length);
    const executableName = basename(discovery.path);
    const executableSha256 = sha256File(discovery.path);
    const portableArgs = portableInvocationArgs(invocation.args, inputPath, outputPath);
    const executableArgv = [executableName, ...portableArgs];
    const payload = {
      schema: 'motif.claude-science.inventory.v1',
      inventory: {
        title: alignmentName,
        description: `${config.label} alignment prepared by the Motif for Claude Science runner.`,
      },
      records: records.map((record) => ({
        id: record.recordId,
        name: record.name,
        type: molecule,
        topology: 'linear',
        sequence: record.sequence,
      })),
      alignments: [{
        id: `msa-${engine}-${outputFastaSha256.slice(0, 12)}`,
        name: alignmentName,
        molecule,
        referenceRowId: records[0].rowId,
        rows,
        engine: {
          id: engine,
          label: config.label,
          version,
          mode: 'local-command',
          parameters: portableArgs,
          usedFallback: false,
        },
        createdAt,
        outputSha256: outputFastaSha256,
        note: `Executed ${executableName} (executable SHA-256 ${executableSha256}) with no fallback. Tool-input FASTA SHA-256 ${inputFastaSha256}; raw output FASTA SHA-256 ${outputFastaSha256}.`,
        provenance: {
          runner: 'motif-for-claude-science/run-msa.mjs',
          executable: executableName,
          executableSha256,
          executableSource: discovery.source,
          version,
          versionArgv: [executableName, ...config.versionArgs],
          argv: executableArgv,
          runtimePathsRedacted: true,
          inputFastaSha256,
          outputFastaSha256,
          stderrSha256: sha256(String(result.stderr ?? '')),
        },
      }],
    };
    validatePayload(payload);
    return payload;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function readBoundedStdin() {
  const chunks = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(65_536, MAX_MSA_INPUT_BYTES + 1 - total));
    const bytesRead = readSync(0, chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    total += bytesRead;
    if (total > MAX_MSA_INPUT_BYTES) {
      throw new Error(`Input FASTA cannot exceed ${MAX_MSA_INPUT_BYTES.toLocaleString()} bytes`);
    }
    chunks.push(chunk.subarray(0, bytesRead));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function readBoundedInput(inputPath) {
  if (inputPath === '-') {
    return readBoundedStdin();
  }
  const resolved = resolve(inputPath);
  if (!existsSync(resolved)) throw new Error(`Input FASTA does not exist: ${resolved}`);
  if (statSync(resolved).size > MAX_MSA_INPUT_BYTES) {
    throw new Error(`Input FASTA cannot exceed ${MAX_MSA_INPUT_BYTES.toLocaleString()} bytes`);
  }
  return readFileSync(resolved, 'utf8');
}

export function writeMsaPayload(outputPath, payload, force = false) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (outputPath === '-') {
    process.stdout.write(json);
    return null;
  }
  const resolved = resolve(outputPath);
  if (existsSync(resolved) && !force) throw new Error(`Output already exists: ${resolved}. Pass --force to replace it.`);
  mkdirSync(dirname(resolved), { recursive: true });
  const temporaryDirectory = mkdtempSync(join(dirname(resolved), '.motif-msa-output-'));
  const temporaryPath = join(temporaryDirectory, 'payload.json');
  try {
    writeFileSync(temporaryPath, json, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    if (force) {
      renameSync(temporaryPath, resolved);
    } else {
      try {
        linkSync(temporaryPath, resolved);
      } catch (error) {
        if (error && typeof error === 'object' && error.code === 'EEXIST') {
          throw new Error(`Output already exists: ${resolved}. Pass --force to replace it.`);
        }
        throw error;
      }
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return resolved;
}

function preflightOutput(outputPath, force) {
  if (outputPath === '-') return;
  const resolved = resolve(outputPath);
  if (existsSync(resolved) && !force) {
    throw new Error(`Output already exists: ${resolved}. Pass --force to replace it.`);
  }
}

function moduleIsMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

const isMain = moduleIsMain();

if (isMain) {
  try {
    const options = parseRunMsaArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage());
    } else {
      preflightOutput(options.outputPath, options.force);
      const payload = runExternalMsa({
        engine: options.engine,
        molecule: options.molecule,
        inputText: readBoundedInput(options.inputPath),
        name: options.name,
        executablePath: options.executablePath,
        timeoutMs: options.timeoutMs,
      });
      const written = writeMsaPayload(options.outputPath, payload, options.force);
      if (written) {
        const alignment = payload.alignments[0];
        process.stderr.write(
          `Wrote ${written}\n${alignment.engine.label} ${alignment.engine.version}; SHA-256 ${alignment.outputSha256}\n`,
        );
      }
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
