// Local mdbase contribution; installed into the vendored core by patch-mdbase.mjs.
import { posix, resolve, relative, isAbsolute, dirname } from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LinkResolver } from './link-resolver.js';
import { parseLink } from '../links/parser.js';
import { parseFieldReference } from '../field-references.js';

/** Explicit same-filesystem no-clobber move. The caller owns recovery journaling. */
export async function moveRecordNoClobber(root, from, to, expectedHash) {
  const canonicalRoot = await fs.realpath(root);
  for (const ref of [from, to]) {
    if (!ref || isAbsolute(ref) || ref.includes('\\') || posix.normalize(ref) !== ref || ref.startsWith('../')) throw new Error('Unsafe move path.');
    let ancestor = resolve(root, ref);
    while (true) {
      try {
        const actual = await fs.realpath(ancestor);
        const contained = relative(canonicalRoot, actual);
        if (isAbsolute(contained) || contained === '..' || contained.startsWith('../')) throw new Error('Move escapes collection.');
        if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('Move path is a symlink.');
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        ancestor = dirname(ancestor);
      }
    }
  }
  const source = resolve(root, from);
  const destination = resolve(root, to);
  const hash = content => createHash('sha256').update(content).digest('hex');
  if (hash(await fs.readFile(source)) !== expectedHash) throw new Error('Source changed before move.');
  await fs.mkdir(dirname(destination), { recursive: true });
  // link refuses EEXIST; EXDEV is intentionally unsupported rather than falling
  // back to an unsafe copy or replacing a task at the destination.
  await fs.link(source, destination);
  if (hash(await fs.readFile(source)) !== expectedHash) throw new Error('Source changed during move; inspect both paths.');
  await fs.unlink(source);
}

/** Pure, snapshot-based reference planning. Does not rename or write any file. */
export function planRecordRename({ records, types, settings, from, to }) {
  const cache = new Map(records.map(record => [record.path, record]));
  const paths = [...cache.keys()];
  const resolver = new LinkResolver({ idField: settings.id_field, recordExtensions: settings.record_extensions });
  const index = resolver.buildIndex(paths, cache);
  const warnings = [];
  const changes = [];
  function warn(path, message) {
    if (!warnings.some(item => item.path === path && item.message === message)) warnings.push({ path, message });
  }
  function rewrite(raw, source, destination, location) {
    let parsed;
    try { parsed = parseLink(raw); } catch { warn(source, `Malformed link at ${location}; not rewritten.`); return raw; }
    const target = parsed?.target ?? raw;
    if (!target || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target) || target.startsWith('#')) return raw;
    if (parsed?.format === 'markdown' && /[()"']/.test(target)) {
      warn(source, `Nested-parenthesis or titled Markdown link at ${location} is outside the supported move profile.`);
      return raw;
    }
    const simple = (!parsed || parsed.format === 'wikilink') && !target.includes('/');
    const idMatches = index.idToFiles.get(target) ?? [];
    if (simple && (idMatches.length > 1 || !idMatches.length && (index.basenameToFiles.get(target)?.length ?? 0) > 1)) {
      if ((index.basenameToFiles.get(target) ?? []).includes(from) || idMatches.includes(from)) warn(source, `Ambiguous reference ${raw} at ${location}; not rewritten.`);
      return raw;
    }
    const resolved = resolver.resolve(raw, source, paths, { fileCache: cache, resolutionIndex: index });
    const relative = parsed && (parsed.format === 'markdown' || parsed.format === 'path' || parsed.is_relative) && !target.startsWith('/');
    const incoming = resolved.resolved === from;
    const outgoing = source !== destination && relative;
    if (!incoming && !outgoing) return raw;
    // Explicit stable identities remain valid after a move.
    if (simple && settings.id_field_explicit && idMatches.length === 1 && idMatches[0] === from) return raw;
    let nextTarget;
    const absoluteTarget = incoming ? to : resolved.resolved ?? posix.normalize(posix.join(posix.dirname(source), target));
    if (absoluteTarget.startsWith('../') || absoluteTarget === '..') {
      warn(source, `Out-of-collection relative target at ${location}; not rewritten.`);
      return raw;
    }
    if (parsed?.format === 'markdown' || parsed?.format === 'path' || parsed?.is_relative) {
      nextTarget = target.startsWith('/') ? `/${absoluteTarget}` : posix.relative(posix.dirname(destination), absoluteTarget);
      if (!nextTarget.startsWith('.') && !nextTarget.startsWith('/')) nextTarget = `./${nextTarget}`;
      if (parsed?.format === 'wikilink' && !/\.md$/i.test(target)) nextTarget = nextTarget.replace(/\.md$/i, '');
    } else {
      nextTarget = absoluteTarget.replace(/\.md$/i, '');
      // A root-level target needs an explicit root marker to remain unambiguous.
      if (!nextTarget.includes('/')) nextTarget = `/${nextTarget}`;
    }
    if (!parsed) return nextTarget;
    if (parsed.format === 'wikilink') return `${parsed.is_embed ? '!' : ''}[[${nextTarget}${parsed.anchor ? `#${parsed.anchor}` : ''}${parsed.alias !== null ? `|${parsed.alias}` : ''}]]`;
    if (parsed.format === 'markdown') return `${parsed.is_embed ? '!' : ''}[${parsed.alias ?? ''}](${encodeURI(nextTarget)}${parsed.anchor ? `#${parsed.anchor}` : ''})`;
    return nextTarget;
  }
  for (const record of records) {
    const destination = record.path === from ? to : record.path;
    const frontmatter = structuredClone(record.frontmatter);
    const references = [];
    const fields = new Set();
    for (const typeName of record.types) {
      const type = types.get(typeName);
      if (!type) continue;
      for (const field of Object.keys(type.collection?.links ?? {})) fields.add(field);
      for (const implementation of type.implements ?? []) {
        if (implementation.contract !== 'tasknotes.task') continue;
        if (implementation.fields.projects) fields.add(`${implementation.fields.projects}[]`);
        if (implementation.fields.blockedBy) fields.add(`${implementation.fields.blockedBy}[].uid`);
      }
      function legacy(definitions, prefix = '') {
        for (const [name, definition] of Object.entries(definitions ?? {})) {
          const path = `${prefix}${name}`;
          if (definition.type === 'link') fields.add(path);
          if (definition.type === 'list' && definition.items?.type === 'link') fields.add(`${path}[]`);
          if (definition.type === 'object') legacy(definition.fields, `${path}.`);
          if (definition.type === 'list' && definition.items?.type === 'object') legacy(definition.items.fields, `${path}[].`);
        }
      }
      legacy(type.fields);
    }
    function visit(container, segments, location) {
      if (!container || typeof container !== 'object' || !segments.length) return;
      const [segment, ...rest] = segments;
      const value = container[segment.key];
      const items = segment.each && Array.isArray(value) ? value.map((_, index) => [value, index]) : [[container, segment.key]];
      for (const [owner, key] of items) {
        if (rest.length) visit(owner[key], rest, `${location}/${key}`);
        else if (typeof owner[key] === 'string') {
          const before = owner[key];
          const after = rewrite(before, record.path, destination, location);
          if (after !== before) { owner[key] = after; references.push({ location, before, after }); }
        }
      }
    }
    for (const field of fields) {
      const segments = parseFieldReference(field);
      if (!segments) { warn(record.path, `Unsupported field reference ${field}.`); continue; }
      visit(frontmatter, segments, field);
    }
    const body = transformBody(record.body, raw => {
      const after = rewrite(raw, record.path, destination, 'body');
      if (after !== raw) references.push({ location: 'body', before: raw, after });
      return after;
    }, message => warn(record.path, message));
    if (record.path === from || references.length) changes.push({ path: record.path, destination, frontmatter, body, references, types: record.types });
  }
  return { changes, warnings };
}

// Replace only recognized link spans outside Markdown code, never global strings.
function transformBody(body, transform, warn) {
  let fence = null;
  return body.split('\n').map(line => {
    const marker = line.match(/^ {0,3}(?:>\s*)*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return line;
    }
    if (marker) { fence = marker[1]; return line; }
    if (/^(?:\t| {4,})/.test(line)) return line;
    if (/^\s*\[[^\]]+\]:\s*\S/.test(line)) { warn('Reference-style Markdown definitions are outside the supported move profile.'); return line; }
    const protectedSpans = [];
    for (let offset = 0; offset < line.length;) {
      if (line[offset] !== '`') { offset++; continue; }
      let end = offset;
      while (line[end] === '`') end++;
      const delimiter = line.slice(offset, end);
      const closing = line.indexOf(delimiter, end);
      if (closing < 0) { offset = end; continue; }
      protectedSpans.push([offset, closing + delimiter.length]);
      offset = closing + delimiter.length;
    }
    return line.replace(/(?<!\\)!?\[\[[^\]\n]+\]\]|(?<!\\)!?\[[^\]\n]*\]\([^\n)]*\)/g, (raw, offset) => {
      if (protectedSpans.some(([start, end]) => offset >= start && offset < end)) return raw;
      return transform(raw);
    });
  }).join('\n');
}
