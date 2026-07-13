# Claude Science Integration Plan

Last reviewed: July 13, 2026.

This document records the boundary between the standalone **Motif for Claude
Science** release and future native integration. It deliberately avoids
attributing older local connector behavior to Motif.

## Current verified product

This repository currently owns:

- one self-contained browser workbench;
- one Claude plugin that generates user-owned copies of that workbench;
- one standalone compatibility skill;
- bounded page-local `window.motif*` APIs;
- a no-shell helper for MAFFT, MUSCLE, and Clustal Omega; and
- explicit Database JSON / workspace ZIP checkpoint and restore.

It does **not** currently own:

- an MCP server or connector;
- a Claude Science `ui://` resource;
- a durable SQLite library;
- an agent-accessible cross-frame bridge; or
- a background live-update service.

The generated HTML cannot make its page globals callable by Claude. A host or
browser bridge must already have authority to evaluate JavaScript in the exact
loaded frame, and every update must still be verified in the rendered UI.

## What the local host experiment established

During pre-rebrand investigation, Claude Science opened a live frame under its
local host at `http://localhost:8765/.../frames/...`. That observation proves
the installed Claude Science host can create a frame. It does not prove that:

- the frame was created by Motif;
- Motif has a registered connector;
- a Motif `ui://` resource was fetched;
- an open Motif workbench can receive subsequent tool results; or
- the frame survives reconnect, reload, and revision changes correctly.

The connector involved in that experiment belongs to a separate older local
checkout. Do not rename it in place, present its logs as Motif evidence, or
reuse its persisted schemas without an explicit migration and compatibility
review.

## Required native integration contract

A future Motif connector should use a narrow, typed contract rather than a
generic DOM or eval bridge.

### Identity and revisions

Every import or mutation returns a durable receipt containing:

```text
schema
operationId / idempotencyKey
replayed
workspaceRevisionBefore
workspaceRevisionAfter
records[{ id, name, molecule, length, sequenceSha256 }]
selectedRecordId
warnings
```

Record IDs are opaque. Clients receive them from receipts and never derive
them from undocumented hashes. Artifact/open calls require explicit record IDs
or a guarded target containing the expected record ID and sequence hash.

### Read and mutation separation

- Read tools may inspect an exact workspace revision and fetch record detail.
- Trusted imports may commit with an idempotency key and content hashes.
- Inferred edits, cloning products, remote analysis, and generated annotations
  enter a visible review inbox before committing.
- The proposing agent cannot approve its own staged mutation through a second
  model-facing call.
- Every committed mutation is atomic and returns affected IDs and the new
  content revision.

View focus and selection use separate ephemeral revisions so opening a record
does not masquerade as a biological data change.

### Live-frame behavior

Use the MCP Apps lifecycle rather than imitating page-local browser APIs:

```text
tool call with explicit record IDs
  -> host reads the declared ui:// resource
  -> host mounts and initializes the sandboxed app
  -> app receives the exact tool result
  -> app verifies workspace revision and record hashes
  -> narrow refresh/focus tools fetch deltas or exact detail
```

Do not expose unrestricted HTML, DOM, eval, filesystem, or full-workspace
replacement as a connector tool. A mounted app may request `refreshWorkspace`
or `focusRecord` with narrow schemas and revision guards.

## Next integration test campaign

Run these tests only after a Motif-owned connector exists and has its own server
name, resource URI, tool schemas, storage directory, and privacy-safe logging.

1. Register one clean Motif connector entry; do not overwrite an older entry.
2. Start a fresh Claude Science kernel and call the Motif open tool with one
   explicit record ID and expected sequence SHA-256.
3. Verify a resource read, app initialization, and delivery of the tool result.
4. Confirm the visible frame names the intended record, molecule, length, and
   hash—not merely “1 record.”
5. Import a second record while the frame remains open and verify a bounded
   no-click refresh to the returned revision.
6. Change focus, reconnect, reload, and reopen; confirm biological state and
   ephemeral view state follow their separate contracts.
7. Test duplicate idempotency keys, stale revisions, missing records, partial
   failures, cancellation, and offline recovery.
8. Inspect privacy-safe logs: no raw sequence, AB1 signal, note content, local
   filesystem path, or external-tool stdout/stderr may appear.
9. Exercise compact, tall, wide, light, and dark frame layouts with mouse,
   keyboard, focus, and changed-state accessibility checks.
10. Export a portable Motif subset and verify record/result/asset counts and
    SHA-256 values before and after restore.

The user-visible frame is authoritative. Connection logs alone prove only a
transport connection; an empty list of app-registered tools alone proves
nothing about whether a frame mounted.

## Durable ownership boundary

The standalone artifact remains session-owned. A future durable library should
use transactional local storage, expected revisions, rotating checksummed
backups, and tested restore drills. Promotion from a portable workbench must
preview collisions, collection mapping, unsupported fields, results, assets,
notes, alignments, Sanger traces, overhangs, and provenance before commit.

Do not claim encryption, regulated-data compliance, or safe long-term storage
until key management, migrations, backup recovery, and audit behavior have been
designed and independently reviewed.

## Compatibility policy

This fresh repository starts public contracts at version `0.1.0`:

- package and plugin slug: `motif-for-claude-science`
- payload schemas: `motif.*`
- page globals: `window.motif*`
- environment variables: `MOTIF_*`
- distributables: `motif-*`

If a future connector imports data from an older system, implement that as an
explicit one-way adapter. Never retain an old product identity in Motif's
public names merely because local data or a previous tool used it.
