# Motif for Claude Science

Motif is a portable molecular-biology workbench built for the Claude Science
hackathon. It turns sequence records and analysis results into one
self-contained HTML workspace that can be opened locally, inspected visually,
edited with mouse and keyboard, checkpointed, and shared as an ordinary file.

This repository is a clean standalone snapshot. It contains no desktop shell,
database server, MCP connector, or history from the project it was derived
from.

## What is included

- annotated DNA, RNA, and protein inventory
- detail and standard sequence views with selection and editing tools
- circular and linear maps with restriction-site controls
- bounded browser MSA plus import and review of aligned FASTA/CLUSTAL
- no-shell MAFFT, MUSCLE, and Clustal Omega helper with provenance hashes
- AB1/ABI Sanger import and chromatogram review
- restriction digest, qualitative gel, primer, Gibson, Golden Gate,
  GoldenBraid, and traditional ligation workspaces
- notes, workflow history, typed analysis results, and inert text/JSON assets
- Database JSON and workspace ZIP checkpoint/restore
- deterministic Claude plugin bundle and standalone skill

## Quick start

Requires Node.js 22 or newer.

```bash
npm install
npm run preview:motif
```

Open `preview/motif-artifact.html`, or start an editable Vite session with:

```bash
npm run dev
```

## Build the distributable

```bash
npm run build:motif
```

The build writes:

```text
dist-motif/
├── motif-template.html
├── motif-artifact.html
├── motif-for-claude-science/
├── motif-for-claude-science.zip
├── motif-for-claude-science.checksums.json
└── motif-for-claude-science-skill/SKILL.md
```

The HTML is self-contained: Vite's JavaScript and CSS assets are inlined, and
the plugin resource embeds the same artifact bytes. The ZIP is deterministic
and its file/archive SHA-256 values are recorded beside it.

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
npm run check:css-tokens
npm run check:aria-controls
npm run test:e2e
```

`npm run validate:plugin` adds strict validation through the Claude CLI when it
is installed.

## Claude Science boundary

The plugin reliably generates a user-owned HTML workbench. Its
`window.motif*` API is page-local and is not automatically an agent tool. A
native Motif connector and live-frame update channel are not included yet and
must not be inferred from any older local connector. The next integration
campaign is documented in [Claude Science integration](docs/CLAUDE_SCIENCE_INTEGRATION.md).

## Data safety

Motif runs locally and does not transmit sequence data by itself. External MSA
tools run only when explicitly invoked outside the HTML. Workspace exports are
ordinary unencrypted files; keep sensitive data under an appropriate local
storage and backup policy.

See the plugin [README](src/artifacts/motif-for-claude-science-plugin/README.md)
for payload, MSA, Sanger, installation, and security details.

## License

MIT. Redistributed plugin bundles must retain `LICENSE`,
`THIRD_PARTY_NOTICES.md`, and record-level reference provenance.
