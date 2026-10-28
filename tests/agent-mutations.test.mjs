import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir, runCli } from './helpers.mjs';
import YAML from 'yaml';

function fixture() {
  const root = makeTempDir('mtn-agent-');
  assert.equal(runCli(['init', root]).status, 0);
  for (const path of ['a.md', 'b.md']) {
    writeFileSync(join(root, 'tasks', path), '---\ntype: task\ntitle: Duplicate\nstatus: open\ndateCreated: 2026-01-01T00:00:00Z\ndateModified: 2026-01-01T00:00:00Z\ncustomHuman: keep\ncustomNull: null\n---\nHuman body\n');
  }
  return root;
}
function agent(root, op, ref, input) {
  const args = ['--path', root, 'agent', op];
  if (ref) args.push(ref);
  if (input !== undefined) {
    const file = join(makeTempDir(), 'input.json');
    writeFileSync(file, JSON.stringify(input));
    args.push('--input', file);
  }
  args.push('--json');
  const result = runCli(args);
  return { ...result, data: JSON.parse(result.stdout) };
}

test('agent exact references never resolve titles and JSON includes full persisted context', () => {
  const root = fixture();
  const shown = agent(root, 'show', 'tasks/a.md');
  assert.equal(shown.status, 0, shown.stdout || shown.stderr);
  assert.equal(shown.data.version, 1);
  assert.equal(shown.data.result.ref, 'tasks/a.md');
  assert.match(shown.data.result.body, /Human body/);
  for (const ref of ['Duplicate', 'tasks/missing.md', '../outside.md']) {
    const before = readFileSync(join(root, 'tasks/a.md'), 'utf8');
    const result = agent(root, 'patch', ref, { operations: [{ op: 'set', field: 'priority', value: 'high' }] });
    assert.notEqual(result.status, 0);
    assert.equal(result.data.ok, false);
    assert.deepEqual(readFileSync(join(root, 'tasks/a.md'), 'utf8'), before);
  }
});

test('agent typed patch preserves observed edits/body and treats retries as no-ops', () => {
  const root = fixture();
  const path = join(root, 'tasks/a.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('Human body', 'Edited by human'));
  const input = { operations: [
    { op: 'set', field: 'contexts', value: ['one'] },
    { op: 'add', field: 'contexts', value: 'two' },
    { op: 'set', field: 'timeEstimate', value: 15 },
    { op: 'set', field: 'customNullable', value: null },
    { op: 'set', field: 'customNested', value: { enabled: true, items: [{ n: 3 }] } },
  ] };
  const patched = agent(root, 'patch', 'tasks/a.md', input);
  assert.equal(patched.status, 0, patched.stdout || patched.stderr);
  assert.deepEqual(patched.data.result.frontmatter.contexts, ['one', 'two']);
  assert.equal(patched.data.result.frontmatter.customNested.enabled, true);
  assert.equal(patched.data.result.frontmatter.customHuman, 'keep');
  assert.equal(patched.data.result.frontmatter.customNull, null);
  assert.equal(patched.data.result.frontmatter.customNullable, null);
  assert.match(patched.data.result.body, /Edited by human/);
  const beforeRetry = readFileSync(path, 'utf8');
  const retry = agent(root, 'patch', 'tasks/a.md', { operations: [{ op: 'set', field: 'timeEstimate', value: 15 }] });
  assert.equal(retry.data.result.changed, false);
  assert.equal(readFileSync(path, 'utf8'), beforeRetry);
  const removed = agent(root, 'patch', 'tasks/a.md', { operations: [{ op: 'remove', field: 'contexts', value: 'one' }, { op: 'unset', field: 'customNested' }] });
  assert.equal(removed.status, 0, removed.stdout);
  assert.deepEqual(removed.data.result.frontmatter.contexts, ['two']);
  assert.equal('customNested' in removed.data.result.frontmatter, false);
});

test('agent fails closed on invalid typed writes and reserved semantic fields', () => {
  const root = fixture();
  const file = join(root, 'tasks/a.md');
  for (const operation of [
    { op: 'set', field: 'timeEstimate', value: '15' },
    { op: 'unset', field: 'status' },
    { op: 'unset', field: 'title' },
    { op: 'set', field: 'status', value: 'not-configured' },
    { op: 'set', field: 'projects', value: ['[[tasks/a]]'] },
    { op: 'set', field: 'blockedBy', value: [{ uid: '[[tasks/a]]', reltype: 'FINISHTOSTART' }] },
    { op: 'set', field: 'blocking', value: ['tasks/b.md'] },
    { op: 'set', field: 'type', value: 'other' },
    { op: 'set', field: 'mtnCreateRetry', value: { key: 'corrupt', intent: 'other' } },
    { op: 'set', field: 'dependsOn', value: ['tasks/b.md'] },
  ]) {
    const before = readFileSync(file, 'utf8');
    const result = agent(root, 'patch', 'tasks/a.md', { operations: [operation] });
    assert.notEqual(result.status, 0, JSON.stringify(operation));
    assert.equal(result.data.ok, false);
    assert.equal(readFileSync(file, 'utf8'), before);
  }
});

test('agent honors custom mapping and declared additional-property constraints under warn policy', () => {
  const root = fixture();
  const path = join(root, '_types/task.md');
  const raw = readFileSync(path, 'utf8');
  const type = YAML.parse(raw.match(/^---\n([\s\S]*?)\n---/)[1]);
  type.schema.value.properties.rank = { type: 'integer', minimum: 1 };
  type.schema.value.properties.estimate = type.schema.value.properties.timeEstimate;
  delete type.schema.value.properties.timeEstimate;
  type.implements[0].fields.timeEstimate = 'estimate';
  type.schema.value.additionalProperties = false;
  type.schema.value.properties.type = { const: 'task' };
  type.schema.value.properties.customHuman = { type: 'string' };
  type.schema.value.properties.customNull = { type: 'null' };
  writeFileSync(path, `---\n${YAML.stringify(type)}---\n`);
  for (const input of [
    { operations: [{ op: 'set', field: 'rank', value: 0 }] },
    { operations: [{ op: 'set', field: 'notPermitted', value: true }] },
  ]) {
    const before = readFileSync(join(root, 'tasks/a.md'), 'utf8');
    const result = agent(root, 'patch', 'tasks/a.md', input);
    assert.equal(result.data.error.code, 'validation_failed');
    assert.equal(readFileSync(join(root, 'tasks/a.md'), 'utf8'), before);
  }
  const valid = agent(root, 'patch', 'tasks/a.md', { operations: [{ op: 'set', field: 'rank', value: 2 }, { op: 'set', field: 'estimate', value: 10 }] });
  assert.equal(valid.status, 0, valid.stdout);
  assert.equal(valid.data.result.frontmatter.rank, 2);
  assert.equal(valid.data.result.frontmatter.estimate, 10);
});

test('agent rejects symlink escapes and malformed requests with JSON failures', () => {
  const root = fixture();
  const outside = makeTempDir('mtn-outside-');
  writeFileSync(join(outside, 'victim.md'), 'untouched');
  symlinkSync(outside, join(root, 'escape'));
  const escaped = agent(root, 'show', 'escape/victim.md');
  assert.notEqual(escaped.status, 0);
  assert.equal(escaped.data.error.code, 'invalid_reference');
  const bad = runCli(['--path', root, 'agent', 'patch', 'tasks/a.md', '--json']);
  assert.notEqual(bad.status, 0);
  assert.equal(JSON.parse(bad.stdout).error.code, 'invalid_input');
  const parseError = runCli(['agent', 'show', 'tasks/a.md', '--bad-option', '--json']);
  assert.notEqual(parseError.status, 0);
  assert.equal(JSON.parse(parseError.stdout).error.code, 'invalid_input');
  assert.equal(parseError.stderr, '');
});
