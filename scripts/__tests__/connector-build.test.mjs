import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { buildMotifMcpApp } from '../build-motif-mcp-app.mjs';
import { buildMotifMcpServer } from '../build-motif-mcp-server.mjs';

it.each([
  { filename: 'server.mjs', build: buildMotifMcpServer },
  { filename: 'app.html', build: buildMotifMcpApp },
])('$filename preserves legal notices and named faults in deterministic output', async ({ filename, build }) => {
  const fixture = mkdtempSync(join(tmpdir(), 'motif-connector-build-'));
  try {
    const entry = join(fixture, 'entry.ts');
    const template = join(fixture, 'template.html');
    const out = join(fixture, 'output', filename);

    writeFileSync(entry, `/*! @license Connector build fixture */
// Ordinary comment removed by minification.
class ConnectorFixtureError extends Error {}
function raiseConnectorFixtureFault() {
  const error = new ConnectorFixtureError('Panne détectée');
  error.name = error.constructor.name;
  throw error;
}
try {
  raiseConnectorFixtureFault();
} catch (error) {
  globalThis.fixtureResult = { schema: 'motif.mcp.workbench.v1', stack: error.stack };
}
`);
    writeFileSync(template, `<!doctype html><html><head>
<meta charset="UTF-8"><meta name="application-name" content="Motif"></head>
<body><script type="application/json" id="motif-artifact-data">{}</script></body></html>`);

    await build({ entry, template, out });
    const first = readFileSync(out);
    await build({ entry, template, out });
    expect(readFileSync(out)).toEqual(first);
    expect(readdirSync(dirname(out))).toEqual([filename]);

    const output = first.toString('utf8');
    const script = filename.endsWith('.html')
      ? output.match(/<script data-motif-mcp-app-bridge>([\s\S]+?)<\/script>/u)?.[1]
      : output;
    expect(script).toContain('/*! @license Connector build fixture */');
    expect(script).toContain('Panne détectée');
    expect(script).not.toMatch(/Ordinary comment|sourceMappingURL/u);

    const context = {};
    runInNewContext(script, context, { filename });
    expect(context.fixtureResult.schema).toBe('motif.mcp.workbench.v1');
    expect(context.fixtureResult.stack).toContain('ConnectorFixtureError: Panne détectée');
    expect(context.fixtureResult.stack).toContain('at raiseConnectorFixtureFault (');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
