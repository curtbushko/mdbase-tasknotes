# Phase 9: End-to-end workflows, interoperability, and release verification

## PRD Reference

Validates all stories #1-42 and delivery priorities 1-3 from prd-agent-task-workflows.md.
Integrates identity/mutation, hierarchy, dependencies, content, relocation, and automation output.

## Tasks

- [ ] Add representative fixed-inbox and standalone-project CLI workflows covering literal/idempotent planning, hierarchy, dependency ordering, build-review-fix evidence, completion/reopening, fresh-process resumption, and relocation without bespoke task/result databases.
- [ ] Complete legacy/current and default/custom-mapped contract fixtures, strict-schema typed mutation checks, interleaved CLI/external-editor preservation tests, and every agent-facing JSON success/failure contract.
- [ ] Verify copied TaskNotes round-trip fixtures for creation, status, hierarchy, dependencies, and content; separately record any manual plugin checks and explicitly identify unperformed checks.
- [ ] Document command contracts, evidence/retry conventions, fixed-inbox setup, configuration authority, supported capability matrix, recovery procedures, concurrency/snapshot limits, and deferred/out-of-scope behavior.
- [ ] Run and record full npm test, TypeScript checking, timezone parity, package smoke, and available Taskfile quality gates; reconcile all acceptance criteria and progress, then commit the verified release phase.

## Notes

Depends on phases 1-8. Never test migrations against a live vault. Automated contract validation is not a manual Obsidian UI check. Do not mark unsupported required lifecycle primitives, unexecuted verification, or failed tests as complete. No release deployment or production migration is authorized.
