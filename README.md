<p align="center">
  <img src=".github/assets/motif-banner.png" alt="Motif — a molecular biology workbench for Claude Science." width="100%" />
</p>

# Motif for Claude Science

[Website](https://jvogan.github.io/motif-site/) ·
[Installation](docs/CLAUDE_SCIENCE_QUICKSTART.md) ·
[Capabilities](docs/CAPABILITIES.md) ·
[Examples](examples/README.md) ·
[Security](SECURITY.md)

Motif is a portable molecular-biology workbench built for the Claude Science
hackathon. It turns sequence records and analysis results into one
self-contained HTML workspace that can be opened locally or in Claude
Science, inspected visually, edited with mouse and keyboard, checkpointed, and
shared as an ordinary file. Motif also declares a live MCP App; whether a local
connector mounts automatically depends on the Claude Science host build.

This repository is the standalone Motif source. It contains no desktop shell
or native database. Its optional `motif-local` connector is ephemeral and
Motif-owned; it does not depend on another application checkout.

Motif is an independent hackathon project and is not an Anthropic product or
an official Claude Science integration.

## What is included

- annotated DNA, RNA, and protein inventory
- detail and standard sequence views with selection and editing tools
- circular and linear maps with restriction-site controls
- bounded browser MSA plus import and review of aligned FASTA/CLUSTAL
- no-shell MAFFT, MUSCLE, and Clustal Omega helper with provenance hashes
- AB1/ABI Sanger import and chromatogram review
- restriction digest, qualitative gel, primer/PCR, Gibson, Golden Gate,
  GoldenBraid, and traditional ligation workspaces
- ORF/translation analysis and PAM-based CRISPR guide candidates
- notes, workflow history, typed analysis results, and inert text/JSON assets
- Database JSON checkpoint/restore and workspace ZIP handoff export
- deterministic Claude plugin bundle and standalone skill
- Motif-owned MCP connector with a full-workbench `ui://` App and embedded HTML
  fallback for Claude Science

## Quick start

Requires Git and Node.js 22.12 or newer. From a source checkout:

```bash
git clone https://github.com/jvogan/motif.git
cd motif
npm ci
npm run preview:motif
```

Open `preview/motif-artifact.html`, or start an editable Vite session with:

```bash
npm run dev
```

## First success in Claude Science

Install the local connector from a fixed checkout:

```bash
npm run claude-science:setup
```

Grant Claude Science access to that exact checkout, fully quit and reopen the
app, then reconnect **motif-local**. The connector should expose exactly
`motif_open_workbench` and `motif_create_workbench_artifact`.

For the most reliable first visual result, attach the bundled synthetic
[`examples/motif-demo.gb`](examples/motif-demo.gb) and ask Claude Science:

```text
Read the complete text of motif-demo.gb, including ORIGIN. Call motif-local's
motif_create_workbench_artifact exactly once with filename "motif-demo.gb",
the complete content, title "Motif demo — MOTIFDEMO", and outputFilename
"motif-demo-workbench.html". Preserve the exact returned HTML as a Claude
Science artifact and open it in the right pane. Report the record name,
topology, and residue count.
```

Clicking the generated HTML once is normal. It opens the full interactive
workbench as an immutable snapshot. See the
[Claude Science quickstart](docs/CLAUDE_SCIENCE_QUICKSTART.md) for permission,
verification, and optional live-App steps.

The [public examples](examples/README.md) also include synthetic FASTA,
aligned CLUSTAL, and complete workspace JSON inputs with expected identities.

## Build the distributable

```bash
npm run build:motif
```

The build writes:

```text
dist-motif/
├── claude-science/
│   ├── motif-mcp-app.html
│   └── motif-mcp-server.mjs
├── motif-template.html
├── motif-artifact.html
├── motif-for-claude-science/
├── motif-for-claude-science.zip
├── motif-for-claude-science.checksums.json
└── motif-for-claude-science-skill/SKILL.md
```

The HTML and MCP App are self-contained: Vite's JavaScript and CSS assets are
inlined, and the plugin contains its compiled connector, App, standalone
template, and artifact resource. The ZIP is deterministic and its file/archive
SHA-256 values are recorded beside it.

The plugin ZIP is for Claude/plugin hosts. It does not by itself install the
Claude Science local connector; use `npm run claude-science:setup` from the
source checkout for that workflow.

To generate an additional repo-local artifact with preloaded data:

```bash
npm run build:motif -- \
  --payload ./inventory.json \
  --out ./preview/my-motif-workspace.html
```

Use `--handoff /explicit/path/motif-artifact.html` only when an external copy is
intended. The build does not write outside this repository by default.

## Validate

```bash
npm run typecheck
npm run lint
npm test
npm run test:plugin
npm run test:connector
npm run check:css-tokens
npm run check:aria-controls
npm run build:motif
npm run test:e2e
npm run test:e2e:msa
```

`npm run validate:plugin` adds strict validation through the Claude CLI when it
is installed.

## Claude Science local connector

For a fresh installation, follow the
[public Claude Science quickstart](docs/CLAUDE_SCIENCE_QUICKSTART.md).

Build, protocol-check, and register the connector without replacing any other
local connector:

```bash
npm run claude-science:setup
```

This adds exactly one `motif-local` entry to Claude Science's local MCP config
after a successful build and unregistered protocol doctor. It preserves
unrelated entries and writes a private backup before any changed config is
installed. Grant the exact Motif checkout read access in Claude Science, fully
quit and reopen the app, then reconnect `motif-local`.

The connected surface exposes `motif_open_workbench` for bounded Motif payload,
FASTA, GenBank, or raw-sequence review. Pass the complete text and its exact
filename; a successful result proves that Motif parsed the input, but only a
visible Motif frame proves that Claude Science mounted the MCP App. Current
local/custom connector builds may not list Motif in the artifact viewer
chooser, so use that shortcut only when Motif is actually offered.

The dependable visual fallback is `motif_create_workbench_artifact`: save the
exact returned HTML resource, then click or open it in Claude Science's right
pane. The resulting workbench is interactive, but it is an immutable snapshot
and does not live-update when the source or Motif build changes.

The connector does not write a database or run external executables. Its
`window.motif*` API remains page-local and is used only by the bundled narrow
MCP App bridge. Setup, verification, rollback, and host limitations are
documented in [Claude Science integration](docs/CLAUDE_SCIENCE_INTEGRATION.md).
Known host errors, reload boundaries, and visual acceptance steps are in the
[Motif + Claude Science troubleshooting guide](docs/CLAUDE_SCIENCE_TROUBLESHOOTING.md).

## Data safety

Motif has no hosted backend and does not transmit sequence data by itself.
External MSA tools run only when explicitly invoked outside the HTML. Data you
provide to Claude Science remains subject to your Claude and organization data
policies. Do not use sensitive or unpublished sequences without authorization.
Workspace exports are ordinary unencrypted files; keep them under an
appropriate local storage and backup policy.

See the plugin [README](src/artifacts/motif-for-claude-science-plugin/README.md)
for payload, MSA, Sanger, installation, and security details.
The public [capability reference](docs/CAPABILITIES.md) distinguishes built-in
analysis from externally produced results that Motif can store and display.

For project support and release information, see [SUPPORT.md](SUPPORT.md),
[SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md), and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

MIT. Redistributed plugin bundles must retain `LICENSE`,
`THIRD_PARTY_NOTICES.md`, and record-level reference provenance.
