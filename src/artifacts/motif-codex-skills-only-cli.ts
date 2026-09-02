#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MOTIF_MCP_LIMITS, prepareMotifWorkbench } from '../../mcp/motif/payload.js';

const MAX_PAYLOAD_BYTES = MOTIF_MCP_LIMITS.maxPayloadBytes;
const MAX_TEMPLATE_BYTES = 40 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 40 * 1024 * 1024;
const BUILD_ID_PATTERN = /<meta name="motif-build-id" content="([a-f0-9]{64})"\s*\/?>/u;
const DATA_TAG_PATTERN = /(<script type="application\/json" id="motif-artifact-data">)([\s\S]*?)(<\/script>)/u;

type Options = {
  contentPath?: string;
  payloadPath?: string;
  outPath?: string;
  filename?: string;
  title?: string;
  molecule?: 'dna' | 'rna' | 'protein';
  topology?: 'linear' | 'circular';
  force: boolean;
  help: boolean;
};

function usage(): string {
  return `Create a self-contained Motif HTML workbench without a hosted service.

Usage:
  create-workbench.mjs (--content <path|-> | --payload <path|->) --out <html> [options]

Options:
  --content <path|->       FASTA, GenBank, raw sequence, or Motif JSON input
  --payload <path|->       Structured Motif JSON payload
  --out <html>             Output HTML path
  --filename <name>        Source filename hint when reading standard input
  --title <text>           Workspace title
  --molecule <type>        dna, rna, or protein for ambiguous raw sequence text
  --topology <type>        linear or circular
  --force                  Replace an existing output file
  --help                    Show this help
`;
}

export function parseArgs(args: string[]): Options {
  const options: Options = { force: false, help: false };
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
    if (['--content', '--payload', '--out', '--filename', '--title', '--molecule', '--topology'].includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      index += 1;
      if (arg === '--content') options.contentPath = value;
      if (arg === '--payload') options.payloadPath = value;
      if (arg === '--out') options.outPath = value;
      if (arg === '--filename') options.filename = value;
      if (arg === '--title') options.title = value;
      if (arg === '--molecule') {
        if (!['dna', 'rna', 'protein'].includes(value)) throw new Error('--molecule must be dna, rna, or protein.');
        options.molecule = value as Options['molecule'];
      }
      if (arg === '--topology') {
        if (!['linear', 'circular'].includes(value)) throw new Error('--topology must be linear or circular.');
        options.topology = value as Options['topology'];
      }
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function readStdinBounded(maximumBytes: number): string {
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(64 * 1024);
    const bytes = readSync(0, chunk, 0, chunk.length, null);
    if (bytes === 0) break;
    total += bytes;
    if (total > maximumBytes) throw new Error(`Input exceeds the ${maximumBytes.toLocaleString()}-byte limit.`);
    chunks.push(chunk.subarray(0, bytes));
  }
  return Buffer.concat(chunks, total).toString('utf8');
}

function readBoundedText(path: string, maximumBytes: number): string {
  if (path === '-') return readStdinBounded(maximumBytes);
  const resolvedPath = resolve(path);
  const descriptor = openSync(resolvedPath, 'r');
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile()) throw new Error(`Input must be a regular file: ${resolvedPath}`);
    if (stat.size > maximumBytes) throw new Error(`Input exceeds the ${maximumBytes.toLocaleString()}-byte limit.`);
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

function writeArtifact(path: string, html: string, force: boolean): void {
  const outPath = resolve(path);
  if (!['.html', '.htm'].includes(extname(outPath).toLowerCase())) {
    throw new Error('--out must use an .html or .htm extension.');
  }
  if (existsSync(outPath) && !force) throw new Error(`Output already exists; pass --force to replace it: ${outPath}`);
  mkdirSync(dirname(outPath), { recursive: true });
  const temporaryPath = `${outPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporaryPath, html, { flag: 'wx', mode: 0o600 });
    if (force) {
      rmSync(outPath, { force: true });
      renameSync(temporaryPath, outPath);
    } else {
      // A hard link makes the no-overwrite promise atomic: if another process
      // creates the destination after our earlier check, this operation fails
      // instead of replacing that file.
      linkSync(temporaryPath, outPath);
      rmSync(temporaryPath);
    }
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function renderLocalArtifact(template: string, payload: Record<string, unknown>): string {
  if (!DATA_TAG_PATTERN.test(template)) {
    throw new Error('Bundled Motif resource is missing its embedded data tag.');
  }
  const payloadJson = JSON.stringify(payload)
    .replace(/</gu, '\\u003C')
    .replace(/>/gu, '\\u003E')
    .replace(/&/gu, '\\u0026')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029');
  const html = template.replace(
    DATA_TAG_PATTERN,
    (_match, openingTag: string, _payload: string, closingTag: string) => `${openingTag}${payloadJson}${closingTag}`,
  );
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new Error(`Motif artifact HTML exceeds ${MAX_ARTIFACT_BYTES.toLocaleString()} bytes.`);
  }
  return html;
}

export function main(args = process.argv.slice(2)): void {
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (!options.outPath) throw new Error('--out is required.');
  if (Boolean(options.contentPath) === Boolean(options.payloadPath)) {
    throw new Error('Provide exactly one of --content or --payload.');
  }

  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const templatePath = resolve(scriptDirectory, '..', 'resources', 'motif-artifact.html');
  const template = readBoundedText(templatePath, MAX_TEMPLATE_BYTES);
  const runtimeBuildId = BUILD_ID_PATTERN.exec(template)?.[1];
  if (!runtimeBuildId) throw new Error('Bundled Motif resource is missing its runtime build identity.');

  const inputPath = options.contentPath ?? options.payloadPath as string;
  const source = readBoundedText(
    inputPath,
    options.contentPath ? MOTIF_MCP_LIMITS.maxContentBytes : MAX_PAYLOAD_BYTES,
  );
  let payload: unknown;
  if (options.payloadPath) {
    try {
      payload = JSON.parse(source);
    } catch {
      throw new Error('Payload is not valid JSON.');
    }
  }
  const sourceName = options.filename ?? (inputPath === '-' ? undefined : basename(resolve(inputPath)));
  const workbench = prepareMotifWorkbench({
    ...(options.contentPath ? { content: source } : { payload }),
    ...(sourceName ? { filename: sourceName } : {}),
    ...(options.title ? { title: options.title } : {}),
    ...(options.molecule ? { molecule: options.molecule } : {}),
    ...(options.topology ? { topology: options.topology } : {}),
  });
  if (!workbench.payload) throw new Error('Input did not produce a Motif workspace payload.');
  const html = renderLocalArtifact(template, workbench.payload);
  writeArtifact(options.outPath, html, options.force);

  const outPath = resolve(options.outPath);
  const digest = createHash('sha256').update(html, 'utf8').digest('hex');
  process.stdout.write(`${JSON.stringify({
    schema: 'motif.local-workbench-receipt.v1',
    runtimeBuildId,
    sourceName: workbench.sourceName,
    recordCount: workbench.recordCount,
    residueCount: workbench.residueCount,
    bytes: Buffer.byteLength(html, 'utf8'),
    htmlSha256: digest,
    outputPath: outPath,
  }, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
