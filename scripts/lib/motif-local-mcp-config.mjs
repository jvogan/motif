import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export const MOTIF_LOCAL_CONNECTOR_NAME = 'motif-local';
export const DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH = join(
  homedir(),
  '.claude-science',
  'mcp',
  'local-mcp.json',
);

const MANAGED_ENVIRONMENT_KEYS = ['MOTIF_NODE_BIN', 'MOTIF_ROOT'];

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRegularFile(path, purpose) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    throw new Error(`${purpose} must not be a symbolic link: ${path}`);
  }
  if (!stat.isFile()) throw new Error(`${purpose} must be a regular file: ${path}`);
  return stat;
}

function executable(path) {
  try {
    assertRegularFile(path, 'Node.js executable');
    return Boolean(lstatSync(path).mode & 0o111);
  } catch {
    return false;
  }
}

export function resolveNodeBinary({ environment = process.env, current = process.execPath } = {}) {
  const configured = environment.MOTIF_NODE_BIN;
  if (configured) {
    if (!isAbsolute(configured) || !executable(configured)) {
      throw new Error('MOTIF_NODE_BIN must be an absolute path to an executable regular file');
    }
    return configured;
  }

  const candidates = [
    current,
    '/opt/homebrew/bin/node',
    '/usr/local/bin/node',
    '/usr/local/opt/node/bin/node',
  ];
  const found = candidates.find(candidate => isAbsolute(candidate) && executable(candidate));
  if (!found) {
    throw new Error('Could not locate an absolute Node.js executable for the Motif connector');
  }
  return found;
}

export function connectorPaths(rootPath) {
  const root = resolve(rootPath);
  return {
    root,
    launcher: join(root, 'scripts', 'run-motif-claude-science-mcp.sh'),
    server: join(root, 'dist-motif', 'claude-science', 'motif-mcp-server.mjs'),
    app: join(root, 'dist-motif', 'claude-science', 'motif-mcp-app.html'),
    template: join(root, 'dist-motif', 'motif-template.html'),
  };
}

export function preflightConnectorFiles(rootPath, { requireBuild = true } = {}) {
  const paths = connectorPaths(rootPath);
  assertRegularFile(paths.launcher, 'Motif connector launcher');
  if (!(lstatSync(paths.launcher).mode & 0o111)) {
    throw new Error(`Motif connector launcher is not executable: ${paths.launcher}`);
  }

  if (requireBuild) {
    assertRegularFile(paths.server, 'Motif MCP server bundle');
    assertRegularFile(paths.app, 'Motif MCP App resource');
    assertRegularFile(paths.template, 'Motif standalone artifact template');
  }
  return paths;
}

export function desiredMotifLocalServer(rootPath, options = {}) {
  const paths = connectorPaths(rootPath);
  const nodeBinary = options.nodeBinary ?? resolveNodeBinary(options);
  return {
    name: MOTIF_LOCAL_CONNECTOR_NAME,
    command: '/bin/bash',
    args: [paths.launcher],
    env: {
      MOTIF_NODE_BIN: nodeBinary,
      MOTIF_ROOT: paths.root,
    },
  };
}

export function validateLocalMcpConfig(config) {
  if (!isPlainObject(config) || !Array.isArray(config.servers)) {
    throw new Error('Claude Science local MCP config must be an object with a servers array');
  }
  const managedEntries = config.servers.filter(
    server => isPlainObject(server) && server.name === MOTIF_LOCAL_CONNECTOR_NAME,
  );
  if (managedEntries.length > 1) {
    throw new Error(`Claude Science local MCP config has duplicate ${MOTIF_LOCAL_CONNECTOR_NAME} entries`);
  }
  return config;
}

export function readLocalMcpConfig(configPath) {
  if (!existsSync(configPath)) {
    return {
      config: { servers: [] },
      originalBytes: null,
      fingerprint: null,
    };
  }

  const stat = assertRegularFile(configPath, 'Claude Science local MCP config');
  const originalBytes = readFileSync(configPath);
  let parsed;
  try {
    parsed = JSON.parse(originalBytes.toString('utf8'));
  } catch {
    throw new Error('Claude Science local MCP config is not valid JSON');
  }
  return {
    config: validateLocalMcpConfig(parsed),
    originalBytes,
    fingerprint: {
      dev: stat.dev,
      ino: stat.ino,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    },
  };
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function describeMotifLocalMismatch(server, desired) {
  if (!server) return ['entry is missing'];
  const mismatches = [];
  if (server.command !== desired.command) mismatches.push('command');
  if (!arraysEqual(server.args, desired.args)) mismatches.push('args');
  if (!isPlainObject(server.env)) {
    mismatches.push('env');
  } else {
    for (const key of MANAGED_ENVIRONMENT_KEYS) {
      if (server.env[key] !== desired.env[key]) mismatches.push(`env.${key}`);
    }
  }
  return mismatches;
}

export function motifLocalServerMatches(server, desired) {
  return describeMotifLocalMismatch(server, desired).length === 0;
}

export function installMotifLocalServer(config, desired) {
  validateLocalMcpConfig(config);
  const index = config.servers.findIndex(
    server => isPlainObject(server) && server.name === MOTIF_LOCAL_CONNECTOR_NAME,
  );
  if (index < 0) {
    return {
      changed: true,
      config: { ...config, servers: [...config.servers, desired] },
    };
  }

  const existing = config.servers[index];
  if (motifLocalServerMatches(existing, desired)) return { changed: false, config };
  const updated = {
    ...existing,
    ...desired,
    env: {
      ...(isPlainObject(existing.env) ? existing.env : {}),
      ...desired.env,
    },
  };
  const servers = [...config.servers];
  servers[index] = updated;
  return { changed: true, config: { ...config, servers } };
}

export function removeMotifLocalServer(config) {
  validateLocalMcpConfig(config);
  const servers = config.servers.filter(
    server => !(isPlainObject(server) && server.name === MOTIF_LOCAL_CONNECTOR_NAME),
  );
  if (servers.length === config.servers.length) return { changed: false, config };
  return { changed: true, config: { ...config, servers } };
}

function fingerprintMatches(path, expected) {
  if (!expected) return !existsSync(path);
  if (!existsSync(path)) return false;
  const current = assertRegularFile(path, 'Claude Science local MCP config');
  return current.dev === expected.dev
    && current.ino === expected.ino
    && current.size === expected.size
    && current.mtimeMs === expected.mtimeMs;
}

function backupTimestamp(now) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function allocateBackupPath(configPath, now) {
  const base = `${configPath}.before-motif-local-${backupTimestamp(now)}`;
  if (!existsSync(base)) return base;
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique Motif local MCP backup path');
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = openSync(directory, constants.O_RDONLY);
    fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function writeLocalMcpConfigAtomically(
  configPath,
  config,
  document,
  { now = new Date(), nonce = randomUUID() } = {},
) {
  validateLocalMcpConfig(config);
  const directory = dirname(configPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);

  if (!fingerprintMatches(configPath, document.fingerprint)) {
    throw new Error('Claude Science local MCP config changed during this operation; retry without overwriting it');
  }

  let backupPath = null;
  if (document.originalBytes) {
    backupPath = allocateBackupPath(configPath, now);
    const backupDescriptor = openSync(
      backupPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    try {
      writeFileSync(backupDescriptor, document.originalBytes);
      fsyncSync(backupDescriptor);
    } finally {
      closeSync(backupDescriptor);
    }
    chmodSync(backupPath, 0o600);
  }

  const temporaryPath = join(directory, `.${basename(configPath)}.tmp-${process.pid}-${nonce}`);
  let temporaryCreated = false;
  try {
    const descriptor = openSync(
      temporaryPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    temporaryCreated = true;
    try {
      writeFileSync(descriptor, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    chmodSync(temporaryPath, 0o600);

    if (!fingerprintMatches(configPath, document.fingerprint)) {
      throw new Error('Claude Science local MCP config changed during this operation; retry without overwriting it');
    }
    renameSync(temporaryPath, configPath);
    temporaryCreated = false;
    chmodSync(configPath, 0o600);
    syncDirectory(directory);
  } finally {
    if (temporaryCreated && existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }

  return { backupPath };
}

export function updateLocalMcpConfigFile({
  configPath = DEFAULT_CLAUDE_SCIENCE_CONFIG_PATH,
  desired,
  mode = 'install',
  dryRun = false,
  now,
  nonce,
}) {
  if (!['install', 'remove'].includes(mode)) throw new Error(`Unsupported config update mode: ${mode}`);
  if (mode === 'install' && (!isPlainObject(desired) || desired.name !== MOTIF_LOCAL_CONNECTOR_NAME)) {
    throw new Error(`Install mode requires a ${MOTIF_LOCAL_CONNECTOR_NAME} server definition`);
  }
  const document = readLocalMcpConfig(configPath);
  const result = mode === 'install'
    ? installMotifLocalServer(document.config, desired)
    : removeMotifLocalServer(document.config);
  if (!result.changed || dryRun) {
    return { ...result, backupPath: null, configPath };
  }
  const writeResult = writeLocalMcpConfigAtomically(configPath, result.config, document, { now, nonce });
  return { ...result, ...writeResult, configPath };
}
