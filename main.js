// Modules to control application life and create native browser window
const electron = require('electron')
const {app, BrowserWindow, ipcMain, screen} = require('electron')
const path = require('path')
const process = require('process')

var { argv } = require("yargs")
  .scriptName("area")
  .usage("Usage: $0 -w num -h num -w string")
  .example(
    "$0 -w 1280 -h 720 -u https://obs.ninja/?view=xxxx",
    "Loads the stream with ID xxxx into a window sized 1280x720"
  )
  .option("w", {
    alias: "width",
    describe: "The width of the window in pixel.",
    type: "number",
    nargs: 1,
  })
  .option("h", {
    alias: "height",
    describe: "The height of the window in pixels.",
    type: "number",
    nargs: 1,
  })
  .option("u", {
    alias: "url",
    describe: "The URL of the window to load.",
    type: "string",
    nargs: 1,
  })
  .describe("help", "Show help.") // Override --help usage message.
  .default("h", 720)
  .default("w", 1280)
  .default("u", "https://obs.ninja/electron")
  
const { width, height, url } = argv;

function createWindow () {
 
  const screen = electron.screen
  let factor = screen.getPrimaryDisplay().scaleFactor;
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: width / factor,
    height: height / factor,
	frame: false,
	type:'toolbar',
	backgroundColor: '#141926',
	fullscreenable: true,
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
