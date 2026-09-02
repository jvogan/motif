# Motif — Codex plugin source

This source package creates the native Codex distribution for Motif. It gives
Codex the Motif skill, typed local MCP server, interactive MCP App, portable
HTML resource, examples, capability notes, and license notices.

`npm run build:codex-plugin` first regenerates the canonical Motif runtime,
then stages the package under
`dist-motif/codex/motif-for-claude-science/`. The server starts through
`${PLUGIN_ROOT}`, not through a project working directory.

`motif_open_workbench` opens the interactive MCP App, and
`motif_create_workbench_artifact` returns a portable HTML resource. Codex can
find, prepare, analyze, and transform data with its available tools before
adding records and results to Motif.

## Requirements

- Codex Desktop or a Codex CLI release with `codex plugin` support.
- Node.js 22.13 or newer on the 22.x line, or Node.js 24 or newer. The bundled
  MCP server is launched with `node` from the environment inherited by Codex.
- A private Codex marketplace entry that points at the staged plugin directory.
  The repository can generate one, but never registers it or modifies Codex
  configuration automatically.

From a Motif source checkout, build and check the private distribution with:

```bash
npm run build:codex-plugin
npm run test:codex-plugin
npm run codex:doctor
```

The installable directory is then
`dist-motif/codex/motif-for-claude-science/`. Do not install the ZIP directly;
the ZIP is the deterministic sharing/checksum artifact.

The staged directory also carries its self-contained doctor. From inside a
copied or unpacked plugin directory, run:

```bash
node ./doctor-motif-codex-plugin.mjs --plugin-root .
```

It verifies the package integrity manifest and exercises the bounded MCP
handshake without installing the plugin or opening a browser.

After installation, verify the active Codex profile, cached snapshot, MCP
registration, integrity manifest, App resource, and tiny FASTA tool call from
the Motif source checkout with:

```bash
npm run codex:doctor:installed
```

This check is read-only. It does not install, enable, remove, or restart the
plugin. Start a new Codex thread after it passes so the thread acquires the
current skill and tools.

## Private local installation

The lowest-friction private path is the generated local marketplace. It places
the plugin under the required `plugins/` directory and writes a private
marketplace catalog without installing either one:

```bash
npm run build:codex-marketplace
npm run codex:doctor:marketplace
codex plugin marketplace add "$PWD/.motif/codex-marketplace"
codex plugin add motif-for-claude-science@motif-local
```

The first command regenerates the runtime, so it is heavier than the doctor;
run it only after source changes. The doctor uses a tiny FASTA request and does
not launch a browser. The two `codex` commands are the only steps above that
change local Codex configuration.

The marketplace lives under `.motif/`, outside the replaceable `dist-motif/`
build directory. Ordinary Motif, preview, and release builds therefore cannot
invalidate an already registered private marketplace source.

If an existing private marketplace already supplies the staged plugin, use one
of these Codex-supported paths instead.

For the default personal marketplace at
`~/.agents/plugins/marketplace.json`, Codex discovers the marketplace
implicitly:

```bash
codex plugin list --available --json
codex plugin add motif-for-claude-science@<marketplace-name>
```

For any other private local marketplace, register its root directory first
(the directory containing `.agents/plugins/marketplace.json`), then use the
marketplace name declared inside that file:

```bash
codex plugin marketplace add /absolute/path/to/private-marketplace-root
codex plugin list --marketplace <marketplace-name>
codex plugin add motif-for-claude-science@<marketplace-name>
```

Start a new Codex thread after installation. Existing threads do not
necessarily acquire newly installed skills and tools.

## Verify the installed experience

First confirm that Codex reports the plugin as installed and enabled:

```bash
codex plugin list --json
```

In a new Codex thread, these are minimal copyable checks:

```text
Open this sequence in Motif: >example
ATGAAATTTGGGCCCTAA
```

```text
Create a portable Motif HTML workbench artifact for: >example
ATGAAATTTGGGCCCTAA
```

For the first prompt, confirm that Codex displays the interactive Motif frame
with the expected record. If no frame appears, use the second prompt and save
the returned portable HTML resource through the host.

## Upgrade and cache behavior

Rebuild the package, update the private marketplace source, and reinstall from
the same marketplace:

```bash
npm run build:codex-marketplace
npm run codex:doctor:marketplace
codex plugin add motif-for-claude-science@<marketplace-name>
```

Then start a new thread. Never edit an installed copy under the Codex plugin
cache; Codex installs a snapshot rather than running this source directory in
place.

The plugin version matches the repository release version. If a reinstall
still resolves an older snapshot, remove the installed plugin, confirm that
the marketplace points at the newly staged directory, and add it again.

## Remove

Remove the installed plugin and its cached snapshot with:

```bash
codex plugin remove motif-for-claude-science@<marketplace-name>
```

If the private marketplace itself is no longer needed, find its configured
name with `codex plugin marketplace list`, then remove that marketplace source:

```bash
codex plugin marketplace remove <marketplace-name>
```

Removing a plugin or marketplace does not delete user-exported Motif HTML,
JSON, ZIP, FASTA, GenBank, CLUSTAL, or CSV files.

## Troubleshooting

- **Plugin is absent from `codex plugin list`:** check `codex plugin list
  --available --json`. For a non-default marketplace, also check `codex plugin
  marketplace list` and confirm the marketplace root and declared name.
- **`node` cannot be started or the MCP server disconnects immediately:** run
  `node --version` in the environment used to start Codex. Use Node.js 22.13+
  on 22.x or Node.js 24+; restart Codex after changing `PATH`.
- **Tools are missing after install or upgrade:** fully start a new thread. If
  necessary, restart Codex, then confirm the plugin is installed and enabled
  with `codex plugin list --json`.
- **Tool succeeds but no workbench is visible:** this is a host-mount failure,
  not proof that the input was lost. Request
  `motif_create_workbench_artifact` and inspect its returned HTML resource.
- **Artifact response is present but no file exists:** expected. The tool
  returns a resource; save it explicitly through the host if a durable file is
  needed.
- **Input is rejected:** keep the payload within the reported connector limits
  and use exact supported Motif JSON, FASTA, GenBank, or raw sequence. The
  server intentionally does not guess at arbitrary file formats.

The bundled `.mcp.json` declares its local stdio server under the current
`mcpServers` envelope. The build, external plugin validator, staged doctor, and
packaging test all verify that same installation contract.
