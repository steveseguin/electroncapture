#!/usr/bin/env node

// Test script to verify fuses are properly set
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Testing Electron Capture fuses configuration...\n');

// Find the built app
const possiblePaths = [
  '/Applications/elecap.app',  // macOS installed
  './dist/mac/elecap.app',     // macOS built
  './dist/elecap.exe',          // Windows portable
  './dist/linux-unpacked/elecap' // Linux
];

let appPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    appPath = p;
    break;
  }
}

if (!appPath) {
  console.error('❌ Could not find built application. Please build the app first.');
  process.exit(1);
}

console.log(`Found app at: ${appPath}\n`);

// Test 1: Check fuses with npx @electron/fuses
try {
  console.log('Checking fuses configuration...');
  const result = execSync(`npx @electron/fuses read --app "${appPath}"`, { encoding: 'utf8' });
  console.log(result);
  
  // Check for dangerous fuses
  if (result.includes('RunAsNode is Enabled')) {
    console.error('❌ SECURITY ISSUE: RunAsNode is still enabled!');
  } else if (result.includes('RunAsNode is Disabled')) {
    console.log('✅ RunAsNode is properly disabled');
  }
  
  if (result.includes('EnableNodeOptionsEnvironmentVariable is Enabled')) {
    console.error('❌ SECURITY ISSUE: EnableNodeOptionsEnvironmentVariable is still enabled!');
  } else if (result.includes('EnableNodeOptionsEnvironmentVariable is Disabled')) {
    console.log('✅ EnableNodeOptionsEnvironmentVariable is properly disabled');
  }
  
  if (result.includes('EnableNodeCliInspectArguments is Enabled')) {
    console.error('❌ SECURITY ISSUE: EnableNodeCliInspectArguments is still enabled!');
  } else if (result.includes('EnableNodeCliInspectArguments is Disabled')) {
    console.log('✅ EnableNodeCliInspectArguments is properly disabled');
  }
} catch (error) {
  console.error('Error checking fuses:', error.message);
}

// Test 2: Try to exploit ELECTRON_RUN_AS_NODE (should fail)
console.log('\nTesting ELECTRON_RUN_AS_NODE exploit (should fail)...');
try {
  const testCode = 'console.log("EXPLOIT SUCCESSFUL - THIS SHOULD NOT PRINT")';
  let exploitCmd;
  
  if (process.platform === 'darwin') {
    exploitCmd = `ELECTRON_RUN_AS_NODE=true "${appPath}/Contents/MacOS/elecap" -e "${testCode}"`;
  } else if (process.platform === 'win32') {
    exploitCmd = `set ELECTRON_RUN_AS_NODE=true && "${appPath}" -e "${testCode}"`;
  } else {
    exploitCmd = `ELECTRON_RUN_AS_NODE=true "${appPath}" -e "${testCode}"`;
  }
  
  const result = execSync(exploitCmd, { encoding: 'utf8', timeout: 5000 });
  
  if (result.includes('EXPLOIT SUCCESSFUL')) {
    console.error('❌ VULNERABILITY CONFIRMED: App is vulnerable to ELECTRON_RUN_AS_NODE exploit!');
  } else {
    console.log('✅ App launched but exploit did not execute');
  }
} catch (error) {
  console.log('✅ Exploit attempt failed as expected (app did not execute arbitrary code)');
}

console.log('\nFuses test complete.');