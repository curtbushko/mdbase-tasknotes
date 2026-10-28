# Phase 8: Explicit task relocation and failure recovery

## PRD Reference

Covers stories #35, #39 from prd-agent-task-workflows.md.
Implements task relocation via supported core reference APIs.

## Tasks

- [x] Add exact single-task move dry-run reporting source/destination, affected records, reference changes, warnings, capability limits, and inspectable plan/snapshot information without writes.
- [x] Apply supported reference-safe moves for mapped projects/parent links, nested blockedBy.uid, and recognized Markdown links, preserving aliases, anchors, relative meaning, and unrelated code/URLs/content.
- [x] Reject collisions, traversal/symlink escapes, outside-collection mutation, stale source/reference edits, and unsupported required reference repairs unless the documented limitation is explicitly accepted.
- [x] Implement supported rollback or excluded durable recovery journal with partial-progress/recovery reporting and safe interrupted retries; do not claim multi-file atomicity or discard recovery data.
- [x] Test dry-run no changes, mapped relationships, aliases/anchors/relative links, untouched text/code/URLs, stale edits, unsafe paths, injected mid-move failure/recovery, and excluded recovery copies; run tests/type checking.

## Verification

- RED: all three initial relocation regression tests failed before implementation.
- GREEN: `npm test` passed 1,079 tests; `npx tsc --noEmit` passed.
- Four tests cover read-only preview, current/mapped nested links, outgoing relative links, aliases/anchors/code/URLs, null and identity preservation, stale/colliding/unsafe paths, explicit unsupported-form acceptance, idempotent completion, and injected partial-failure recovery/refused retry.
- Required dependency work is reproducibly vendored in mdbase mtn.6 rather than relying on the original incomplete rename/reference implementation.
- Direct review only; independent agent review unavailable outside Herdr.

## Notes

Depends on phase 7. Moves do not imply membership, title, status, identity metadata changes, or recursive descendant relocation. If pinned APIs lack required safe primitives, implement explicit dependency work rather than unsafe global replacement. Commit after verification.
