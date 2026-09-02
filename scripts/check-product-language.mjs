#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PRODUCT_SURFACES = Object.freeze([
  'README.md',
  'docs/CODEX_QUICKSTART.md',
  'docs/CODEX_SKILLS_ONLY.md',
  'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/.codex-plugin/plugin.json',
  'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/README.md',
  'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/skills/motif-for-codex/SKILL.md',
  'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/skills/motif-for-codex/agents/openai.yaml',
  'src/artifacts/motif-codex-skills-only-plugin/motif/.codex-plugin/plugin.json',
  'src/artifacts/motif-codex-skills-only-plugin/motif/README.md',
  'src/artifacts/motif-codex-skills-only-plugin/motif/skills/motif/SKILL.md',
  'src/artifacts/motif-codex-skills-only-plugin/motif/skills/motif/agents/openai.yaml',
]);

export const DISALLOWED_PRODUCT_LANGUAGE = Object.freeze([
  ['blanket prohibition', /\bdo not use (?:Motif|for)\b/iu],
  ['user-supplied input requirement', /\bsupplied by the user\b/iu],
  ['exact-input activation requirement', /\b(?:must concern exact|without exact biological input)\b/iu],
  ['retrieval prohibition', /\b(?:does not|cannot|do not) retrieve\b/iu],
  ['alignment prohibition', /\b(?:does not|cannot|do not) (?:compute|run) alignments?\b/iu],
  ['private filesystem path', /\/Users\//u],
  ['private repository reference', /\bmotif-private\b/iu],
  ['internal campaign reference', /\bcampaign[- ]\d+\b/iu],
  ['portal readiness metadata', /\b(?:portal[_ -]validation|submission[_ -]readiness)\b/iu],
]);

export function productLanguageViolations(relativePath, text) {
  return DISALLOWED_PRODUCT_LANGUAGE
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => `${relativePath}: ${label}`);
}

export function checkProductLanguage(workspace = root) {
  const violations = PRODUCT_SURFACES.flatMap((relativePath) => {
    const text = readFileSync(join(workspace, relativePath), 'utf8');
    return productLanguageViolations(relativePath, text);
  });

  const fullManifest = JSON.parse(readFileSync(join(
    workspace,
    'src/artifacts/motif-for-codex-plugin/motif-for-claude-science/.codex-plugin/plugin.json',
  ), 'utf8'));
  const requiredCapabilities = [
    'Interactive molecular-biology workbench',
    'Sequence editing and annotation',
    'Alignment and variant comparison',
    'Sequence maps, traces, and cloning workflows',
    'Portable HTML and data exports',
  ];
  for (const capability of requiredCapabilities) {
    if (!fullManifest.interface?.capabilities?.includes(capability)) {
      violations.push(`Codex plugin manifest: missing capability "${capability}"`);
    }
  }
  if (fullManifest.mcpServers !== './.mcp.json') {
    violations.push('Codex plugin manifest: missing MCP server configuration');
  }

  const skillsManifest = JSON.parse(readFileSync(join(
    workspace,
    'src/artifacts/motif-codex-skills-only-plugin/motif/.codex-plugin/plugin.json',
  ), 'utf8'));
  if (skillsManifest.skills !== './skills/') {
    violations.push('Codex skills-only manifest: missing skill configuration');
  }

  return violations;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const violations = checkProductLanguage();
  if (violations.length > 0) {
    process.stderr.write(`Product language check failed:\n- ${violations.join('\n- ')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`Product language check passed across ${PRODUCT_SURFACES.length} public surfaces.\n`);
  }
}
