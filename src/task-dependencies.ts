import { readFile } from "node:fs/promises";
import { resolve, posix } from "node:path";
import YAML from "yaml";
import { parseLink } from "@callumalpass/mdbase";
import { AgentError, invalid, record, type AgentContext } from "./agent.js";
import { TaskGraph, graphCycles, reaches } from "./task-graph.js";
import { hierarchySnapshot } from "./task-hierarchy.js";
import { agentPolicy, configuredStatuses } from "./task-lifecycle.js";
import { inspectContent } from "./task-content.js";

const RELTYPES = new Set(["FINISHTOSTART", "STARTTOSTART", "FINISHTOFINISH", "STARTTOFINISH"]);
const DURATION = /^-?P(?=\d|T\d)(?:\d+(?:\.\d+)?Y)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?W)?(?:\d+(?:\.\d+)?D)?(?:T(?=\d)(?:\d+(?:\.\d+)?H)?(?:\d+(?:\.\d+)?M)?(?:\d+(?:\.\d+)?S)?)?$/;
type Fields = Record<string, unknown>;
interface Reason { code: string; message: string; ref?: string; observedStatus?: unknown; }

export async function dependencyPolicy(root: string) {
  let values: Fields = {};
  let source = "tasknotes-spec defaults";
  try {
    const document = YAML.parse(await readFile(resolve(root, "tasknotes.yaml"), "utf8"));
    if (!document || typeof document !== "object" || Array.isArray(document)) throw new Error("tasknotes.yaml must contain a mapping.");
    if (document.dependencies !== undefined) {
      if (!document.dependencies || typeof document.dependencies !== "object" || Array.isArray(document.dependencies)) throw new Error("dependencies must be a mapping.");
      values = document.dependencies;
      source = "tasknotes.yaml dependencies";
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new AgentError("configuration_error", (error as Error).message);
  }
  for (const field of ["treat_missing_target_as_blocked", "require_resolved_uid_on_write", "enforce_unique_uid"]) {
    if (values[field] !== undefined && typeof values[field] !== "boolean") throw new AgentError("configuration_error", `dependencies.${field} must be boolean.`);
  }
  if (values.default_reltype !== undefined && !RELTYPES.has(String(values.default_reltype))) throw new AgentError("configuration_error", "Unsupported default dependency relationship.");
  if (values.unresolved_target_severity !== undefined && !["warning", "error"].includes(String(values.unresolved_target_severity))) throw new AgentError("configuration_error", "Unsupported unresolved dependency severity.");
  return { source, treat_missing_target_as_blocked: values.treat_missing_target_as_blocked ?? true,
    require_resolved_uid_on_write: values.require_resolved_uid_on_write ?? false,
    enforce_unique_uid: values.enforce_unique_uid ?? true,
    unresolved_target_severity: values.unresolved_target_severity ?? "warning",
    default_reltype: values.default_reltype ?? "FINISHTOSTART" };
}
function entries(graph: TaskGraph, ref: string): unknown[] {
  const value = graph.fields(ref).blockedBy;
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}
function uid(entry: unknown): string | null {
  if (typeof entry === "string") return entry;
  return entry && typeof entry === "object" && typeof (entry as Fields).uid === "string" ? (entry as Fields).uid as string : null;
}
function dependencyEdges(graph: TaskGraph): Map<string, string[]> {
  return new Map([...graph.records.keys()].filter(ref => graph.task(ref)).map(ref => [ref, entries(graph, ref).flatMap(entry => {
    const raw = uid(entry);
    const resolution = raw === null ? null : graph.resolve(raw, ref, true, true);
    return resolution?.ref ? [resolution.ref] : [];
  })]));
}
function canonicalReference(raw: string, source: string): string {
  const link = parseLink(raw);
  let target = link?.target ?? raw;
  if (link?.format === "markdown" || link?.format === "path" || link?.is_relative) target = target.startsWith("/") ? target : posix.join(posix.dirname(source), target);
  target = posix.normalize(target.replace(/^\/+/, ""));
  return target.endsWith(".md") ? target : `${target}.md`;
}

export async function validateDependencies(context: AgentContext, ref: string, value: unknown, previous: unknown): Promise<void> {
  if (!Array.isArray(value)) invalid("blockedBy must be a native JSON array of dependency objects.");
  const graph = await TaskGraph.load(context);
  const edges = dependencyEdges(graph);
  const old = Array.isArray(previous) ? previous : [];
  const seen = new Set<string>();
  for (const entry of value as unknown[]) {
    const item = record(entry);
    if (typeof item.uid !== "string" || !item.uid.trim()) invalid("Dependency uid must be a non-empty native link string.");
    if (!RELTYPES.has(String(item.reltype))) invalid("Unsupported dependency reltype; use a native TaskNotes relationship value.");
    if (item.gap !== undefined && (typeof item.gap !== "string" || !DURATION.test(item.gap))) invalid("Dependency gap must be an ISO 8601 duration.");
    if (canonicalReference(item.uid as string, ref) === ref) throw new AgentError("self_dependency", "A task cannot depend on itself.");
    const result = graph.resolve(item.uid as string, ref, true, true);
    const identity = result.ref ?? `raw:${canonicalReference(item.uid as string, ref)}`;
    if (seen.has(identity)) throw new AgentError("duplicate_dependency_uid", "Multiple entries resolve to the same prerequisite.", identity);
    seen.add(identity);
    if (result.error) {
      if (old.some(entry => uid(entry) === item.uid)) continue;
      throw new AgentError(result.error, `Unresolved prerequisite: ${item.uid}`);
    }
    if (result.ref === ref) throw new AgentError("self_dependency", "A task cannot depend on itself.");
    if (old.some(entry => { const raw = uid(entry); return raw && graph.resolve(raw, ref, true, true).ref === result.ref; })) continue;
    const cycle = reaches(edges, result.ref, ref);
    if (cycle) throw new AgentError("dependency_cycle", "Prerequisite would introduce a dependency cycle.", [ref, ...cycle]);
  }
}

export async function editDependency(context: AgentContext, ref: string, operation: string, input: unknown) {
  const request = record(input);
  const current = await context.read(ref);
  const field = context.mapping.roleToField.blockedBy;
  if (operation === "depends-replace") {
    if (!Array.isArray(request.entries)) invalid("Whole-list replacement requires an explicit entries array.");
    return context.commitFields(current, { [field]: request.entries });
  }
  if (typeof request.target !== "string") invalid("Supply the exact prerequisite task path.");
  try { await context.exact(request.target as string); }
  catch (error) { if (!(operation === "depends-remove" && error instanceof AgentError && error.code === "missing_target")) throw error; }
  const existing = current.frontmatter[field] ?? [];
  if (!Array.isArray(existing)) invalid("Observed blockedBy is not a list; repair it explicitly.");
  const graph = await TaskGraph.load(context);
  const matches = (entry: unknown) => {
    const raw = uid(entry);
    return raw !== null && (graph.resolve(raw, ref, true, true).ref === request.target || canonicalReference(raw, ref) === request.target);
  };
  if (operation === "depends-remove") {
    if (!(existing as unknown[]).some(matches)) return { ...current, changed: false };
    return context.commitFields(current, { [field]: (existing as unknown[]).filter(entry => !matches(entry)) });
  }
  if ((existing as unknown[]).some(matches)) return { ...current, changed: false };
  const policy = await dependencyPolicy(context.root);
  const entry: Fields = { uid: `[[${request.target}]]`, reltype: request.reltype ?? policy.default_reltype };
  if (request.gap !== undefined) entry.gap = request.gap;
  return context.commitFields(current, { [field]: [...existing as unknown[], entry] });
}

export class DependencySnapshot {
  private edges: Map<string, string[]>;
  public cycles: string[][];
  public snapshot = new Date().toISOString();
  constructor(public graph: TaskGraph, public policy: Awaited<ReturnType<typeof dependencyPolicy>>) {
    this.edges = dependencyEdges(graph);
    this.cycles = graphCycles(this.edges);
  }
  static async load(context: AgentContext) { return new DependencySnapshot(await TaskGraph.load(context), await dependencyPolicy(context.root)); }
  evaluate(ref: string, activity?: string) {
    const graph = this.graph;
    const context = graph.context;
    const reasons: Reason[] = [];
    let nativeBlocked = false;
    let dependencyReady = true;
    const seen = new Set<string>();
    const blockedBy = entries(graph, ref).map(entry => {
      const raw = uid(entry);
      const safe = raw === null ? { error: "invalid_dependency_entry", ref: undefined } : graph.resolve(raw, ref, true, true);
      const native = raw === null ? null : graph.resolve(raw, ref, false, true);
      if (entry && typeof entry === "object") {
        const item = entry as Fields;
        if (item.reltype !== undefined && !RELTYPES.has(String(item.reltype)) || item.gap !== undefined && (typeof item.gap !== "string" || !DURATION.test(item.gap))) {
          dependencyReady = false;
          reasons.push({ code: "invalid_dependency_entry", message: "Prerequisite relationship metadata is invalid." });
        }
      }
      if (safe.ref && seen.has(safe.ref)) { dependencyReady = false; reasons.push({ code: "duplicate_dependency_uid", message: "Duplicate prerequisite identities require explicit repair.", ref: safe.ref }); }
      if (safe.ref) seen.add(safe.ref);
      if (!native?.ref ? this.policy.treat_missing_target_as_blocked : !graph.completed(native.ref)) nativeBlocked = true;
      if (!safe.ref) { dependencyReady = false; reasons.push({ code: safe.error ?? "missing_target", message: `Unresolved prerequisite: ${raw ?? "invalid entry"}`, ref: raw ?? undefined }); }
      else if (!graph.completed(safe.ref)) { dependencyReady = false; reasons.push({ code: "incomplete_prerequisite", message: "Prerequisite base task is not complete.", ref: safe.ref, observedStatus: graph.fields(safe.ref).status }); }
      return { entry, resolution: safe, observedStatus: safe.ref ? graph.fields(safe.ref).status : null };
    });
    const relatedCycles = this.cycles.filter(cycle => cycle.some(member => reaches(this.edges, ref, member)));
    if (relatedCycles.length) { dependencyReady = false; reasons.push({ code: "dependency_cycle", message: "Task is in or depends on a dependency cycle." }); }
    const policy = agentPolicy(context);
    const status = graph.fields(ref).status;
    const activities = policy?.activities;
    const configured = configuredStatuses(context).values;
    if (activities !== undefined && (!activities || typeof activities !== "object" || Array.isArray(activities))) throw new AgentError("configuration_error", "Agent activities policy must be an object.");
    for (const list of Object.values(activities ?? {})) {
      if (!Array.isArray(list) || list.some(value => typeof value !== "string" || !configured.includes(value))) throw new AgentError("configuration_error", "Agent activity policy must list configured status values.");
    }
    if (policy?.blockedStatuses !== undefined && (!Array.isArray(policy.blockedStatuses) || policy.blockedStatuses.some(value => typeof value !== "string" || !configured.includes(value)))) throw new AgentError("configuration_error", "blockedStatuses must list configured statuses.");
    const runnable = activity && activities ? (activities as Fields)[activity] : undefined;
    let agentEligible: boolean | null = activity && Array.isArray(runnable) ? dependencyReady : null;
    if (activity && !Array.isArray(runnable)) reasons.push({ code: "eligibility_policy_unconfigured", message: `No inspectable runnable-status policy for activity ${activity}.` });
    if (Array.isArray(runnable) && !runnable.includes(status)) { agentEligible = false; reasons.push({ code: "non_runnable_status", message: `Workflow status is not runnable for ${activity}.`, observedStatus: status }); }
    if (graph.archived(ref)) { agentEligible = false; reasons.push({ code: "archived_task", message: "Task is archived." }); }
    if (graph.completed(ref)) { agentEligible = false; reasons.push({ code: "completed_task", message: "Task base status is completed." }); }
    const content = inspectContent(graph.records.get(ref)?.body ?? "");
    const blocker = [...content.evidence].reverse().find(entry => entry.category === "external-blocker");
    const externallyBlocked = Array.isArray(policy?.blockedStatuses) && policy.blockedStatuses.includes(status);
    if (externallyBlocked) {
      agentEligible = false;
      reasons.push({ code: "external_blocker", message: blocker?.content ?? "Blocked workflow state has no convention-tagged explanation." });
      if (!blocker) reasons.push({ code: "missing_blocker_explanation", message: "Human edits remain readable; record a blocker note for resumption." });
    }
    const blocking = [...this.edges.entries()].filter(([, prerequisites]) => prerequisites.includes(ref)).map(([target]) => target).sort();
    return { ref, status, blockedBy, blocking, nativeBlocked, dependencyReady, agentEligible, activity: activity ?? null, policy,
      dependencyPolicy: this.policy, reasons, blockerExplanation: blocker?.content ?? null, cycles: relatedCycles, snapshot: this.snapshot };
  }
}

export async function dependencyQuery(context: AgentContext, operation: string, ref: string | undefined, input: unknown) {
  const request = input === undefined ? {} : record(input);
  if (request.activity !== undefined && typeof request.activity !== "string") invalid("activity must be a string.");
  if (request.includeArchived !== undefined && typeof request.includeArchived !== "boolean") invalid("includeArchived must be boolean.");
  const snapshot = await DependencySnapshot.load(context);
  if (operation === "dependencies") {
    if (!ref) invalid("Supply an exact task reference.");
    await context.exact(ref!);
    return snapshot.evaluate(ref!, request.activity as string | undefined);
  }
  const scope = ref ?? request.scope;
  let refs = [...snapshot.graph.records.keys()].filter(target => snapshot.graph.task(target));
  if (scope !== undefined) {
    if (typeof scope !== "string") invalid("scope must be an exact included record path.");
    await context.exact(scope as string, false);
    const hierarchy = hierarchySnapshot(snapshot.graph, scope as string, request.includeArchived === true);
    const included = new Set([scope as string, ...hierarchy.descendants]);
    refs = refs.filter(target => included.has(target));
  }
  const evaluated = refs.sort().filter(target => !snapshot.graph.completed(target) && (request.includeArchived === true || !snapshot.graph.archived(target))).map(target => snapshot.evaluate(target, request.activity as string | undefined));
  const ready = (task: ReturnType<DependencySnapshot["evaluate"]>) => request.activity ? task.agentEligible === true : task.dependencyReady;
  return { results: evaluated.filter(task => operation === "ready" ? ready(task) : !ready(task)), evaluated, snapshot: snapshot.snapshot,
    scope: scope ?? null, activity: request.activity ?? null, queryMode: request.activity ? "activity-eligibility" : "dependency-readiness-only", claim: false };
}
