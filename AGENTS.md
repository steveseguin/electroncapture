# Game Capture Agent Brief

## Context
- This branch carries the custom Electron Capture runtime (patched Chromium 36.9.5-qp20, NVENC, cursor/audio helpers) plus local copies of VDO.Ninja and Versus.cam sources so we can fork or shim them as needed.
- The new requirement is that **guests must be able to run the app with zero invites** and still publish a clean game + audio feed in under a minute. The app should feel like “Easy Mode OBS” that cooperates with accessibility tools, no virtual cables, and no logins.
- Producers will still hand out `electroncapture://` deep links for directed slots, but the default launch should present a self-serve workflow that yields a shareable VDO.Ninja view link (or optional RTMP/WHIP outputs) the guest can copy to others.
- We are free to host and ship a heavily modified VDO.Ninja build (even on a custom domain) dedicated to this workflow, as long as we stay compatible with core APIs for Versus integration.

## Vision
- Deliver a Versus-branded “Game Capture” desktop app that **defaults to a no-invite quick-share wizard** yet automatically honors rich producer invites when present.
- Let a guest choose *game/window*, *system audio*, *optional mic/camera*, and immediately go live with a known, human-friendly stream ID—just like “OBS simplified”.
- Provide one-tap sharing: copy VDO view link, QR code, or room/password so friends or a producer can ingest the feed. Advanced options should expose Versus-grade quality params (high bitrate, low latency, cursor policy) without overwhelming casual users.
- Remember prior selections (display, audio routing, stream ID) for frictionless relaunch, with a button to regenerate IDs.
- Keep the path open for power users: optional RTMP/WHIP targets, password-protected rooms, per-slot presets, and telemetry for producers. Longer-term we can fall back to ffmpeg/NVENC-backed WHIP/RTMP publishing with Electron acting as the UX shell.

## Primary User Journeys
1. **Producer-Guided Invite:** Versus generates a slot invite, guest installs/opens via deep link, shell auto-loads capture wizard with preset metadata, they confirm capture and go live into the producer’s dashboard.
2. **Self-Serve Quick Share:** Guest launches the app manually, sees the wizard, selects display/audio/mic, optionally enters room/password, receives a random stream ID (persisted locally) and a copyable viewer link. They can later regenerate or continue using the same ID for consistency.

## Strategy Pillars
- **Dual-mode landing shell:** `gamecapture.html` must clearly surface both “Join Invite” and “Share My Screen” flows, working offline and persisting state so the app is useful without Versus involvement.
- **Deterministic, memorable stream IDs:** Generate IDs locally using 1–3 dictionary words + mixed-case alphanumerics/underscores (≈12 chars when wording, 9–10 when random only). Persist per user, allow regenerate, and reuse across sessions so friends/producers can bookmark the viewer link.
- **Streamlined capture wizard:** Fork/modify `vdoninja_reference/lib.js` (or wrap it) to provide a modal that collects display/window, system/game audio, mic, and optional webcam overlays before initiating WebRTC. Integrate cursor hiding and audio routing defaults here.
- **Share-link orchestration:** When no invite is provided, auto-mint high-quality VDO publish/view URLs (Versus-style params for bitrate/codec/latency) plus optional room/password. Display and copy the viewer URL, QR, and short instructions so gamers can hand the feed to OBS users quickly. Advanced settings let power users tweak those query params.
- **Versus-driven metadata:** When a deep link exists, continue parsing slot/preset/cursor/transport/audio params, but merge them with user overrides so producers retain control without blocking accessibility tweaks.
- **Custom VDO host readiness:** Be prepared to point the wizard at a Versus-hosted, stripped-down VDO build with bespoke screen-share UI and APIs optimized for this app while retaining compatibility with the broader ecosystem.
- **Future outputs:** Keep architecture ready for WHIP/RTMP endpoints (maybe backed by Versus relays) so the same wizard can toggle destinations later without major rewrites.
- **Reliability + telemetry:** Instrument capture start/stop, hardware encoder usage, retry events, and invite failures. Surface diagnostics (encoder, fps, bitrate, cursor state) directly on the landing page.

## Goals & Success Metrics
1. Self-serve launch-to-live in <60 s for 90% of first-time users (no invite).
2. Invite-driven flows still auto-connect within 5 s of deep link activation.
3. 95% of quick-share sessions include the selected audio device + system audio on first attempt.
4. 80% of compatible GPUs stream with NVENC/HW encoders.
5. ≥70% of users share their viewer link directly from the app (copy/QR telemetry) showing that the share UX is obvious.

## Fallbacks
- Classic `https://vdo.ninja/electron` page remains available via “Open classic interface” or if the wizard crashes.
- Manual invite entry + QR scan stays exposed for cases where the OS protocol handler fails.
- If window/app audio capture is unavailable (missing private native module), the wizard falls back to Chrome getDisplayMedia with clear messaging.
- If WHIP/RTMP targets are unreachable, fall back to P2P + show status to the guest.
- If the custom Chromium binary can’t load, disable NVENC-specific messaging and warn via diagnostics.

## Recent Progress
- `gamecapture.html` now opens with a Quick Share panel (stream ID, viewer link copy/regenerate buttons, room/password fields) so first-run users can immediately self-serve.
- The main process persists share profiles per user, including deterministic word-based IDs, quality presets, and Versus-style high-bitrate publish/view URLs exposed over IPC.
- The preload bridge exposes `electronGameCapture` helpers for share profile reads/updates, so renderers can regenerate IDs, save rooms/passwords, and launch quick-share sessions without node integration.
- Invite handling remains unchanged: deep links still auto-populate, but the landing shell now shows a secondary “Join with invite” panel with the latest metadata and error surfacing.
- Landing shell redesigned: one Go live button, full viewer link + QR (vendored `assets/vendor/qrcode.min.js`), editable stream ID, room/password, and real quality controls (preset, bitrate, codec, audio, cursor, server) saved through `updateShareProfile`.
- Quick-share publish links no longer carry `autostart` (in Electron it skipped the picker and broadcast monitor #1) or `scene` (disabled VDO's web-audio mixer). Bitrate params are now kbps as VDO expects. Viewer links no longer carry `stats`.
- Opening and copying links goes through main (`gamecapture:open-external`, `gamecapture:copy-text`), so viewer links open in the user's browser instead of a bare Electron window.

## Execution Plan
### Immediate
1. **Capture wizard fork:** Replace the current default `vdo.ninja/electron` flow with a Versus-branded capture wizard (fork `vdoninja_reference/lib.js` or host a custom page) that enumerates windows/games, system/app audio, mic/cam, cursor toggle, and launches using the persisted stream ID.
2. **Quick-share advanced options:** Extend the new share panel so users can adjust bitrate/codec/transport presets (and preview the resulting link params) before launching; bubble these settings into the wizard.
3. **State + device persistence:** Store last-selected display/audio/mic devices and bring them back when the wizard opens, merging producer-provided metadata with user overrides.
4. **Viewer-link UX polish:** Add copy/QR/share shortcuts post-launch (including telemetry hooks) and show live diagnostics (encoder, fps, bitrate, transport) directly on the landing shell.

### Near Term
5. **Versus invite builder updates:** Modify Versus.cam to emit new schema fields (mode, slotId, preset, cursor, whip/rtmp, appaudio, password) and to surface quick-share IDs for producers.
6. **Telemetry + diagnostics:** Add lightweight POSTs to Versus for session start/stop, failures, encoder usage, and share-link copies. Include a diagnostics drawer in the shell (encoder, fps, bitrate, transport, GPU, cursor status).
7. **RTMP/WHIP destinations:** Prototype target selection in the wizard (Versus relay, custom WHIP/RTMP) while keeping VDO as the base path; investigate ffmpeg/NVENC-driven publishing where Electron provides UX only.
8. **Accessibility polish:** Keyboard/screen-reader friendly focus order, large hit targets, on-boarding tips, and hints for hiding system cursor.
9. **Packaging & updates:** Produce branded installers with protocol handler registration, ensure offline-first assets (wizard JS/CSS, fonts) are bundled.

### Backlog
10. Multi-slot / multi-window capability for advanced teams (parallel streams).
11. Authenticated invites + revocation controls for high-security events.
12. Integration with external platforms (auto-publish to Discord stages, NDI bridge).
13. Rich analytics dashboard that aggregates telemetry for producers/support.

## Technical Considerations
- Keep preload.js authoritative for getDisplayMedia interception, cursor policy, and app-audio detection; expose minimal renderer APIs via `electronGameCapture`.
- Wizard assets should live alongside `vdoninja_reference` so we can iterate without patching upstream every time; wrap modifications behind feature flags where possible.
- Persist state using the existing userData path (JSON) rather than ad-hoc localStorage so multiple windows stay in sync.
- Ensure webSecurity remains enabled for remote invites; only disable it when serving purely local troubleshooting views.
- Remember the stream/view ID securely (and allow regeneration) so guests can reuse the same link later without reconfiguration.

## Open Questions
- What wordlists/localization strategy should we use for human-friendly stream IDs (single English list vs locale-aware sets)?
- How opinionated should the high-quality preset be, and do we need a safe fallback for ultra-low-bandwidth users within the same wizard?
- When we host a custom VDO build, which features must remain to stay compatible with Versus dashboards (stats API, remote control, WHIP endpoints)?
- Should WHIP/RTMP publishing live inside the same wizard or as an “Advanced” panel, and how do we message the CPU-vs-GPU tradeoffs?
- What minimum telemetry granularity satisfies Versus without scaring privacy-sensitive gamers?

Keep this brief updated as assumptions shift; it is the alignment doc for all agents contributing to the Versus Game Capture experience.
