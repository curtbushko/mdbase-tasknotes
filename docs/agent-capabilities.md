# Agent workflow support

See [verification and remaining owner checks](agent-verification.md) for test
coverage, manual-integration limits, and the inherited dependency audit advisory.

## Baseline and contracts

The implementation baseline is mtn 0.2.0-rc.1, mdbase 0.3.0-rc.4, and
TaskNotes model 0.3.0-rc.5. The initializer installs mdbase 0.3.0 with
`tasknotes.task` contract **0.3.0-rc.1**. These are distinct version identifiers.
The pinned mdbase loader also supports legacy 0.2.1 and 0.3.0-alpha.1. Legacy
fields/path_pattern and current JSON Schema/collection.path are not interchangeable.

| Responsibility | Public pinned API / baseline | Agent CLI support |
| --- | --- | --- |
| Configuration/type inspection | loadConfig, getType, DataContractRegistry.load | `diagnose [--json]` |
| Exact record read | Collection.read | `agent show REF --json` |
| Validation | validateJsonSchemaFrontmatter; strict in-memory Collection policy | `agent patch REF --input FILE --json` |
| File writes | Patched Collection.create/update with atomic publication | Agent typed patch and existing interactive commands |
| Naming | path_pattern; collection.path.pattern; TaskNotes runtime template compatibility adapter | Literal/explicit paths and bounded collision allocation |
| Lifecycle | Model operations and core lifecycle actions | Shared agent transitions and explicit instance operations |
| References | Local-fork planRecordRename / moveRecordNoClobber / atomicWriteRecord | `agent move-plan` / `move-apply`, with journal |
| Hierarchy/dependencies/content | Native projects, blockedBy, Markdown | Implemented `agent` operations; see sections below |
| Claims/strict cross-application CAS | Not promised | Not supported |

Presence of an original core method did not certify all required behavior. Nested
blockedBy.uid reference repair and partial-move recovery required the local-fork
contributions and behavioral tests described below. Existing create compatibility
code accesses a private type map; the new agent surface must use public loaders.

## Read-only diagnostics

Run `mtn --path /path/to/collection diagnose` or add `--json`. JSON output is an
explicit version 1 envelope: `{version:1,ok:true,result:...}` or
`{version:1,ok:false,error:{code,message,details}}`. Failures exit nonzero. Existing
`list --json` remains unchanged. Diagnostics use public loaders, not Collection.open,
so even caches are not created. Missing config, types, or declared schemas are
errors, never implicit initialization.

Root selection is `--path`, then `MDBASE_TASKNOTES_PATH`, then global CLI
`collectionPath`, then cwd. Diagnostics reports the selected source, resolved root,
config/type/schema locations, exact contracts, installed core/model versions,
field mappings, completed values, validation policy, exclusions, path metadata,
and operation capabilities. Human warnings are persistent text on stderr, not
color-only signals. Warnings do not change configuration.

Native workflow status, native dependency blocking, and eventual activity-specific
agent eligibility are separate concepts. Diagnostics reports the configured agent eligibility policy, or null when none
is configured. Do not infer
completion or dispatch semantics from English status names.

## Safe initialization and exclusions

`mtn init PATH` refuses to overwrite **any** installed resource. Only explicit
`mtn init PATH --force` authorizes replacing generated config/types/contracts/schema
resources. Do not use force to enable agent support on an existing vault.
Authoritative TaskNotes plugin settings/schema exports remain the source of truth;
no command should weaken or regenerate a live schema implicitly.

New collections exclude `_types`, `_contracts`, `_schemas`, `.git`, `node_modules`,
`.mdbase`, `.mtn`, `.mtn-recovery`, and `.mtn-tmp`. Existing collections are not
silently repaired. Review the `unsafe_exclusions` diagnostic and explicitly add
operational directories (including a custom cache folder) to settings.exclude.
The diagnostic checks known folder exclusion forms conservatively; a warning can
remain for a more general glob that also excludes the folder. Avoid placing
recovery copies elsewhere in task-discovery scope.

The default installation is a fixed inbox: collection.path.folder is `tasks` and
the TaskNotes template is `{{title}}`. It needs no Obsidian runtime. Templates
requiring `projectFolder` are unsupported: configure a fixed folder and supported
template in the authoritative settings/export, or supply an explicit agent creation path. Project membership does not route files.

## Exact automation and typed updates

The separate `agent` command preserves legacy output/NLP contracts. Use exact
collection-relative `.md` paths, never titles. Excluded/non-task records, traversal,
and symlink escapes are rejected. `agent show REF --json` includes raw and effective
frontmatter, full body, exact reference, and the core revision when available.

`agent patch REF --input request.json --json` accepts:

```json
{"operations":[{"op":"set","field":"priority","value":"high"},{"op":"add","field":"contexts","value":"work"},{"op":"remove","field":"contexts","value":"home"},{"op":"unset","field":"due"}]}
```

`--input -` reads JSON from stdin. Values are explicit JSON, never guessed from
unquoted strings. Fields are actual mapped frontmatter keys. Unknown fields must
be schema-permitted; required fields and task identification cannot be removed.
Mapped relationship/lifecycle fields use shared semantic handlers; derived
blocking/projection fields and retry identities are not directly writable. Identical patches return
`changed:false` without refreshing timestamps. Mutations load current content,
validate constraints even with collection warning/off policy, pass the observed
revision to core, preserve unrelated observed changes, and close resources before
printing JSON or setting failure exit status. Commander errors in agent JSON mode
also use the version 1 failure envelope.

### Local core safety patch

The original pinned core used truncating writes for updates, so API presence alone
was insufficient for safe replacement. `scripts/patch-mdbase.mjs` reproducibly
builds vendored **0.3.0-rc.4-mtn.1** from the retained original archive. It replaces
record create/update/batch-write publication with same-directory exclusive temp
files, file sync, and atomic rename (or no-clobber link publication on creation).
Failed publication preserves the original and removes temporary files; non-Markdown
temp names cannot be discovered as tasks. Tests inject publication failure and
forbid direct truncating writes. That initial patch did not certify rename/reference
repair; the later move-plan APIs described below supply that separate capability. This is not a multi-record transaction,
an exclusive task claim, or a strict cross-application CAS guarantee; core revision
and mtime checks still have a small check-to-publication race.

## Literal creation

`mtn agent create --input request.json --json` accepts a request such as:

```json
{"title":"tomorrow #literal","path":"tasks/exact.md","description":"## Scope\nBuild this literally.","fields":{"priority":"high","contexts":["agent"]},"retryKey":"project-phase-task"}
```

The optional `path` is exact; omission uses the collection's supported naming
contract. `descriptionFile` reads UTF-8 (or `-` for stdin), mutually exclusive with
`description`. The entire JSON request can also arrive on stdin via `--input -`;
it cannot simultaneously consume a second content stream from that same stdin.
No title/body NLP is invoked. Structured `fields` use actual mapped keys and
schema-permitted native JSON values. Relationship values pass shared semantic validators.

An occupied explicit path fails. Generated second-granularity timestamp/time/
second/unix/zettel profiles try at most 60 consecutive second offsets, preserving
the configured naming format. Other collisions fail with an actionable diagnostic;
no arbitrary title suffixes or overwrites are introduced. Exclusions, nested
collection boundaries, traversal, and symlinks are checked before publication.
Runtime-only values such as projectFolder fail; fixed inboxes are supported.

Opt-in creation retries persist inspectable `mtnCreateRetry: {key,intent}` metadata
in the task only if its schema permits that field. Identical retries return the
original exact reference with `changed:false`; conflicting intent or duplicate
key identities fail explicitly. Strict schemas must explicitly permit this optional
metadata at their authoritative configuration layer. Keys are not a cross-process
exclusive-claim or uniqueness-lock protocol. No hidden retry database is used.

## Description and evidence

`agent describe REF --input FILE --json` replaces `description` (or reads
`descriptionFile`) while preserving the entire evidence suffix verbatim. Empty
string explicitly clears description. `agent note REF` accepts `content` or
`contentFile`, optional `timestamp`, `author`, `role`, `category`, and `retryKey`.
Build/review/fix are ordinary categories; attribution is caller-supplied, not
authenticated. First append to a plain body requires explicit `adopt:true`: it adds
an evidence boundary after the existing description without rewriting it.

The Markdown convention uses an HTML `mtn:evidence:v1` boundary and framed
`mtn:entry:v1` / `mtn:end-entry:v1` entries. Metadata is base64url-encoded JSON in
comments; headings, timestamps, attribution, and note text remain readable in any
Markdown viewer. No frontmatter additions or sidecar results are required for
evidence retry keys, including on strict schemas. Identical retries are no-ops;
conflicting reuse fails. Reserved delimiters in supplied content/labels are rejected
to avoid ambiguous framing. Human bodies are never implicitly restructured.

`agent show` returns description and structured evidence alongside the full
original body. It reports malformed convention metadata as `contentIssues`;
mutations refuse to hide malformed history until explicitly repaired. Unstructured
human text remains available in the body and survives description/evidence edits.
Review approval is evidence only, not an automatic transition to completion.

## Shared lifecycle

`agent status REF` accepts `{status,completedDate?}`. `agent complete` selects the
first configured completed value; `agent reopen` selects the configured incomplete
default (or an explicit status). Historical dates must be real YYYY-MM-DD values
and accompany a completed status. The same model planner handles typed generic
status sets, legacy non-recurring complete, and legacy status updates. Agent writes
enforce schema constraints; legacy completion retains ordinary warning-policy
compatibility. Repeating the same status intent does not refresh dates. Reopening
non-recurring tasks deletes completion metadata as required by this pinned model.

`complete`/`reopen` explicitly address **base-task** status on the agent surface.
`complete-instance`, `reopen-instance`, `skip-instance`, and `unskip-instance`
require `{date:"YYYY-MM-DD"}` and a recurring base task. They use pinned model
instance/history and recurrence scheduling operations, preserve unrelated history,
and do not equate an occurrence with base-task completion. Legacy interactive
recurring `complete` retains its existing occurrence-targeting contract.

Configured workflow statuses are native values, not agent.state metadata. An
optional top-level task-type extension provides inspectable policy:

```yaml
x-mtn-agent-policy:
  blockedStatuses: [waiting-for-owner]
  activities:
    build: [open, in-progress]
    review: [awaiting-review]
```

The authoritative status enum/binding must already include these values. No names
are inferred or automatically added. `agent block` requires explicit `status` and
`blocker`; entering a configured blocked status through generic/dedicated agent
updates also requires a blocker. The explanation is appended as external-blocker
evidence in the same atomic task update. Human edits without explanations remain
readable; eligibility reporting is completed in phase 7.

Core patch **0.3.0-rc.4-mtn.2** additionally corrects the frontmatter closing-delimiter
regex, which previously consumed leading blank lines from descriptions (and hid
evidence boundaries on empty descriptions). Literal body round-trips now preserve
those lines. The patch remains reproducible from the original retained archive.

## Hierarchy

`agent project-add REF` and `project-remove` accept `{target:"exact/record.md"}`.
`project-replace` also requires `replacement`, identifying the old membership
explicitly. Native mapped projects links are the only parent/membership storage;
unrelated memberships survive. Compatible non-task project records are valid.
Generic typed projects writes pass the same hierarchy checks. New self/multi-hop
cycles are rejected; observed broken links may be retained while repairing others.

`agent hierarchy REF [--input FILE] --json` returns immediate children, distinct
transitive descendants, parent status, leaf-task progress, and cycle diagnostics.
`{includeArchived:true}` opts into archived records/branches. Default traversal
excludes them, but shared descendants reachable via a live branch count once.
Recurring leaves count once by base status. Empty scopes return zero/zero and null
percentage. No parent status is changed and no ancestor links or prerequisite
edges are inferred. `agent show` includes this derived hierarchy context.

Graph queries use a single included-record snapshot. Link ambiguity is reported
conservatively rather than choosing a similar title. Progress is snapshot
information, not scheduling or ownership. PRD/story references stay ordinary body
text, preserved by relationship edits.

## Dependencies and eligibility

`agent depends-add REF` accepts `{target,reltype?,gap?}` and stores only mapped
native blockedBy entries; default relationship is FINISHTOSTART. `depends-remove`
removes by target identity and is a no-op when absent, including an absent list.
`depends-replace` requires an explicit native `entries` array. Add preserves an
existing entry's relationship/gap instead of overwriting it. Creation accepts
`dependsOn:["exact/task.md"]`; typed native relationship fields pass the same
validators as dedicated operations. Self-links, duplicates, and new multi-hop
cycles fail before writing. Pre-existing cycles are reported by queries and
`agent validate [REF]`; validation failures produce nonzero JSON errors.

`agent dependencies REF`, `agent ready [SCOPE]`, and `agent blocked [SCOPE]` accept
optional `{activity,scope,includeArchived}` input. They expose nativeBlocked,
dependencyReady, persisted workflow status, agentEligible, reason codes, observed
prerequisite statuses, downstream blocking, and snapshot context separately.
Without an explicit activity policy, queries expose dependency readiness only;
agentEligible is null, not an implicit claim of builder/reviewer dispatch safety.
With an activity, the x-mtn-agent-policy status lists determine eligibility.
External blockers return evidence explanations or a missing-explanation diagnostic.
Completed/archived tasks are excluded from selection by default. Hierarchy never
creates a prerequisite. Completing/reopening prerequisites changes derived results
without editing dependents. Recurring dependencies use base status only.

The optional native specification provider `tasknotes.yaml` supplies its
`dependencies` object (only); mdbase types/contracts remain authoritative for field
mapping/status/schema. Missing keys use documented spec defaults, including
`treat_missing_target_as_blocked:true`. Setting it false can yield native unblocked
but safe dependency-ineligible for a missing link. Broken/ambiguous links always
fail closed for agent readiness. Agent relationship writes additionally require
new targets to resolve and reject duplicate identities even if a permissive native
policy would preserve them. Existing malformed/broken human records are diagnosed,
not silently rewritten. Reltype/gap are validated/preserved, not timing enforcement.

Core patch **0.3.0-rc.4-mtn.3** exposes the pinned snapshot LinkResolver/parseLink as
supported local-fork public APIs and repairs explicit filename wikilink lookup.
Native blocking uses that resolver's semantics; agent readiness additionally rejects
ambiguous basename candidates instead of applying native tie-breaks. No private
collection fields are accessed. Snapshot results are not leases or exclusive claims.

Dependency policy semantics were checked against tasknotes-spec sections 9.11 and
10.2 (https://github.com/callumalpass/tasknotes-spec). This is automated/spec-level
compatibility evidence, not a claim that manual Obsidian plugin checks were run.

## Explicit relocation and recovery

`agent move-plan REF --input request.json --json` accepts `{to:"archive/task.md"}`.
It writes nothing: the result contains exact paths, snapshot hashes, affected
records, reference changes, warnings, capabilities, and a planHash. Save that result
and pass `{plan: RESULT}` to `agent move-apply REF`. Apply recomputes and compares
the plan against the latest included records before writing. Occupied/unsafe paths,
symlinks, nested collections, and stale edits fail safely. Title, status, identities,
project membership, and graph relationships are not reassigned by a storage move.

The supported reference profile covers declared link fields, mapped native
projects, nested blockedBy.uid, ordinary inline Markdown/wikilinks, aliases/anchors,
and outgoing relative-link meaning in the moved note. Code fences (backticks and
tildes), inline code, unrelated URLs, and plain text are not globally replaced.
Known unsupported forms (such as reference-style Markdown definitions or nested/
titled link targets) produce explicit warnings. Apply refuses them unless the
caller supplies acceptLimitations:true, and then reports
referenceRepairComplete:false rather than claiming full repair.

Before any task changes, apply saves before copies and an inspectable journal under
`.mtn-recovery/UUID/`. This directory must already be excluded; existing config is
never silently repaired. Source publication uses a same-filesystem no-clobber core
move; cross-filesystem moves fail rather than falling back to unsafe replacement.
Reference writes are individually atomic, but the overall move is **not** a
multi-record transaction. An interruption/failure reports observed paths/hashes,
retains backups, exits nonzero, and blocks further moves until recovery is resolved.
A completed identical retry is a no-op only when recorded outputs still match.

For recovery, stop edits, inspect journal.json and the exact `.before.txt` copies,
and compare beforeHash/afterHash with observed files. Preserve newer human edits
separately. Either restore original source/references from before copies or finish
the intended repairs. Verify the resulting paths, content, and references; then
explicitly mark the journal status recovered. Keep the journal/backups and generate
a new plan. No command automatically overwrites newer edits or discards failed
recovery data. Injected mid-move failure is covered by automated regressions.

The active dependency contribution is **0.3.0-rc.4-mtn.7**. In addition to previous
patches, it exposes pure reference planning, explicit no-clobber moves, atomic
publication, and serialization as supported public APIs; corrects percent-encoded
Markdown target resolution; and provides explicit unset fields without converting
unset to null. Agent writes preserve permitted nulls and empty lists in memory
without rewriting collection settings. Literal body termination is also preserved
rather than silently adding a final newline. These close semantic-preservation
gaps in the original writer. Source is reproducible using
scripts/patch-mdbase.mjs and scripts/mdbase-relocation.{js,d.ts}.

## Packaged operation and quality gates

The npm artifact bundles the locally patched core and includes its archive and
these command/verification documents. Isolated package smoke copies the artifact
away from the source tree, installs it, and executes diagnostics, creation/retry,
evidence, lifecycle, move, and legacy capture/list commands. It does not depend on
a vendor directory next to the source checkout.

Run `npm test`, `npx tsc --noEmit`, `npm run test:tz-parity`, and
`npm run test:package`; the available `task check` runs the test, timezone, and
package gates sequentially. There is no lint script in the existing package.
Timezone checks include explicit non-recurring dates and recurring instance
lifecycle behavior in UTC, Los Angeles, Berlin, and Tokyo. The latter exposed and
fixed a local-midnight-to-UTC day shift. Generated timestamp identities are
allocated before hierarchy/dependency self-edge checks, including publication
races; existing notes are not overwritten.

Generic editing cannot rewrite retry identity metadata or persist depends-on
aliases as a competing graph. Native relationship and lifecycle fields use their
shared semantic handlers. Declared TaskNotes contract versions other than the
pinned supported version are diagnosed and refused instead of silently applying
older transition semantics.

## Verification baseline

Before implementation, `npm test` passed 1,041 tests. Type checking exposed existing
raw-task typing, model-config completeness, NLP enum narrowing, and MockDate typing
issues; phase 1 corrects those without changing task semantics. Every phase must
record its own verification; a core capability, automated contract fixture, and a
manual TaskNotes UI check are not equivalent evidence. No live-vault checks or
production migration are authorized.
