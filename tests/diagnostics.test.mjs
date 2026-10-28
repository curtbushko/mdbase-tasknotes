import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { makeTempDir, runCli } from './helpers.mjs';

function init() {
  const root = makeTempDir('mtn-diagnostics-');
  assert.equal(runCli(['init', root]).status, 0);
  return root;
}
function snapshot(root) {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => { const file = join(entry.parentPath ?? entry.path, entry.name); return [file, readFileSync(file, 'utf8')]; }));
}

test('diagnostics is read-only and reports effective current contract and capabilities', () => {
  const root = init();
  const before = snapshot(root);
  const result = runCli(['--path', root, 'diagnose', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const data = JSON.parse(result.stdout);
  assert.equal(data.version, 1);
  assert.equal(data.ok, true);
  assert.equal(data.result.root, root);
  assert.equal(data.result.selectionSource, '--path');
  assert.equal(data.result.mapping.roleToField.status, 'status');
  assert.deepEqual(data.result.mapping.completedStatuses, ['done']);
  assert.equal(data.result.versions.core, '0.3.0-rc.4-mtn.1');
  assert.equal(data.result.versions.model, '0.3.0-rc.5');
  assert.equal(data.result.contracts[0].version, '0.3.0-rc.1');
  assert.equal(data.result.validation.policy, 'warn');
  assert.equal(typeof data.result.capabilities.coreRename, 'boolean');
  assert.deepEqual(data.result.issues, []);
  assert.deepEqual(snapshot(root), before);
  const human = runCli(['--path', root, 'diagnose']);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /Collection:/);
});

test('missing config and missing task schema fail explicitly without initializing', () => {
  const root = makeTempDir('mtn-missing-');
  const result = runCli(['--path', root, 'diagnose', '--json']);
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(result.stdout).error.code, 'configuration_error');
  assert.deepEqual(readdirSync(root), []);
  const configured = init();
  const typePath = join(configured, '_types/task.md');
  const text = readFileSync(typePath, 'utf8');
  const type = YAML.parse(text.match(/^---\n([\s\S]*?)\n---/)[1]);
  type.schema = { dialect: 'json-schema-2020-12', ref: 'missing.schema.json' };
  writeFileSync(typePath, `---\n${YAML.stringify(type)}---\n`);
  const failed = runCli(['--path', configured, 'diagnose', '--json']);
  assert.notEqual(failed.status, 0);
  assert.equal(JSON.parse(failed.stdout).error.code, 'configuration_error');
});

test('diagnostics warns about unsafe exclusions and unsupported template without repair', () => {
  const root = init();
  const configPath = join(root, 'mdbase.yaml');
  const config = YAML.parse(readFileSync(configPath, 'utf8'));
  config.settings.exclude = ['_types'];
  writeFileSync(configPath, YAML.stringify(config));
  const typePath = join(root, '_types/task.md');
  writeFileSync(typePath, readFileSync(typePath, 'utf8').replace('template: "{{title}}"', 'template: "{{projectFolder}}/{{title}}"'));
  const before = snapshot(root);
  const result = runCli(['--path', root, 'diagnose', '--json']);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const issues = JSON.parse(result.stdout).result.issues;
  assert.ok(issues.some(issue => issue.code === 'unsafe_exclusions'));
  assert.ok(issues.some(issue => issue.code === 'unsupported_template_value' && issue.values.includes('projectFolder')));
  assert.deepEqual(snapshot(root), before);
});

test('init rerun refuses to alter config/custom schema and excludes operational task copies', () => {
  const root = init();
  const config = YAML.parse(readFileSync(join(root, 'mdbase.yaml'), 'utf8'));
  for (const folder of ['.mdbase', '.mtn', '.mtn-recovery', '.mtn-tmp', '_schemas', '_contracts']) {
    assert.ok(config.settings.exclude.includes(folder), folder);
  }
  const before = snapshot(root);
  const retry = runCli(['init', root]);
  assert.notEqual(retry.status, 0);
  assert.deepEqual(snapshot(root), before);
  for (const folder of ['.mtn-recovery', '.mtn-tmp']) {
    mkdirSync(join(root, folder), { recursive: true });
    writeFileSync(join(root, folder, 'copy.md'), '---\ntype: task\ntitle: Recovery copy\nstatus: open\n---\n');
  }
  const listing = runCli(['--path', root, 'list', '--json']);
  assert.equal(listing.status, 0);
  assert.deepEqual(JSON.parse(listing.stdout), []);
});

test('legacy diagnostics respects custom mappings, completed values, and path_pattern', () => {
  const root = makeTempDir('mtn-legacy-diagnostics-');
  writeFileSync(join(root, 'mdbase.yaml'), YAML.stringify({ spec_version: '0.2.1', settings: { types_folder: '_types', exclude: ['_types', '.mdbase', '.mtn', '.mtn-recovery', '.mtn-tmp'] } }));
  mkdirSync(join(root, '_types'));
  writeFileSync(join(root, '_types/task.md'), `---\n${YAML.stringify({
    name: 'task', path_pattern: 'inbox/{{timestamp}}.md',
    fields: { heading: { type: 'string', tn_role: 'title' }, state: { type: 'enum', values: ['queued', 'finished'], tn_role: 'status', tn_completed_values: ['finished'] } },
  })}---\n`);
  const before = snapshot(root);
  const response = runCli(['--path', root, 'diagnose', '--json']);
  assert.equal(response.status, 0, response.stdout || response.stderr);
  const data = JSON.parse(response.stdout).result;
  assert.equal(data.versions.profile, 'v0.2');
  assert.equal(data.mapping.roleToField.status, 'state');
  assert.deepEqual(data.mapping.completedStatuses, ['finished']);
  assert.equal(data.path.legacyPattern, 'inbox/{{timestamp}}.md');
  assert.ok(!data.issues.some(issue => issue.code === 'unsupported_template_value'));
  assert.deepEqual(snapshot(root), before);
});

test('diagnostics identifies flag/env/global/cwd root selection precedence', () => {
  const root = init();
  const other = init();
  const home = makeTempDir('mtn-home-');
  mkdirSync(join(home, '.config/mdbase-tasknotes'), { recursive: true });
  writeFileSync(join(home, '.config/mdbase-tasknotes/config.json'), JSON.stringify({ collectionPath: other }));
  const env = { HOME: home, MDBASE_TASKNOTES_PATH: root };
  const flag = runCli(['--path', other, 'diagnose', '--json'], { env });
  assert.equal(JSON.parse(flag.stdout).result.selectionSource, '--path');
  assert.equal(JSON.parse(flag.stdout).result.root, other);
  const environment = runCli(['diagnose', '--json'], { env });
  assert.equal(JSON.parse(environment.stdout).result.selectionSource, 'MDBASE_TASKNOTES_PATH');
  const global = runCli(['diagnose', '--json'], { env: { ...env, MDBASE_TASKNOTES_PATH: '' } });
  assert.equal(JSON.parse(global.stdout).result.selectionSource, 'collectionPath');
  const emptyHome = makeTempDir('mtn-empty-home-');
  const cwd = runCli(['diagnose', '--json'], { env: { HOME: emptyHome, MDBASE_TASKNOTES_PATH: '' } });
  assert.equal(JSON.parse(cwd.stdout).error.details.selectionSource, 'cwd');
});
