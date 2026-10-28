import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { makeTempDir, runCli } from './helpers.mjs';

function fixture() {
  const root = makeTempDir('mtn-hierarchy-');
  assert.equal(runCli(['init', root]).status, 0);
  const tasks = {
    'project': { status: 'open' },
    'phase-a': { projects: ['[[tasks/project]]'] },
    'phase-b': { projects: ['[[tasks/project]]'] },
    'shared': { projects: ['[[tasks/phase-a]]', '[[tasks/phase-b]]'], status: 'done', completedDate: '2026-01-02' },
    'pending': { projects: ['[[tasks/phase-a]]'] },
    'empty': {},
  };
  for (const [name, fields] of Object.entries(tasks)) writeFileSync(join(root, `tasks/${name}.md`), `---\n${YAML.stringify({ type: 'task', title: name, status: 'open', dateCreated: '2026-01-01T00:00:00Z', ...fields })}---\nStory #7\n`);
  writeFileSync(join(root, 'company.md'), '---\ntitle: Company\n---\nCompatible non-task project\n');
  return root;
}
function invoke(root, operation, ref, input = {}) {
  const path = join(makeTempDir(), 'request.json');
  writeFileSync(path, JSON.stringify(input));
  const result = runCli(['--path', root, 'agent', operation, ref, '--input', path, '--json']);
  return { ...result, data: JSON.parse(result.stdout) };
}

test('hierarchy exposes direct children, deduplicated descendants and leaf progress separately from status', () => {
  const root = fixture();
  const result = invoke(root, 'hierarchy', 'tasks/project.md');
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(result.data.result.children, ['tasks/phase-a.md', 'tasks/phase-b.md']);
  assert.deepEqual(result.data.result.progress, { completed: 1, total: 2, percentage: 50 });
  assert.equal(result.data.result.descendants.filter(ref => ref === 'tasks/shared.md').length, 1);
  assert.equal(result.data.result.parentStatus, 'open');
  assert.ok(!result.data.result.children.includes('tasks/shared.md'));
  const empty = invoke(root, 'hierarchy', 'company.md');
  assert.equal(empty.status, 0, empty.stdout);
  assert.deepEqual(empty.data.result.progress, { completed: 0, total: 0, percentage: null });
});

test('native membership edits preserve unrelated projects and reject cycles through generic and dedicated operations', () => {
  const root = fixture();
  const added = invoke(root, 'project-add', 'tasks/pending.md', { target: 'company.md' });
  assert.equal(added.status, 0, added.stdout);
  assert.equal(added.data.result.frontmatter.projects.length, 2);
  const retry = invoke(root, 'project-add', 'tasks/pending.md', { target: 'company.md' });
  assert.equal(retry.data.result.changed, false);
  const removed = invoke(root, 'project-remove', 'tasks/pending.md', { target: 'company.md' });
  assert.deepEqual(removed.data.result.frontmatter.projects, ['[[tasks/phase-a]]']);
  const before = readFileSync(join(root, 'tasks/project.md'), 'utf8');
  for (const [op, input] of [['project-add', { target: 'tasks/shared.md' }], ['patch', { operations: [{ op: 'set', field: 'projects', value: ['[[tasks/shared]]'] }] }]]) {
    const result = invoke(root, op, 'tasks/project.md', input);
    assert.notEqual(result.status, 0);
    assert.equal(result.data.error.code, 'hierarchy_cycle');
    assert.equal(readFileSync(join(root, 'tasks/project.md'), 'utf8'), before);
  }
});

test('custom project mapping, explicit replacement and recurring leaf counting honor native semantics', () => {
  const root = fixture();
  const path = join(root, '_types/task.md');
  const type = YAML.parse(readFileSync(path, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]);
  type.schema.value = JSON.parse(JSON.stringify(type.schema.value).replaceAll('"projects"', '"memberships"'));
  type.collection.links['memberships[]'] = type.collection.links['projects[]'];
  delete type.collection.links['projects[]'];
  type.implements[0].fields.projects = 'memberships';
  writeFileSync(path, `---\n${YAML.stringify(type)}---\n`);
  for (const name of ['phase-a', 'phase-b', 'shared', 'pending']) {
    const file = join(root, `tasks/${name}.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace('projects:', 'memberships:'));
  }
  const recurring = join(root, 'tasks/shared.md');
  writeFileSync(recurring, readFileSync(recurring, 'utf8').replace('status: done', 'status: done\nrecurrence: FREQ=DAILY\ncompleteInstances: [2026-01-01, 2026-01-02]'));
  const result = invoke(root, 'hierarchy', 'tasks/project.md');
  assert.deepEqual(result.data.result.progress, { completed: 1, total: 2, percentage: 50 });
  const replacement = invoke(root, 'project-replace', 'tasks/pending.md', { target: 'tasks/phase-a.md', replacement: 'company.md' });
  assert.equal(replacement.status, 0, replacement.stdout);
  assert.deepEqual(replacement.data.result.frontmatter.memberships, ['[[company.md]]']);
  assert.equal(replacement.data.result.frontmatter.projects, undefined);
});

test('archived branches are excluded, shared live descendants survive, and existing cycles are diagnosed', () => {
  const root = fixture();
  const path = join(root, 'tasks/phase-a.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('status: open', 'status: open\ntags: [archived]'));
  const excluded = invoke(root, 'hierarchy', 'tasks/project.md');
  assert.equal(excluded.status, 0, excluded.stdout);
  assert.deepEqual(excluded.data.result.progress, { completed: 1, total: 1, percentage: 100 });
  const included = invoke(root, 'hierarchy', 'tasks/project.md', { includeArchived: true });
  assert.deepEqual(included.data.result.progress, { completed: 1, total: 2, percentage: 50 });
  const project = join(root, 'tasks/project.md');
  writeFileSync(project, readFileSync(project, 'utf8').replace('status: open', 'status: open\nprojects: ["[[tasks/shared]]"]'));
  const cycles = invoke(root, 'hierarchy', 'tasks/project.md');
  assert.equal(cycles.status, 0, cycles.stdout);
  assert.ok(cycles.data.result.cycles.length > 0);
});
