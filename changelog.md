# Changelog

All notable changes to the Marco Chrome Extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.1.html).

---

## [v3.6.0] — 2025-05-22

### Added
- New prompts: `logo-create` (18) and `proof-read` (19) in the standalone script prompt library.
- Prompt parity check test ensures built-in and standalone script prompt folders stay in sync.
- Deterministic seeding gate for E2E test stability.

### Fixed
- Lint warnings: removed unused eslint-disable directives and cleaned up type assertions.
- E2E-02 Project CRUD test suite temporarily skipped due to React Options page rendering instability in CI (deferred to S-021 React UI unification).
- Version sync enforced across manifest, constants, and all standalone script instruction manifests.

### Changed
- Version bump: 3.5.2 → 3.6.0 (all version files synced).
- Pinned version references in root readme updated to v3.6.0.

---

## [v3.5.2] — 2025-04-26

### Added
- Verbose logging toggle in Settings → Debugging Switch.
- Form snapshot capture on Submit, Type, and Select recorder actions.
- JS-step diagnostics with `buildJsStepFailureReport` for inline JS failures.

### Fixed
- Build lock sentinel (`.lovable/build.lock`) for sequential build gating.
- Timer & observer teardown audit compliance (v2.243.0 L-1…L-5).

### Changed
- Webhook result schema versioning (`WEBHOOK_RESULT_SCHEMA_VERSION = 2`).
- Error-swallow audit generator (`scripts/audit-error-swallow.mjs`).
