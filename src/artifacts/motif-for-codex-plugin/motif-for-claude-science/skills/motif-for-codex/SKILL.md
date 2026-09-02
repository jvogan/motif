---
name: motif-for-codex
description: Use this when the user explicitly asks for Motif, asks to open or inspect provided exact DNA, RNA, protein, FASTA, GenBank, or Motif JSON in an interactive molecular-biology workbench, or asks for a portable Motif HTML workbench. Do not use for code, music, or mathematical sequences; database search or sequence retrieval; alignment computation; experimental or medical validation; file writing; or prompts without exact biological input.
---

# Motif workbench

The connected Motif MCP server exposes exactly two read-only tools:

- `motif_open_workbench` accepts bounded Motif payloads or supported exact
  sequence content and requests the live MCP App workbench. Its successful
  response does not prove the host mounted a visible frame.
- `motif_create_workbench_artifact` returns a self-contained HTML resource for
  the same bounded inputs. Use it when the user asks for an artifact or the
  host does not mount the app. It does not write a file.

Prefer `motif_open_workbench` when the user asks to open, inspect, or work with
sequences interactively. After the tool succeeds, distinguish server delivery
from host presentation: treat the live workbench as available only when a
visible interactive frame is mounted. If it is not visible, call
`motif_create_workbench_artifact` with the same exact input and explain that
the returned resource must be saved explicitly if the user wants a durable
file.

Do not invoke Motif merely because a prompt contains the words "motif" or
"sequence." The request must concern exact biological records supplied by the
user or already present in the conversation. If the user refers to an absent
attachment or unspecified sequence, ask for the exact input rather than opening
the bundled sample.

Minimal requests users can copy are:

```text
Open this sequence in Motif: >example
ATGAAATTTGGGCCCTAA
```

```text
Create a portable Motif HTML workbench artifact for: >example
ATGAAATTTGGGCCCTAA
```

Report the returned record/residue counts, delivery mode, and any input error
without claiming persistence, a verified file save, a visible frame based only
on tool success, or capabilities outside those two tool contracts.

The bundled server is local and typed. Do not use it as a generic shell,
filesystem, browser, validation, analysis, or remote-mutation bridge.
