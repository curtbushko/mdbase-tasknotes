import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { format } from 'date-fns';
import { makeTempDir, runCli } from './helpers.mjs';

function setup() {
  const root = makeTempDir('mtn-literal-');
  assert.equal(runCli(['init', root]).status, 0);
  return root;
}
function create(root, request) {
  const input = join(makeTempDir(), 'create.json');
  writeFileSync(input, JSON.stringify(request));
  const result = runCli(['--path', root, 'agent', 'create', '--input', input, '--json']);
  return { ...result, data: JSON.parse(result.stdout) };
}

test('literal creation round-trips multiline specs, explicit typed fields, and shell-sensitive titles without NLP', () => {
  const root = setup();
  const descriptionFile = join(makeTempDir(), 'spec.md');
  const body = '# Scope 🧪\n\nhttps://example.com/#tag\n```sh\necho "$HOME"\n```\n';
  writeFileSync(descriptionFile, body);
  const result = create(root, { title: 'tomorrow #urgent @home +phase https://example.com', path: 'tasks/literal.md', descriptionFile,
    fields: { priority: 'high', contexts: ['agent'], customTyped: { enabled: true, items: [{ n: 1 }] } } });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const task = result.data.result;
  assert.equal(task.ref, 'tasks/literal.md');
  assert.equal(task.frontmatter.title, 'tomorrow #urgent @home +phase https://example.com');
  assert.equal(task.body, body);
  assert.equal(task.frontmatter.due, undefined);
  assert.equal(task.frontmatter.customTyped.enabled, true);
  const shown = runCli(['--path', root, 'agent', 'show', task.ref, '--json']);
  assert.equal(JSON.parse(shown.stdout).result.body, body);
});

test('create retries are inspectable, identity-safe no-ops and conflicting reuse fails', () => {
  const root = setup();
  const request = { title: 'Retry me', retryKey: 'phase-1-task-1', description: 'Specification', fields: { priority: 'normal' } };
  const first = create(root, request);
  assert.equal(first.status, 0, first.stdout);
  const file = join(root, first.data.result.ref);
  const before = readFileSync(file, 'utf8');
  const retry = create(root, request);
  assert.equal(retry.status, 0, retry.stdout);
  assert.equal(retry.data.result.changed, false);
  assert.equal(retry.data.result.ref, first.data.result.ref);
  assert.equal(readFileSync(file, 'utf8'), before);
  const conflict = create(root, { ...request, description: 'Different intent' });
  assert.notEqual(conflict.status, 0);
  assert.equal(conflict.data.error.code, 'idempotency_conflict');
  assert.match(before, /mtnCreateRetry:/);
});

test('creation refuses occupied paths, conflicting inputs, invalid types and runtime templates without partial tasks', () => {
  const root = setup();
  assert.equal(create(root, { title: 'First', path: 'tasks/existing.md' }).status, 0);
  const file = join(root, 'tasks/existing.md');
  const before = readFileSync(file, 'utf8');
  for (const request of [
    { title: 'Other', path: 'tasks/existing.md' },
    { title: 'Invalid type', fields: { timeEstimate: '5' } },
    { title: 'Conflict', description: 'one', descriptionFile: 'two' },
    { title: 'Escape', path: '../escape.md' },
  ]) assert.notEqual(create(root, request).status, 0, JSON.stringify(request));
  assert.equal(readFileSync(file, 'utf8'), before);
  const typePath = join(root, '_types/task.md');
  writeFileSync(typePath, readFileSync(typePath, 'utf8').replace('template: "{{title}}"', 'template: "{{projectFolder}}/{{title}}"'));
  const unsupported = create(root, { title: 'No runtime' });
  assert.notEqual(unsupported.status, 0);
  assert.match(unsupported.data.error.message, /projectFolder/);
});

test('timestamp naming allocates distinct conforming paths on collisions without title suffixes', () => {
  const root = setup();
  const typePath = join(root, '_types/task.md');
  writeFileSync(typePath, readFileSync(typePath, 'utf8').replace('template: "{{title}}"', 'template: "{{timestamp}}"'));
  const occupied = new Set();
  const now = Date.now();
  for (let second = 0; second < 10; second++) {
    const ref = `tasks/${format(new Date(now + second * 1000), 'yyyy-MM-dd-HHmmss')}.md`;
    writeFileSync(join(root, ref), 'Do not overwrite');
    occupied.add(ref);
  }
  const refs = new Set();
  for (let i = 0; i < 3; i++) {
    const result = create(root, { title: 'Same title' });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.data.result.ref, /^tasks\/\d{4}-\d{2}-\d{2}-\d{6}\.md$/);
    assert.equal(result.data.result.frontmatter.title, 'Same title');
    assert.ok(!occupied.has(result.data.result.ref));
    refs.add(result.data.result.ref);
  }
  assert.equal(refs.size, 3);
  for (const ref of occupied) assert.equal(readFileSync(join(root, ref), 'utf8'), 'Do not overwrite');
});

test('strict schemas explicitly diagnose unsupported retry metadata', () => {
  const root = setup();
  const typePath = join(root, '_types/task.md');
  const type = YAML.parse(readFileSync(typePath, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]);
  type.schema.value.additionalProperties = false;
  writeFileSync(typePath, `---\n${YAML.stringify(type)}---\n`);
  const result = create(root, { title: 'Strict', retryKey: 'one' });
  assert.notEqual(result.status, 0);
  assert.equal(result.data.error.code, 'unsupported_capability');
});
