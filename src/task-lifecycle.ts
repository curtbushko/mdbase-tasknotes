import { buildTaskPropertyUpdatePlan, specFrontmatterToTaskInfo, buildRecurringTaskCompletePlan, recurringCompletePlanToFrontmatterPatch, buildSpecRecurringSkipUpdate } from "@tasknotes/model/operations";
import { DEFAULT_FIELD_MAPPING } from "@tasknotes/model/mapping";
import { AgentError, invalid, record, type AgentContext } from "./agent.js";
import { normalizeFrontmatter, normalizeTaskTypeDefinition, denormalizeFrontmatter } from "./field-mapping.js";
import { getCurrentDateString, parseDateToUTC, validateDateString } from "./date.js";
import { planEvidenceBody } from "./task-content.js";

type Fields = Record<string, unknown>;
export function configuredStatuses(context: AgentContext): { values: string[]; defaultValue?: string } {
  const normalized = normalizeTaskTypeDefinition(context.types.get("task"));
  const definition = normalized.fields[context.mapping.roleToField.status];
  const values = Array.isArray(definition?.values) ? definition.values.filter((value): value is string => typeof value === "string") : [];
  return { values, defaultValue: typeof definition?.default === "string" ? definition.default : undefined };
}

export function agentPolicy(context: AgentContext): Record<string, unknown> | null {
  const policy = context.types.get("task")?.domain?.["x-mtn-agent-policy"];
  if (policy === undefined) return null;
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new AgentError("configuration_error", "x-mtn-agent-policy must be an object.");
  const value = policy as Fields;
  const configured = configuredStatuses(context).values;
  if (value.activities !== undefined && (!value.activities || typeof value.activities !== "object" || Array.isArray(value.activities))) throw new AgentError("configuration_error", "Agent activities policy must be an object.");
  for (const list of Object.values(value.activities ?? {})) {
    if (!Array.isArray(list) || list.some(item => typeof item !== "string" || !configured.includes(item))) throw new AgentError("configuration_error", "Agent activity policy must list configured statuses.");
  }
  if (value.blockedStatuses !== undefined && (!Array.isArray(value.blockedStatuses) || value.blockedStatuses.some(item => typeof item !== "string" || !configured.includes(item)))) throw new AgentError("configuration_error", "blockedStatuses must list configured statuses.");
  return value;
}

export async function statusFields(context: AgentContext, current: { ref: string; frontmatter: Fields; effectiveFrontmatter: Fields; body: string }, status: unknown, request: Fields) {
  if (typeof status !== "string" || !status.trim()) invalid("status must be a configured string value.");
  const configured = configuredStatuses(context);
  if (!configured.values.includes(status as string)) throw new AgentError("configuration_error", `Status ${status} is not configured. Change authoritative TaskNotes settings/schema; mtn will not extend it.`);
  const completed = context.mapping.completedStatuses.includes(status as string);
  if (request.completedDate !== undefined) {
    if (!completed || typeof request.completedDate !== "string") invalid("Historical completedDate requires a completed status and YYYY-MM-DD string.");
    try { validateDateString(request.completedDate as string); } catch { invalid("Invalid completedDate; use a real YYYY-MM-DD calendar date."); }
  }
  const fm = normalizeFrontmatter(current.effectiveFrontmatter, context.mapping);
  let body = current.body;
  const policy = agentPolicy(context);
  const blocked = Array.isArray(policy?.blockedStatuses) && policy.blockedStatuses.includes(status);
  if (blocked || request.requireBlocker === true) {
    if (typeof request.blocker !== "string" || !request.blocker.trim()) invalid("An agent blocked transition requires a blocker explanation.");
    body = await planEvidenceBody(body, { content: request.blocker, category: "external-blocker", author: request.author ?? "unspecified", role: request.role, retryKey: request.retryKey, adopt: true });
  }
  const fields: Fields = {};
  if (fm.status === status && (request.completedDate === undefined || fm.completedDate === request.completedDate)) return { fields, body };
  const plan = buildTaskPropertyUpdatePlan({
    freshTask: specFrontmatterToTaskInfo(fm, current.ref), property: "status", value: status,
    fieldMapping: { ...DEFAULT_FIELD_MAPPING, ...context.mapping.roleToField },
    statuses: configured.values.map((value, order) => ({ id: value, value, label: value, color: "", isCompleted: context.mapping.completedStatuses.includes(value), order, autoArchive: false, autoArchiveDelay: 0 })),
    now: new Date().toISOString(), currentDateString: request.completedDate as string ?? getCurrentDateString(),
  });
  for (const operation of plan.frontmatterPatch) fields[operation.field] = operation.op === "set" ? operation.value : undefined;
  return { fields, body };
}

export async function transitionTask(context: AgentContext, ref: string, operation: string, input: unknown) {
  const request = input === undefined ? {} : record(input);
  const current = await context.read(ref);
  const configured = configuredStatuses(context);
  const status = operation === "complete" ? request.status ?? context.mapping.completedStatuses[0]
    : operation === "reopen" ? request.status ?? configured.defaultValue ?? configured.values.find(value => !context.mapping.completedStatuses.includes(value))
    : request.status;
  if (operation === "complete" && !context.mapping.completedStatuses.includes(String(status))) invalid("complete requires a configured completed status.");
  if (operation === "reopen" && context.mapping.completedStatuses.includes(String(status))) invalid("reopen requires a configured incomplete status.");
  const plan = await statusFields(context, current, status, { ...request, requireBlocker: operation === "block" });
  return context.commitFields(current, plan.fields, plan.body);
}

export async function transitionInstance(context: AgentContext, ref: string, operation: string, input: unknown) {
  const request = record(input);
  if (typeof request.date !== "string") invalid("Instance operations require an explicit YYYY-MM-DD date.");
  let date: string;
  try { date = validateDateString(request.date as string); } catch { invalid("Invalid instance date."); }
  const current = await context.read(ref);
  const fm = normalizeFrontmatter(current.effectiveFrontmatter, context.mapping);
  if (!fm.recurrence) invalid("Instance operations require a recurring base task.");
  const completed = Array.isArray(fm.completeInstances) ? fm.completeInstances as string[] : [];
  const skipped = Array.isArray(fm.skippedInstances) ? fm.skippedInstances as string[] : [];
  const completing = operation === "complete-instance";
  const reopening = operation === "reopen-instance";
  if ((completing && completed.includes(date!)) || (reopening && !completed.includes(date!))
    || operation === "skip-instance" && skipped.includes(date!) || operation === "unskip-instance" && !skipped.includes(date!)) return { ...current, changed: false };
  let fields: Fields;
  if (completing || reopening) {
    const plan = buildRecurringTaskCompletePlan({ freshTask: specFrontmatterToTaskInfo(fm, ref), targetDate: parseDateToUTC(date!), currentTimestamp: new Date().toISOString(), maintainDueDateOffsetInRecurring: true });
    fields = Object.fromEntries(recurringCompletePlanToFrontmatterPatch(plan, { ...DEFAULT_FIELD_MAPPING, ...context.mapping.roleToField }).map(op => [op.field, op.op === "set" ? op.value : undefined]));
  } else {
    const plan = buildSpecRecurringSkipUpdate({ frontmatter: fm, targetDate: date!, skip: operation === "skip-instance", currentTimestamp: new Date().toISOString(), path: ref });
    fields = denormalizeFrontmatter(plan.fields, context.mapping);
  }
  return context.commitFields(current, fields);
}
