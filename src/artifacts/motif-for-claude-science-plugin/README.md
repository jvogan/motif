# Motif for Claude Science plugin

Motif for Claude Science is a portable molecular-biology workbench packaged as
a self-contained HTML file and a Claude plugin. It supports annotated DNA, RNA,
and protein records; sequence and map inspection; restriction analysis;
multiple-sequence alignment; Sanger trace review; cloning and primer-design
workspaces; notes; and typed analysis results.

## Build outputs

From the repository root:

```bash
npm run build:motif
```

The deterministic build writes only to `dist-motif/`:

- `motif-template.html` — the self-contained template before payload injection
- `motif-artifact.html` — the ready-to-open standalone workbench
- `motif-for-claude-science/` — the unpacked Claude plugin
- `motif-for-claude-science.zip` — the Claude Code plugin archive
- `motif-for-claude-science.checksums.json` — archive and file SHA-256 values
- `motif-for-claude-science-skill/SKILL.md` — standalone compatibility skill
- `claude-science/motif-mcp-server.mjs` — compiled local connector
- `claude-science/motif-mcp-app.html` — full self-contained MCP App

The archive has `.claude-plugin/` at its root. For a session-only Claude Code
review, load either the archive or unpacked directory:

```bash
claude --plugin-dir ./dist-motif/motif-for-claude-science.zip
claude --plugin-dir ./dist-motif/motif-for-claude-science
```

The skill is namespaced as
`/motif-for-claude-science:motif-for-claude-science`.

The plugin also registers one MCP server named `motif` from its own bundled
`server/` directory. Hosts that support MCP Apps can call
`motif_open_workbench`; other hosts can call
`motif_create_workbench_artifact` for a self-contained HTML fallback. Review
and approve the local MCP server when the host prompts for plugin permissions.

## Connected workbench

`motif_open_workbench` accepts either a bounded Motif inventory payload or
exact FASTA, GenBank, raw sequence, or Motif JSON content. It returns a typed
`motif.mcp.workbench.v1` result and links `ui://motif/workbench.html`. The App
hydrates the full Motif interface after the runtime is ready; it does not use a
generic DOM or evaluation bridge.

The local Claude Science development setup is separate from Claude Code's
plugin registration. From the source repository, use:

```bash
npm run claude-science:setup
```

That command builds and doctors the connector before adding the isolated
`motif-local` entry. It preserves unrelated local connectors. Fully quit and
reopen Claude Science after granting the exact Motif checkout and changing a
registration, then reconnect `motif-local`.

Call `motif_open_workbench` with the complete sequence text and its exact
filename. Its structured result proves execution and parsing; only a visible
Motif frame proves that Claude Science mounted the MCP App. Current local/custom
connector builds may not offer Motif in the artifact viewer chooser, so use the
chooser only when Motif is actually listed. The host message
`Sequence viewer unavailable—showing as text` is a generic fallback, not a
Motif parse failure.

If no frame mounts, call `motif_create_workbench_artifact` with the same input
and a safe HTML output filename. Save the exact returned HTML resource and
click or open it in Claude Science's right pane. The workbench is interactive,
but the file is an immutable snapshot rather than a live MCP App.

The built plugin includes `docs/CLAUDE_SCIENCE_QUICKSTART.md` and
`docs/CLAUDE_SCIENCE_TROUBLESHOOTING.md`. The recovery guide contains the exact
read-only sandbox grant, restart boundary, and acceptance checklist. Local
connector development requires Node.js 22.12 or newer.

## Generate a preloaded workbench

The bundled helper validates a JSON payload before replacing the embedded data
slot. It accepts a path or standard input and refuses to overwrite an existing
output unless `--force` is explicit.

```bash
node ./skills/motif-for-claude-science/scripts/create-artifact.mjs \
  --payload ./inventory.json \
  --out ./motif-artifact.html
```

The top-level payload schema is `motif.claude-science.inventory.v1`. Payloads
may include records, alignments, Sanger traces attached to records, notes,
workflow history, typed analysis results, and inert text/JSON assets. HTML,
SVG, binary assets, malformed references, and over-limit data are rejected.

## External MSA runner

`scripts/run-msa.mjs` runs MAFFT, MUSCLE, or Clustal Omega outside the browser
and produces a validated Motif payload. The runner:

- spawns an argument array without a command shell;
- runs exactly the requested engine and never silently falls back;
- resolves an explicit executable, a Motif environment variable, the standard
  Claude Science `msa-tools` environment, or `PATH` in a documented order;
- maps output by generated safe FASTA IDs rather than row position;
- verifies that each ungapped output row equals its input; and
- records engine version, portable argv, executable and data hashes, discovery
  source, and `usedFallback: false` without leaking temporary paths or raw logs.

```bash
node ./skills/motif-for-claude-science/scripts/run-msa.mjs \
  --engine muscle --molecule dna --in ./unaligned.fasta \
  --out ./alignment-payload.json

node ./skills/motif-for-claude-science/scripts/create-artifact.mjs \
  --payload ./alignment-payload.json --out ./motif-artifact.html
```

Supported environment variables are `MOTIF_MSA_MAFFT_PATH`,
`MOTIF_MSA_MUSCLE_PATH`, `MOTIF_MSA_CLUSTAL_OMEGA_PATH`,
`MOTIF_MSA_EXECUTABLE`, and `MOTIF_MSA_TOOLS_DIR`. Invalid explicit
configuration is an error. Windows batch wrappers are intentionally excluded
because they require a shell.

The HTML itself cannot start native executables. Its bounded local alignment
preview is labeled as a Motif browser preview and must never be represented as
MAFFT, MUSCLE, or Clustal Omega.

## Sanger data

The workbench imports Applied Biosystems `.ab1` and `.abi` files through Add
Entry or drag and drop. It retains called bases, Phred quality values, peak
positions, four dye channels, and allowlisted run metadata already stored in
ABIF. It does not claim to re-base-call raw signal. The Alignment workspace can
auto-orient likely reverse-primer reads for its bounded preview and display a
scrollable chromatogram with mismatch navigation.

Database JSON and workspace ZIP preserve the trace. FASTA and basic
GenBank/GFF3 exports are intentionally lossy because those formats cannot carry
an electropherogram.

## Runtime and persistence boundaries

The HTML exposes bounded `window.motif*` functions inside its own page. A
plugin installation does not turn those globals into unrestricted model
tools. The bundled MCP App uses only the narrow workspace-hydration adapter;
other agents may use page APIs only through a verified browser bridge and must
confirm the visible result. `window.motifHelp()` is the runtime source of
truth for current functions, schemas, limits, and examples.

Edits are session-owned until exported. Database JSON is directly restorable.
The workspace ZIP is a portable handoff containing `inventory.json` plus
interchange exports; extract and restore `inventory.json` when recovering from
a ZIP. The portable HTML is not an encrypted vault, a compliance system, or a
durable shared database.
A browser download is only a request until the resulting file is verified and
can be reopened; do that before relying on it as the session checkpoint.

The Motif connector is an ephemeral viewer/export surface. It does not write a
hidden database or run native analysis tools. Its registration, server, tools,
resource, and in-window identity are all Motif-owned. Durable shared-library
integration remains a separate reviewed workstream.

## Validate

```bash
npm run typecheck
npm test
npm run test:plugin
npm run test:connector
npm run check:css-tokens
npm run check:aria-controls
npm run build:motif
npm run test:e2e
npm run test:e2e:msa
npm run validate:plugin
```

The last command requires the Claude CLI. Preserve `LICENSE`,
`THIRD_PARTY_NOTICES.md`, and record-level reference provenance when
redistributing the bundle.
