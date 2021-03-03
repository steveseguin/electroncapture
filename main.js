// Modules to control application life and create native browser window
const electron = require('electron')
const process = require('process')

process.on('uncaughtException', function (error) {
    console.error(error);
});

const {app, BrowserWindow, ipcMain, screen, shell, globalShortcut , session, desktopCapturer} = require('electron')
const path = require('path')
const contextMenu = require('electron-context-menu');

var { argv } = require("yargs")
  .scriptName("area")
  .usage("Usage: $0 -w num -h num -w string -p")
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
  .option("t", {
    alias: "title",
    describe: "The default Title for the app Window",
    type: "string",
    nargs: 1,
  })
  .option("p", {
    alias: "pin",
    describe: "Toggle always on top",
    type: "boolean"
  })
  .describe("help", "Show help.") // Override --help usage message.
  .default("h", 720)
  .default("w", 1280)
  .default("u", "https://obs.ninja/electron")
  .default("t", null)
  .default("p", process.platform == 'darwin')
  
const { width, height, url, title, pin } = argv;

if (!(url.startsWith("http"))){
	url = "https://"+url;
}

var counter=0;
var forcingAspectRatio = false;

function createWindow (URL=url) {
 
	let currentTitle = "OBSN";
  
	if (title==null){
		counter+=1;
		currentTitle = "OBSN "+(counter.toString());
	} else if (counter==0){
		counter+=1;
		currentTitle = title;
	} else {
		counter+=1;
		currentTitle = title + " " +(counter.toString());
	}
	
	const ret = globalShortcut.register('CommandOrControl+M', () => {
		console.log('CommandOrControl+N is pressed')
		if (mainWindow) {
			mainWindow.webContents.send('postMessage', {'mic':'toggle'})
		}
	})
	
	ipcMain.on('postMessage', () => {
	    console.log('We received a postMessage from the preload script')
	})

	if (!ret) {
		console.log('registration failed')
	}
	

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
			//	zoomFactor: 1.0 / factor,
			nodeIntegration: true  // this could be a security hazard, but useful for enabling screen sharing and global hotkeys
		},
		title: currentTitle
	});
  
	mainWindow.on('close', function(e) { 
        e.preventDefault();
        mainWindow.destroy();
		globalShortcut.unregister('CommandOrControl+M');
		globalShortcut.unregisterAll();
		//app.quit();
	});
	
	mainWindow.on("page-title-updated", function(event) {
		event.preventDefault();
	});
	
	mainWindow.webContents.on("did-fail-load", function() {
		app.quit();
	});

	if (pin == true) {
		// "floating" + 1 is higher than all regular windows, but still behind things
		// like spotlight or the screen saver
		mainWindow.setAlwaysOnTop(true, "floating", 1);
		// allows the window to show over a fullscreen window
   		mainWindow.setVisibleOnAllWorkspaces(true);
	} else {
		mainWindow.setAlwaysOnTop(false);
		// allows the window to show over a fullscreen window
		mainWindow.setVisibleOnAllWorkspaces(false);
	}

  	try { // MacOS
		app.dock.hide();
  	} catch (e){
		// Windows?
  	}
	
	
	session.fromPartition("default").setPermissionRequestHandler((webContents, permission, callback) => {
        let allowedPermissions = ["audioCapture", "desktopCapture", "pageCapture", "tabCapture", "experimental"]; // Full list here: https://developer.chrome.com/extensions/declare_permissions#manifest

        if (allowedPermissions.includes(permission)) {
            callback(true); // Approve permission request
        } else {
            console.error(
                `The application tried to request permission for '${permission}'. This permission was not whitelisted and has been blocked.`
            );

            callback(false); // Deny
        }
    });
	
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
				label: 'Go Back',
				// Only show it when right-clicking text
				visible: true,
				click: () => {	
					if (browserWindow.webContents.canGoBack()) {				
						browserWindow.webContents.goBack();
					}
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
				label: 'Resize window',
				// Only show it when right-clicking text
				visible: true,
				type: 'submenu',
				submenu: [
					{
						label: 'Fullscreen',
						// Only show if not already full-screen
						visible: !browserWindow.isMaximized(),
						click: () => {
							browserWindow.isMaximized() ? browserWindow.unmaximize() : browserWindow.maximize();
							browserWindow.setMenu(null);

							//const {width,height} = screen.getPrimaryDisplay().workAreaSize;
							//browserWindow.setSize(width, height);
						}
					},
					{
						label: '1920x1080',
						// Only show it when right-clicking text
						visible: true,
						click: () => {
							if (browserWindow.isMaximized()){browserWindow.unmaximize();}

							//let factor = screen.getPrimaryDisplay().scaleFactor;
							//browserWindow.setSize(1920/factor, 1080/factor);
							let point =  screen.getCursorScreenPoint();
							let factor = screen.getDisplayNearestPoint(point).scaleFactor;
							browserWindow.setSize(1920/factor, 1080/factor);
						}
					},
					{
						label: '1280x720',
						// Only show it when right-clicking text
						visible: true,
						click: () => {
							if (browserWindow.isMaximized()){browserWindow.unmaximize();}
							let point =  screen.getCursorScreenPoint();
							let factor = screen.getDisplayNearestPoint(point).scaleFactor;
							browserWindow.setSize(1280/factor, 720/factor);
						}
					},
					{
						label: '640x360',
						// Only show it when right-clicking text
						visible: true,
						click: () => {
							if (browserWindow.isMaximized()){browserWindow.unmaximize();}
							let point =  screen.getCursorScreenPoint();
							let factor = screen.getDisplayNearestPoint(point).scaleFactor;
							browserWindow.setSize(640/factor, 360/factor);
						}
					}
				]
			},
			{
				label: 'Always on top',
				type: 'checkbox',
				visible: true,
				checked: browserWindow.isAlwaysOnTop(),
				click: () => {
					if (browserWindow.isAlwaysOnTop()) {
						browserWindow.setAlwaysOnTop(false);
						browserWindow.setVisibleOnAllWorkspaces(false);
					} else {
						browserWindow.setAlwaysOnTop(true, "floating", 1);
						browserWindow.setVisibleOnAllWorkspaces(true);
					}

				}
			},
			{
				label: 'Force 16/9 aspect ratio',
				type: 'checkbox',
				visible: true,
				checked: forcingAspectRatio,
				click: () => {
					if (forcingAspectRatio) {
						browserWindow.setAspectRatio(0)
						forcingAspectRatio = false
					} else {
						browserWindow.setAspectRatio(16/9)
						forcingAspectRatio = true
					}
					
				}
			},
			{
				label: 'Close',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.destroy();
				}
			}
		]
	});

app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
