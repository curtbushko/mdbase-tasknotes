# Phase 1: Compatibility baseline, collection diagnostics, and safe initialization

## PRD Reference

Covers stories #29, #32, #37-39 from prd-agent-task-workflows.md.
Implements automation diagnostics and establishes compatibility boundaries for all modules.

## Tasks

- [x] Characterize pinned mdbase/model versions, supported legacy/current contracts, public validation, path, lifecycle, reference, and safe-write APIs; publish a capability matrix and baseline test results.
- [x] Add read-only human/JSON collection diagnostics reporting root selection precedence, config/type locations, mappings, status semantics, exclusions, validation policy, versions, and operation capabilities.
- [x] Diagnose missing configuration/schema, unsupported runtime templates, and unsafe recovery/cache/temp inclusions without initializing or rewriting existing collections.
- [x] Make initialization non-destructive by default and ensure newly initialized collections exclude configured tooling/cache/temp/recovery locations; document explicit destructive consent and fixed-inbox configuration.
- [x] Add public CLI regression fixtures for root precedence, missing/legacy/current configuration, preserved custom schemas/settings, exclusions, and diagnostics no-write guarantees; run existing tests and type checking.

## Verification

- Baseline: `npm test` passed 1,041 tests.
- RED: six new diagnostic/configuration behaviors were tested before implementation (initial five tests failed as expected).
- GREEN: `npm test` passed 1,047 tests; `npx tsc --noEmit` passed.
- Review: direct diff/public API inspection; no independent reviewer available (subagents require Herdr).

## Notes

Use TDD. Inspect actual pinned APIs rather than assuming newer upstream features. Never weaken a live schema or test against the owner's vault. Existing user-staged README, Taskfile, Nix files, and PRD must remain outside implementation commits. Commit this phase only after verification; update checklist/index truthfully. Existing package scripts provide test, test:tz-parity, and test:package; do not assume a lint script exists. Phases 2-8 add capabilities to this matrix as implemented.
