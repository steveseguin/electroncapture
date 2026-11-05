'use strict';

// Opt-in: briefly opens an available ASIO input, counts callbacks, and discards
// all samples. No output channels, recordings, or external connections.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const duration = Number(process.env.VALIDATION_ASIO_SECONDS || 0);
const cycles = Number(process.env.VALIDATION_ASIO_CYCLES || 10);
assert.ok(Number.isInteger(duration) && duration >= 0 && duration <= 3600);
assert.ok(Number.isInteger(cycles) && cycles >= 1 && cycles <= 100);
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-asio-runtime-'));
  const env = { ...process.env, ASIO_ARTIFACTS: directory, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
    '--multiinstance', '--minimized', '--no-node', '--url=data:text/html,<body>ASIO lifecycle fixture</body>'],
  { env, cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: (duration + 90) * 1000 });
  fs.writeFileSync(path.join(directory, 'runtime.log'), (run.stdout || '') + (run.stderr || ''));
  console.log(`ASIO runtime artifacts: ${directory}`);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  console.log(JSON.stringify({ electron: report.electron, passed: report.passed, skipped: report.skipped, error: report.error,
    cycles: report.cycles.length, devices: report.devices?.map(device => device.name), foreignDenied: report.foreignDenied,
    finalSoakSample: report.soak?.samples.at(-1), reloadRecovery: report.reloadRecovery, closeCleanup: report.closeCleanup }));
  assert.equal(run.status, 0, report.error || run.error?.message);
  assert.ok(report.passed || report.skipped);
} else {
  const { app, BrowserWindow } = require('electron');
  app.setAsDefaultProtocolClient = () => false; app.isDefaultProtocolClient = () => true;
  const report = { electron: process.versions.electron, passed: false, cycles: [] };
  const save = () => fs.writeFileSync(path.join(process.env.ASIO_ARTIFACTS, 'result.json'), JSON.stringify(report, null, 2));
  const wait = async (fn, label) => {
    for (let i = 0; i < 200; i++) { if (await fn()) return; await sleep(30); }
    throw new Error(`ASIO timeout: ${label}`);
  };
  require('../main');
  const asio = require('../native-modules/electron-asio/lib/index');
  const active = new Set(), originalCreate = asio.createStream;
  asio.createStream = config => {
    const stream = originalCreate(config), originalClose = stream.close.bind(stream);
    active.add(stream);
    stream.close = () => { originalClose(); active.delete(stream); };
    return stream;
  };
  app.whenReady().then(async () => {
    try {
      await wait(() => BrowserWindow.getAllWindows().length === 1, 'owner');
      const owner = BrowserWindow.getAllWindows()[0];
      await wait(() => !owner.webContents.isLoading(), 'load');
      report.devices = await owner.webContents.executeJavaScript('electronApi.getAsioDevicesAsync()');
      const device = report.devices.find(item => item.maxInputChannels > 0 && (!process.env.VALIDATION_ASIO_DEVICE || item.name === process.env.VALIDATION_ASIO_DEVICE));
      if (!device) { report.skipped = 'No matching ASIO input device'; return; }
      const config = { deviceIndex: device.index, sampleRate: device.defaultSampleRate, bufferSize: 512, inputChannels: [0], outputChannels: [] };
      report.config = config; save();
      const foreign = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
      await foreign.loadURL('data:text/html,<body>Foreign ASIO owner</body>');
      const open = async () => {
        return owner.webContents.executeJavaScript(`(async () => {
          window.callbackCount=0; window.sampleCount=0;
          window.offAsio=electronApi.onAsioAudioData((_id,buffers)=>{window.callbackCount++;window.sampleCount+=buffers.reduce((sum,buffer)=>sum+buffer.length,0);});
          window.fixtureStream=await electronApi.createAsioStreamAsync(${JSON.stringify(config)});
          await window.fixtureStream.start();return window.fixtureStream.streamId;
        })()`);
      };
      const baseline = owner.webContents.listenerCount('did-start-navigation');
      for (let cycle = 0; cycle < cycles; cycle++) {
        const id = await open();
        if (cycle === 0) {
          report.foreignDenied = await foreign.webContents.executeJavaScript(`(async()=>{
            const ipc=require('electron').ipcRenderer;
            for(const method of ['getStreamStats','startStream','stopStream','writeStream']) {
              try{await ipc.invoke('asio:'+method,${JSON.stringify(id)},[]);return false;}catch{}
            }
            await ipc.invoke('asio:closeStream',${JSON.stringify(id)});
            return true;
          })()`);
          assert.equal(report.foreignDenied, true);
        }
        await wait(() => owner.webContents.executeJavaScript('window.callbackCount>=5'), 'input callbacks');
        report.cycles.push(await owner.webContents.executeJavaScript(`(async()=>({callbacks:window.callbackCount,samples:window.sampleCount,stats:await window.fixtureStream.getStats()}))()`));
        await owner.webContents.executeJavaScript('(async()=>{await window.fixtureStream.stop();await window.fixtureStream.close();window.offAsio();})()');
        assert.equal(owner.webContents.listenerCount('did-start-navigation'), baseline);
        assert.equal(active.size, 0);
        save();
      }
      if (duration) {
        await open(); report.soak = { requestedSeconds: duration, samples: [] };
        const start = Date.now();
        while ((Date.now() - start) / 1000 < duration) {
          await sleep(Math.min(30000, duration * 1000 - (Date.now() - start)));
          report.soak.samples.push({ seconds: (Date.now() - start) / 1000,
            ...await owner.webContents.executeJavaScript('(async()=>({callbacks:window.callbackCount,samples:window.sampleCount,stats:await window.fixtureStream.getStats()}))()'),
            memoryMB: app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.privateBytes, 0) / 1024 });
          save();
        }
        assert.ok(report.soak.samples.at(-1).callbacks > duration * 10, 'ASIO callbacks must continue throughout the soak');
        await owner.webContents.executeJavaScript('(async()=>{await window.fixtureStream.stop();await window.fixtureStream.close();window.offAsio();})()');
      }
      await open(); owner.reload(); await wait(() => !owner.webContents.isLoading(), 'reload');
      assert.equal(active.size, 0);
      assert.equal(owner.webContents.listenerCount('did-start-navigation'), baseline);
      await open(); await wait(() => owner.webContents.executeJavaScript('window.callbackCount>=5'), 'reopen after reload');
      report.reloadRecovery = true;
      owner.destroy(); await sleep(100);
      assert.equal(active.size, 0);
      report.closeCleanup = true;
      report.passed = true;
    } catch (error) { report.error = error.stack; }
    finally { save(); app.exit(report.passed || report.skipped ? 0 : 1); }
  });
}
