import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const tempRoot = mkdtempSync(join(tmpdir(), "mdbase-tasknotes-package-smoke-"));
let tarball;
function runNpm(args, options) {
  if (process.env.npm_execpath) return execFileSync(process.execPath, [process.env.npm_execpath, ...args], options);
  return execFileSync("npm", args, { ...options, shell: process.platform === "win32" });
}
try {
  const packed = JSON.parse(runNpm(["pack", "--json"], { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
  tarball = resolve(packageRoot, packed[0].filename);
  // An artifact must install away from its source/vendor directory. The previous
  // smoke only checked --version from a tarball still beside the repository.
  const artifact = join(tempRoot, "artifact.tgz");
  copyFileSync(tarball, artifact);
  writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ name: "mdbase-tasknotes-package-smoke", private: true }));
  runNpm(["install", "--ignore-scripts", artifact], { cwd: tempRoot, stdio: "inherit" });
  const installed = join(tempRoot, "node_modules/mdbase-tasknotes");
  const cli = join(installed, "dist/cli.js");
  function run(args) {
    return execFileSync(process.execPath, [cli, ...args], { cwd: tempRoot, encoding: "utf8", env: { ...process.env, MDBASE_TASKNOTES_PATH: "" } });
  }
  const expected = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
  assert.equal(run(["--version"]).trim(), expected);
  assert.ok(existsSync(join(installed, "docs/agent-capabilities.md")), "installed command contracts must be shipped");
  const collection = join(tempRoot, "collection");
  run(["init", collection]);
  const diagnosis = JSON.parse(run(["--path", collection, "diagnose", "--json"]));
  assert.equal(diagnosis.ok, true);
  assert.equal(diagnosis.result.versions.core, "0.3.0-rc.4-mtn.7");
  assert.equal(diagnosis.result.capabilities.relocation, true);
  function agent(operation, ref, request) {
    const input = join(tempRoot, "request.json");
    writeFileSync(input, JSON.stringify(request));
    return JSON.parse(run(["--path", collection, "agent", operation, ...(ref ? [ref] : []), "--input", input, "--json"])).result;
  }
  const task = agent("create", undefined, { title: "tomorrow #literal", path: "tasks/task.md", description: "\n\nPackaged specification\n", retryKey: "package-task" });
  assert.equal(task.frontmatter.title, "tomorrow #literal");
  assert.equal(task.description, "\n\nPackaged specification\n");
  assert.equal(agent("create", undefined, { title: "tomorrow #literal", path: "tasks/task.md", description: "\n\nPackaged specification\n", retryKey: "package-task" }).changed, false);
  agent("note", task.ref, { content: "Package verification passed", category: "build", adopt: true });
  agent("complete", task.ref, {});
  const plan = agent("move-plan", task.ref, { to: "tasks/moved.md" });
  assert.equal(agent("move-apply", task.ref, { plan }).ref, "tasks/moved.md");
  assert.equal(existsSync(join(collection, "tasks/task.md")), false);
  run(["--path", collection, "create", "Buy groceries tomorrow #package"]);
  assert.equal(JSON.parse(run(["--path", collection, "list", "--json"])).length, 1);
  assert.equal(JSON.parse(run(["--path", collection, "list", "--where", "true", "--json"])).length, 2);
} finally {
  if (tarball) rmSync(tarball, { force: true });
  rmSync(tempRoot, { recursive: true, force: true });
}
