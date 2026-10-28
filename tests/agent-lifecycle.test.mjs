import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir, runCli } from './helpers.mjs';
import YAML from 'yaml';

function invoke(root, op, ref, input = {}) {
  const file = join(makeTempDir(), 'request.json');
  writeFileSync(file, JSON.stringify(input));
  const args = ['--path', root, 'agent', op];
  if (ref) args.push(ref);
  const result = runCli([...args, '--input', file, '--json']);
  return { ...result, data: JSON.parse(result.stdout) };
}
function fixture() {
  const root = makeTempDir('mtn-lifecycle-');
  assert.equal(runCli(['init', root]).status, 0);
  for (const ref of ['tasks/a.md', 'tasks/b.md']) assert.equal(invoke(root, 'create', undefined, { title: 'Task', path: ref }).status, 0);
  return root;
}

test('dedicated and generic completion/reopening share metadata and preserve no-op dates', () => {
  const root = fixture();
  const dedicated = invoke(root, 'complete', 'tasks/a.md', { completedDate: '2020-05-06' });
  assert.equal(dedicated.status, 0, dedicated.stdout);
  const generic = invoke(root, 'patch', 'tasks/b.md', { completedDate: '2020-05-06', operations: [{ op: 'set', field: 'status', value: 'done' }] });
  assert.equal(generic.status, 0, generic.stdout);
  assert.equal(dedicated.data.result.frontmatter.completedDate, '2020-05-06');
  assert.equal(generic.data.result.frontmatter.completedDate, '2020-05-06');
  const before = readFileSync(join(root, 'tasks/a.md'), 'utf8');
  const retry = invoke(root, 'complete', 'tasks/a.md');
  assert.equal(retry.data.result.changed, false);
  assert.equal(readFileSync(join(root, 'tasks/a.md'), 'utf8'), before);
  for (const [op, ref, input] of [['reopen', 'tasks/a.md', {}], ['patch', 'tasks/b.md', { operations: [{ op: 'set', field: 'status', value: 'open' }] }]]) {
    const result = invoke(root, op, ref, input);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.data.result.frontmatter.status, 'open');
    assert.equal(result.data.result.frontmatter.completedDate, undefined);
    assert.ok(result.data.result.frontmatter.dateCreated);
  }
});

test('invalid statuses and historical dates fail before mutation', () => {
  const root = fixture();
  const before = readFileSync(join(root, 'tasks/a.md'), 'utf8');
  for (const request of [{ status: 'awaiting-review' }, { status: 'done', completedDate: '2026-02-30' }, { status: 'open', completedDate: '2020-01-01' }]) {
    const result = invoke(root, 'status', 'tasks/a.md', request);
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(root, 'tasks/a.md'), 'utf8'), before);
  }
});

test('custom status/completion mappings and configured blocker states use native fields', () => {
  const root = fixture();
  const path = join(root, '_types/task.md');
  let type = YAML.parse(readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]);
  type = JSON.parse(JSON.stringify(type).replaceAll('"done"', '"verified"'));
  type.schema.value = JSON.parse(JSON.stringify(type.schema.value).replaceAll('"status"', '"state"').replaceAll('"completedDate"', '"finishedOn"'));
  type.schema.value.properties.state.enum.push('waiting');
  type.collection.read_defaults.state = type.collection.read_defaults.status;
  delete type.collection.read_defaults.status;
  type.implements[0].fields.status = 'state';
  type.implements[0].fields.completedDate = 'finishedOn';
  type.implements[0].binding.status.values.push('waiting');
  type.implements[0].binding.status.definitions.push({ ...type.implements[0].binding.status.definitions[0], value: 'waiting', label: 'Waiting', order: 4 });
  type['x-mtn-agent-policy'] = { blockedStatuses: ['waiting'] };
  writeFileSync(path, `---\n${YAML.stringify(type)}---\n`);
  for (const ref of ['tasks/a.md', 'tasks/b.md']) writeFileSync(join(root, ref), readFileSync(join(root, ref), 'utf8').replace('status: open', 'state: open'));
  const finished = invoke(root, 'complete', 'tasks/a.md', { completedDate: '2020-01-02' });
  assert.equal(finished.status, 0, finished.stdout);
  assert.equal(finished.data.result.frontmatter.state, 'verified');
  assert.equal(finished.data.result.frontmatter.finishedOn, '2020-01-02');
  const denied = invoke(root, 'patch', 'tasks/b.md', { operations: [{ op: 'set', field: 'state', value: 'waiting' }] });
  assert.notEqual(denied.status, 0);
  const blocked = invoke(root, 'block', 'tasks/b.md', { status: 'waiting', blocker: 'Awaiting access from owner', author: 'planner' });
  assert.equal(blocked.status, 0, blocked.stdout);
  assert.equal(blocked.data.result.frontmatter.state, 'waiting');
  assert.equal(blocked.data.result.evidence[0].category, 'external-blocker');
  assert.equal(blocked.data.result.evidence[0].content, 'Awaiting access from owner');
});

test('recurring instance completion and reopening preserve unrelated history and base status', () => {
  const root = fixture();
  const recurring = invoke(root, 'create', undefined, { title: 'Recurring', path: 'tasks/recur.md', fields: { recurrence: 'FREQ=DAILY', scheduled: '2026-01-01', completeInstances: ['2026-01-01'], skippedInstances: ['2026-01-02'] } });
  assert.equal(recurring.status, 0, recurring.stdout);
  const complete = invoke(root, 'complete-instance', 'tasks/recur.md', { date: '2026-01-03' });
  assert.equal(complete.status, 0, complete.stdout);
  assert.equal(complete.data.result.frontmatter.status, 'open');
  assert.deepEqual(complete.data.result.frontmatter.completeInstances, ['2026-01-01', '2026-01-03']);
  const retry = invoke(root, 'complete-instance', 'tasks/recur.md', { date: '2026-01-03' });
  assert.equal(retry.data.result.changed, false);
  const reopened = invoke(root, 'reopen-instance', 'tasks/recur.md', { date: '2026-01-03' });
  assert.equal(reopened.status, 0, reopened.stdout);
  assert.deepEqual(reopened.data.result.frontmatter.completeInstances, ['2026-01-01']);
  assert.deepEqual(reopened.data.result.frontmatter.skippedInstances, ['2026-01-02']);
  const skipped = invoke(root, 'skip-instance', 'tasks/recur.md', { date: '2026-01-04' });
  assert.equal(skipped.status, 0, skipped.stdout);
  assert.ok(skipped.data.result.frontmatter.skippedInstances.includes('2026-01-04'));
  const unskipped = invoke(root, 'unskip-instance', 'tasks/recur.md', { date: '2026-01-04' });
  assert.equal(unskipped.status, 0, unskipped.stdout);
  assert.deepEqual(unskipped.data.result.frontmatter.skippedInstances, ['2026-01-02']);
  const baseComplete = invoke(root, 'complete', 'tasks/recur.md');
  assert.equal(baseComplete.status, 0, baseComplete.stdout);
  const baseReopen = invoke(root, 'reopen', 'tasks/recur.md');
  assert.equal(baseReopen.status, 0, baseReopen.stdout);
  assert.deepEqual(baseReopen.data.result.frontmatter.completeInstances, ['2026-01-01']);
  assert.deepEqual(baseReopen.data.result.frontmatter.skippedInstances, ['2026-01-02']);
});
