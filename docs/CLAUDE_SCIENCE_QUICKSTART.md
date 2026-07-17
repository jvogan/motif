# Install Motif for Claude Science

Motif uses a local-first connector and has no hosted Motif service. Sequence
data you give to Claude Science is still subject to your Claude and
organization data policies; do not use sensitive or unpublished sequences
without authorization.

## Requirements

- macOS with Claude Science installed
- Node.js 22.12 or newer
- a fixed local folder for the Motif checkout

The folder path becomes part of the local connector registration. If you move
the folder later, rerun setup and update the sandbox grant.

## 1. Obtain Motif

Use a tagged Motif source checkout or versioned source archive from the
project's published distribution. Verify any checksum supplied with that
release, then keep the checkout in a fixed local folder. The connector is
built from this source; the Claude Code plugin ZIP alone does not register a
Claude Science connector.

## 2. Install and build

From the Motif checkout:

```bash
npm ci
npm run claude-science:setup
```

Setup builds the self-contained workbench and MCP App, runs a protocol doctor,
and adds one connector named `motif-local`. It preserves unrelated local
connectors and creates a private backup before changing Claude Science's local
MCP configuration.

## 3. Grant the Motif folder read access

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

## 4. Relaunch and connect

1. Fully quit Claude Science.
2. Reopen it.
3. Open **Customize → Connectors → motif-local**.
4. Press **Reconnect** if needed.

The connector should list:

- `motif_open_workbench`
- `motif_create_workbench_artifact`

`Skip approvals` is optional.

## 5. Verify from the checkout

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
record names/IDs, then open it in the right pane.
```

The expected record is `MOTIFDEMO`, linear DNA, 180 bp, with `source` and
`demo_cds` features spanning 1–180. Clicking the generated HTML once is normal.
Confirm a visible **Motif** identity and these values before testing Inventory,
Sequence, Map, and Tools with mouse and keyboard. This HTML is interactive but
immutable; regenerate it after changing the input or Motif build.

## Optional live-App check

After the HTML route works, you may test whether your Claude Science build
mounts local MCP Apps automatically:

```text
Call motif-local's motif_open_workbench exactly once with filename set to
motif-demo.gb and content set to the same complete GenBank text. Verify the
returned source name, record count, residue count, and record names/IDs, then
tell me whether a visible Motif frame mounted.
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
| Node.js | 22.12 or newer |
| Claude Science local connector | Two tools register and execute |
| Connector-created HTML | Opens interactively in the right pane |
| Automatic local MCP App mount | Host-build dependent; not required |

## Upgrade

After updating the Motif checkout:

```bash
npm ci
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
sequence data they contain.

For symptom-specific recovery, see
[Motif + Claude Science troubleshooting](CLAUDE_SCIENCE_TROUBLESHOOTING.md).
