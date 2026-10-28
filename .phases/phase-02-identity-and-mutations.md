# Phase 2: Exact identity, safe mutations, and versioned JSON results

## PRD Reference

Covers stories #5, #28-31, #40 from prd-agent-task-workflows.md.
Implements task identity/mutation and automation output foundations.

## Tasks

- [x] Define an explicit versioned automation CLI/output contract with exact collection-relative or supported stable references, no fuzzy fallback, structured errors, nonzero failure exits, and resource cleanup before exit.
- [x] Implement shared fresh-read, validate-before-write mutation handling using public safe-write/conflict facilities; preserve unrelated frontmatter and Markdown, enforce declared constraints even under warning policy, and document concurrency limits.
- [x] Implement typed set/unset/add/remove operations with explicit JSON values, nested lists/objects, required-field protection, schema-permitted custom fields, and read-only derived fields.
- [x] Route mapped projects, blockedBy, status, and lifecycle metadata through common invariant hooks; unsupported semantic writes fail closed until their later-phase handlers are available.
- [x] Test duplicate titles, absent/ambiguous identities, JSON-only stdout on every failure, cleanup/exit behavior, strict invalid-write no-change guarantees, mapping, prior external edits, and existing output compatibility; run tests/type checking.

## Verification

- RED: four initial agent CLI regressions failed before implementation.
- GREEN: `npm test` passed 1,054 tests; `npx tsc --noEmit` passed.
- Dependency work: reproducible vendored mdbase 0.3.0-rc.4-mtn.1 adds atomic record publication; failure-injection regressions pass.
- Review: direct diff and pinned public API inspection; independent agent review unavailable outside Herdr.

## Notes

Depends on phase 1. Later phases must complete graph/lifecycle hooks rather than bypass them. No hidden state store or exclusive-claim promise. Commit after all tasks pass verification.
