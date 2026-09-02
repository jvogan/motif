# Use Motif as a Codex skills-only plugin

This Motif edition creates a self-contained HTML workbench on the user's own
machine from exact DNA, RNA, protein, FASTA, GenBank, or Motif JSON supplied in
the task. It does not contain an MCP server or App, and it does not require an
account, hosted Motif endpoint, or shared service URL.

## What it can do

The bundled skill can ask Codex to run a narrow local helper that:

- accepts one bounded local input file or standard input;
- parses supported biological records with Motif's existing validation rules;
- embeds the prepared records in a self-contained Motif HTML workbench;
- refuses to overwrite an existing file unless the user explicitly requests
  replacement; and
- reports record and residue counts, output bytes, the runtime build identity,
  and a SHA-256 digest.

The generated HTML is an ordinary unencrypted file containing the supplied
records. Share it only when you intend to share that data.

## What it cannot do

The skills-only edition cannot mount Motif as an inline MCP App, call Motif MCP
tools, retrieve missing accessions, or run a hosted analysis. Codex may open the
resulting HTML in its browser when that capability is available, but creating a
file does not prove that a visible browser view appeared.

For the interactive MCP App and local connector, use the
[full local Codex plugin](CODEX_QUICKSTART.md).

## Build and verify

From a trusted Motif checkout:

```bash
npm ci --ignore-scripts
npm run typecheck
npm run test:codex-skills-plugin
npm run check:openai-skills-submission
```

The deterministic archive is written to:

```text
dist-motif/motif-0.4.0-skills-only-plugin.zip
```

The build does not install a plugin, change Codex configuration, upload a file,
or contact a Motif service. The submission record in
`docs/openai-skills-only-submission.json` remains marked as awaiting live portal
validation until a publisher uploads the exact prepared archive and reviews the
portal result.
