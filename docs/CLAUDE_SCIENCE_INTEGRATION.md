# Motif + Claude Science integration

Last reviewed: July 13, 2026. Connector version: `0.2.1`.

This is the maintainer and technical reference for the Motif-owned local
connector. End users should start with the
[quickstart](CLAUDE_SCIENCE_QUICKSTART.md) and use the
[troubleshooting guide](CLAUDE_SCIENCE_TROUBLESHOOTING.md) for recovery. This
reference covers the visible in-window workbench and the boundary between a
connected viewer and durable biological storage.

## What is implemented

Motif now owns three deliberately separate deliverables:

1. `motif-artifact.html` — a user-owned, click-to-open standalone workbench.
2. `motif-for-claude-science.zip` — a Claude plugin containing the skill,
   artifact, compiled MCP server, MCP App, and `.mcp.json` registration.
3. `dist-motif/claude-science/` — a local Claude Science connector build for
   development and hackathon use.

The local connector identity is visible end to end:

| Surface | Identity |
| --- | --- |
| Claude Science local registration | `motif-local` |
| MCP server | `motif-claude-science` |
| Open tool | `motif_open_workbench` |
| Saveable fallback | `motif_create_workbench_artifact` |
| MCP App resource | `ui://motif/workbench.html` |
| In-window product name | `Motif for Claude Science` |

The App is the full Motif workbench rather than a reduced sequence preview. A
small MCP Apps bridge receives the exact tool result and calls only Motif's
bounded workspace replacement API after the runtime is ready. It does not
expose DOM evaluation, a shell, or generic filesystem access.

## Build and protocol verification

Requires Node.js 22.12 or newer.

```bash
npm run claude-science:build
npm run claude-science:doctor:unregistered
```

The build writes:

```text
dist-motif/claude-science/motif-mcp-server.mjs
dist-motif/claude-science/motif-mcp-app.html
dist-motif/motif-template.html
```

The unregistered doctor launches the exact compiled wrapper with an allowlisted
environment and verifies:

- the two exact tool names and their schemas;
- standard MCP App metadata and the exact `ui://` resource;
- the MCP App MIME type and self-contained HTML;
- the Claude Science FASTA/GenBank artifact-viewer binding;
- a real FASTA open call and bounded record/residue counts;
- the embedded standalone-HTML fallback and checksum metadata; and
- privacy-safe tracing that does not echo sequence or inherited credentials.

## Register locally

The full setup command builds, doctors, installs, and checks in that order:

```bash
npm run claude-science:setup
```

The installer updates only the `motif-local` entry in:

```text
~/.claude-science/mcp/local-mcp.json
```

It preserves every unrelated server and unknown top-level field. Before a
changed config is written, it creates a private same-directory backup and uses
an atomic rename with a concurrency guard. It never prints config values.

After registration:

1. Grant only the exact Motif checkout read access. For least privilege, add
   it to `[sandbox].user_read_paths` in `~/.claude-science/config.toml`; the
   Permissions UI can also grant the folder.
2. Fully quit and reopen Claude Science so the host creates a new sandbox.
3. Reconnect `motif-local` in the connector UI.
4. Start a fresh kernel after changing tool schemas.

Check the installed entry at any time:

```bash
npm run claude-science:check-local
npm run claude-science:doctor
```

## Exercise the in-window workflow

The current Claude Science beta most reliably mounts local Apps through its
artifact viewer route:

1. Add a real `.fasta`, `.fa`, `.fna`, `.faa`, `.gb`, `.gbk`, `.gbff`,
   `.genbank`, or `.seq` artifact to the conversation.
2. Open the artifact's viewer chooser and select Motif when more than one
   connector claims the file type.
3. Confirm Claude Science chrome names `motif-local` and
   `motif_open_workbench`.
4. Confirm the workbench topbar visibly says **Motif** at embedded widths and
   **Motif for Claude Science** when space permits.
5. Verify record name, molecule, topology, residue count, sequence content,
   annotations, selection drag, map selection, theme, and pane resizing.

Calling `motif_open_workbench` directly is still useful, but this beta may show
only the text/tool result rather than automatically mounting a tile. That is a
host behavior, not permission to claim a frame opened. Use the artifact-viewer
route for the acceptance screenshot.

If a host cannot mount MCP Apps, call
`motif_create_workbench_artifact`. It returns a self-contained `text/html`
resource containing the validated payload. Opening that artifact requires a
click but does not depend on a live App lifecycle.

## Supported inputs and safety boundary

`motif_open_workbench` accepts exactly one of:

- a bounded Motif inventory payload; or
- exact FASTA, GenBank, raw sequence, or Motif JSON content plus an optional
  filename, title, molecule hint, and topology.

The connector enforces record, residue, feature, JSON-depth, node-count, text,
and byte limits before returning a UI result. GenBank records must contain the
complete `ORIGIN` sequence. Paths are reduced to a display-safe basename and
raw sequence content is not written to connector traces.

This first connector is intentionally ephemeral:

- it does not write SQLite, IndexedDB, or a hidden shared library;
- it does not run MAFFT, MUSCLE, Clustal Omega, BLAST, or a shell;
- it does not silently import into another application's workspace;
- it does not make the HTML an encrypted or regulated-data vault; and
- it does not bind binary AB1/ABI files to the text viewer route.

AB1/ABI remains supported through the standalone workbench's Add Entry and
drag-and-drop flows. A future connected binary artifact viewer needs a separate
bounded base64/binary contract and host acceptance pass.

## Rollback and troubleshooting

Remove only the managed local entry with:

```bash
npm run claude-science:remove-local
```

This leaves all unrelated connectors untouched and creates the same private
backup before a changed config is installed. The plugin `.mcp.json` is separate
from Claude Science's local config; removing one does not silently remove the
other.

If the connector does not appear:

1. Run `npm run claude-science:doctor:unregistered`.
2. Run `npm run claude-science:check-local`.
3. Fully quit and reopen Claude Science.
4. Reconnect `motif-local` and start a fresh kernel.
5. Confirm the exact folder grant, fully relaunch the app, then retry with a
   small FASTA artifact.

Connection logs prove transport only. A user-visible, correctly populated
Motif frame is the final acceptance evidence.

See [Motif + Claude Science troubleshooting](CLAUDE_SCIENCE_TROUBLESHOOTING.md)
for the `Operation not permitted` signature, reconnect matrix, immutable saved
artifact behavior, and final visual acceptance checklist.

## Next integration boundary

A durable growing sequence library is a separate campaign. It should add
transactional local storage, opaque record IDs, expected revisions,
idempotency receipts, rotating checksummed backups, explicit review before
inferred mutations, and restore drills. Do not extend this ephemeral viewer by
adding an unreviewed full-workspace mutation or generic host bridge.
