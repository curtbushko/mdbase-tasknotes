import { posix } from "node:path";
import { LinkResolver, parseLink } from "@callumalpass/mdbase";
import { AgentError, type AgentContext } from "./agent.js";
import { normalizeFrontmatter } from "./field-mapping.js";

export interface GraphRecord {
  path: string;
  frontmatter: Record<string, unknown>;
  types: string[];
  body: string;
}
export type Resolution = { ref: string; error?: never } | { ref?: never; error: "missing_target" | "ambiguous_target"; target: string };
export class TaskGraph {
  private resolver: LinkResolver;
  private index: ReturnType<LinkResolver["buildIndex"]>;
  constructor(public context: AgentContext, public records: Map<string, GraphRecord>) {
    this.resolver = new LinkResolver({ idField: context.settings.id_field, recordExtensions: context.settings.record_extensions });
    this.index = this.resolver.buildIndex([...records.keys()], records);
  }
  static async load(context: AgentContext): Promise<TaskGraph> {
    const result = await context.collection.query({ limit: Number.MAX_SAFE_INTEGER, include_body: true });
    if (result.error) throw new AgentError(result.error.code, result.error.message);
    return new TaskGraph(context, new Map((result.results ?? []).map(item => [item.path, { ...item, body: item.body ?? "" }])));
  }
  task(ref: string): boolean { return this.records.get(ref)?.types.includes("task") ?? false; }
  fields(ref: string) { return normalizeFrontmatter(this.records.get(ref)?.frontmatter ?? {}, this.context.mapping); }
  archived(ref: string): boolean {
    const binding = this.context.types.get("task")?.implements?.find(item => item.contract === "tasknotes.task")?.binding;
    const archive = binding?.archive as Record<string, unknown> | undefined;
    const tag = typeof archive?.archived_tag === "string" ? archive.archived_tag : "archived";
    const tags = this.fields(ref).tags;
    return Array.isArray(tags) && tags.some(item => item === tag || item === `#${tag}`);
  }
  completed(ref: string): boolean { return this.context.mapping.completedStatuses.includes(String(this.fields(ref).status)); }

  resolve(raw: string, source: string, conservative = true, taskOnly = false): Resolution {
    let parsed: ReturnType<typeof parseLink>;
    try { parsed = parseLink(raw); } catch { return { error: "missing_target", target: raw }; }
    const target = parsed?.target ?? raw;
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(target) || target.includes("\\")) return { error: "missing_target", target };
    const candidate = parsed?.format === "markdown" || parsed?.format === "path" || parsed?.is_relative
      ? posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join(posix.dirname(source), target)) : target;
    if (candidate === ".." || candidate.startsWith("../")) return { error: "missing_target", target };
    const simple = (!parsed || parsed.format === "wikilink") && !target.includes("/");
    if (conservative && simple) {
      const included = (refs: string[]) => refs.filter(ref => !taskOnly || this.task(ref));
      const ids = included(this.index.idToFiles.get(target) ?? []);
      const names = included(this.index.basenameToFiles.get(target) ?? []);
      if (ids.length > 1 || !ids.length && names.length > 1) return { error: "ambiguous_target", target };
    }
    const resolved = this.resolver.resolve(raw, source, [...this.records.keys()], { fileCache: this.records, resolutionIndex: this.index, ...(taskOnly ? { targetType: "task" } : {}) });
    if (resolved.ambiguous) return { error: "ambiguous_target", target };
    return resolved.resolved && !resolved.wrongType ? { ref: resolved.resolved } : { error: "missing_target", target };
  }

  parents(ref: string): { links: Array<{ raw: string; resolution: Resolution }>; refs: string[] } {
    const projects = this.fields(ref).projects;
    const links = (Array.isArray(projects) ? projects : []).map(raw => ({ raw: String(raw), resolution: this.resolve(String(raw), ref) }));
    return { links, refs: [...new Set(links.flatMap(link => link.resolution.ref ? [link.resolution.ref] : []))] };
  }
  hierarchyEdges(): Map<string, string[]> {
    return new Map([...this.records.keys()].filter(ref => this.task(ref)).map(ref => [ref, this.parents(ref).refs]));
  }
}

export function graphCycles(edges: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack: string[] = [];
  const active = new Set<string>();
  function visit(ref: string) {
    if (active.has(ref)) { cycles.push([...stack.slice(stack.indexOf(ref)), ref]); return; }
    if (visited.has(ref)) return;
    visited.add(ref); active.add(ref); stack.push(ref);
    for (const target of edges.get(ref) ?? []) visit(target);
    stack.pop(); active.delete(ref);
  }
  for (const ref of edges.keys()) visit(ref);
  return cycles;
}

export function reaches(edges: Map<string, string[]>, start: string, target: string): string[] | null {
  const visited = new Set<string>();
  function visit(ref: string, path: string[]): string[] | null {
    if (ref === target) return [...path, ref];
    if (visited.has(ref)) return null;
    visited.add(ref);
    for (const next of edges.get(ref) ?? []) { const found = visit(next, [...path, ref]); if (found) return found; }
    return null;
  }
  return visit(start, []);
}
