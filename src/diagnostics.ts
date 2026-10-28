import { Collection, DataContractRegistry, getType, loadConfig } from "@callumalpass/mdbase";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectCollectionPath } from "./config.js";
import { buildFieldMapping, normalizeTaskTypeDefinition } from "./field-mapping.js";
import { supportedCreationTemplateValues } from "./create-compat.js";
import { dependencyPolicy } from "./task-dependencies.js";

export interface DiagnosticIssue {
  code: string;
  message: string;
  values?: string[];
}

// Public loaders do not open the collection cache, so diagnostics remain read-only.
export async function diagnoseCollection(flagPath?: string) {
  const selection = selectCollectionPath(flagPath);
  const { root } = selection;
  const loaded = await loadConfig(root);
  if (!loaded.valid || !loaded.config) {
    throw new Error(loaded.error?.message ?? "Missing or invalid mdbase.yaml; run init only for a new collection.");
  }
  const config = loaded.config;
  const loadedType = await getType(root, config, "task");
  if (!loadedType.valid || !loadedType.type) {
    throw new Error(loadedType.error?.message ?? "Missing or invalid task type/schema.");
  }
  const taskType = loadedType.type;
  const contracts = await DataContractRegistry.load(root, config, new Map([["task", taskType]]));
  if (!contracts.valid) throw new Error(contracts.error?.message ?? "Invalid TaskNotes contract installation.");
  const normalized = normalizeTaskTypeDefinition(taskType);
  const mapping = buildFieldMapping(normalized.fields, normalized.displayNameKey);
  const issues: DiagnosticIssue[] = [];
  for (const warning of [...(loaded.warnings ?? []), ...(loadedType.warnings ?? [])]) {
    issues.push({ code: "configuration_warning", message: warning });
  }
  const operational = [config.settings.cache_folder, ".mtn", ".mtn-recovery", ".mtn-tmp"];
  const uncovered = operational.filter(folder => !config.settings.exclude.some(pattern =>
    pattern === folder || pattern === `${folder}/` || pattern === `${folder}/**`));
  if (uncovered.length) {
    issues.push({ code: "unsafe_exclusions", values: uncovered,
      message: `Operational locations may be discovered as tasks: ${uncovered.join(", ")}. Explicitly add them to settings.exclude in mdbase.yaml; no configuration was changed.` });
  }
  const path = taskType.collection?.path;
  const template = taskType.path_pattern ?? path?.pattern ?? path?.template;
  const supported = new Set(supportedCreationTemplateValues(mapping));
  const unsupported = [...new Set([...String(template ?? "").matchAll(/\{\{(\w+)\}\}|\{(\w+)\}/g)]
    .map(match => match[1] ?? match[2]).filter(value => !supported.has(value) && !(value in normalized.fields)))];
  if (unsupported.length) {
    issues.push({ code: "unsupported_template_value", values: unsupported,
      message: `Cannot allocate creation paths with runtime values: ${unsupported.join(", ")}. Configure a fixed collection.path.folder and a supported template such as {{title}} in the authoritative TaskNotes settings/export.` });
  }
  if (path?.runtime && path.runtime !== "tasknotes") {
    issues.push({ code: "unsupported_path_runtime", message: `Unsupported path runtime: ${path.runtime}. Use a supported path pattern or a fixed TaskNotes inbox.` });
  }
  return {
    ...selection,
    locations: {
      config: join(root, "mdbase.yaml"),
      taskType: taskType.source_path ? resolve(root, taskType.source_path) : join(root, config.settings.types_folder, "task.md"),
      contracts: join(root, config.settings.contracts_folder),
      schema: taskType.schema?.ref ?? (taskType.schema?.value ? "inline" : "legacy fields"),
    },
    versions: { core: packageVersion("@callumalpass/mdbase"), model: packageVersion("@tasknotes/model"), spec: config.spec_version, profile: config.spec_profile },
    contracts: (taskType.implements ?? []).map(({ contract, version }) => ({ contract, version })),
    mapping,
    status: { field: mapping.roleToField.status, completedValues: mapping.completedStatuses, definition: normalized.fields[mapping.roleToField.status] },
    path: { legacyPattern: taskType.path_pattern ?? null, ...path },
    exclusions: config.settings.exclude,
    validation: { policy: config.settings.default_validation, strict: config.settings.default_strict, agentSafety: "Agent mutations must enforce declared constraints independently of warning policy." },
    capabilities: {
      diagnostics: true,
      coreRename: typeof Collection.prototype.rename === "function",
      coreContractView: typeof Collection.prototype.getContractView === "function",
      coreValidation: typeof Collection.prototype.validate === "function",
      literalCreation: true,
      agentMutations: true,
      agentExactPaths: true,
      atomicSingleTaskReplacement: true,
      evidence: true,
      lifecycleTransitions: true,
      recurringInstanceTransitions: true,
      hierarchy: true,
      dependencies: true,
      relocation: false,
      exclusiveClaims: false,
      strictCrossApplicationCas: false,
    },
    agentEligibilityPolicy: taskType.domain?.["x-mtn-agent-policy"] ?? null,
    dependencyPolicy: await dependencyPolicy(root),
    issues,
  };
}

function packageVersion(name: string): string {
  let directory = dirname(fileURLToPath(import.meta.resolve(name)));
  while (true) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.name === name && typeof pkg.version === "string") return pkg.version;
    }
    const parent = dirname(directory);
    if (parent === directory) return "unknown";
    directory = parent;
  }
}
