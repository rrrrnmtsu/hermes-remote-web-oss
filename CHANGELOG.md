# Changelog

## Unreleased

- Read-only messaging Gateway overview with explicit profile-scoped refresh and
  bounded, sanitized platform status; no bot send/config/process actions.
- Explicit owned conversation pages in the bot panel: 50 rows per page, at most
  four manual pages, selected registered project and loaded-title/bot filters.
  Existing source evidence is joined by exact owned ID; missing/conflicting/older
  evidence is not presented as complete history or verified bot delivery.
- Close/scope/auth changes discard memory queries/pages and local pending reads.
  Existing draft/run/unknown-write guards, settings, dependencies, backend contracts
  and opt-in behavior are retained. Provider/device/live-bot acceptance is separate.

## 2.0.0-preview.2

- Quick navigation from the sidebar, Settings or Command/Control+K, using nine
  existing destinations/read panels and bounded Japanese/English keyword search.
- Composer selection, draft and reading position survive cancellation. IME and
  other modals retain keyboard ownership; auth/scope changes discard the query.
- The palette performs no send/approval/stop/profile/model write, automatic save
  or device consent. Existing capability/scoped adapters and R01–R22 remain.
- Public source checksum verification is included in CI; provenance retains the
  original source hashes and records subsequent modifications.
- Release/package versions advance together. Dependency resolution, runtime
  libraries, authentication and backend contracts are unchanged.
- The standalone update/rollback harness creates its own evidence directory on a
  fresh checkout, without relying on a previously run browser suite.

This is still Developer Preview. Paid provider generation, physical iPhone,
Safari/Home Screen, accepted-running lock recovery and opt-in device features
have separate acceptance gates. Source/Gateway/browser fixtures do not establish
those outcomes. See the compatibility manifest and roadmap before installing.

## 2.0.0-preview.1

- Initial reviewed public source-only snapshot, retaining the licensed R01–R22
  derivative without private Git history or operations evidence.
- Same-origin setup guidance, allowlisted diagnostics and portable static
  prepare/activation/rollback tools with explicit dry-run/apply boundaries.
- Fixed compatibility, dependency/license provenance, reproducible source/static
  packages and independent synthetic-browser/Gateway qualification.
