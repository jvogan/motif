# Motif + Claude Science troubleshooting

Last reviewed: July 13, 2026. Motif connector version: `0.2.1`.

This guide covers the local `motif-local` connector only. It does not assume
another application, connector, database, or product identity.

## Known-good setup

From the Motif checkout:

```bash
npm run claude-science:setup
npm run claude-science:check-local
npm run claude-science:doctor
```

A healthy doctor reports:

- server identity `motif-claude-science`;
- `motif_open_workbench` and `motif_create_workbench_artifact`;
- resource `ui://motif/workbench.html`;
- MCP App MIME type `text/html;profile=mcp-app`; and
- a privacy-safe protocol trace that does not contain sequence content.

The terminal doctor proves the connector bundle and registration. Claude
Science applies an additional sandbox when it launches the connector, so the
host also needs access to the exact Motif checkout.

## “Operation not permitted” while loading tools

Typical connector detail:

```text
Couldn't load tools: MCP error -32000: Connection closed
/bin/bash: [REDACTED:MOTIF_ROOT]/scripts/run-motif-claude-science-mcp.sh:
Operation not permitted
```

This is a Claude Science sandbox-path denial, not a Unix executable-bit error.
Changing `chmod`, removing quarantine attributes, or repeatedly pressing
Reconnect will not grant the missing path.

Preferred least-privilege fix:

1. Resolve the checkout path with `pwd -P`.
2. Add that exact absolute directory as a read-only sandbox path in
   `~/.claude-science/config.toml`:

   ```toml
   [sandbox]
   user_read_paths = ["/absolute/path/to/motif-for-claude-science"]
   ```

3. If `[sandbox]` or `user_read_paths` already exists, add Motif to the existing
   array instead of creating a second table or key.
4. Keep the file private: `chmod 600 ~/.claude-science/config.toml`.
5. Fully quit and relaunch Claude Science, then reconnect `motif-local`.

The **Customize → Permissions** UI can also grant the exact checkout. That host
approval may be broader than the explicit read-only TOML path, so use the TOML
setting when least privilege matters.

A new conversation or kernel alone is not a reliable recovery. Claude Science
must reload its sandbox configuration and spawn a new MCP subprocess.

If the denied path points to a Node installation under a version manager such
as `nvm` or `asdf`, the host may also be unable to execute that private binary.
Prefer a system or Homebrew Node.js 22.12+ installation, or grant only the
exact Node installation folder and rerun setup with an explicit binary:

```bash
MOTIF_NODE_BIN=/absolute/path/to/node npm run claude-science:setup
```

Do not grant the entire home directory merely to expose one Node binary.

## Connector appears but tools are missing

Run, in order:

```bash
npm run claude-science:build
npm run claude-science:doctor:unregistered
npm run claude-science:install-local
npm run claude-science:check-local
```

Then fully relaunch Claude Science and reconnect the existing `motif-local`
entry. Do not create duplicate Motif connector entries. If the detail page
still shows an obsolete command, rerun `claude-science:install-local` and
relaunch the app.

`Skip approvals` is optional. Motif's two connector tools are read-only and do
not write a database or run external analysis software, but leaving approvals
enabled is a reasonable review posture.

## Tool succeeds but no workbench appears

A successful `motif_open_workbench` result, text summary, or `ui://` resource
link proves MCP execution and parsing. It does not prove that Claude Science
mounted a visible App frame.

For a dependable visual result, call `motif_create_workbench_artifact` with the
complete FASTA or GenBank text in `content`, the exact basename in `filename`,
and a safe `.html` `outputFilename`. Verify the returned source, counts,
bounded record names/IDs, runtime build ID, bytes, and checksum. Save the exact embedded HTML and
click or open it in Claude Science's right pane. The workbench is interactive,
but it is an immutable snapshot rather than a live MCP App.

Current Claude Science local/custom connector builds may not register Motif as
an artifact viewer. Use the viewer chooser only when Motif is actually listed.
The message `Sequence viewer unavailable—showing as text` is Claude Science's
generic artifact fallback; it does not mean that Motif rejected the sequence.

Use `motif_open_workbench` only as an optional live-App check. Pass the same
complete `content` and exact `filename`; do not call it with only a path or
filename. Do not report a mount until a frame visibly identifies itself as
**Motif** and contains the intended records.

Clicking a saved HTML artifact is normal. It does not mean the connector is
disconnected. Regenerate the artifact after source or Motif changes.

## Rebuild, reconnect, or create a new artifact?

Use this matrix:

| Change | Required action |
| --- | --- |
| Workbench HTML/CSS/template only | Rebuild; create or reopen a newly generated artifact |
| MCP App bridge | Rebuild and reconnect `motif-local` |
| Server code, tool metadata, or input/output schema | Rebuild, reconnect, and start a fresh kernel |
| Sandbox path or host permission | Fully relaunch Claude Science and reconnect |
| Saved HTML content | Create a newly named artifact |

Saved HTML workbenches are immutable snapshots. Rebuilding Motif does not
modify a previously saved or already open artifact. Use a new filename during
acceptance testing so the host cannot show stale bytes under an old artifact.
Settings displays the version and runtime build ID embedded in the open file.

## Input and identity checks

For every connected open:

- pass exact `content` or an exact bounded `payload`, never both;
- include `filename` when it carries format or provenance;
- specify `molecule` for ambiguous raw sequence text;
- preserve exact record names and IDs when they are available;
- inspect the returned source name, record count, residue count, and record
  identifiers before continuing; and
- stop instead of guessing when the intended record is not visible.

FASTA and raw-sequence imports default to linear topology unless topology is
explicit. GenBank topology is preserved. Binary AB1/ABI files belong in the
workbench's Add Entry or drag-and-drop flow; do not send binary bytes through
the connector's text input.

## Artifact and data boundaries

The local connector is an ephemeral viewer/export surface:

- it does not create a hidden sequence database;
- it does not persist an active-record pointer between calls;
- it does not run MAFFT, MUSCLE, Clustal Omega, BLAST, or a shell;
- it does not make an HTML file encrypted or suitable for regulated storage;
  and
- it does not live-update a previously saved HTML snapshot.

Inside the workbench, Database JSON is the directly restorable checkpoint.
The workspace ZIP is a portable handoff containing the same `inventory.json`
plus interchange exports; extract and restore `inventory.json` when recovering
from a ZIP. Export and verify the resulting file before reload when edits
matter; a browser download request alone is not a confirmed save.

## Final acceptance checklist

- Connector page loads both Motif tools without an MCP error.
- Host chrome says `motif-local`; only Motif identities are visible.
- Opened workbench visibly says **Motif**.
- Intended record name, type, topology, length, and sequence match the source.
- Inventory, Sequence, Map, and Tools respond to mouse and keyboard.
- Tools can minimize to the rail without covering the header.
- The connector-created HTML workbench opens and responds interactively.
- Optional live mounting is reported separately and is not required for a
  healthy local connector.
- A newly generated artifact reflects the current build rather than stale
  saved bytes.

If these pass, capture the Claude Science window as the release acceptance
evidence. Connection logs alone are not visual acceptance.
