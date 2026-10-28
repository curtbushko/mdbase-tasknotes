# Agent workflow support

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
| Naming | path_pattern; collection.path.pattern; TaskNotes runtime template compatibility adapter | Existing capture; literal/collision policy planned |
| Lifecycle | Model operations and core lifecycle actions | Existing completion/recurrence; unified agent transitions planned |
| References | Collection.rename with update_refs | Core primitive exists; safe preview/recovery CLI not yet implemented |
| Hierarchy/dependencies/content | Native projects, blockedBy, Markdown | Agent operations planned phases 4/6/7 |
| Claims/strict cross-application CAS | Not promised | Not supported |

Presence of a core method does not certify all required behavior. In particular,
nested blockedBy.uid reference repair and partial-move recovery need behavioral
characterization before relocation can be advertised. Existing create compatibility
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
agent eligibility are separate concepts. Until a policy and eligibility operations
are implemented, diagnostics reports no agent eligibility policy. Do not infer
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
template in the authoritative settings/export, or supply an explicit path once
that agent operation is available. Project membership does not route files.

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
Relationship/lifecycle fields are protected until their semantic handlers exist;
derived blocking/projection fields are never writable. Identical patches return
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
forbid direct truncating writes. Rename/reference repair writes are not certified
by this patch and remain phase 8 work. This is not a multi-record transaction,
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
schema-permitted native JSON values. Relationships require semantic operations.

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

## Verification baseline

Before implementation, `npm test` passed 1,041 tests. Type checking exposed existing
raw-task typing, model-config completeness, NLP enum narrowing, and MockDate typing
issues; phase 1 corrects those without changing task semantics. Every phase must
record its own verification; a core capability, automated contract fixture, and a
manual TaskNotes UI check are not equivalent evidence. No live-vault checks or
production migration are authorized.
