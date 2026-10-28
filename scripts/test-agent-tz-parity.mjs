import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const test = fileURLToPath(new URL('../tests/agent-lifecycle.test.mjs', import.meta.url));
for (const timezone of ['UTC', 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Tokyo']) {
  const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=dedicated and generic|recurring instance', test], {
    encoding: 'utf8', env: { ...process.env, TZ: timezone }, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    console.error(`Agent lifecycle parity failed in ${timezone}\n${result.stdout}\n${result.stderr}`);
    process.exitCode = 1;
    break;
  }
  console.log(`Agent lifecycle parity passed in ${timezone}`);
}
