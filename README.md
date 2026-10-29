# mdbase-tasknotes

Standalone CLI for managing markdown tasks via [mdbase](https://mdbase.dev). Create, query, and manage tasks directly on markdown files using natural language or exact-reference JSON commands for automation.

New collections use the mdbase v0.3 JSON Schema type format. Existing v0.2
TaskNotes collections remain supported, so the CLI can share a vault with the
[TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian plugin during a
staged migration.

## Install

### npm

```
npm install -g mdbase-tasknotes
```

### Nix

Run without installing, or add `mtn` to your user profile:

```bash
nix run github:curtbushko/mdbase-tasknotes -- --help
nix profile install github:curtbushko/mdbase-tasknotes#mtn
```

The flake exports `packages.<system>.mtn` (also `default`), corresponding `apps`,
and `overlays.default` for `aarch64-darwin`, `x86_64-darwin`, `aarch64-linux`, and
`x86_64-linux`. Node.js and runtime dependencies are included; no separate npm
installation is needed.

#### Use as a flake input

Add this alongside your existing `nixpkgs` input:

```nix
inputs.mtn = {
  url = "github:curtbushko/mdbase-tasknotes";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

In a NixOS or nix-darwin module receiving `inputs`:

```nix
{ inputs, pkgs, ... }:
{
  environment.systemPackages = [
    inputs.mtn.packages.${pkgs.stdenv.hostPlatform.system}.mtn
  ];
}
```

Or in Home Manager:

```nix
{ inputs, pkgs, ... }:
{
  home.packages = [
    inputs.mtn.packages.${pkgs.stdenv.hostPlatform.system}.mtn
  ];
}
```

Pass `inputs` through `specialArgs` when constructing a NixOS/nix-darwin system,
or `extraSpecialArgs` for standalone Home Manager. For Home Manager integrated
into a system configuration, use `home-manager.extraSpecialArgs`.

Alternatively, use the overlay in a NixOS/nix-darwin module:

```nix
{ inputs, pkgs, ... }:
{
  nixpkgs.overlays = [ inputs.mtn.overlays.default ];
  environment.systemPackages = [ pkgs.mtn ];
}
```

From a local checkout:

```bash
nix build .#mtn
nix run .#mtn -- --help
nix flake check
```

The GitHub input uses committed, pushed contents; local changes must be published
before the remote URL exposes them. The package builds from source using the npm
lockfile and the vendored core, excludes local task collections from its source,
and runs an installed-CLI smoke check during the build. See `npmDepsHash` in
`flake.nix` when updating npm dependencies: temporarily use `lib.fakeHash`, build,
and replace it with the reported hash. This does not modify the repository's npm
lockfile.

## Quick start

```bash
# Initialize a new collection
mtn init ~/notes

# Set as default collection
mtn config --set collectionPath=~/notes

# Create tasks with natural language
mtn create "Buy groceries tomorrow #shopping @errands"
mtn create "Write report due friday #work +quarterly-review"
mtn create "Fix the faucet high priority #home @house"

# List and query
mtn list
mtn list --overdue
mtn list --tag work --status open
mtn list --json

# Complete a task
mtn complete "Buy groceries"

# Track time
mtn timer start "Write report"
mtn timer status
mtn timer stop
mtn timer log --period today
```

## Commands

| Command | Description |
|---|---|
| `mtn init [path]` | Initialize collection config, task type, contracts, and schemas; refuses overwrites unless `--force` is explicit |
| `mtn diagnose` | Inspect effective collection configuration and capabilities without writing (`--json` supported) |
| `mtn agent <operation> [ref]` | Exact-reference task automation (`--input FILE`, `--input -` for stdin, `--json`); see below |
| `mtn create <text...>` | Create a task from natural language |
| `mtn list` | List tasks with filters (`--status`, `--priority`, `--tag`, `--due`, `--overdue`, `--where`, `--on`, `--json`) |
| `mtn show <task>` | Show full task detail (`--on YYYY-MM-DD` for recurring instance state) |
| `mtn complete <task>` | Complete a task or recurring occurrence (`--date YYYY-MM-DD` supplies its completion/instance date) |
| `mtn update <task>` | Update fields (`--status`, `--priority`, `--due`, `--scheduled`, `--title`, tag/context add/remove flags) |
| `mtn delete <task>` | Delete a task (`--force` to skip backlink check) |
| `mtn archive <task>` | Add archive tag to a task |
| `mtn skip <task>` | Skip a recurring instance (`--date YYYY-MM-DD`, default today) |
| `mtn unskip <task>` | Unskip a recurring instance (`--date YYYY-MM-DD`, default today) |
| `mtn search <query>` | Full-text search across tasks |
| `mtn timer start\|stop\|status\|log` | Time tracking |
| `mtn projects [list\|show]` | List projects and their tasks |
| `mtn stats` | Aggregate statistics |
| `mtn interactive` | REPL with live NLP preview |
| `mtn config` | Manage CLI configuration (`--set`, `--get`, `--list`) |

The conventional task commands accept file paths or titles, matching titles
exactly first, then by substring. **`mtn agent` operations require exact
collection-relative Markdown paths** such as `task-01-01.md` or `tasks/build.md`;
they never fall back to fuzzy title matching.

## Agent and automation commands

Use `mtn --path COLLECTION agent OPERATION [REF] --input FILE --json`.
Requests are JSON objects, not extra field flags. `--input -` reads the request
from stdin. Fields in a request's `fields` object or `patch` operations use the
collection's actual mapped frontmatter names.

### Diagnose a collection

```bash
mtn --path .tasks diagnose
mtn --path .tasks diagnose --json
```

Diagnostics report the effective root and selection source, config/type locations,
core/model/contract versions, field mappings, status semantics, exclusions,
validation policy, dependency policy, and supported capabilities. Missing config
is an error, not an instruction to initialize. Unsupported runtime templates and
unsafe recovery-copy exclusions are reported without silently changing settings.

### Operation reference

In this table, `REF` is an exact task path. `SCOPE` can be an included project or
phase record. Request examples describe the JSON passed with `--input`.

| Operation after `mtn agent` | JSON request | Behavior |
|---|---|---|
| `create` | `{title, path?, fields?, description?, descriptionFile?, dependsOn?, retryKey?}` | Literal creation without NLP; returns the exact reference |
| `show REF` | None | Retrieve native fields, description, evidence, hierarchy, and dependencies |
| `patch REF` | `{operations: [{op, field, value?}]}` | Typed `set`, `unset`, `add`, or `remove`; semantic fields share invariant checks |
| `describe REF` | `{description}` or `{descriptionFile}` | Replace the specification without erasing evidence |
| `note REF` | `{content, category?, author?, role?, timestamp?, retryKey?, adopt?}` | Append evidence; `contentFile` can replace `content` |
| `status REF` | `{status, completedDate?}` | Apply a configured native workflow status |
| `complete REF` | Optional `{status, completedDate}` | Complete the **base task** using configured completion semantics |
| `reopen REF` | Optional `{status}` | Reopen the base task using the pinned lifecycle rules |
| `block REF` | `{status, blocker}` | Set an existing configured status and append a blocker explanation |
| `complete-instance REF`, `reopen-instance REF`, `skip-instance REF`, `unskip-instance REF` | `{date: "YYYY-MM-DD"}` | Change one explicit recurring occurrence, not the base task's completion |
| `project-add REF` | `{target}` | Add one native project/parent membership |
| `project-remove REF` | `{target}` | Remove one membership, preserving unrelated links |
| `project-replace REF` | `{target, replacement}` | Replace the identified membership rather than guessing a parent |
| `hierarchy SCOPE` | Optional `{includeArchived: true}` | Direct children, deduplicated descendants, leaf progress, and cycle diagnostics |
| `depends-add REF` | `{target, reltype?, gap?}` | Add one prerequisite; preserve existing entries and metadata |
| `depends-remove REF` | `{target}` | Remove one prerequisite; absent edges are no-ops |
| `depends-replace REF` | `{entries: [{uid, reltype, gap?}]}` | Explicit whole-list replacement using native dependency objects |
| `dependencies REF` | Optional `{activity}` | Prerequisites, derived downstream blocking, native blocking, eligibility, and reasons |
| `ready [SCOPE]`, `blocked [SCOPE]` | Optional `{activity, scope, includeArchived}` | Query readiness or activity-specific eligibility within the selected scope |
| `validate [REF]` | None | Validate task/collection data and diagnose hierarchy/dependency cycles |
| `move-plan REF` | `{to}` | Read-only move preview with paths, affected records, reference changes, and snapshot hashes |
| `move-apply REF` | `{plan, acceptLimitations?}` | Apply the saved plan with stale-edit checks and retained recovery information |

`description` and `descriptionFile` are mutually exclusive, as are `content` and
`contentFile`. A content-file value of `"-"` reads that content from stdin, but
stdin cannot supply both a JSON request and a separate content stream at once.

### Create and resume work

The following examples assume an initialized collection at `.tasks`. Use a new
example collection or substitute unused task paths: creation will not overwrite
existing records. For a new collection only, run `mtn init .tasks` first; do not use
`--force` on an existing collection to enable automation.

```bash
# Literal title, multiline specification, explicit fields, and a retry identity.
mtn --path .tasks agent create --input - --json <<'JSON'
{
  "title": "Implement tomorrow #literal",
  "path": "task-01-01.md",
  "description": "## Scope\nImplement the feature.\n\n## Acceptance criteria\n- Add a regression test.\n",
  "fields": {"priority": "high", "tags": ["task", "phase-01"]},
  "retryKey": "example-phase-01-task-01"
}
JSON

# A second task depends on the first; hierarchy is a separate relationship.
mtn --path .tasks agent create --input - --json <<'JSON'
{
  "title": "Verify the implementation",
  "path": "task-01-02.md",
  "description": "Run verification and record the observed results.",
  "dependsOn": ["task-01-01.md"]
}
JSON

mtn --path .tasks agent show task-01-01.md --json
mtn --path .tasks agent dependencies task-01-02.md --json
mtn --path .tasks agent ready --json

# Native lifecycle changes immediately affect dependent readiness.
mtn --path .tasks agent complete task-01-01.md --json
mtn --path .tasks agent reopen task-01-01.md --json
```

Replaying an identical creation request with a supported retry key returns the
original task with `changed:false`; conflicting reuse fails. Creation retry
metadata must be permitted by the schema. Generated-name collisions never justify
overwriting an existing note or silently switching naming conventions.

### Edit specifications and record evidence

```bash
mtn --path .tasks agent patch task-01-01.md --input - --json <<'JSON'
{"operations":[{"op":"set","field":"priority","value":"normal"},{"op":"add","field":"contexts","value":"implementation"}]}
JSON

mtn --path .tasks agent describe task-01-01.md --input - --json <<'JSON'
{"descriptionFile":"specification.md"}
JSON

# adopt:true explicitly adds an evidence boundary after an existing plain body.
# Append only commands and outcomes that were actually observed.
mtn --path .tasks agent note task-01-01.md --input - --json <<'JSON'
{"category":"build","author":"builder","contentFile":"verification.md","retryKey":"example-build-1","adopt":true}
JSON
```

Evidence remains readable Markdown in the task. Build, review, and fix history
can be retrieved by a fresh process without sidecar result files. Identical note
retries are no-ops; conflicting reuse fails. Attribution is caller-supplied, not
authenticated. Review approval is evidence, not automatic task completion.

### Hierarchy and activity-specific readiness

`project-add`, `project-remove`, and `project-replace` operate on native mapped
`projects` links. A task can parent other tasks, and multiple memberships remain
supported. Membership does **not** create prerequisites. Progress counts unique
leaf tasks by configured base completion, excludes archived branches by default,
and never automatically completes a parent.

```bash
# The phase parent must already exist.
mtn --path .tasks agent project-add task-01-01.md --input - --json <<'JSON'
{"target":"phases/phase-01.md"}
JSON

mtn --path .tasks agent hierarchy phases/phase-01.md --json

# Requires an explicit runnable-status policy for the requested activity.
mtn --path .tasks agent ready phases/phase-01.md --input - --json <<'JSON'
{"activity":"build"}
JSON
```

Configure optional activity policy in the task type's `x-mtn-agent-policy`
extension. For example:

```yaml
x-mtn-agent-policy:
  activities:
    build: [open, in-progress, changes-requested]
    review: [awaiting-review]
```

These status values must already exist in the authoritative TaskNotes
configuration/schema; mtn does not add them automatically. Without an activity
policy, ready queries expose dependency readiness only, not builder/reviewer
eligibility. Native dependency blocking, persisted workflow status, and derived
agent eligibility are separate results. Missing or ambiguous prerequisites fail
closed for agent readiness. Relationship types and gaps are preserved, not
interpreted as a scheduling engine. Ready results are snapshots, not task claims.

### Preview and apply a reference-safe move

```bash
mtn --path .tasks agent move-plan task-01-01.md --input - --json <<'JSON'
{"to":"completed/task-01-01.md"}
JSON
```

Save the returned **`result` object** as the `plan` property of an apply request:

```text
{"plan": <the complete result object returned by move-plan>}
```

Then apply it:

```bash
mtn --path .tasks agent move-apply task-01-01.md --input apply-move.json --json
```

Moves update supported native project/parent/dependency and Markdown references
without reassigning membership, title, or status. Known reference-format limits
are included in the preview; accepting them explicitly reports incomplete repair
rather than claiming full coverage. Source/reference edits after preview and
occupied or unsafe destinations are rejected.

A multi-file move is **not transactionally atomic**. Apply requires excluded
`.mtn-recovery` storage, retains before copies and a journal, and reports recovery
steps after a partial failure. Do not blindly retry or discard recovery data.

### JSON output and safety

Automation success uses `{"version":1,"ok":true,"result":...}`; failures use
`{"version":1,"ok":false,"error":{"code":...,"message":...}}` and exit nonzero.
JSON mode emits only JSON on stdout. Mutations enforce declared constraints,
preserve unrelated observed content, and use safe single-file publication.
Fresh reads and supported revision checks are not strict cross-application
compare-and-swap or exclusive ownership guarantees.

See [agent command contracts and capability limits](docs/agent-capabilities.md)
and [verification results and remaining checks](docs/agent-verification.md) for
schema permissions, status/dependency policies, supported references, recovery,
and the known dependency audit advisory.

## Natural language parsing

Task text is parsed using [tasknotes-nlp-core](https://github.com/callumalpass/tasknotes-nlp-core). Supported patterns:

- **Dates** — `tomorrow`, `friday`, `next week`, `2026-03-15`
- **Tags** — `#shopping`, `#work`
- **Contexts** — `@home`, `@office`
- **Projects** — `+quarterly-review`
- **Priority** — `high priority`, `urgent`
- **Recurrence** — `every day`, `weekly`, `every monday`
- **Estimates** — `~30m`, `~2h`

The parser reads status and priority values from your collection's
`_types/task.md`, so customizing the type definition changes what the parser
accepts. In v0.3, the type file declares that it `implements` the exact
`tasknotes.task` contract version. Its field map says how collection-specific
frontmatter becomes the portable TaskNotes task view, while its contract
binding holds TaskNotes behavior such as completed status values. Multiple
types can implement the same contract without requiring applications to know
their stored field names.

## Collection path

Resolved in order:

1. `--path` / `-p` flag
2. `MDBASE_TASKNOTES_PATH` environment variable
3. `collectionPath` in `~/.config/mdbase-tasknotes/config.json`
4. Current working directory

## Using with TaskNotes

If you use the [TaskNotes](https://github.com/callumalpass/tasknotes) Obsidian
plugin with mdbase export enabled, point `mtn` at the vault root. Both tools read
the same `mdbase.yaml`, task type, and Markdown records. Migrate copied data
first with the mdbase CLI; do not partially rewrite a live collection by hand.

`mtn` is a task-domain client, not a general saved-view executor. It reads
canonical `type: view` files as ordinary collection records through the shared
core but does not advertise `view_records`; use `mdbase view run` for portable
named-view execution.

## Creating Tasks With Custom Paths

The v0.3 `match.path_glob` and `collection.path.pattern` settings do
different jobs in `_types/task.md`:

- `match.path_glob` tells mdbase which existing files should be
  treated as tasks.
- `collection.path.pattern` tells `mtn create` where to write a new task file.

If your task type only has `match.path_glob`, listing existing tasks can work,
but creating a new task without an explicit path cannot choose a filename. Add
`collection.path.pattern` for creation:

```yaml
kind: mdbase.type
name: task
version: 1
schema:
  dialect: json-schema-2020-12
  value:
    type: object
    properties:
      title:
        type: string
match:
  path_glob: "calendar/**/*.md"
collection:
  path:
    pattern: "calendar/{{year}}/{{month}}-{{monthNameShort}}/{{titleKebab}}.md"
```

## Development

With [Nix](https://nixos.org/download/) installed and flakes enabled, enter the
Linux/macOS development shell (Node.js 22 with npm, Task, and Bash):

```bash
nix develop
task install
task check
```

`flake.lock` pins the Nix package/build inputs and development tools;
`package-lock.json` pins npm dependencies.
The shell does not install npm dependencies automatically. Without Nix, install
Node.js 22 and [Task](https://taskfile.dev/), then use the same tasks.

Run `task` to list available commands:

| Task | Description |
|---|---|
| `task install` | Install dependencies with `npm ci` |
| `task build` | Build the CLI into `dist/` |
| `task dev` | Watch source files and rebuild |
| `task start -- --help` | Build and run the CLI with arguments |
| `task test` | Build and run the test suite |
| `task test:tz-parity` | Check behavior across time zones |
| `task test:package` | Smoke-test the npm package |
| `task check` | Run all three test tasks sequentially |

To update the Nix toolchain pin, run `nix flake update` and commit `flake.lock`.

## License

MIT
