# Phase 9: End-to-end workflows, interoperability, and release verification

## PRD Reference

Validates all stories #1-42 and delivery priorities 1-3 from prd-agent-task-workflows.md.
Integrates identity/mutation, hierarchy, dependencies, content, relocation, and automation output.

## Tasks

- [x] Add representative fixed-inbox and standalone-project CLI workflows covering literal/idempotent planning, hierarchy, dependency ordering, build-review-fix evidence, completion/reopening, fresh-process resumption, and relocation without bespoke task/result databases.
- [x] Complete legacy/current and default/custom-mapped contract fixtures, strict-schema typed mutation checks, interleaved CLI/external-editor preservation tests, and every agent-facing JSON success/failure contract.
- [x] Verify copied TaskNotes round-trip fixtures for creation, status, hierarchy, dependencies, and content; separately record any manual plugin checks and explicitly identify unperformed checks.
- [x] Document command contracts, evidence/retry conventions, fixed-inbox setup, configuration authority, supported capability matrix, recovery procedures, concurrency/snapshot limits, and deferred/out-of-scope behavior.
- [x] Run and record full npm test, TypeScript checking, timezone parity, package smoke, and available Taskfile quality gates; reconcile all acceptance criteria and progress, then commit the verified release phase.

## Verification

- `task check` passed the complete sequential test, timezone, and isolated-package gates.
- `npm test`: 1,087 passing tests, zero failures/skips. `npx tsc --noEmit` and `git diff --check` passed.
- Both fixed-inbox and custom-mapped timestamp workflows cover native planning, hierarchy, dependencies, build/review/fix/approval, fresh-process resumption, completion/reopening, and moves without bespoke task/result files.
- Four-zone lifecycle regressions include Tokyo date-shift protection; actual separately interleaved editor and core conflict tests preserve observed edits.
- Isolated artifact smoke exposed and fixed vendor-path-dependent installation; the patched core is now bundled. Core mtn.7 preserves exact literal body termination; regeneration is byte-reproducible.
- Coverage and known limits are recorded in docs/agent-verification.md. Manual Obsidian UI checks were not performed; automated pinned model/contract round-trips passed. Independent agent review was unavailable outside Herdr.
- Compatible fast-uri/js-yaml updates applied. The inherited Zod/model audit advisory remains with no compatible fix; this is not production security sign-off or deployment approval.

## Notes

Depends on phases 1-8. Never test migrations against a live vault. Automated contract validation is not a manual Obsidian UI check. Do not mark unsupported required lifecycle primitives, unexecuted verification, or failed tests as complete. No release deployment or production migration is authorized.
