# Reliability review — September 5, 2026

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
