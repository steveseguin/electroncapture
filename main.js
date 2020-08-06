// Modules to control application life and create native browser window
const {app, BrowserWindow, ipcMain, screen} = require('electron')
const path = require('path')
const process = require('process')
const yargs = require('yargs')

const argv = yargs
    .command('width', 'Sets the WIDTH in pixels', {
        width: {
            description: 'Sets the width in pixels',
            alias: 'w',
            type: 'number',
        }
    })
	.command('height', 'Sets the HEIGHT in pixels', {
        height: {
            description: 'Sets the height in pixels',
            alias: 'h',
            type: 'number',
        }
    })
	.command('url', 'Sets the URL to load', {
        url: {
            description: 'Sets the URL to loads',
            alias: 'u',
            type: 'string',
        }
    })
    .help()
    .alias('help', 'h')
    .argv;

function createWindow () {
  let url = "https://obs.ninja/electron";
  let width = 1280;
  let height = 720;

  if (argv._.includes('url')) {
    url = argv.url || "https://obs.ninja/electron";
  }
  if (argv._.includes('height')) {
    height = argv.height || 720;
  }
  if (argv._.includes('width')) {
    width = argv.width || 1280;
  }

  let factor = screen.getPrimaryDisplay().scaleFactor;
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: width / factor,
    height: height / factor,
	frame: false,
	backgroundColor: '#141926',
	titleBarStyle: 'customButtonsOnHover',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
	  zoomFactor: 1.0 / factor
    }
  })

// "floating" + 1 is higher than all regular windows, but still behind things
// like spotlight or the screen saver
   mainWindow.setAlwaysOnTop(true, "floating", 1);
// allows the window to show over a fullscreen window
   mainWindow.setVisibleOnAllWorkspaces(true);

  	try { // MacOS
		app.dock.hide();
  	} catch (e){
		// Windows?
  	}
    mainWindow.loadURL(url);
  }

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit();
})

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
