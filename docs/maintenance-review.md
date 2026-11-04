# Security and reliability review — November 4, 2026

The current follow-up integrates upstream 2.23.4-beta.3 and preserves the custom
Windows runtime pins. Source changes are integrated with the upstream macOS
prerelease work on `master`; Windows binaries were built from `d6e8051`.
The earlier September findings and evidence are retained below.

## Windows follow-up, November 4, 2026

### Beta.3 prerelease preparation

Integrated upstream `01eeaaf` / `dff1aab`, including the macOS unpinned
click-through restoration fix. The expanded window matrix passes 156 checks on
each custom Windows runtime, plus five native compositor states per runtime.
The inherited fullscreen-startup assertion also needed the Windows native-state
correction: actual display coverage is tested, not merely the app's state flag.

The Linux X11 integration run found a `MaxListenersExceededWarning` while
leaving fullscreen: ten existing window-close listeners plus a temporary resize
cleanup listener exceeded Node's default threshold. All functional assertions
passed, but the warning correctly failed the integration gate. Consolidated the
standalone close diagnostic into the existing timer-cleanup listener; neither
cleanup nor the warning gate was removed. All 156 X11 window checks then passed
on official Electron 43.8.7 under Xvfb/Openbox, as did all three WebRTC codecs.

CI checkout now uses the ordinary repository token for the public app and a
read-only deploy key only for the private native repository, at the exact parent
gitlink revision. The previous private checkout credential failed authentication;
a replacement repository-scoped read-only key was installed without exposing or
retaining its private material locally.

For the requested beta.3 prerelease, manual release builds may explicitly select
`reviewed_prerelease_tooling`. This accepts exactly four reviewed **development
tooling** advisory URLs in the audit report: the two extract-zip symlink
advisories, minimatch globparts amplification, and glob cancellation traversal.
They remain unfixed and visible in the uploaded full report. These tools process
the checked-in file patterns and release archives, not renderer input. Runtime
ZIPs are checksum-pinned, and the application-owned extraction has ZIP preflight
validation; this is mitigation, not a patch for every third-party extractor.
Forced minimatch/glob major overrides would change build APIs; extract-zip has
no published patched version. Neither is justified as a low-risk app update.

`scripts/audit-prerelease-dependencies.js` restricts the exception to
`2.23.4-beta.3`, expires it on December 4, 2026, checks every affected package is
development-only, and rejects unknown advisories, invalid audit results and any
production dependency finding. Production and both native lockfiles still pass
strict audits; registry signatures are verified. Ordinary tag/stable builds and
`npm run audit:dependencies` retain their original strict gate. The explicit
manual path builds artifacts for review; it does not publish them automatically
or dismiss GitHub alerts. This supersedes the earlier statement that every
prerelease build must wait for all build-tool advisories to disappear.

Reviewed the beta.2 changes on Windows 11 Pro build 26200 and compared the local
`ssn_app` window compatibility code and custom Electron source. The follow-up
changes were committed in `1edfdd3`, followed by the CI checkout correction in
`5546895`. Neither custom Windows runtime pin was changed.

### Corrections made

- Fetch stream read/close IPC now verifies the requesting WebContents owns the
  stream. Previously another window knowing a stream UUID could consume or cancel
  it. This is defense in depth; UUID guessing or disclosure was not demonstrated.
- Local runtime ZIPs now use the trusted release checksum, just like downloads.
  A missing or attacker-supplied adjacent manifest can no longer bypass the
  installer checksum. The Windows 11 builder's explicit/local ZIP paths now also
  verify the pinned checksum before handing the archive to electron-builder.
  Failed verification preserves the installed development runtime.
- The private window-audio-capture submodule lockfile updates build-time Undici
  6.28.0 to 6.29.1. Its audit now reports zero vulnerabilities. Native repository
  commit `2ee4812` was pushed and the parent's gitlink updated in `1edfdd3`.
- Corrected the Windows fullscreen integration assertion to verify actual display
  coverage when native `isFullScreen()` reports false. The app already handled
  this native discrepancy; no fullscreen behavior change was needed.
- Added native Windows compositor and local WebRTC integration tests, plus
  alternate-runtime selection for window/audio checks. Updated stale README
  runtime versions and removed the claim that the old custom binaries contain
  current Chromium security fixes.

The initial malformed-fetch regression failure was caused by installed Undici
7.29.0 being older than the committed 7.30.1 lockfile. `npm ci --ignore-scripts`
and restoration of the existing custom Electron runtime resolved it. The test
was retained unchanged. Production dependencies and both native lockfiles audit
clean. Root build tooling still reports 19 moderate and one high affected
dependency entries, rooted in glob/minimatch/extract-zip advisories. These are
not 20 independent application vulnerabilities. The strict release audit remains
blocked; no forced major overrides were applied. The explicit beta.3-only
manual prerelease exception is described above.

### Compatibility decision and runtime update plan

1. **Keep this app update on the verified custom binaries.** Both
   `39.8.10-qp20` and `43.3.0-qp20` pass the Windows checks recorded in
   [runtime-validation.md](runtime-validation.md). This does not patch Chromium
   or establish Windows 10 compatibility from a Windows 11 host.
2. **Reconcile the exact patch inventory before rebuilding.** The local tree
   `C:\electron-work-v36\src\electron` is at `1db7db0b84`, matching the
   [39.8.10-qp20 release](https://github.com/steveseguin/electron/releases/tag/v39.8.10-qp20).
   Its committed history includes WS_THICKFRAME/translucency/DWM fixes, QP caps,
   and NVENC configuration. However the inspected WebRTC tree still has a
   10,000 ms `kMaximumDelayMs`, and no `WebRTC-DisableAdaptiveScaling`,
   `WebRTC-LockResolution`, or `WebRTC-LockFramerate` checks in
   `media/engine/webrtc_video_engine.cc`. The helper notes describe these features;
   the [43.3.0-qp20 release](https://github.com/steveseguin/electron/releases/tag/v43.3.0-qp20)
   also advertises them. Do not assume the v39 checkout represents the v43 patch
   set or that helper notes prove the shipped binaries' behavior. Record Electron,
   Chromium, WebRTC and FFmpeg revisions, patch order, GN args and artifact hashes
   for each supported variant. Preserve the existing working trees.
3. **Port to a supported candidate in an isolated source checkout.** First
   evaluate a current patch release on the v43 line while it remains supported;
   if it is outside support when building, use a supported branch. Electron
   [supports its latest three stable major lines](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).
   Rebase transparency/window-frame patches independently from codec QP caps,
   cursor constraint routing, scaling field trials, delay/buffer changes and
   FFmpeg/NVENC. Use upstream implementations when equivalent behavior is proven.
   A version bump in package.json cannot port these C++ changes or update a pinned
   custom runtime. Do not bulk cherry-pick Chromium security patches into v39
   without their dependencies and native build verification.
4. **Do not directly copy SSN's Windows 10 workaround.** In `ssn_app/main.js`,
   `applyPlatformWindowCompatibility` makes transparent frameless Win10 windows
   non-resizable. This agrees with the caution in Electron's
   [transparent-window documentation](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles),
   but removes a feature Electron Capture's native patches deliberately restore.
   SSN's OS/profile detection is a useful design reference, not proof that its
   stock Electron 44 runtime preserves this app's capture behavior.
5. **Gate candidate promotion on real behavior.** Run the existing regressions,
   156 window checks, native compositor checks, WebRTC codec delivery, process
   audio replacement, and packaged recordings on actual Windows 10 and Windows
   11. Also require mouse-driven edge resizing, OBS alpha capture, click delivery
   through overlays, mixed-DPI monitors, hardware codec paths/QP under load,
   cursor visibility, adaptive-scaling locks, long delay playback, physical
   camera/microphone reconnects and extended recordings. Sign/verify the packages
   and test installer replacement/rollback. Only then update runtime pins and
   checksums, with the prior installer available for rollback.

No new custom engine build or actual Windows 10 validation was performed.
The source inventory mismatch and outstanding native feature gates make an
automatic engine replacement inappropriate in this change. Current package
and platform validation is recorded in [runtime-validation.md](runtime-validation.md).

### Suggested work after beta.3

1. Reconcile custom runtime provenance and port the required native patches to a
   supported patch release in an isolated checkout. Keep the current installers
   available until the candidate passes the Windows 10/11 compatibility gates.
2. Run dedicated hardware coverage: real Windows 10, mixed DPI, OBS alpha,
   mouse resize/click-through, ASIO and device reconnects, hardware codec/QP and
   custom scaling/cursor/delay behavior, then multi-hour recording soaks.
3. Resolve the four build-tool advisories through upstream fixes or tested build
   API migrations; remove the beta.3 exception before its December 4 expiry.
   Do not force incompatible majors into the current dependency tree.
4. Investigate Linux cold-start audio timing before publishing the Linux CI
   packages, and validate Gamescope/Wayland plus remaining platform-specific
   reports on their actual environments. Keep unresolved issues open until the
   reported behavior, rather than a nearby unit test, is verified.

## November GitHub review

| Reports / PRs | Disposition |
| --- | --- |
| #39 | Closed after checking the original reporter's confirmation that doubled Retina dimensions were fixed. Current resolution tests also pass; this does not close other mixed-DPI/OBS reports. |
| #66 | Closed the exact Node/npm patch-version `EBADENGINE` failure. Current minimum-version ranges, clean Ubuntu install, all 22 suites and Linux CI builds pass. Debian 11 runtime compatibility is not claimed. |
| #124 | `--class` and `--app-id` produce distinct native X11 WM_CLASS values in simultaneous processes. Left open pending Gamescope/Wayland grouping validation. |
| #122 | Closed the ARM64 build-availability request after publishing installer/portable artifacts verified on a native Windows ARM runner. Snapdragon/RTX hardware and native audio feature coverage remain separate; release availability is not hardware certification. |
| #152, #153, #156 | Already incorporated by #167: CommonJS startup compatibility, macOS shortcut ownership, and ASIO stream ownership. |
| #155 | Retained legacy navigation handler now serializes URL text; direct-handler regressions cover both frame depths and hostile quotes. Current Electron no longer emits this legacy event, so this is defensive hardening, not a demonstrated current-runtime exploit. |
| #123, #125, #150, #151 | Superseded by the installed dependency versions, including Undici 7.30.1 / 8.12.3 and node-gyp 13.0.2. |
| #143, #164 | Electron npm dependency updated to 44.10.2. Official packaged/runtime pins are independently updated from 43.3.0 to 43.8.7. An npm-only update would not update these shipped runtimes. |
| #154, #145 | Compatible dependency patches retained; electron-builder updated to 26.18.0 and the development cleanup CLI to rimraf 6.1.4. |
| #158, #160, #165, #166 | SHA-pinned setup-node, upload-artifact, and both CodeQL steps updated. |
| #137 | Deferred: electron-is-dev 3 returns a module namespace through `require()`, making the existing development-mode check incorrectly truthy in packaged apps. Requires an API migration. |
| #144 | Deferred major CLI upgrade. Yargs 18's basic factory works in the compatibility probe, but no security fix requires this migration; comprehensive compatibility with all existing CLI forms remains separate work. |
| CodeQL alerts 5 and 6 | Downloads use a fixed fixture function instead of interpolated JavaScript; the recording fixture returns a generic HTTP error while logging diagnostics locally. |
| macOS fuse reports | Both concern the older RunAsNode/debug/environment-injection configuration. Release verification checks both universal architecture slices; the published historical advisory remains valid. |

### Remaining security scope

Production npm dependencies and the ASIO lockfile audit clean. The root development
dependency graph still reports `extract-zip`, `glob`, and `minimatch` advisories
(including their dependent packages). The installer validates ZIP symlinks and
checksums before extraction, but this does not patch every third-party use of
`extract-zip`. No alert is dismissed merely to make an audit pass. The existing
strict release-workflow audit gate remains in place.

Windows x64 still requires the custom 39.8.10-qp20 / 43.3.0-qp20 runtimes for its
capture/encoding features. Updating official Electron does not fix those custom
binaries; rebuilding and validating them remains separate work. The Windows ARM64,
macOS, and Linux official pins are 43.8.7. Native Windows/Linux testing is not
claimed from this macOS host.

The Ubuntu Wayland click-through report #120 and macOS menu-bar fullscreen request
#112 remain open: the successful macOS window tests do not establish either fix.

### November validation and build

The application changes are committed on `master` at `be2a86f`. Version
2.23.4-beta.2 uses official Electron 43.8.7 on macOS. The universal DMG and ZIP
were built with electron-builder 26.18.0, signed with the Developer ID identity,
notarized by Apple, and checked with `npm run verify:darwin`. Both architecture
slices passed the security-fuse checks; artifact SHA-256 checksums were generated
and verified. No GitHub release was published by this review.

- All 21 regression suites passed, as did CLI help and workflow YAML validation.
- All 94 real macOS window checks passed: pinning, unpinning, visibility,
  click-through, minimized startup, native/Dock restoration, fullscreen,
  resolution changes, named-window reuse, multiple windows, shortcuts, and chroma.
- Native compositor alpha checks passed for transparent, opaque, and half-alpha
  content (measured alpha values 0, 255, and 128).
- All 14 available media devices passed the device checks, including the built-in
  camera/microphone, continuity camera, virtual camera/audio devices, and five
  outputs. After correcting a test fixture, both window downloads and the
  fullscreen/resize checks passed in a separate run using synthetic media.
- A 60-second generated audio/video recording and separate close/quit recordings
  decoded without errors and passed the synchronization threshold. The actual
  signed package also recorded and decoded a 15-second fixture successfully.
- Packaged Apple Silicon startup, explicit Node mode, custom CSS/JavaScript,
  isolated renderer mode, and rejection of Node environment injection passed.
  The Intel slice launched successfully through Rosetta; its initial 30-second
  cold-start timeout passed when retried with a 90-second allowance.

All 16 incorporated/superseded PRs and issues #119 and #41 were closed. PRs #137
and #144 remain open for the compatibility reasons above. The already-patched
private fuse report was closed after verifying the signed package; the published
historical advisory remains published. GitHub now reports zero open CodeQL and
secret-scanning alerts, with three open dependency alerts (minimatch and two
extract-zip advisories). This is not a claim that all security work is complete.

CodeQL passed for the application commit. Two other GitHub jobs remain failing:
the generated Pages workflow cannot clone the private native-module submodule,
and the commit-message enhancement service returns HTTP 429 after exhausting
its free quota. These do not invalidate the local build, but CI is not all green.
The strict dependency audit also remains a blocker for the release workflow.
Native Windows/Linux behavior and the custom Windows Electron runtimes still
require platform-specific follow-up.

### Maintenance follow-up: beta.3

The release remains focused on bug fixes, security fixes, and compatible updates.
A fresh registry check found no missing root patch/minor updates within the declared
ranges. The current custom Windows runtimes are the newest published builds of
that fork; this does not resolve their remaining upstream security-update gap.

Expanded native macOS testing reproduced one beta.2 regression: starting with
`--minimized --no-pin --unclickable` and restoring from the Dock unexpectedly
pinned the window. Restoration now distinguishes CLI click-through from the
menu/shortcut action that explicitly pins an overlay. Explicit pin changes and
named-window arguments reset that temporary pin choice.

All 21 regression suites and 161 native window checks pass after the correction.
The expanded matrix covers fullscreen startup and pinned/unpinned click-through
combinations, including minimized startup and restoring mouse interaction.
Version 2.23.4-beta.3 supersedes beta.2 for this correction.

The universal beta.3 app is signed and Apple-notarized. Both architecture slices
passed fuse verification; the bundled main process matches the tested source
exactly. Packaged Apple Silicon and Intel/Rosetta launch checks passed, including
CSS/JavaScript injection, explicit Node mode, renderer isolation, and rejection
of Node environment injection. A packaged 15-second audio/video recording decoded
without errors and passed synchronization checks. The DMG and ZIP passed their
integrity checks and SHA-256 verification. CodeQL passed for the fix commit
`dff1aab`. The dependency alerts and platform-validation limitations recorded
above still apply.

Before publication, additional beta.3 checks passed:

- A five-minute recording in the signed app decoded without errors. Audio/video
  ended 10 ms apart; offset change over the recording was approximately 67 ms.
- A separate recording run completed 15 minimize/hide/restore cycles and repeated
  secondary-window creation/closure. Normal-stop, window-close, and app-quit
  recordings all decoded and passed the synchronization threshold.
- All 14 available media devices, both window-specific downloads, and the
  fullscreen/resize checks passed together in a complete device-validation run.
- Native macOS compositor alpha values remained 0, 255, and 128.
- Local WebRTC send/receive in the signed app's isolated renderer decoded 270
  video frames and received audio; both streams reported zero packet loss.

[v2.23.4-beta.3](https://github.com/steveseguin/electroncapture/releases/tag/v2.23.4-beta.3)
was published as a macOS prerelease from `01eeaaf`, with the universal DMG, ZIP,
and SHA256SUMS. GitHub's asset sizes and SHA-256 digests match the local files.
The latest stable release remains v2.23.2. No Windows/Linux artifacts were
included in the initial macOS publication. The Windows follow-up above adds
separately verified Windows assets while preserving that Mac build and tag.

## September review

This source review focused on the Electron main process, preload bridge, audio
stream wrapper, native audio IPC, CLI documentation, and existing regression
coverage. It is not a complete native C++ audit or a cross-platform capture test.
Permissive browser/capture settings, optional Node integration, arbitrary URL
loading, and the no-CORS fetch feature remain available.

See [runtime validation](runtime-validation.md) for the subsequent Windows and
WSL Linux tests, including a native audio replacement failure found by real capture testing,
subsequently fixed and retested with repeated source switches.

## Fixed in this working tree

| Issue | Impact and correction |
| --- | --- |
| Shared session download listeners | Every window handled every download and could override its destination; closed windows retained listeners. Handlers now match the originating web contents and detach on close. |
| Recording path concatenation | A folder without a trailing separator produced the wrong filename/path. Paths now use `path.join`, honor updated arguments on reused windows, and use the system Downloads location on Windows/macOS or home directory on Linux for automatic recordings without an explicit folder. Synchronous destination errors are logged instead of escaping the download event handler. |
| Window IPC cross-talk | Version and push-to-talk messages updated other windows and left listeners behind. These handlers now match the sender and detach on close. Global shortcut ownership is handled by the shared shortcut registry. |
| Fetch stream ID collisions | Requests created in the same millisecond overwrote each other. IDs now use UUIDs. |
| Fetch connection leaks | Fetches now abort on main-frame navigation, renderer crash, or destruction, including requests awaiting headers. Failed HTTP response bodies are cancelled. Ended streams release lifecycle listeners. |
| Empty responses and multipart boundaries | Successful responses without bodies no longer fail on `getReader`; quoted multipart boundary values are parsed without the quotes. |
| Failed audio startup leaked resources | Failure after native capture started now runs the full stop/cleanup path. The Web Audio context uses the sample rate returned by native capture and resumes if suspended. |
| Partial audio graph and cleanup failures | Destination tracks are retained for cleanup immediately after creation, including processor setup failures. Cleanup clears resource references even when unsubscribe, disconnect, or context close fails; callbacks retained by a failed unsubscribe ignore subsequent packets. |
| Unbounded audio backlog | The queue now retains roughly one second of recent samples, discarding older buffered audio under overload. Large chunks no longer use function-argument spreading, which could throw a `RangeError`. This deliberately favors live audio over replaying stale audio after a renderer stall. |
| YouTube timer accumulation | The existing ad-skip injection timer is cleared on navigation, reload, close, or injection failure. Rejected injection promises are handled. |
| Native window audio races | Start/stop operations are serialized. Pending and active captures track navigation, crash, and destruction. Stale callbacks and delayed cleanup cannot affect a replacement capture; a failed native stop prevents a conflicting start. Renderer wrapper operations are serialized too. |
| ASIO page lifecycle | Streams close on main-frame navigation, renderer crash, or destruction. Per-page listeners detach after the last stream closes, late callbacks are ignored, and callback setup failure closes the native stream. |
| Device menu cross-talk and missing replies | Requests now use IDs and sender matching, register before sending, and clean up on timeout or page exit. Replies over empty page areas no longer dereference a missing element; enumeration failures return an error. |
| Device selection dialog failures | Audio output, microphone, and camera menus validate selections and window lifetime after the dialog closes. Callback exceptions are logged and still release the temporary renderer target. Regression checks cover all four menu callbacks and failure cleanup. |
| Temporary microphone stream leak | Device enumeration now releases its permission stream even when enumeration fails. The legacy enumeration fallback rejects instead of leaving a promise pending. |
| Global shortcut ownership | Shared accelerators now dispatch to the most recently registered live window, falling back when it closes. Removing one window's binding does not unregister another's. Focus/blur uses per-window fullscreen bindings. OS conflicts and invalid accelerators fail without unregistering keys the app did not acquire. |
| Push-to-talk Shift modifier | Shift is now included in the requested accelerator; modifier-only or malformed requests clear the binding without throwing. |
| Numeric audio target matching | Leading-zero numeric strings now use the same client ID as the native IPC bridge, preventing silently discarded audio packets. |
| Capture source error replies | The legacy synchronous IPC source-list handler returns an empty list on enumeration failure rather than leaving the caller waiting. |
| App quit remained hidden/running | Window close handlers now allow the final app-wide quit after the existing 1.6-second grace period. Repeated quit requests share one timer and cleanup pass; a failing window cannot prevent other shutdown notifications. |
| Custom-code dialog failures | CSS and JavaScript values are serialized correctly for storage, including quotes and newlines. Unavailable storage does not block insertion, rejected prompts/injections are handled, and the always-on-top setting is restored. Arbitrary custom code remains supported. |
| Overlapping edit dialogs | General and custom-code dialogs share a temporary unpin counter per window. The original always-on-top state is restored only after the last dialog finishes, preventing early restoration over another open dialog. Restoration failures are logged rather than escaping as rejected promises. |
| Replacement screen-share audio cleanup | Ending an old share no longer stops the newer share's application audio. Cleanup checks the exact audio stream inside the operation queue, detaches listeners, and runs once. Shares ending during startup, retargeting during startup, and partial clone/attachment failures release their own resources without attaching stale audio. |
| Rejected navigation/injection operations | Fire-and-forget page loads, CSS insertions, and JavaScript injections now handle asynchronous rejection as well as synchronous failure. Expected superseded-navigation errors are ignored; other failures are logged. Arbitrary URLs and injected code remain allowed. |
| Extension load failures | The Chrome-extension menu handles rejected loads through the existing operation error handler and ignores cancelled/invalid selections or closed windows. Extension loading remains available with the same options. Regression coverage exercises the actual menu callback. |
| Cursor toggle style accumulation | The cursor option now tracks and removes its own inserted stylesheet. Turning it off restores the website's cursor and text selection instead of leaving selection disabled or forcing every element to an automatic cursor. Rapid toggles are serialized. |
| DPI compensation after moving windows | Moving between display scales or changing OS display scaling now updates compensation without navigation. Returning to standard DPI restores zoom to 1. The nodpi option is respected dynamically and global display listeners detach when a window closes. |
| Cursor/DPI options on window reuse | Changed hidecursor and nodpi options now apply to the existing page immediately instead of waiting for navigation or retaining startup-only settings. |
| Audio underruns and channel alignment | Playback consumes available complete frames and pads only the missing tail with silence. Partial interleaved frames remain buffered until complete. Latency trimming drops whole frames across queued and incoming samples so odd-sized chunks cannot shift stereo alignment. |
| Window bounds persistence | Bounds writes use a unique temporary file and rename, retaining the previous valid settings if writing fails. All rectangle fields are validated, negative monitor positions remain supported, pending move/resize changes flush on close, and destroyed windows retain no save timer. |
| Audio output routing | Per-element device changes are serialized and remembered only after success. An empty-string system-default selection remains a valid override. Page-wide fallback routing visits nested accessible frames and skips inaccessible frames without blocking the rest. |
| Overlapping per-element device menus | Each renderer menu request now retains its own DOM target. Selection uses the matching request ID; targets are released after the callback completes or on timeout/navigation/destruction. Release messages follow selection messages, and late enumeration results for released requests are ignored. |
| URL schemes and iframe editing | URL formatting preserves explicit schemes, accepts scheme-relative URLs, trims whitespace, and distinguishes bare host/port input. Iframe navigation serializes URL text correctly and handles an empty hit-test result or missing frame without throwing. |
| macOS extension manifest path | Extension discovery now joins the extension directory and manifest path with the proper separator instead of concatenating an erroneous dot. Native macOS discovery still needs testing. |
| Integration regressions found by real Electron | Removed a second startup URL rewrite that still corrupted data URLs; fixed a local URL variable shadowing the parser; cached web contents for DPI teardown after BrowserWindow destruction. Consolidated per-window IPC cleanup listeners instead of increasing the listener limit. |
| Window editing dialogs | URL, iframe URL, and title dialogs now restore always-on-top after cancellation or error, ignore late responses for destroyed windows, and handle rejected edits. Title changes keep both CLI aliases in sync. Corrected the fullscreen menu shortcut label to Alt+Enter. |
| Custom and preset window resolution | Custom resolution displays physical pixels consistently with submission, preventing high-DPI shrinkage when accepting the unchanged value. Resizing uses the window's display scale, validates dimensions, updates stored argument aliases, restores maximized windows, and waits for fullscreen exit. A newer request replaces a pending resize. |
| Documentation | Removed repeated Windows URL examples and malformed fencing; documented recording destinations and English-only UI. Corrected obsolete Node 14/18 setup commands, Raspberry Pi artifact/architecture guidance, zero/negative coordinate guidance, hardware-acceleration boolean syntax, and audio-output menu instructions. Distinguished Node integration from Windows administrator elevation. |

## Remaining findings, in priority order

These are source-level findings; the hardware-dependent failure scenarios have
not been reproduced with live capture devices in this review.

1. **Medium: audio format changes are only partially handled.**
   `window-audio-stream.js` updates channel/sample-rate fields on incoming data
   but does not rebuild the existing processing graph or resample. Startup now
   uses the correct reported format, but format changes during an active stream
   still need explicit handling and native-device testing. Replacing the legacy
   ScriptProcessor with an AudioWorklet is a possible later improvement, not a
   prerequisite for these contained fixes.

2. **Medium: named-window reuse retains startup injection content.**
   `createWindow` returns the reused window before reading new CSS/JavaScript
   files. The page-load handler closes over the original injection content, so
   updated `--css`, `--js`, or chroma options can be ignored. A follow-up should
   refresh stored injection configuration and define whether same-URL reuse
   reinjects code, replaces CSS, or reloads. Re-executing arbitrary custom JS
   automatically can duplicate page listeners or start capture twice, so this
   needs an explicit behavior choice and dedicated reuse tests.

3. **Recording workflow consideration: automatic save paths can repeat.**
   Automatic downloads use the supplied filename. The app does not reserve
   unique names or check for an existing recording before setting the save path.
   Repeated or concurrent downloads with the same filename therefore need a
   deliberate overwrite policy. Automatic suffixing could break workflows that
   intentionally replace a fixed filename, so it was not added in this review.

## Localization and automation

Menus and dialogs embed English strings directly in `main.js`; documentation
pages declare English. Website translation is separate from app translation.
A small message catalog with English fallbacks is a reasonable future change,
but adding a framework or unreviewed translations would add maintenance without
establishing reliable language support.

The app already provides launch automation through CLI arguments, deep links,
and named-window reuse. No dedicated MCP server or supported headless capture
mode was found in the reviewed application code. A future opt-in local control
interface could expose window listing, creation, navigation, sizing, closure,
and status using those existing operations. It should report structured errors
and preserve normal visible capture behavior. Truly headless capture needs its
own compatibility testing. No new automation service or dependency was added
in this stability pass.

## Validation

- `npm.cmd test`: all eighteen suites passed, including window/fetch lifecycle,
  audio-wrapper, native audio lifecycle, device-menu, and shortcut regression tests.
- `node --check main.js`: passed.
- Installed custom Electron `39.8.10-qp20`, running `. --help`: exit code 0;
  native window audio and ASIO modules loaded during startup.
- New tests use fake Electron events and Web Audio objects, with real Node Web
  Streams for fetch response handling. They do not prove audio fidelity or
  OS-level download/window behavior.
- No release builds, installer runs, live ASIO/WASAPI capture, macOS/Linux GUI
  tests, dependency vulnerability audit, or end-to-end recording tests were run.

The second pass reproduces native startup delays, owner destruction during
startup, conflicting starts, stale callbacks, backend stop failure and recovery,
ASIO page teardown, out-of-order menu replies, enumeration errors, and a missing
DOM target with deterministic mocks. Actual ASIO/WASAPI devices still need
close/reload/start-stop smoke testing before release.

The third pass tests shortcut handoff between windows, equivalent accelerator
spellings, owner closure, focus/blur overlap, registration conflicts, invalid
accelerators, Shift-modified push-to-talk, and numeric audio target normalization.
OS-level hotkey delivery still needs a multi-window GUI smoke test.

The fourth pass tests repeated quit requests, a failing shutdown notification,
and final window close handling. An isolated, minimized custom Electron instance
with a temporary profile and a blank local page created one window, received two
quit requests, closed that window, and exited with code 0. The first smoke-test
harness used an incorrect Electron import and timed out; after correcting that
harness, the app shutdown test passed. This does not validate recording flush
completion during quit. Custom-code tests cover multiline/quoted CSS, storage
failure, prompt cancellation/rejection, JavaScript execution, and window closure.

The fifth pass tests application-audio attachment replacement, old-share teardown,
queued ownership checks, a display ending during startup, a target change during
startup, attachment failure after cloning, and an already-ended display stream.
These tests use mocked media tracks and native capture; live screen-share audio
replacement still needs a hardware smoke test.

The sixth pass tests synchronous/asynchronous page-operation failure, expected
navigation cancellation, destroyed targets, rapid cursor toggles, and repeated
hide requests. A hidden window on the custom Electron runtime also verified that
turning cursor hiding off restores a page's crosshair cursor and text selection;
the isolated smoke test exited with code 0.

The seventh pass tests display scale changes, movement back to standard DPI,
reused-window nodpi changes, invalid scale values, and listener cleanup. These
are deterministic event tests; physical mixed-DPI monitor testing remains open.

The eighth pass tests partial audio blocks, silence padding, a stereo frame split
between IPC chunks, oversized odd-length chunks, and overflow while an incomplete
frame is already buffered. Live device audio quality testing remains outstanding.

The ninth pass tests failed/partial writes, failed renames, temporary-file cleanup,
invalid saved rectangles, negative monitor positions, immediate close after a
move, and cancellation of timers on destruction. Atomic replacement reduces
interrupted-write damage; it does not promise power-loss durability or separate
bounds settings for multiple windows sharing a profile.

The tenth pass tests rapid per-element output changes, failure recovery,
system-default overrides, null targets, and routing through nested accessible
frames alongside an inaccessible frame. Actual OS audio-output switching still
requires device testing.

The eleventh pass tests overlapping DOM targets in one renderer, target release,
selection-before-release message order, timeout cleanup, and ignored late device
enumeration results. No device permissions or page routing capabilities changed.

The twelfth pass cross-checked setup requirements and build outputs against
`package.json`, output menu availability against `main.js`, and boolean syntax
against the installed yargs parser. `--hwa 0` evaluates to enabled, while
`--hwa=false` and `--no-hwa` evaluate to disabled. This pass changes documentation
only; no new builds or hardware tests were run.

The thirteenth pass tests explicit URL schemes, host/port input, whitespace,
scheme-relative URLs, quoted/multiline iframe URLs, null hit-test results, and
missing frames. The URL formatter previously prepended HTTPS to data URLs, so
the earlier full-app shutdown smoke test established successful window closure,
but did not establish successful loading of its intended data-URL test page.

The fourteenth pass adds `npm run test:electron-smoke`, an optional real-Electron
test using minimized windows, local data pages, CSS/JS fixtures, and a temporary
profile. It verifies both pages actually load and receive injections, reload,
closing one window while keeping the other, and clean exit after repeated quit
requests. It also fails on destroyed-object exceptions or listener-limit warnings.
The test passed on the installed Windows custom runtime. Temporary test profiles
are retained in the OS temporary directory for diagnosis. This does not exercise
physical capture devices, recording completion, or macOS/Linux behavior.

The fifteenth pass extends dialog regression coverage to cancellation, empty
submitted titles, rejected prompts, rejected edit callbacks, and replies after
window destruction. The real-Electron two-window smoke test and CLI help check
also remain passing. OS dialog interaction is not automated by that smoke test.

The sixteenth pass tests high-DPI resolution round trips, valid/invalid inputs,
argument synchronization, maximized-window restoration, deferred fullscreen
resizing, replacement of pending requests, and close cleanup. Mixed-DPI physical
monitor and native fullscreen-transition testing remain outstanding.

The seventeenth pass restores the existing Linux home-directory recording default,
correcting an unnecessary behavior change introduced earlier in this review.
Download regression checks cover platform defaults, ordinary save-dialog routing,
destination failures, and listener cleanup. Filename overwrite behavior remains
unchanged; real recording completion and Linux/macOS runtime checks remain untested.
