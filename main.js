// Modules to control application life and create native browser window
const electron = require('electron')
const process = require('process')
const prompt = require('electron-prompt');

process.on('uncaughtException', function (error) {
    console.error(error);
});

const {app, BrowserWindow, ipcMain, screen, shell, globalShortcut , session, desktopCapturer, dialog} = require('electron')
const path = require('path')
const contextMenu = require('electron-context-menu');

var ver = app.getVersion();

var argv = require('yargs')
  .usage("Usage: $0 -w num -h num -w string -p")
  .example(
    "$0 -w 1280 -h 720 -u https://vdo.ninja/?view=xxxx",
    "Loads the stream with ID xxxx into a window sized 1280x720"
  )
  .option("w", {
    alias: "width",
    describe: "The width of the window in pixel.",
    type: "number",
    nargs: 1,
	default: 1280
  })
  .option("h", {
    alias: "height",
    describe: "The height of the window in pixels.",
    type: "number",
    nargs: 1,
	default: 720
  })
  .option("u", {
    alias: "url",
    describe: "The URL of the window to load.",
	default: "https://vdo.ninja/electron?version="+ver,
    type: "string"
  })
  .option("t", {
    alias: "title",
    describe: "The default Title for the app Window",
    type: "string",
	default: null
  })
  .option("p", {
    alias: "pin",
    describe: "Toggle always on top",
    type: "boolean",
	default: process.platform == 'darwin'
  })
  .option("a", {
    alias: "hwa",
    describe: "Enable Hardware Acceleration",
    type: "boolean",
	default: true
  })
  .option("x", {
    describe: "Window X position",
    type: "number",
  })
  .option("y", {
    describe: "Window Y position",
    type: "number",
  })
  .option("node", {
	alias: "n",
    describe: "Enables node-integration, allowing for screen capture, global hotkeys, prompts, and more.",
    type: "boolean",
	default: false
  })
  .describe("help", "Show help.") // Override --help usage message.
  
var { width, height, url, title, pin, hwa, x, y , node} = argv.argv;

if (!(url.startsWith("http"))){
	url = "https://"+url.toString();
}

if (!(hwa)){
	app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch('enable-features', 'WebAssemblySimd'); // Might not be needed in the future with Chromium; not supported on older Chromium. For faster greenscreen effects.
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

var counter=0;
var forcingAspectRatio = false;


function createWindow (URL=url, NODE=node) {
 
	let currentTitle = "ElectronCapture";
  
	if (title===null){
		counter+=1;
		currentTitle = "Electron "+(counter.toString());
	} else if (counter==0){
		counter+=1;
		currentTitle = title.toString();
	} else {
		counter+=1;
		currentTitle = title.toString() + " " +(counter.toString());
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
	
	ipcMain.on('getAppVersion', function(eventRet) {
		if (mainWindow) {
			mainWindow.webContents.send('appVersion', app.getVersion());
		}
	});
	
	ipcMain.on('prompt', function(eventRet, arg) {  // this enables a PROMPT pop up , which is used to BLOCK the main thread until the user provides input. VDO.Ninja uses prompt for passwords, etc.
	
		arg.val = arg.val || '';
		arg.title = arg.title.replace("\n","<br /><br />");
		//arg.title = "<div style='max-width:100%;word-wrap: break-word;overflow-wrap: break-word;'>"+arg.title+"</div>";
		prompt({
			title: "",
			label: arg.title,
			width: 700,
			useHtmlLabel: true,
			inputAttrs: {
				type: 'string',
				placeholder: arg.val
			},
			type: 'input',
			resizable: true
		})
		.then((r) => {
			if(r === null) {
				console.log('user cancelled');
			} else {
				console.log('result', r);
				eventRet.returnValue = r;
			}
		})
		.catch(console.error);
	
	});
	

	let factor = screen.getPrimaryDisplay().scaleFactor;
    
	// Create the browser window.
	var mainWindow = new BrowserWindow({
		width: width / factor,
		height: height / factor,
		frame: false,
		backgroundColor: '#141926',
		fullscreenable: true, 
		titleBarStyle: 'customButtonsOnHover',
		roundedCorners: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			pageVisibility: true,
			contextIsolation: !NODE,
			ackgroundThrottling: false,
			nodeIntegrationInSubFrames: NODE,
			nodeIntegration: NODE  // this could be a security hazard, but useful for enabling screen sharing and global hotkeys
			
		},
		title: currentTitle
	});

	if (x && y) {
		mainWindow.setPosition(Math.floor(x/factor), Math.floor(y/factor))
	}
  
	mainWindow.on('close', function(e) { 
        //e.preventDefault();
        mainWindow.destroy();
		globalShortcut.unregister('CommandOrControl+M');
		globalShortcut.unregisterAll();
		mainWindow = null
	});
	
	mainWindow.on('closed', function (e) {
		//e.preventDefault();
        mainWindow.destroy();
		globalShortcut.unregister('CommandOrControl+M');
		globalShortcut.unregisterAll();
		mainWindow = null
	})
	
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
app.whenReady().then(createWindow);

var DoNotClose = false;
app.on('window-all-closed', () => {
	if (DoNotClose){return;}
	app.quit();
})

contextMenu({
		prepend: (defaultActions, params, browserWindow) => [
			{
				label: 'Go to Homepage',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					var ver = app.getVersion();
					browserWindow.loadURL("https://vdo.ninja/electron?version="+ver);
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
					// browserWindow.webContents.reloadIgnoringCache();
					browserWindow.reload();
				}
			},
			{
				label: 'Open New Window',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					var ver = app.getVersion();
					createWindow("https://vdo.ninja/electron?version="+ver);
				}
			},
			{
				label: 'Elevate Privilege',
				// Only show it when right-clicking text
				
				visible: !node,
				click: () => {
					let options  = {
						 title : "Elevate the Allowed Privileges of websites",
						 buttons: ["Yes","Cancel"],
						 message: "This will reload the current page, allowing for screen-share, global-hotkeys, and message prompts.\n\nIt will however also decrease app-security, especially if on an untrusted website.\n\nContinue?"
					};
					let response = dialog.showMessageBoxSync(options);
					if (response==0){
						var URL = browserWindow.webContents.getURL();
						DoNotClose = true; // avoids fully closing the app if no other windows are open
						browserWindow.destroy();
						createWindow(URL, true); // we close the window and open it again; a faked refresh
						DoNotClose = false;
					}
				}
			},
			{
				label: 'Edit URL',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					var URL = browserWindow.webContents.getURL();
					prompt({
						title: 'Edit the URL',
						label: 'URL:',
						value: URL,
						inputAttrs: {
							type: 'url'
						},
						resizable: true,
						type: 'input'
					})
					.then((r) => {
						if(r === null) {
							console.log('user cancelled');
						} else {
							console.log('result', r);
							browserWindow.loadURL(r);
						}
					})
					.catch(console.error);
				}
			},
			{
				label: 'Edit Window Title',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
			        var title = browserWindow.getTitle();
			        prompt({
			                title: 'Edit  Window Title',
			                label: 'Title:',
			                value: title,
			                inputAttrs: {
			                        type: 'string'
			                },
			                resizable: true,
			                type: 'input'
			        })
			        .then((r) => {
			                if(r === null) {
			                        console.log('user cancelled');
			                } else {
			                        console.log('result', r);
			                        browserWindow.setTitle(r);
			                }
			        })
			        .catch(console.error);
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
							browserWindow.isFullScreen() ? browserWindow.setFullScreen(false) : browserWindow.setFullScreen(true);
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
							if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}

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
							if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
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
							if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
							let point =  screen.getCursorScreenPoint();
							let factor = screen.getDisplayNearestPoint(point).scaleFactor;
							browserWindow.setSize(640/factor, 360/factor);
						}
					},
					{
						label: 'Custom resolution',
						// Only show it when right-clicking text
						visible: true,
						click: () => {
							var URL = browserWindow.webContents.getURL();
							prompt({
								title: 'Custom window resolution',
								label: 'Enter a resolution:',
								value: browserWindow.getSize()[0] + 'x' + browserWindow.getSize()[1],
								inputAttrs: {
									type: 'string',
									placeholder: '1280x720'
								},
								type: 'input'
							})
							.then((r) => {
								if(r === null) {
									console.log('user cancelled');
								} else {
									console.log('Window resized to ', r);
									if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
									let point =  screen.getCursorScreenPoint();
									let factor = screen.getDisplayNearestPoint(point).scaleFactor;
									browserWindow.setSize(r.split('x')[0]/factor, r.split('x')[1]/factor);
								}
							})
							.catch(console.error);
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
				visible: false, // need to re-ensable this at some point
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

electron.powerMonitor.on('on-battery', () => {
	var notification = new electron.Notification(
		{
			title: 'Electron-capture performance is degraded',
			body: 'You are now on battery power. Please consider connecting your charger for improved performance.',
			icon: path.join(__dirname, "assets", "icons", "png", "256x256.png")
		});
	notification.show();
})
