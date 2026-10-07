# Isolated text-pilot backend candidate

Source: https://github.com/NousResearch/hermes-agent
Base: `e8c97320ac8691d4de92af49f98459f9ef9ddb08` (observed server 0.21.5).
MIT, Copyright (c) 2025 Nous Research. Complete license: `HERMES_LICENSE`.
Original and changed file hashes and the patch hash: `upstream.lock.json`.

This is a licensed patch of the official Python agent/gateway, not a clean-room
implementation, plugin, second execution engine or Web release. It has not been
applied to the running Hermes. Do not include it in the static site or install it
through a plugin hook. Ordinary profiles do not opt into its new policy.

The changes add one pinned native Anthropic text policy, suppress tool/context/
memory/MCP/notification work in that policy, refuse auxiliary generation and
fallback, reserve one physical request per explicit turn across all recovery
paths, and check input estimates plus a hard output cap before that request.
Tests use the real AIAgent, gateway construction and native SDK with synthetic
HTTP/SSE responses; actual model authentication, billing and iPhone behavior
remain separate acceptance gates.
