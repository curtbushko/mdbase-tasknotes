import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { makeTempDir, runCli } from './helpers.mjs';

function fixture() {
  const root = makeTempDir('mtn-move-');
  assert.equal(runCli(['init', root]).status, 0);
  const common = { type: 'task', status: 'open', dateCreated: '2026-01-01T00:00:00Z', dateModified: '2026-01-01T00:00:00Z' };
  writeFileSync(join(root, 'tasks/a.md'), `---\n${YAML.stringify({ ...common, title: 'A', id: 'stable-a', custom: { keep: true, nullValue: null } })}---\n[B](b.md)\n[Section](#Heading)\n`);
  writeFileSync(join(root, 'tasks/b.md'), `---\n${YAML.stringify({ ...common, title: 'B', projects: ['[[tasks/a#Heading|Parent]]'], blockedBy: [{ uid: '[[tasks/a]]', reltype: 'STARTTOSTART', gap: 'PT4H' }] })}---\n[A](a.md#Heading)\n[[tasks/a|Alias]]\nhttps://example.com/tasks/a\nPlain tasks/a text\n` + '`[[tasks/a]]`\n~~~md\n[[tasks/a]]\n~~~\n```md\n[[tasks/a]]\n```\n');
  return root;
}
function invoke(root, op, ref, input = {}, env = {}) {
  const file = join(makeTempDir(), 'request.json');
  writeFileSync(file, JSON.stringify(input));
  const result = runCli(['--path', root, 'agent', op, ref, '--input', file, '--json'], { env });
  return { ...result, data: JSON.parse(result.stdout) };
}
function snapshot(root) {
  return Object.fromEntries(readdirSync(root, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const path = join(entry.parentPath ?? entry.path, entry.name);
    return [path, readFileSync(path, 'utf8')];
  }));
}

test('move preview is read-only; apply repairs native/nested/body references and outgoing relative meaning', () => {
  const root = fixture();
  const before = snapshot(root);
  const preview = invoke(root, 'move-plan', 'tasks/a.md', { to: 'archive/renamed.md' });
  assert.equal(preview.status, 0, preview.stdout);
  assert.deepEqual(snapshot(root), before);
  assert.ok(preview.data.result.referenceChanges.some(change => change.location.includes('blockedBy')));
  const applied = invoke(root, 'move-apply', 'tasks/a.md', { plan: preview.data.result });
  assert.equal(applied.status, 0, applied.stdout);
  assert.equal(applied.data.result.ref, 'archive/renamed.md');
  assert.equal(existsSync(join(root, 'tasks/a.md')), false);
  const moved = readFileSync(join(root, 'archive/renamed.md'), 'utf8');
  assert.match(moved, /\[B\]\(\.\.\/tasks\/b.md\)/);
  assert.match(moved, /\[Section\]\(#Heading\)/);
  assert.match(moved, /id: stable-a/);
  assert.match(moved, /nullValue: null/);
  assert.match(moved, /dateModified: ['"]?2026-01-01/);
  const referring = readFileSync(join(root, 'tasks/b.md'), 'utf8');
  assert.match(referring, /archive\/renamed#Heading\|Parent/);
  assert.match(referring, /archive\/renamed/);
  assert.match(referring, /gap: PT4H/);
  assert.match(referring, /\[A\]\(\.\.\/archive\/renamed.md#Heading\)/);
  assert.match(referring, /https:\/\/example.com\/tasks\/a/);
  assert.match(referring, /Plain tasks\/a text/);
  assert.match(referring, /`\[\[tasks\/a\]\]`/);
  assert.match(referring, /~~~md\n\[\[tasks\/a\]\]\n~~~/);
  const retry = invoke(root, 'move-apply', 'tasks/a.md', { plan: preview.data.result });
  assert.equal(retry.status, 0, retry.stdout);
  assert.equal(retry.data.result.changed, false);
  const listing = runCli(['--path', root, 'list', '--json']);
  assert.equal(JSON.parse(listing.stdout).length, 2);
});

test('move refuses stale edits, occupied destinations, and path escape before writing', () => {
  const root = fixture();
  for (const to of ['tasks/b.md', '../outside.md']) {
    const before = snapshot(root);
    assert.notEqual(invoke(root, 'move-plan', 'tasks/a.md', { to }).status, 0);
    assert.deepEqual(snapshot(root), before);
  }
  const preview = invoke(root, 'move-plan', 'tasks/a.md', { to: 'archive/a.md' });
  assert.equal(preview.status, 0, preview.stdout);
  writeFileSync(join(root, 'tasks/b.md'), readFileSync(join(root, 'tasks/b.md'), 'utf8') + 'Human edit\n');
  const before = snapshot(root);
  const stale = invoke(root, 'move-apply', 'tasks/a.md', { plan: preview.data.result });
  assert.equal(stale.data.error.code, 'concurrent_modification');
  assert.deepEqual(snapshot(root), before);
});

test('mapped relationship fields are repaired, and unsupported reference forms require explicit acceptance', () => {
  const root = fixture();
  const typePath = join(root, '_types/task.md');
  const type = YAML.parse(readFileSync(typePath, 'utf8').match(/^---\n([\s\S]*?)\n---/)[1]);
  type.schema.value = JSON.parse(JSON.stringify(type.schema.value).replaceAll('"projects"', '"memberships"').replaceAll('"blockedBy"', '"prerequisites"'));
  type.implements[0].fields.projects = 'memberships';
  type.implements[0].fields.blockedBy = 'prerequisites';
  type.collection.links['memberships[]'] = type.collection.links['projects[]'];
  delete type.collection.links['projects[]'];
  writeFileSync(typePath, `---\n${YAML.stringify(type)}---\n`);
  const path = join(root, 'tasks/b.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('projects:', 'memberships:').replace('blockedBy:', 'prerequisites:') + '[A][task]\n[task]: a.md\n');
  const preview = invoke(root, 'move-plan', 'tasks/a.md', { to: 'archive/a.md' });
  assert.equal(preview.status, 0, preview.stdout);
  assert.equal(preview.data.result.referenceRepairComplete, false);
  const before = snapshot(root);
  const refused = invoke(root, 'move-apply', 'tasks/a.md', { plan: preview.data.result });
  assert.equal(refused.data.error.code, 'unsupported_capability');
  assert.deepEqual(snapshot(root), before);
  const applied = invoke(root, 'move-apply', 'tasks/a.md', { plan: preview.data.result, acceptLimitations: true });
  assert.equal(applied.status, 0, applied.stdout);
  assert.equal(applied.data.result.referenceRepairComplete, false);
  const result = readFileSync(path, 'utf8');
  assert.match(result, /memberships:/);
  assert.match(result, /prerequisites:/);
  assert.match(result, /archive\/a/);
  assert.match(result, /\[task\]: a.md/);
});

test('injected mid-move failure retains excluded backups/journal and refuses destructive retry', () => {
  const root = fixture();
  const preview = invoke(root, 'move-plan', 'tasks/a.md', { to: 'archive/a.md' });
  assert.equal(preview.status, 0, preview.stdout);
  const failure = invoke(root, 'move-apply', 'tasks/a.md', { plan: preview.data.result }, {
    NODE_OPTIONS: `--import=${new URL('./fixtures/fail-reference-write.mjs', import.meta.url).href}`,
    MTN_TEST_FAIL_REFERENCE: join(root, 'tasks/b.md'),
  });
  assert.notEqual(failure.status, 0);
  assert.equal(failure.data.error.code, 'move_partial_failure');
  const journalPath = failure.data.error.details.journal;
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  assert.equal(journal.status, 'partial');
  assert.ok(journal.records.some(record => record.backup));
  assert.equal(existsSync(join(root, 'archive/a.md')), true);
  const retry = invoke(root, 'move-apply', 'tasks/a.md', { plan: preview.data.result });
  assert.equal(retry.data.error.code, 'recovery_required');
  assert.equal(existsSync(journalPath), true);
});
