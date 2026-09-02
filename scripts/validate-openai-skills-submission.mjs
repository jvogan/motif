#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const submission = JSON.parse(await readFile(new URL('docs/openai-skills-only-submission.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(
  new URL('src/artifacts/motif-codex-skills-only-plugin/motif/.codex-plugin/plugin.json', root),
  'utf8',
));
const checksums = JSON.parse(await readFile(
  new URL('dist-motif/motif-0.4.0-skills-only-plugin.checksums.json', root),
  'utf8',
));
const archive = await readFile(new URL(submission.submission_readiness.upload_archive, root));

assert.equal(submission.schema_version, 'motif-openai-skills-submission/v1');
assert.equal(submission.submission_readiness.status, 'prepared-local-candidate');
assert.equal(submission.submission_readiness.recommended_type, 'Skills only');
assert.equal(submission.submission_readiness.hosted_service_required, false);
assert.equal(submission.submission_readiness.portal_validation_pending, true);
assert.equal(Object.hasOwn(manifest, 'mcpServers'), false);
assert.equal(Object.hasOwn(manifest, 'apps'), false);
assert.equal(manifest.skills, './skills/');
assert.equal(createHash('sha256').update(archive).digest('hex'), checksums.archiveSha256);

const listing = submission.listing;
assert.equal(listing.plugin_name, manifest.interface.displayName);
assert.equal(listing.subtitle, manifest.interface.shortDescription);
assert.equal(listing.description, manifest.interface.longDescription);
assert.equal(listing.category, manifest.interface.category);
assert.equal(listing.type, 'Skills only');
assert.ok(listing.plugin_name.length <= 30);
assert.ok(listing.subtitle.length > 0 && listing.subtitle.length <= 30);
for (const key of ['website_url', 'support_url', 'privacy_url', 'terms_url']) {
  assert.match(listing[key], /^https:\/\//u, `${key} must use HTTPS`);
}

assert.deepEqual(submission.starter_prompts, manifest.interface.defaultPrompt);
assert.equal(submission.starter_prompts.length, 3);
for (const [index, prompt] of submission.starter_prompts.entries()) {
  assert.ok(prompt.length > 0 && prompt.length <= 128, `starter prompt ${index + 1} must fit the portal field`);
  assert.doesNotMatch(prompt, /[\r\n]/u);
  assert.doesNotMatch(prompt, /receipt|route|schema|authorization|integrity/iu);
}

const positives = submission.activation_tests.positive;
const negatives = submission.activation_tests.negative;
assert.equal(positives.length, 5);
assert.equal(negatives.length, 3);
assert.equal(new Set([...positives, ...negatives].map(entry => entry.id)).size, 8);
for (const entry of positives) {
  for (const key of ['user_prompt', 'expected_behavior', 'expected_result_shape', 'fixture_requirements']) {
    assert.equal(typeof entry[key], 'string', `${entry.id}: ${key} is required`);
    assert.ok(entry[key].length > 0, `${entry.id}: ${key} must not be empty`);
  }
}
for (const entry of negatives) {
  for (const key of ['user_prompt', 'expected_behavior', 'reason']) {
    assert.equal(typeof entry[key], 'string', `${entry.id}: ${key} is required`);
    assert.ok(entry[key].length > 0, `${entry.id}: ${key} must not be empty`);
  }
}

assert.doesNotMatch(JSON.stringify(submission.archive_preparation), /motif_open_workbench|motif_create_workbench_artifact/u);
assert.ok(submission.release_notes.length > 0);
assert.ok(submission.portal_only_checks.length > 0);

process.stdout.write(
  `OpenAI skills-only submission candidate valid: ${submission.starter_prompts.length} starter prompts, ${positives.length} positive cases, ${negatives.length} negative cases; live portal validation remains pending.\n`,
);
