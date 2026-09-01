# Codex plugin activation evaluations

This catalog tests when the current local Motif Codex plugin should and should
not activate. It covers the reviewed two-tool connector only. It does not claim
that the private workspace-agent kernel is installed.

The catalog includes:

- five positive cases required for a future public submission;
- five negative cases, exceeding the required minimum of three; and
- direct, indirect, follow-up, ambiguous-domain, missing-input, and
  missing-capability prompts.

Run the structural validator with:

```bash
node evals/codex-plugin-activation/validate-catalog.mjs
```

`docs/openai-submission.json` selects the five positive and three negative cases
prepared for portal review. Validate that draft and its field limits with:

```bash
npm run check:openai-submission
```

The submission draft deliberately has no upload archive. Motif's current Codex
skill depends on its local MCP tools, so uploading the skill alone would not
provide the workbench described by the listing.

For local distribution, `npm run build:codex-plugin` creates the complete,
deterministic `dist-motif/motif-for-codex.zip`. The packaging test checks that
the archive contains the manifest, skill, MCP configuration, server, and App at
the expected root-relative paths. That local archive must not be mistaken for a
public Skills-only submission.

The skill's user-facing interface metadata lives in
`skills/motif-for-codex/agents/openai.yaml`. Do not move those fields into
`SKILL.md` frontmatter: OpenAI treats that metadata as instructions rather than
skill interface configuration.

Structural validation proves that the catalog is complete and internally
consistent. It does not prove model activation precision or recall. Before a
release, run the prompts in a clean Codex environment with only the intended
Motif plugin installed, record actual tool calls, and compare them with the
expected behavior without exposing private biological data.
