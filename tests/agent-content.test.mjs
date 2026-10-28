import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTempDir, runCli } from './helpers.mjs';

function command(root, op, request) {
  const input = join(makeTempDir(), 'request.json');
  writeFileSync(input, JSON.stringify(request));
  const args = ['--path', root, 'agent', op];
  if (op !== 'create') args.push('tasks/task.md');
  args.push('--input', input, '--json');
  const result = runCli(args);
  return { ...result, data: JSON.parse(result.stdout) };
}
function fixture(description = '# Scope\n\nUnicode 🧪\n```md\n## Acceptance\n```\n') {
  const root = makeTempDir('mtn-content-');
  assert.equal(runCli(['init', root]).status, 0);
  assert.equal(command(root, 'create', { title: 'Task', path: 'tasks/task.md', description }).status, 0);
  return root;
}

test('description/evidence remain independent and full review history survives fresh sessions', () => {
  const root = fixture();
  for (const [category, content] of [['build', 'npm test: PASS'], ['review', 'CHANGES_NEEDED: fix this'], ['fix', 'Regression added'], ['review', 'APPROVED']]) {
    const result = command(root, 'note', { category, content, author: 'caller', adopt: true });
    assert.equal(result.status, 0, result.stdout || result.stderr);
  }
  const replaced = command(root, 'describe', { description: '# Updated scope\nPRD story #21\n' });
  assert.equal(replaced.status, 0, replaced.stdout);
  assert.equal(replaced.data.result.description, '# Updated scope\nPRD story #21\n');
  assert.equal(replaced.data.result.evidence.length, 4);
  assert.equal(replaced.data.result.evidence[1].content, 'CHANGES_NEEDED: fix this');
  const shown = runCli(['--path', root, 'agent', 'show', 'tasks/task.md', '--json']);
  const task = JSON.parse(shown.stdout).result;
  assert.equal(task.evidence[3].content, 'APPROVED');
  assert.match(task.body, /npm test: PASS/);
  assert.match(task.body, /PRD story #21/);
});

test('evidence retry keys no-op only for identical intent and preserve description', () => {
  const root = fixture();
  const note = { category: 'build', role: 'builder', author: 'agent-1', retryKey: 'build-1', content: '✅ npm test\n```sh\nnpm test\n```\n', adopt: true };
  const first = command(root, 'note', note);
  assert.equal(first.status, 0, first.stdout);
  assert.equal(first.data.result.evidence[0].role, 'builder');
  const retry = command(root, 'note', note);
  assert.equal(retry.status, 0, retry.stdout);
  assert.equal(retry.data.result.changed, false);
  assert.equal(retry.data.result.evidence.length, 1);
  assert.equal(retry.data.result.evidence[0].content, note.content);
  assert.match(retry.data.result.description, /Unicode/);
  const conflict = command(root, 'note', { ...note, content: 'Different result' });
  assert.equal(conflict.data.error.code, 'idempotency_conflict');
});

test('human bodies require explicit adoption, conflicting inputs and reserved delimiters fail safely', () => {
  const root = fixture('Human-authored body\n');
  const refused = command(root, 'note', { content: 'Evidence' });
  assert.equal(refused.data.error.code, 'content_consent_required');
  const adopted = command(root, 'note', { content: 'Evidence', adopt: true });
  assert.equal(adopted.status, 0, adopted.stdout);
  assert.equal(adopted.data.result.description, 'Human-authored body\n');
  const file = join(makeTempDir(), 'description.md');
  writeFileSync(file, 'From file\n');
  const replacement = command(root, 'describe', { descriptionFile: file });
  assert.equal(replacement.status, 0, replacement.stdout);
  assert.equal(replacement.data.result.description, 'From file\n');
  assert.equal(replacement.data.result.evidence.length, 1);
  const bad = command(root, 'describe', { description: 'one', descriptionFile: file });
  assert.equal(bad.data.error.code, 'invalid_input');
  const reserved = command(root, 'note', { content: '<!-- mtn:evidence:v1 -->' });
  assert.equal(reserved.data.error.code, 'invalid_input');
});
