# Security policy

This unofficial remote client is not a substitute for server authentication,
authorization, tool policy or sandbox.

## Private reporting

Use **Report a vulnerability** on
[the public repository's Security/Advisories page](https://github.com/rrrrnmtsu/hermes-remote-web-oss/security/advisories).
Do not post credentials, exploit details, real transcripts or private URLs in a
public issue. The upstream client's personal inbox does not maintain this project.

Provide affected Release/build, browser/OS, sanitized reproduction, expected and
observed behavior, and impact. Response is best-effort; no response-time guarantee
is promised.

## Scope and supported builds

Auth/tickets/Origin, owner/profile/session separation, replay/request IDs, unknown
delivery, updates, authorized file reads, untrusted content, storage and the opt-in
worker are in scope. Supported contracts are in [compatibility.json](compatibility.json).
Unsupported servers fail closed for writes. Device/provider acceptance is separate.

Report Hermes/provider vulnerabilities through their official channels too.
No production, paid generation or business-write test is authorized by this policy.
See [privacy](docs/SECURITY.md) and [roadmap](docs/OSS_ROADMAP.md).
Suspected credentials need owner-controlled revocation before disclosure.
Scanners redact values and do not test credential validity against providers.

## Development toolchain advisory boundary

The initial preview upgrades and pins Vite 6.4.3, Vitest/coverage 3.2.6 and
tinypool 2.1.2, plus compatible transitive security updates. Browser runtime
resolutions are unchanged. The publication-time npm runtime audit reports zero;
the full dev audit has **0 critical, 9 high and 3 moderate** entries. Several
entries propagate the same unfixed braces issue; the other family is Vitest
redirect mocking. This is not a zero-advisory or stable release claim.

Build/test only reviewed source with bounded/trusted file patterns in an isolated
checkout. Do not expose a Vitest API/UI, accept remote mock module paths, parse
untrusted glob patterns or bind a development server as the production route.
Production distributes static files, not test/dev servers. See
[DEV_TOOLCHAIN.json](docs/DEV_TOOLCHAIN.json) for exact pins/lock identity.
Remaining development advisories are a tracked beta gate; review current
[Vitest advisories](https://github.com/vitest-dev/vitest/security/advisories) and
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) before
changing that boundary. Never run npm audit fix --force as an unreviewed repair.
