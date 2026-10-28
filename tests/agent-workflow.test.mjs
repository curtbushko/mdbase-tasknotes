import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import YAML from 'yaml';
import { buildTaskNotesMdbaseResources } from '@tasknotes/model/mdbase';
import { DEFAULT_FIELD_MAPPING } from '@tasknotes/model/mapping';
import { parseTaskDocument } from '@tasknotes/model/frontmatter';
import { makeTempDir, runCli } from './helpers.mjs';

const statuses = ['planning', 'open', 'in-progress', 'awaiting-review', 'changes-requested', 'done'].map((value, order) => ({
  id: value, value, label: value, color: '', isCompleted: value === 'done', order, autoArchive: false, autoArchiveDelay: 0,
}));
function fixture(mapped) {
  const root = makeTempDir('mtn-workflow-');
  const folder = mapped ? 'work' : 'tasks';
  const mapping = { ...DEFAULT_FIELD_MAPPING, ...(mapped ? { status: 'state', projects: 'memberships', blockedBy: 'prerequisites' } : {}) };
  const resources = buildTaskNotesMdbaseResources({ tasksFolder: folder,
    collection: { validation: 'warn', exclude: ['_types', '_contracts', '_schemas', '.git', 'node_modules', '.mdbase', '.mtn', '.mtn-recovery', '.mtn-tmp'] },
    path: { template: mapped ? '{{timestamp}}' : '{{title}}', runtime: 'tasknotes', generatedBy: 'tasknotes.filename.create' },
    modelConfig: { fieldMapping: mapping, statuses, defaults: { status: 'open', priority: 'normal', taskTag: 'task' } },
  });
  for (const [path, content] of [[resources.paths.config, resources.configDocument], [resources.paths.contract, resources.contractDocument], [resources.paths.type, resources.typeDocument], [resources.paths.taskSchema, resources.taskSchemaDocument], [resources.paths.bindingSchema, resources.bindingSchemaDocument]]) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  mkdirSync(join(root, folder), { recursive: true });
  const path = join(root, resources.paths.type);
  const type = YAML.parse(resources.typeDocument.match(/^---\n([\s\S]*?)\n---/)[1]);
  type['x-mtn-agent-policy'] = { activities: { build: ['open', 'in-progress', 'changes-requested'], review: ['awaiting-review'] } };
  writeFileSync(path, `---\n${YAML.stringify(type)}---\n`);
  return { root, folder, mapping };
}
function command(root, operation, ref, request = {}) {
  const input = join(makeTempDir(), 'request.json');
  writeFileSync(input, JSON.stringify(request));
  const result = runCli(['--path', root, 'agent', operation, ...(ref ? [ref] : []), '--input', input, '--json']);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(response.ok, true);
  return response.result;
}

for (const mapped of [false, true]) test(`complete native-record workflow: ${mapped ? 'standalone mapped timestamp profile' : 'fixed inbox profile'}`, () => {
  const { root, folder, mapping } = fixture(mapped);
  const create = request => command(root, 'create', undefined, request);
  const project = create({ title: 'Project', fields: { [mapping.status]: 'planning' }, description: 'PRD stories #1-42' });
  const phase = create({ title: 'Phase', fields: { [mapping.status]: 'planning', [mapping.projects]: [`[[${project.ref}]]`] }, description: 'PRD stories #7, #13, #21' });
  const request = { title: 'First implementation', retryKey: 'phase-first', fields: { [mapping.projects]: [`[[${phase.ref}]]`] }, description: '# Specification\n\nPRD story #21\n- [ ] Acceptance criteria\n' };
  const first = create(request);
  const second = create({ title: 'Second implementation', fields: { [mapping.projects]: [`[[${phase.ref}]]`] }, dependsOn: [first.ref], description: 'PRD story #13' });
  assert.ok(first.ref.startsWith(`${folder}/`));
  assert.equal(create(request).changed, false);
  let ready = command(root, 'ready', phase.ref, { activity: 'build' });
  assert.deepEqual(ready.results.map(task => task.ref), [first.ref]);
  // Simulated TaskNotes/editor write happens before the next CLI mutation starts.
  writeFileSync(join(root, first.ref), readFileSync(join(root, first.ref), 'utf8') + 'Human implementation context\n');
  command(root, 'status', first.ref, { status: 'in-progress' });
  const build = { content: 'npm test: PASS', category: 'build', author: 'builder-1', role: 'builder', retryKey: 'build-1', adopt: true };
  command(root, 'note', first.ref, build);
  assert.equal(command(root, 'note', first.ref, build).changed, false);
  command(root, 'status', first.ref, { status: 'awaiting-review' });
  assert.deepEqual(command(root, 'ready', phase.ref, { activity: 'review' }).results.map(task => task.ref), [first.ref]);
  command(root, 'note', first.ref, { content: 'CHANGES_NEEDED: add regression', category: 'review', author: 'reviewer-1' });
  command(root, 'status', first.ref, { status: 'changes-requested' });
  command(root, 'note', first.ref, { content: 'Regression fixed and verified', category: 'fix', author: 'builder-1' });
  command(root, 'status', first.ref, { status: 'awaiting-review' });
  command(root, 'note', first.ref, { content: 'APPROVED', category: 'review', author: 'reviewer-1' });
  const resumed = command(root, 'show', first.ref);
  assert.equal(resumed.frontmatter[mapping.status], 'awaiting-review', 'approval must not automatically complete');
  assert.equal(resumed.evidence.length, 4);
  assert.match(resumed.description, /Human implementation context/);
  const native = parseTaskDocument(readFileSync(join(root, first.ref), 'utf8'), { path: first.ref, fieldMapping: mapping, statuses });
  assert.equal(native.task.status, 'awaiting-review');
  assert.ok(native.task.projects.includes(`[[${phase.ref}]]`));
  assert.match(native.body, /CHANGES_NEEDED/);
  command(root, 'complete', first.ref);
  ready = command(root, 'ready', phase.ref, { activity: 'build' });
  assert.deepEqual(ready.results.map(task => task.ref), [second.ref]);
  const plan = command(root, 'move-plan', first.ref, { to: 'archive/first.md' });
  command(root, 'move-apply', first.ref, { plan });
  assert.equal(create(request).ref, 'archive/first.md', 'retry identity survives a move');
  command(root, 'reopen', 'archive/first.md');
  assert.equal(command(root, 'dependencies', second.ref, { activity: 'build' }).agentEligible, false);
  command(root, 'complete', 'archive/first.md');
  command(root, 'complete', second.ref);
  const progress = command(root, 'hierarchy', phase.ref);
  assert.deepEqual(progress.progress, { completed: 2, total: 2, percentage: 100 });
  assert.equal(progress.parentStatus, 'planning');
  const dependentNative = parseTaskDocument(readFileSync(join(root, second.ref), 'utf8'), { path: second.ref, fieldMapping: mapping, statuses });
  assert.equal(dependentNative.task.blockedBy[0].uid, 'archive/first');
  assert.equal(dependentNative.task.status, 'done');
  assert.equal(command(root, 'validate').valid, true);
  assert.equal(existsSync(join(root, '.tasks')), false);
  assert.equal(existsSync(join(root, '.phases')), false);
});

test('legacy collection writes retain mapped lifecycle and literal creation semantics', () => {
  const root = makeTempDir('mtn-legacy-workflow-');
  mkdirSync(join(root, '_types'));
  mkdirSync(join(root, 'tasks'));
  writeFileSync(join(root, 'mdbase.yaml'), YAML.stringify({ spec_version: '0.2.1', settings: { types_folder: '_types', exclude: ['_types', '.mdbase', '.mtn', '.mtn-recovery', '.mtn-tmp'] } }));
  writeFileSync(join(root, '_types/task.md'), `---\n${YAML.stringify({
    name: 'task', path_pattern: 'tasks/{{timestamp}}.md', strict: false,
    fields: {
      heading: { type: 'string', required: true, tn_role: 'title' },
      state: { type: 'enum', values: ['queued', 'finished'], default: 'queued', tn_role: 'status', tn_completed_values: ['finished'] },
      created: { type: 'datetime', required: true, tn_role: 'dateCreated' },
      modified: { type: 'datetime', tn_role: 'dateModified' },
      finishedOn: { type: 'date', tn_role: 'completedDate' },
    },
  })}---\n`);
  const created = command(root, 'create', undefined, { title: 'tomorrow #literal', description: 'Legacy specification', retryKey: 'legacy-task' });
  assert.equal(created.frontmatter.heading, 'tomorrow #literal');
  assert.equal(created.frontmatter.state, 'queued');
  const completed = command(root, 'complete', created.ref, { completedDate: '2020-01-02' });
  assert.equal(completed.frontmatter.state, 'finished');
  assert.equal(completed.frontmatter.finishedOn, '2020-01-02');
  const reopened = command(root, 'patch', created.ref, { operations: [{ op: 'set', field: 'state', value: 'queued' }] });
  assert.equal(reopened.frontmatter.finishedOn, undefined);
  assert.equal(reopened.description, 'Legacy specification');
});

test('unsupported declared TaskNotes contract versions fail closed with actionable capabilities', () => {
  const { root } = fixture(false);
  for (const path of ['_types/task.md', '_contracts/tasknotes.task.md']) {
    const file = join(root, path);
    writeFileSync(file, readFileSync(file, 'utf8').replace('version: 0.3.0-rc.1', 'version: 99.0.0'));
  }
  const input = join(makeTempDir(), 'input.json');
  writeFileSync(input, JSON.stringify({ title: 'Do not create' }));
  const result = runCli(['--path', root, 'agent', 'create', '--input', input, '--json']);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).error.code, 'unsupported_capability');
  const diagnosed = runCli(['--path', root, 'diagnose', '--json']);
  assert.equal(diagnosed.status, 0, diagnosed.stdout);
  assert.equal(JSON.parse(diagnosed.stdout).result.capabilities.agentMutations, false);
});

test('all automation operations have JSON failures; stdin content and cwd work without a shell', () => {
  const { root } = fixture(false);
  const operations = ['show', 'patch', 'describe', 'note', 'status', 'complete', 'reopen', 'block', 'complete-instance', 'reopen-instance', 'skip-instance', 'unskip-instance', 'project-add', 'project-remove', 'project-replace', 'hierarchy', 'depends-add', 'depends-remove', 'depends-replace', 'dependencies', 'ready', 'blocked', 'validate', 'move-plan', 'move-apply'];
  const input = join(makeTempDir(), 'request.json');
  writeFileSync(input, '{}');
  for (const operation of operations) {
    const failure = runCli(['--path', root, 'agent', operation, 'tasks/missing.md', '--input', input, '--json']);
    assert.notEqual(failure.status, 0, operation);
    const response = JSON.parse(failure.stdout);
    assert.equal(response.version, 1);
    assert.equal(response.ok, false);
    assert.equal(typeof response.error.code, 'string');
  }
  const created = runCli(['--path', root, 'agent', 'create', '--input', '-', '--json'], { input: JSON.stringify({ title: '-', path: 'tasks/stdin.md', description: 'Multiline\nfrom stdin\n' }) });
  assert.equal(created.status, 0, created.stdout);
  assert.equal(JSON.parse(created.stdout).result.description, 'Multiline\nfrom stdin\n');
  const streamed = runCli(['--path', root, 'agent', 'describe', 'tasks/stdin.md', '--input', input, '--json']);
  assert.notEqual(streamed.status, 0);
  writeFileSync(input, JSON.stringify({ contentFile: '-', adopt: true, category: 'build' }));
  const note = runCli(['--path', root, 'agent', 'note', 'tasks/stdin.md', '--input', input, '--json'], { input: 'Piped verification\n' });
  assert.equal(note.status, 0, note.stdout);
  assert.equal(JSON.parse(note.stdout).result.evidence[0].content, 'Piped verification\n');
  const home = makeTempDir();
  const diagnosed = runCli(['diagnose', '--json'], { cwd: root, env: { HOME: home, MDBASE_TASKNOTES_PATH: '' } });
  assert.equal(diagnosed.status, 0, diagnosed.stdout);
  assert.equal(JSON.parse(diagnosed.stdout).result.selectionSource, 'cwd');
  const malformed = runCli(['diagnose', '--bad-option', '--json']);
  assert.notEqual(malformed.status, 0);
  assert.equal(JSON.parse(malformed.stdout).error.code, 'invalid_input');
});
