#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  assertVersionTagMatchesHead,
  checkReleaseAlignment,
} from './check-release-alignment.mjs';
import { isDirectScriptExecution } from './lib/direct-script.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const GITHUB_RELEASE_QUERY = `query($owner:String!, $repo:String!, $tag:String!) {
  repository(owner:$owner, name:$repo) {
    release(tagName:$tag) { isDraft publishedAt }
  }
}`;

/**
 * Run checks that are only meaningful when publishing a release. Ordinary
 * alignment deliberately does not reject a post-tag development commit; this
 * check does, immediately before a tag or release is published.
 */
export function checkGithubReleaseAvailable(version, {
  environment = process.env,
  repository = environment.GITHUB_REPOSITORY,
  run = spawnSync,
} = {}) {
  if (typeof repository !== 'string' || !/^[^/]+\/[^/]+$/u.test(repository)) {
    throw new Error('GitHub release check requires GITHUB_REPOSITORY=owner/name');
  }
  const [owner, name] = repository.split('/');
  const result = run('gh', [
    'api', 'graphql',
    '-f', `query=${GITHUB_RELEASE_QUERY}`,
    '-f', `owner=${owner}`,
    '-f', `repo=${name}`,
    '-f', `tag=v${version}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: environment });
  if (result.status !== 0) {
    throw new Error('GitHub release check failed; verify GH_TOKEN and repository permissions');
  }
  let document;
  try {
    document = JSON.parse(result.stdout ?? '');
  } catch {
    throw new Error('GitHub release check returned invalid JSON');
  }
  const release = document?.data?.repository?.release;
  if (release && (release.isImmutable === true || release.isDraft !== true || release.publishedAt)) {
    throw new Error(`GitHub release v${version} already exists; publish checks refuse version reuse`);
  }
  return { version, repository, existingDraft: Boolean(release) };
}

export function checkReleasePublish(cwd = root, { github = false, environment = process.env, repository = null } = {}) {
  const alignment = checkReleaseAlignment(cwd);
  const tag = assertVersionTagMatchesHead(alignment.version, cwd);
  const githubRelease = github
    ? checkGithubReleaseAvailable(alignment.version, { environment, repository: repository ?? environment.GITHUB_REPOSITORY })
    : null;
  return { ...alignment, tag: tag.tag, tagStatus: tag.status, commit: tag.commit ?? null, githubRelease };
}

if (isDirectScriptExecution(process.argv[1], fileURLToPath(import.meta.url))) {
  try {
    const github = process.argv.includes('--github');
    const repositoryIndex = process.argv.indexOf('--repo');
    const repository = repositoryIndex >= 0 ? process.argv[repositoryIndex + 1] : null;
    if (repositoryIndex >= 0 && (!repository || repository.startsWith('--'))) throw new Error('--repo requires owner/name');
    const result = checkReleasePublish(root, { github, repository });
    const remote = github ? `; GitHub release availability checked${result.githubRelease?.existingDraft ? ' (draft exists)' : ''}` : '';
    console.log(`Release publish checks passed: ${result.version} alignment and ${result.tag} ${result.tagStatus}${remote}.`);
  } catch (error) {
    console.error(`Release publish checks failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
