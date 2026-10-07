# Hermes Remote thin iOS shell (R22)

This candidate loads the existing React application in `WKWebView`. It does not
render a second chat UI or introduce a native Hermes/provider client. The
approved HTTPS origin is a build setting; the application path is fixed at
`/hermes-remote-web/`. No usable origin is shipped as a default.

The Linux source and TypeScript tests are separate from an Xcode build, a signed
application, and iPhone acceptance. Those three external checks have **not run**
in this environment. This directory is source, not an installable IPA.

## Files and boundaries

- `App/`: UIKit host, `WKWebView`, a privacy shield, device authentication, and a
  narrow reply bridge. Only the main frame at the approved application path may
  use the bridge. Same-origin login navigation is permitted; other origins and
  pop-ups are blocked. There are no ATS exceptions.
- `Shared/`: AES-GCM storage and scoped Keychain material. Keys never cross the
  JavaScript bridge. `WKWebsiteDataStore.default()` retains its own cookies;
  native authentication does not authenticate Hermes. Safari, home-screen, and
  native cookie sharing must not be assumed.
- `ShareExtension/`: local, explicit, one-item handoff. It does not contact the
  VPS, open the host app, or send a prompt. Photos/files pass through a bounded
  memory read; no image decoding or PDF extraction is added to the extension.
- `Tests/`: XCTest source to be run on an approved Mac. The Linux source checker
  validates the deterministic project and method/entitlement references; it is
  not a Swift compiler or native runtime test.

Backgrounding covers the WebView, invalidates the `LAContext`, and increments a
native operation generation. Unlocking uses device-owner authentication
(biometric or passcode). Returning to an already loaded page dispatches a
read-only recovery event, with no reload or automatic resend. Existing Web
authentication, WSS, tickets, RPC, and unknown-delivery behavior stay in Core.

## Narrow typed Web integration

The public TypeScript client is
`packages/core/src/features/native-shell.ts`. The optional browser adapter is
`packages/web/src/remote/native-shell.ts`; ordinary Safari returns `null`.
Read `device.capabilities` before any storage/share action. The client requires
`scopeInvalidationVersion: 1`; a protocol-1 shell lacking this capability stays
unsupported for native storage/sharing. It never falls back to plaintext browser
storage or assumes the new cancellation contract from the envelope version.

1. Create one client for the mounted Web application. After Hermes authentication
   and durable-session selection, set `{ origin, principal, profile,
   durableSession }`. Do not derive a principal from a display name.
2. Invalidate outstanding operations on logout, authentication loss, or scope
   changes. The client immediately rejects waiting operations and emits one
   best-effort `device.invalidate` control containing no scope/content. Native
   validation of the main frame/origin occurs before its empty control revokes
   queued operation tokens, pending offers, and native authentication generation.
   It performs no network/storage operation. Late/unknown control ACKs do not
   change the new scope or cause retry. Changing a previously bound scope uses
   the same control; initial setup alone does not contact the bridge. Reauthenticate
   explicitly before a new native storage/share operation. Do not recreate a
   client for every click.
3. Bind `bindNativeResume(() => controller.recover())` to existing **read-only**
   reconciliation. Dispose it when the authenticated application unmounts. The
   callback must not create a conversation or resubmit a prompt.
4. `pendingShare()` returns metadata only. On the user's explicit import action,
   `acceptShare(id)` displays native confirmation and returns an in-memory
   `NativeSharedDraft`. It leaves the encrypted handoff pending.
5. Import text using the existing insertion/cursor helper. Convert an accepted
   file with `sharedDraftFile()`, then run existing `prepareImage` or
   `prepareDocument` validation and selection guards. Preserve an existing
   draft/attachment; request the existing confirmation rather than overwriting.
   Recheck the same authenticated scope after asynchronous preparation.
6. Only after successful import into the same in-memory composer call
   `finishShare(id)`. Failure, cancellation, or scope change must not finish or
   automatically retry. The user still uses the ordinary explicit send button.
   `cancelShare(id)` confirms deletion of only the matching local handoff; it
   does not delete the original file or anything on the VPS.

Native storage is an explicit adapter, not an automatic fallback from browser
storage. `saveSnapshot(value, expiresAt)` writes a UTF-8 value of at most 1 MiB,
scoped to origin/principal/profile/durable session, with a maximum seven-day
expiry. Call it only after the existing opt-in. Scope is authenticated AES data
and a SHA-256 filename/account namespace. Snapshot keys use Keychain
`WhenUnlockedThisDeviceOnly` with `userPresence`; reads are performed with the
authenticated `LAContext`. Maximum native snapshots: 110 files / 20 MiB of
ciphertext. Removing a snapshot confirms that scope's local file/key deletion;
server history is untouched. No browser plaintext store is used.

Queued actions pass a lock-protected scope/generation token check immediately
before I/O and before replying. Background locking invalidates that token before
changing the device generation. The included delayed-queue XCTest verifies that
obsolete removal/share-finish actions never execute. This does not undo I/O that
was already admitted before invalidation, and these Swift runtime tests still
require an approved Xcode environment.

The share handoff is one encrypted slot, with a one-hour expiry, at most 64 KiB
of text or one JPEG/PNG/TXT/Markdown/CSV/PDF file of at most 5 MiB. A file needs a
caption. A live pending handoff is never silently overwritten. The shared
Keychain key is device-only and available while unlocked so the extension can
store a draft; viewing/importing it in the main app additionally requires device
authentication and confirmation. Shared file names/content stay out of URLs,
logs, preferences, and JavaScript storage. Basic header checks here do not
replace the existing client/server image and PDF validators. Metadata has not
been removed; transferring an attachment may leave its metadata intact.

## Reproducible source checks on Linux

Run from the repository root with its existing pinned dependencies:

```sh
python3 native/ios/scripts/generate_project.py --check
python3 native/ios/scripts/verify_source.py
npm run typecheck
./node_modules/.bin/eslint packages/core/src/features/native-shell.ts packages/core/src/features/native-shell.test.ts packages/web/src/remote/native-shell.ts packages/web/src/remote/native-shell.test.ts
./node_modules/.bin/vitest run packages/core/src/features/native-shell.test.ts packages/web/src/remote/native-shell.test.ts --maxWorkers=1 --minWorkers=1
```

`generate_project.py` is a standard-library-only deterministic generator for the
three targets (app, extension, XCTest). It does not install tools, sign, contact
a Mac, provision identifiers, or access credentials. Run it without `--check`
only when intentionally regenerating this owned project from its source.

## Xcode checks on an already authorized Mac

Use an existing authorized Xcode installation and signing identity. Do not
create an Apple account, buy a Developer subscription, contact a new Mac, or
enable automatic provisioning for this task. The default bundle/App Group
identifiers are candidate placeholders, not proof of registration. Configure
the app and extension with the already authorized bundle identifiers, the same
registered App Group, the same shared Keychain group, and the existing team.
Keep the extension bundle identifier under the app identifier. Both targets
need their own matching existing provisioning profile for a device build.

`HERMES_APPROVED_ORIGIN` is a canonical HTTPS origin without slash, user info,
query, or fragment. Use the verified existing origin, including its port. This
setting contains no credential. If it is empty or invalid, the shell stays
closed and shows a setup message.

First verify the local toolchain/project without signing:

```sh
cd native/ios
xcodebuild -version
xcodebuild -list -project HermesRemote.xcodeproj
xcodebuild -showdestinations -project HermesRemote.xcodeproj -scheme HermesRemote
xcodebuild -project HermesRemote.xcodeproj -scheme HermesRemote -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

Select one existing simulator identifier reported above; do not assume a
particular simulator/device exists:

```sh
xcodebuild -project HermesRemote.xcodeproj -scheme HermesRemote -configuration Debug -destination "platform=iOS Simulator,id=$HERMES_SIMULATOR_ID" -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO test
```

Use Xcode's existing approved signing profiles for a device build. Supply the
verified origin as a build setting and validate matching App Group/Keychain
entitlements in both signed products. Do not pass `-allowProvisioningUpdates`.
No IPA, device install, TestFlight, or App Store publication is created by the
Linux commands above.

## Native acceptance that remains external

Test separately from Safari/WebKit browser tests, using synthetic content and
no paid prompt generation:

1. Build and run the source on the existing approved simulator. Exercise device
   authentication success, cancellation, and unavailable passcode/biometrics.
   The page stays covered until successful authentication. An invalid origin,
   an external redirect, and a subframe cannot obtain the bridge.
2. On an approved iPhone, authenticate Hermes inside the native WebView. Verify
   Japanese input, keyboard open/close, rotation, 200% text, VoiceOver, existing
   menus/sidebar, and focus restoration. Check that unapproved links do not
   navigate out of the fixed origin.
3. Share one synthetic text and one allowed synthetic file from the system
   sheet. Selection alone causes **zero** backend writes. Verify caption,
   confirmation, preservation of the old draft, cancel, wrong/stale scope, one
   pending slot, expiry, and import followed by an ordinary unpressed send
   button. Files-provider behavior must be checked on-device.
4. Explicitly save a synthetic native snapshot, lock/background, then cancel
   and complete device authentication. Verify scope isolation, expiry, size
   limits, local deletion, logout cleanup of visible memory, and separation from
   browser encrypted storage. App-switcher snapshots must show the shield.
5. Background/foreground the app during a fixture execution and unknown send.
   Resume performs state/history recovery, with automatic prompt/approval/stop
   writes equal to zero. Device authentication must not cause a page reload.

Native Xcode build/tests, entitlement availability, Face ID, Keychain access,
sharing, and device acceptance remain `BLOCKED_EXTERNAL`/`NOT_RUN` until those
actions are performed in the existing authorized Apple environment. Passing a
Linux TypeScript or source-contract test does not change that status.
