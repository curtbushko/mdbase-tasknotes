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
| Exact record read | Collection.read | Planned phase 2 |
| Validation | validateJsonSchemaFrontmatter; Collection.validate; v03Operations | Planned phase 2 stricter writes |
| File writes | Collection.create/update, core safe replacement | Existing interactive commands; agent path planned |
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

## Verification baseline

Before implementation, `npm test` passed 1,041 tests. Type checking exposed existing
raw-task typing, model-config completeness, NLP enum narrowing, and MockDate typing
issues; phase 1 corrects those without changing task semantics. Every phase must
record its own verification; a core capability, automated contract fixture, and a
manual TaskNotes UI check are not equivalent evidence. No live-vault checks or
production migration are authorized.
