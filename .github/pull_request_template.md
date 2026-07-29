## Summary

Describe the user-facing or maintenance outcome and the reason for the change.

## Validation

- [ ] `npm run gate`
- [ ] `npm run validate:plugin`, or the Claude CLI skip is explained below
- [ ] Visible changes were checked in wide, narrow, light, dark, mouse, and
      keyboard states
- [ ] Generated artifacts were inspected when packaging or connector code changed

Skipped checks or external-tool assumptions:

## Public data safety

- [ ] No credentials, tokens, private filesystem paths, unpublished biological
      data, workspace exports, connector configuration, or unredacted logs are
      included
- [ ] Examples and fixtures use synthetic or clearly public data
- [ ] User-controlled content does not cross a raw HTML, shell, eval, generic
      filesystem, or generic DOM bridge

## Release impact

State whether this changes the plugin/runtime version, public schemas, packaged
files, provenance, or release notes.
