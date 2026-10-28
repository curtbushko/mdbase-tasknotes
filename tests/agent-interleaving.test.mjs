import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { makeTempDir, runCli } from './helpers.mjs';

test('a CLI mutation re-reads edits from a separately interleaved editor process', { timeout: 20000 }, async t => {
  const root = makeTempDir('mtn-interleaved-');
  assert.equal(runCli(['init', root]).status, 0);
  const target = join(root, 'tasks/a.md');
  writeFileSync(target, '---\ntype: task\ntitle: Interleaving\nstatus: open\ndateCreated: 2026-01-01T00:00:00Z\n---\nOriginal description\n');
  const input = join(makeTempDir(), 'patch.json');
  writeFileSync(input, JSON.stringify({ operations: [{ op: 'set', field: 'priority', value: 'high' }] }));
  const child = fork(fileURLToPath(new URL('../dist/cli.js', import.meta.url)), ['--path', root, 'agent', 'patch', 'tasks/a.md', '--input', input, '--json'], {
    silent: true,
    execArgv: [`--import=${new URL('./fixtures/pause-task-read.mjs', import.meta.url).href}`],
    env: { ...process.env, MTN_TEST_PAUSE_READ: target },
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let stdout = '';
  let stderr = '';
  let editorRan = false;
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('message', message => {
    if (message.event !== 'task-read') return;
    const editor = spawnSync(process.execPath, ['--input-type=module', '-e', 'import fs from "node:fs"; fs.appendFileSync(process.env.MTN_EDITOR_TARGET, "Human edit from a separate process\\n");'], {
      env: { ...process.env, MTN_EDITOR_TARGET: target }, encoding: 'utf8',
    });
    editorRan = editor.status === 0;
    child.send({ event: 'resume' });
  });
  const status = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  assert.equal(status, 0, stderr || stdout);
  assert.equal(editorRan, true);
  const result = JSON.parse(stdout).result;
  assert.equal(result.frontmatter.priority, 'high');
  assert.match(result.description, /Human edit from a separate process/);
  assert.match(readFileSync(target, 'utf8'), /Human edit from a separate process/);
});
