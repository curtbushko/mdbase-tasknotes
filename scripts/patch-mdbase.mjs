// Reproducible local dependency patch: preserve the pinned APIs, harden file writes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'mtn-core-patch-'));
try {
  execFileSync('tar', ['-xzf', resolve('vendor/callumalpass-mdbase-0.3.0-rc.4.tgz'), '-C', temp]);
  const file = join(temp, 'package/dist/operations/collection.js');
  let source = readFileSync(file, 'utf8');
  const needle = 'await fs.promises.writeFile(fullPath, content);';
  if (source.split(needle).length !== 4) throw new Error('Pinned core changed: review patch before regenerating.');
  let occurrence = 0;
  source = source.replaceAll(needle, () => `await atomicWriteRecord(fullPath, content, ${++occurrence === 1});`);
  source = source.replace('const DEFAULT_SPEC_VERSION =', `
// mtn patch: same-directory temp + rename avoids truncating an existing task.
// Creation publishes with link(2), refusing a target created by another writer.
async function atomicWriteRecord(destination, content, exclusive = false) {
    const temporary = path.join(path.dirname(destination), ".mtn-write-" + ulid() + ".tmp");
    let mode = 0o666;
    if (!exclusive) mode = (await fs.promises.stat(destination)).mode & 0o777;
    const handle = await fs.promises.open(temporary, "wx", mode);
    try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
        await handle.close();
        if (exclusive) await fs.promises.link(temporary, destination);
        else await fs.promises.rename(temporary, destination);
    } finally {
        await handle.close().catch(() => {});
        await fs.promises.unlink(temporary).catch(error => {
            if (error.code !== "ENOENT") throw error;
        });
    }
}
const DEFAULT_SPEC_VERSION =`);
  writeFileSync(file, source);
  // The original delimiter regex used \\s*, consuming leading blank lines from
  // descriptions. Restrict it to horizontal whitespace for literal round-trips.
  const parserFile = join(temp, 'package/dist/frontmatter/parser.js');
  const parser = readFileSync(parserFile, 'utf8');
  const delimiter = String.raw`afterFirst.match(/^---\s*$/m)`;
  if (!parser.includes(delimiter)) throw new Error('Pinned parser changed: review delimiter patch.');
  writeFileSync(parserFile, parser.replace(delimiter, String.raw`afterFirst.match(/^---[ \t]*\r?$/m)`));
  // Expose the pinned snapshot link resolver/parser as supported local-fork APIs.
  for (const extension of ['js', 'd.ts']) {
    const index = join(temp, `package/dist/index.${extension}`);
    writeFileSync(index, readFileSync(index, 'utf8') + '\nexport { LinkResolver } from "./operations/link-resolver.js";\nexport { parseLink } from "./links/parser.js";\n');
  }
  const resolverFile = join(temp, 'package/dist/operations/link-resolver.js');
  let resolver = readFileSync(resolverFile, 'utf8');
  const resolverNeedle = '            if (!this.idField)';
  if (!resolver.includes(resolverNeedle)) throw new Error('Pinned resolver changed: review filename patch.');
  resolver = resolver.replace(resolverNeedle, `            // Explicit filename wikilinks (including extension) are valid too.
            const filename = path.basename(filePath);
            if (filename !== basename) {
                const named = basenameToFiles.get(filename) ?? [];
                named.push(filePath);
                basenameToFiles.set(filename, named);
            }
${resolverNeedle}`);
  writeFileSync(resolverFile, resolver);
  const manifest = join(temp, 'package/package.json');
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  pkg.version = '0.3.0-rc.4-mtn.3';
  writeFileSync(manifest, JSON.stringify(pkg, null, 2) + '\n');
  execFileSync('npm', ['pack', join(temp, 'package'), '--pack-destination', resolve('vendor')], { stdio: 'inherit' });
} finally {
  rmSync(temp, { recursive: true, force: true });
}
