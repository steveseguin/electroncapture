const fs = require("fs");
const path = require("path");
const archiver = require("archiver");

exports.default = async function (buildResult) {
  const version = require("./package.json").version;
  const artifacts = [
    {
      source: path.join(
        buildResult.outDir,
        `elecap-${version}-win-arm64-portable.exe`,
      ),
      destination: path.join(
        buildResult.outDir,
        `elecap_win_v${version}_arm64_portable.zip`,
      ),
    },
    {
      source: path.join(
        buildResult.outDir,
        `elecap-${version}-win-arm64-setup.exe`,
      ),
      destination: path.join(
        buildResult.outDir,
        `elecap_win_v${version}_arm64_installer.zip`,
      ),
    },
  ];

  // `electron-builder --dir` intentionally creates no installer artifacts.
  // Keep that mode available for local packaging and architecture checks.
  if (artifacts.every((artifact) => !fs.existsSync(artifact.source))) {
    return [];
  }

  const createdArtifacts = [];
  for (const artifact of artifacts) {
    if (!fs.existsSync(artifact.source)) {
      throw new Error(
        `Expected Windows ARM64 artifact not found: ${artifact.source}`,
      );
    }
    await createZip(artifact.source, artifact.destination);
    createdArtifacts.push(artifact.destination);
  }
  return createdArtifacts;
};

function createZip(source, destination) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);
    archive.pipe(output);
    archive.file(source, { name: path.basename(source) });
    archive.finalize();
  });
}
