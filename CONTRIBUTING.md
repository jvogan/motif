# Contributing to Motif for Claude Science

Thank you for helping improve Motif. This repository is public, so every
commit, pull request, issue, test artifact, and CI log must be safe to publish.

## Protect data and credentials

Never include credentials, tokens, private filesystem paths, unpublished or
sensitive biological data, Claude Science workspace exports, local connector
configuration, or unredacted logs. Use a small synthetic sequence or a clearly
public record for examples and reproductions.

Report suspected vulnerabilities through the private process in
[SECURITY.md](SECURITY.md), not through a public issue.

## Set up and validate

Motif requires Node.js 22.13 or newer (22.x) or Node.js 24 or newer. Install
the locked dependencies with lifecycle scripts disabled, then run the checked
policy and reviewed lifecycle steps:

```bash
npm ci --ignore-scripts
npm run security:policy
npm run security:lifecycle
```

Before opening a pull request, run:

```bash
npm run gate
npm run validate:plugin
```

`npm run validate:plugin` requires the Claude CLI. If it is unavailable, say so
in the pull request and report every other completed check.

For a visible change, also run `npm run preview:motif` and exercise wide,
narrow, light, dark, resized-panel, mouse, and keyboard states in a real
browser. DOM assertions alone do not show whether a control is legible or
reachable.

## Keep the public boundary narrow

- Keep the artifact self-contained and browser-safe.
- Preserve keyboard, focus, ARIA, and `data-testid` contracts.
- Use Motif-owned public names for new schemas, environment variables, page
  APIs, output files, and provenance identifiers.
- Do not introduce raw HTML insertion from user-controlled data.
- Do not expose shell, eval, generic filesystem, or generic DOM bridges.
- Treat Database JSON and workspace ZIP files as ordinary, unencrypted
  checkpoints.
- Keep model-facing connector tools narrow, typed, and bounded.

Connector or remote-mutation changes need a separately reviewed integration
campaign. See [AGENTS.md](AGENTS.md) for the repository contracts and full
validation checklist.

## Pull requests

Keep each pull request focused, explain user-visible behavior and security
boundaries, and update tests and changelogs where applicable. Generated release
artifacts should come from a clean, validated commit and must not be committed
unless the repository explicitly tracks them. Maintainers should follow
[the release checklist](docs/RELEASING.md).
