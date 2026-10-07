# Hermes Remote Web OSS

- Unofficial derivative of stasstepv/hermes-pwa at the fixed commit in upstream.lock.json.
- Preserve original MIT/Nous attribution and dependency-specific licenses. This
  derivative includes licensed shared code and is not clean-room.
- Entry: packages/web/src/remote/RemoteApp.tsx. One controller/adapter:
  packages/core/src/stores/remote.ts. Preserve React-free Core/Shell separation.
- Read compatibility.json, docs/OSS_INSTALL.md, docs/SECURITY.md and CONTRIBUTING.md.
- Node 24.18.0, npm ci --ignore-scripts --no-audit --no-fund, unchanged lockfile.
- Gates: typecheck, lint, full Vitest, test:oss, build, verify:pwa, verify:pack,
  WebKit/Chromium fixtures, hash-locked backend regression where touched.
- Maintain R01–R22: memory default; explicitly opted-in encrypted storage/own worker,
  notification/speech/navigation; no added credential storage or automatic sends.
- Never treat fixture/WebKit success as physical iPhone/provider acceptance.
- Preserve typed server IDs, fresh ticket, native auth, Origin/TLS, replay/epoch,
  unknown writes and exclusive-submit/Web Locks. No automatic retry of writes.
- Static operator defaults to dry-run, operates one explicit root under flock,
  retains actual old files and both clients' hashes, and never restarts a service.
- Backend activation, paid generation, production changes and external publishing
  require the user's authority. A checked patch or capability is not that authority.
- Do not read CLI credential files, expose secrets, use curl|sh/@latest, force-push,
  reset/clean/stash shared work, or overwrite another release/dirty checkout.
- Use scoped branches, sanitized DEMO evidence and DCO sign-off. Public comments
  and contribution documents should be English; existing Japanese UX is intentional.
