#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function readJson(workspace, relativePath) {
  return JSON.parse(readFileSync(join(workspace, relativePath), 'utf8'));
}

function read(workspace, relativePath) {
  return readFileSync(join(workspace, relativePath), 'utf8');
}

function gitRevision(revision, cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', revision], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function gitRefExists(ref, cwd) {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', ref], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error('Cannot inspect ' + ref + ': ' + ((result.stderr ?? '').trim() || 'git show-ref failed'));
}

export function assertVersionTagMatchesHead(version, cwd = root) {
  const tag = 'v' + version;
  const tagRef = 'refs/tags/' + tag;
  if (!gitRefExists(tagRef, cwd)) return { tag, status: 'unpublished' };
  const tagCommit = gitRevision(tagRef + '^{commit}', cwd);
  if (tagCommit === null) throw new Error(tag + ' exists but does not resolve to a commit; refusing to build a colliding release');
  const headCommit = gitRevision('HEAD^{commit}', cwd);
  if (headCommit === null) throw new Error('Cannot resolve the current Git commit for release alignment');
  if (tagCommit !== headCommit) {
    throw new Error(`${tag} already identifies ${tagCommit}; current HEAD is ${headCommit}. Bump the release version before building.`);
  }
  return { tag, status: 'current', commit: headCommit };
}

export function checkReleaseAlignment(cwd = root) {
  const workspace = resolve(cwd);
  const packageVersion = readJson(workspace, 'package.json').version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(packageVersion)) {
    throw new Error(`package.json has an invalid release version: ${packageVersion}`);
  }
  const lock = readJson(workspace, 'package-lock.json');
  const plugin = readJson(workspace, 'src/artifacts/motif-for-claude-science-plugin/.claude-plugin/plugin.json');
  const stdioServer = read(workspace, 'mcp/motif/stdio-server.ts');
  const surfaces = [
    ['package-lock.json', lock.version],
    ['package-lock root entry', lock.packages?.['']?.version],
    ['plugin manifest', plugin.version],
    ['artifact runtime', read(workspace, 'src/artifacts/motif-artifact.tsx').match(/const MOTIF_ARTIFACT_VERSION = '([^']+)'/u)?.[1]],
    ['MCP App bridge', read(workspace, 'src/mcp-app/motif-workbench-bridge.ts').match(/name: 'Motif for Claude Science', version: '([^']+)'/u)?.[1]],
    ['MCP stdio fallback', stdioServer.match(/async function readVersion\([^)]*\): Promise<string>[\s\S]*?return '([^']+)'[;]?\s*\}\s*async function readRuntimeBuildId/u)?.[1]],
  ];
  for (const [label, value] of surfaces) {
    if (value !== packageVersion) throw new Error(`${label} is ${String(value)}, expected ${packageVersion}`);
  }
  const changelogs = [
    ['CHANGELOG.md', read(workspace, 'CHANGELOG.md')],
    ['plugin CHANGELOG.md', read(workspace, 'src/artifacts/motif-for-claude-science-plugin/CHANGELOG.md')],
  ];
  for (const [label, contents] of changelogs) {
    if (!new RegExp(`^## ${packageVersion}(?:\\s|$)`, 'mu').test(contents)) {
      throw new Error(`${label} has no release entry for ${packageVersion}`);
    }
  }
  const requiredDocs = [
    ['AGENTS.md', `Current release version is \`${packageVersion}\``],
    ['docs/CLAUDE_SCIENCE_INTEGRATION.md', `Connector version: \`${packageVersion}\``],
  ];
  for (const [relativePath, marker] of requiredDocs) {
    if (!read(workspace, relativePath).includes(marker)) throw new Error(`${relativePath} does not declare ${packageVersion}`);
  }
  return { version: packageVersion, surfaces: surfaces.length + changelogs.length + requiredDocs.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkReleaseAlignment();
    console.log(`Release alignment passed: ${result.version} across ${result.surfaces} surfaces.`);
  } catch (error) {
    console.error(`Release alignment failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
