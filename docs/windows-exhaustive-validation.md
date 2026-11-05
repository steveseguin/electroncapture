# Extended Windows validation — November 4–5, 2026

This extends [runtime-validation.md](runtime-validation.md) with real native input,
packaged process reuse, media stress and endurance checks. It does not establish
compatibility on every Windows version, GPU, display or capture device.

Host: Windows 11 Pro 10.0.26200, x64, one 1920×1080 display at scale 1. The custom
runtimes are 39.8.10-qp20 and 43.3.0-qp20. GPU diagnostics identify Intel Graphics
as the active ANGLE device, with an NVIDIA TITAN RTX and AMD Radeon RX 9060 XT also
enumerated. Enumeration and enabled feature flags do not prove a particular
hardware encoder was used.

With fake-device capture enabling implementation statistics, both default
codec tests identify libvpx for VP8, Intel Media Foundation hardware VP9, and
Intel Quick Sync H.264. Explicit software mode identifies libvpx for VP8/VP9 and
OpenH264 for H.264, all with `powerEfficientEncoder=false`. This confirms the
software switch changes the exercised encoding path; it does not cover NVIDIA
or AMD encoders. With `--d3d12enc`, H.264 reports
`D3D12VideoEncodeAccelerator` on both runtimes and continues delivering frames.

The beta.3 signed portable binaries were built from `d6e8051` in workflow
`41863845043`. Source tests also incorporate concurrent Mac/Linux changes through
`daf3098`, including named-window title/fullscreen reuse, native pin restoration
and the closed-window retention fix.
The long published-package runs use beta.3; they do not silently switch to the
newer source while recording. The intermediate `v2.23.4` and final `v2.23.5`
packages are checked separately below. Final application/package version remains
`2.23.5`; GitHub's prerelease flag remains enabled for manual promotion.

## Completed checks

| Area | Windows result |
| --- | --- |
| Regressions | All 22 standard suites pass after integrating concurrent platform changes. |
| Dependency checks | Production and both native lockfile audits report zero vulnerabilities. CI verifies registry signatures for 378 root, 21 ASIO and 23 process-audio packages. Four reviewed build-tool advisories remain unfixed under the release-specific exception expiring December 4, 2026; this does not address the older custom Chromium engines. |
| Native window behavior | After the fullscreen pin correction, both runtimes pass all 45 scenarios / 542 assertions each (1,084 combined). Explicit no-pin, Node/isolation, minimize, fullscreen exit and click-through combinations are covered. |
| Native compositor alpha | Five alpha states pass on each runtime. |
| Real mouse input | Five repeated runs per runtime: 50 combined click/click-through/focus-restoration cycles and 10 real edge drags. Native hit testing identifies the resize edge; width changes from 640 to 720 pixels. |
| Packaged workflows | Both published portable variants pass cold start, whole-process restart, persistent localStorage/HttpOnly cookie, CSS/JS injection, reload and real second-process named-window reuse. Explicit Node opt-in opens a separate context and preserves the existing isolated window and its preferences. |
| Package fuses | `ELECTRON_RUN_AS_NODE` and a `NODE_OPTIONS=--require` marker do not inject into either published portable. |
| Fetch IPC | Both runtimes deny cross-window reads/closes, abort pending headers/readers on navigation/close, clean up error responses, and complete 100 open/read/close cycles. Owner listener counts return to baseline. |
| Process audio | Both runtimes pass 100 source replacement cycles, source exit, navigation, owner close, intentional renderer crash and subsequent recovery. |
| Actual window capture | Both runtimes capture the owned generated window at 640×360, 800×450 and 480×270 with WGC explicitly enabled and disabled. Captured pixels match the fixture and frames advance. |
| Available devices | Both runtimes open the six available media-device entries, route output devices, download to separate window folders, and resize out of fullscreen. Media from device checks is not retained. |
| ASIO | Each runtime passes 100 start/stop/close cycles and a ten-minute ASIO4ALL v2 input soak through isolated-renderer IPC. Foreign-window read/start/stop/write requests fail; foreign close does not interrupt the owner. Reload and close release native streams. This is not testing a dedicated professional ASIO interface. |
| Updated reuse/dialogs | 135 named-window/fetch checks pass on each runtime. Title, Unicode/quoted JS, CSS, URL, cancel and overlapping prompt pin restoration pass. |
| Closed-window retention | After pulling `a1fa9da`, both runtimes collect all 20 closed BrowserWindow wrappers; IPC/display/download listener counts return to baseline. The updated dialog suite also passes. |

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
Both codecs resume delivery when the request returns to 3 Mbps and then accept
the replacement track. The framerate-lock scenarios exercise delivery and
replacement; they do not assert a constant frame rate under every load.

Playout is measured by decoding frame numbers drawn into generated video and
comparing their source timestamps with actual displayed frames:

| Requested delay | 39.8.10-qp20 measured median | 43.3.0-qp20 measured median |
| --- | --- | --- |
| 0 seconds | 39 ms | 30 ms |
| 2 seconds | 2,010 ms | 2,005 ms |
| 15 seconds | 36 ms — fails request | 15,003 ms |
| 60 seconds | Not tested | 60,001 ms |
| 600 seconds | Not tested | 600,000 ms after 30 seconds of settling |

The first 600-second attempt, observed for only seven seconds after the requested
buffer duration, failed: median delay was 598.798 seconds and source timestamps
advanced only 263 ms in the final three seconds. A fresh run with 30 seconds of
settling passed: 599.9996-second median delay, 3,004 ms of source progress in the
final observation window, 30 fps, 901 decoded frames and zero reported freezes.
This validates the low-complexity generated stream, not arbitrary high-bitrate
or lossy-network ten-minute buffering.

The default runtime reports a `playoutDelayHint` of 15 even when actual playout
does not delay. The source inventory discrepancy documented in
[maintenance-review.md](maintenance-review.md) remains relevant. Do not infer the
two custom binaries contain identical native patches.

The two-minute lower-concurrency 1080p repeats also show an initial video gap
(1.104 / 1.135 seconds). After two seconds, maximum gaps are 40 / 41 ms. Thus
startup behavior also occurs with less concurrent test load; the cause is not
established and was not hidden by adding a recording warm-up delay.

Cursor suppression is **not verified visually**: the owned-window capture test
did not include a cursor even in its explicit visible-cursor control. Both page
hooks/preferences are installed, but this cannot prove cursor suppression in a
real screen-share path. The test captures no unrelated desktop content.

## Endurance and current package results

### Hour-long published-package recordings

Both beta.3 portables completed an hour of generated 1280×720 video (target
60 fps, 2 Mbps) with generated audio. Independent full-track FFmpeg decoding
found no errors or timestamp reversals. The initial video gap remains visible;
these results establish completeness and sync, not gap-free recording.

| Metric | v39 portable | v43 portable |
| --- | --- | --- |
| Decoded video / audio frames | 221,349 / 60,000 | 221,357 / 60,000 |
| Mean encoded fps | 61.49 | 61.49 |
| Final A/V offset / change | +56 / +29 ms | +36 / +15 ms |
| Initial maximum video gap | 1.231 s | 1.119 s |
| Maximum gap after 2 seconds | 116 ms | 116 ms |
| First / last aggregate private memory | 535 / 742 MB | 497 / 1,118 MB |
| Peak private memory | 769 MB | 1,122 MB |
| Late-minus-early mean private memory | +21 MB | +343 MB |

The v43 main process accounts for much of the sustained growth. This is an
unresolved finding to investigate before stable promotion; the test does not
identify a leak's cause. The v39 post-warm-up readings are substantially flatter.
These recordings used beta.3 binaries; the later window-retention fix is tested
separately and must not be assumed to resolve this single-window workload.

### Published 2.23.5 recordings before the Windows pin refresh

Both `65b14d9` portable builds completed ten-minute 1920×1080 generated recordings
(target 60 fps, 6 Mbps), with full decoding, completeness and sync checks passing.

| Metric | v39 portable | v43 portable |
| --- | --- | --- |
| Decoded video frames | 36,818 | 36,827 |
| Mean encoded fps | 61.37 | 61.38 |
| Final A/V offset / change | +46.5 / +23.5 ms | +50.5 / +34.5 ms |
| Initial maximum video gap | 1.392 s | 1.248 s |
| Maximum gap after 2 seconds | 55 ms | 49 ms |
| Peak private memory | 872 MB | 913 MB |
| Late-minus-early mean private memory | +118 MB | +165 MB |

The same startup gap and growing memory remain observable. Neither is hidden by
the analyzer's `passed` field, which checks decode/completeness/synchronization.
Ten-minute memory comparisons include warm-up; the hour-long comparison above
uses the established early/late windows rather than the first sample.

### Intermediate 2.23.4 recordings

Both ten-minute generated 1920×1080 recordings (target 60 fps, 6 Mbps) fully decode
without errors or timestamp reversals. The draw timer produces approximately
62.5 source frames per second; observed encoded rates are reported below rather
than claiming exact 60 fps. Audio/video completeness and sync pass. This pass
does not mean startup is gap-free or that memory is bounded.

| Metric | v39 portable | v43 portable |
| --- | --- | --- |
| Decoded video frames | 36,816 | 36,822 |
| Mean encoded fps | 61.36 | 61.37 |
| Audio/video end offset | +53.5 ms | +44.0 ms |
| Change in A/V offset | +14.5 ms | +28.0 ms |
| Maximum video gap | 1.408 s at startup | 1.296 s at startup |
| Maximum gap after 2 seconds | 63 ms | 57 ms |
| Peak aggregate private memory | 893 MB | 912 MB |
| Late-minus-early mean private memory | +122 MB | +165 MB |

The lower-concurrency two-minute repeats decode cleanly and retain sync (offset
changes +9.5 / +12.5 ms), but still show the startup gaps described above. Their
private-memory increases are approximately 38 / 41 MB from first to last sample.
These figures do not establish a leak or dismiss memory growth. A separate
6,000-small-GET diagnostic, including enabled/disabled/restored response-header
hooks and test-only garbage collection, returns JS heaps near baseline on both
runtimes; it does not reproduce the long recording workload or identify its cause.

### Downloaded packages

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

Both also pass real second-process deep-link routing: window options are consumed,
the named browsing context is reused, and `node=true` in the URL remains a page
parameter without enabling Node. This uses an isolated loopback HTTPS fixture
with only its disposable certificate's SPKI exempted in the test process. It does
not modify OS protocol associations or test the registered-handler launch path.

ASIO soak totals: 51,678 callbacks / 26,459,136 samples on v39 and 51,677 callbacks /
26,458,624 samples on v43, with zero reported input/output underflows. Samples were
counted and discarded. Process private memory stayed approximately 234–235 MB
and 203–204 MB, respectively; these ten-minute observations do not prove unbounded
memory stability.

| New portable | SHA-256 |
| --- | --- |
| `elecap.exe` | `24246a79faedc1739167a2641d9f990996dbcb60ddb0fe5291b6a5e85b940aab` |
| `elecap-win11.exe` | `69928b62f418462afc62bb03bbb3968f0a335cd1172535db1c5cfd1e94633d82` |

The initially published `2.23.5` packages embed the correct version and match `65b14d9` source
after line-ending normalization. Their native binaries match between custom
runtime variants, their security fuses match the configured policy, and the four
downloaded installers/portables match GitHub's hashes and pinned timestamped
signer. Both final portables also pass the complete packaged workflow/deep-link
test. The 2.23.4 entries above are retained as intermediate evidence, not relabeled
as final-package results.

| Initial 2.23.5 portable (before Windows pin refresh) | SHA-256 |
| --- | --- |
| `elecap.exe` | `290838c301a1f627907c67dd23734a78366367619bcf09a6d9b8a151749eb797` |
| `elecap-win11.exe` | `d87d96e6f36d817c6f095697cf8f436c980fdfc58a18feb635850c6c3fba49f4` |

The exact packaged process-audio and ASIO native modules from these two 2.23.5
downloads also pass 100-cycle ownership, reload/close and renderer-recovery tests
through the real app's IPC handlers. Native module hashes match between variants.
The ASIO runs are sequential: an overlapping attempt competed for the same
exclusive ASIO4ALL driver and is not counted as a pass. A test-only ASAR stat
mistake was corrected to use `original-fs` before those successful runs.

### Windows fullscreen pin correction

The expanded Cartesian matrix exposed pinned fullscreen windows losing their
native topmost state after minimize/restore and click-through changes on both
custom runtimes. The native implementation's `floating` level explicitly moves
behind the taskbar; Explorer lowering that taskbar can clear TOPMOST too.
The Windows restore path now uses a level above the taskbar and runs on show,
restore, enter-full-screen and leave-full-screen. The level remains above the
taskbar on exit because the exit event precedes Explorer restoring the taskbar.
Explicit `--no-pin` and temporary dialog pin suspension remain respected.
Mac/Linux level choices and both custom Electron binaries remain unchanged.
Loading the original published `65b14d9` ASAR reproduces the click-through pin
failure too (`elecap-window-workflows-QjXUcJ`); this is not only a checkout fixture
failure. The fix is built from `f29bca1` in Windows-only CI run `41946278196`.

The matrix now waits for the taskbar transition and checks fullscreen exit too.
Source artifacts are `elecap-window-workflows-zNQt1Y` (v39) and
`elecap-window-workflows-yY05HH` (v43), both with 45 passing scenarios and 542
checks. Both runtimes also repeat the five native compositor states, five real
mouse/click-through/focus cycles, a real edge drag, and all 14 dialog checks
successfully after the correction.
The closed-window test also repeats successfully after the new native listeners:
20 of 20 closed wrappers are collected on each runtime, with listener counts
returning to baseline (`LaFBPZ` / `QENzwr`).
Windows-only build [41946278196](https://github.com/steveseguin/electroncapture/actions/runs/41946278196)
passes all three applicable jobs: validation, Windows x64 and Windows ARM64.
The x64 job includes both custom runtimes and signed installer
39→43→39 replacement/rollback followed by uninstall. Mac/Linux jobs are
intentionally skipped; their existing downloads are preserved.

All six Windows ZIPs pass local archive integrity checks. The six outer
executables and both extracted x64 executables pass pinned Authenticode signer
and timestamp verification (the expected self-signed-root trust limitation still
applies). All three extracted ASARs embed `2.23.5` and their `main.js` matches
`f29bca1`; executable architectures and security fuses also pass. The newly built
x64 native modules match between variants. ARM64 retains official Electron
43.8.7 and does not gain ASIO or custom x64 WebRTC patches; no local ARM64 GUI
execution is claimed.

| Refreshed portable | SHA-256 |
| --- | --- |
| `elecap.exe` | `7f723eace58faf1508d502e0e27e1a276b753b669f8c22086d3b13a762ffeb18` |
| `elecap-win11.exe` | `c8e0b35dc188e0f28fed2359f46bbe76c529ca74942e13f06a05eb2afe4f71f4` |
| `elecap-2.23.5-win-arm64-portable.exe` | `bd1e9db094f5f886aae3570792fc1821c91d825c0244365dcf70f631b456fb40` |

Both refreshed x64 ASARs pass the full 45-scenario / 542-assertion matrix again,
loading their packaged main process, preload and dependencies in the matching
custom runtime (`bGu5jI` / `off6P4`). Both also pass all five native compositor
states, five actual mouse/click-through/focus cycles and an edge resize, 14 dialog
checks, and owned-window capture at three sizes. Their freshly compiled
process-audio modules pass 100 source replacements plus reload/close/crash
recovery, and their ASIO modules pass 100 sequential input-stream cycles each.

The actual signed SFX launchers separately pass cold launch, process restart,
persistent cookies/storage, CSS/JS injection, reload, second-process named-window
reuse, deep-link routing and explicit Node-mode separation (`jY1Saq` / `yxg5UR`).
Disabled Node environment-injection fuses remain effective in those launches.

Fresh two-minute generated 1080p recordings from the signed SFX downloads fully
decode, retain sync, and contain no reversed timestamps (`egWUvj` / `1IMCDg`):

| Metric | Refreshed v39 | Refreshed v43 |
| --- | --- | --- |
| Decoded video / audio frames | 7,297 / 2,000 | 7,305 / 2,000 |
| Mean encoded fps | 60.81 | 60.89 |
| Final A/V offset / change | +47 / +14 ms | +36.5 / +31.5 ms |
| Initial maximum video gap | 1.377 s | 1.215 s |
| Maximum gap after 2 seconds | 42 ms | 47 ms |

The initial gap remains; these short runs do not resolve or supersede the
hour-long memory finding. All refreshed-package functional gates pass, with
those existing media/runtime limitations explicitly retained for prerelease
evaluation. Selected machine-readable reports, including the failing original
package reproduction and runtime stress limits, are attached to the release.

The GitHub release stays a prerelease with normal version `2.23.5`. Its original
tag continues to identify the Mac/Linux build; the Windows refresh commit is
explicitly identified here and in the release metadata rather than moving that
already-published tag.

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

The packaged workflow test takes `VALIDATION_EXECUTABLE` pointing to a portable
SFX. Optional `VALIDATION_TLS_CERT` / `VALIDATION_TLS_KEY` enable the loopback
deep-link fixture; use a disposable localhost certificate, never a production key.
`VALIDATION_PLAYOUT_SETTLE` extends the post-buffer observation window (default 7
seconds). The latency test also checks that source timestamps keep advancing, so
a frozen old frame cannot be mistaken for successful buffering.
`VALIDATION_PACKAGED_APP` selects an extracted `resources/app.asar` for window
matrix, native mouse, compositor and dialog tests. These load the packaged main
process, preload and dependencies using the matching custom runtime, while the
separate portable workflow exercises the actual signed SFX launch/reuse path.

## Follow-up order

1. Before stable promotion, isolate the recording startup gap and v43 sustained
   memory growth with a bare Electron control and matched media/network workloads.
   Compare main, renderer and GPU private memory after warm-up; require a bounded
   long-session result rather than assuming the closed-window fix addresses it.
2. Preserve both existing custom runtimes and rollback packages while reconciling
   exact Electron/Chromium/WebRTC/FFmpeg revisions, native patches, GN arguments
   and artifact hashes. Do not substitute SSN's non-resizable Windows 10 window
   workaround for Electron Capture's working resize behavior.
3. Rebuild the reconciled custom patch set on a supported Electron patch release
   in an isolated checkout. Separate window transparency/frame fixes from codec,
   cursor, adaptive-scaling and long-buffer changes so failures can be attributed.
4. Gate replacement on these behavior tests plus actual Windows 10, mixed-DPI
   monitors, OBS alpha capture, visible-cursor controls, hardware-specific codec
   and QP measurements, and physical device unplug/reconnect. Keep a known-working
   installer available throughout testing.
5. Resolve the remaining build-tool advisories through tested upstream updates;
   retain strict production/native dependency audits. The temporary prerelease
   exception does not repair or justify indefinitely retaining vulnerable tools.

Promote a replacement only after signed-package install/upgrade/rollback and
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
