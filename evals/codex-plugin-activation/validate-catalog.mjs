import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalogUrl = new URL('./catalog.json', import.meta.url);
const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));

assert.equal(catalog.schema, 'motif.codex-plugin-activation.v1');
assert.deepEqual(catalog.reviewedToolSurface, [
  'motif_open_workbench',
  'motif_create_workbench_artifact',
]);
assert.ok(Array.isArray(catalog.cases), 'cases must be an array');

const ids = new Set();
let positives = 0;
let negatives = 0;

for (const entry of catalog.cases) {
  assert.equal(typeof entry.id, 'string');
  assert.ok(entry.id.length > 0, 'case id must not be empty');
  assert.ok(!ids.has(entry.id), `duplicate case id: ${entry.id}`);
  ids.add(entry.id);
  assert.equal(typeof entry.prompt, 'string', `${entry.id}: prompt must be text`);
  assert.ok(entry.prompt.trim().length > 0, `${entry.id}: prompt must not be empty`);
  assert.ok(entry.expected && typeof entry.expected === 'object', `${entry.id}: expected is required`);
  assert.equal(typeof entry.expected.behavior, 'string', `${entry.id}: expected behavior is required`);
  assert.equal(typeof entry.expected.result, 'string', `${entry.id}: expected result is required`);

  if (entry.class === 'positive') {
    positives += 1;
    assert.ok(catalog.reviewedToolSurface.includes(entry.expected.tool), `${entry.id}: unexpected tool`);
    assert.equal(typeof entry.fixture, 'string', `${entry.id}: positive cases require a reproducible fixture`);
  } else {
    assert.equal(entry.class, 'negative', `${entry.id}: class must be positive or negative`);
    negatives += 1;
    assert.equal(entry.expected.tool, null, `${entry.id}: negative case must not call Motif`);
    assert.equal(typeof entry.reason, 'string', `${entry.id}: negative cases require a reason`);
  }
}

assert.ok(positives >= 5, `expected at least 5 positive cases; found ${positives}`);
assert.ok(negatives >= 3, `expected at least 3 negative cases; found ${negatives}`);

process.stdout.write(`Codex plugin activation catalog valid: ${positives} positive, ${negatives} negative.\n`);
