# Install Motif for Claude Science

Motif uses a local-first connector and has no hosted Motif service. Sequence
data you give to Claude Science is still subject to your Claude and
organization data policies; do not use sensitive or unpublished sequences
without authorization.

## Requirements

- macOS with Claude Science installed
- Node.js 22.13 or newer (22.x), or Node.js 24 or newer
- a fixed local folder for the extracted Motif release bundle or source checkout

The folder path becomes part of the local connector registration. If you move
the folder later, rerun setup and update the sandbox grant.

## 1. Install a published release without npm (recommended)

Download the release asset `motif-for-claude-science-release.zip` and its
matching `motif-for-claude-science-release.manifest.sha256` file from the same
GitHub release. Before extracting or running anything, use GitHub CLI to verify
both downloaded assets against the immutable release when available:

```bash
gh release verify-asset <release-tag> /path/to/motif-for-claude-science-release.zip --repo jvogan/motif
gh release verify-asset <release-tag> /path/to/motif-for-claude-science-release.manifest.sha256 --repo jvogan/motif
```

Extract the verified ZIP into a stable, private folder. Independently compare
the SHA-256 of its `release-manifest.json` with the separately downloaded
manifest checksum before executing the bundled installer:

```bash
shasum -a 256 /absolute/path/to/motif-for-claude-science-release/release-manifest.json
cat /path/to/motif-for-claude-science-release.manifest.sha256
```

The installer requires that separately downloaded checksum file and reports
only that the supplied digest matched; bundled code cannot authenticate itself.
Publisher identity comes from the independent GitHub release verification (or
an equivalently trusted download channel). The bundled verifier then checks the
release identity, every installed-file checksum, file paths, and size bounds.
It uses only Node.js's standard library; end users do not need `npm`, `npm ci`,
or the source tree:

```bash
cd /absolute/path/to/motif-for-claude-science-release
node install-motif-claude-science-release.mjs --bundle . \
  --manifest-sha256-file /path/to/motif-for-claude-science-release.manifest.sha256
node doctor-motif-claude-science-release.mjs --bundle . \
  --manifest-sha256-file /path/to/motif-for-claude-science-release.manifest.sha256
```

The installer registers exactly `motif-local`, preserves unrelated entries,
and creates a private same-directory configuration backup before a change.
To restore the previous configuration, use the backup named in the installer
output (or the newest `.before-motif-local-*` backup):

```bash
node rollback-motif-claude-science-release.mjs --bundle . \
  --manifest-sha256-file /path/to/motif-for-claude-science-release.manifest.sha256 \
  --backup /path/to/local-mcp.json.before-motif-local-TIMESTAMP
```

Keep the original extracted release folder, ZIP, and external manifest digest
until the installation has passed its doctor check. If that installed folder
is damaged, do not run its helpers. Extract a fresh copy of the same verified
release and run the rollback helper from that recovery copy, passing the
recovery copy as `--bundle` and the damaged installation's configuration
backup with `--backup`.

## 2. Obtain a source checkout (maintainer/developer fallback)

Use the latest published [Motif release](https://github.com/jvogan/motif/releases)
or clone its tagged source into a fixed local folder:

```bash
git clone --branch v0.3.5 --depth 1 https://github.com/jvogan/motif.git
cd motif
```

Verify release checksums before using downloaded assets. The connector is
built from this source checkout; the Claude plugin ZIP alone does not register
a Claude Science connector.

## 3. Install and build from source

From the Motif checkout:

```bash
npm ci --ignore-scripts
npm run security:policy
npm run security:lifecycle
npm run claude-science:setup
```

Setup builds the self-contained workbench and MCP App, runs a protocol doctor,
and adds one connector named `motif-local`. It preserves unrelated local
connectors and creates a private backup before changing Claude Science's local
MCP configuration.

## 4. Grant the Motif folder read access

Claude Science sandboxes local connector processes. Resolve the exact checkout
path:

```bash
pwd -P
```

For the simplest setup, open **Customize → Permissions** in Claude Science and
grant exactly that folder. Fully relaunching Claude Science is required before
the new grant affects its connector sandbox.

For a least-privilege manual grant, add the absolute path to
`~/.claude-science/config.toml`:

```toml
[sandbox]
user_read_paths = ["/absolute/path/to/motif-for-claude-science"]
```

If the file already contains `[sandbox]` or `user_read_paths`, merge the Motif
path into the existing array; do not create duplicate TOML keys. Keep the file
private:

```bash
chmod 600 ~/.claude-science/config.toml
```

The explicit TOML setting is read-only and therefore the least-privilege option
for Motif's viewer connector.

## 5. Relaunch and connect

1. Fully quit Claude Science.
2. Reopen it.
3. Open **Customize → Connectors → motif-local**.
4. Press **Reconnect** if needed.

The connector should list:

- `motif_open_workbench`
- `motif_create_workbench_artifact`

`Skip approvals` is optional.

## 6. Verify the installation

For a no-npm release install, run the bundled doctor and use the same
extracted release directory as the registered root:

```bash
node /absolute/path/to/motif-for-claude-science-release/doctor-motif-claude-science-release.mjs \
  --bundle /absolute/path/to/motif-for-claude-science-release \
  --manifest-sha256-file /path/to/motif-for-claude-science-release.manifest.sha256
```

For a source checkout, use:

```bash
npm run claude-science:check-local
npm run claude-science:doctor
```

Both commands must pass. Then attach the bundled synthetic
[`examples/motif-demo.gb`](../examples/motif-demo.gb). The most reliable first
visual result is the portable HTML workbench:

```text
Read the complete text of motif-demo.gb, including ORIGIN. Call motif-local's
motif_create_workbench_artifact exactly once with filename "motif-demo.gb",
content set to the complete GenBank text, title "Motif demo — MOTIFDEMO", and
outputFilename "motif-demo-workbench.html". Preserve the exact returned HTML
as a Claude Science artifact. Report its record count, residue count, and
record names/IDs, and runtime build ID, then open it in the right pane.
```

The expected record is `MOTIFDEMO`, linear DNA, 180 bp, with `source` and
`demo_cds` features spanning 1–180. Clicking the generated HTML once is normal.
Confirm a visible **Motif** identity and these values before testing Inventory,
Sequence, Map, and Tools with mouse and keyboard. This HTML is interactive but
immutable; regenerate it after changing the input or Motif build. Settings
shows the version and runtime build ID embedded in the open file.

## Optional live-App check

After the HTML route works, you may test whether your Claude Science build
mounts local MCP Apps automatically:

```text
Call motif-local's motif_open_workbench exactly once with filename set to
motif-demo.gb and content set to the same complete GenBank text. Verify the
returned source name, record count, residue count, and record names/IDs, then
report the runtime build ID and tell me whether a visible Motif frame mounted.
```

A successful result proves execution and parsing; a text summary or `ui://`
link does not prove that the MCP App mounted. Current Claude Science
local/custom connector builds may not register Motif as an artifact viewer. If
Motif is actually listed in the viewer chooser, selecting it is a convenient
shortcut. `Sequence viewer unavailable—showing as text` is the host's generic
fallback, not a Motif parser failure.

## Tested compatibility

| Component | Tested status |
| --- | --- |
| macOS | Supported local setup |
| Node.js | 22.13 or newer (22.x), or 24 or newer |
| Claude Science local connector | Two tools register and execute |
| Connector-created HTML | Opens interactively in the right pane |
| Automatic local MCP App mount | Host-build dependent; not required |

## Upgrade

After updating the Motif checkout:

```bash
npm ci --ignore-scripts
npm run security:policy
npm run security:lifecycle
npm run claude-science:setup
```

Reconnect when server, bridge, tool, or schema code changes. Previously saved
HTML workbenches are immutable snapshots, so create a newly named artifact to
verify a new build.

## Remove

```bash
npm run claude-science:remove-local
```

This removes only `motif-local` and preserves other connectors. After removing
Motif, you may also remove its path from `user_read_paths` and fully relaunch
Claude Science.

## Safety boundary

The connector is a bounded viewer/export surface. It does not run a shell or
external alignment tools, write a hidden sequence database, or upload data to
a Motif service. Workbench Database JSON and workspace ZIP exports are ordinary
unencrypted user-owned files; handle them according to the sensitivity of the
sequence data they contain. Verify the downloaded file exists and can be
reopened before treating it as a checkpoint.

For symptom-specific recovery, see
[Motif + Claude Science troubleshooting](CLAUDE_SCIENCE_TROUBLESHOOTING.md).
