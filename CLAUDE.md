# CLAUDE.md - Electron Capture Application

## Project Overview

**Electron Capture** is a lightweight Electron app for frameless window video capture, optimized for VDO.Ninja workflows. It provides a dedicated capture window with lower CPU usage and better quality than OBS Browser Source.

**Repository**: https://github.com/steveseguin/electroncapture
**Website**: https://electroncapture.app
**Current Version**: 2.22.0

## Key Features

- **Frameless window capture** - No browser chrome, address bar, or window decorations
- **Application Audio Capture** (Windows) - Capture audio directly from any app without virtual cables
- **Custom Electron with QP-cap patches** (Windows) - Near-lossless WebRTC encoding
- **NVENC/HEVC hardware encoding** (Windows) - H.264, H.265, AV1 via NVIDIA GPU
- **Cursor suppression** - Hide cursor in screen captures via `video.cursor: 'never'`
- **Global hotkeys** - System-wide shortcuts (CTRL+M for mute, etc.)
- **Pin on top** - Always-on-top mode for overlays

## Repository Structure

```
electroncapture/
├── main.js                 # Main Electron process
├── preload.js              # Preload scripts for renderer
├── window-audio-stream.js  # Audio capture stream handling
├── package.json            # Build config and dependencies
├── scripts/
│   ├── install-custom-electron.js   # Downloads custom Electron for Windows
│   └── install-window-audio-capture.js  # Builds native audio module
├── native-modules/
│   └── window-audio-capture/        # Git submodule (private repo)
│       ├── src/                     # C++ WASAPI capture code
│       ├── index.js                 # Node.js bindings
│       └── build/Release/           # Compiled .node binary
├── docs/                   # Website (GitHub Pages from master:/docs)
├── assets/                 # Icons and images
├── build/                  # Build resources (entitlements, etc.)
└── dist/                   # Build output (not committed)
```

## Custom Electron Build (Windows Only)

Windows builds use a **custom Electron** from https://github.com/steveseguin/electron with:

### Patches Applied
1. **QP-cap patches** - Max QP lowered to 20 (from 51-58) for near-lossless encoding
2. **NVENC enablement** - Hardware encoding for H.264, HEVC, AV1
3. **Cursor suppression** - `video.cursor: 'never'` constraint support
4. **Adaptive scaling controls** - Field trials to lock resolution/framerate

### Custom Electron Source Location
```
Windows: C:\electron-work-v36\src
WSL:     /mnt/c/electron-work-v36/src
```

### Building Custom Electron
See `C:\Users\Steve\code\electron\CLAUDE.md` for full build instructions.

Quick reference:
```powershell
# Windows Release build
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File C:\Users\Steve\code\electron\script\build_win_qp_release.ps1 `
  -WorkspaceRoot C:\electron-work-v36\src `
  -Tag v39.2.13 `
  -SkipSync
```

### Custom Electron Version Config
In `package.json`:
```json
{
  "build": {
    "electronVersion": "39.2.13-qp20",
    "electronDownload": {
      "mirror": "https://github.com/steveseguin/electron/releases/download/",
      "customDir": "v39.2.13-qp20"
    }
  }
}
```

The `scripts/install-custom-electron.js` handles downloading:
- **Windows**: Downloads from `steveseguin/electron` releases (custom build)
- **Linux/Mac**: Downloads from official `electron/electron` releases (stock)

## Window Audio Capture Plugin (Private Repo)

### Overview
A native Node.js addon for capturing audio from specific Windows applications using WASAPI loopback capture. This enables "Application Audio Capture" without virtual audio cables.

### Git Submodule
```
[submodule "window-audio-capture"]
    path = native-modules/window-audio-capture
    url = git@github.com:steveseguin/window-audio-capture-plugin.git
```

**Note**: This is a **private repository**. Cloning electroncapture without access will skip this module.

### How It Works
1. `scripts/install-window-audio-capture.js` runs on `npm install` and `npm run build`
2. On Windows: runs `npm install` in the submodule directory to compile the C++ addon
3. On Linux/Mac: skips (Windows-only feature)
4. The compiled `window_audio_capture.node` binary is included in Windows builds

### Building the Native Module
```bash
# Rebuild manually
npm run native-modules:rebuild

# Skip building (for CI/testing)
WINDOW_AUDIO_CAPTURE_SKIP=1 npm install
```

### Module Structure
```
native-modules/window-audio-capture/
├── src/                    # C++ source (WASAPI capture)
├── binding.gyp            # Node-gyp build config
├── index.js               # JavaScript interface
├── build/Release/
│   └── window_audio_capture.node  # Compiled binary
```

## Build Commands

### Windows (Custom Electron + Audio Capture)
```bash
npm install           # Downloads custom Electron, builds native module
npm run build:win32   # Creates installer and portable builds
```

Output:
- `dist/elecap-{version}.exe` - NSIS installer
- `dist/elecap.exe` - Portable executable
- `dist/elecap_win_v{version}_installer.zip`
- `dist/elecap_win_v{version}_portable.zip`

### Linux (Stock Electron)
```bash
npm run build:linux
```

Output:
- `dist/elecap-{version}-x86_64.AppImage`
- `dist/elecap-{version}-amd64.deb`
- `dist/elecap-{version}-x86_64.rpm` (requires `rpmbuild`)

### macOS (Stock Electron)
```bash
npm run build:darwin
```

### Development
```bash
npm start             # Run in development mode
```

## Key Configuration

### Platform Differences
| Feature | Windows | Linux | macOS |
|---------|---------|-------|-------|
| Custom Electron (QP-cap) | Yes | No | No |
| NVENC/HEVC | Yes | No | No |
| Application Audio Capture | Yes | No | No |
| Cursor Suppression | Yes | No | No |
| Electron Version | 39.2.13-qp20 | 39.2.7 | 39.2.7 |

### Environment Variables
```bash
CUSTOM_ELECTRON_SKIP=1        # Skip custom Electron download
WINDOW_AUDIO_CAPTURE_SKIP=1   # Skip native module build
CUSTOM_ELECTRON_LOCAL_DIR=... # Use local Electron build
```

## Release Process

### Creating a Release
1. Update version in `package.json`
2. Build Windows on Windows (requires native module)
3. Build Linux on Linux/WSL
4. Create GitHub release:

```bash
# Create pre-release with Windows builds
gh release create v2.22.0 --prerelease \
  --title "Electron Capture v2.22.0" \
  dist/elecap_win_v2.22.0_portable.zip \
  dist/elecap_win_v2.22.0_installer.zip \
  dist/elecap-2.22.0.exe

# Add Linux builds
gh release upload v2.22.0 \
  dist/elecap-2.22.0-x86_64.AppImage \
  dist/elecap-2.22.0-amd64.deb
```

### Updating Custom Electron Version
1. Build new custom Electron (see `C:\Users\Steve\code\electron\CLAUDE.md`)
2. Upload to `steveseguin/electron` releases with SHASUMS256.txt
3. Update `package.json`:
   - `build.electronVersion`
   - `build.electronDownload.customDir`
4. Update `scripts/install-custom-electron.js`:
   - `PLATFORM_TARGETS` version and releaseTag

## Testing

### Run the App
```bash
npm start
npm start -- --url="https://vdo.ninja/?view=abc123"
npm start -- --help
```

### Test Application Audio Capture (Windows)
1. Run `npm start` with elevated privileges
2. Right-click > Elevate Privileges
3. Start a screen/window share
4. Audio from the selected app should be captured

### Common CLI Flags
```bash
--url="..."           # Load specific URL
--width=1920          # Window width
--height=1080         # Window height
--pin                 # Always on top
--title="My Stream"   # Custom window title
--node                # Enable Node integration
--hwa                 # Enable hardware acceleration (default: true)
```

## Troubleshooting

### Windows Build Fails: "Cannot create symbolic link"
Enable Developer Mode in Windows Settings, or run as Administrator.

### Linux Build Fails: "electron-v39.2.13-qp20-linux-x64.zip 404"
The Linux build script should use stock Electron. Check `package.json` build:linux has the override flags.

### Native Module Not Found
```bash
npm run native-modules:rebuild
# Or check submodule is cloned:
git submodule update --init --recursive
```

### Custom Electron Not Installing
```bash
# Check if custom version exists
gh release view v39.2.13-qp20 --repo steveseguin/electron

# Force re-download
rm -rf node_modules/electron/dist
npm install
```

## Related Repositories

| Repo | Purpose |
|------|---------|
| `steveseguin/electroncapture` | This app (public) |
| `steveseguin/electron` | Custom Electron builds (public) |
| `steveseguin/window-audio-capture-plugin` | Native audio module (private) |
| `C:\Users\Steve\code\electron` | Build scripts for custom Electron |
| `C:\electron-work-v36\src` | Chromium/Electron source tree |

## Important Notes

- Windows builds require the custom Electron for QP-cap and NVENC features
- The window-audio-capture submodule is private; external contributors won't have access
- Linux/Mac builds use stock Electron and lack Windows-specific features
- GitHub Pages serves the docs from `master:/docs`
- Always test `--help` after main.js changes (fix was in commit 3337475)
