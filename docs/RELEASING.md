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
- Mark the pull request with the `release` label (or use a `release/*` head
  branch). The dedicated Release review threads workflow rechecks current
  threads on release-label, synchronization, review, and review-comment
  events without rerunning the full build. Branch protection must require the
  `validate` and `validate-release-review-threads` contexts for release pull
  requests.

## 2. Build from the release commit

Start with a clean checkout of the merged commit:

```bash
npm ci --ignore-scripts
npm run security:policy
npm run security:lifecycle
npm audit
npm run gate
npm run validate:plugin
git diff --check
git status --short
```

`npm ci --ignore-scripts` is a maintainer-build requirement, not an end-user
installation requirement. Scripts remain disabled until
`npm run security:policy` has checked exact lockfile identities, registry
origins, integrity values, lifecycle metadata, binding files, and the bundled
inventory. `npm run security:lifecycle` then runs the Motif-owned deterministic
esbuild preparation through the bounded helper; an unknown package, version,
manifest, binary, or binding fails before any dependency lifecycle script runs.
`npm run build:motif` produces the dependency-free release bundle. The checked-in
`.npmrc` asks npm versions that support `min-release-age` to keep new dependency
resolutions seven days old; `npm run security:cooling-off` independently checks
changed lockfile entries against the public registry. It is intentionally
separate from dependency installation, so ordinary installs do not make
hundreds of timestamp requests. A temporary exception must name one exact
package/version and include rationale, reviewer, and a future expiry in
`security/dependency-policy.json`.

The maintainer Node 26/npm 11 toolchain exposes `min-release-age`,
`allowScripts`, and `strict-allow-scripts`; CI is pinned to Node 22/npm 10,
which predates those npm 11 controls. The portable `--ignore-scripts`, policy,
and reviewed-helper sequence therefore supplies the same fail-closed behavior
on both toolchains. The root `allowScripts` map remains an npm 11 defense in
depth, while the repository policy is authoritative for every supported npm.

Record the SHA-256 hashes:

```bash
shasum -a 256 \
  dist-motif/motif-artifact.html \
  dist-motif/motif-for-claude-science.zip \
  dist-motif/motif-for-claude-science.checksums.json \
  dist-motif/motif-for-claude-science-release.zip \
  dist-motif/motif-for-claude-science-release.manifest.sha256
```

Inspect the plugin ZIP file list. It must use relative paths and include
`THIRD_PARTY_NOTICES.md` plus a license file for every dependency bundled into
the plugin connector. Inspect the release ZIP separately: it must contain its
installer/doctor/rollback helpers, self-contained connector artifacts, SBOM,
connector inventory, and one license file for every reviewed bundled
connector dependency.

## 3. Tag and draft

Before creating or publishing a tag, run the release-only checks. The ordinary
alignment check intentionally permits later development commits after an old
tag; the publish check is the collision guard:

```bash
npm run check:release-publish
```

When GitHub authentication is available, also ask GitHub whether an immutable
release already owns the version. This is opt-in so ordinary local gate runs
stay offline:

```bash
npm run check:release-publish -- --github --repo OWNER/REPOSITORY
```

For an explicit release pull request, CI runs the review-thread check with the
workflow token. To reproduce that check locally, save the reviewed GraphQL
subset as JSON and run:

```bash
npm run check:release-review -- --threads-file /path/to/review-threads.json --require-release
```

The check fails for every unresolved, current review thread. Resolved or
outdated threads do not block publication.

Create and push an annotated `vX.Y.Z` tag that names the validated commit.
Create the GitHub release as a draft with `--verify-tag`, and attach exactly:

- `motif-artifact.html`
- `motif-for-claude-science.zip`
- `motif-for-claude-science.checksums.json`
- `motif-for-claude-science-release.zip`
- `motif-for-claude-science-release.manifest.sha256`

The release ZIP is the supported no-npm end-user path. Users verify both release
assets against the immutable GitHub release before executing bundled code. The
installer, doctor, and rollback helper require the separately downloaded
release-manifest checksum as an external integrity anchor; they do not claim to
authenticate themselves. Its extracted root
contains the installer, doctor, rollback helper, compiled `motif-local`
connector, self-contained App/template, checksums, SBOM, and dependency
license inventory. The installer never runs npm or reads outside the bundle
except for the explicitly selected local MCP configuration path.

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
gh release verify-asset vX.Y.Z \
  dist-motif/motif-for-claude-science-release.zip
gh release verify-asset vX.Y.Z \
  dist-motif/motif-for-claude-science-release.manifest.sha256
```

Finally, confirm the release is marked immutable and latest, the public
downloads match the recorded hashes, Dependabot and CodeQL have no unresolved
release-blocking alerts, and the working tree remains clean.

If an installed bundle is damaged during recovery testing, use a fresh,
separately verified extraction of the release as the rollback `--bundle`; the
damaged copy must not be used to execute its own helpers.
