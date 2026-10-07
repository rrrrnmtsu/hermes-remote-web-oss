# Developer Preview acceptance boundary

One owner, fixed same-origin path, existing authenticated Hermes, one foreground
conversation. Existing R01–R22 source is retained; availability is capability- and
policy-gated. Font: body 16px default with strictly 15/16/17 settings, input ≥16px,
controls ≥44px, send ≥48px. UTF-8 Markdown export is bounded to 1MiB and explicit.

| Feature | Source scope | External acceptance still required |
| --- | --- | --- |
| R01 | Scoped quotation into an existing memory draft | Real device selection/IME |
| R02–R03 | One image/document plus caption, atomic turn contract | Live transport and separately authorized provider analysis |
| R04 | Canonical artifact preview and explicit save | Actual device file/save behavior |
| R05 | Session model catalog, explicit change/limits/readback | Real provider model/policy acceptance |
| R06–R08 | Bounded history, names/pins/archive, registered project conversations | Operator's authenticated server and owner/root boundary |
| R09–R13 | Catalog insertion, scoped information, cron/usage/activity reads | Actual server contracts/data; no hidden generation |
| R14–R16 | Non-destructive branch drafts, personal templates, root-scoped files | Owned server writes/reads; no business-data test |
| R17–R18 | Opt-in encrypted device drafts/history and own offline worker | User opt-in, recovery/key loss and physical-device storage |
| R19–R20 | Opt-in notifications and device speech | User/browser permission; no permission granted by tests |
| R21 | Separate-origin navigation and state isolation | User-approved origins, separate auth, no credential transfer |
| R22 | Experimental thin native iOS source | Mac/Xcode compile, signature and device tests |

Every release reports code, unit/contract, synthetic-provider real handlers,
static publication, live provider, device and user opt-in separately. Read
[compatibility.json](../compatibility.json) and release notes. A source feature or
fixture card does not establish actual approval/provider/device success.

Requirements preserved across every addition: no unsolicited writes, no automatic
resend, secure Markdown/URLs, type-preserved server requests, exact ownership/scope,
fresh ticket, bounded replay/resync, no arbitrary credential origin, no other
application's cache/storage deletion, no forced reload over work in progress.

OSS publication requires notices/provenance, source without private operation
history, fixed build and SHA-256 archives, both fixture browser engines, safe
static update/rollback and exact-source CI. Beta adds real text/device gates in
[the roadmap](OSS_ROADMAP.md); those gates are not falsely marked by publication.
