# Phase 6: Native project hierarchy and deduplicated leaf progress

## PRD Reference

Covers stories #7-12 from prd-agent-task-workflows.md.
Implements hierarchy and enriches full-context retrieval.

## Tasks

- [x] Add exact native mapped projects membership add/remove and explicit identified-link replacement, preserving multiple unrelated memberships and compatible non-task projects.
- [x] Resolve task parents via projects only; implement direct children and transitive descendants with identity deduplication, collection exclusions, hierarchy-cycle diagnostics, and no persisted ancestor links.
- [x] Compute completed leaf-task progress using configured base-task completed statuses; report parent status separately, recurring tasks once, and empty scope as zero/zero with no percentage.
- [x] Exclude archived records and traversal through archived branches by default with explicit inclusion support; preserve shared descendants reachable through other included branches and report scope policy.
- [x] Test mapped fields, multi-membership diamonds, non-task records, parent versus grandparent, cycles, empty scopes, archived branches, cancellation/recurrence, generic-write parity, and PRD-link preservation; run tests/type checking.

## Verification

- RED: all three initial hierarchy regressions failed before implementation.
- GREEN: `npm test` passed 1,070 tests; `npx tsc --noEmit` passed.
- Four graph/edit tests cover mapped projects, explicit replacement, multiple memberships, non-task projects, diamonds, archived branches, cycles, empty scope, and recurring base-status leaf counting.
- Direct review only; independent agent review unavailable outside Herdr.

## Notes

Depends on phase 5. Hierarchy never implies sequencing, automatic parent completion, file relocation, single-parent rules, or inherited tags. Commit after verification.
