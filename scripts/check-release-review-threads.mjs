#!/usr/bin/env node

import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDirectScriptExecution } from './lib/direct-script.mjs';

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const RELEASE_LABELS = new Set(['release', 'release-pr']);

function readJsonFile(path) {
  const resolved = resolve(path);
  let stat;
  try {
    stat = lstatSync(resolved);
  } catch {
    throw new Error('Release review-thread input does not exist');
  }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Release review-thread input must be a regular file');
  if (stat.size > MAX_INPUT_BYTES) throw new Error('Release review-thread input exceeds the size limit');
  try {
    return JSON.parse(readFileSync(resolved, 'utf8'));
  } catch {
    throw new Error('Release review-thread input is not valid JSON');
  }
}

function pullRequestFromDocument(document) {
  const pullRequest = document?.pullRequest
    ?? document?.data?.repository?.pullRequest
    ?? document;
  if (!pullRequest || typeof pullRequest !== 'object' || Array.isArray(pullRequest)) {
    throw new Error('Release review-thread input has no pull request object');
  }
  return pullRequest;
}

function labelsFromPullRequest(pullRequest) {
  const labels = pullRequest.labels?.nodes ?? pullRequest.labels ?? [];
  if (!Array.isArray(labels)) throw new Error('Release pull request labels are not an array');
  return labels.map(label => typeof label === 'string' ? label : label?.name).filter(value => typeof value === 'string');
}

function isReleasePullRequest(pullRequest, labels) {
  return labels.some(label => RELEASE_LABELS.has(label.trim().toLowerCase()))
    || (typeof pullRequest.headRefName === 'string' && pullRequest.headRefName.startsWith('release/'));
}

function threadsFromPullRequest(pullRequest) {
  const value = pullRequest.reviewThreads ?? pullRequest.threads;
  const threads = Array.isArray(value) ? value : value?.nodes;
  if (!Array.isArray(threads)) throw new Error('Release review-thread input has no review thread list');
  const pageInfo = value && !Array.isArray(value) ? value.pageInfo : undefined;
  if (pageInfo?.hasNextPage === true) throw new Error('Release review-thread query returned an incomplete page');
  return threads;
}

function isCurrentUnresolvedThread(thread) {
  if (!thread || typeof thread !== 'object' || Array.isArray(thread)) {
    throw new Error('Release review-thread input contains an invalid thread');
  }
  // Missing isResolved/isOutdated values fail closed: only an explicit true
  // clears a thread from the release block.
  return thread.isResolved !== true && thread.isOutdated !== true;
}

/**
 * Validate the review state captured for an explicit release pull request.
 * The input shape is the small subset returned by GitHub's reviewThreads
 * GraphQL connection, making this check deterministic and testable offline.
 */
export function checkReleaseReviewThreads(document, { requireRelease = false } = {}) {
  const pullRequest = pullRequestFromDocument(document);
  const labels = labelsFromPullRequest(pullRequest);
  if (requireRelease && !isReleasePullRequest(pullRequest, labels)) {
    throw new Error('Release review-thread check requires a release/ branch or release label');
  }
  const threads = threadsFromPullRequest(pullRequest);
  const unresolvedCurrent = threads.filter(isCurrentUnresolvedThread);
  if (unresolvedCurrent.length > 0) {
    throw new Error(`Release pull request has ${unresolvedCurrent.length} unresolved current review thread${unresolvedCurrent.length === 1 ? '' : 's'}`);
  }
  return {
    pullRequestNumber: Number.isInteger(pullRequest.number) ? pullRequest.number : null,
    labels,
    threadCount: threads.length,
    unresolvedCurrent: 0,
  };
}

const REVIEW_THREADS_QUERY = `query($owner:String!, $repo:String!, $number:Int!) {
  repository(owner:$owner, name:$repo) {
    pullRequest(number:$number) {
      number
      headRefName
      labels(first:20) { nodes { name } }
      reviewThreads(first:100) {
        nodes { isResolved isOutdated }
        pageInfo { hasNextPage }
      }
    }
  }
}`;

function githubPullRequestNumber(eventPath) {
  const event = readJsonFile(eventPath);
  const number = event?.pull_request?.number;
  if (!Number.isInteger(number) || number < 1) throw new Error('GitHub event does not identify a pull request number');
  return number;
}

function readGithubThreads({ environment = process.env, pullRequestNumber = null, repository = null } = {}) {
  const repo = repository ?? environment.GITHUB_REPOSITORY;
  if (typeof repo !== 'string' || !/^[^/]+\/[^/]+$/u.test(repo)) {
    throw new Error('GitHub review-thread check requires GITHUB_REPOSITORY=owner/name');
  }
  const eventPath = environment.GITHUB_EVENT_PATH;
  if (pullRequestNumber === null && typeof eventPath !== 'string') {
    throw new Error('GitHub review-thread check requires a pull request event payload');
  }
  const number = pullRequestNumber ?? githubPullRequestNumber(eventPath);
  const [owner, name] = repo.split('/');
  const result = spawnSync('gh', [
    'api', 'graphql',
    '-f', `query=${REVIEW_THREADS_QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `repo=${name}`,
    '-F', `number=${number}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) throw new Error('GitHub review-thread query failed; verify GH_TOKEN and pull-request permissions');
  let document;
  try {
    document = JSON.parse(result.stdout ?? '');
  } catch {
    throw new Error('GitHub review-thread query returned invalid JSON');
  }
  if (!document?.data?.repository?.pullRequest) throw new Error('GitHub review-thread query returned no pull request');
  return document;
}

function parseArgs(args) {
  const options = { input: null, github: false, requireRelease: false, repository: null, pullRequestNumber: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--github') options.github = true;
    else if (arg === '--require-release') options.requireRelease = true;
    else if (arg === '--threads-file' || arg === '--repo' || arg === '--pr') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--threads-file') options.input = value;
      if (arg === '--repo') options.repository = value;
      if (arg === '--pr') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 1) throw new Error('--pr must be a positive integer');
        options.pullRequestNumber = number;
      }
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.input && options.github) throw new Error('Choose either --threads-file or --github, not both');
  if (!options.input && !options.github && !options.help) throw new Error('Provide --threads-file for an offline check or --github for the release workflow');
  return options;
}

function usage() {
  return `Check that an explicit release pull request has no unresolved current review threads.

Usage:
  node scripts/check-release-review-threads.mjs --threads-file <json> [--require-release]
  node scripts/check-release-review-threads.mjs --github --require-release
`;
}

if (isDirectScriptExecution(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(usage());
    else {
      const input = options.github
        ? readGithubThreads(options)
        : readJsonFile(options.input);
      const result = checkReleaseReviewThreads(input, { requireRelease: options.requireRelease });
      console.log(`Release review-thread check passed: ${result.threadCount} current thread${result.threadCount === 1 ? '' : 's'} inspected.`);
    }
  } catch (error) {
    console.error(`Release review-thread check failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
