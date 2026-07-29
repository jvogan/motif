# Release checklist

Motif releases are immutable public artifacts. Build and inspect them from the
exact tagged commit; never assemble a release from an unrelated or dirty
working tree.

## 1. Prepare the release pull request

- Choose the semantic version and update the package, lockfile, plugin
  manifest, artifact runtime, connector bridge, server, docs, tests, agent
  guide, and changelogs together.
- Move the root changelog's Unreleased entries under the dated release heading.
- Run the complete repository gate and strict plugin validation.
- Confirm the diff contains no credentials, private paths, unpublished
  biological data, workspace exports, connector configuration, or unredacted
  logs.
- Merge only after the required hosted checks pass against the current
  protected branch.

## 2. Build from the release commit

Start with a clean checkout of the merged commit:

```bash
npm ci
npm audit
npm run gate
npm run validate:plugin
git diff --check
git status --short
```

Record the SHA-256 hashes:

```bash
shasum -a 256 \
  dist-motif/motif-artifact.html \
  dist-motif/motif-for-claude-science.zip \
  dist-motif/motif-for-claude-science.checksums.json
```

Inspect the ZIP file list. It must use relative paths and include
`THIRD_PARTY_NOTICES.md` plus a license file for every dependency bundled into
the connector server.

## 3. Tag and draft

Create and push an annotated `vX.Y.Z` tag that names the validated commit.
Create the GitHub release as a draft with `--verify-tag`, and attach exactly:

- `motif-artifact.html`
- `motif-for-claude-science.zip`
- `motif-for-claude-science.checksums.json`

Review the draft title, notes, tag, target commit, asset names, sizes, and
GitHub-reported SHA-256 digests. Download the draft assets when practical and
compare them with the local files before publishing.

## 4. Publish and verify

Publish only after every asset is present. Release immutability locks the tag
and asset bytes at publication.

After publication:

```bash
gh release verify vX.Y.Z
gh release verify-asset vX.Y.Z dist-motif/motif-artifact.html
gh release verify-asset vX.Y.Z dist-motif/motif-for-claude-science.zip
gh release verify-asset vX.Y.Z \
  dist-motif/motif-for-claude-science.checksums.json
```

Finally, confirm the release is marked immutable and latest, the public
downloads match the recorded hashes, Dependabot and CodeQL have no unresolved
release-blocking alerts, and the working tree remains clean.
