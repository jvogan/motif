# Use Motif with Codex through the full local plugin

Motif's full local Codex plugin opens DNA, RNA, protein, annotations,
alignments, traces, cloning designs, and results in the interactive workbench.
It includes the Motif skill, local MCP server, and App resource, and it can
also return a portable HTML workbench.

Build the package from a trusted Motif checkout. The build stages files for
installation; installation remains a separate command.

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
real MCP handshake, and sends a small synthetic FASTA request.

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
integrity, App resource, and a small tool call.

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

After `motif_open_workbench` succeeds, confirm that the interactive frame and
expected record are visible. `motif_create_workbench_artifact` returns the same
workbench as a portable HTML resource that the host can save.

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
  `motif_create_workbench_artifact`, save the returned HTML resource, and open
  it in the browser.
- **Input is rejected:** use supported Motif JSON, FASTA, GenBank, or raw
  sequence and keep the request within the limits reported by the connector.

For deeper package details, see the
[Codex plugin source README](../src/artifacts/motif-for-codex-plugin/motif-for-claude-science/README.md).
For safe issue reporting, see [SUPPORT.md](../SUPPORT.md).
