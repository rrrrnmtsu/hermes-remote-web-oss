# Fixed backend preparation (separate from static install)

This preview requires the additional contracts in the three **ordered** patches
for its full feature set. Stock/latest Hermes compatibility is not qualified.
A static install does not patch, restart or configure a backend. Never apply a
patch directly to a live checkout. Existing profile policy and auth must remain.

## Reconstruct source in a disposable checkout

```sh
git clone --no-checkout https://github.com/NousResearch/hermes-agent.git output/backend-preview
git -C output/backend-preview checkout --detach e8c97320ac8691d4de92af49f98459f9ef9ddb08
node scripts/verify-product.mjs --source output/backend-preview --apply
```

The verifier checks each patch/license/wheel hash, original bytes, path allowlist,
parent patch identity and final composite bytes. It refuses a different base or
an unexpected existing file. It applies only under this project's owned `output/`
checkout; it does not access the live service. The final candidate reference
`797ef4994a4c8c707a558f9c9a5a3a8490213d3d` identifies recorded derived source, not
an assertion that `git apply` recreates that commit object or changes HEAD.
Compare the **composite source file hashes**, not just a version string.

The public CI uses pinned uv 0.12.13, CPython 3.14.7, the official `uv.lock`,
`uv sync --locked --no-install-project` and reviewed hash-locked Python wheels
installed with `--no-index --no-deps`. That CI is the reproducibility reference.
Read official install scripts/dependency hooks before local installation; do not
run curl|sh, @latest or an automatic environment repair. All wheel notices/source
are included. No production provider credential or populated home is shipped.

`bash scripts/product/run-backend-tests.sh <source> <isolated-python>` exercises
real handlers/ownership/turn construction with synthetic provider boundaries and
zero automatic test retries. CI results do not prove production auth or paid
provider success. Never run those tests using a production HERMES_HOME.

## Before any service activation

Activation is an administrator's **separate** operation, not performed by the OSS
static tool. Prepare an independent immutable source/dependency release and bind
its file hashes, Python, generated contracts and Web build. Verify the exact launch
command in an isolated home. Preserve the existing user, bind/port, HERMES_HOME/DB,
Dashboard routes, auth, proxy, profiles and tools; do not loosen Origin/TLS.

Observe every served profile's running turns, subagents, unanswered requests and
queued work. Drain through the existing admission contract; unknown state blocks
cutover. Take coherent backups where applicable; keep old source/dependencies/unit
references and an exact rollback. Do not terminate work to make a gate pass.
Do not parallel-start another agent at the same production home or introduce a
new daemon/public port. Verify the loaded PID/source hashes after an authorized
restart and test native auth/WSS/read-RPC before any generation.

The preview intentionally supplies no host-specific systemd unit or automatic
production installer. Reader-specific service qualification, native provider
availability, output ceilings and tool/context isolation must be established.
The text-pilot policy stays isolated and rejects images. Capability availability
is distinct from model vision support. Preserve unknown-write state and zero
automatic resend. Real text, images/documents, notifications and physical-device
acceptance each need the operator's explicit scope and budget/consent.
