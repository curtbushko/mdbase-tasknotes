import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { makeTempDir, runCli } from './helpers.mjs';

function fixture() {
  const root = makeTempDir('mtn-dependencies-');
  assert.equal(runCli(['init', root]).status, 0);
  for (const name of ['a', 'b', 'c', 'd']) writeFileSync(join(root, `tasks/${name}.md`), `---\n${YAML.stringify({ type: 'task', title: name, status: 'open', dateCreated: '2026-01-01T00:00:00Z' })}---\nSpecification\n`);
  return root;
}
function invoke(root, op, ref, input = {}) {
  const file = join(makeTempDir(), 'input.json');
  writeFileSync(file, JSON.stringify(input));
  const args = ['--path', root, 'agent', op];
  if (ref) args.push(ref);
  const result = runCli([...args, '--input', file, '--json']);
  return { ...result, data: JSON.parse(result.stdout) };
}

test('chains and multiple prerequisites use base completion, reverse edges, and reopening without dependent rewrites', () => {
  const root = fixture();
  for (const [ref, target] of [['b', 'a'], ['c', 'a'], ['d', 'b'], ['d', 'c']]) {
    const result = invoke(root, 'depends-add', `tasks/${ref}.md`, { target: `tasks/${target}.md` });
    assert.equal(result.status, 0, result.stdout);
  }
  const initial = invoke(root, 'ready');
  assert.equal(initial.status, 0, initial.stdout);
  assert.deepEqual(initial.data.result.results.map(task => task.ref), ['tasks/a.md']);
  const reverse = invoke(root, 'dependencies', 'tasks/a.md');
  assert.deepEqual(reverse.data.result.blocking, ['tasks/b.md', 'tasks/c.md']);
  const before = readFileSync(join(root, 'tasks/d.md'), 'utf8');
  assert.equal(invoke(root, 'complete', 'tasks/b.md').status, 0);
  assert.equal(invoke(root, 'dependencies', 'tasks/d.md').data.result.dependencyReady, false);
  assert.equal(invoke(root, 'complete', 'tasks/c.md').status, 0);
  assert.equal(invoke(root, 'dependencies', 'tasks/d.md').data.result.dependencyReady, true);
  assert.equal(invoke(root, 'reopen', 'tasks/b.md').status, 0);
  assert.equal(invoke(root, 'dependencies', 'tasks/d.md').data.result.dependencyReady, false);
  assert.equal(readFileSync(join(root, 'tasks/d.md'), 'utf8'), before);
});

test('dependency edits are identity-idempotent, preserve reltype/gap, and reject generic/dedicated cycles', () => {
  const root = fixture();
  const added = invoke(root, 'depends-add', 'tasks/b.md', { target: 'tasks/a.md', reltype: 'STARTTOSTART', gap: 'PT4H' });
  assert.equal(added.status, 0, added.stdout);
  assert.equal(added.data.result.frontmatter.blockedBy[0].gap, 'PT4H');
  assert.equal(invoke(root, 'depends-add', 'tasks/b.md', { target: 'tasks/a.md' }).data.result.changed, false);
  assert.equal(invoke(root, 'depends-remove', 'tasks/b.md', { target: 'tasks/d.md' }).data.result.changed, false);
  const before = readFileSync(join(root, 'tasks/a.md'), 'utf8');
  for (const [op, request] of [['depends-add', { target: 'tasks/b.md' }], ['patch', { operations: [{ op: 'set', field: 'blockedBy', value: [{ uid: '[[tasks/b]]', reltype: 'FINISHTOSTART' }] }] }]]) {
    const rejected = invoke(root, op, 'tasks/a.md', request);
    assert.equal(rejected.data.error.code, 'dependency_cycle');
    assert.equal(readFileSync(join(root, 'tasks/a.md'), 'utf8'), before);
  }
  assert.equal(invoke(root, 'depends-add', 'tasks/a.md', { target: 'tasks/a.md' }).data.error.code, 'self_dependency');
  const duplicate = invoke(root, 'patch', 'tasks/b.md', { operations: [{ op: 'set', field: 'blockedBy', value: [{ uid: '[[tasks/a]]', reltype: 'FINISHTOSTART' }, { uid: '[a](a.md)', reltype: 'FINISHTOSTART' }] }] });
  assert.equal(duplicate.data.error.code, 'duplicate_dependency_uid');
});

test('permissive native missing policy remains separate from fail-closed agent readiness and existing cycles', () => {
  const root = fixture();
  writeFileSync(join(root, 'tasknotes.yaml'), YAML.stringify({ dependencies: { treat_missing_target_as_blocked: false } }));
  const file = join(root, 'tasks/b.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('status: open', 'status: open\nblockedBy:\n  - uid: "[[missing]]"\n    reltype: FINISHTOSTART'));
  const broken = invoke(root, 'dependencies', 'tasks/b.md');
  assert.equal(broken.status, 0, broken.stdout);
  assert.equal(broken.data.result.nativeBlocked, false);
  assert.equal(broken.data.result.dependencyReady, false);
  assert.ok(broken.data.result.reasons.some(reason => reason.code === 'missing_target'));
  mkdirSync(join(root, 'other'));
  for (const folder of ['tasks', 'other']) writeFileSync(join(root, folder, 'duplicate.md'), '---\ntype: task\ntitle: Duplicate\nstatus: open\ndateCreated: 2026-01-01T00:00:00Z\n---\n');
  writeFileSync(file, readFileSync(file, 'utf8').replace('[[missing]]', '[[duplicate]]'));
  const ambiguous = invoke(root, 'dependencies', 'tasks/b.md');
  assert.ok(ambiguous.data.result.reasons.some(reason => reason.code === 'ambiguous_target'));
  for (const [name, target] of [['a', 'c'], ['c', 'a']]) {
    const path = join(root, `tasks/${name}.md`);
    writeFileSync(path, readFileSync(path, 'utf8').replace('status: open', `status: open\nblockedBy:\n  - uid: "[[tasks/${target}]]"\n    reltype: FINISHTOSTART`));
  }
  const cycles = invoke(root, 'dependencies', 'tasks/a.md');
  assert.equal(cycles.data.result.dependencyReady, false);
  assert.ok(cycles.data.result.reasons.some(reason => reason.code === 'dependency_cycle'));
});

test('mapped dependencies, configured completion, creation convenience and recurring base semantics agree', () => {
  const root = fixture();
  const typePath = join(root, '_types/task.md');
  let type = YAML.parse(readFileSync(typePath, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]);
  type = JSON.parse(JSON.stringify(type).replaceAll('"done"', '"verified"'));
  type.schema.value = JSON.parse(JSON.stringify(type.schema.value).replaceAll('"blockedBy"', '"prerequisites"'));
  type.implements[0].fields.blockedBy = 'prerequisites';
  for (const key of Object.keys(type.collection.links)) if (key.startsWith('blockedBy')) {
    type.collection.links[key.replace('blockedBy', 'prerequisites')] = type.collection.links[key];
    delete type.collection.links[key];
  }
  writeFileSync(typePath, `---\n${YAML.stringify(type)}---\n`);
  const created = invoke(root, 'create', undefined, { title: 'Dependent', path: 'tasks/e.md', dependsOn: ['tasks/a.md'] });
  assert.equal(created.status, 0, created.stdout);
  assert.equal(created.data.result.frontmatter.blockedBy, undefined);
  assert.equal(created.data.result.frontmatter.prerequisites[0].reltype, 'FINISHTOSTART');
  assert.equal(invoke(root, 'patch', 'tasks/a.md', { operations: [{ op: 'set', field: 'recurrence', value: 'FREQ=DAILY' }, { op: 'set', field: 'scheduled', value: '2026-01-01' }] }).status, 0);
  assert.equal(invoke(root, 'complete-instance', 'tasks/a.md', { date: '2026-01-01' }).status, 0);
  assert.equal(invoke(root, 'dependencies', 'tasks/e.md').data.result.dependencyReady, false);
  assert.equal(invoke(root, 'complete', 'tasks/a.md').status, 0);
  assert.equal(invoke(root, 'dependencies', 'tasks/e.md').data.result.dependencyReady, true);
  const removed = invoke(root, 'depends-remove', 'tasks/d.md', { target: 'tasks/a.md' });
  assert.equal(removed.data.result.changed, false);
  const validation = invoke(root, 'validate');
  assert.equal(validation.status, 0, validation.stdout);
});

test('activity policies distinguish review waits from dependency readiness and explain external blockers', () => {
  const root = fixture();
  const typePath = join(root, '_types/task.md');
  const type = YAML.parse(readFileSync(typePath, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]);
  type['x-mtn-agent-policy'] = { activities: { build: ['open'], review: ['in-progress'] }, blockedStatuses: ['cancelled'] };
  writeFileSync(typePath, `---\n${YAML.stringify(type)}---\n`);
  assert.equal(invoke(root, 'status', 'tasks/a.md', { status: 'in-progress' }).status, 0);
  const review = invoke(root, 'dependencies', 'tasks/a.md', { activity: 'review' });
  assert.equal(review.data.result.agentEligible, true);
  const build = invoke(root, 'dependencies', 'tasks/a.md', { activity: 'build' });
  assert.equal(build.data.result.nativeBlocked, false);
  assert.equal(build.data.result.dependencyReady, true);
  assert.equal(build.data.result.agentEligible, false);
  assert.ok(build.data.result.reasons.some(reason => reason.code === 'non_runnable_status'));
  const blocked = invoke(root, 'block', 'tasks/b.md', { status: 'cancelled', blocker: 'Need credentials' });
  assert.equal(blocked.status, 0, blocked.stdout);
  const external = invoke(root, 'dependencies', 'tasks/b.md', { activity: 'build' });
  assert.ok(external.data.result.reasons.some(reason => reason.code === 'external_blocker'));
  assert.equal(external.data.result.blockerExplanation, 'Need credentials');
  const manual = join(root, 'tasks/c.md');
  writeFileSync(manual, readFileSync(manual, 'utf8').replace('status: open', 'status: cancelled'));
  const before = readFileSync(manual, 'utf8');
  const unexplained = invoke(root, 'dependencies', 'tasks/c.md', { activity: 'build' });
  assert.equal(unexplained.status, 0, unexplained.stdout);
  assert.ok(unexplained.data.result.reasons.some(reason => reason.code === 'missing_blocker_explanation'));
  assert.equal(readFileSync(manual, 'utf8'), before);
});
