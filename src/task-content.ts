import { AgentError, invalid, record, type AgentContext } from "./agent.js";
import { intentHash, textInput } from "./agent-create.js";
import { parseDateToUTC } from "./date.js";

const BOUNDARY = "\n<!-- mtn:evidence:v1 -->\n";
const ENTRY_END = "\n<!-- mtn:end-entry:v1 -->\n";
const RESERVED = /<!-- mtn:(?:evidence|entry|end-entry):/;
export interface Evidence {
  timestamp: string;
  author: string;
  role?: string;
  category: string;
  retryKey?: string;
  intent: string;
  content: string;
}

export function inspectContent(body: string) {
  const index = body.indexOf(BOUNDARY);
  const description = index < 0 ? body : body.slice(0, index);
  const suffix = index < 0 ? "" : body.slice(index);
  const evidence: Evidence[] = [];
  const issues: string[] = [];
  if (index >= 0) {
    if (body.indexOf(BOUNDARY, index + BOUNDARY.length) >= 0) issues.push("duplicate_evidence_boundary");
    const pattern = /\n<!-- mtn:entry:v1:([A-Za-z0-9_-]+) -->\n### [^\n]*\n\n([\s\S]*?)\n<!-- mtn:end-entry:v1 -->\n/g;
    for (const match of suffix.matchAll(pattern)) {
      try {
        const metadata = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
        if (!metadata || typeof metadata !== "object" || typeof metadata.timestamp !== "string" || typeof metadata.author !== "string" || typeof metadata.category !== "string" || typeof metadata.intent !== "string") throw new Error("Invalid evidence metadata.");
        evidence.push({ ...metadata, content: match[2] });
      } catch { issues.push("malformed_evidence_metadata"); }
    }
    const starts = suffix.match(/<!-- mtn:entry:/g)?.length ?? 0;
    if (starts !== evidence.length) issues.push("malformed_evidence_entry");
  }
  return { description, evidence, managed: index >= 0, contentIssues: issues, suffix };
}

export async function describeTask(context: AgentContext, ref: string, input: unknown) {
  const request = record(input);
  const description = await textInput(request, "description");
  if (description === undefined) invalid("Supply description or descriptionFile (empty string explicitly clears it).");
  if (RESERVED.test(description)) invalid("Description contains a reserved mtn content delimiter.");
  const current = await context.read(ref);
  const content = inspectContent(current.body);
  if (content.contentIssues.length) throw new AgentError("content_conflict", "Repair malformed evidence delimiters before editing.", content.contentIssues);
  return context.writeBody(current, description + content.suffix);
}

function singleLine(value: unknown, fallback: string, field: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !value.trim() || /[\r\n]/.test(value) || RESERVED.test(value)) invalid(`${field} must be a non-empty single-line string.`);
  return value as string;
}

export async function appendEvidence(context: AgentContext, ref: string, input: unknown) {
  const request = record(input);
  const content = await textInput(request, "content");
  if (content === undefined || !content.trim()) invalid("Supply non-empty content or contentFile.");
  if (RESERVED.test(content)) invalid("Evidence contains a reserved mtn content delimiter.");
  const author = singleLine(request.author, "unspecified", "author");
  const role = request.role === undefined ? undefined : singleLine(request.role, "", "role");
  const category = singleLine(request.category, "note", "category");
  const retryKey = request.retryKey === undefined ? undefined : singleLine(request.retryKey, "", "retryKey");
  if (request.timestamp !== undefined) {
    if (typeof request.timestamp !== "string") invalid("timestamp must be an ISO timestamp.");
    try { parseDateToUTC(request.timestamp as string); } catch { invalid("timestamp must be a valid ISO timestamp."); }
  }
  const intent = intentHash({ content, author, role: role ?? null, category, timestamp: request.timestamp ?? null });
  const current = await context.read(ref);
  const parsed = inspectContent(current.body);
  if (parsed.contentIssues.length) throw new AgentError("content_conflict", "Repair malformed evidence delimiters before appending.", parsed.contentIssues);
  if (!parsed.managed && request.adopt !== true) throw new AgentError("content_consent_required", "This body has no evidence convention. Pass adopt:true to append a boundary after the existing description without rewriting it.");
  if (retryKey) {
    const matches = parsed.evidence.filter(entry => entry.retryKey === retryKey);
    if (matches.length > 1) throw new AgentError("idempotency_conflict", "Duplicate evidence retry identities require explicit repair.");
    if (matches.length) {
      if (matches[0].intent !== intent) throw new AgentError("idempotency_conflict", "Evidence retry key was used with different intent.");
      return { ...current, changed: false };
    }
  }
  const metadata = { timestamp: request.timestamp ?? new Date().toISOString(), author, role, category, retryKey, intent };
  const encoded = Buffer.from(JSON.stringify(metadata)).toString("base64url");
  const entry = `\n<!-- mtn:entry:v1:${encoded} -->\n### ${metadata.timestamp} · ${category} · ${author}\n\n${content}${ENTRY_END}`;
  return context.writeBody(current, current.body + (parsed.managed ? "" : BOUNDARY) + entry);
}
