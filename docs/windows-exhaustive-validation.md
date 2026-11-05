# Extended Windows validation — November 4–5, 2026

This extends [runtime-validation.md](runtime-validation.md) with real native input,
packaged process reuse, media stress and endurance checks. It does not establish
compatibility on every Windows version, GPU, display or capture device.

Host: Windows 11 Pro 10.0.26200, x64, one 1920×1080 display at scale 1. The custom
runtimes are 39.8.10-qp20 and 43.3.0-qp20. GPU diagnostics identify Intel Graphics
as the active ANGLE device, with an NVIDIA TITAN RTX and AMD Radeon RX 9060 XT also
enumerated. Enumeration and enabled feature flags do not prove a particular
hardware encoder was used.

With fake-device capture enabling implementation statistics, the default v39
codec test identifies libvpx for VP8, Intel Media Foundation hardware VP9, and
Intel Quick Sync H.264. Explicit software mode identifies libvpx for VP8/VP9 and
OpenH264 for H.264, all with `powerEfficientEncoder=false`. This confirms the
software switch changes the exercised encoding path; it does not cover NVIDIA
or AMD encoders.

The beta.3 signed portable binaries were built from `d6e8051` in workflow
`41863845043`. Source tests also incorporate concurrent Mac/Linux changes through
`36dad7d`, including named-window title/fullscreen reuse and native pin restoration.
The long published-package runs use beta.3; they do not silently switch to the
newer source while recording. New `v2.23.4` packages are checked separately below.

## Completed checks

| Area | Windows result |
| --- | --- |
| Regressions | All 22 standard suites pass after integrating concurrent platform changes. |
| Native window behavior | Initial 156-check suite passes on each custom runtime; expanded matrix results follow below. |
| Native compositor alpha | Five alpha states pass on each runtime. |
| Real mouse input | Five repeated runs per runtime: 50 combined click/click-through/focus-restoration cycles and 10 real edge drags. Native hit testing identifies the resize edge; width changes from 640 to 720 pixels. |
| Packaged workflows | Both published portable variants pass cold start, whole-process restart, persistent localStorage/HttpOnly cookie, CSS/JS injection, reload and real second-process named-window reuse. Explicit Node opt-in opens a separate context and preserves the existing isolated window and its preferences. |
| Package fuses | `ELECTRON_RUN_AS_NODE` and a `NODE_OPTIONS=--require` marker do not inject into either published portable. |
| Fetch IPC | Both runtimes deny cross-window reads/closes, abort pending headers/readers on navigation/close, clean up error responses, and complete 100 open/read/close cycles. Owner listener counts return to baseline. |
| Process audio | Both runtimes pass 100 source replacement cycles, source exit, navigation, owner close, intentional renderer crash and subsequent recovery. |
| Actual window capture | Both runtimes capture the owned generated window at 640×360, 800×450 and 480×270 with WGC explicitly enabled and disabled. Captured pixels match the fixture and frames advance. |
| Available devices | Both runtimes open the six available media-device entries, route output devices, download to separate window folders, and resize out of fullscreen. Media from device checks is not retained. |
| ASIO | ASIO4ALL v2 is available through the isolated renderer's IPC API on both runtimes. Longer runs and lifecycle results follow below. This is not testing a dedicated professional ASIO interface. |
| Updated reuse/dialogs | 135 named-window/fetch checks pass on each runtime. Title, Unicode/quoted JS, CSS, URL, cancel and overlapping prompt pin restoration pass. |

## Custom runtime findings

The codec fixture uses local peer connections without external ICE servers. It
generates moving 1280×720 video, requests 3 Mbps, constrains to 250 kbps, restores
bandwidth and replaces the source with 640×360. VP8, VP9 and H.264 are tested with
default, software, D3D12 and adaptive-scaling options. GPU/QP diagnostics are
recorded; average QP does not establish a per-frame QP ceiling.

The 39.8.10-qp20 runtime reduces resolution in resolution-lock and all-lock tests
despite the correct field trials being active. The 43.3.0-qp20 runtime retains
resolution in these tests, but VP8/H.264 delivery can stall under the deliberately
low bitrate. This stress result is a compatibility/operating-limit finding, not
evidence that the recent JavaScript security updates caused it.

Playout is measured by decoding frame numbers drawn into generated video and
comparing their source timestamps with actual displayed frames:

| Requested delay | 39.8.10-qp20 measured median | 43.3.0-qp20 measured median |
| --- | --- | --- |
| 0 seconds | 39 ms | 30 ms |
| 2 seconds | 2,010 ms | 2,005 ms |
| 15 seconds | 36 ms — fails request | 15,003 ms |
| 60 seconds | Not tested | 60,001 ms |

The default runtime reports a `playoutDelayHint` of 15 even when actual playout
does not delay. The source inventory discrepancy documented in
[maintenance-review.md](maintenance-review.md) remains relevant. Do not infer the
two custom binaries contain identical native patches.

Cursor suppression is **not verified visually**: the owned-window capture test
did not include a cursor even in its explicit visible-cursor control. Both page
hooks/preferences are installed, but this cannot prove cursor suppression in a
real screen-share path. The test captures no unrelated desktop content.

## Endurance and current package results

Results are recorded after the running media tests finish; no in-progress run is
counted as a pass.

The new `v2.23.4` Windows installer and portable downloads match their GitHub
SHA-256 digests. All four outer executables and both extracted app executables
match the repository's pinned signing certificate and carry timestamps. The
certificate is self-signed: this host reports an untrusted root, not a publicly
trusted publisher. No certificate-store settings were changed.

Both new portable packages pass the real-process workflow checks above. Their
embedded version is `2.23.4`; packaged `main.js` matches build commit `0e36f48`
after normalizing Windows line endings. All three native binaries are x64 and
identical between variants. RunAsNode, NODE_OPTIONS and Node CLI inspect fuses
are disabled; cookie encryption is enabled. Existing ASAR integrity/loading
compatibility settings were not changed.

| New portable | SHA-256 |
| --- | --- |
| `elecap.exe` | `24246a79faedc1739167a2641d9f990996dbcb60ddb0fe5291b6a5e85b940aab` |
| `elecap-win11.exe` | `69928b62f418462afc62bb03bbb3968f0a335cd1172535db1c5cfd1e94633d82` |

## Reproduction

Run opt-in desktop tests individually; global shortcuts and native mouse tests
can conflict with other application instances. Test profiles and media artifacts
are created under the printed temporary directories. Protocol registration is
stubbed in source fixtures; packaged fixtures use a copied portable executable
and fresh portable profile. The earlier protocol-registry cleanup restriction is
recorded in the prior report and was not bypassed.

```powershell
node test/windows-native-input.js
node test/windows-desktop-capture.js
node test/fetch-runtime-integration.js
node test/asio-runtime.js
node test/webrtc-stress.js
node test/playout-delay-runtime.js
```

Set `VALIDATION_ELECTRON` to an alternate custom runtime. For extended ASIO checks,
set `VALIDATION_ASIO_CYCLES=100` and `VALIDATION_ASIO_SECONDS=600`; samples are
discarded and output channels remain disabled. `VALIDATION_PLAYOUT_DELAYS` accepts
a comma-separated list of delays from 0 to 600 seconds. `VALIDATION_WEBRTC_MODES`
selects modes and `VALIDATION_WEBRTC_BITRATE` changes the constrained bitrate.
`VALIDATION_WEBRTC_DIAGNOSTICS=1` uses Chromium fake media devices to expose
hardware implementation statistics without opening the user's camera/microphone.
Contract failures remain failures; these opt-in stress checks are not silently
added to the standard regression command as passing tests.

## Follow-up order

1. Preserve both existing custom runtimes and rollback packages while reconciling
   exact Electron/Chromium/WebRTC/FFmpeg revisions, native patches, GN arguments
   and artifact hashes. Do not substitute SSN's non-resizable Windows 10 window
   workaround for Electron Capture's working resize behavior.
2. Rebuild the reconciled custom patch set on a supported Electron patch release
   in an isolated checkout. Separate window transparency/frame fixes from codec,
   cursor, adaptive-scaling and long-buffer changes so failures can be attributed.
3. Gate replacement on these behavior tests plus actual Windows 10, mixed-DPI
   monitors, OBS alpha capture, visible-cursor controls, hardware-specific codec
   and QP measurements, and physical device unplug/reconnect. Keep a known-working
   installer available throughout testing.
4. Resolve the remaining build-tool advisories through tested upstream updates;
   retain strict production/native dependency audits. The temporary prerelease
   exception does not repair or justify indefinitely retaining vulnerable tools.
5. Promote a replacement only after signed-package install/upgrade/rollback and
   sustained media tests pass on the supported hardware matrix. Current tests
   do not establish subjective camera/speech quality, hostile-network recovery,
   hardware QP ceilings, or ten-minute buffering of high-bitrate 60 fps content.

## Evidence notes

Raw generated-media fixtures and JSON reports remain under `%TEMP%/elecap-*` on
the validation host. The first scaling run used unsupported dashed aliases; it
was discarded and repeated with documented flags and explicit switch assertions.
The native input fixture initially had Windows launcher/settling problems; after
fixing those fixture issues, five repetitions per runtime passed. These failed
attempts are not presented as app regressions or erased from the evidence.
