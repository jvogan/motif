# Install Motif for Claude Science

Motif uses a local-first connector: sequence data is validated and rendered on
your machine, and no hosted Motif service is required.

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

Add that absolute path to `~/.claude-science/config.toml`:

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

You may instead grant the exact folder through **Customize → Permissions** in
Claude Science. The explicit TOML setting is read-only and therefore the
least-privilege option for Motif's viewer connector.

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

Both commands must pass. Then add a small FASTA or GenBank file to a Claude
Science conversation, open its viewer chooser, and select Motif. Confirm that:

- Claude Science identifies `motif-local` and `motif_open_workbench`;
- **Motif** is visible inside the workbench;
- the record name, molecule, topology, length, and sequence match the source;
  and
- Inventory, Sequence, Map, and Tools respond to mouse and keyboard.

Some Claude Science builds return a successful direct tool result without
automatically opening a visible App tile. The artifact viewer route is the
preferred visual acceptance path. The HTML fallback always remains available
through `motif_create_workbench_artifact`.

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
