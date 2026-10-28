import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

export function makeTempDir(prefix = 'mtn-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}
export function stripAnsi(text) { return text.replace(ANSI_RE, ''); }

// Spawn the public CLI directly: no login shell, shell interpolation, or hidden
// output files. This also lets tests exercise stdin and genuine cwd selection.
export function runCli(args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: opts.cwd,
    input: opts.input,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr || result.error?.message || '',
  };
}
