import { access, lstat, realpath, readFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { AgentContext, AgentError, invalid, record } from "./agent.js";
import { prepareLiteralCreation } from "./create-compat.js";
import picomatch from "picomatch";
import { validateProjects } from "./task-hierarchy.js";
import { validateDependencies } from "./task-dependencies.js";

export async function textInput(request: Record<string, unknown>, key: string): Promise<string | undefined> {
  const fileKey = `${key}File`;
  if (request[key] !== undefined && request[fileKey] !== undefined) invalid(`Use only ${key} or ${fileKey}, not both.`);
  if (request[key] !== undefined) {
    if (typeof request[key] !== "string") invalid(`${key} must be a string.`);
    return request[key] as string;
  }
  if (request[fileKey] !== undefined) {
    if (typeof request[fileKey] !== "string") invalid(`${fileKey} must be a path or -.`);
    try {
      if (request[fileKey] === "-") {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks).toString("utf8");
      }
      return await readFile(request[fileKey] as string, "utf8");
    } catch (error) { throw new AgentError("invalid_input", `Cannot read ${fileKey}: ${(error as Error).message}`); }
  }
  return undefined;
}

export function intentHash(value: unknown): string {
  function sorted(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, sorted(value)]));
    return item;
  }
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}

export async function safeDestination(context: AgentContext, ref: string): Promise<void> {
  if (!ref || isAbsolute(ref) || ref.includes("\\") || ref.includes("\0") || !ref.endsWith(".md") || posix.normalize(ref) !== ref || ref.startsWith("../")) throw new AgentError("invalid_reference", "Destination must be an exact collection-relative Markdown path.");
  const settings = context.settings;
  if (!settings.include_subfolders && ref.includes("/")) throw new AgentError("invalid_reference", "Subfolders are excluded by collection policy.");
  const patterns = [...settings.exclude, settings.types_folder, settings.contracts_folder, settings.cache_folder, settings.migrations_folder];
  const segments = ref.split("/");
  for (let end = 1; end <= segments.length; end++) {
    const part = segments.slice(0, end).join("/");
    if (patterns.some(pattern => picomatch(pattern, { dot: true, matchBase: !pattern.includes("/") })(part))) throw new AgentError("invalid_reference", `Destination is excluded: ${part}`);
    try {
      if ((await lstat(resolve(context.root, part))).isSymbolicLink()) throw new AgentError("invalid_reference", "Destination traverses a symlink.");
      if (end < segments.length) {
        try { await access(resolve(context.root, part, "mdbase.yaml")); throw new AgentError("invalid_reference", "Destination is inside a nested collection."); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const root = await realpath(context.root);
  // Resolve the closest existing ancestor before creating anything, rejecting symlink escapes.
  let ancestor = resolve(context.root, ref);
  while (true) {
    try {
      const actual = await realpath(ancestor);
      const contained = relative(root, actual);
      if (isAbsolute(contained) || contained === ".." || contained.startsWith("../")) throw new AgentError("invalid_reference", "Destination escapes the collection.");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw new AgentError("invalid_reference", "Cannot resolve destination.");
      ancestor = parent;
    }
  }
}

export async function createAgentTask(context: AgentContext, input: unknown) {
  const request = record(input);
  if (typeof request.title !== "string" || !request.title.trim()) invalid("Supply a non-empty literal title.");
  if (request.path !== undefined && typeof request.path !== "string") invalid("path must be a collection-relative Markdown path.");
  if (request.retryKey !== undefined && (typeof request.retryKey !== "string" || !request.retryKey.trim())) invalid("retryKey must be a non-empty string.");
  const body = await textInput(request, "description") ?? "";
  const fields = request.fields === undefined ? {} : { ...record(request.fields) };
  const titleField = context.mapping.roleToField.title;
  if (titleField in fields && fields[titleField] !== request.title) invalid("Conflicting title and mapped title field.");
  fields[titleField] = request.title;
  for (const key of [...context.typeKeys, "blocking", "isBlocked", "isBlocking", "hasSubtasks", "depends_on", "dependsOn", "depends-on", "mtnCreateRetry"]) {
    if (key in fields) throw new AgentError("protected_field", `Creation field ${key} requires its semantic operation.`);
  }
  if (context.mapping.completedStatuses.includes(String(fields[context.mapping.roleToField.status]))) throw new AgentError("protected_field", "Create an incomplete task, then use the completion lifecycle operation.");
  if (request.dependsOn !== undefined) {
    if (!Array.isArray(request.dependsOn) || !request.dependsOn.every(target => typeof target === "string")) invalid("dependsOn must be a list of exact task references.");
    if (context.mapping.roleToField.blockedBy in fields) invalid("Do not combine dependsOn with an explicit mapped blockedBy list.");
    fields[context.mapping.roleToField.blockedBy] = (request.dependsOn as string[]).map(target => ({ uid: `[[${target}]]`, reltype: "FINISHTOSTART" }));
  }
  const intent = intentHash({ title: request.title, path: request.path ?? null, fields, body });
  if (request.retryKey) {
    const tasks = await context.collection.query({ types: ["task"], limit: Number.MAX_SAFE_INTEGER });
    if (tasks.error) throw new AgentError(tasks.error.code, tasks.error.message);
    const matches = tasks.results?.filter(task => {
      const metadata = task.frontmatter.mtnCreateRetry;
      return metadata && typeof metadata === "object" && (metadata as Record<string, unknown>).key === request.retryKey;
    }) ?? [];
    if (matches.length > 1) throw new AgentError("ambiguous_target", "Multiple tasks carry this retry key; repair duplicate identities explicitly.");
    if (matches.length) {
      const existing = await context.read(matches[0].path);
      if ((existing.frontmatter.mtnCreateRetry as Record<string, unknown>)?.intent !== intent) throw new AgentError("idempotency_conflict", "Retry key was already used for a different creation intent.");
      return { ...existing, changed: false };
    }
    fields.mtnCreateRetry = { key: request.retryKey, intent };
  }
  const type = context.types.get("task")!;
  const retryDisallowed = type.schema?.value?.additionalProperties === false
    && !(type.schema.value.properties as Record<string, unknown> | undefined)?.mtnCreateRetry
    || type.fields && (type.strict ?? context.settings.default_strict) === true && !type.fields.mtnCreateRetry;
  if (request.retryKey && retryDisallowed) {
    throw new AgentError("unsupported_capability", "This strict schema does not permit inspectable mtnCreateRetry metadata. Configure an optional schema-permitted retry identity at the authoritative layer.");
  }
  const template = type.path_pattern ?? type.collection?.path?.pattern ?? type.collection?.path?.template ?? "";
  const supportsSeconds = /\{\{?(?:timestamp|time|second|unix|zettel)\}?\}/.test(template);
  const now = Date.now();
  const explicit = request.path as string | undefined;
  const attempts = explicit || !supportsSeconds ? 1 : 60;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const prepared = prepareLiteralCreation(type, context.mapping, fields, new Date(now + attempt * 1000), explicit);
    if (!prepared.path) throw new AgentError("unsupported_capability", prepared.errorMessage ?? "Unsupported naming contract.");
    const ref = prepared.path;
    await safeDestination(context, ref);
    try {
      await access(resolve(context.root, ref));
      if (attempt + 1 < attempts) continue;
      throw new AgentError("path_conflict", `Occupied creation path: ${ref}. Naming allocation exhausted; choose an explicit unoccupied path or retry later.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    // Allocate a free identity before graph checks: an occupied timestamp may be
    // the parent/prerequisite itself, not a self-edge on the task being created.
    if (context.mapping.roleToField.projects in prepared.frontmatter) await validateProjects(context, ref, prepared.frontmatter[context.mapping.roleToField.projects], undefined);
    if (context.mapping.roleToField.blockedBy in prepared.frontmatter) await validateDependencies(context, ref, prepared.frontmatter[context.mapping.roleToField.blockedBy], undefined);
    context.validateTypes(prepared.frontmatter, ["task"]);
    let result: Awaited<ReturnType<typeof context.collection.create>>;
    try {
      result = await context.collection.create({ type: "task", path: ref, frontmatter: prepared.frontmatter, body });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (attempt + 1 < attempts) continue;
      throw new AgentError("path_conflict", `Creation path was occupied concurrently: ${ref}. Choose an unoccupied explicit path or retry later.`);
    }
    if (result.error) {
      if (["path_conflict", "file_exists"].includes(result.error.code) && attempt + 1 < attempts) continue;
      throw new AgentError(result.error.code, result.error.message, result);
    }
    return { ...await context.read(ref), changed: true };
  }
  throw new AgentError("path_conflict", "Naming allocation exhausted.");
}
