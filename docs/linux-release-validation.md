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
- Extracted x64 DEB, RPM and tar payloads match the unpacked executable and
  app.asar byte-for-byte; the desktop entry passes desktop-file-validate.

The packaged app waits for a usable password store in this headless session.
Disposable headless test profiles explicitly use `--password-store=basic`;
production settings and security fuses are unchanged. This test setting is not
recommended for normal user profiles and does not validate desktop keyring UX.

## Audits and limits

Production dependencies and both native lockfiles audit clean. All 378 installed
root packages have verified registry signatures; 43 have verified attestations.
Four previously reviewed build-tool advisories remain. The existing exact-beta.3,
expiring prerelease exception is unchanged; ordinary release audits remain strict.

ARMv7 hardware execution, Raspberry Pi camera/GPU performance, native Wayland and
Gamescope, OBS alpha capture, physical device hot-plug, mixed-DPI displays and
multi-hour endurance are not established by these checks. Linux uses official
Electron and does not include Windows custom WebRTC patches, ASIO or Windows
process-audio capture. ARMv7 is a preview: Electron 43 is the last upstream series
with prebuilt 32-bit ARM binaries.

Earlier WSL testing recorded an intermittent 743 ms initial audio delay. The
local Ubuntu runs here passed the existing timing gate, but do not establish
that every cold-start/hardware/audio-server combination is fixed. Generated-media
tests validate timestamps and decoding, not perceptual lip sync from hardware.
