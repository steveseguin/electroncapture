// Modules to control application life and create native browser window
const electron = require('electron')
const process = require('process')
const prompt = require('electron-prompt');
const unhandled = require('electron-unhandled');


process.on('uncaughtException', function (error) {
	console.error("uncaughtException");
    console.error(error);
});

const {app, BrowserWindow, BrowserView, ipcMain, screen, shell, globalShortcut , session, desktopCapturer, dialog} = require('electron')
const path = require('path')
const contextMenu = require('electron-context-menu');

unhandled();

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
	alias: "x",
    describe: "Window X position",
    type: "number",
	default: -1
  })
  .option("y", {
	alias: "y",
    describe: "Window Y position",
    type: "number",
	default: -1
  })
  .option("node", {
	alias: "n",
    describe: "Enables node-integration, allowing for screen capture, global hotkeys, prompts, and more.",
    type: "boolean",
	default: false
  })
  .option("fullscreen", {
    alias: "f",
    describe: "Enables full-screen mode for the first window on its load.",
    type: "boolean",
    default: false
  })
  .describe("help", "Show help.") // Override --help usage message.

var { width, height, url, title, pin, hwa, x, y , node, fullscreen} = argv.argv;

if (!(url.startsWith("http"))){
	url = "https://"+url.toString();
}

if (!(hwa)){
	app.disableHardwareAcceleration();
}

app.commandLine.appendSwitch('enable-features', 'WebAssemblySimd'); // Might not be needed in the future with Chromium; not supported on older Chromium. For faster greenscreen effects.
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('max-web-media-player-count', '5000');

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

	ipcMain.on('prompt', function(eventRet, arg) {  // this enables a PROMPT pop up , which is used to BLOCK the main thread until the user provides input. VDO.Ninja uses prompt for passwords, etc.
		try {
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
				resizable: true,
		  alwaysOnTop: true
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
		} catch(e){errorlog(e);}

	});


	let factor = screen.getPrimaryDisplay().scaleFactor;
	var ttt = screen.getPrimaryDisplay().workAreaSize;
	
	var targetWidth = width / factor;
	var targetHeight = height / factor;
	
	var tainted = false;
	if (targetWidth > ttt.width){
		targetHeight = parseInt(targetHeight * ttt.width / targetWidth);
		targetWidth = ttt.width;
		tainted=true;
	}
	if (targetHeight > ttt.height){
		targetWidth = parseInt(targetWidth * ttt.height / targetHeight);
		targetHeight = ttt.height;
		tainted=true;
	}
	
	// Create the browser window.
	var mainWindow = new BrowserWindow({
		transparent: true,
		width: targetWidth,
		height: targetHeight,
		frame: false,
		backgroundColor: '#0000',
		fullscreenable: true,
		titleBarStyle: 'customButtonsOnHover',
		roundedCorners: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			pageVisibility: true,
			partition: 'persist:abc',
			contextIsolation: !NODE,
			backgroundThrottling: false,
			nodeIntegrationInSubFrames: NODE,
			nodeIntegration: NODE  // this could be a security hazard, but useful for enabling screen sharing and global hotkeys
		},
		title: currentTitle
	});

	try {
		mainWindow.node = NODE;

		if ((x!=-1) || (y!=-1)) {
			if (x==-1){x=0;}
			if (y==-1){y=0;}
			mainWindow.setPosition(Math.floor(x/factor), Math.floor(y/factor))
		}
	} catch(e){errorlog(e);}
	
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
	});

	mainWindow.on("page-title-updated", function(event) {
		event.preventDefault();
	});

	mainWindow.webContents.on("did-fail-load", function(e) {
		console.error("failed to load");
		console.error(e);
		app.quit();
	});
	
	mainWindow.webContents.on('did-finish-load', function(e){
		if (tainted){
			mainWindow.setSize(width/factor, height/factor); // allows for larger than display resolution.
			tainted=false;
		}
		if (mainWindow.webContents.getURL().includes('youtube.com')){
			console.log("Youtube ad skipper inserted");
			setInterval(function(){
				mainWindow.webContents.executeJavaScript('\
					if (!xxxxxx){\
						var xxxxxx = setInterval(function(){\
						if (document.querySelector(".ytp-ad-skip-button")){\
							document.querySelector(".ytp-ad-skip-button").click();\
						}\
						},500);\
					}\
				');
			},5000);
		}
	});
	
	ipcMain.on('postMessage', (msg) => {
	    console.log('We received a postMessage from the preload script')
	})

	ipcMain.on('getAppVersion', function(eventRet) {
		try{
			if (mainWindow) {
				mainWindow.webContents.send('appVersion', app.getVersion());
			}
		} catch(e){errorlog(e);}
	});
	
	if (mainWindow && mainWindow.node){
		const ret = globalShortcut.register('CommandOrControl+M', () => {
			console.log('CommandOrControl+M is pressed')
			if (mainWindow) {
				mainWindow.webContents.send('postMessage', {'mic':'toggle'})
			}
		});
		if (!ret) {
			console.log('registration failed1')
		}
	}
	
	const ret_refresh = globalShortcut.register('CommandOrControl+Shift+R', () => {
		console.log('CommandOrControl+Shift+R')
		if (mainWindow) {
			mainWindow.reload();
		}
	});
	if (!ret_refresh) {
		console.log('registration failed2')
	}
	
	
	var PPTHotkey = false;
	
	ipcMain.on('PPTHotkey', function(event, value) {
		if (!mainWindow){return;}
		if (!mainWindow.node){return;}
		if (PPTHotkey){
			try {
				if (globalShortcut.isRegistered(PPTHotkey)){
					globalShortcut.unregister(PPTHotkey);
				}
			} catch(e){
			}
		}
		
		if (!value){
			PPTHotkey=false;
			return;
		}
		PPTHotkey = "";
		if (value.ctrl){
			PPTHotkey += "CommandOrControl";
		}
		if (value.alt){
			if (PPTHotkey){PPTHotkey+="+";}
			PPTHotkey += "Alt";
		}
		if (value.meta){
			if (PPTHotkey){PPTHotkey+="+";}
			PPTHotkey += "Meta";
		}
		if (value.key){
			if (PPTHotkey){PPTHotkey+="+";}		
			var matched = false;
			if (value.key === "+"){
				PPTHotkey += "Plus";
				matched = true;
			} else if (value.key === " "){
				PPTHotkey += "Space";
				matched = true;
			} else if (value.key.length === 1){
				PPTHotkey += value.key.toUpperCase();
				matched = true;
			} else {
				var possibleKeyCodes = ["Space","Backspace","Tab","Capslock","Return","Enter","Plus","Numlock","Scrolllock","Delete","Insert","Return","Up","Down","Left","Right","Home","End","PageUp","PageDown","Escape","Esc","VolumeUp","VolumeDown","VolumeMute","MediaNextTrack","MediaPreviousTrack","MediaStop","MediaPlayPause","PrintScreen","num0","num1","num2","num3","num4","num5","num6","num7","num8","num9","numdec","numadd","numsub","nummult","numdiv"];
				for (var i = 0;i<possibleKeyCodes.length;i++){
					if (possibleKeyCodes[i].toLowerCase() === value.key.toLowerCase()){
						PPTHotkey += possibleKeyCodes[i];
						matched = true;
						break;
					}
				}
			}
			if (!matched){
				 PPTHotkey += value.key.toUpperCase(); // last resort
			}
		} else {
			//console.log("Can't register just a control button; needs a key for global hotkeys");
			return;
		}
		const ret_ppt = globalShortcut.register(PPTHotkey, function(){
			if (mainWindow) {
				mainWindow.webContents.send('postMessage', {'PPT':true})
			}
		});
		if (!ret_ppt) {
			//console.log('registration failed3')
		};
	});
	
	try {
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

		if (fullscreen){
			 if (process.platform == "XXXXdarwin"){
				mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
			 } else {
				mainWindow.isFullScreen() ? mainWindow.setFullScreen(false) : mainWindow.setFullScreen(true);
			 }
		}

		if (process.platform == "darwin"){
			try { // MacOS
				app.dock.hide();
			} catch (e){
				// Windows?
			}
		}

		session.fromPartition("default").setPermissionRequestHandler((webContents, permission, callback) => {
			try {
				let allowedPermissions = ["audioCapture", "desktopCapture", "pageCapture", "tabCapture", "experimental"]; // Full list here: https://developer.chrome.com/extensions/declare_permissions#manifest

				if (allowedPermissions.includes(permission)) {
					callback(true); // Approve permission request
				} else {
					console.error(
						`The application tried to request permission for '${permission}'. This permission was not whitelisted and has been blocked.`
					);

					callback(false); // Deny
				}
			} catch(e){errorlog(e);}
		});
	} catch(e){errorlog(e);}

	try {
		mainWindow.loadURL(URL);
	} catch (e){
		console.error(e);
		app.quit();
  	}

}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(createWindow).catch(console.error);;

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
				label: 'Reload (Ctrl+Shift+R)',
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

				visible: !browserWindow.node,
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
			/////////////
			{
				label: 'Change media device',
				// Only show it when right-clicking text
				visible: true,
				type: 'submenu',
				submenu: [
					{
						label: 'Change audio output',
						// Only show it when right-clicking text

						visible: browserWindow.node,
						click: () => {
							var buttons = ["Cancel"];
							var details = [false];
							
							browserWindow.webContents.send('postMessage', {'getDeviceList':true});
							
							ipcMain.once('deviceList', (event, deviceList) => {
								
								for (var i=0;i<deviceList.length;i++){
									if (deviceList[i].kind === "audiooutput"){
										buttons.push(deviceList[i].label);
										details.push(deviceList[i].deviceId);
									}
								}
								
								let options  = {
									 title : "Change audio output device",
									 buttons: buttons,
									 message: "Change where to send audio; as a viewer or sender"
								};
								let response = dialog.showMessageBoxSync(options);
								if (response){
									browserWindow.webContents.send('postMessage', {'changeAudioOutputDevice':details[response]});
								}
									
							});
							
							
						}
					},
					{
						label: 'Change audio input',
						// Only show it when right-clicking text

						visible: browserWindow.node,
						click: () => {
							var buttons = ["Cancel"];
							var details = [false];
							
							browserWindow.webContents.send('postMessage', {'getDeviceList':true});
							
							ipcMain.once('deviceList', (event, deviceList) => {
								
								for (var i=0;i<deviceList.length;i++){
									if (deviceList[i].kind === "audioinput"){
										buttons.push(deviceList[i].label);
										details.push(deviceList[i].deviceId);
									}
								}
								
								let options  = {
									 title : "Change audio input device",
									 buttons: buttons,
									 message: "Change your local audio input source"
								};
								let response = dialog.showMessageBoxSync(options);
								if (response){
									browserWindow.webContents.send('postMessage', {'changeAudioDevice':details[response]});
								}
							})
							
							
						}
					},
					{
						label: 'Change video input',
						// Only show it when right-clicking text

						visible: browserWindow.node,
						click: () => {
							var buttons = ["Cancel"];
							var details = [false];
							
							browserWindow.webContents.send('postMessage', {'getDeviceList':true});
							
							ipcMain.once('deviceList', (event, deviceList) => {
								
								for (var i=0;i<deviceList.length;i++){
									if (deviceList[i].kind === "videoinput"){
										buttons.push(deviceList[i].label);
										details.push(deviceList[i].deviceId);
									}
								}
								
								let options  = {
									 title : "Change video input device",
									 buttons: buttons,
									 message: "Change your local camera source"
								};
								let response = dialog.showMessageBoxSync(options);
								if (response){
									browserWindow.webContents.send('postMessage', {'changeVideoDevice':details[response]});
								}
							})
							
							
						}
					},
					{
						label: 'Requires Elevated Privileges',
						visible: !browserWindow.node,
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
					}
				]
			},
			{
				label: '🔈 Mute the window',
				type: 'checkbox',
				visible: true,
				checked: browserWindow.webContents.isAudioMuted(),
				click: () => {
					if (browserWindow.webContents.isAudioMuted()) {
						browserWindow.webContents.setAudioMuted(false);
					} else {
						browserWindow.webContents.setAudioMuted(true);
					}

				}
			},
			
			{
				label: 'Edit URL',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					var URL = browserWindow.webContents.getURL();
					var onTop = browserWindow.isAlwaysOnTop();
					if (onTop) {
						browserWindow.setAlwaysOnTop(false);
					}
					prompt({
						title: 'Edit the URL',
						label: 'URL:',
						value: URL,
						inputAttrs: {
							type: 'url'
						},
						resizable: true,
						type: 'input',
						alwaysOnTop: true
					})
					.then((r) => {
						if(r === null) {
							console.log('user cancelled');
							  if (onTop) {
								browserWindow.setAlwaysOnTop(true);
							  }
						} else {
							console.log('result', r);
              if (onTop) {
                browserWindow.setAlwaysOnTop(true);
              }
							browserWindow.loadURL(r);
						}
					})
					.catch(console.error);
				}
			},
		  {
			label: 'Insert CSS',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
			  var onTop = browserWindow.isAlwaysOnTop();
			  if (onTop) {
				browserWindow.setAlwaysOnTop(false);
			  }
			  prompt({
				title: 'Insert Custom CSS',
				label: 'CSS:',
				value: "body {background-color:#0000;}",
				inputAttrs: {
				  type: 'text'
				},
				resizable: true,
				type: 'input',
				alwaysOnTop: true
			  })
			  .then((r) => {
				if(r === null) {
				  console.log('user cancelled');
				  if (onTop) {
					browserWindow.setAlwaysOnTop(true);
				  }
				} else {
				  console.log('result', r);
				  if (onTop) {
					browserWindow.setAlwaysOnTop(true);
				  }
				  browserWindow.webContents.insertCSS(r, {cssOrigin: 'user'});
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
              var onTop = browserWindow.isAlwaysOnTop();
              if (onTop) {
                browserWindow.setAlwaysOnTop(false);
              }
			        prompt({
			                title: 'Edit  Window Title',
			                label: 'Title:',
			                value: title,
			                inputAttrs: {
			                        type: 'string'
			                },
			                resizable: true,
			                type: 'input',
                      alwaysOnTop: true
			        })
			        .then((r) => {
			                if(r === null) {
                        if (onTop) {
                          browserWindow.setAlwaysOnTop(true);
                        }
			                  console.log('user cancelled');
			                } else {
                        if (onTop) {
                          browserWindow.setAlwaysOnTop(true);
                        }
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
							if (process.platform == "XXXXdarwin"){ // On certain electron builds, fullscreen fails on macOS; this is in case it starts happening again
								browserWindow.isMaximized() ? browserWindow.unmaximize() : browserWindow.maximize();
							} else {
								browserWindow.isFullScreen() ? browserWindow.setFullScreen(false) : browserWindow.setFullScreen(true);
							}
							//browserWindow.setMenu(null);
							//const {width,height} = screen.getPrimaryDisplay().workAreaSize;
							//browserWindow.setSize(width, height);
						}
					},
					{
						label: '1920x1080',
						// Only show it when right-clicking text
						visible: true,
						click: () => {
							if (process.platform !== "XXXXdarwin"){
								if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
							} else {
								if (browserWindow.isMaximized()){browserWindow.unmaximize();}
							}
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
                            if (process.platform !== "XXXXdarwin"){
                                if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
                            } else {
                                if (browserWindow.isMaximized()){browserWindow.unmaximize();}
                            }	
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
							if (process.platform !== "XXXXdarwin"){
                                if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
                            } else {
                                if (browserWindow.isMaximized()){browserWindow.unmaximize();}
                            }
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
				            var onTop = browserWindow.isAlwaysOnTop();
              				if (onTop) {
				                browserWindow.setAlwaysOnTop(false);
              				}
							prompt({
								title: 'Custom window resolution',
								label: 'Enter a resolution:',
								value: browserWindow.getSize()[0] + 'x' + browserWindow.getSize()[1],
								inputAttrs: {
									type: 'string',
									placeholder: '1280x720'
								},
								type: 'input',
                				alwaysOnTop: true
							})
							.then((r) => {
								if(r === null) {
									console.log('user cancelled');
                  					if (onTop) {
                    					browserWindow.setAlwaysOnTop(true);
                  					}
								} else {
									console.log('Window resized to ', r);
                  					if (onTop) {
					                    browserWindow.setAlwaysOnTop(true);
                  					}
									if (process.platform !== "XXXXdarwin"){
                                		if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
                            		} else {
                                		if (browserWindow.isMaximized()){browserWindow.unmaximize();}
                            		}	
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
				label: 'Clean Video Output',
				type: 'checkbox',
				visible: (browserWindow.webContents.getURL().includes('youtube.com/watch') || browserWindow.webContents.getURL().includes('twitch.tv')),
				checked: false,
				click: () => {
					var css = " \
						.html5-video-player {\
							z-index:unset!important;\
						}\
						.html5-video-container {	\
							z-index:unset!important;\
						}\
						video { \
							width: 100vw!important;height: 100vh!important;  \
							left: 0px!important;    \
							object-fit: cover!important;\
							top: 0px!important;\
							overflow:hidden;\
							z-index: 2147483647;\
							position: fixed!important;\
						}\
						body {\
							overflow: hidden!important;\
						}";
					browserWindow.webContents.insertCSS(css, {cssOrigin: 'user'});
					browserWindow.webContents.executeJavaScript('document.body.appendChild(document.querySelector("video"));');
					
					browserWindow.webContents.executeJavaScript('\
						if (!xxxxxx){\
							var xxxxxx = setInterval(function(){\
							if (document.querySelector(".ytp-ad-skip-button")){\
								document.querySelector(".ytp-ad-skip-button").click();\
							}\
							},500);\
						}\
					');
				}
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
  if (BrowserWindow.getAllWindows().length === 0) {
	  createWindow()
  }
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
