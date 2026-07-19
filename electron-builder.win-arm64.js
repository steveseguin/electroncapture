const fs = require("fs");
const path = require("path");

const baseBuild = require("./package.json").build;

const OFFICIAL_ELECTRON_VERSION = "39.2.7";
const PE_MACHINE_ARM64 = 0xaa64;
const ELECTRON_ASIO_BINARY_PATH = "native-modules/electron-asio/build/Release";
const WINDOW_AUDIO_PATH = "native-modules/window-audio-capture";
const WINDOW_AUDIO_BINARY_PATH = path.join(
  __dirname,
  WINDOW_AUDIO_PATH,
  "build",
  "Release",
  "window_audio_capture.node",
);
const skipWindowAudio = process.env.WINDOW_AUDIO_CAPTURE_SKIP === "1";
const includeWindowAudio =
  !skipWindowAudio && isArm64Pe(WINDOW_AUDIO_BINARY_PATH);

if (!skipWindowAudio && !includeWindowAudio) {
  console.warn(
    "[windows-arm64] ARM64 window audio module not found; packaging without process/window audio capture.",
  );
}

function shouldExcludeNativeFileSet(fileSet) {
  if (!fileSet || typeof fileSet !== "object") {
    return false;
  }
  if (fileSet.from === ELECTRON_ASIO_BINARY_PATH) {
    return true;
  }
  return (
    !includeWindowAudio &&
    typeof fileSet.from === "string" &&
    fileSet.from.startsWith(WINDOW_AUDIO_PATH)
  );
}

function isArm64Pe(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  try {
    const data = fs.readFileSync(filePath);
    if (data.length < 0x40 || data.toString("ascii", 0, 2) !== "MZ") {
      return false;
    }
    const peOffset = data.readUInt32LE(0x3c);
    return (
      peOffset + 6 <= data.length &&
      data.toString("ascii", peOffset, peOffset + 4) === "PE\0\0" &&
      data.readUInt16LE(peOffset + 4) === PE_MACHINE_ARM64
    );
  } catch {
    return false;
  }
}

module.exports = {
  ...baseBuild,

  // Windows x64 deliberately continues to use the custom Electron build from
  // package.json. This standalone config is only loaded by build:win-arm64.
  electronVersion: OFFICIAL_ELECTRON_VERSION,
  electronDownload: {
    mirror: "https://github.com/electron/electron/releases/download/",
    customDir: `v${OFFICIAL_ELECTRON_VERSION}`,
  },

  // ASIO currently links a prebuilt x64 PortAudio library. Keep its JS API in
  // the ARM64 package so feature detection remains graceful, but never package
  // the incompatible native addon or DLL.
  files: baseBuild.files.filter(
    (fileSet) => !shouldExcludeNativeFileSet(fileSet),
  ),

  win: {
    ...baseBuild.win,
    target: [
      {
        target: "nsis",
        arch: ["arm64"],
      },
      {
        target: "portable",
        arch: ["arm64"],
      },
    ],
  },

  nsis: {
    ...baseBuild.nsis,
    artifactName: "elecap-${version}-win-arm64-setup.${ext}",
  },

  portable: {
    ...baseBuild.portable,
    artifactName: "elecap-${version}-win-arm64-portable.${ext}",
  },

  afterAllArtifactBuild: "./afterPackArm64.js",
};
