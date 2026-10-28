# Phase 6: Native project hierarchy and deduplicated leaf progress

## PRD Reference

Covers stories #7-12 from prd-agent-task-workflows.md.
Implements hierarchy and enriches full-context retrieval.

## Tasks

- [ ] Add exact native mapped projects membership add/remove and explicit identified-link replacement, preserving multiple unrelated memberships and compatible non-task projects.
- [ ] Resolve task parents via projects only; implement direct children and transitive descendants with identity deduplication, collection exclusions, hierarchy-cycle diagnostics, and no persisted ancestor links.
- [ ] Compute completed leaf-task progress using configured base-task completed statuses; report parent status separately, recurring tasks once, and empty scope as zero/zero with no percentage.
- [ ] Exclude archived records and traversal through archived branches by default with explicit inclusion support; preserve shared descendants reachable through other included branches and report scope policy.
- [ ] Test mapped fields, multi-membership diamonds, non-task records, parent versus grandparent, cycles, empty scopes, archived branches, cancellation/recurrence, generic-write parity, and PRD-link preservation; run tests/type checking.

## Notes

Depends on phase 5. Hierarchy never implies sequencing, automatic parent completion, file relocation, single-parent rules, or inherited tags. Commit after verification.
