#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const submission = JSON.parse(await readFile(new URL('docs/openai-submission.json', root), 'utf8'));
const catalog = JSON.parse(await readFile(new URL('evals/codex-plugin-activation/catalog.json', root), 'utf8'));
const manifest = JSON.parse(await readFile(
  new URL('src/artifacts/motif-for-codex-plugin/motif-for-claude-science/.codex-plugin/plugin.json', root),
  'utf8',
));

assert.equal(submission.schema_version, 'motif-openai-submission/v1');
assert.equal(submission.submission_readiness.status, 'blocked');
assert.equal(submission.submission_readiness.recommended_type, 'With MCP');
assert.equal(submission.submission_readiness.skills_only_eligible, false);
assert.equal(submission.submission_readiness.upload_archive, null);
assert.ok(
  submission.submission_readiness.blockers.some(blocker => blocker.includes('skill-only ZIP')),
  'the draft must explain why the current MCP-dependent skill is not a skill-only upload',
);
assert.equal(submission.archive_preparation.local_full_plugin, 'dist-motif/motif-for-codex.zip');
assert.equal(submission.archive_preparation.candidate_status, 'local-candidate-built');
assert.equal(submission.archive_preparation.final_build_command, 'npm run build:codex-plugin');
assert.deepEqual(submission.archive_preparation.final_verification_commands, [
  'npm run test:codex-plugin',
  'npm run codex:doctor',
  'npm run check:openai-submission',
]);
assert.equal(submission.archive_preparation.public_portal_upload, null);
assert.deepEqual(submission.archive_preparation.required_root_entries, [
  '.codex-plugin/plugin.json',
  '.mcp.json',
  'skills/motif-for-codex/SKILL.md',
  'skills/motif-for-codex/agents/openai.yaml',
  'server/motif-mcp-server.mjs',
  'server/motif-mcp-app.html',
]);

const banner = submission.listing_assets.repository_banner;
const bannerBytes = await readFile(new URL(banner.path, root));
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
assert.deepEqual(bannerBytes.subarray(0, 8), pngSignature, 'repository banner must be a PNG');
assert.equal(bannerBytes.readUInt32BE(16), banner.width, 'repository banner width drifted');
assert.equal(bannerBytes.readUInt32BE(20), banner.height, 'repository banner height drifted');
assert.equal(createHash('sha256').update(bannerBytes).digest('hex'), banner.sha256, 'repository banner digest drifted');
assert.equal(banner.portal_logo_eligible, false);
const portalLogo = submission.listing_assets.portal_logo;
const portalLogoBytes = await readFile(new URL(portalLogo.path, root));
assert.deepEqual(portalLogoBytes.subarray(0, 8), pngSignature, 'portal logo must be a PNG');
assert.equal(portalLogoBytes.readUInt32BE(16), portalLogo.width, 'portal logo width drifted');
assert.equal(portalLogoBytes.readUInt32BE(20), portalLogo.height, 'portal logo height drifted');
assert.equal(portalLogo.width, portalLogo.height, 'portal logo must be square');
assert.equal(portalLogo.width, 1024, 'portal logo candidate must preserve the reviewed 1024px source');
assert.equal(createHash('sha256').update(portalLogoBytes).digest('hex'), portalLogo.sha256, 'portal logo digest drifted');
assert.deepEqual(portalLogo.manifest_uses, [
  'interface.logo',
  'interface.composerIcon',
  'skill.interface.icon_small',
  'skill.interface.icon_large',
]);
assert.equal(submission.listing_assets.portal_logo_status, 'prepared-local-candidate');

assert.equal(submission.mcp_review.status, 'waiting-for-public-endpoint');
assert.equal(submission.mcp_review.production_mcp_url, null);
assert.equal(submission.mcp_review.domain_verification, null);
assert.equal(submission.mcp_review.demo_recording_url, null);
assert.deepEqual(
  submission.mcp_review.tool_annotations.map(entry => entry.tool),
  ['motif_open_workbench', 'motif_create_workbench_artifact'],
);
for (const entry of submission.mcp_review.tool_annotations) {
  assert.equal(entry.readOnlyHint, true, `${entry.tool}: readOnlyHint must match the reviewed server`);
  assert.equal(entry.openWorldHint, false, `${entry.tool}: openWorldHint must match the reviewed server`);
  assert.equal(entry.destructiveHint, false, `${entry.tool}: destructiveHint must match the reviewed server`);
  for (const key of ['readOnlyJustification', 'openWorldJustification', 'destructiveJustification']) {
    assert.equal(typeof entry[key], 'string', `${entry.tool}: ${key} is required`);
    assert.ok(entry[key].length > 0, `${entry.tool}: ${key} must not be empty`);
  }
}
assert.deepEqual(submission.mcp_review.screenshots.files, []);

const listing = submission.listing;
assert.equal(listing.plugin_name, 'Motif');
assert.equal(listing.publisher, 'Jacob Vogan');
assert.equal(listing.type, 'With MCP');
assert.ok(listing.plugin_name.length <= 30, 'display name must fit the 30-character directory field');
assert.ok(listing.subtitle.length > 0 && listing.subtitle.length <= 30, 'subtitle must fit the 30-character portal field');
assert.match(listing.website_url, /^https:\/\//u);
assert.match(listing.support_url, /^https:\/\//u);
assert.match(listing.privacy_url, /^https:\/\//u);
assert.match(listing.terms_url, /^https:\/\//u);
assert.ok(listing.description.length > 0 && listing.description.length <= 4_000, 'listing description must fit the directory field');
assert.ok(listing.publisher.length <= 80, 'publisher must fit the 80-character directory field');
assert.equal(listing.subtitle, manifest.interface.shortDescription, 'portal subtitle must match the plugin manifest');
assert.equal(listing.description, manifest.interface.longDescription, 'portal description must match the plugin manifest');

assert.equal(submission.starter_prompts.length, 3, 'the portal draft must contain three starter prompts');
assert.deepEqual(
  submission.starter_prompts,
  manifest.interface.defaultPrompt,
  'portal starter prompts must match the plugin manifest',
);
for (const [index, prompt] of submission.starter_prompts.entries()) {
  assert.ok(prompt.length > 0 && prompt.length <= 128, `starter prompt ${index + 1} must fit the 128-character portal field`);
  assert.doesNotMatch(prompt, /[\r\n]/u, `starter prompt ${index + 1} must stay on one line`);
  assert.doesNotMatch(prompt, /@[A-Za-z0-9_-]+/u, `starter prompt ${index + 1} must not contain an app mention`);
  assert.doesNotMatch(prompt, /receipt|route|schema|authorization|integrity/iu, `starter prompt ${index + 1} should use plain language`);
}
assert.equal(new Set(submission.starter_prompts.map(prompt => prompt.normalize().replace(/\s+/gu, ' ').trim())).size, 3);

assert.ok(manifest.interface.capabilities.length <= 20);
for (const capability of manifest.interface.capabilities) {
  assert.ok(capability.length > 0 && capability.length <= 120);
  assert.doesNotMatch(capability, /[\r\n]/u);
}

const catalogById = new Map(catalog.cases.map(entry => [entry.id, entry]));
const positives = submission.activation_tests.positive;
const negatives = submission.activation_tests.negative;
assert.equal(positives.length, 5, 'the prepared portal set must contain five positive cases');
assert.equal(negatives.length, 3, 'the prepared portal set must contain three negative cases');

for (const entry of [...positives, ...negatives]) {
  const source = catalogById.get(entry.id);
  assert.ok(source, `submission case is missing from the canonical activation catalog: ${entry.id}`);
  assert.equal(entry.user_prompt, source.prompt, `${entry.id}: portal prompt drifted from the canonical activation catalog`);
  assert.equal(typeof entry.expected_behavior, 'string', `${entry.id}: expected behavior is required`);
}

for (const entry of positives) {
  assert.equal(typeof entry.expected_result_shape, 'string', `${entry.id}: expected result shape is required`);
  assert.equal(typeof entry.fixture_requirements, 'string', `${entry.id}: fixture requirements are required`);
}

for (const entry of negatives) {
  assert.equal(typeof entry.reason, 'string', `${entry.id}: negative activation reason is required`);
}

assert.ok(submission.release_notes.length > 0, 'release notes are required');
assert.ok(Array.isArray(submission.portal_only_checks) && submission.portal_only_checks.length > 0);

process.stdout.write(
  `OpenAI submission draft valid: ${submission.starter_prompts.length} starter prompts, ${positives.length} positive cases, ${negatives.length} negative cases; upload remains blocked.\n`,
);
