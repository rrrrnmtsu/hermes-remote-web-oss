# Third-party notices and source availability

Hermes Remote Web is an independent, unofficial derivative. The MIT root license
covers this project's source; it does **not** replace dependency licenses or grant
rights to upstream names/logos. We preserve the original copyright notices.

| Component | Fixed origin | License / retained notice |
| --- | --- | --- |
| Original client source | stasstepv/hermes-pwa `7dc780bf80eb957ad0c2826954b54adce7db7ad5` | MIT, Copyright (c) 2026 Stanislav Stepchenko; root LICENSE and NOTICE |
| Hermes shared transport and generated contracts | NousResearch/hermes-agent `e8c97320ac8691d4de92af49f98459f9ef9ddb08`, modified by the fixed contract patches | MIT, Copyright (c) 2025 Nous Research; `packages/core/src/vendor/hermes/LICENSE` and per-stage `HERMES_LICENSE` |
| Text-pilot / image-turn / product backend patches | Ordered fixed hashes in `patches/*/upstream.lock.json`, final candidate `797ef4994a4c8c707a558f9c9a5a3a8490213d3d` | MIT Hermes-derived source; each original/patched file hash and patch bytes retained |
| React, React DOM, Zustand, Markdown and QR dependencies | Exact resolution/integrity in `package-lock.json` | Per-package licenses; generated static payload includes full `DEPENDENCY_LICENSES.txt` |
| mdast-util-from-markdown 2.0.3 / mdast-util-to-hast 13.2.1 | syntax-tree projects, Titus Wormer | MIT; already locked, safe Markdown AST search |
| Playwright 1.62.1 | Microsoft playwright / playwright-core | Apache-2.0, development-only; browser binaries are not redistributed in the static payload |

**This derivative is not clean-room.** It incorporates licensed official shared
code. No unlicensed Desktop code is included. `upstream.lock.json` preserves
original acquisition references/hashes; later generated contract hashes live in
the product-stage lock. A patch in this source archive does not mean it has been
applied to the reader's server. Static installation never activates backend code.

## Optional fixed Python dependencies

These are bundled for offline verification of the fixed backend, **not** as Web
assets or an automatic installer. No versions are resolved at deployment time.
Their exact wheel SHA-256 values are in `patches/product/upstream.lock.json`.

| Distribution | License | Source / notices |
| --- | --- | --- |
| py_vapid 1.9.4 | MPL-2.0 | https://github.com/mozilla-services/vapid; wheel Python source is reproduced unchanged in `third_party/python-source/py_vapid/`, with full MPL license |
| pywebpush 2.5.0 | MPL-2.0 | https://github.com/web-push-libs/pywebpush; wheel Python source is reproduced unchanged in `third_party/python-source/pywebpush/`, with full MPL license |
| pypdf 6.19.0 | BSD-3-Clause | https://github.com/py-pdf/pypdf; full license inside wheel and `patches/product/LICENSES.txt` |
| http_ece 1.2.1 | MIT | https://github.com/martinthomson/encrypted-content-encoding; matching fixed upstream-tag license in `third_party/licenses/http_ece.LICENSE`, acquisition/hash in adjacent `http_ece-source.json` |

The two MPL packages contain Python source, not native object binaries. The
unchanged preferred source plus full notices is distributed in this repository
and its source release. The root MIT license does not relicense those files.
For modifications to those covered files, retain their MPL terms and make the
corresponding source available. The combined dependency license evidence remains
hash-locked; supplementary source/notices do not change the wheels.

Original upstream screenshots/logos, individual deployment receipts, private
operations scripts, provider configuration and private Git history are excluded
from this public source distribution. The geometric app icons are original MIT
artwork. Published screenshots use clearly labeled synthetic DEMO data. System
fonts are referenced, not shipped; no remote font is requested. Each public
export carries a file-hash manifest and provenance rather than rewriting history.

`npm ci --ignore-scripts --no-audit --no-fund` suppresses install hooks. Vite uses
the fixed optional esbuild binary. No legacy plugin/observer is installed. The
source-only `register` verifier remains inert. The opt-in worker and backend
notification contract are separate, owner-scoped implementations; consent is off
by default. Never send secrets or complete operational records with an issue.

The unchanged py_vapid dependency tests contain a **public upstream synthetic EC
test key** in `third_party/python-source/py_vapid/py_vapid/tests/test_vapid.py`.
It is included with the licensed source/wheel, never configured as a deployment
key. Publication review binds this exception to the fixed file/wheel hash;
other private-key matches are rejected. Never use test fixtures as production
credentials. No operator credential or actual provider key is distributed.
