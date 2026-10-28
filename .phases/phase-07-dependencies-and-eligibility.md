# Phase 7: Dependencies, readiness, and activity eligibility

## PRD Reference

Covers stories #13-20, #42 from prd-agent-task-workflows.md.
Implements dependencies, reverse lookup, activity policy, and full-context reasons.

## Tasks

- [ ] Translate depends-on input to native mapped blockedBy objects with default FINISHTOSTART; support identity-idempotent add/remove and explicit replacement while preserving existing reltype/gap values.
- [ ] Reject self-links and new multi-hop cycles through dedicated and generic mutations; diagnose existing cycles and missing/ambiguous targets without writing reverse or alias dependency fields.
- [ ] Derive blocking and dependency readiness from included task graphs using configured base-task completion semantics, custom statuses, and separate native missing-target policy.
- [ ] Add scoped ready/blocked queries with native blocked state, workflow status, safe agent eligibility, snapshot context, and reason codes for incomplete/missing/ambiguous/cyclic prerequisites, archive/completion, workflow waits, and external blockers.
- [ ] Define inspectable activity-specific runnable-status policy without English-name inference; distinguish no-policy dependency readiness from builder/reviewer eligibility and retain status when prerequisite blocking changes.
- [ ] Test chains/diamonds/branches, multiple link formats, cycles and downstream blocking, missing-target policies, completion/reopening without dependent rewrites, recurring occurrences, custom mappings, archived scopes, manual blockers, and generic-write parity; run tests/type checking.

## Notes

Depends on phase 6. No scheduling engine, persisted execution order, atomic claim, or auto-status changes. Unresolved prerequisites always fail closed for agent eligibility even if native blocked is false. Commit after verification.
