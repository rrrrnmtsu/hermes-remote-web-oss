# Fixed Remote Web product backend derivative

Source: https://github.com/NousResearch/hermes-agent — MIT, Copyright (c) 2025 Nous Research.
Apply fixed text-pilot parent, fixed image-turn parent, then this product patch. All
source SHAs and original/final file hashes are in upstream.lock.json. The derivative
is not clean-room. Existing parent patches are retained unchanged for provenance.

This patch adds authenticated owner/profile-scoped metadata, bounded reads, atomic
JPEG/PNG or extracted TXT/Markdown/CSV/PDF turns, verified private artifacts, and
explicit Web Push consent. It introduces no agent engine, daemon or transcript DB.
Ordinary legacy methods and profile policy remain backward compatible. The new
Web generation capability defaults OFF until a legitimate permitted route is
validated; text-pilot stays isolated and rejects attachments. Only the provider
HTTP boundary is synthetic in integration tests; actual handlers/SDK/decoder run.

New runtime wheels are fixed and hash-checked. pypdf is BSD-3-Clause; pywebpush and
py-vapid are MPL-2.0; http-ece is MIT. Upstream package sources are unmodified. The
http-ece wheel is built from the recorded 1.2.1 sdist using recorded build-only
setuptools/wheel versions. LICENSES.txt retains each complete license.

Deployment is an independent sealed release. Never patch the live source tree.
Keep the existing PM dependency generation and launcher -I behavior, route/auth/
HOME/DB references. Retire/drain before restart; rollback code, never transcript DB.
