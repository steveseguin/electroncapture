// Modules to control application life and create native browser window
const electron = require('electron')
const process = require('process')
const prompt = require('electron-prompt');
const unhandled = require('electron-unhandled');
const fs = require('fs');
const path = require('path');
const {app, BrowserWindow, BrowserView, webFrameMain, desktopCapturer, ipcMain, screen, shell, globalShortcut, session, dialog} = require('electron')
const contextMenu = require('electron-context-menu');
const Yargs = require('yargs')

process.on('uncaughtException', function (error) {
	console.error("uncaughtException");
    console.error(error);
});

unhandled();
//app.setAppUserModelId("app."+Date.now());

var ver = app.getVersion();

function createYargs(){
  var argv = Yargs.usage("Usage: $0 -w num -h num -w string -p")
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
  .option("minimized", {
	alias: "min",
    describe: "Starts the window minimized",
    type: "boolean",
	default: false
  })
  .option("fullscreen", {
    alias: "f",
    describe: "Enables full-screen mode for the first window on its load.",
    type: "boolean",
    default: false
  })
  .option("unclickable", {
    alias: "uc",
    describe: "The page will pass thru any mouse clicks or other mouse events",
    type: "boolean",
    default: false
  })
  .option("savefolder", {
    alias: "sf",
    describe: "Where to save a file on disk",
    type: "string",
    default: null
  })
  .option("css", {
    alias: "css",
    describe: "Have local CSS script be auto-loaded into every page",
    type: "string",
    default: null
  })
  .describe("help", "Show help."); // Override --help usage message.
  
  return argv.argv;
}

var Argv = createYargs();

if (!app.requestSingleInstanceLock(Argv)) {
	console.log("requestSingleInstanceLock");
	app.quit();
}

function getDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path+'/'+file).isDirectory();
  });
}

if (!(Argv.hwa)){
	app.disableHardwareAcceleration();
	console.log("HWA DISABLED");
}

app.commandLine.appendSwitch('enable-features', 'WebAssemblySimd'); // Might not be needed in the future with Chromium; not supported on older Chromium. For faster greenscreen effects.
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('max-web-media-player-count', '5000');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('ignore-certificate-errors')
app.commandLine.appendSwitch('disable-http-cache')


var counter=0;
var forcingAspectRatio = false;

var extensions = [];
try {
	var dir = false;
	if (process.platform == 'win32'){
		dir = process.env.APPDATA.replace("Roaming","")+"\\Local\\Google\\Chrome\\User Data\\Default\\Extensions";
		if (dir){
			//dir = dir.replace("Roaming","");
			var ttt = getDirectories(dir);
			ttt.forEach(d=>{
				try {
					var ddd = getDirectories(dir+"\\"+d);
					var fd = fs.readFileSync(dir+"\\"+d+"\\"+ddd[0]+"\\manifest.json", 'utf8');
					var json = JSON.parse(fd);
					
					if (json.name.startsWith("_")){
						return;			
					}
					
					extensions.push({
						"name": json.name,
						"location": dir+"\\"+d+"\\"+ddd[0]
					});
				} catch(e){}
			});
		}
	} else if (process.platform == 'darwin'){
		dir = process.env.HOME + "/Library/Application Support/Google/Chrome/Default/Extensions";
		console.log(dir);
		if (dir){
		//dir = dir.replace("Roaming","");
			var ttt = getDirectories(dir);
			ttt.forEach(d=>{
				try {
					var ddd = getDirectories(dir+"/"+d);
					var fd = fs.readFileSync(dir+"."+d+"/"+ddd[0]+"/manifest.json", 'utf8');
					var json = JSON.parse(fd);
					
					if (json.name.startsWith("_")){
						return;			
					}
					
					extensions.push({
						"name": json.name,
						"location": dir+"/"+d+"/"+ddd[0]
					});
				} catch(e){console.error(e);}
			});
		}
	}
	
} catch(e){console.error(e);}

function sleep(ms) {
  return new Promise((resolve) => {
	setTimeout(resolve, ms);
  });
}

async function createWindow(args, reuse=false){
	var webSecurity = true;
	var URL = args.url, NODE = args.node, WIDTH = args.width, HEIGHT = args.height, TITLE = args.title, PIN = args.pin, X = args.x, Y = args.y, FULLSCREEN = args.fullscreen, UNCLICKABLE = args.uc, MINIMIZED = args.min, CSS = args.css;
	console.log(args);
	
	var CSSCONTENT = false;
	if (CSS){
		var p = path.join(__dirname, '.', CSS);
		console.log("Trying: "+p);
		
		var res, rej;
		var promise = new Promise((resolve, reject) => {
			res = resolve;
			rej = reject;
		});
		promise.resolve = res;
		promise.reject = rej;
		
		fs.readFile(p, 'utf8', function (err, data) {
		  if (err) {
			  console.log("Trying: "+CSS);
			  fs.readFile(CSS, 'utf8', function (err, data) {
				  if (err) {
					  console.log("Couldn't read specified CSS file");
				  } else{
					  CSSCONTENT = data;
				  }
				  promise.resolve();
			  });
		  } else {
			  CSSCONTENT = data;
			  promise.resolve();
		  } 
		});
		await promise;
		if (CSSCONTENT){
			console.log("Loaded specified file.");
		}
	}
	try {
		if (URL.startsWith("file:")){
			webSecurity = false; // not ideal, but to open local files, this is needed.
			// warn the user in some way that this window is tained.  perhaps detect if they navigate to a different website or load an iframe that it will be a security concern? 
			// maybe filter all requests to file:// and ensure they are made from a file:// resource already.
		} else if (!(URL.startsWith("http"))){
			URL = "https://"+URL.toString();
		}
	} catch(e){
		URL = "https://vdo.ninja/electron?version="+ver;
	}

	let currentTitle = "ElectronCapture";
	
	if (reuse){
		currentTitle = reuse;
	} else if (TITLE===null){
		counter+=1;
		currentTitle = "Electron "+(counter.toString());
	} else if (counter==0){
		counter+=1;
		currentTitle = TITLE.toString();
	} else {
		counter+=1;
		currentTitle = TITLE.toString() + " " +(counter.toString());
	}
	

	ipcMain.on('prompt', function(eventRet, arg) {  // this enables a PROMPT pop up , which is used to BLOCK the main thread until the user provides input. VDO.Ninja uses prompt for passwords, etc.
		try {
			arg.val = arg.val || '';
			arg.title = arg.title.replace("\n","<br /><br />");
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
		} catch(e){console.error(e);}
	});
	
	

	let factor = screen.getPrimaryDisplay().scaleFactor;
	var ttt = screen.getPrimaryDisplay().workAreaSize;
	
	var targetWidth = WIDTH / factor;
	var targetHeight = HEIGHT / factor;
	
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
		//focusable: false,
		width: targetWidth,
		height: targetHeight,
		frame: false,
		backgroundColor: '#0000',
		fullscreenable: true,
		titleBarStyle: 'customButtonsOnHover',
		roundedCorners: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			pageVisibility: true,
			partition: 'persist:abc',
			contextIsolation: !NODE,
			backgroundThrottling: false,
			webSecurity: webSecurity,
			nodeIntegrationInSubFrames: NODE,
			nodeIntegration: NODE  // this could be a security hazard, but useful for enabling screen sharing and global hotkeys
		},
		title: currentTitle
	});
	
	if (UNCLICKABLE){
		mainWindow.setIgnoreMouseEvents(true);
		mainWindow.showInactive();
	}
	
	mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: [ "*://*/*" ] },
		(d, c)=>{
		  if(d.responseHeaders['X-Frame-Options']){
			delete d.responseHeaders['X-Frame-Options'];
		  } else if(d.responseHeaders['x-frame-options']) {
			delete d.responseHeaders['x-frame-options'];
		  }
		  c({cancel: false, responseHeaders: d.responseHeaders});
		}
	);
	
	//var appData = process.env.APPDATA+"\\..\\Local" || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share")

	

	mainWindow.args = args; // storing settings
	mainWindow.vdonVersion = false;
	mainWindow.PPTHotkey = false;
	
	ipcMain.on("vdonVersion", function(eventRet, arg) {  // this enables a PROMPT pop up , which is used to BLOCK the main thread until the user provides input. VDO.Ninja uses prompt for passwords, etc.
		if (mainWindow){
			mainWindow.vdonVersion = arg.ver || false;
		}
		console.log("arg vdonVersion:",arg);
	});
	
	
	ipcMain.on('PPTHotkey', function(eventRet, value) { // 
		console.log("updatePPT recieved 2:", value);
		if (!mainWindow){return;}
		
		if (mainWindow.PPTHotkey){
			try {
				if (globalShortcut.isRegistered(mainWindow.PPTHotkey)){
					globalShortcut.unregister(mainWindow.PPTHotkey);
				}
			} catch(e){
			}
		} 
		
		if (!value){
			mainWindow.PPTHotkey=false;
			return;
		}
		mainWindow.PPTHotkey = "";
		if (value.ctrl){
			mainWindow.PPTHotkey += "CommandOrControl";
		}
		if (value.alt){
			if (mainWindow.PPTHotkey){mainWindow.PPTHotkey+="+";}
			mainWindow.PPTHotkey += "Alt";
		}
		if (value.meta){
			if (mainWindow.PPTHotkey){mainWindow.PPTHotkey+="+";}
			mainWindow.PPTHotkey += "Meta";
		}
		if (value.key){
			if (mainWindow.PPTHotkey){mainWindow.PPTHotkey+="+";}		
			var matched = false;
			if (value.key === "+"){
				mainWindow.PPTHotkey += "Plus";
				matched = true;
			} else if (value.key === " "){
				mainWindow.PPTHotkey += "Space";
				matched = true;
			} else if (value.key.length === 1){
				mainWindow.PPTHotkey += value.key.toUpperCase();
				matched = true;
			} else {
				var possibleKeyCodes = ["Space","Backspace","Tab","Capslock","Return","Enter","Plus","Numlock","Scrolllock","Delete","Insert","Return","Up","Down","Left","Right","Home","End","PageUp","PageDown","Escape","Esc","VolumeUp","VolumeDown","VolumeMute","MediaNextTrack","MediaPreviousTrack","MediaStop","MediaPlayPause","PrintScreen","num0","num1","num2","num3","num4","num5","num6","num7","num8","num9","numdec","numadd","numsub","nummult","numdiv"];
				for (var i = 0;i<possibleKeyCodes.length;i++){
					if (possibleKeyCodes[i].toLowerCase() === value.key.toLowerCase()){
						mainWindow.PPTHotkey += possibleKeyCodes[i];
						matched = true;
						break;
					}
				}
			}
			if (!matched){
				 mainWindow.PPTHotkey += value.key.toUpperCase(); // last resort
			}
		} else {
			//console.log("Can't register just a control button; needs a key for global hotkeys");
			return;
		}
		console.log("mainWindow.PPTHotkey:"+mainWindow.PPTHotkey);
		const ret_ppt = globalShortcut.register(mainWindow.PPTHotkey, function(){
			if (mainWindow) {
				mainWindow.webContents.send('postMessage', {'PPT':true, "node":mainWindow.node})
			}
		});
		if (!ret_ppt) {
			//console.log('registration failed3')
		};
	});
	

	try {
		mainWindow.node = NODE;

		if ((X!=-1) || (Y!=-1)) {
			if (X==-1){X=0;}
			if (Y==-1){Y=0;}
			mainWindow.setPosition(Math.floor(X/factor), Math.floor(Y/factor))
		}
	} catch(e){console.error(e);}
	
	
	mainWindow.on('close', function(e) {
		e.preventDefault();
		mainWindow.hide(); // hide, and wait 2 second before really closing; this allows for saving of files.
		mainWindow.webContents.send('postMessage', {'hangup':true});
		setTimeout(function(mainWindow){
			mainWindow.destroy();
			mainWindow = null
		},1500,mainWindow); // takes 500ms to save properly; with a 1s buffer for safety
				
		globalShortcut.unregister('CommandOrControl+M');
		globalShortcut.unregisterAll();
	});

	mainWindow.on('closed', async function (e) {
		//e.preventDefault();
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
		//app.quit();
	});
	
	mainWindow.webContents.on('new-window', (event, url, frameName, disposition, options, additionalFeatures, referrer, postBody) => {
		
		mainWindow.webContents.mainFrame.frames.forEach(frame => {
			if (frame.url === referrer.url) {
				event.preventDefault();
				frame.executeJavaScript('(function () {\
					window.location = "'+url+'";\
				})();');
			} else if (frame.frames){
				frame.frames.forEach(subframe => {
					if (subframe.url === referrer.url) {
						event.preventDefault();
						subframe.executeJavaScript('(function () {\
							window.location = "'+url+'";\
						})();');
					} 
				})
			}
		});
	});
	
	
	
	mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
	  if (mainWindow.webContents){
		var currentURL = mainWindow.webContents.getURL();
	  } else if (webContents.getURL){
		  var currentURL = webContents.getURL();
	  }
	  if (currentURL.includes("autorecord") || (args.savefolder!==null)){
		  var dir = args.savefolder;
		  if (!dir && (process.platform == 'darwin')){ //process.env.USERPROFILE
				dir = process.env.HOME + "/Downloads/";
		  } else if (!dir && (process.platform == 'win32')){ //process.env.USERPROFILE
				dir = process.env.USERPROFILE + "\\Downloads\\";
		  } else if (!dir && process.env.HOME){ //process.env.USERPROFILE
				dir = process.env.HOME + "/";
		  } else if (!dir && process.env.USERPROFILE){ //process.env.USERPROFILE
				dir = process.env.USERPROFILE + "/";
		  }
		  
		  if (dir!==null){
			console.log("Auto saving too "+dir + item.getFilename());
			item.setSavePath(dir + item.getFilename())
		  }
	  }
	});
		
	
	mainWindow.webContents.on('did-finish-load', function(e){
		if (tainted){
			mainWindow.setSize(WIDTH/factor, HEIGHT/factor); // allows for larger than display resolution.
			tainted=false;
		}
		if (mainWindow && mainWindow.webContents.getURL().includes('youtube.com')){
			console.log("Youtube ad skipper inserted");
			setInterval(function(mw){
				try {
					mw.webContents.executeJavaScript('\
						if (!xxxxxx){\
							var xxxxxx = setInterval(function(){\
							if (document.querySelector(".ytp-ad-skip-button")){\
								document.querySelector(".ytp-ad-skip-button").click();\
							}\
							},500);\
						}\
					');
				} catch(e){
					clearInterval(this);
					return;
				}
			},5000, mainWindow);
		}
		
		if (CSSCONTENT && mainWindow && mainWindow.webContents){
			try {
				mainWindow.webContents.insertCSS(CSSCONTENT, {cssOrigin: 'user'});
				console.log("Inserting specified CSS contained in the file");
			} catch(e){
				console.log(e);
			}
		}
		
		//
	});
	
	//ipcMain.on('postMessage', (msg) => {
	//    console.log('We received a postMessage from the preload script')
	//})

	ipcMain.on('getAppVersion', function(eventRet) {
		try{
			if (mainWindow) {
				mainWindow.webContents.send('appVersion', app.getVersion());
			}
		} catch(e){console.error(e);}
	});
	
	ipcMain.on('getSources', async function(eventRet, args) {
		try{
			if (mainWindow) {
				const sources = await desktopCapturer.getSources({ types: args.types });
				eventRet.returnValue = sources;
			}
		} catch(e){console.error(e);}
	});
	
	
	if (mainWindow){
		const ret = globalShortcut.register('CommandOrControl+M', () => {
			console.log('CommandOrControl+M is pressed')
			if (mainWindow.node && mainWindow.vdonVersion){
				mainWindow.webContents.send('postMessage', {'micOld':'toggle'})
			} else if (mainWindow && mainWindow.vdonVersion) {
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
	
	try {
		if (PIN == true) {
			// "floating" + 1 is higher than all regular windows, but still behind things
			// like spotlight or the screen saver
			mainWindow.setAlwaysOnTop(true, "level");
			// allows the window to show over a fullscreen window
			mainWindow.setVisibleOnAllWorkspaces(true);
		} else {
			mainWindow.setAlwaysOnTop(false);
			// allows the window to show over a fullscreen window
			mainWindow.setVisibleOnAllWorkspaces(false);
		}

		if (FULLSCREEN){
			 if (process.platform == "darwin"){
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

		
	} catch(e){console.error(e);}
	
	
	mainWindow.once('ready-to-show', () => {
		if (MINIMIZED){
			mainWindow.minimize();
		} else {
			mainWindow.show();
		}
	})
	

	/* session.defaultSession.webRequest.onBeforeRequest({urls: ['file://*']}, (details, callback) => { // added for added security, but doesn't seem to be working.
	  if (details.referrer.startsWith("http://")){
		 callback({response:{cancel:true}});
	  } else if (details.referrer.startsWith("https://")){ // do not let a third party load a local resource.
		  callback({response:{cancel:true}});
	  } else {
		  callback({response:{cancel:false}});
	  }
	}); */
	
	try {
		var HTML = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" /><style>body {padding:0;height:100%;width:100%;margin:0;}</style></head><body ><div style="-webkit-app-region: drag;height:25px;width:100%"></div></body></html>';
		await mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURI(HTML));
	} catch(e){
		console.error(e);
	}
	
	try {
		mainWindow.loadURL(URL);
	} catch (e){
		console.error(e);
		//app.quit();
  	}
	
}
contextMenu({
	prepend: (defaultActions, params, browserWindow) => [
		{
			label: '🏠 Go to Homepage',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				
				DoNotClose = true;
				var ver = app.getVersion();
				var args = browserWindow.args; // reloading doesn't work otherwise
				args.url = "https://vdo.ninja/electron?version="+ver;
				var title = browserWindow.getTitle();
				browserWindow.destroy();
				createWindow(args, title); // we close the window and open it again; a faked refresh
				DoNotClose = false;
				
			}
		},
		{
			label: '🔙 Go Back',
			// Only show it when right-clicking text
			visible: browserWindow.webContents.canGoBack() && browserWindow.webContents.getActiveIndex()>1,
			click: () => {
				//var args = browserWindow.args; // reloading doesn't work otherwise
				//args.url = "https://vdo.ninja/electron?version="+ver;
				//browserWindow.destroy();
				//createWindow(args); // we close the window and open it again; a faked refresh
				//DoNotClose = false;
				browserWindow.webContents.goBack();
			}
		},
		{
			label: '♻ Reload (Ctrl+Shift+R)',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				DoNotClose = true; // avoids fully closing the app if no other windows are open
				
				var args = browserWindow.args; // reloading doesn't work otherwise
				args.url = browserWindow.webContents.getURL();
				var title = browserWindow.getTitle();
				browserWindow.destroy();
				createWindow(args, title); // we close the window and open it again; a faked refresh
				DoNotClose = false;
			}
		},
		{
			label: '✖ Open New Window',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				var ver = app.getVersion();
				var args = browserWindow.args;
				args.url = "https://vdo.ninja/electron?version="+ver;
				createWindow(args);
			}
		},
		{
			label: '⚠ Elevate Privilege',
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
					//var URL = browserWindow.webContents.getURL();
					DoNotClose = true; // avoids fully closing the app if no other windows are open
					//console.log(browserWindow.node);
					var args = browserWindow.args;
					args.url = browserWindow.webContents.getURL();
					args.node = !browserWindow.node;
					var title = browserWindow.getTitle();
					browserWindow.destroy();
					createWindow(args, title); // we close the window and open it again; a faked refresh
					DoNotClose = false;
				}
			}
		},
		/////////////
		{
			label: '🎶 Change media device',
			// Only show it when right-clicking text
			visible: true,
			type: 'submenu',
			submenu: [
				{
					label: "🔈 Change audio destination for THIS element only",
					// Only show it when right-clicking text

					visible: params.mediaType == "video" || params.mediaType == "audio" || false,
					click: () => {
						var buttons = ["Cancel"];
						var details = [false];
						
						
						// browserWindow.inspectElement(params.x, params.y)
						browserWindow.webContents.send('postMessage', {'getDeviceList':true, 'params':params});
						
						ipcMain.once('deviceList', (event, data) => {
							console.log(data);
							var deviceList = data.deviceInfos;
							
							//data.menu = menu || false;
							//data.eleId = ele.id || false;
							//data.UUID = ele.dataset.UUID || false;
							//data.deviceInfos;
							//data.params = params;
							
							for (var i=0;i<deviceList.length;i++){
								if (deviceList[i].kind === "audiooutput"){
									buttons.push(deviceList[i].label);
									details.push(deviceList[i].deviceId);
								}
							}
							let options  = {
								title : "Change audio output device",
								buttons: buttons,
								message: "Change audio output specifically for this media element"
							};
							
							let response = dialog.showMessageBoxSync(options);
							if (response){
								browserWindow.webContents.send('postMessage', {'changeAudioOutputDevice':details[response], data:data});
							}
								
						});
					}
				},
				{
					label: '🔈 Change audio destination',
					// Only show it when right-clicking text

					visible: true, //browserWindow.node,
					click: () => {
						var buttons = ["Cancel"];
						var details = [false];
						
						// browserWindow.inspectElement(params.x, params.y)
						browserWindow.webContents.send('postMessage', {'getDeviceList':true, 'params':params});
						
						ipcMain.once('deviceList', (event, data) => {
							console.log(data);
							var deviceList = data.deviceInfos;
							
							//data.menu = menu || false;
							//data.eleId = ele.id || false;
							//data.UUID = ele.dataset.UUID || false;
							//data.deviceInfos;
							//data.params = params;
							
							for (var i=0;i<deviceList.length;i++){
								if (deviceList[i].kind === "audiooutput"){
									buttons.push(deviceList[i].label);
									details.push(deviceList[i].deviceId);
								}
							}
							let options  = {
								title : "Change audio output device",
								buttons: buttons,
								message: "Change the audio output device"
							};
							
							let response = dialog.showMessageBoxSync(options);
							if (response){
								browserWindow.webContents.send('postMessage', {'changeAudioOutputDevice':details[response]});
							}
								
						});
						
						
					}
				},
				{
					label: '🎤 Change audio input [Requires Elevated Privileges]',
					visible: !browserWindow.vdonVersion && !browserWindow.node,//!browserWindow.node,
					click: () => {
						let options  = {
							 title : "Elevate the Allowed Privileges of websites",
							 buttons: ["Yes","Cancel"],
							 message: "This will reload the current page, allowing for screen-share, global-hotkeys, and message prompts.\n\nIt will however also decrease app-security, especially if on an untrusted website.\n\nContinue?"
						};
						let response = dialog.showMessageBoxSync(options);
						if (response==0){
							//var URL = browserWindow.webContents.getURL();
							DoNotClose = true; // avoids fully closing the app if no other windows are open
							//console.log(browserWindow.node);
							var args = browserWindow.args;
							args.url = browserWindow.webContents.getURL();
							args.node = !browserWindow.node;
							var title = browserWindow.getTitle();
							browserWindow.destroy();
							createWindow(args, title);
							DoNotClose = false;
						}
					}
				},
				{
					label: '🎤 Change audio input',
					// Only show it when right-clicking text

					visible: browserWindow.vdonVersion, //browserWindow.node,
					click: () => {
						var buttons = ["Cancel"];
						var details = [false];
						
						browserWindow.webContents.send('postMessage', {'getDeviceList':true, 'params':params});
						
						ipcMain.once('deviceList', (event, data) => {
							console.log(data);
							var deviceList = data.deviceInfos;
							
							//data.menu = menu || false;
							//data.eleId = ele.id || false;
							//data.UUID = ele.dataset.UUID || false;
							//data.deviceInfos;
							//data.params = params;
							
							var deviceCounter = 0;
							for (var i=0;i<deviceList.length;i++){
								if (deviceList[i].kind === "audioinput"){
									deviceCounter +=1;
									buttons.push(deviceList[i].label);
									details.push(deviceList[i].deviceId);
								}
							}
							
							let options  = { 
								 title : "Change audio input device",
								 buttons: buttons,
								 message: "Change your local audio input source"
							};
						
						
							if (!deviceCounter){
								options.message = "No audio input devices available here";
							};
							
							
							let response = dialog.showMessageBoxSync(options);
							if (response){
								browserWindow.webContents.send('postMessage', {'changeAudioDevice':details[response]});
							}
						})
					}
				},
				{
					label: '🎥 Change video input [Requires Elevated Privileges]',
					visible: !browserWindow.vdonVersion && !browserWindow.node,//!browserWindow.node,
					click: () => {
						let options  = {
							 title : "Elevate the Allowed Privileges of websites",
							 buttons: ["Yes","Cancel"],
							 message: "This will reload the current page, allowing for screen-share, global-hotkeys, and message prompts.\n\nIt will however also decrease app-security, especially if on an untrusted website.\n\nContinue?"
						};
						let response = dialog.showMessageBoxSync(options);
						if (response==0){
							//var URL = browserWindow.webContents.getURL();
							DoNotClose = true; // avoids fully closing the app if no other windows are open
							//console.log(browserWindow.node);
							var args = browserWindow.args;
							args.url = browserWindow.webContents.getURL();
							args.node = !browserWindow.node;
							var title = browserWindow.getTitle();
							browserWindow.destroy();
							createWindow(args, title);
							DoNotClose = false;
						}
					}
				},
				{
					label: '🎥 Change video input',
					// Only show it when right-clicking text

					visible: browserWindow.vdonVersion, //browserWindow.node,
					click: () => {
						var buttons = ["Cancel"];
						var details = [false];
						
						browserWindow.webContents.send('postMessage', {'getDeviceList':true, 'params':params});
						
						ipcMain.once('deviceList', (event, data) => {
							console.log(data);
							var deviceList = data.deviceInfos;
							
							//data.menu = menu || false;
							//data.eleId = ele.id || false;
							//data.UUID = ele.dataset.UUID || false;
							//data.deviceInfos;
							//data.params = params;
							var deviceCounter = 0;
							for (var i=0;i<deviceList.length;i++){
								if (deviceList[i].kind === "videoinput"){
									deviceCounter+=1;
									buttons.push(deviceList[i].label);
									details.push(deviceList[i].deviceId);
								}
							}
							let options  = {
								 title : "Change video input device",
								 buttons: buttons,
								 message: "Change your local camera source"
							};
						
						
							if (!deviceCounter){
								options.message = "No video devices available here";
							};
							
							let response = dialog.showMessageBoxSync(options);
							if (response){
								browserWindow.webContents.send('postMessage', {'changeVideoDevice':details[response]});
							}
						})
					}
				}
			]
		},
		{
			label: '🧰 Enable Chrome Extension',
			// Only show it when right-clicking text

			visible: extensions.length,
			click: () => {
				var buttons = ["Cancel"];
				
				for (var i=0;i<extensions.length;i++){
					buttons.push(extensions[i].name);
				}
				var options  = {
					 title : "Choose an extension to enable",
					 buttons: buttons,
					 message: "Choose an extension to enable. You may need to reload the window to trigger once loaded."
				};
			
			
				let idx = dialog.showMessageBoxSync(options);
				if (idx){
					idx -= 1;
					console.log(idx, extensions[idx].location);
					
					browserWindow.webContents.session.loadExtension(extensions[idx].location+"").then(({ id }) => {
						console.log("loadExtension");
					});
					// extensions
				}
			}
		},
		{
			label: '🔇 Mute the window',
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
			label: '🔴 Record Video (toggle)',
			// Only show it when right-clicking text
			visible: (browserWindow.vdonVersion && params.mediaType == "video") || false,
			click: () => {
				if (browserWindow){
					browserWindow.webContents.send('postMessage', {'record':true, 'params':params});
				}
			}
		},
		{
			label: '✏ Edit URL',
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
						var args = browserWindow.args; // reloading doesn't work otherwise
						args.url = r;
						var title = browserWindow.getTitle();
						browserWindow.destroy();
						createWindow(args, title); // we close the window and open it again; a faked refresh
						DoNotClose = false;
					}
				})
				.catch(console.error);
			}
		},
		{
			label: '🪟 IFrame Options',
			// Only show it when right-clicking text
			visible: params.frameURL,
			type: 'submenu',
			submenu: [{
				label: '✏ Edit IFrame URL',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					console.log(browserWindow.webContents);
					console.log(params);
					
					var URL = params.frameURL;
					var onTop = browserWindow.isAlwaysOnTop();
					if (onTop) {
						browserWindow.setAlwaysOnTop(false);
					}
					prompt({
						title: 'Edit the target IFrame URL',
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
							
							browserWindow.webContents.executeJavaScript('(function () {\
								var ele = document.elementFromPoint('+params.x+', '+params.y+');\
								if (ele.tagName !== "IFRAME"){\
									ele = false;\
									document.querySelectorAll("iframe").forEach(ee=>{\
										if (ee.src == "'+URL+'"){\
											ele = ee;\
										}\
									});\
								}\
								if (ele && (ele.tagName == "IFRAME")){\
									ele.src = "'+r+'";\
								}\
							})();');
							
						}
					})
					.catch(console.error);
				}
			},{
				label: '♻ Reload IFrame',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.webContents.mainFrame.frames.forEach(frame => {
					  if (frame.url === params.frameURL) {
						frame.reload();
					  }
					});
				}
			},{
				label: '🔙 Go Back in IFrame',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.webContents.mainFrame.frames.forEach(frame => {
					  if (frame.url === params.frameURL) {
						frame.executeJavaScript('(function () {window.history.back();})();');
					  }
					});
				}
			},{
				label: 'Go Forward in IFrame',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.webContents.mainFrame.frames.forEach(frame => {
					  if (frame.url === params.frameURL) {
						frame.executeJavaScript('(function () {window.history.forward();})();');
					  }
					});
				}
			}]
		},
	  {
		label: '📑 Insert CSS',
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
			label: '✏ Edit Window Title',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				var title2 = browserWindow.getTitle();
				var onTop = browserWindow.isAlwaysOnTop();
				if (onTop) {
					browserWindow.setAlwaysOnTop(false);
				}
				prompt({
					title: 'Edit  Window Title',
					label: 'Title:',
					value: title2,
					inputAttrs: {
							type: 'string'
					},
					resizable: true,
					type: 'input',
					alwaysOnTop: true
				}).then((r) => {
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
						browserWindow.args.title = r;
						browserWindow.setTitle(r);
					}
				})
				.catch(console.error);
			}
		},
		{
			label: '↔ Resize window',
			// Only show it when right-clicking text
			visible: true,
			type: 'submenu',
			submenu: [
				{
					label: 'Fullscreen',
					// Only show if not already full-screen
					visible: !browserWindow.isMaximized(),
					click: () => {
						if (process.platform == "darwin"){ // On certain electron builds, fullscreen fails on macOS; this is in case it starts happening again
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
						if (process.platform !== "darwin"){
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
						if (process.platform !== "darwin"){
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
						if (process.platform !== "darwin"){
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
								if (process.platform !== "darwin"){
									if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
								} else {
									if (browserWindow.isMaximized()){browserWindow.unmaximize();}
								}	
								let point =  screen.getCursorScreenPoint();
								let factor = screen.getDisplayNearestPoint(point).scaleFactor;
								console.log(r);
								console.log(factor);
								browserWindow.setSize(r.split('x')[0]/factor, r.split('x')[1]/factor);
							}
						})
						.catch(console.error);
					}
				}
			]
		},
		{
			label: '🚿 Clean Video Output',
			type: 'checkbox',
			visible: (!browserWindow.webContents.getURL().includes('vdo.ninja') && !browserWindow.webContents.getURL().includes('invite.cam')),
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
						z-index: 2147483647!important;\
						position: fixed!important;\
					}\
					body {\
						overflow: hidden!important;\
					}";
				browserWindow.webContents.insertCSS(css, {cssOrigin: 'user'});
				browserWindow.webContents.executeJavaScript('(function () {\
					var videos = document.querySelectorAll("video");\
					if (videos.length>1){\
						var video = videos[0];\
						for (var i=1;i<videos.length;i++){\
							if (!video.videoWidth){\
								video = videos[i];\
							} else if (videos[i].videoWidth && (videos[i].videoWidth>video.videoWidth)){\
								video = videos[i];\
							}\
						}\
						document.body.appendChild(video);\
					} else if (videos.length){\
						document.body.appendChild(videos[0]);\
					}\
				})();');
				
				if (browserWindow.webContents.getURL().includes('youtube.com')){
					browserWindow.webContents.executeJavaScript('(function () {\
						if (!xxxxxx){\
							var xxxxxx = setInterval(function(){\
							if (document.querySelector(".ytp-ad-skip-button")){\
								document.querySelector(".ytp-ad-skip-button").click();\
							}\
							},500);\
						}\
					})();');
				}
			}
		},
		{
			label: '📌 Always on top',
			type: 'checkbox',
			visible: true,
			checked: browserWindow.isAlwaysOnTop(),
			click: () => {
				if (browserWindow.isAlwaysOnTop()) {
					browserWindow.setAlwaysOnTop(false);
					browserWindow.args.pin = false;
					browserWindow.setVisibleOnAllWorkspaces(false);
				} else {
					browserWindow.args.pin = true;
					if (process.platform == 'darwin'){
						browserWindow.setAlwaysOnTop(true, "floating", 1)
					} else {
						browserWindow.setAlwaysOnTop(true, "level");
					}
					
					browserWindow.setVisibleOnAllWorkspaces(true);
				}
			}
		},
		{
			label: '🚫🖱 ️Make window *Unclickable* until in focus',
			visible: browserWindow.isAlwaysOnTop(), // Only show it when pinned
			click: () => {
				if (browserWindow){
					browserWindow.setIgnoreMouseEvents(true);
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
			label: '🔍 Inspect Element',
			visible: true,
			click: () => {
				browserWindow.inspectElement(params.x, params.y)
			}
		},
		{
			label: '❌ Close',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				browserWindow.close() // hide, and wait 2 second before really closing; this allows for saving of files.
			}
		}
	]
});

app.on('second-instance', (event, commandLine, workingDirectory, argv2) => {
	createWindow(argv2, argv2.title);
});



var DoNotClose = false;
app.on('window-all-closed', () => {
	if (DoNotClose){
		//console.log("DO NOT CLOSE!");
		return;
	}
	//console.log("DO NOT CLOSE... erk?");
	app.quit();
})

var closing = 0;
app.on('before-quit', (event) => {
	if (!BrowserWindow.getAllWindows().length){ // no windows open, so just close
		return;
	}
	
	if (closing!=2){
		closing = 1;
		event.preventDefault()
	} else if (closing==2){
		return;
	}
	
	BrowserWindow.getAllWindows().forEach((bw)=>{
		bw.hide();
		bw.webContents.send('postMessage', {'hangup':true});
	});
	setTimeout(function(){
	  closing = 2;
	  app.quit();
	},1600);
})

const folder = path.join(app.getPath('appData'), `${app.name}`);
if (!fs.existsSync(folder)) {
	fs.mkdirSync(folder, { recursive: true });
}
app.setPath('userData', folder);

app.whenReady().then(function(){
	//app.allowRendererProcessReuse = false;
	console.log("APP READY");
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
		} catch(e){console.error(e);}
	});
	createWindow(Argv);
}).catch(console.error);;

app.on('ready', () => {
    // NB: Work around electron/electron#6643
    app.on('web-contents-created', (e, wc) => {
      wc.on('context-menu', (ee, params) => {
        wc.send('context-menu-ipc', params);
      });
    });
	
	app.on('browser-window-focus', (event, win) => {
	  console.log('browser-window-focus', win.webContents.id);
	  win.setIgnoreMouseEvents(false);
	})
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.



app.on('activate', function () {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
	  createWindow(Argv);
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
