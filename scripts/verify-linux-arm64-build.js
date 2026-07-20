#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ELF_MACHINE_AARCH64 = 183;
const projectRoot = path.resolve(__dirname, "..");
const distDir = process.env.ELECTRON_CAPTURE_DIST_DIR
  ? path.resolve(process.env.ELECTRON_CAPTURE_DIST_DIR)
  : path.join(projectRoot, "dist");

const unpackedExecutables = findFiles(distDir, (filePath) => {
  return (
    path.basename(filePath) === "elecap" &&
    path.dirname(filePath).toLowerCase().includes("unpacked")
  );
});
const unpackedExecutable = unpackedExecutables.find(
  (filePath) => readElfMachine(filePath) === ELF_MACHINE_AARCH64,
);

if (!unpackedExecutable) {
  throw new Error(
    unpackedExecutables.length === 0
      ? "Could not find an unpacked Linux elecap executable"
      : `Could not find an AArch64 unpacked Linux elecap executable among:\n${unpackedExecutables.join("\n")}`,
  );
}

assertArm64Elf(unpackedExecutable);

const version = require("../package.json").version;
const expectedArtifacts = [
  path.join(distDir, `elecap-${version}-arm64.AppImage`),
  path.join(distDir, `elecap-${version}-arm64.deb`),
  path.join(distDir, `elecap-${version}-aarch64.rpm`),
];

for (const artifact of expectedArtifacts) {
  if (!fs.existsSync(artifact)) {
    throw new Error(`Expected Linux ARM64 artifact not found: ${artifact}`);
  }
}

console.log(
  `Verified Linux ARM64 Electron executable: ${path.relative(projectRoot, unpackedExecutable)}`,
);

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

function assertArm64Elf(filePath) {
  const machine = readElfMachine(filePath);
  if (machine !== ELF_MACHINE_AARCH64) {
    throw new Error(
      `Expected AArch64 ELF machine ${ELF_MACHINE_AARCH64}, got ${machine}: ${filePath}`,
    );
  }
}

function readElfMachine(filePath) {
  const data = fs.readFileSync(filePath);
  if (
    data.length < 20 ||
    data[0] !== 0x7f ||
    data.toString("ascii", 1, 4) !== "ELF"
  ) {
    throw new Error(`Not a valid ELF file: ${filePath}`);
  }
  if (data[4] !== 2) {
    throw new Error(`Expected a 64-bit ELF file: ${filePath}`);
  }
  if (data[5] !== 1 && data[5] !== 2) {
    throw new Error(`ELF file has an unsupported byte order: ${filePath}`);
  }
  const littleEndian = data[5] === 1;
  return littleEndian ? data.readUInt16LE(18) : data.readUInt16BE(18);
}
