#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  linkSync,
  lstatSync,
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
import { isMainThread, Worker, workerData } from 'node:worker_threads';
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
const PROCESS_TERMINATION_GRACE_MS = 500;
const PROCESS_GUARD_OVERHEAD_MS = 5_000;
const PROCESS_GUARD_WORKER = 'motif-msa-process-guard-v1';

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

const ENGINE_BANNER_PATTERNS = Object.freeze({
  mafft: /^(?:mafft\s+)?v?7\.\d+(?:\.\d+)?(?:\s|\(|$)/iu,
  muscle: /^muscle\b.*\bv?5(?:\.\d+)+/iu,
  'clustal-omega': /^(?:clustal\s+omega|clustalo|clustalomega)\b.*\b1\.\d+(?:\.\d+)?/iu,
});
const WINDOWS_CHILD_ENVIRONMENT_KEYS = Object.freeze(['SystemRoot', 'SystemDrive', 'WINDIR']);
const INVALID_CHILD_ENVIRONMENT_KEY = /(?:TOKEN|PASSWORD|PASSWD|SECRET|CREDENTIAL|AUTH|PROXY|AGENT|NODE_OPTIONS|LD_PRELOAD|DYLD_|AWS_|SSH_)/iu;

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
  if (molecule === 'dna') return /^[ACGTRYSWKMBDHVN?]+$/i.test(sequence);
  return /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*?]+$/i.test(sequence);
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

function normalizedExecutableName(path) {
  return basename(path).toLowerCase().replace(/\.(?:exe|com)$/u, '');
}

function assertExecutableIdentity(executable, config, source) {
  const name = normalizedExecutableName(executable);
  if (!config.binaries.includes(name)) {
    throw new Error(`${source} must resolve to a ${config.label} executable named ${config.binaries.join(' or ')}`);
  }
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
    assertExecutableIdentity(executable, config, source);
    return { path: executable, source };
  }

  if (env.MOTIF_MSA_TOOLS_DIR) {
    for (const binary of config.binaries) {
      for (const variant of executableVariants(binary, env)) {
        const executable = checkedExecutable(join(resolve(cwd, env.MOTIF_MSA_TOOLS_DIR), variant));
        if (executable) {
          assertExecutableIdentity(executable, config, 'MOTIF_MSA_TOOLS_DIR');
          return { path: executable, source: 'MOTIF_MSA_TOOLS_DIR' };
        }
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
        if (executable) {
          assertExecutableIdentity(executable, config, '~/.claude-science/conda/envs/msa-tools');
          return { path: executable, source: '~/.claude-science/conda/envs/msa-tools' };
        }
      }
    }
  }

  const fromPath = findOnPath(config.binaries, pathValue, env);
  if (fromPath) {
    assertExecutableIdentity(fromPath, config, 'PATH');
    return { path: fromPath, source: 'PATH' };
  }
  throw new Error(
    `${config.label} was not found. Use --executable, ${config.envVar}, MOTIF_MSA_TOOLS_DIR, the Claude Science msa-tools environment, or PATH.`,
  );
}

function processFailure(result, label, timeoutMs) {
  if (result.error?.code === 'ETIMEDOUT') return `${label} timed out after ${timeoutMs} ms`;
  if (result.error?.code === 'ENOBUFS') {
    return `${label} exceeded its bounded ${result.error.stream ?? 'output'} capture`;
  }
  if (result.error) return `${label} could not start: ${result.error.message}`;
  if (result.status !== 0) {
    const stderr = String(result.stderr ?? '').trim().slice(0, 4_096);
    return `${label} exited with status ${String(result.status)}${stderr ? `: ${stderr}` : ''}`;
  }
  return null;
}

function appendBoundedCapture(capture, chunk, maximum) {
  capture.bytes += chunk.length;
  const remaining = Math.max(0, maximum - capture.retainedBytes);
  if (remaining > 0) {
    const retained = chunk.subarray(0, remaining);
    capture.chunks.push(retained);
    capture.retainedBytes += retained.length;
  }
  return capture.bytes > maximum;
}

function terminateProcessTree(child, signal) {
  if (!child.pid) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code === 'ESRCH') return;
    }
  }
  try {
    child.kill(signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function superviseProcess(request) {
  return new Promise((resolvePromise) => {
    const stdout = { chunks: [], bytes: 0, retainedBytes: 0 };
    const stderr = { chunks: [], bytes: 0, retainedBytes: 0 };
    let terminationReason = null;
    let spawnError = null;
    let finished = false;
    let killTimer = null;
    let forceFinishTimer = null;
    let closedResult = null;

    const child = spawn(request.executable, request.args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // A new process group lets POSIX hosts terminate descendants as well as
      // the selected engine. Windows receives the same TERM/KILL escalation
      // for the direct child, but Node does not expose a portable job-object
      // primitive for descendant cleanup.
      detached: process.platform !== 'win32',
    });

    const finish = (status, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (forceFinishTimer) clearTimeout(forceFinishTimer);
      resolvePromise({
        status,
        signal,
        terminationReason,
        errorCode: spawnError?.code,
        errorMessage: spawnError?.message,
        stdoutBase64: Buffer.concat(stdout.chunks).toString('base64'),
        stderrBase64: Buffer.concat(stderr.chunks).toString('base64'),
      });
    };

    const beginTermination = (reason) => {
      if (terminationReason) return;
      terminationReason = reason;
      try {
        terminateProcessTree(child, 'SIGTERM');
      } catch (error) {
        spawnError = error;
      }
      killTimer = setTimeout(() => {
        try {
          terminateProcessTree(child, 'SIGKILL');
        } catch (error) {
          spawnError = spawnError ?? error;
        }
        if (closedResult) {
          finish(closedResult.status, closedResult.signal);
          return;
        }
        // SIGKILL normally produces `close` immediately. Do not let a broken
        // or uninterruptible child keep the synchronous caller blocked forever.
        forceFinishTimer = setTimeout(() => {
          child.stdout?.destroy();
          child.stderr?.destroy();
          child.unref();
          finish(closedResult?.status ?? null, closedResult?.signal ?? 'SIGKILL');
        }, PROCESS_TERMINATION_GRACE_MS);
      }, PROCESS_TERMINATION_GRACE_MS);
    };

    child.stdout?.on('data', (chunk) => {
      if (appendBoundedCapture(stdout, chunk, request.stdoutLimit)) beginTermination('stdout-limit');
    });
    child.stderr?.on('data', (chunk) => {
      if (appendBoundedCapture(stderr, chunk, request.stderrLimit)) beginTermination('stderr-limit');
    });
    child.once('error', (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.once('close', (status, signal) => {
      // On POSIX the group can outlive its leader. Keep the escalation timer
      // armed after a timed-out leader exits so SIGKILL still reaches any
      // descendant that ignored SIGTERM.
      if (terminationReason && process.platform !== 'win32') {
        closedResult = { status, signal };
        return;
      }
      finish(status, signal);
    });

    const timeoutTimer = setTimeout(() => beginTermination('timeout'), request.timeoutMs);
    timeoutTimer.unref();
  });
}

function decodeGuardedProcessResult(response) {
  const errorCode = response.terminationReason === 'timeout'
    ? 'ETIMEDOUT'
    : response.terminationReason === 'stdout-limit' || response.terminationReason === 'stderr-limit'
      ? 'ENOBUFS'
      : response.errorCode;
  const error = errorCode
    ? Object.assign(new Error(response.errorMessage || errorCode), {
      code: errorCode,
      ...(response.terminationReason?.endsWith('-limit')
        ? { stream: response.terminationReason.replace('-limit', '') }
        : {}),
    })
    : undefined;
  return {
    status: response.status,
    signal: response.signal,
    stdout: Buffer.from(response.stdoutBase64 ?? '', 'base64').toString('utf8'),
    stderr: Buffer.from(response.stderrBase64 ?? '', 'base64').toString('utf8'),
    ...(error ? { error } : {}),
  };
}

function writeWorkerResponse(sharedResponse, value) {
  const header = new Int32Array(sharedResponse, 0, 2);
  const body = new Uint8Array(sharedResponse, 8);
  let encoded = Buffer.from(JSON.stringify(value), 'utf8');
  if (encoded.length > body.length) {
    encoded = Buffer.from(JSON.stringify({
      status: null,
      signal: null,
      errorCode: 'ENOBUFS',
      errorMessage: 'MSA process guard response exceeded its bounded shared buffer',
      stdoutBase64: '',
      stderrBase64: '',
    }), 'utf8');
  }
  body.set(encoded);
  Atomics.store(header, 1, encoded.length);
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
}

function spawnChecked(executable, args, options) {
  const stdoutLimit = options.maxBuffer ?? MAX_CAPTURE_BYTES;
  const request = {
    executable,
    args,
    cwd: options.cwd,
    env: options.env,
    timeoutMs: options.timeoutMs,
    stdoutLimit,
    stderrLimit: MAX_CAPTURE_BYTES,
  };
  const guardedMaxBuffer = Math.ceil((stdoutLimit + MAX_CAPTURE_BYTES) * 4 / 3) + 1_048_576;
  const sharedResponse = new SharedArrayBuffer(8 + guardedMaxBuffer);
  const header = new Int32Array(sharedResponse, 0, 2);
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { type: PROCESS_GUARD_WORKER, request, sharedResponse },
  });
  const waitResult = Atomics.wait(
    header,
    0,
    0,
    options.timeoutMs + (2 * PROCESS_TERMINATION_GRACE_MS) + PROCESS_GUARD_OVERHEAD_MS,
  );
  void worker.terminate();
  if (waitResult === 'timed-out') {
    const result = { error: Object.assign(new Error('MSA process guard deadline expired'), { code: 'ETIMEDOUT' }) };
    const failure = processFailure(result, options.label, options.timeoutMs);
    throw new Error(failure ?? `${options.label} process guard timed out`);
  }
  const responseLength = Atomics.load(header, 1);
  if (responseLength < 1 || responseLength > guardedMaxBuffer) {
    throw new Error(`${options.label} process guard returned an invalid response`);
  }
  let response;
  try {
    response = JSON.parse(Buffer.from(new Uint8Array(sharedResponse, 8, responseLength)).toString('utf8'));
  } catch {
    throw new Error(`${options.label} process guard returned an invalid response`);
  }
  const result = decodeGuardedProcessResult(response);
  const failure = processFailure(result, options.label, options.timeoutMs);
  if (failure) throw new Error(failure);
  return result;
}

function minimalMsaEnvironment(sourceEnv, explicitEnv = {}) {
  const childEnv = {};
  if (process.platform === 'win32') {
    for (const key of WINDOWS_CHILD_ENVIRONMENT_KEYS) {
      if (typeof sourceEnv?.[key] === 'string' && sourceEnv[key]) childEnv[key] = sourceEnv[key];
    }
  }
  for (const [key, value] of Object.entries(explicitEnv ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || INVALID_CHILD_ENVIRONMENT_KEY.test(key)) {
      throw new Error(`MSA child environment variable ${key} is not allowed`);
    }
    if (typeof value !== 'string') throw new Error(`MSA child environment variable ${key} must be a string`);
    childEnv[key] = value;
  }
  return childEnv;
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
  if (!ENGINE_BANNER_PATTERNS[engine].test(version)) {
    throw new Error(`${ENGINE_CONFIG[engine].label} version banner is not recognized: ${version}`);
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

export function portableInvocationArgs(args, inputPath, outputPath) {
  return args.map((arg) => arg
    // Replace the output path first: an output such as `/tmp/input.fasta.bak`
    // can contain the input path as a prefix, and the old order produced a
    // misleading partially-redacted provenance argument.
    .replace(outputPath, '<output.fasta>')
    .replace(inputPath, '<input.fasta>'));
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
      ? /^[ACGTRYSWKMBDHVN?-]+$/.test(aligned)
      : /^[ACDEFGHIKLMNPQRSTVWYOUJBXZ*?-]+$/.test(aligned);
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
  const discoveryEnv = options.env ?? process.env;
  const childEnv = minimalMsaEnvironment(discoveryEnv, options.childEnv);
  const cwd = options.cwd ?? process.cwd();
  const temporaryRoot = options.temporaryRoot ?? tmpdir();
  const temporaryDirectory = mkdtempSync(join(temporaryRoot, 'motif-msa-'));

  try {
    const inputPath = join(temporaryDirectory, 'input.fasta');
    const outputPath = join(temporaryDirectory, 'output.fasta');
    const inputFasta = createToolFasta(records);
    writeFileSync(inputPath, inputFasta, { encoding: 'utf8', mode: 0o600 });
    const executableSha256 = sha256File(discovery.path);
    const version = detectEngineVersion(discovery.path, config, { cwd, env: childEnv, timeoutMs });
    validateEngineVersion(engine, version);
    const invocation = engineInvocation(engine, molecule, inputPath, outputPath);
    const result = spawnChecked(discovery.path, invocation.args, {
      cwd: temporaryDirectory,
      env: childEnv,
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
    if (sha256File(discovery.path) !== executableSha256) {
      throw new Error(`${config.label} executable changed during execution`);
    }
    const createdAt = options.createdAt ?? new Date().toISOString();
    const alignmentName = safeAlignmentName(options.name, config.label, records.length);
    const executableName = basename(discovery.path);
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
        comparison: {
          route: 'local-command',
          method: 'external-engine',
          algorithm: config.id,
          fallback: false,
          warnings: [],
          ambiguityCount: 0,
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

export function readBoundedInput(inputPath, hooks = {}) {
  if (inputPath === '-') {
    return readBoundedStdin();
  }
  const resolved = resolve(inputPath);
  if (!existsSync(resolved)) throw new Error(`Input FASTA does not exist: ${resolved}`);
  const pathStat = lstatSync(resolved);
  if (pathStat.isSymbolicLink()) throw new Error('Input FASTA must not be a symbolic link');
  if (!pathStat.isFile()) throw new Error('Input FASTA must be a regular file');
  const openFlags = constants.O_RDONLY
    | (constants.O_NOFOLLOW ?? 0)
    | (constants.O_NONBLOCK ?? 0);
  let descriptor;
  try {
    descriptor = openSync(resolved, openFlags);
  } catch (error) {
    if (error?.code === 'ELOOP') throw new Error('Input FASTA must not be a symbolic link');
    throw error;
  }
  try {
    const openedStat = fstatSync(descriptor);
    if (!openedStat.isFile()) throw new Error('Input FASTA must be a regular file');
    if (openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) {
      throw new Error('Input FASTA changed while it was being opened');
    }
    if (openedStat.size > MAX_MSA_INPUT_BYTES) {
      throw new Error(`Input FASTA cannot exceed ${MAX_MSA_INPUT_BYTES.toLocaleString()} bytes`);
    }
    // Test-only observation point for proving that subsequent path replacement
    // cannot redirect the descriptor. The CLI never supplies hooks.
    hooks.afterOpen?.();
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(65_536, MAX_MSA_INPUT_BYTES + 1 - total));
      const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_MSA_INPUT_BYTES) {
        throw new Error(`Input FASTA cannot exceed ${MAX_MSA_INPUT_BYTES.toLocaleString()} bytes`);
      }
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function writeMsaPayload(outputPath, payload, force = false) {
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (outputPath === '-') {
    process.stdout.write(json);
    return null;
  }
  const resolved = resolve(outputPath);
  if (existsSync(resolved) && !force) throw new Error(`Output already exists: ${resolved}. Pass --force to replace it.`);
  const outputDirectory = dirname(resolved);
  assertRealDirectoryChain(outputDirectory);
  mkdirSync(outputDirectory, { recursive: true });
  assertRealDirectoryChain(outputDirectory);
  const temporaryDirectory = mkdtempSync(join(outputDirectory, '.motif-msa-output-'));
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

function assertRealDirectoryChain(directory) {
  const isKnownSystemAlias = (path) => process.platform === 'darwin'
    && (path === '/var' || path === '/tmp');
  let current = resolve(directory);
  while (true) {
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const parent = dirname(current);
        if (parent === current) return;
        current = parent;
        continue;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      if (!isKnownSystemAlias(current)) {
        throw new Error(`MSA output directory must not traverse a symbolic link: ${current}`);
      }
      const parent = dirname(current);
      if (parent === current) return;
      current = parent;
      continue;
    }
    if (!stat.isDirectory()) {
      throw new Error(`MSA output parent must be a real directory: ${current}`);
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
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

if (!isMainThread && workerData?.type === PROCESS_GUARD_WORKER) {
  try {
    writeWorkerResponse(workerData.sharedResponse, await superviseProcess(workerData.request));
  } catch (error) {
    writeWorkerResponse(workerData.sharedResponse, {
      status: null,
      signal: null,
      errorCode: error?.code ?? 'PROCESS_GUARD_ERROR',
      errorMessage: error instanceof Error ? error.message : String(error),
      stdoutBase64: '',
      stderrBase64: '',
    });
  }
} else if (isMain) {
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
