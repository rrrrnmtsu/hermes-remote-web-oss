# Fixed transport contract

The source of truth is the fixed official Hermes code and the ordered patches,
not this overview. See `compatibility.json`, `upstream.lock.json`,
`patches/{text-pilot,image-turn,product}/upstream.lock.json` and
`packages/core/src/vendor/hermes/gateway-contract.generated.ts`.

Official base: `e8c97320ac8691d4de92af49f98459f9ef9ddb08`.
Final contract candidate: `797ef4994a4c8c707a558f9c9a5a3a8490213d3d`.
A CLI version string does not identify the loaded service code. All three patches
and composite hashes must match; `node scripts/verify-product.mjs` checks their
provenance. `--source` verifies materialized source; `--apply` is restricted to a
separate checkout below this project's `output/`, not a production source.
It does not switch a service or modify a provider/configuration.

## Authentication and scope

The browser uses its actual same HTTPS origin, native Dashboard auth and a fresh
WebSocket ticket per connection. Cookie/password/token/ticket values are never
stored as browser configuration. Preserve Host/Origin, CSRF and TLS validation.
Do not use a CLI provider credential resolver to authenticate the Web client.
Connection succeeds only after WSS, `gateway.ready` and authoritative read RPC.

The one controller distinguishes origin/principal/profile, durable/live/lineage
session and socket generation. Late replies remain in their old scope.
Capabilities come from the actual server and its profile policy. New writes require
the declared exclusive-submit contract, authoritative principal and corresponding
Remote Web version/policy. A missing contract does not trigger an alternate RPC,
provider fallback, execution ownership takeover or forced retry.

## Writes, requests and replay

- Delivery (`sending/accepted/delivery_unknown/failed_before_send`) is separate
  from execution and connection state. A UUID is not server idempotency.
- `prompt.submit` uses the existing path and a fixed snapshot. Unknown ACKs are
  not resent or inferred from matching historical text. Attachments stay bound to
  the intended turn; legacy shared pending queues cannot silently consume them.
- Server approval/clarify request IDs retain string/number type. Respond with the
  same ID on the original socket generation; cancel only the corresponding card.
  Display supported `once`/deny choices and real server data, no fabricated deadline.
- Stop uses `session.interrupt`; its ACK is a stop request, not stopped execution.
- Recovery retains seq/epoch and reconciles replay/history/state/open requests.
  Range expiry or server restart requires authoritative resync, no write replay.
- Web Locks prevent local-tab conflicts. Server ownership/exclusive submit, not
  browser locks, mediates another device/client.

## Extended feature boundaries

The product patch defines owner/profile-scoped history, organization, registered
projects, catalog/information, model policy, canonical artifacts/files and personal
templates. File/artifact reads use returned canonical identifiers inside authorized
roots, never guessed URLs or absolute client paths. All writes are explicit and
scope-bound. Cron/MCP/credentials are not managed by this client.

One JPEG/PNG image or supported document requires nonempty explanatory text,
server validation/bounds and declared model policy. Preview never transfers.
Attach-bytes method existence alone does not prove safe-turn or vision support.
Unknown acceptance disables automatic resend. Metadata removal is not claimed.
The text-pilot policy continues to reject images; static installation cannot
change it. Real-provider image/document acceptance remains a separate gate.

Default content is in memory. Opt-in AES storage, own static worker, owner-scoped
push and device speech have distinct consent/permissions; refer to
[privacy](SECURITY.md). Native iOS source uses the same controller, not a second
execution engine. Source checks do not prove Swift compilation/signing.

The canonical fixed handler tests use synthetic provider boundaries and isolated
homes. They do not prove current provider authentication, real phone lock recovery
or end-user consent. Installation never applies those outcomes by inference.
