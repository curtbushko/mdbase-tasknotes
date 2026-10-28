# Phase 3: Literal creation, naming, and idempotent retries

## PRD Reference

Covers stories #1-4, #6, #33-34 from prd-agent-task-workflows.md.
Implements literal creation, identity allocation, and retry identity.

## Tasks

- [ ] Add explicit literal/structured creation with mapped schema-validated fields, preserving URLs, hashtags, date-like titles, Unicode, and nested values without NLP.
- [ ] Support description input from file/stdin with conflict rejection and exact-reference machine-readable creation results.
- [ ] Honor explicit paths, supported legacy/current schema-derived naming, frontmatter titles, fixed inboxes, and bounded documented collision allocation without overwriting notes or silently changing conventions.
- [ ] Implement opt-in creation retry identities with same-intent no-ops and conflicting reuse errors using inspectable schema-permitted or supported identity facilities; add dependency capability work if necessary for the representative lifecycle.
- [ ] Test shell-sensitive/multiline input, duplicate titles, same-second collisions, occupied/unsafe paths, unsupported runtime values, strict schemas, retry conflicts, and unchanged NLP capture; run tests/type checking.

## Notes

Depends on phase 2. Do not invent KB project-folder routing, add mandatory agent fields, or treat universal unsupported errors as completed idempotency implementation. Commit after verification.
