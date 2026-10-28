import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { Collection } from '@callumalpass/mdbase';
import { makeTempDir, runCli } from './helpers.mjs';

async function fixture(run) {
  const root = makeTempDir('mtn-atomic-');
  assert.equal(runCli(['init', root]).status, 0);
  const target = join(root, 'tasks/a.md');
  fs.writeFileSync(target, '---\ntype: task\ntitle: Atomic\nstatus: open\ndateCreated: 2026-01-01T00:00:00Z\ndateModified: 2026-01-01T00:00:00Z\n---\nOriginal body\n');
  const { collection, error } = await Collection.open(root);
  assert.equal(error, undefined);
  try { await run(collection, target, root); } finally { await collection.close(); }
}

test('core patched update never opens the original record for truncating writes', async () => {
  await fixture(async (collection, target) => {
    const original = fs.promises.writeFile;
    fs.promises.writeFile = async (path, ...args) => {
      if (String(path) === target) throw new Error('direct overwrite forbidden');
      return original.call(fs.promises, path, ...args);
    };
    try {
      const result = await collection.update({ path: 'tasks/a.md', fields: { priority: 'high' } });
      assert.equal(result.error, undefined);
      assert.match(fs.readFileSync(target, 'utf8'), /priority: high/);
      assert.match(fs.readFileSync(target, 'utf8'), /Original body/);
    } finally { fs.promises.writeFile = original; }
  });
});

test('core reports a simulated external-editor conflict and preserves the newer content', async () => {
  await fixture(async (collection, target) => {
    collection.preWriteHook = () => {
      fs.appendFileSync(target, 'Newer human edit\n');
      const future = new Date(Date.now() + 2000);
      fs.utimesSync(target, future, future);
    };
    const result = await collection.update({ path: 'tasks/a.md', fields: { priority: 'high' } });
    assert.equal(result.error?.code, 'concurrent_modification');
    const observed = fs.readFileSync(target, 'utf8');
    assert.match(observed, /Newer human edit/);
    assert.doesNotMatch(observed, /priority: high/);
  });
});

test('failed atomic publication leaves original task and no temporary records', async () => {
  await fixture(async (collection, target, root) => {
    const before = fs.readFileSync(target, 'utf8');
    const original = fs.promises.rename;
    fs.promises.rename = async (from, to) => {
      if (String(to) === target) throw new Error('injected publication failure');
      return original.call(fs.promises, from, to);
    };
    try {
      await assert.rejects(collection.update({ path: 'tasks/a.md', fields: { priority: 'high' } }), /injected publication failure/);
      assert.equal(fs.readFileSync(target, 'utf8'), before);
      assert.deepEqual(fs.readdirSync(join(root, 'tasks')), ['a.md']);
    } finally { fs.promises.rename = original; }
  });
});
