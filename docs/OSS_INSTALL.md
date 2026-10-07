# Install, verify, update and recover

This Developer Preview is for **one owner**, using an existing HTTPS Hermes
Dashboard origin. The fixed path is `/hermes-remote-web/`. A different path is not
qualified. Read [compatibility.json](../compatibility.json) before installing:
the full client currently requires the three fixed backend contract patches. This
guide installs static files only; it never applies a backend patch or restarts a
service. Stock/latest Hermes compatibility is not established.

## 1. Obtain and verify a release

Download the source and static archives plus `SHA256SUMS` from this repository's
[Releases](https://github.com/rrrrnmtsu/hermes-remote-web-oss/releases).
Check the publisher/release identity separately; checksums detect changed bytes,
not publisher authenticity. Run `sha256sum --check SHA256SUMS` in the download
directory. Extract the static archive into an empty owned directory. It contains
its own file inventory; run `sha256sum --check SHA256SUMS` there too.

To build instead, use Node 24.18.0 and the committed lockfile:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run lint
npm test -- --maxWorkers=1 --minWorkers=1
npm run test:oss
npm run build
npm run verify:pwa
npm run verify:pack
```

Do not run an old upstream plugin installer. Do not place source files, keys,
Python wheels, source maps or private evidence in the public static directory.
Only the generated `releases/<build-id>/` is a static payload.

## 2. Connect the existing static route

An administrator must configure an additional static path on **the existing
HTTPS origin** to resolve `/hermes-remote-web/` to a dedicated root's `current`
symlink. The examples below use `/srv/hermes-remote-web`. Keep Dashboard `/`,
API/auth/WSS, native cookie authentication, CSRF and Host/Origin/TLS checks.
No script here modifies a proxy, Tailscale, provider, service or existing route.
Do not publicly expose a server just to test this client.

Prefer `Cache-Control: no-cache` for mutable entrypoints (`index.html`,
`build.json`, `manifest.json`, `remote-worker.js`). Serve hash assets with their
correct MIME types and retain them across updates. The opt-in worker remains
limited to its own path and public allowlist. It never caches API/auth data.

## 3. Prepare, then atomically activate

The generic operator currently supports **Linux with `flock`**. The root must be
an explicit absolute real directory. Its current reference, if any, must already
be a symlink inside that root's `releases/`. A real directory, an external reference,
dangling symlink, altered checksum, filename collision or changed current is
refused. Migrate a different layout manually and review it before using the tool.
The initial installation has no old release to invent as a rollback.

```sh
# First run: plan only, no writes.
node scripts/oss/remote.mjs prepare \
  --release "$PWD/releases/REPLACE_WITH_BUILD_ID" --root /srv/hermes-remote-web

# Explicit preparation under an owned deployment flock.
node scripts/oss/remote.mjs prepare \
  --release "$PWD/releases/REPLACE_WITH_BUILD_ID" --root /srv/hermes-remote-web --apply
```

The JSON result identifies an immutable candidate receipt and its SHA-256. Record
both. Preparation does **not** activate it. It copies the actual old site into
`backup-site`, prepares a new `site` retaining old assets and a `rollback-site`
with the old entrypoints plus old/new assets. Existing comparison pages survive.
No old release or other application's cache is removed.

```sh
# Dry-run: insert the exact candidate path/hash returned above.
node scripts/oss/remote.mjs deploy \
  --candidate /srv/hermes-remote-web/deployments/REPLACE/candidate.json \
  --sha256 REPLACE_WITH_CANDIDATE_SHA256 --origin https://hermes.example

# Explicit static switch, hash/MIME verification over validated HTTPS.
node scripts/oss/remote.mjs deploy \
  --candidate /srv/hermes-remote-web/deployments/REPLACE/candidate.json \
  --sha256 REPLACE_WITH_CANDIDATE_SHA256 --origin https://hermes.example --apply
```

The supplied HTTPS origin must belong to **your** existing server. Do not use
credentials or tickets in arguments. Verification does not follow redirects and
never disables TLS validation. It binds every served static file to its hash;
unchanged legacy WebM may retain its already observed `audio/webm` MIME.
A verification failure restores the bound rollback site if the operator still
owns the current reference. That recovery is reported as a **failed deployment**
with static recovery, not successful new-build deployment. A concurrent change
or an initial-install failure needs administrator review; no reference is guessed.
Without `--origin`, the receipt covers filesystem verification only (`HTTPS:
NOT_RUN`). Auth, WSS and read RPC remain separate browser checks.

```sh
# Explicit rollback, with the same bound receipt/hash and HTTPS origin.
node scripts/oss/remote.mjs rollback \
  --candidate /srv/hermes-remote-web/deployments/REPLACE/candidate.json \
  --sha256 REPLACE_WITH_CANDIDATE_SHA256 --origin https://hermes.example --apply
```

Rollback is permitted only while current still points to that candidate. Never
restart Hermes to solve a static mismatch. Keep both releases; do not rebuild an
old version and call that a backup of the actual site.

## 4. Verify before calling it connected

```sh
node scripts/oss/remote.mjs doctor --origin https://hermes.example
```

Doctor performs four anonymous GETs (static build/index, public status and
`/api/auth/me`). It sends no credential, obtains no ticket and performs no write.
A protected 401 is `LOGIN_REQUIRED_PROTECTED`; a public 200 auth response requires
review. HTTP success is not chat/LLM acceptance.

Open `/hermes-remote-web/` in Safari and use **the existing Hermes login**. In
Settings, “導入と対応機能” explains HTTPS → native auth → fresh ticket/WSS →
`gateway.ready` → read RPC. The shared diagnostic report is an explicit allowlist
of build, numeric version, stages and feature booleans. It omits origins,
profiles/session IDs, conversations, images, cookies, tickets and raw errors.
Copy occurs only when you press the button. Review it before reporting an issue.

An administrator must independently verify authenticated read RPC, auth expiry,
wrong origin rejection and the final source/runtime before allowing generation.
The Web client preserves its server policy gate and Web Lock. An unknown send
result is never automatically resent. Model availability and paid-provider success
are **not** established by configuration or these public checks.

## 5. Browser updates and device acceptance

An update is offered explicitly. It cannot reload over a draft, send, run,
approval, image/document selection or another unsafe state. The old client must
still fetch its old hashes. Opt-in storage/offline/push/speech remain off until
you choose them; adding to the home screen is optional.

Test Safari and home-screen launch separately: input/IME, expanded input,
keyboard, orientation, 200% text, search position and foreground reconnect.
Real 30-second/5-minute lock recovery requires an accepted **running** turn;
fixture success cannot prove it. Those physical-device and paid-provider gates
remain NOT_RUN in this preview, rather than blocking source publication.
