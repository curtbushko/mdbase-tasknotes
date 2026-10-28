# Phase 5: Shared lifecycle and typed status transitions

## PRD Reference

Covers stories #19-20, #36, #41 from prd-agent-task-workflows.md.
Implements shared task lifecycle semantics and configured workflow status.

## Tasks

- [ ] Centralize dedicated and typed generic status transitions through pinned TaskNotes/model semantics, mapped fields, validation, and explicit unsupported-capability diagnostics.
- [ ] Implement non-recurring completion/reopening with configured completed statuses, historical completion dates, preserved dateCreated, correct dateModified, contract-correct completion metadata, and no-op retry stability.
- [ ] Preserve recurring occurrence completion/skipping/reopening history and anchors separately from base-task completion; expose resulting native lifecycle fields.
- [ ] Support optional configured agent workflow statuses without schema extension or English-name inference; record explanatory notes for agent blocked convenience transitions and report missing explanations on compatible human edits.
- [ ] Test dedicated/generic parity, custom mappings/statuses, invalid transitions, cancellation/archive semantics, historical dates, retries, recurring/base distinctions, and local/UTC timezone parity; run tests/type checking.

## Notes

Depends on phase 4. Dependency eligibility will consume base status in phase 7. Review approval is evidence, not automatic completion. Commit after verification.
