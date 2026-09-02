# Use Motif with Codex through the full local plugin

Motif's Codex plugin lets Codex open supplied biological sequences in the
interactive workbench or return a portable HTML workbench. It runs a bounded
MCP server on your machine and does not require a hosted Motif service.

The current distribution is intended for local installation from a trusted
Motif checkout. Building the package does not install it or change Codex
configuration.

If you want the connector-free edition that only creates self-contained local
HTML workbenches, use the separate [Codex skills-only guide](CODEX_SKILLS_ONLY.md).

## Requirements

- Codex Desktop or a Codex CLI release with `codex plugin` support
- Node.js 22.13 or newer on the 22.x line, or Node.js 24 or newer
- a trusted Motif checkout in a stable local folder

The bundled MCP server starts with the `node` executable inherited by Codex.
If you change Node or `PATH`, restart Codex before testing again.

## 1. Prepare the local marketplace

From the Motif checkout:

```bash
npm ci --ignore-scripts
npm run security:policy
npm run security:lifecycle
npm run build:codex-marketplace
npm run codex:doctor:marketplace
```

The build stages a self-contained plugin and marketplace under
`.motif/codex-marketplace/`. The doctor verifies package integrity, performs a
real MCP handshake, and sends a tiny synthetic FASTA request. It does not open
a browser or modify Codex configuration.

## 2. Install the plugin

These are the two configuration-changing commands:

```bash
codex plugin marketplace add "$PWD/.motif/codex-marketplace"
codex plugin add motif-for-claude-science@motif-local
```

The identifier `motif-for-claude-science` is retained for compatibility; the
plugin is displayed as **Motif**. Restart Codex if the new local marketplace is
not visible, then start a new thread so it receives the installed skill and
tools.

## 3. Verify the installed package

From the Motif checkout, run the read-only installed-package doctor:

```bash
npm run codex:doctor:installed
```

It verifies the active profile, installed snapshot, MCP registration, package
integrity, App resource, and a small tool call. It does not install, enable,
remove, or restart the plugin.

In a new Codex thread, try:

```text
Open this sequence in Motif: >example
ATGAAATTTGGGCCCTAA
```

If no interactive frame appears, request the portable fallback:

```text
Create a portable Motif HTML workbench for: >example
ATGAAATTTGGGCCCTAA
```

A successful `motif_open_workbench` response proves that the local server
accepted the request, not that Codex mounted a visible frame. The
`motif_create_workbench_artifact` response is the supported fallback. It
returns a resource; save it through the host if you need a durable file.

## Update

After changing or updating the Motif checkout:

```bash
npm run build:codex-marketplace
npm run codex:doctor:marketplace
codex plugin add motif-for-claude-science@motif-local
npm run codex:doctor:installed
```

Then start a new thread. Codex installs a snapshot, so do not edit files in its
plugin cache. If Codex continues to resolve an older snapshot, remove the
installed plugin, confirm the marketplace path, and install it again.

## Remove

```bash
codex plugin remove motif-for-claude-science@motif-local
codex plugin marketplace remove motif-local
```

Check the configured marketplace name with
`codex plugin marketplace list` before removing it. Removing the plugin or
marketplace does not delete Motif HTML, JSON, ZIP, FASTA, GenBank, CLUSTAL, or
CSV files that you exported.

## Troubleshooting

- **The plugin is absent:** run `codex plugin list --available --json` and
  `codex plugin marketplace list`, then confirm the marketplace path exists.
- **The MCP server disconnects:** run `node --version` in the environment used
  to start Codex and confirm the supported Node version is available.
- **Tools are missing after installation:** start a new thread; if needed,
  restart Codex and run `codex plugin list --json`.
- **A tool succeeds but no workbench appears:** request
  `motif_create_workbench_artifact`; this is a host-mount issue, not evidence
  that Motif rejected the input.
- **Input is rejected:** use supported Motif JSON, FASTA, GenBank, or raw
  sequence and keep the request within the limits reported by the connector.

For deeper package details, see the
[Codex plugin source README](../src/artifacts/motif-for-codex-plugin/motif-for-claude-science/README.md).
For safe issue reporting, see [SUPPORT.md](../SUPPORT.md).
