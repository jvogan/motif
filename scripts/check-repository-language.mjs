#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DISALLOWED_STEM = String.fromCharCode(119, 101, 116);
const DISALLOWED_SUFFIX = String.fromCharCode(108, 97, 98);
const DISALLOWED_PATTERN = new RegExp(`${DISALLOWED_STEM}[ -]?${DISALLOWED_SUFFIX}`, 'iu');
const MAX_TRACKED_FILE_BYTES = 16 * 1024 * 1024;
const MAX_GITHUB_EVENT_BYTES = 2 * 1024 * 1024;
const MAX_GIT_METADATA_BYTES = 32 * 1024 * 1024;
const IMMUTABLE_COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu;

function isImmutableCommitId(value) {
  return typeof value === 'string' && IMMUTABLE_COMMIT_ID.test(value) && !/^0+$/u.test(value);
}

export function containsDisallowedRepositoryLanguage(value) {
  return DISALLOWED_PATTERN.test(String(value));
}

function git(workspace, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: workspace,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: MAX_GIT_METADATA_BYTES,
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

function collectStringLeaves(candidates, label, value, depth = 0) {
  if (typeof value === 'string') {
    candidates.push([label, value]);
    return;
  }
  if (value === null || value === undefined || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectStringLeaves(candidates, `${label}[${index}]`, entry, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  Object.entries(value).forEach(([key, entry]) => collectStringLeaves(candidates, `${label}.${key}`, entry, depth + 1));
}

function collectOptionalTree(candidates, label, value) {
  if (value !== undefined && value !== null) collectStringLeaves(candidates, label, value);
}

function githubEventCandidates(event) {
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

  for (const [label, value] of [
    ['push ref', event.ref],
    ['push base ref', event.base_ref],
    ['push head ref', event.head_ref],
    ['release target ref', event.release?.target_commitish],
  ]) {
    if (value !== undefined && value !== null) candidates.push([label, String(value)]);
  }

  if (Array.isArray(event.commits)) {
    event.commits.forEach((commit, index) => {
      if (typeof commit?.message === 'string') candidates.push([`push commit message ${index + 1}`, commit.message]);
    });
  }

  collectOptionalTree(candidates, 'pull request head repository metadata', event.pull_request?.head?.repo);
  collectOptionalTree(candidates, 'pull request base repository metadata', event.pull_request?.base?.repo);
  collectOptionalTree(candidates, 'repository parent metadata', event.repository?.parent);
  collectOptionalTree(candidates, 'repository source metadata', event.repository?.source);

  collectOptionalTree(candidates, 'pull request labels', event.pull_request?.labels);
  collectOptionalTree(candidates, 'pull request comments', event.pull_request?.comments);
  collectOptionalTree(candidates, 'pull request reviews', event.pull_request?.reviews);
  collectOptionalTree(candidates, 'pull request review comments', event.pull_request?.review_comments);
  collectOptionalTree(candidates, 'issue labels', event.issue?.labels);
  collectOptionalTree(candidates, 'issue comments', event.issue?.comments);
  collectOptionalTree(candidates, 'event label', event.label);
  collectOptionalTree(candidates, 'event labels', event.labels);

  for (const [key, label] of [
    ['comment', 'comment metadata'],
    ['comments', 'comments metadata'],
    ['issue_comment', 'issue comment metadata'],
    ['review', 'review metadata'],
    ['reviews', 'reviews metadata'],
    ['pull_request_review', 'pull request review metadata'],
    ['pull_request_review_comment', 'pull request review comment metadata'],
    ['review_comments', 'review comments metadata'],
    ['discussion', 'discussion metadata'],
    ['discussions', 'discussions metadata'],
    ['discussion_comment', 'discussion comment metadata'],
    ['discussion_comments', 'discussion comments metadata'],
  ]) {
    collectOptionalTree(candidates, label, event[key]);
  }

  if (Array.isArray(event.release?.assets)) {
    event.release.assets.forEach((asset, index) => {
      if (typeof asset?.name === 'string') candidates.push([`release asset name ${index + 1}`, asset.name]);
    });
  }

  return candidates;
}

function readGithubEvent(environment) {
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath === null || (typeof eventPath === 'string' && !eventPath.trim())) {
    if (environment.CI) throw new Error('Repository-language check requires a GitHub event payload in CI');
    return null;
  }
  if (typeof eventPath !== 'string') throw new Error('GitHub event payload path must be a string');
  const path = resolve(eventPath);
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error('Repository-language check could not find the GitHub event payload');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('GitHub event payload must be a regular file');
  if (stat.size > MAX_GITHUB_EVENT_BYTES) throw new Error('GitHub event payload exceeds the repository-language size limit');
  let event;
  try {
    event = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('GitHub event payload is not valid JSON');
  }
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('GitHub event payload must be a JSON object');
  }
  return event;
}

function localMetadataCandidates(workspace, environment) {
  const refs = git(workspace, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags']);
  const annotations = git(workspace, ['for-each-ref', '--format=%(contents)', 'refs/heads', 'refs/tags']);
  return [
    ['HEAD commit message', git(workspace, ['log', '-1', '--format=%B'])],
    ['current branch', git(workspace, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFailure: true })],
    ['all branch and tag ref names', refs],
    ['all branch and tag annotations', annotations],
    ['tags at HEAD', git(workspace, ['tag', '--points-at', 'HEAD', '--format=%(refname) %(contents)'])],
    ['CI head ref', environment.GITHUB_HEAD_REF ?? ''],
    ['CI ref name', environment.GITHUB_REF_NAME ?? ''],
    ['CI workflow ref', environment.GITHUB_REF ?? ''],
    ['CI ref type', environment.GITHUB_REF_TYPE ?? ''],
  ];
}

export function githubEventMetadataViolations(environment = process.env) {
  const event = readGithubEvent(environment);
  if (!event) return { violations: [], fields: 0 };
  const candidates = githubEventCandidates(event);
  return {
    violations: candidates
      .filter(([, value]) => containsDisallowedRepositoryLanguage(value))
      .map(([label]) => `GitHub event metadata: ${label}`),
    fields: candidates.length,
  };
}

function eventCommitRange(event, environment) {
  if (environment.MOTIF_REPOSITORY_LANGUAGE_SKIP_EVENT_RANGE === 'true') return null;
  const eventName = environment.GITHUB_EVENT_NAME;
  if (eventName && eventName !== 'push' && eventName !== 'pull_request') return null;
  const pullRequest = event.pull_request;
  const base = pullRequest?.base?.sha ?? event.before;
  const head = pullRequest?.head?.sha ?? event.after;
  if (base === undefined && head === undefined) return null;
  if (!isImmutableCommitId(base) || !isImmutableCommitId(head)) {
    throw new Error('GitHub event payload must provide full immutable base and head commits for the history scan');
  }
  return { base, head };
}

function eventCommitMessageCandidates(workspace, event, environment) {
  const range = eventCommitRange(event, environment);
  if (!range) return [];
  const messages = git(workspace, ['log', '--format=%B', '--no-decorate', `${range.base}..${range.head}`]);
  return [['event base-to-head commit messages', messages]];
}

function metadataViolations(workspace, environment) {
  const event = readGithubEvent(environment);
  const localCandidates = localMetadataCandidates(workspace, environment);
  const eventCandidates = event ? githubEventCandidates(event) : [];
  const historyCandidates = event ? eventCommitMessageCandidates(workspace, event, environment) : [];
  return {
    violations: [
      ...localCandidates
        .filter(([, value]) => containsDisallowedRepositoryLanguage(value))
        .map(([label]) => `metadata: ${label}`),
      ...eventCandidates
        .filter(([, value]) => containsDisallowedRepositoryLanguage(value))
        .map(([label]) => `GitHub event metadata: ${label}`),
      ...historyCandidates
        .filter(([, value]) => containsDisallowedRepositoryLanguage(value))
        .map(([label]) => `metadata: ${label}`),
    ],
    fields: localCandidates.length + eventCandidates.length + historyCandidates.length,
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
