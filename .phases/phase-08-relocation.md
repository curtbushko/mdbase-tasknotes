# Phase 8: Explicit task relocation and failure recovery

## PRD Reference

Covers stories #35, #39 from prd-agent-task-workflows.md.
Implements task relocation via supported core reference APIs.

## Tasks

- [ ] Add exact single-task move dry-run reporting source/destination, affected records, reference changes, warnings, capability limits, and inspectable plan/snapshot information without writes.
- [ ] Apply supported reference-safe moves for mapped projects/parent links, nested blockedBy.uid, and recognized Markdown links, preserving aliases, anchors, relative meaning, and unrelated code/URLs/content.
- [ ] Reject collisions, traversal/symlink escapes, outside-collection mutation, stale source/reference edits, and unsupported required reference repairs unless the documented limitation is explicitly accepted.
- [ ] Implement supported rollback or excluded durable recovery journal with partial-progress/recovery reporting and safe interrupted retries; do not claim multi-file atomicity or discard recovery data.
- [ ] Test dry-run no changes, mapped relationships, aliases/anchors/relative links, untouched text/code/URLs, stale edits, unsafe paths, injected mid-move failure/recovery, and excluded recovery copies; run tests/type checking.

## Notes

Depends on phase 7. Moves do not imply membership, title, status, identity metadata changes, or recursive descendant relocation. If pinned APIs lack required safe primitives, implement explicit dependency work rather than unsafe global replacement. Commit after verification.
