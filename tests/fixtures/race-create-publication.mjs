// Simulate another application occupying the path after the CLI's existence check.
import fs from 'node:fs';
import { dirname } from 'node:path';
const link = fs.promises.link;
let raced = false;
fs.promises.link = async (from, to) => {
  if (!raced && dirname(String(to)) === process.env.MTN_TEST_RACE_DIRECTORY && String(to).endsWith('.md')) {
    raced = true;
    fs.writeFileSync(to, 'Owner concurrent note\n', { flag: 'wx' });
  }
  return link.call(fs.promises, from, to);
};
