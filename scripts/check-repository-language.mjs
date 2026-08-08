#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DISALLOWED_STEM = String.fromCharCode(119, 101, 116);
const DISALLOWED_SUFFIX = String.fromCharCode(108, 97, 98);
const DISALLOWED_PATTERN = new RegExp(`${DISALLOWED_STEM}[ -]?${DISALLOWED_SUFFIX}`, 'iu');
const MAX_TRACKED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_GITHUB_EVENT_BYTES = 2 * 1024 * 1024;

export function containsDisallowedRepositoryLanguage(value) {
  return DISALLOWED_PATTERN.test(String(value));
}

function git(workspace, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: workspace,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFailure) return '';
    throw new Error(`Repository-language check could not read Git metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function trackedPaths(workspace) {
  return git(workspace, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean);
}

function trackedViolations(workspace) {
  const violations = [];
  for (const relativePath of trackedPaths(workspace)) {
    if (containsDisallowedRepositoryLanguage(relativePath)) {
      violations.push(`tracked path: ${relativePath}`);
      continue;
    }
    const path = join(workspace, relativePath);
    const stat = lstatSync(path);
    if (!stat.isFile()) continue;
    if (stat.size > MAX_TRACKED_FILE_BYTES) {
      throw new Error(`Repository-language check refuses oversized tracked file: ${relativePath}`);
    }
    if (containsDisallowedRepositoryLanguage(readFileSync(path).toString('utf8'))) {
      violations.push(`tracked content: ${relativePath}`);
    }
  }
  return violations;
}

function localMetadataCandidates(workspace, environment) {
  return [
    ['HEAD commit message', git(workspace, ['log', '-1', '--format=%B'])],
    ['current branch', git(workspace, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFailure: true })],
    ['tags at HEAD', git(workspace, ['tag', '--points-at', 'HEAD', '--format=%(refname) %(contents)'])],
    ['CI head ref', environment.GITHUB_HEAD_REF ?? ''],
    ['CI ref name', environment.GITHUB_REF_NAME ?? ''],
    ['CI workflow ref', environment.GITHUB_REF ?? ''],
  ];
}

export function githubEventMetadataViolations(environment = process.env) {
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (!eventPath) return { violations: [], fields: 0 };
  const path = resolve(eventPath);
  if (!existsSync(path)) throw new Error('Repository-language check could not find the GitHub event payload');
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('GitHub event payload must be a regular file');
  if (stat.size > MAX_GITHUB_EVENT_BYTES) throw new Error('GitHub event payload exceeds the repository-language size limit');
  let event;
  try {
    event = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('GitHub event payload is not valid JSON');
  }
  const candidates = [
    ['repository name', event.repository?.name ?? ''],
    ['repository full name', event.repository?.full_name ?? ''],
    ['repository description', event.repository?.description ?? ''],
    ['repository homepage', event.repository?.homepage ?? ''],
    ['repository topics', Array.isArray(event.repository?.topics) ? event.repository.topics.join(' ') : ''],
    ['pull request title', event.pull_request?.title ?? ''],
    ['pull request body', event.pull_request?.body ?? ''],
    ['pull request head ref', event.pull_request?.head?.ref ?? ''],
    ['pull request base ref', event.pull_request?.base?.ref ?? ''],
    ['pull request milestone', event.pull_request?.milestone?.title ?? ''],
    ['issue title', event.issue?.title ?? ''],
    ['issue body', event.issue?.body ?? ''],
    ['issue milestone', event.issue?.milestone?.title ?? ''],
    ['release name', event.release?.name ?? ''],
    ['release body', event.release?.body ?? ''],
    ['release tag', event.release?.tag_name ?? ''],
    ['push head commit message', event.head_commit?.message ?? ''],
  ];
  return {
    violations: candidates
      .filter(([, value]) => containsDisallowedRepositoryLanguage(value))
      .map(([label]) => `GitHub event metadata: ${label}`),
    fields: candidates.length,
  };
}

function metadataViolations(workspace, environment) {
  const localCandidates = localMetadataCandidates(workspace, environment);
  const event = githubEventMetadataViolations(environment);
  return {
    violations: [
      ...localCandidates
        .filter(([, value]) => containsDisallowedRepositoryLanguage(value))
        .map(([label]) => `metadata: ${label}`),
      ...event.violations,
    ],
    fields: localCandidates.length + event.fields,
  };
}

export function checkRepositoryLanguage(workspace = root, environment = process.env) {
  const resolved = resolve(workspace);
  const metadata = metadataViolations(resolved, environment);
  const violations = [
    ...trackedViolations(resolved),
    ...metadata.violations,
  ];
  if (violations.length > 0) {
    throw new Error(`Disallowed repository vocabulary found:\n${violations.map(value => `- ${value}`).join('\n')}`);
  }
  return { trackedFiles: trackedPaths(resolved).length, metadataFields: metadata.fields };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkRepositoryLanguage();
    console.log(`Repository-language policy passed: ${result.trackedFiles} tracked files and ${result.metadataFields} metadata fields checked.`);
  } catch (error) {
    console.error(`Repository-language policy failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
