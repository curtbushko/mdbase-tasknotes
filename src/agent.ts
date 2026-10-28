import { Collection, DataContractRegistry, loadConfig, loadTypes, validateJsonSchemaFrontmatter, type TypeDefinition, type MdbaseSettings } from "@callumalpass/mdbase";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, posix } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { resolveCollectionPath } from "./config.js";
import { buildFieldMapping, normalizeTaskTypeDefinition, type FieldMapping } from "./field-mapping.js";
import { inspectContent } from "./task-content.js";
import { statusFields } from "./task-lifecycle.js";
import { validateProjects } from "./task-hierarchy.js";

type RecordValue = Record<string, unknown>;
export class AgentError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}
export function invalid(message: string): never { throw new AgentError("invalid_input", message); }
export function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Expected a JSON object.");
  return value as RecordValue;
}
function coreResult<T extends { error?: { code: string; message: string } }>(result: T): T {
  if (result.error) throw new AgentError(result.error.code, result.error.message, result);
  return result;
}

export async function withAgent<T>(flagPath: string | undefined, run: (context: AgentContext) => Promise<T>): Promise<T> {
  const root = resolveCollectionPath(flagPath);
  const configResult = await loadConfig(root);
  if (!configResult.valid || !configResult.config) throw new AgentError("configuration_error", configResult.error?.message ?? "Missing mdbase.yaml.");
  const config = configResult.config;
  const loaded = await loadTypes(root, config);
  if (!loaded.valid || !loaded.types?.has("task")) throw new AgentError("configuration_error", loaded.error?.message ?? "Missing task type.");
  const registry = await DataContractRegistry.load(root, config, loaded.types);
  if (!registry.valid || !registry.registry) throw new AgentError("configuration_error", registry.error?.message ?? "Invalid contracts.");
  // This stricter per-operation policy is in memory only, never saved to the collection.
  const collection = new Collection(root, { ...config, settings: { ...config.settings, default_validation: "error" } }, loaded.types, {}, registry.registry);
  try {
    const normalized = normalizeTaskTypeDefinition(loaded.types.get("task"));
    const context = new AgentContext(root, collection, buildFieldMapping(normalized.fields, normalized.displayNameKey), loaded.types, config.settings.explicit_type_keys, config.settings);
    return await run(context);
  } finally {
    await collection.close();
  }
}

export class AgentContext {
  constructor(
    public root: string,
    public collection: Collection,
    public mapping: FieldMapping,
    public types: Map<string, TypeDefinition>,
    public typeKeys: string[],
    public settings: MdbaseSettings,
  ) {}

  async exact(ref: string, taskOnly = true): Promise<string> {
    if (!ref || isAbsolute(ref) || ref.includes("\\") || ref.includes("\0") || !ref.endsWith(".md") || posix.normalize(ref) !== ref || ref.startsWith("../")) {
      throw new AgentError("invalid_reference", "Use an exact collection-relative Markdown path, not a title or traversal.");
    }
    let actual: string;
    try { actual = await realpath(resolve(this.root, ref)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AgentError("missing_target", `Task not found: ${ref}`);
      throw error;
    }
    const contained = relative(await realpath(this.root), actual);
    if (isAbsolute(contained) || contained === ".." || contained.startsWith("../")) throw new AgentError("invalid_reference", "Reference escapes the selected collection.");
    const tasks = coreResult(await this.collection.query({ ...(taskOnly ? { types: ["task"] } : {}), limit: Number.MAX_SAFE_INTEGER }));
    if (!tasks.results?.some(task => task.path === ref)) throw new AgentError("missing_target", `Not an included task: ${ref}`);
    return ref;
  }

  async read(ref: string) {
    await this.exact(ref);
    const read = coreResult(await this.collection.read(ref));
    const body = read.body ?? "";
    const { suffix: _suffix, ...content } = inspectContent(body);
    return { ref, frontmatter: read.rawFrontmatter ?? read.frontmatter ?? {}, effectiveFrontmatter: read.frontmatter ?? {}, body, ...content, revision: read.revision, safety: "strict-validation; fresh-read; core conflict checks; no exclusive claim" };
  }

  async writeBody(current: { ref: string; body: string; frontmatter: RecordValue; revision?: string }, body: string) {
    if (body === current.body) return { ...await this.read(current.ref), changed: false };
    this.validateTypes(current.frontmatter, this.collection.getTypesForFile(current.ref, current.frontmatter));
    coreResult(await this.collection.update({ path: current.ref, body, if_revision: current.revision }));
    return { ...await this.read(current.ref), changed: true };
  }

  validateTypes(frontmatter: RecordValue, typeNames: string[]): void {
    for (const name of typeNames) {
      const type = this.types.get(name);
      if (!type) continue;
      if (type.schema) {
        const issues = validateJsonSchemaFrontmatter(frontmatter, type);
        if (issues.some(issue => !issue.severity || issue.severity === "error")) throw new AgentError("validation_failed", "Declared schema constraints failed.", issues);
      }
      if (type.fields) checkLegacyTypes(frontmatter, type.fields);
    }
  }

  async commitFields(current: { ref: string; body: string; frontmatter: RecordValue; revision?: string }, fields: RecordValue, body = current.body) {
    const candidate = { ...current.frontmatter };
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete candidate[field];
      else candidate[field] = value;
    }
    const names = this.collection.getTypesForFile(current.ref, current.frontmatter);
    if (!isDeepStrictEqual(this.collection.getTypesForFile(current.ref, candidate), names)) throw new AgentError("protected_field", "Cannot change task/type identification through generic editing.");
    if (Object.hasOwn(fields, this.mapping.roleToField.projects)) await validateProjects(this, current.ref, candidate[this.mapping.roleToField.projects] ?? [], current.frontmatter[this.mapping.roleToField.projects]);
    this.validateTypes(candidate, names);
    if (isDeepStrictEqual(candidate, current.frontmatter) && body === current.body) return { ...await this.read(current.ref), changed: false };
    coreResult(await this.collection.update({ path: current.ref, fields, body, if_revision: current.revision }));
    return { ...await this.read(current.ref), changed: true };
  }

  async patch(ref: string, input: unknown) {
    const request = record(input);
    if (!Array.isArray(request.operations) || !request.operations.length) invalid("Supply a non-empty operations array.");
    const current = await this.read(ref);
    const candidate = { ...current.frontmatter };
    const fields: RecordValue = {};
    let statusTouched = false;
    let desiredStatus: unknown;
    const protectedFields = new Set([
      ...this.typeKeys, "blocking", "isBlocking", "isBlocked", "hasSubtasks", "depends_on",
      ...["blockedBy", "status", "completedDate", "dateCreated", "dateModified", "completeInstances", "skippedInstances"].map(role => this.mapping.roleToField[role as keyof typeof this.mapping.roleToField]),
    ]);
    for (const type of this.types.values()) {
      for (const [name, field] of Object.entries(type.fields ?? {})) if (field.computed) protectedFields.add(name);
      for (const name of Object.keys(type.collection?.projections ?? {})) protectedFields.add(name);
    }
    for (const value of request.operations) {
      const operation = record(value);
      const field = operation.field;
      if (typeof field !== "string" || !field || ["__proto__", "constructor", "prototype"].includes(field)) invalid("Invalid field name.");
      if (field === this.mapping.roleToField.status && operation.op === "set") {
        statusTouched = true;
        desiredStatus = operation.value;
        continue;
      }
      if (protectedFields.has(field)) throw new AgentError("protected_field", `Field ${field} requires its semantic operation; derived fields are read-only.`);
      const op = operation.op;
      if (op === "unset") {
        delete candidate[field];
        fields[field] = undefined;
      } else if (op === "set") {
        if (!("value" in operation)) invalid("set requires an explicit JSON value.");
        candidate[field] = operation.value;
        fields[field] = operation.value;
      } else if (op === "add" || op === "remove") {
        if (!("value" in operation)) invalid(`${op} requires an explicit JSON value.`);
        if (candidate[field] !== undefined && !Array.isArray(candidate[field])) invalid(`${field} is not a list.`);
        const list = [...(candidate[field] as unknown[] ?? [])];
        const next = op === "add"
          ? list.some(item => isDeepStrictEqual(item, operation.value)) ? list : [...list, operation.value]
          : list.filter(item => !isDeepStrictEqual(item, operation.value));
        candidate[field] = next;
        fields[field] = next;
      } else invalid("Operation must be set, unset, add, or remove.");
    }
    if (request.completedDate !== undefined && !statusTouched) invalid("completedDate must accompany a semantic status transition.");
    const lifecycle = statusTouched ? await statusFields(this, current, desiredStatus, request) : { fields: {}, body: current.body };
    return this.commitFields(current, { ...fields, ...lifecycle.fields }, lifecycle.body);
  }
}

function checkLegacyTypes(value: RecordValue, fields: NonNullable<TypeDefinition["fields"]>): void {
  for (const [name, field] of Object.entries(fields)) {
    const item = value[name];
    if (item === undefined || item === null) {
      if (field.required) throw new AgentError("validation_failed", `Required field: ${name}`);
      continue;
    }
    const type = field.type;
    const valid = type === "any" || type === "link" && typeof item === "string"
      || ["string", "enum", "date", "datetime", "time"].includes(type) && typeof item === "string"
      || type === "integer" && Number.isInteger(item)
      || type === "number" && typeof item === "number"
      || type === "boolean" && typeof item === "boolean"
      || type === "list" && Array.isArray(item)
      || type === "object" && typeof item === "object" && !Array.isArray(item);
    if (!valid) throw new AgentError("validation_failed", `Invalid JSON type for ${name}: expected ${type}.`);
    if (type === "object" && field.fields) checkLegacyTypes(item as RecordValue, field.fields);
    if (type === "list" && field.items) for (const entry of item as unknown[]) checkLegacyTypes({ item: entry }, { item: field.items });
  }
}

export async function readAgentInput(source?: string): Promise<unknown> {
  if (!source) return undefined;
  try {
    let content: string;
    if (source === "-") {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
      content = Buffer.concat(chunks).toString("utf8");
    } else content = await readFile(source, "utf8");
    return JSON.parse(content);
  } catch (error) { throw new AgentError("invalid_input", `Cannot read JSON input: ${(error as Error).message}`); }
}
