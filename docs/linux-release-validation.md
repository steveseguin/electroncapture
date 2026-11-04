# Linux 2.23.4-beta.3 validation

Linux supplements the existing macOS/Windows prerelease. The existing tag and
Mac/Windows downloads are preserved. Linux uses official Electron 43.8.7
(Chromium 150.0.7871.250), with the reviewed beta.3 application source.

## Packages and build changes

- x64, ARM64 and ARMv7 each have AppImage, DEB, RPM and tar.gz targets.
- The default Linux command explicitly selects x64; ARM commands select their
  architectures explicitly. ARMv7 DEBs contain Debian `armhf` metadata.
- The installed `elecap.desktop` file, default Electron desktop identity and
  StartupWMClass match. Custom `--class` / `--app-id` values remain supported.
- RPMs disable shared `/usr/lib/.build-id` links, avoiding file ownership
  conflicts with other applications using the same Electron runtime.
- All architectures have package gates for ELF architecture/class, source
  equality, app version, the packaged Undici runtime, security fuses, missing
  artifacts, DEB architecture/version, RPM digests/architecture, and tar integrity.
- CI builds each architecture independently, with a native ARM64 runner. A
  Linux-only manual dispatch avoids rebuilding the Windows and Mac assets.
- Native x64 and ARM64 CI installs the DEB, tests the installed executable,
  records three fresh-profile clips, decodes them, then tests package removal.
  ARMv7 is cross-built and receives static package checks only.

## Local validation (Ubuntu 24.04 x64)

- All 22 regression suites and the commit-push safety test pass. The pinned
  private audio submodule is required by the complete regression suite.
- Official 43.8.7: 156 X11 window-workflow assertions pass under Xvfb/Openbox.
  Coverage includes fullscreen/resize, pinning, click-through, minimized startup,
  Node mode, chroma, multiple windows, reload and lifecycle cleanup.
- CSS/JavaScript injection, isolated renderers, reload and multiwindow smoke pass.
- VP8, VP9 and H.264 local WebRTC encode/decode tests pass.
- Available-device, per-window download and fullscreen/resize workflows pass.
- A five-minute generated recording plus window-close and app-quit recordings
  decode without errors. Their final audio/video offsets are 38 ms, 1 ms and
  0 ms respectively; all pass the existing <250 ms drift-change check.
- Packaged tests verify default WM_CLASS, simultaneous custom `--class` and
  `--app-id` processes, isolated renderer and explicit Node mode, CSS/JavaScript
  injection, exact runtime version, and rejection of NODE_OPTIONS injection
  while ELECTRON_RUN_AS_NODE is set.
- Two fresh-profile unpacked recordings and one AppImage extract-and-run
  recording pass decode/timing checks. Their final audio/video offsets are
  60 ms, 56 ms and 54 ms; initial audio timestamps are 196–201 ms.
- Native Wayland under headless Weston 13/Pixman sends the requested
  `elecap-wayland-check` app_id (verified in the Wayland protocol log). A packaged
  30-second recording decodes cleanly: -31 ms final offset, -46 ms drift change.
- Extracted x64 DEB, RPM, tar and AppImage payloads match the unpacked executable
  and app.asar byte-for-byte; the desktop entry passes desktop-file-validate.
  ARM64 and ARMv7 AppImage payloads also match their unpacked builds.

The packaged app waits for a usable password store in this headless session.
Disposable headless test profiles explicitly use `--password-store=basic`;
production settings and security fuses are unchanged. This test setting is not
recommended for normal user profiles and does not validate desktop keyring UX.

## Final CI evidence and release provenance

All jobs in [run 41873745312](https://github.com/steveseguin/electroncapture/actions/runs/41873745312)
passed for source `8e0705a4fc1334b15d8b1c6e3666f7cc5bcd413e`. The release uses
these CI artifacts, with GitHub artifact SHA-256 digests checked on download.
The existing release tag remains at `01eeaaf`; the Linux source archive records
the exact Linux source revision separately.

Native Ubuntu x64 and ARM64 each passed DEB installation, all four packaged
startup modes, default/custom X11 identities, renderer isolation, Node mode,
CSS/JavaScript injection, Node-environment-injection rejection, and removal.
Each architecture completed three fresh-profile 30-second recordings:

| Runner | Initial audio timestamp | Final audio/video offset | Largest absolute drift change |
| --- | --- | --- | --- |
| x64 | 13–33 ms | -8.5 to +40 ms | 41.5 ms |
| ARM64 | 11–17 ms | +29.5 to +58 ms | 42 ms |

All six CI clips decoded without errors and passed the <250 ms drift-change
criterion. Combined with local testing, 13 clips passed. ARMv7 package gates
passed; no ARMv7 runtime claim is made. `LINUX-VALIDATION.json` preserves the
local and CI results; `LINUX-SHASUMS256.txt` covers the Linux packages, exact
source archive, validation report and full audit report.

Publication completed on November 4, 2026: 12 Linux packages plus source, audit,
validation and checksum files were added to the existing prerelease. All 16
uploaded Linux files match GitHub's reported SHA-256 digests. All 17 prior
Mac/Windows/support assets retain their original IDs, sizes and hashes; the tag
and prerelease status are unchanged. Every downloaded DEB, RPM and AppImage
contains the same executable and app.asar as its architecture's verified tar.
CodeQL passed for the Linux implementation commit.

## Audits and limits

Production dependencies and both native lockfiles audit clean. All 378 installed
root packages have verified registry signatures; 43 have verified attestations.
Four previously reviewed build-tool advisories remain. The existing exact-beta.3,
expiring prerelease exception is unchanged; ordinary release audits remain strict.

ARMv7 hardware execution, Raspberry Pi camera/GPU performance, full desktop Wayland and
Gamescope workflows, OBS alpha capture, physical device hot-plug, mixed-DPI displays and
multi-hour endurance are not established by these checks. Linux uses official
Electron and does not include Windows custom WebRTC patches, ASIO or Windows
process-audio capture. ARMv7 is a preview: Electron 43 is the last upstream series
with prebuilt 32-bit ARM binaries.

Earlier WSL testing recorded an intermittent 743 ms initial audio delay. The
local Ubuntu runs here passed the existing timing gate, but do not establish
that every cold-start/hardware/audio-server combination is fixed. Generated-media
tests validate timestamps and decoding, not perceptual lip sync from hardware.
