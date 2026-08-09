const fs = require('fs');
const path = require('path');

exports.default = async function(buildResult) {
  if (process.platform !== 'win32') return [];
  
  // Get version from package.json directly
  const pkgJson = require('./package.json');
  const version = pkgJson.version;
  const isWindows11 = process.env.ELECTRON_CAPTURE_WINDOWS_VARIANT === 'win11';
  
  const distDir = buildResult.outDir;
  
  console.log('Starting afterAllArtifactBuild process');
  console.log('distDir:', distDir);
  
  const files = getWindowsArtifactFiles(distDir, version, isWindows11);

  // `electron-builder --dir` intentionally creates no installer artifacts.
  if (files.every((file) => !fs.existsSync(file.source))) {
    return [];
  }

  const createdArtifacts = [];
  for (const file of files) {
    console.log(`Looking for ${file.type} at:`, file.source);
    if (!fs.existsSync(file.source)) {
      throw new Error(`Expected Windows ${file.type} artifact not found: ${file.source}`);
    }
    console.log(`Creating ${file.type} zip at:`, file.dest);
    await createZip(file.source, file.dest);
    createdArtifacts.push(file.dest);
  }
  return createdArtifacts;
};

function getWindowsArtifactFiles(distDir, version, isWindows11) {
  return [
    {
      source: path.join(distDir, isWindows11 ? 'elecap-win11.exe' : 'elecap.exe'),
      dest: path.join(distDir, isWindows11 ? `elecap_win11_v${version}_portable.zip` : `elecap_win_v${version}_portable.zip`),
      type: 'portable'
    },
    {
      source: path.join(distDir, isWindows11 ? `elecap-${version}-win11.exe` : `elecap-${version}.exe`),
      dest: path.join(distDir, isWindows11 ? `elecap_win11_v${version}_installer.zip` : `elecap_win_v${version}_installer.zip`),
      type: 'installer'
    },
  ];
}

exports.getWindowsArtifactFiles = getWindowsArtifactFiles;

function createZip(source, dest) {
  const archiver = require('archiver');
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 9 }});
    
    output.on('close', () => {
      console.log(`Successfully created zip: ${dest}`);
      resolve();
    });
    output.on('error', reject);
    
    archive.on('error', (err) => {
      console.error('Error creating zip:', err);
      reject(err);
    });
    
    archive.pipe(output);
    archive.file(source, { name: path.basename(source) });
    archive.finalize();
  });
}
