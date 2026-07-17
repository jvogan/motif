# Third-party notices

Motif is distributed under the MIT License in `LICENSE`. The source repository
depends on the open-source packages recorded in `package.json` and
`package-lock.json`.

Motif's self-contained browser artifact includes compiled portions of React,
React DOM, and Lucide. The optional connector and MCP App additionally include
compiled portions of the Model Context Protocol TypeScript SDK, MCP Apps SDK,
Zod, Ajv, ajv-formats, fast-deep-equal, fast-uri, json-schema-traverse, and
zod-to-json-schema.

The canonical redistribution notices are maintained in
[`src/artifacts/motif-for-claude-science-plugin/THIRD_PARTY_NOTICES.md`](src/artifacts/motif-for-claude-science-plugin/THIRD_PARTY_NOTICES.md).
The generated plugin places the complete upstream license texts for connector
dependencies under `server/licenses/`. Preserve that notice and license
directory when redistributing the plugin or a rebranded build.

MAFFT, MUSCLE, and Clustal Omega are optional external tools and are not
bundled with Motif. Their separate licenses apply if they are installed or
redistributed independently.
