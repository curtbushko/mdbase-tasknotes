# Phase 3: Literal creation, naming, and idempotent retries

## PRD Reference

Covers stories #1-4, #6, #33-34 from prd-agent-task-workflows.md.
Implements literal creation, identity allocation, and retry identity.

## Tasks

- [x] Add explicit literal/structured creation with mapped schema-validated fields, preserving URLs, hashtags, date-like titles, Unicode, and nested values without NLP.
- [x] Support description input from file/stdin with conflict rejection and exact-reference machine-readable creation results.
- [x] Honor explicit paths, supported legacy/current schema-derived naming, frontmatter titles, fixed inboxes, and bounded documented collision allocation without overwriting notes or silently changing conventions.
- [x] Implement opt-in creation retry identities with same-intent no-ops and conflicting reuse errors using inspectable schema-permitted or supported identity facilities; add dependency capability work if necessary for the representative lifecycle.
- [x] Test shell-sensitive/multiline input, duplicate titles, same-second collisions, occupied/unsafe paths, unsupported runtime values, strict schemas, retry conflicts, and unchanged NLP capture; run tests/type checking.

## Verification

- RED: five new creation tests failed before implementation.
- GREEN: `npm test` passed 1,059 tests; `npx tsc --noEmit` passed.
- Includes ten occupied timestamp names, exact-path refusal, strict-schema retry diagnostics, multiline round-trip, and matching/conflicting retries.
- Direct review only; independent agent review unavailable outside Herdr.

## Notes

Depends on phase 2. Do not invent KB project-folder routing, add mandatory agent fields, or treat universal unsupported errors as completed idempotency implementation. Commit after verification.
