# Motif for Claude Science — Agent Guide

This is a portable artifact/plugin repository with a narrow Motif-owned MCP
App connector. Keep it independent of any desktop application, native
database, or predecessor identity.

## Start here

```bash
npm run typecheck
npm test
npm run preview:motif
```

Use `npm run typecheck`, never `npx tsc --noEmit`. The root `tsconfig.json` is
solution-style (`"files": []` plus project references), so `--noEmit` finds no
files and exits 0 unconditionally, while `tsc -b` follows the project
references. It is not a weaker check; it does not check this repository.
`scripts/__tests__/gate-parity.test.mjs` fails if the `typecheck` script drifts
to `--noEmit`.

For visible changes, open `preview/motif-artifact.html` in a real browser and
exercise wide, narrow, light, dark, resized-panel, mouse, and keyboard states.
A passing DOM assertion is not proof that a control is legible or reachable.

## Important paths

- `motif.html` — Vite entry
- `src/artifacts/motif-artifact.tsx` — standalone runtime entry
- `src/artifacts/motif-artifact.css` — artifact styling
- `src/artifacts/motif-for-claude-science-plugin/` — Claude plugin source
- `src/artifacts/motif-for-claude-science-skill/` — standalone skill
- `mcp/motif/` — bounded Motif MCP tools and resource registration
- `src/mcp-app/` — full-workbench MCP App bridge
- `scripts/build-claude-science-artifact.mjs` — deterministic distributable
- `scripts/build-preview.mjs` — isolated browser preview
- `e2e/` — focused real-browser workflow coverage

## Product contracts

- Product name: **Motif for Claude Science**
- Package/plugin slug: `motif-for-claude-science`
- Current release version is `0.2.1` and must stay aligned in runtime, package, manifest,
  and changelog.
- New schemas, environment variables, page APIs, output files, and provenance
  identifiers use `motif` / `MOTIF_` names.
- Do not reintroduce predecessor names or initials in public contracts. Do not
  claim that an older connector is Motif.
- `window.motifHelp()` is the runtime manifest for page-local APIs.

## Guardrails

- Keep the artifact self-contained and browser-safe.
- Do not add shell execution to the HTML or MSA runner. External engines must
  use argument-array spawning, exact-engine selection, bounded I/O, identity
  verification, and portable provenance.
- Do not set raw `innerHTML` from user-controlled data.
- Do not hardcode visual colors; use the artifact's CSS variables.
- Use vendor-neutral, behavior-based language in public comments, tests, docs,
  and commit messages; avoid competitor comparisons and machine-specific or
  private-repository references.
- Preserve `data-testid`, keyboard, focus, and ARIA contracts when changing UI.
- Treat Database JSON and workspace ZIP as portable checkpoints, not encrypted
  durable storage.
- Connector or remote-mutation changes require an explicit, separately
  reviewed integration change. Keep model-facing tools narrow and typed;
  never expose generic DOM, eval, shell, or filesystem bridges.

## Validation before handoff

```bash
npm run gate
```

That runs the same checks as CI, in the same order. Keeping the sequence in one
command avoids drift between contributor guidance and the workflow.
`scripts/__tests__/gate-parity.test.mjs` fails if `gate` and the workflow stop
agreeing in either direction.

Read the `N passed / N failed` summary line, not only the exit code of a
pipeline: `npm run test:e2e | tail -40` reports `tail`'s exit code. The browser
specs also self-skip when their environment variable is unset, so an exit code
of 0 can mean nothing ran.

Also run `npm run validate:plugin` when the Claude CLI is available. Report any
skips, external-tool assumptions, and generated output hashes explicitly.
