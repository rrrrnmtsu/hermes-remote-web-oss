# Privacy and security model

## Authentication and authority

The client reuses existing same-origin Hermes Dashboard authentication.
HTTPS/WSS, fresh single-use tickets and exact Host/Origin checks are required.
It adds no provider credentials, independent login or automatic provider fallback.
A capability advertises implementation/policy, not successful paid generation.
The server validates owner/profile/session and operation authority.

Approval/clarify replies preserve string/number IDs and socket generation.
Only presented once/deny approval choices are offered. Cancellation invalidates
its card. Stop acceptance is not completion. Unknown writes are never auto-replayed.

## Default device storage

The default is page-memory content. Plaintext display keys:
- `hermes-remote-web.settings.theme`
- `hermes-remote-web.settings.signed-out`
- `hermes-remote-web.settings.chat-font-size` (15/16/17)

No credential, ticket, transcript, draft, attachment bytes/name, search term or
conversation ID is written to plaintext browser storage.
Explicit Markdown/artifact download leaves content in a selected file.
Browser save requests do not prove OS completion or revoke existing copies.

## Explicit opt-in

- AES-GCM drafts: bounded, expiring, passphrase-unlocked; keys not persisted.
- Saved histories: bounded/expiring encrypted snapshots, not live authority.
- Separate connection metadata: HTTPS origins/labels only, no credential transfer.
- One own-scope worker: fixed build-hashed public shell allowlist only, never API/
  auth/WS/conversation responses. Update requires explicit safe activation.
- Notifications: consented owner/profile/session subscription, generic payload.
  Opening requires auth/sync; a notification cannot approve an operation.
- Device speech: explicit microphone/service use, review into draft and explicit
  reading. Recognition alone never sends.

Other apps' data/workers/caches remain. Logout hides content first, revokes current
keys/local app data and handles server logout separately. It can also affect a
Dashboard sharing the same authentication session.

## Diagnostics and evidence

No telemetry/automatic crash upload. Diagnostics are an allowlist of build/version/
stage/boolean capabilities, created only on explicit copy/save. Origin, identifiers,
names, payloads and raw error text are excluded.
Public media/fixtures are synthetic; private operations receipts are not exported.

Markdown, URLs, attachment names and tool output are untrusted. No raw HTML,
executable URLs or unsolicited remote image fetch. Selection never uploads.
Attachment turn submission requires server/provider policy; text-only fallback is
not silent. Pattern scans are not exhaustive secret-clearance guarantees.
