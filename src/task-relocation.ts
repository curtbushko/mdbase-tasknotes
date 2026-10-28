import { atomicWriteRecord, moveRecordNoClobber, planRecordRename, serializeFile } from "@callumalpass/mdbase";
import { access, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import picomatch from "picomatch";
import { AgentError, invalid, record, type AgentContext } from "./agent.js";
import { safeDestination, intentHash } from "./agent-create.js";
import { TaskGraph } from "./task-graph.js";

type RenamePlan = ReturnType<typeof planRecordRename>;
type Snapshot = { path: string; hash: string };
interface MovePlan {
  version: number; from: string; to: string; snapshots: Snapshot[];
  affectedRecords: string[]; referenceChanges: Array<{ path: string; destination: string; location: string; before: string; after: string }>;
  warnings: RenamePlan["warnings"]; capabilities: string[]; planHash: string; referenceRepairComplete: boolean;
}
interface JournalRecord { path: string; destination: string; beforeHash: string; afterHash: string; backup: string; applied: boolean; }
interface Journal { version: number; planHash: string; from: string; to: string; status: string; records: JournalRecord[]; error?: string; }
function hash(content: string | Buffer) { return createHash("sha256").update(content).digest("hex"); }

async function prepareMove(context: AgentContext, from: string, to: string) {
  await context.exact(from);
  if (from === to) invalid("Move source and destination must differ.");
  await safeDestination(context, to);
  try { await access(resolve(context.root, to)); throw new AgentError("path_conflict", `Occupied destination: ${to}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const graph = await TaskGraph.load(context);
  const originals = new Map<string, string>();
  const snapshots: Snapshot[] = [];
  const records = [];
  for (const path of [...graph.records.keys()].sort()) {
    const absolute = resolve(context.root, path);
    const before = await readFile(absolute);
    const read = await context.collection.read(path);
    if (read.error) throw new AgentError(read.error.code, read.error.message);
    const after = await readFile(absolute);
    if (!before.equals(after)) throw new AgentError("concurrent_modification", `Record changed while planning: ${path}`);
    snapshots.push({ path, hash: hash(after) }); originals.set(path, after.toString("utf8"));
    records.push({ path, frontmatter: read.rawFrontmatter ?? read.frontmatter ?? {}, body: read.body ?? "", types: read.types ?? [] });
  }
  const planned = planRecordRename({ records, types: context.types, settings: context.settings, from, to });
  const source = planned.changes.find(change => change.path === from);
  if (!source || !context.collection.getTypesForFile(to, source.frontmatter).includes("task")) throw new AgentError("unsupported_capability", "Destination would lose the selected task's identification contract.");
  for (const change of planned.changes) {
    await safeDestination(context, change.destination);
    context.validateTypes(change.frontmatter, change.types);
  }
  const proposal = {
    version: 1, from, to, snapshots,
    affectedRecords: planned.changes.map(change => change.path),
    referenceChanges: planned.changes.flatMap(change => change.references.map(reference => ({ path: change.path, destination: change.destination, ...reference }))),
    warnings: planned.warnings,
    referenceRepairComplete: planned.warnings.length === 0,
    capabilities: ["single-task", "native-mapped-projects", "nested-blockedBy.uid", "declared-link-fields", "inline-markdown-and-wikilinks", "outgoing-relative-links", "excluded-recovery-journal", "not-transactionally-atomic"],
  };
  const plan: MovePlan = { ...proposal, planHash: intentHash(proposal) };
  const contents = new Map(planned.changes.map(change => [change.path, change.references.length
    ? serializeFile(change.frontmatter, change.body, "explicit", true) : originals.get(change.path)!]));
  return { plan, changes: planned.changes, originals, contents };
}

export async function movePlan(context: AgentContext, ref: string, input: unknown) {
  const request = record(input);
  if (typeof request.to !== "string") invalid("Supply an exact destination path in to.");
  return (await prepareMove(context, ref, request.to as string)).plan;
}

async function recoveryRoot(context: AgentContext): Promise<string> {
  const path = resolve(context.root, ".mtn-recovery");
  const excluded = context.settings.exclude.some(pattern => [".mtn-recovery/", ".mtn-recovery/**"].includes(pattern) || picomatch(pattern, { dot: true, matchBase: !pattern.includes("/") })(".mtn-recovery"));
  if (!excluded) throw new AgentError("configuration_error", "Explicitly exclude .mtn-recovery and its descendants before applying moves; run diagnose for guidance. Configuration was not changed.");
  try { if ((await lstat(path)).isSymbolicLink()) throw new AgentError("invalid_reference", "Recovery directory must not be a symlink."); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return path;
}
async function journals(root: string): Promise<Array<{ path: string; value: Journal }>> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name, "journal.json");
    try {
      const value = JSON.parse(await readFile(path, "utf8")) as Journal;
      const safeRef = (ref: unknown) => typeof ref === "string" && !ref.startsWith("/") && !ref.includes("\\") && ref.split("/").every(part => part && part !== "." && part !== "..");
      if (!safeRef(value.from) || !safeRef(value.to) || typeof value.planHash !== "string" || !Array.isArray(value.records)
        || value.records.some(item => !safeRef(item.path) || !safeRef(item.destination) || typeof item.beforeHash !== "string" || typeof item.afterHash !== "string")) throw new Error("Invalid recovery journal.");
      result.push({ path, value });
    }
    catch { throw new AgentError("recovery_required", "An unreadable recovery journal must be inspected before another move.", { journal: path }); }
  }
  return result;
}
async function observe(root: string, records: JournalRecord[]) {
  return Promise.all(records.map(async item => {
    const inspect = async (path: string) => {
      try { return hash(await readFile(resolve(root, path))); } catch { return null; }
    };
    return { path: item.path, destination: item.destination, sourceHash: await inspect(item.path), destinationHash: await inspect(item.destination), expectedBefore: item.beforeHash, expectedAfter: item.afterHash };
  }));
}

export async function applyMove(context: AgentContext, ref: string, input: unknown) {
  const request = record(input);
  const proposed = record(request.plan);
  if (proposed.from !== ref || typeof proposed.to !== "string" || typeof proposed.planHash !== "string") invalid("Supply the unmodified move-plan result for this exact source.");
  const root = await recoveryRoot(context);
  for (const previous of await journals(root)) {
    if (previous.value.status === "recovered") continue;
    if (previous.value.status !== "complete") throw new AgentError("recovery_required", "An interrupted move must be recovered explicitly before retrying.", { journal: previous.path, observed: await observe(context.root, previous.value.records) });
    if (previous.value.from !== ref || previous.value.to !== proposed.to) continue;
    if (previous.value.planHash === proposed.planHash) {
      const observed = await observe(context.root, previous.value.records);
      if (observed.some(item => item.destinationHash !== item.expectedAfter)) throw new AgentError("concurrent_modification", "Previously applied move outputs have changed; do not replay the stale plan.", { journal: previous.path });
      return { ref: proposed.to, changed: false, journal: previous.path, status: "complete" };
    }
  }
  const prepared = await prepareMove(context, ref, proposed.to as string);
  if (!isDeepStrictEqual(prepared.plan, proposed)) throw new AgentError("concurrent_modification", "Source, reference records, scope, or move plan changed since preview. Generate a new move-plan.");
  if (prepared.plan.warnings.length && request.acceptLimitations !== true) throw new AgentError("unsupported_capability", "Plan contains reference limitations; repair them or explicitly acceptLimitations:true before applying.", prepared.plan.warnings);
  const directory = join(root, randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const journalPath = join(directory, "journal.json");
  const journal: Journal = { version: 1, planHash: prepared.plan.planHash, from: ref, to: proposed.to as string, status: "prepared", records: [] };
  for (const [index, change] of prepared.changes.entries()) {
    const backup = `${index}.before.txt`;
    const original = prepared.originals.get(change.path)!;
    await atomicWriteRecord(join(directory, backup), original, true);
    journal.records.push({ path: change.path, destination: change.destination, beforeHash: hash(original), afterHash: hash(prepared.contents.get(change.path)!), backup, applied: false });
  }
  const saveJournal = (exclusive = false) => atomicWriteRecord(journalPath, JSON.stringify(journal, null, 2) + "\n", exclusive);
  await saveJournal(true);
  try {
    // The core's explicit no-clobber move primitive prevents an occupied target
    // from being overwritten; all remaining writes have inspectable before copies.
    const source = journal.records.find(item => item.path === ref)!;
    await moveRecordNoClobber(context.root, ref, proposed.to as string, source.beforeHash);
    journal.status = "source-moved";
    await saveJournal();
    for (const item of journal.records) {
      const actual = hash(await readFile(resolve(context.root, item.destination)));
      if (actual !== item.beforeHash) throw new AgentError("concurrent_modification", `Record changed during apply: ${item.destination}`);
      if (item.afterHash !== item.beforeHash) await atomicWriteRecord(resolve(context.root, item.destination), prepared.contents.get(item.path)!);
      item.applied = true;
      await saveJournal();
    }
    journal.status = "complete";
    await saveJournal();
    return { ref: proposed.to, changed: true, status: "complete", journal: journalPath, references: prepared.plan.referenceChanges, warnings: prepared.plan.warnings, referenceRepairComplete: prepared.plan.referenceRepairComplete, atomic: false };
  } catch (error) {
    journal.status = "partial"; journal.error = (error as Error).message;
    let journalSaved = true;
    try { await saveJournal(); } catch { journalSaved = false; }
    throw new AgentError("move_partial_failure", "Move did not complete. Recovery copies were retained; do not blindly retry.", {
      journal: journalPath, journalSaved, observed: await observe(context.root, journal.records),
      recoverySteps: ["Stop edits to affected records and inspect journal.json plus its before copies.", "Compare observed hashes to beforeHash/afterHash; preserve any newer human edits separately.", "Restore references and the source path from the before copies, or finish the remaining reference repairs explicitly.", "Keep the journal/backups. Mark it recovered only after verifying paths, content, and references; do not reuse the old plan."],
      cause: (error as Error).message,
    });
  }
}
