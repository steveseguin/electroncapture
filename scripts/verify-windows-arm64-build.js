#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");
const {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire,
} = require("@electron/fuses");

const PE_MACHINE_ARM64 = 0xaa64;
const projectRoot = path.resolve(__dirname, "..");
const distDir = process.env.ELECTRON_CAPTURE_DIST_DIR
  ? path.resolve(process.env.ELECTRON_CAPTURE_DIST_DIR)
  : path.join(projectRoot, "dist");

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

async function main() {
  assertOfficialElectronConfiguration();
  const unpackedExecutables = findFiles(distDir, (filePath) => {
    return (
      path.basename(filePath).toLowerCase() === "elecap.exe" &&
      path.dirname(filePath).toLowerCase().includes("unpacked")
    );
  });
  const unpackedExecutable = unpackedExecutables.find(
    (filePath) => readPeMachine(filePath) === PE_MACHINE_ARM64,
  );

  if (!unpackedExecutable) {
    throw new Error(
      unpackedExecutables.length === 0
        ? "Could not find an unpacked Windows elecap.exe"
        : `Could not find an ARM64 unpacked Windows elecap.exe among:\n${unpackedExecutables.join("\n")}`,
    );
  }
  assertArm64Pe(unpackedExecutable);
  const unpackedDir = path.dirname(unpackedExecutable);

  const packagedWindowAudioModules = findFiles(unpackedDir, (filePath) => {
    return (
      path.basename(filePath).toLowerCase() === "window_audio_capture.node"
    );
  });

  if (process.env.WINDOW_AUDIO_CAPTURE_SKIP === "1") {
    if (packagedWindowAudioModules.length > 0) {
      throw new Error(
        `Skipped window audio module was still packaged:\n${packagedWindowAudioModules.join("\n")}`,
      );
    }
  } else {
    if (packagedWindowAudioModules.length === 0) {
      throw new Error(
        "The Windows ARM64 package is missing window_audio_capture.node",
      );
    }
    packagedWindowAudioModules.forEach(assertArm64Pe);
  }

  const incompatibleAsioFiles = findFiles(unpackedDir, (filePath) => {
    const filename = path.basename(filePath).toLowerCase();
    return (
      filename === "electron_asio.node" || filename === "portaudio_x64.dll"
    );
  });
  if (incompatibleAsioFiles.length > 0) {
    throw new Error(
      `Windows ARM64 package contains x64 ASIO files:\n${incompatibleAsioFiles.join("\n")}`,
    );
  }

  verifyPackagedFiles(unpackedDir);
  await verifyFuses(unpackedExecutable);

  const version = require("../package.json").version;
  const expectedArtifacts = [
    path.join(distDir, `elecap-${version}-win-arm64-portable.exe`),
    path.join(distDir, `elecap-${version}-win-arm64-setup.exe`),
    path.join(distDir, `elecap_win_v${version}_arm64_portable.zip`),
    path.join(distDir, `elecap_win_v${version}_arm64_installer.zip`),
  ];
  for (const artifact of expectedArtifacts) {
    assertNonEmptyArtifact(artifact);
  }

  console.log(
    `Verified Windows ARM64 Electron executable: ${path.relative(projectRoot, unpackedExecutable)}`,
  );
  console.log(
    `Verified ${packagedWindowAudioModules.length} ARM64 window audio native module(s).`,
  );
  console.log("Verified that x64 ASIO binaries are absent.");
  console.log("Verified official ARM64 Electron configuration, fuses, and package contents.");
}

function assertOfficialElectronConfiguration() {
  const config = require("../electron-builder.win-arm64.js");
  if (config.electronVersion !== "39.2.7") {
    throw new Error(`Unexpected Windows ARM64 Electron version: ${config.electronVersion}`);
  }
  if (!config.electronDownload || config.electronDownload.mirror !== "https://github.com/electron/electron/releases/download/") {
    throw new Error(`Unexpected Windows ARM64 Electron mirror: ${config.electronDownload && config.electronDownload.mirror}`);
  }
  if (config.electronDownload.customDir !== "v39.2.7") {
    throw new Error(`Unexpected Windows ARM64 Electron directory: ${config.electronDownload.customDir}`);
  }
}

function verifyPackagedFiles(unpackedDir) {
  const asarPath = path.join(unpackedDir, "resources", "app.asar");
  if (!fs.existsSync(asarPath)) throw new Error(`Packaged app.asar not found: ${asarPath}`);
  const archiveEntries = asar.listPackage(asarPath);
  const entries = archiveEntries.map((entry) => entry.replace(/\\/g, "/").replace(/^\/+/, ""));
  const forbidden = [
    ".agents", ".claude", ".env", ".secret", "CLAUDE.md", "afterPack.js",
    "afterPackArm64.js", "afterPackHook.js", "afterSign.js", "docs",
    "electron-builder.win-arm64.js", "installer.nsh", "package-lock.json",
    "scripts", "setFuses.js", "test", "tests", "vdoninja",
  ];
  const leaked = entries.filter((entry) => forbidden.some((name) => entry === name || entry.startsWith(`${name}/`)));
  if (leaked.length > 0) {
    throw new Error(`Build-only or sensitive files leaked into app.asar:\n${leaked.join("\n")}`);
  }
  if (!entries.includes("portable-data-paths.js")) {
    throw new Error("portable-data-paths.js is missing from app.asar");
  }

  const undiciIndexEntry = archiveEntries.find(
    (entry) => entry.replace(/\\/g, "/").replace(/^\/+/, "") === "node_modules/undici/index.js",
  );
  if (!undiciIndexEntry) throw new Error("Packaged undici runtime is missing from app.asar");
  const packagedUndici = asar.extractFile(asarPath, undiciIndexEntry.replace(/^[\\/]+/, ""));
  const installedUndici = fs.readFileSync(require.resolve("undici"));
  if (!packagedUndici.equals(installedUndici)) {
    throw new Error("Packaged undici runtime does not match package-lock.json");
  }
}

async function verifyFuses(executablePath) {
  const wire = await getCurrentFuseWire(executablePath);
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  ]);
  for (const [fuse, state] of expected) {
    if (wire[fuse] !== state) {
      throw new Error(`Unexpected Electron fuse state for fuse ${fuse}: ${wire[fuse]}`);
    }
  }
}

function assertNonEmptyArtifact(filePath) {
  const stats = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stats || !stats.isFile() || stats.size === 0) {
    throw new Error(`Expected non-empty Windows ARM64 artifact not found: ${filePath}`);
  }
  if (path.extname(filePath).toLowerCase() === ".zip") {
    const signature = fs.readFileSync(filePath).subarray(0, 4).toString("hex");
    if (!["504b0304", "504b0506", "504b0708"].includes(signature)) {
      throw new Error(`Artifact is not a valid ZIP file: ${filePath}`);
    }
  }
}

function findFiles(root, predicate) {
  if (!fs.existsSync(root)) {
    return [];
  }
  const matches = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
      } else if (entry.isFile() && predicate(fullPath)) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}

function assertArm64Pe(filePath) {
  const machine = readPeMachine(filePath);
  if (machine !== PE_MACHINE_ARM64) {
    throw new Error(
      `Expected ARM64 PE machine 0x${PE_MACHINE_ARM64.toString(16)}, got 0x${machine.toString(16)}: ${filePath}`,
    );
  }
}

function readPeMachine(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.length < 0x40 || data.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`Not a valid PE file: ${filePath}`);
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (
    peOffset + 6 > data.length ||
    data.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0"
  ) {
    throw new Error(`Missing PE header: ${filePath}`);
  }
  return data.readUInt16LE(peOffset + 4);
}
