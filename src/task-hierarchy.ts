import { AgentError, invalid, record, type AgentContext } from "./agent.js";
import { TaskGraph, graphCycles, reaches } from "./task-graph.js";

export async function validateProjects(context: AgentContext, ref: string, value: unknown, previous: unknown): Promise<void> {
  if (!Array.isArray(value) || !value.every(item => typeof item === "string")) invalid("projects must be a JSON list of native links.");
  const graph = await TaskGraph.load(context);
  const edges = graph.hierarchyEdges();
  const existing = Array.isArray(previous) ? previous : [];
  for (const raw of value as string[]) {
    const resolution = graph.resolve(raw, ref);
    if (resolution.error) {
      if (existing.includes(raw)) continue; // Retain observed broken human links while allowing repairs.
      throw new AgentError(resolution.error, `Cannot resolve project membership: ${raw}`);
    }
    if (!graph.task(resolution.ref) || existing.some(raw => typeof raw === "string" && graph.resolve(raw, ref).ref === resolution.ref)) continue;
    const path = reaches(edges, resolution.ref, ref);
    if (path) throw new AgentError("hierarchy_cycle", "Task-parent membership would introduce a hierarchy cycle.", [ref, ...path]);
  }
}

export async function editProject(context: AgentContext, ref: string, operation: string, input: unknown) {
  const request = record(input);
  if (typeof request.target !== "string") invalid("Supply the exact target record path.");
  await context.exact(request.target as string, false);
  const current = await context.read(ref);
  const field = context.mapping.roleToField.projects;
  const links = current.frontmatter[field] === undefined ? [] : current.frontmatter[field];
  if (!Array.isArray(links) || !links.every(item => typeof item === "string")) invalid("Observed projects is not a list of links; repair it explicitly.");
  const graph = await TaskGraph.load(context);
  const matching = (raw: string) => graph.resolve(raw, ref).ref === request.target;
  let next: string[];
  if (operation === "project-add") next = (links as string[]).some(matching) ? links as string[] : [...links as string[], `[[${request.target}]]`];
  else if (operation === "project-remove") {
    if (!(links as string[]).some(matching)) return { ...current, changed: false };
    next = (links as string[]).filter(raw => !matching(raw));
  }
  else {
    if (typeof request.replacement !== "string") invalid("Supply the exact replacement path and the existing target link to replace.");
    await context.exact(request.replacement as string, false);
    if (!(links as string[]).some(matching)) throw new AgentError("missing_target", "The identified membership to replace is not present.");
    next = (links as string[]).map(raw => matching(raw) ? `[[${request.replacement}]]` : raw);
  }
  return context.commitFields(current, { [field]: next });
}

export async function hierarchy(context: AgentContext, ref: string, input: unknown = {}) {
  const request = record(input);
  if (request.includeArchived !== undefined && typeof request.includeArchived !== "boolean") invalid("includeArchived must be boolean.");
  await context.exact(ref, false);
  const graph = await TaskGraph.load(context);
  return hierarchySnapshot(graph, ref, request.includeArchived === true);
}

export function hierarchySnapshot(graph: TaskGraph, ref: string, includeArchived = false) {
  const edges = graph.hierarchyEdges();
  const childrenOf = (parent: string) => [...edges.entries()].filter(([child, parents]) => parents.includes(parent) && (includeArchived || !graph.archived(child))).map(([child]) => child).sort();
  const visited = new Set<string>();
  const scope: string[] = [];
  function walk(target: string) {
    if (visited.has(target) || !includeArchived && graph.archived(target)) return;
    visited.add(target); scope.push(target);
    for (const child of childrenOf(target)) walk(child);
  }
  walk(ref);
  const leaves = scope.filter(target => graph.task(target) && childrenOf(target).length === 0);
  const completed = leaves.filter(target => graph.completed(target)).length;
  const total = leaves.length;
  return {
    ref,
    parents: graph.parents(ref).links,
    children: includeArchived || !graph.archived(ref) ? childrenOf(ref) : [],
    descendants: scope.filter(target => target !== ref).sort(),
    parentStatus: graph.task(ref) ? graph.fields(ref).status ?? null : null,
    progress: { completed, total, percentage: total ? completed / total * 100 : null },
    leafTasks: leaves.sort(),
    archivedPolicy: includeArchived ? "include" : "exclude-records-and-branches",
    cycles: graphCycles(edges).filter(cycle => cycle.some(target => visited.has(target))),
    snapshot: new Date().toISOString(),
  };
}
