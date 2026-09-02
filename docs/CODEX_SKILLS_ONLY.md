# Use Motif as a Codex skills-only plugin

This Motif edition creates a self-contained HTML workbench for DNA, RNA,
protein, annotations, alignments, traces, cloning designs, and results. Codex
can find, prepare, analyze, and transform data with its available tools before
adding it to the workbench.

## Create a workbench

The bundled skill runs a local helper that:

- accepts a local input file or standard input within Motif's documented
  resource limits;
- parses supported biological records with Motif's existing validation rules;
- embeds the prepared records in a self-contained Motif HTML workbench;
- refuses to overwrite an existing file unless the user explicitly requests
  replacement; and
- reports record and residue counts, output bytes, the runtime build identity,
  and a SHA-256 digest.

The generated HTML is an ordinary unencrypted file containing the supplied
records. Share it only when you intend to share that data.

## Combine Motif with Codex

Codex can combine Motif with database connectors, local files, analysis
programs, and browser tools available in the current session. The skills-only
package creates a portable HTML workbench. The full local plugin also opens
Motif through its MCP App.

For the interactive MCP App and local connector, use the
[full local Codex plugin](CODEX_QUICKSTART.md).

## Build and verify

From a trusted Motif checkout:

```bash
npm ci --ignore-scripts
npm run typecheck
npm run test:codex-skills-plugin
```

The deterministic archive is written to:

```text
dist-motif/motif-0.4.0-skills-only-plugin.zip
```

The archive contains the skill, local workbench helper, Motif runtime, logo,
license, privacy policy, terms, and third-party notices.
