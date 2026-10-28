# Phase 4: Markdown specifications, evidence, and resumable context

## PRD Reference

Covers stories #12, #21-27 from prd-agent-task-workflows.md.
Implements task content and structured retrieval.

## Tasks

- [x] Define and document an ordinary-Markdown description/evidence boundary with explicit opt-in handling of existing human bodies, without destructive implicit restructuring.
- [x] Add exact full-context retrieval returning native fields, description, structured evidence, exact reference, and hierarchy/dependency context as those modules become available.
- [x] Add file/stdin description replacement and evidence append that preserve unrelated body content and each other's sections using fresh reads.
- [x] Support evidence timestamp, caller attribution, category (build/review/fix/other), and optional retry key with identical no-ops and conflicting reuse rejection; keep Markdown authoritative.
- [x] Test headings/code fences/Unicode, human bodies, conflicting inputs, strict-schema retry limitations, description/evidence preservation, and build-review-fix-approval retrieval from a fresh process; run tests/type checking.

## Verification

- RED: all three new content regression tests failed before implementation.
- GREEN: `npm test` passed 1,062 tests; `npx tsc --noEmit` passed.
- Fresh-process build/review/fix/approval retrieval, Unicode/code fences, opt-in body adoption, retry conflicts, and description/evidence preservation covered.
- Hierarchy/dependency context is currently in native fields; phases 6/7 enrich derived results.
- Direct review only; independent agent review unavailable outside Herdr.

## Notes

Depends on phase 3. Attribution is not authenticated. PRD/story links are ordinary content, not mandatory metadata. Ready does not mean approved. Commit after verification.
