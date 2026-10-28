// Test-only preload. Production commands have no fault-injection environment flag.
import fs from 'node:fs';
const rename = fs.promises.rename;
fs.promises.rename = async (from, to) => {
  if (String(to) === process.env.MTN_TEST_FAIL_REFERENCE) throw new Error('injected reference publication failure');
  return rename.call(fs.promises, from, to);
};
