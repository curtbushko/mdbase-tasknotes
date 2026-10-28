// Event-driven test coordination; no production pause hook or polling protocol.
import fs from 'node:fs';
const readFile = fs.promises.readFile;
let paused = false;
fs.promises.readFile = async (path, ...args) => {
  const content = await readFile.call(fs.promises, path, ...args);
  if (!paused && String(path) === process.env.MTN_TEST_PAUSE_READ && process.send) {
    paused = true;
    process.send({ event: 'task-read' });
    await new Promise(resolve => process.once('message', resolve));
  }
  return content;
};
