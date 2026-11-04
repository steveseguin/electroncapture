# Windows runtime validation — September 5, 2026

These checks use temporary profiles and local fixtures. No release was published
or installed over the user's app. The generated recordings are not physical
camera/microphone recordings or a VDO.Ninja end-to-end test.

## November 4, 2026 Windows follow-up

Host: Windows 11 Pro 10.0.26200, x64, one display at scale 1. Tests use temporary
profiles. The default installed custom runtime remains 39.8.10-qp20; the
43.3.0-qp20 archive was downloaded, checked against its pinned SHA-256, validated
for ZIP traversal, and extracted separately under `%TEMP%`.

| Check | Result |
| --- | --- |
| `npm.cmd test` | All 21 regression suites passed, including new cross-window fetch and forged/missing local checksum cases. |
| Real Electron startup smoke | Passed on the default runtime. |
| `test:window-workflows` | 91 checks passed on each custom runtime: window pin/restore, click-through state and shortcut, fullscreen bounds, resolution changes, renderer alpha, CSS/JS, Node mode, reload, reuse and multi-window behavior. |
| `test:windows-alpha` | Five native compositor states passed on each runtime: initial, resized, unfocused, restored and changed backdrop. Transparent/opaque/half-alpha regions matched equivalent opaque reference compositions. |
| `test:webrtc-smoke` | VP8, VP9 and H.264 loopback encoding and decoding passed on each runtime, with no external signaling/ICE servers. |
| `test:native-audio` | Passed on each runtime: source-specific 440/660 Hz loopback, old-owner stop, six replacements, source exit and recovery. |
| Generated recording | Default runtime: 15-second normal, 10-second window-close and 10-second app-quit recordings decoded successfully. End offsets were approximately 61, 59 and 5 ms. |
| Unpacked builds | Both variants built with electron-builder 26.18.0. App version, changed runtime source, native binaries, file exclusions and disabled Node/debug/environment-injection fuses were checked. |
| Packaged recording | Ten seconds on each unpacked build decoded without errors; audio/video end offsets approximately 43 ms (v39) and 33 ms (v43). |
| Audits | Production npm dependencies and both native lockfiles: zero vulnerabilities. Root build dependencies: 19 moderate and one high affected dependency entries; release audit still fails. |

The compositor test uses native Windows screen sampling of only its fixture
rectangle. A fully opaque reference window accounts for desktop RGB/color
conversion; it does not substitute renderer-only `capturePage()` for native
compositing. Run desktop tests sequentially on an unlocked desktop. Other windows
or user interaction covering the fixture can legitimately fail these checks.

WebRTC QP averages were about 1.6-1.7 for VP8, 5.6-6.3 for VP9 and 2.4 for H.264
on the simple generated fixture. Averages do **not** verify a per-frame QP ceiling,
hardware acceleration, stress behavior or custom field-trial enforcement.
Default v39 VP8 adapted to 480x270; the other cases delivered 640x360. These tests
leave adaptation enabled and do not assert resolution locking.

Artifacts (all paths below are relative to `%TEMP%`):

- Window workflows: `elecap-window-workflows-4DXTsj` (v39),
  `elecap-window-workflows-VckpBP` (v43).
- Final compositor checks: `elecap-windows-alpha-amZ2iy` (v39),
  `elecap-windows-alpha-evgG9D` (v43).
- WebRTC: `elecap-webrtc-smoke-TM3ZWw` (v39), `elecap-webrtc-smoke-Ksh8c8` (v43).
- Native audio: `elecap-native-audio-y9nn3R` (v39), `elecap-native-audio-22BCaq` (v43).
- Recording/FFmpeg analyses: `elecap-recording-validation-PXvVJC` (development),
  `elecap-recording-validation-j6gOjF` (v39 package),
  `elecap-recording-validation-CkLd8F` (v43 package).
- Unpacked build outputs are in `dist/review-20261104-win10/win-unpacked` and
  `dist/review-20261104-win11/win-unpacked`. These are unsigned local validation
  builds, with executable resource editing disabled; they are not release installers.

Reproduce the native tests against the installed development runtime:

```powershell
npm.cmd test
npm.cmd run test:window-workflows
npm.cmd run test:windows-alpha
npm.cmd run test:webrtc-smoke
npm.cmd run test:native-audio
```

Set `VALIDATION_ELECTRON` to an extracted, verified alternate `electron.exe` for
the four opt-in integration commands. Use `VALIDATION_EXECUTABLE` instead for
`test:recording-endurance` against a packaged app. The normal suite does not open
native windows or capture physical media.

Still unverified here: an actual Windows 10 host, physical cameras/microphones,
mixed-DPI displays, OBS capture, mouse-driven resize/click-through, ASIO hardware,
hardware codec selection, custom cursor/scaling/delay semantics, long soaks,
installer replacement/rollback and release signing. See the
[maintenance review](maintenance-review.md#windows-follow-up-november-4-2026)
for the runtime upgrade plan and source-provenance findings.

## September findings requiring attention

1. **Native application-audio replacement fixed and retested.** The old stream's
   asynchronous finalizer cleared the replacement callback. Native stop now owns
   state cleanup exclusively, and the unnecessary finalizer is removed. Abort
   releases the sole producer reference without a second release. The rebuilt
   module passes A-to-B capture with isolated 440/660 Hz tones, stopping the old
   owner, and six consecutive capture replacements with live packets.
2. **Process-loopback status fixed.** The JavaScript wrapper now accepts the native
   `usingProcessSpecificLoopback` field and retains compatibility with the older
   `usingProcessLoopback` field. Real native capture reports true and the frequency
   check confirms isolation of each generated source.
3. **Fullscreen fallback fixed.** On the available Windows monitor, requesting
   fullscreen expands the capture window to 1920×1080, while `isFullScreen()` remains
   false. Resolution changes now use the app's existing `window.full` fallback to
   exit fullscreen before sizing, and startup fullscreen initializes that flag.
   The real-device validation now exercises this path without manually exiting
   fullscreen first and passes. The underlying Electron getter discrepancy remains.
4. **Short close-path recording timestamp warning.** All three short recordings
   decode, but FFmpeg reports one duplicate/non-monotonic video timestamp in the
   close-path canvas fixture. The analyzer conservatively flags this recording.
   Normal and quit files pass without warnings. The source of the duplicate
   timestamp is not established; it may be specific to the generated canvas source.

## Completed checks

| Check | Result |
| --- | --- |
| Standard automated tests | All 18 regression suites passed. |
| Ubuntu WSL automated tests | All 18 regression suites and the real-Electron smoke test passed using Electron 43.3.0 and WSLg. |
| Real Electron smoke | Passed page loading, injection, reload, independent windows, and repeated quit. |
| Standard Windows package | Fresh Electron 39.8.10-qp20 installer, portable executable, and ZIPs built in `dist/validation-win`; package verifier passed. |
| Windows 11 package | Fresh Electron 43.3.0-qp20 artifacts built in `dist/validation-win11`; package verifier passed. |
| Package signing | Skipped by the existing signing hook: local certificate unavailable. These are unsigned validation artifacts. |
| Packaged recording | Each unpacked Windows runtime recorded generated VP8/Opus media for 10 seconds, stopped normally, and exited. Both files decoded with no warnings. Audio/video end offsets were about 17 ms and 35 ms. |
| Windows portable executables | Both portable artifacts launched, recorded for 10 seconds, and exited. Both files decoded without warnings; end offsets were about 42 ms and 20 ms. |
| Linux packaged recording | The unpacked Linux executable and AppImage (extract-and-run mode under WSLg) each recorded for 10 seconds and exited. Both files decoded without warnings; end offsets were about 2 ms and 10 ms. |
| Linux build | AppImage, DEB, and RPM built successfully after installing the missing RPM tooling. DEB/RPM metadata was inspected. Artifacts copied to `dist/validation-linux` in the Windows workspace. |
| Development recording exits | Generated recording stopped normally (5 seconds), on closing one window (10 seconds), and on repeated app quit (10 seconds). All produced files; close-path timestamp warning noted above. |
| Available audio inputs | Default and explicit Realtek Stereo Mix opened with live tracks, then released. No physical microphone was detected. |
| Available camera | OBS Virtual Camera opened at 1280×720, approximately 30 fps, then released. No physical camera was detected. Image quality was not assessed. |
| Audio destinations | Default/explicit display output and Realtek Digital Output accepted sink selection. This does not establish audible playback at those connectors. |
| Separate download destinations | Two real app windows downloaded the same filename into their own specified folders; bytes and paths verified. |
| Window sizing | 1280×720 and 640×360 sizes applied at the available monitor's 100% scale. Fullscreen discrepancy noted above. |

## Endurance run

The one-hour development-runtime run was launched with generated 640×360 video
and a 48 kHz tone. It streams recording chunks to a local file, samples process
memory every 30 seconds, and opens/closes a second window roughly once per minute.
After the hour it tests 10-second close and quit recordings again.

**Completed: 3600 seconds recorded, with normal/close/quit files decoded.** The
strict analyzer flags nine duplicate video timestamps in the long canvas recording
and one in the quit recording. The long file ends within 76 ms between audio and
video; the offset changed by about 61 ms over the hour. Early versus late average
private memory increased by about 11 MB (395 to 406 MB); this does not establish
the absence of all leaks. The run is not described as a clean pass. Artifacts:

`C:\Users\Steve\AppData\Local\Temp\elecap-recording-validation-YzigMh`

`result.json` and `analysis.json` contain the completed recording and analysis results. Memory growth requires interpretation;
a generated-media soak cannot establish physical-device latency or speech/music quality.

A separate 15-minute Linux development recording runs under WSLg in parallel,
with artifacts at `/tmp/elecap-recording-validation-WjxzUp` in Ubuntu. Its analyzer
was started, but its temporary directory is no longer present after resuming the
session. Its completion cannot be verified and it is not counted as passed.

Other retained evidence directories under `%TEMP%`:

- `elecap-recording-validation-hS4HEl`: development normal/close/quit files and analysis.
- `elecap-recording-validation-2RKwUj`: standard packaged recording and analysis.
- `elecap-recording-validation-I15bbc`: Windows 11 packaged recording and analysis.
- `elecap-device-validation-VjFFDF`: available devices, resize/fullscreen state, download files.
- `elecap-native-audio-u2LOHH`: first native replacement failure with packet counts and logs.
- `elecap-native-audio-PIaebH`: repeated native replacement failure.
- `elecap-recording-validation-BWRUaP` and `elecap-recording-validation-sQHtg5`: Windows portable executable recordings.

Linux source/build workspace: `/tmp/elecap-validation-20260905` in Ubuntu WSL.
Build logs: `/tmp/elecap-validation-build.log`. The initial build produced AppImage
and DEB but failed at RPM because `rpmbuild` was absent. RPM build tooling was
installed through Ubuntu's package manager and the subsequent build passed. The WSL
environment is separate from the Windows working tree. Packaged Linux recording
evidence is in `/tmp/elecap-recording-validation-Ve12AV` and
`/tmp/elecap-recording-validation-EjuYEb`.

## Remaining external checks

- USB microphone/camera unplug and reconnect: no such device is currently available.
- Mixed-DPI monitor movement: Electron detects one display, scale factor 1.
- Speech/music quality and 15–30-minute physical capture recordings, including close/quit.
- Visual cursor/menu checks and human listening to output routing.
- macOS build/runtime testing: no accessible machine supplied. Linux has been
  tested under WSLg; native Linux desktop/device testing remains outstanding.
- Installer installation/uninstallation and signed-artifact verification. The generated
  installers were structurally verified but not installed over the user's app.

## Reproduction

These are opt-in tests, excluded from the normal fast suite and packaged files:

```powershell
npm.cmd run test:recording-endurance -- 3600
npm.cmd run test:runtime-devices
npm.cmd run test:native-audio
```

The device test briefly opens available inputs without saving their media. The
native-audio test plays two quiet tones. Each prints its temporary artifact path.
The device test returns failure for the recorded fullscreen discrepancy.

To test an unpacked package with a short generated recording:

```powershell
$env:VALIDATION_EXECUTABLE = (Resolve-Path dist/validation-win/win-unpacked/elecap.exe).Path
node test/recording-endurance.js 10
Remove-Item Env:VALIDATION_EXECUTABLE
```

To decode recordings, supply an installed FFmpeg executable:

```powershell
node test/analyze-recordings.js <artifact-directory> <ffmpeg-executable>
```

For this session, FFmpeg was obtained through `imageio-ffmpeg` into the temporary
`elecap-validation-tools` directory; no application dependency was added.

## Resume validation

The native module was rebuilt with Visual Studio 2022. Fixed native results:
`%TEMP%/elecap-native-audio-mSb3jP/result.json` and
`%TEMP%/elecap-native-audio-JdewID/result.json` (six additional replacements).
Fresh fixed Windows packages are built separately in `dist/validation-fixed-win`
and `dist/validation-fixed-win11`; earlier validation artifacts predate this fix.
Both fixed package verifiers passed. Their bundled source and native binary match
the tested working tree. Both portable executables completed 10-second recordings
and decoded without warnings, with audio/video end offsets of approximately 16 ms
and 6 ms. Evidence: `%TEMP%/elecap-recording-validation-3orLqj/analysis.json` and
`%TEMP%/elecap-recording-validation-xDjzXf/analysis.json`. The 18 regression suites
and real-Electron smoke test passed again after the native rebuild. Signing remains
unavailable; these local builds are unsigned.
The unchanged intentional permissions and capture capabilities remain available.

## Remaining-concern follow-up

The full suite now includes 19 groups, including runtime ZIP preflight tests.
Real Windows device/download/fullscreen-resize validation passed at
`%TEMP%/elecap-device-validation-v3yBkN/result.json`, followed by the Electron smoke.

Dependency patches: `@xmldom/xmldom` 0.8.13 → 0.8.15 and `fast-uri` 3.1.5 → 3.1.6.
Both native-module lockfiles audit clean. The root audit retains one high advisory:
[extract-zip symlink traversal](https://github.com/advisories/GHSA-jmr9-qjv8-65gv),
for which no upstream patched version is listed. This is installation tooling,
not a permission setting or the app's arbitrary URL/no-CORS feature. The sole
application-owned extraction call now checks all link targets and link chains
before extraction. Internal macOS framework links remain supported; escaping,
absolute, cyclic, and duplicate file paths are rejected. Existing download checksums
remain in use. Synthetic valid/malicious ZIP tests and a real cached Windows
Electron archive pass the preflight. This mitigates this installer's usage; it
does not patch the upstream package or suppress the audit finding. Locally selected
runtime archives remain supported. Full macOS archive/runtime validation is pending.

Timestamp investigation confirmed the FFmpeg warning persists with a finer output
time base. It is not merely output rounding. Detailed counts from concurrent
showinfo/ashowinfo logging proved unreliable, so the analyzer's conservative
warning-based result is retained. The generated canvas source and encoder need a
separate controlled reproduction before attributing this to the capture app or
changing user recordings. No automatic re-encoding or timestamp rewriting was added.

Physical USB reconnect, mixed-DPI monitors, macOS, signing, and subjective media
quality still require unavailable devices/credentials or human observation. These
are validation gaps, not silently passed tests. The prior Linux endurance result
remains unverified because its temporary evidence no longer exists.

The follow-up unpacked Windows build succeeded in `dist/validation-followup`.
Its 10-second generated recording decoded without warnings, with a 3 ms stream
end offset: `%TEMP%/elecap-recording-validation-UJWCZq/analysis.json`.

## Further Windows validation and fixes

- GitHub's Dependabot API now reports only one open alert, number 187 for
  `extract-zip`. The production-only root audit reports zero vulnerabilities.
  The advisory remains open because the upstream version remains unpatched;
  the installer mitigation is not represented as an upstream dependency fix.
- Native audio stop failures now retain capture ownership for retry. The session
  manager recognizes boolean `false` as failure as well as failure objects/errors.
  Both streaming and polling starts refuse to replace a capture whose stop failed;
  their existing failure return conventions are preserved. Regression tests inject
  boolean, object, and thrown failures through the real JavaScript wrapper.
- The real native test still passes repeated switches and now terminates the active
  generated source process before capturing the other source. Recovery delivers
  packets: `%TEMP%/elecap-native-audio-IMtTYR/result.json`. This is process-exit
  recovery, not a physical USB unplug test.
- Installer download/checksum/ZIP preflight failures no longer delete the currently
  installed Electron runtime. A subprocess regression with a corrupt local archive
  verifies the original runtime remains intact. Extraction/disk failures after
  replacement starts can still require reinstalling; this is not a full transaction.
- ZIP preflight canonicalizes alternate path spellings before matching links and
  duplicate destinations, covering `./dir/link` and redundant separators.
- OBS Virtual Camera plus generated audio recorded for approximately 62 seconds,
  followed by 10-second close and quit recordings. All three files decoded without
  warnings; stream end offsets were within 37 ms. Evidence:
  `%TEMP%/elecap-recording-validation-BENBsr/analysis.json`. This shorter source-specific
  pass does not dismiss the earlier long canvas-source warnings or establish
  subjective camera/speech quality.

To repeat this explicitly selected camera test in PowerShell:

```powershell
$env:VALIDATION_CAMERA_LABEL = 'OBS Virtual Camera'
node test/recording-endurance.js 60
Remove-Item Env:VALIDATION_CAMERA_LABEL
```

The test fails if the exact camera label is unavailable; it never silently selects
a different camera. It retains the resulting video files in its printed temporary
directory. All 19 regression suites and Electron smoke passed, and the updated
unpacked Windows build succeeded in `dist/validation-stop-retry-final`.

The initial 10-second packaged canvas fixture reproduced duplicate timestamp
warnings (`%TEMP%/elecap-recording-validation-1IsqgK/analysis.json`). The fixture now
requests a canvas frame immediately after each completed drawing instead of using
an independent capture timer. A fresh 10-second packaged recording passed without
warnings (`%TEMP%/elecap-recording-validation-FJOGxD/analysis.json`, 42 ms stream end
offset). This improves the test source, not the app's recording pipeline. A longer
run is required before claiming the earlier intermittent canvas warnings resolved.
