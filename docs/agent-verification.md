# Agent workflow verification

Scope: local implementation verification, not publication, production migration,
or owner sign-off. All integration data is in temporary/copied fixtures, never a
live vault. Runtime tested: Node 22.23.4; build target: Node 20.

## Coverage

| PRD stories | Automated evidence |
| --- | --- |
| 1-6 | agent-creation / agent-mutations: literal and typed creation, file/stdin bodies, exact identity, ambiguous/missing refusal, inspectable same/conflicting retries |
| 7-12 | agent-hierarchy / agent-workflow: native mapped project membership, non-task projects, direct/transitive distinction, duplicate memberships, archived branches, leaf progress, PRD references |
| 13-20 | agent-dependencies / agent-lifecycle: chains/diamonds, reverse edges, additive edits, cycles, duplicates, missing/ambiguous targets, custom completed values, reopening, recurring base status |
| 21-27 | agent-content / agent-workflow: full fresh-process context, description/evidence separation, readable notes, build/review/fix/approval history, retries, resumption without bespoke task/result artifacts |
| 28-31 | agent-mutations / agent-interleaving / core-atomic-write: nested values, permitted nulls, unset/required/schema checks, mappings, observed edits, actual separate-process editor interleaving, conflict diagnostics, JSON/nonzero exits |
| 32 | Existing core-flow, recurrence, filename-title, mapping, timer, initialization, matching, and conformance tests; isolated package smoke includes legacy NLP capture/list |
| 33-34 | agent-creation / agent-workflow: literal/frontmatter-title and timestamp profiles, bounded same-second allocation, concurrent no-clobber race, occupied paths, unsupported projectFolder diagnostics |
| 35, 39 | agent-relocation: no-write preview, current/mapped/nested/body references, aliases/anchors/relative meaning, code/URL preservation, stale/occupied/unsafe refusal, explicit limitations, injected failure, retained recovery and safe retries |
| 36 | agent-lifecycle: shared dedicated/generic status planner, historical dates, no-op stability, reopening metadata, recurring history; four-zone lifecycle checks |
| 37-38 | diagnostics: exclusions and recovery copies, flag/env/global/cwd precedence, missing config/schema, read-only reports, safe init preserving owner configuration/schema; exact unsupported contract diagnostics |
| 40 | Common semantic mutation hooks: generic status/hierarchy/dependency changes cannot bypass lifecycle, cycles, identity, derived-field, required-field, or schema checks |
| 41-42 | agent-lifecycle / agent-dependencies / agent-workflow: configured native workflow states, activity-specific eligibility, review waits, external blocker notes, missing explanations on human edits, native versus safe readiness |

Every responsibility module has public CLI/persisted-record tests. Most of the
suite's test count comes from the existing conformance suite; the new tests add
behavioral coverage rather than claiming thousands of new independent scenarios.

## Representative workflows

Both fixed-inbox and standalone custom-mapped timestamp fixtures execute:

1. Create project/phase/implementation records with native memberships and PRD text.
2. Create prerequisites through dependsOn and retry creation without duplicating it.
3. Select build/review work through configured status policies.
4. Preserve a human edit, record build evidence, request changes, fix, and approve.
5. Resume in fresh processes; approval remains evidence until explicit completion.
6. Release dependent work through configured base completion.
7. Move a task with reference repair; retry its original creation identity.
8. Reopen to re-block dependents, complete the phase, and derive leaf progress
   without auto-completing parent status.

The pinned TaskNotes model parses CLI-created records and observes the same status,
projects, dependencies, and Markdown body. The CLI observes simulated native/editor
changes. Legacy 0.2.1 mapped-field fixtures also create, complete, and reopen tasks.
These are automated model/contract round-trips, not manual Obsidian UI checks.

## Verification results

| Gate | Result |
| --- | --- |
| `npm test` | PASS: 1,087 tests, zero failures/skips |
| `npx tsc --noEmit` | PASS |
| `npm run test:tz-parity` | PASS: core date parity and agent lifecycle parity in all four zones |
| `npm run test:package` | PASS: isolated artifact installation plus agent and legacy CLI workflows |
| `task check` | PASS: all test/timezone/package gates run sequentially |
| `git diff --check` | PASS |
| `npm audit` | Known inherited Zod/model advisory remains; two high-severity root dependency entries, not a clean audit |

Release hardening also fixed a timestamp-allocation/self-edge interaction, a
concurrent publication race, a Tokyo instance-date shift, exact non-final-newline
body preservation, and source-directory-dependent package installation. Each has
regression coverage. There is no configured lint command to claim as executed.

The local core archive regeneration produced identical SHA-256 on repeat:
`c99efcd27c2c55afc7ed7ba5cc29e7748796faf8c24a56948cb2b576a91b6c25`.
The original core archive plus reproducible patch/contribution sources are retained;
obsolete intermediate patch archives are removed from the current checkout.

## Known limits and remaining owner checks

- Manual Obsidian/TaskNotes UI integration checks were **not performed**. Before
  using a live vault, verify a copy in the intended plugin version, especially
  exported schema authority, optional status policy, and non-default missing-target
  policy. Do not infer UI compatibility solely from the model fixture tests.
- No independent agent review was available because this session ran outside Herdr.
  Reviews were direct source/diff inspection plus automated regression tests.
- `npm audit` still reports the inherited Zod advisory
  [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), through
  @tasknotes/model's Zod 3 dependency. There is no compatible fix on that dependency
  line; forcing a major Zod upgrade was not attempted. Oversized constrained input
  validation can exhaust memory. This is a known dependency risk, not a clean
  security-audit claim. Compatible fast-uri and both js-yaml lines were updated to
  their patched versions; the unresolved root audit entries are Zod/model.
- Activity eligibility requires explicit inspectable policy; dependency readiness
  alone is not builder/reviewer dispatch eligibility or an exclusive claim.
- Creation retry metadata needs schema permission. Evidence retry metadata lives
  in ordinary Markdown comments. Neither is an authenticated identity system.
- Read-before-write, core revisions/mtime checks, and atomic single-file publication
  are not strict cross-application CAS. Multi-file moves are not transactional;
  recovery is inspectable and intentionally refuses blind replay after failure.
- Advanced/reference-style Markdown forms are explicit move capability limits.
  Unsupported contract versions fail closed. No schemas are weakened to enable
  operations, and no KB-specific project routing or scheduling engine is added.
- Existing user-staged environment, PRD, README, Taskfile, and Nix changes are kept
  outside implementation commits. No release deployment or live-vault migration
  has been performed.
