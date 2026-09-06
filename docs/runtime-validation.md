# Windows runtime validation — September 5, 2026

These checks use temporary profiles and local fixtures. No release was published
or installed over the user's app. The generated recordings are not physical
camera/microphone recordings or a VDO.Ninja end-to-end test.

## Findings requiring attention

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
3. **Fullscreen state discrepancy.** On the available Windows monitor, requesting
   fullscreen expands the capture window to 1920×1080, while `isFullScreen()` remains
   false. Reproduced after explicitly showing/restoring the window. Manual exit
   followed by resizing works. Actual menu toggle/resolution behavior in this state
   requires investigation; this is not claimed to be a confirmed user-visible failure.
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
