# Phase 7: Dependencies, readiness, and activity eligibility

## PRD Reference

Covers stories #13-20, #42 from prd-agent-task-workflows.md.
Implements dependencies, reverse lookup, activity policy, and full-context reasons.

## Tasks

- [x] Translate depends-on input to native mapped blockedBy objects with default FINISHTOSTART; support identity-idempotent add/remove and explicit replacement while preserving existing reltype/gap values.
- [x] Reject self-links and new multi-hop cycles through dedicated and generic mutations; diagnose existing cycles and missing/ambiguous targets without writing reverse or alias dependency fields.
- [x] Derive blocking and dependency readiness from included task graphs using configured base-task completion semantics, custom statuses, and separate native missing-target policy.
- [x] Add scoped ready/blocked queries with native blocked state, workflow status, safe agent eligibility, snapshot context, and reason codes for incomplete/missing/ambiguous/cyclic prerequisites, archive/completion, workflow waits, and external blockers.
- [x] Define inspectable activity-specific runnable-status policy without English-name inference; distinguish no-policy dependency readiness from builder/reviewer eligibility and retain status when prerequisite blocking changes.
- [x] Test chains/diamonds/branches, multiple link formats, cycles and downstream blocking, missing-target policies, completion/reopening without dependent rewrites, recurring occurrences, custom mappings, archived scopes, manual blockers, and generic-write parity; run tests/type checking.

## Verification

- RED: four initial dependency/eligibility tests failed before implementation.
- GREEN: `npm test` passed 1,075 tests; `npx tsc --noEmit` passed.
- Covers chains/diamonds, reverse edges, completion/reopening without rewrites, cycle/generic parity, duplicates, missing/ambiguous refs, permissive native missing policy, mapped dependencies/custom completion, recurring base status, and activity/external-blocker distinctions.
- Core patch mtn.3 exposes supported snapshot resolution APIs; spec sections 9.11/10.2 consulted for dependency defaults.
- Direct review only; independent agent review unavailable outside Herdr.

## Notes

Depends on phase 6. No scheduling engine, persisted execution order, atomic claim, or auto-status changes. Unresolved prerequisites always fail closed for agent eligibility even if native blocked is false. Commit after verification.
