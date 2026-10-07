# Contributing

This is a licensed derivative, **not a clean-room implementation**.
Retain copyright/notices, upstream URLs/commits/file hashes and modification
provenance. Do not copy proprietary, unlicensed or rights-unknown material.

Keep the React-free Core/Shell boundary and one controller/adapter.
No scattered fetch/WebSocket/RPC in UI. Preserve typed IDs, owner/profile/durable/
live/lineage/socket distinctions, authoritative replay and unknown-write handling.
Do not auto-retry writes, bypass capabilities or weaken TLS/Origin.

Default device content remains in memory; consent is explicit. No analytics,
service mutation, credential exploration or paid generation is part of tests.
Fixtures cannot enter production transport. CLI credentials must not be read
through a resolver in tests.

Use Node24.18.0 and the fixed lockfile with npm ci --ignore-scripts.
Run typecheck, lint, full Vitest, build, verify:pwa/verify:pack plus meaningful
Chromium/WebKit, update/rollback and privacy regressions.
Do not remove failing tests, relax verifiers or broaden skips to pass.

Use dedicated branches, preserve shared work, and sign off commits with the DCO.
Describe the resulting behavior, scope, tests and unverified cases.
Refresh current file hashes in `SOURCE_PROVENANCE.json` and `SOURCE_SHA256SUMS`
when changing public source; retain original source hashes and notices. CI checks
the checksum inventory with `sha256sum --check SOURCE_SHA256SUMS`.
AI-assisted contributions are welcome; contributors remain responsible for
provenance, review and correctness.

Code, CI, deployment, provider, device and consent are separate evidence.
Source-only iOS is not a Swift compile or physical-device PASS.
Bug reports include build/backend/browser/OS and sanitized steps, not private logs.
Vulnerabilities use [SECURITY.md](SECURITY.md). See [roadmap](docs/OSS_ROADMAP.md).
