// Modules to control application life and create native browser window
const electron = require('electron')

const process = require('process')
process.on('uncaughtException', function (error) {
    error.log(error);
}

const {app, BrowserWindow, ipcMain, screen, shell} = require('electron')
const path = require('path')


const contextMenu = require('electron-context-menu');


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

if (!(url.startsWith("http"))){
	url = "https://"+url;

}
var counter=0;


function createWindow (URL=url) {
  counter+=1;
  
  let factor = screen.getPrimaryDisplay().scaleFactor;
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: width / factor,
    height: height / factor,
	frame: false,
	backgroundColor: '#141926',
	fullscreenable: true,
	titleBarStyle: 'customButtonsOnHover',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
	  zoomFactor: 1.0 / factor
    },
	title: "OBSN "+(counter.toString())
  })
  
  
  
	mainWindow.on('close', function(e) { 
        e.preventDefault();
        mainWindow.destroy();
		//app.quit();
	});
	
	mainWindow.on("page-title-updated", function(event) {
		event.preventDefault();
	});
	
	mainWindow.webContents.on("did-fail-load", function() {
		app.quit();
	});

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
	
	try {
		mainWindow.loadURL(URL);
	} catch (e){
		app.quit();
  	}
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit();
})

contextMenu({
		prepend: (defaultActions, params, browserWindow) => [
			{
				label: 'Go to Homepage',
				// Only show it when right-clicking text
				visible: true,
				click: () => {				
					browserWindow.loadURL(`https://obs.ninja/electron`);
				}
			},
			{
				label: 'Reload',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.reload();
				}
			},
			{
				label: 'Open New Window',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					createWindow("https://obs.ninja/electron");
				}
			},
			{
				label: 'Close',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.destroy();
				}
			},
			{
				label: 'Resize to 1920x1080',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					let factor = screen.getPrimaryDisplay().scaleFactor;
					browserWindow.setSize(1920/factor, 1080/factor);
				}
			},
			{
				label: 'Resize to 1280x720',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					let factor = screen.getPrimaryDisplay().scaleFactor;
					browserWindow.setSize(1280/factor, 720/factor);
				}
			},
			{
				label: 'Resize to 640x360',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					let factor = screen.getPrimaryDisplay().scaleFactor;
					browserWindow.setSize(640/factor, 360/factor);
				}
			}
		]
	});

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
