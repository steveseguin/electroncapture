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
const isDev = require('electron-is-dev');

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
// main.js

let windowAudioCapture = null;
// Map to store stream callbacks by client ID
const audioStreamClients = new Map();
let audioStreamClientCounter = 0;

try {
  console.log('Loading window-audio-capture module...');
  windowAudioCapture = require('./native-modules/window-audio-capture');
  console.log('Module loaded successfully');
  
  // Test if the module methods exist and log them
  const methods = Object.keys(windowAudioCapture);
  console.log('Module methods:', methods);
  
  // Check if we have the expected API structure
  if (!windowAudioCapture.getWindowList && windowAudioCapture.captureInstance) {
    console.log('Module has captureInstance structure');
  }
  
  // Test the getWindowList function
  try {
    let windows;
    if (windowAudioCapture.getWindowList) {
      windows = windowAudioCapture.getWindowList();
    } else if (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.getWindowList) {
      windows = windowAudioCapture.captureInstance.getWindowList();
    }
    
    console.log('Windows list type:', typeof windows);
    console.log('Is array:', Array.isArray(windows));
    console.log('Windows length:', windows ? (Array.isArray(windows) ? windows.length : 'not an array') : 'undefined');
    console.log('First window:', windows && windows.length > 0 ? windows[0] : 'none');
  } catch (testError) {
    console.error('Error testing getWindowList:', testError);
  }
} catch (err) {
  console.error('Error loading window-audio-capture module:', err);
}

ipcMain.handle('get-window-list', async () => {
  try {
    if (!windowAudioCapture) {
      console.error('Window audio capture module is not loaded');
      return [];
    }
    
    // Get windows list - handle different module structures
    let rawWindows;
    if (windowAudioCapture.getWindowList) {
      rawWindows = windowAudioCapture.getWindowList();
    } else if (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.getWindowList) {
      rawWindows = windowAudioCapture.captureInstance.getWindowList();
    } else {
      console.error('getWindowList method not found on module');
      return [];
    }
    
    console.log("Raw windows type:", typeof rawWindows);
    
    // Convert to array if needed
    let windows = [];
    if (Array.isArray(rawWindows)) {
      windows = rawWindows;
    } else if (rawWindows && typeof rawWindows === 'object') {
      // Try to convert the object to an array
      // This handles if it's returning an object with numeric keys
      for (let key in rawWindows) {
        if (rawWindows.hasOwnProperty(key) && !isNaN(parseInt(key))) {
          windows.push(rawWindows[key]);
        }
      }
      
      if (windows.length === 0) {
        // Alternative approach if the above doesn't work
        windows = Object.values(rawWindows);
      }
    }
    
    console.log("Converted windows array length:", windows.length);

    return windows;
  } catch (error) {
    console.error('Error processing window list:', error);
    return [];
  }
});

ipcMain.handle('get-audio-sessions', async () => {
  try {
    return await windowAudioCapture.getAudioSessions();
  } catch (error) {
    console.error('Error getting audio sessions:', error);
    return [];
  }
});

ipcMain.handle('start-session-capture', async (event, sessionIndex) => {
  try {
    // Get the sessions to find the process ID
    const sessions = await windowAudioCapture.getAudioSessions();
    const session = sessions.find(s => s.sessionId === sessionIndex);
    
    if (!session || !session.processId) {
      console.error(`No valid session found for index ${sessionIndex}`);
      return { success: false, error: "Invalid session index" };
    }
    
    // Use the regular startCapture with the process ID
    console.log(`Starting capture for process ID ${session.processId} from session ${sessionIndex}`);
    
    try {
      const success = windowAudioCapture.startCapture(session.processId);
      return { success: !!success }; // Ensure we return a boolean
    } catch (captureError) {
      console.error('Error in startCapture:', captureError);
      return { 
        success: false, 
        error: typeof captureError === 'string' ? captureError : 
              (captureError && captureError.message) ? captureError.message : "Unknown error starting capture" 
      };
    }
  } catch (error) {
    console.error('Error in startCaptureBySession:', error);
    // Return a simple error object that can be cloned
    return { 
      success: false, 
      error: typeof error === 'string' ? error : 
            (error && error.message) ? error.message : "Unknown error occurred"
    };
  }
});

ipcMain.handle('start-window-capture', async (event, windowId) => {
  try {
    const success = windowAudioCapture.startCapture(windowId);
    return { success };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-audio-data', async () => {
  try {
    const audioData = windowAudioCapture.getAudioData();
    return { success: true, audioData };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('stop-capture', async () => {
  try {
    const success = windowAudioCapture.stopCapture();
    return { success };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-window-stream-capture', async (event, windowId) => {
  try {
    console.log(`Start window stream capture request: ${windowId} ${typeof windowId}`);
    
    // Ensure windowId is a number
    const processId = Number(windowId);
    
    if (isNaN(processId) || processId <= 0) {
      console.error(`Invalid process ID: ${windowId}`);
      return { success: false, error: "Invalid process ID" };
    }
    
    console.log(`Starting audio capture for process ID: ${processId}`);
    
    // Access the startStreamCapture method based on module structure
    const startStreamCapture = windowAudioCapture.startStreamCapture || 
                              (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.startStreamCapture);
    
    if (!startStreamCapture) {
      console.error("startStreamCapture method not found on module");
      return { success: false, error: "Audio capture method not available" };
    }
    
    // Store reference to the sender
    const sender = event.sender;
    
    // Create a callback that sends data to the renderer
    const callback = (audioData) => {
      // Only send if the window still exists
      if (!sender.isDestroyed()) {
        try {
          sender.send('audio-stream-data', { 
            clientId: processId, 
            data: audioData 
          });
        } catch (err) {
          console.error("Error sending audio data:", err);
        }
      }
    };
    
    // Start the stream with proper error handling
    try {
      // Dynamically call the method based on its location
      let result;
      
      if (windowAudioCapture.startStreamCapture) {
        result = await windowAudioCapture.startStreamCapture(processId, callback);
      } else if (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.startStreamCapture) {
        result = await windowAudioCapture.captureInstance.startStreamCapture(processId, callback);
      } else {
        throw new Error("startStreamCapture method not available");
      }
      
      if (!result) {
        return { success: false, error: "Failed to start audio capture" };
      }
      
      // Create a new result object with only the properties we need
      const safeResult = {
        success: true,
        clientId: processId
      };
      
      // Only copy primitive values that we know are serializable
      if (result.sampleRate) safeResult.sampleRate = result.sampleRate;
      if (result.channels) safeResult.channels = result.channels;
      
      // Store the client ID for cleanup
      audioStreamClients.set(processId, sender.id);
      
      console.log(`Successfully started audio capture for process ${processId}, sample rate: ${safeResult.sampleRate}, channels: ${safeResult.channels}`);
      
      return safeResult;
    } catch (captureError) {
      console.error("Error starting stream capture:", captureError);
      return { 
        success: false, 
        error: typeof captureError === 'string' ? captureError : 
              (captureError && captureError.message) ? captureError.message : "Failed to start audio capture"
      };
    }
  } catch (error) {
    console.error("Error in start-window-stream-capture:", error);
    return { 
      success: false, 
      error: typeof error === 'string' ? error : 
            (error && error.message) ? error.message : "Unknown error occurred"
    };
  }
});

ipcMain.handle('stop-stream-capture', async (event, clientId) => {
  try {
    console.log(`Stopping stream capture for client ID: ${clientId}`);
    
    if (audioStreamClients.has(clientId)) {
      audioStreamClients.delete(clientId);
    }
    
    // Access the stopStreamCapture method based on module structure
    const stopStreamCapture = windowAudioCapture.stopStreamCapture || 
                             (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.stopStreamCapture) ||
                             windowAudioCapture.stopCapture ||
                             (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.stopCapture);
    
    // Only stop if no more clients are streaming
    if (audioStreamClients.size === 0 && stopStreamCapture) {
      try {
        if (windowAudioCapture.stopStreamCapture) {
          await windowAudioCapture.stopStreamCapture(clientId);
        } else if (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.stopStreamCapture) {
          await windowAudioCapture.captureInstance.stopStreamCapture(clientId);
        } else if (windowAudioCapture.stopCapture) {
          await windowAudioCapture.stopCapture();
        } else if (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.stopCapture) {
          await windowAudioCapture.captureInstance.stopCapture();
        }
        console.log(`Successfully stopped audio capture for client ${clientId}`);
      } catch (stopError) {
        console.error(`Error stopping capture: ${stopError}`);
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error("Error in stop-stream-capture:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('getSources', async (event, args) => {
  try {
    // Get all sources from desktopCapturer
    const sources = await desktopCapturer.getSources({ 
      types: args.types,
      thumbnailSize: { width: 150, height: 150 }
    });
    
    // Get audio sessions for correlation
    let audioSessions = [];
    try {
      audioSessions = await windowAudioCapture.getAudioSessions();
      console.log('Audio sessions found:', audioSessions.length);
      console.log('Audio sessions:', audioSessions);
    } catch (err) {
      console.warn('Could not get audio sessions:', err);
    }
    
    // Get window list for correlation
    let windows = [];
    try {
      windows = await windowAudioCapture.getWindowList();
      console.log('Windows found:', windows.length);
    } catch (err) {
      console.warn('Could not get window list:', err);
    }
    
    // Build a map of process IDs to session IDs for quick lookup
    const processToSession = {};
    audioSessions.forEach(session => {
      if (session.processId) {
        processToSession[session.processId] = session.sessionId;
      }
    });
    
    // Process sources to make them serializable and add audio info
    const processedSources = sources.map(source => {
      // Find matching window by title
      const sourceNameLower = source.name.toLowerCase();
      const matchingWindow = Array.isArray(windows) ? 
        windows.find(win => 
          win.title.toLowerCase().includes(sourceNameLower) || 
          sourceNameLower.includes(win.title.toLowerCase())
        ) : null;
      
      // Check if this window's process has an audio session
      let matchingSessionId = null;
      let hasAudio = false;
      
      if (matchingWindow && matchingWindow.processId) {
        // Try direct process ID match
        if (processToSession[matchingWindow.processId]) {
          matchingSessionId = processToSession[matchingWindow.processId];
          hasAudio = true;
        } else {
          // Try to find by executable name
          const exeName = matchingWindow.executableName?.toLowerCase();
          if (exeName) {
            const matchingSession = audioSessions.find(session => 
              session.executableName?.toLowerCase() === exeName
            );
            if (matchingSession) {
              matchingSessionId = matchingSession.sessionId;
              hasAudio = true;
            }
          }
        }
      }
      
      // For known audio applications, mark as having audio even without session
      const knownAudioApps = [
        'chrome', 'firefox', 'edge', 'brave', 'opera', 'safari',
        'spotify', 'itunes', 'music', 'youtube', 'vlc', 'netflix',
        'discord', 'teams', 'slack', 'zoom', 'meet', 'skype',
        'electron'
      ];
      
      if (!hasAudio && matchingWindow && matchingWindow.executableName) {
        const exeLower = matchingWindow.executableName.toLowerCase();
        for (const app of knownAudioApps) {
          if (exeLower.includes(app)) {
            hasAudio = true;
            break;
          }
        }
      }
      
      // For testing - enable audio for all windows temporarily
      // hasAudio = true;
      
      return {
        id: source.id,
        name: source.name,
        display_id: source.display_id || '',
        appIcon: source.appIcon ? source.appIcon.toDataURL() : '',
        thumbnail: source.thumbnail.toDataURL(),
        hasAudio: hasAudio,
        audioSessionId: matchingSessionId,
        windowId: matchingWindow ? matchingWindow.id : null,
        processId: matchingWindow ? matchingWindow.processId : null,
        executableName: matchingWindow ? matchingWindow.executableName : null
      };
    });
    
    return processedSources;
  } catch(e) {
    console.error('Error in getSources:', e);
    throw e;
  }
});

ipcMain.handle('check-admin-rights', async () => {
  try {
    // Check if process is running with admin rights
    let isElevated = false;
    const { execSync } = require('child_process');
    
    try {
      // Simple check - try to write to Program Files which needs admin rights
      const testFile = 'C:\\Program Files\\test_admin_rights.txt';
      execSync(`echo test > "${testFile}"`, { timeout: 1000 });
      execSync(`del "${testFile}"`, { timeout: 1000 });
      isElevated = true;
    } catch (e) {
      isElevated = false;
    }
    
    return isElevated;
  } catch (error) {
    console.error('Error checking admin rights:', error);
    return false;
  }
});

const { Readable } = require('stream');
const { fetch: undiciFetch } = require('undici');
const activeStreams = new Map();
const https = require('https');

process.on('uncaughtException', function (error) {
	console.error("uncaughtException");
    console.error(error);
});

unhandled();

var ver = app.getVersion();

function createYargs(){
  var argv = Yargs.usage('Usage: $0 -w=num -h=num -u="string" -p')
  .example(
    '$0 -w=1280 -h=720 -u="https://vdo.ninja/?view=xxxx"',
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
  .option("monitor", {
	  alias: "m",
	  describe: "Monitor index to open on (0-based index)",
	  type: "number",
	  default: 0
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
	nargs: 1,
	default: -1
  })
  .option("y", {
	alias: "y",
    describe: "Window Y position",
    type: "number",
	nargs: 1,
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
  .option("js", {
	  alias: "js",
	  describe: "Have local JavaScript script be auto-loaded into every page",
	  type: "string",
	  default: null
	})
  .option("savefolder", {
    alias: "sf",
    describe: "Where to save a file on disk",
    type: "string",
    default: null
  })
   .option("mediafoundation", {
    alias: "mf",
    describe: "Enable media foundation video capture",
    type: "string",
    default: null
  })
  .option("disablemediafoundation", {
    alias: "dmf",
    describe: "Disable media foundation video capture; helps capture some webcams",
    type: "string",
    default: null
  })
  .option("css", {
    alias: "css",
    describe: "Have local CSS script be auto-loaded into every page",
    type: "string",
    default: null
  })
  .option("chroma", {
    alias: "color",
    describe: "Set background CSS to target hex color; FFF or 0000 are examples.",
    type: "string",
	default: null
  })
  .option("hidecursor", {
    alias: "hc",
    describe: "Hide the mouse pointer / cursor",
    type: "boolean",
	default: null
  })
  .describe("help", "Show help.") // Override --help usage message.
  .wrap(process.stdout.columns); 
  
  return argv.argv;
}

var Argv = createYargs();

if (Argv.help) {
  Argv.showHelp();
  process.exit(0); // Exit the script after showing help.
}

if (!app.requestSingleInstanceLock(Argv)) {
	console.log("requestSingleInstanceLock");
	return;
}


function parseDeepLink(deepLinkUrl) {
    console.log('Parsing deep link:', deepLinkUrl);
    try {
        // Create a copy of default args
        const newArgs = {...Argv};
        
        deepLinkUrl = deepLinkUrl.replace("electroncapture://", "https://");
        let url = new URL(deepLinkUrl);
        
        console.log('Parsed URL:', {
            pathname: url.pathname,
            search: url.search,
            hash: url.hash
        });
        
        newArgs.url = url.href;
        
        // Parse window parameters from query string
        const params = new URLSearchParams(url.search);
        
        // Map URL parameters to window arguments
        if (params.has('w')) newArgs.width = parseInt(params.get('w'));
        if (params.has('h')) newArgs.height = parseInt(params.get('h'));
        if (params.has('x')) newArgs.x = parseInt(params.get('x'));
        if (params.has('y')) newArgs.y = parseInt(params.get('y'));
        if (params.has('pin')) newArgs.pin = params.get('pin') === 'true';
        if (params.has('title')) newArgs.title = params.get('title');
        if (params.has('full')) newArgs.fullscreen = params.get('full') === 'true';
        if (params.has('min')) newArgs.minimized = params.get('min') === 'true';

        console.log('Parsed deep link args:', newArgs);
        return newArgs;
    } catch (error) {
        console.error('Error parsing deep link URL:', error);
        return null;
    }
}

function registerProtocolHandling() {
    // Check if we're already the default protocol handler
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('electroncapture', process.execPath, [path.resolve(process.argv[1])])
        }
    } else {
        app.setAsDefaultProtocolClient('electroncapture');
    }

    // Handle the case where the app is not the default handler
    if (!app.isDefaultProtocolClient('electroncapture')) {
        try {
            app.setAsDefaultProtocolClient('electroncapture');
        } catch (error) {
            console.error('Failed to register protocol handler:', error);
        }
    }
}

// Handle deep linking on Windows
if (process.platform === 'win32') {
  const deepLinkUrl = process.argv.find(arg => arg.startsWith('electroncapture://'));
  if (deepLinkUrl) {
    console.log('Found deep link in initial launch:', deepLinkUrl);
    const args = parseDeepLink(deepLinkUrl);
    if (args && args.url) {
        Argv = args; // Update initial arguments if valid
    }
  }
}
// Register protocol client
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('electroncapture', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('electroncapture');
}


function getDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path+'/'+file).isDirectory();
  });
}
if (Argv.title){
	app.setAppUserModelId(Argv.title);
} else {
	app.setAppUserModelId("ele.cap");
}


if (!(Argv.hwa)){
	app.disableHardwareAcceleration();
	console.log("HWA DISABLED");
}

if (!(Argv.mf)){
	app.commandLine.appendSwitch('enable-features', 'MediaFoundationVideoCapture');
	//app.commandLine.appendSwitch('force-directshow')
	//console.log("Media Foundations video cap ENABLED");
	// --force-directshow
}
if (!(Argv.dmf)){
	app.commandLine.appendSwitch('disable-features', 'MediaFoundationVideoCapture');
	//app.commandLine.appendSwitch('force-directshow')
	//console.log("Media Foundations video cap ENABLED");
	// --force-directshow
}

app.commandLine.appendSwitch('enable-features', 'WebAssemblySimd'); // Might not be needed in the future with Chromium; not supported on older Chromium. For faster greenscreen effects.
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('max-web-media-player-count', '5000');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('ignore-certificate-errors-spki-list');
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'http://insecure.vdo.ninja,http://insecure.rtc.ninja,http://whip.vdo.ninja,https://whip.vdo.ninja,http://whep.vdo.ninja,https://whep.vdo.ninja,http://insecure.versus.cam,http://127.0.0.1,https://vdo.ninja,https://versus.cam,https://rtc.ninja');


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

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

function formatURL(inputURL) {
  if (!inputURL.startsWith("http://") && !inputURL.startsWith("https://") && !inputURL.startsWith("file://")) {
    return "https://" + inputURL;
  }
  return inputURL;
}

// Clean up when a renderer is destroyed
app.on('web-contents-destroyed', (event, webContents) => {
  const webContentsId = webContents.id;
  
  // Find and remove any audio stream clients for this renderer
  for (const [clientId, senderId] of audioStreamClients.entries()) {
    if (senderId === webContentsId) {
      audioStreamClients.delete(clientId);
    }
  }
  
  // Stop capture if no more clients
  if (audioStreamClients.size === 0 && windowAudioCapture) {
    try {
      windowAudioCapture.stopCapture();
    } catch (err) {
      console.error('Error stopping capture:', err);
    }
  }
});

ipcMain.handle('noCORSFetch', async (event, args) => {
  const streamId = Date.now().toString();
  
  try {
    const isHttps = args.url.toLowerCase().startsWith('https://');
    const fetchOptions = {
      method: args.method || 'GET',
      headers: {
        ...args.headers
      }
    };

    // Add dispatcher with SSL verification disabled for HTTPS URLs
    if (isHttps) {
      fetchOptions.dispatcher = new (require('undici').Agent)({
        connect: {
          rejectUnauthorized: false
        }
      });
    }

    const response = await undiciFetch(args.url, fetchOptions);
    
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    const boundary = boundaryMatch ? boundaryMatch[1] : null;
    const reader = response.body.getReader();
    
    activeStreams.set(streamId, {
      reader,
      buffer: Buffer.alloc(0)
    });

    return {
      ok: true,
      status: response.status,
      streamId,
      contentType,
      boundary: boundary ? `${boundary}` : null
    };
  } catch (error) {
    console.error('Fetch error:', error);
    return {
      ok: false,
      error: error.message
    };
  }
});

// Rest of the code remains unchanged
ipcMain.handle('readStreamChunk', async (event, streamId) => {
  const stream = activeStreams.get(streamId);
  if (!stream) return { done: true };
  try {
    const { done, value } = await stream.reader.read();
    if (done) {
      activeStreams.delete(streamId);
      return { done: true };
    }
    return { 
      done: false, 
      value: Array.from(value)
    };
  } catch (error) {
    console.error('Stream read error:', error);
    activeStreams.delete(streamId);
    throw error;
  }
});

ipcMain.handle('closeStream', async (event, streamId) => {
  const stream = activeStreams.get(streamId);
  if (stream?.reader) {
    try {
      await stream.reader.cancel();
    } catch (e) {
      console.error('Error closing stream:', e);
    }
    activeStreams.delete(streamId);
  }
  return true;
});

ipcMain.handle('prompt', async (event, arg) => {
  try {
    arg.val = arg.val || '';
    arg.title = arg.title.replace("\n","<br /><br />");
    const result = await prompt({
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
    });
    
    if(result === null) {
      console.log('user cancelled');
      return null;
    } else {
      console.log('result', result);
      return result;
    }
  } catch(e) {
    console.error(e);
    throw e;
  }
});

const windowStateManager = {
  getPath: function() {
    return path.join(app.getPath('userData'), 'window-state.json');
  },
  
	save: function(window) {
	  try {
		if (!window || window.isDestroyed()) {
		  console.warn('Cannot save state for destroyed window');
		  return false;
		}

		let boundsToSave;
		const isMaximized = window.isMaximized();
		const isFullScreen = window.isFullScreen();
		const isMinimized = window.isMinimized(); // Check if minimized

		if (isMinimized) {
		  window.restore(); // Temporarily restore to get correct bounds
		  boundsToSave = window.getBounds();
		  // It's closing, so re-minimizing might not be strictly necessary,
		  // but if you have other logic that expects it to be minimized:
		  // window.minimize();
		} else {
		  boundsToSave = window.getBounds();
		}

		const windowState = {
		  bounds: boundsToSave,
		  isMaximized: isMaximized,
		  isFullScreen: isFullScreen,
		  monitor: -1 // Your existing monitor detection logic here
		};

		// --- Begin: Your existing monitor detection logic (lines 868-878 in original) ---
		const displays = screen.getAllDisplays();
		for (let i = 0; i < displays.length; i++) {
		  const display = displays[i];
		  const intersection = this.getIntersection(display.bounds, boundsToSave); // Use boundsToSave
		  if (intersection.width > 0 && intersection.height > 0) {
			windowState.monitor = i;
			break;
		  }
		}
		// --- End: Your existing monitor detection logic ---

		const statePath = this.getPath();
		// console.log('Saving window state to:', statePath, JSON.stringify(windowState)); // More detailed log
		fs.writeFileSync(statePath, JSON.stringify(windowState, null, 2));
		console.log('Window state saved:', windowState);
		return true;

	  } catch (e) {
		console.error('Failed to save window state:', e);
		return false;
	  }
	},
  load: function() {
    try {
      if (!fs.existsSync(this.getPath())) {
        console.log('No saved window state found');
        return null;
      }
      
      const data = fs.readFileSync(this.getPath(), 'utf8');
      const state = JSON.parse(data);
      console.log('Loaded window state:', state);
      return state;
    } catch (e) {
      console.error('Failed to load window state:', e);
      return null;
    }
  },
  
  getIntersection: function(rect1, rect2) {
    const x1 = Math.max(rect1.x, rect2.x);
    const y1 = Math.max(rect1.y, rect2.y);
    const x2 = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
    const y2 = Math.min(rect1.y + rect1.height, rect2.y + rect2.height);
    
    return {
      x: x1,
      y: y1,
      width: Math.max(0, x2 - x1),
      height: Math.max(0, y2 - y1)
    };
  }
};

async function createWindow(args, reuse=false) {
  var webSecurity = true;
  
  // Check if args are valid
  if (!args || typeof args !== 'object') {
    console.error('Invalid args passed to createWindow:', args);
    args = createYargs(); // Use default args if invalid
  }
  
  var URL = args.url, NODE = args.node, WIDTH = args.width, HEIGHT = args.height, TITLE = args.title, PIN = args.pin, X = args.x, Y = args.y, FULLSCREEN = args.fullscreen, UNCLICKABLE = args.uc, MINIMIZED = args.min, CSS = args.css, BGCOLOR = args.chroma, JS = args.js;

  // Load saved window state
  const savedState = windowStateManager.load();
  let factor = screen.getPrimaryDisplay().scaleFactor;
  
  console.log(args);
  
  var CSSCONTENT = "";
  
  if (BGCOLOR){
    CSSCONTENT = "body {background-color:#"+BGCOLOR+"!important;}";
  }
  
  if (CSS){
    var p = path.join(__dirname, '.', CSS);
    console.log("Trying: "+p);
    
    // Convert to use Promise explicitly instead of await
    try {
      let cssData = null;
      try {
        cssData = fs.readFileSync(p, 'utf8');
      } catch(e) {
        // Try alternate path
        cssData = fs.readFileSync(CSS, 'utf8');
      }
      
      if (cssData) {
        CSSCONTENT += cssData;
        console.log("Loaded specified CSS file.");
      }
    } catch(e) {
      console.log("Couldn't read specified CSS file:", e);
    }
  }
  
  var JSCONTENT = "";

  if (JS){
    var p = path.join(__dirname, '.', JS);
    console.log("Trying JS file: "+p);
    
    // Convert to use Promise explicitly instead of await
    try {
      let jsData = null;
      try {
        jsData = fs.readFileSync(p, 'utf8');
      } catch(e) {
        // Try alternate path
        jsData = fs.readFileSync(JS, 'utf8');
      }
      
      if (jsData) {
        JSCONTENT += jsData;
        console.log("Loaded specified JS file.");
      }
    } catch(e) {
      console.log("Couldn't read specified JS file:", e);
    }
  }
  
  try {
    if (URL.startsWith("file:")){
      webSecurity = false;
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
		titleBarStyle: 'hidden',
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
	
	if (UNCLICKABLE){
		mainWindow.mouseEvent = true;
		mainWindow.setIgnoreMouseEvents(mainWindow.mouseEvent);
	}
	
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
		mainWindow.node = NODE; // NODE is from args

		const cliX = args.x;           // X from command-line arguments
		const cliY = args.y;           // Y from command-line arguments
		// targetWidth and targetHeight are already calculated in your code before BrowserWindow constructor
		// using args.width, args.height, and factor.
		// Example: var targetWidth = WIDTH / factor; (where WIDTH is args.width)

		let positionSource = "Unknown"; // For logging

		if (cliX !== -1 && cliY !== -1) {
			// Priority 1: Explicit X, Y from command line.
			positionSource = `Command Line X/Y: x=${cliX}, y=${cliY}`;
			// Assuming cliX and cliY from yargs are logical pixels similar to width/height
			// Your original code applies factor: mainWindow.setPosition(Math.floor(X/factor), Math.floor(Y/factor));
			// The window size (targetWidth, targetHeight) was already set by the BrowserWindow constructor.
			mainWindow.setPosition(Math.floor(cliX / factor), Math.floor(cliY / factor));

		} else if (savedState && savedState.bounds) {
			// Priority 2: No explicit X,Y from command line (-1), AND savedState exists.
			positionSource = `Saved State: bounds=${JSON.stringify(savedState.bounds)}, monitor=${savedState.monitor}`;
			const { x, y, width, height } = savedState.bounds;

			// Validate if these bounds are on a connected display.
			const displays = screen.getAllDisplays();
			let onValidMonitor = false;
			const savedMonitorIndex = savedState.monitor;

			// Check if the saved monitor index is valid and if the window is on it.
			if (savedMonitorIndex !== undefined && savedMonitorIndex >= 0 && savedMonitorIndex < displays.length) {
				const targetDisplay = displays[savedMonitorIndex];
				// A simple check: is the top-left corner within the work area of the saved monitor?
				// For a more robust check, you might want to see if a significant portion of the window intersects.
				if (x >= targetDisplay.workArea.x && x < targetDisplay.workArea.x + targetDisplay.workArea.width &&
					y >= targetDisplay.workArea.y && y < targetDisplay.workArea.y + targetDisplay.workArea.height) {
					onValidMonitor = true;
				}
			}

			// If not on the specifically saved monitor (e.g., monitor disconnected),
			// check if the coordinates fall on *any* currently connected monitor.
			if (!onValidMonitor) {
				for (let i = 0; i < displays.length; i++) {
					const display = displays[i];
					if (x >= display.workArea.x && x < display.workArea.x + display.workArea.width &&
						y >= display.workArea.y && y < display.workArea.y + display.workArea.height) {
						onValidMonitor = true;
						console.warn(`Window was saved on monitor ${savedMonitorIndex}, but it now appears to be on monitor ${i}. Restoring there.`);
						break;
					}
				}
			}

			if (onValidMonitor) {
				// setBounds uses physical pixels. savedState.bounds are stored as physical pixels.
				mainWindow.setBounds({ x, y, width, height });
				if (savedState.isMaximized) {
					mainWindow.maximize();
				} else if (savedState.isFullScreen) {
					mainWindow.setFullScreen(true);
				}
			} else {
				// Saved position is off-screen. Fallback to centering the default size.
				positionSource += " (Off-screen Fallback)";
				console.warn("Saved window position appears off-screen. Falling back to default placement.");
				// Window size is already default (targetWidth, targetHeight) from constructor. Center it.
				mainWindow.center(); // Electron's utility to center the window on the current screen.
			}
		} else {
			// Priority 3: No explicit X,Y, AND no (or invalid) savedState.
			// Position based on args.monitor (default 0) or center on primary.
			// Window size is already default (targetWidth, targetHeight) from constructor.
			positionSource = `Default Positioning (Monitor ${args.monitor} or Primary)`;
			console.log("No explicit X/Y and no valid saved state. Using default positioning logic.");

			const displays = screen.getAllDisplays();
			let displayToCenterOn = screen.getPrimaryDisplay(); // Default to primary

			if (args.monitor !== undefined && args.monitor >= 0 && args.monitor < displays.length) {
				displayToCenterOn = displays[args.monitor];
			}

			// Calculate center position on the chosen display's work area
			const centerX = displayToCenterOn.workArea.x + (displayToCenterOn.workArea.width - targetWidth) / 2;
			const centerY = displayToCenterOn.workArea.y + (displayToCenterOn.workArea.height - targetHeight) / 2;
			mainWindow.setPosition(Math.floor(centerX), Math.floor(centerY));
		}
		console.log(`Window positioning determined by: ${positionSource}`);

	} catch (e) {
		console.error('Error applying window state during createWindow positioning:', e);
		// Fallback in case of any error during positioning
		console.error('Fallback: Centering window with default size due to an error.');
		mainWindow.center(); // Uses the size set in BrowserWindow constructor
	}
	
	mainWindow.on('blur', () => {
		mainWindow.setBackgroundColor('#00000000'); // tmp fix for bug in e.js
		globalShortcut.unregister('Alt+Enter');
	});
	
	mainWindow.on('focus', () => {
		mainWindow.setBackgroundColor('#00000000'); // tmp fix for bug in e.js
		globalShortcut.register('Alt+Enter', () => {
			if (mainWindow && mainWindow.isFocused()) {
				if (process.platform == "darwin"){ // On certain electron builds, fullscreen fails on macOS; this is in case it starts happening again
					mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
				} else {
					if (mainWindow.full || mainWindow.isFullScreen()){
						mainWindow.full = false;
						mainWindow.setFullScreen(false);
					} else {
						mainWindow.full = true;
						mainWindow.setFullScreen(true);
					}
				}
			}
		});
	});
  
  
	mainWindow.webContents.on('will-prevent-unload', (event) => {
		const options = {
			type: 'question',
			buttons: ['Cancel', 'Leave'],
			message: 'Leave Site?',
			detail: 'This will end any active streams and may cause any recording that are in progress to be lost.',
		};
		const response = dialog.showMessageBoxSync(null, options)
		if (response === 1) event.preventDefault();
	});

	mainWindow.on('close', function(e) {
	  console.log(`Window ID ${mainWindow.id} 'close' event triggered.`);
	  e.preventDefault(); // Prevent the window from closing immediately

	  // 1. Save window state (uses the improved save function from step 1)
	  console.log(`Window ID ${mainWindow.id}: Saving state...`);
	  windowStateManager.save(mainWindow);

	  // 2. Hide the window
	  console.log(`Window ID ${mainWindow.id}: Hiding window...`);
	  mainWindow.hide();

	  // 3. Send 'hangup' message
	  console.log(`Window ID ${mainWindow.id}: Sending 'hangup' message...`);
	  if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
		mainWindow.webContents.send('postMessage', {'hangup':true});
	  }

	  // 4. Wait 5 seconds, then destroy the window
	  console.log(`Window ID ${mainWindow.id}: Starting 5-second timer for destruction...`);
	  const windowToDestroy = mainWindow; // Capture reference for the timeout

	  setTimeout(() => {
		if (windowToDestroy && !windowToDestroy.isDestroyed()) {
		  console.log(`Window ID ${windowToDestroy.id}: 5-second timer elapsed. Destroying window.`);
		  windowToDestroy.destroy();
		} else {
		  console.log(`Window ID ${windowToDestroy ? windowToDestroy.id : 'unknown'}: Window was already destroyed or became null before 5s timer finished.`);
		}
	  }, 5000);

	  // Regarding globalShortcut.unregister:
	  // Unregistering 'CommandOrControl+M' might be okay if it's specific to this window.
	  // However, globalShortcut.unregisterAll() here is problematic if other windows/app functions rely on global shortcuts.
	  // It's better to manage unregisterAll() at the app quit level.
	  // Example: if (globalShortcut.isRegistered('CommandOrControl+M')) { globalShortcut.unregister('CommandOrControl+M'); }
	});
	
	mainWindow.on('closed', function () { // Around line 1112
		console.log(`Window ID ${mainWindow ? mainWindow.id : 'unknown'} 'closed' event.`);
	});

	mainWindow.on("page-title-updated", function(event) {
		console.log("page-title-updated");
		event.preventDefault();
	});

	mainWindow.webContents.on("did-fail-load", function(e) {
		console.error("failed to load");
		console.error(e);
		//app.quit();
	});
	
	mainWindow.webContents.on('new-window', (event, url, frameName, disposition, options, additionalFeatures, referrer, postBody) => {
		console.log("new-window");
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
		console.log("will-download");
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
		console.log("did-finish-load");
		if (tainted){
			mainWindow.setSize(parseInt(WIDTH/factor), parseInt(HEIGHT/factor)); // allows for larger than display resolution.
			tainted=false;
		}
		if (mainWindow && mainWindow.webContents.getURL().includes('youtube.com')){
			console.log("Youtube ad skipper inserted");
			setInterval(function(mw){
				try {
					mw.webContents.executeJavaScript('\
						if (typeof xxxxxx == "undefined") {\
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
		
		if (JSCONTENT && mainWindow && mainWindow.webContents){
		  try {
			// Wrap the JS content in an IIFE to avoid global scope pollution
			const safeJS = `
			  (function() {
				try {
				  ${JSCONTENT}
				} catch(e) {
				  console.error('Error in injected JavaScript:', e);
				}
			  })();
			`;
			mainWindow.webContents.executeJavaScript(safeJS);
			console.log("Injecting specified JavaScript contained in the file");
		  } catch(e){
			console.log('Error preparing JS injection:', e);
		  }
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
	
	const ret_refresh = globalShortcut.register('CommandOrControl+Shift+Alt+R', () => {
		console.log('CommandOrControl+Shift+Alt+R')
		if (mainWindow) {
			mainWindow.reload();
		}
	});
	if (!ret_refresh) {
		console.log('registration failed2')
	}
	
	
	
	const socialstream = globalShortcut.register('CommandOrControl+Shift+Alt+X', () => {
		console.log('CommandOrControl+Shift+Alt+X')
		if (mainWindow) {
			if (mainWindow.mouseEvent){
				mainWindow.mouseEvent = false;
				mainWindow.setIgnoreMouseEvents(mainWindow.mouseEvent);
				mainWindow.show()
				
				if (!mainWindow.args.pin){
					mainWindow.setAlwaysOnTop(false);
				}
			} else {
				mainWindow.mouseEvent = true;
				mainWindow.setIgnoreMouseEvents(mainWindow.mouseEvent);
				
				if (process.platform == 'darwin'){
					mainWindow.setAlwaysOnTop(true, "floating", 1)
				} else {
					mainWindow.setAlwaysOnTop(true, "level");
				}
			}
		}
	});
	if (!socialstream) {
		console.log('registration failed3')
	}
	
	// "CommandOrControl+Shift+X
	
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

		if (reuse){
			if (FULLSCREEN){
				 if (process.platform == "darwin"){
					mainWindow.maximize();
				 } else {
					mainWindow.setFullScreen(true);
				 }
			}
		} else if (FULLSCREEN){
			 if (process.platform == "darwin"){
				mainWindow.maximize();
			 } else {
				mainWindow.setFullScreen(true);
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
		console.log("ready to show");
        if (MINIMIZED){
            mainWindow.minimize();
		//+ KravchenkoAndrey 08.01.2022
        } else if (UNCLICKABLE){
            mainWindow.showInactive();
		//- KravchenkoAndrey 08.01.2022
        } else {
            mainWindow.show();
        }
		if (mainWindow && mainWindow.isFocused()) {
			globalShortcut.register('Alt+Enter', () => {
				console.log("PRESSED")
				if (process.platform == "darwin"){ // On certain electron builds, fullscreen fails on macOS; this is in case it starts happening again
					mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
				} else {
					console.log("mainWindow.isFullScreen(): ",mainWindow.isFullScreen());
					
					if (mainWindow.full || mainWindow.isFullScreen()){
						mainWindow.full = false;
						mainWindow.setFullScreen(false);
					} else {
						mainWindow.full = true;
						mainWindow.setFullScreen(true);
					}
				}
			});
		}
    });
	
  try {
    var HTML = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" /><style>body {padding:0;height:100%;width:100%;margin:0;}</style></head><body><div style="-webkit-app-region: drag;height:25px;width:100%"></div></body></html>';
    mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURI(HTML));
  } catch(e){
    console.error(e);
  }
  
  // Load the actual URL
  try {
    mainWindow.loadURL(URL);
  } catch (e){
    console.error(e);
  }
	
	
	try {
		
		mainWindow.webContents.on('dom-ready', async (event)=> {
			console.log('dom-ready');

			if (mainWindow.args.hidecursor){
				mainWindow.webContents.insertCSS(`
				  * {
					cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), none !important;
					user-select: none!important;
				  }
				  :root {
					  --electron-drag-fix: none!important;
					  
				  }
				`);
			}
		});
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
			visible: browserWindow.webContents.canGoBack(),
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
			label: '♻ Reload (Ctrl+Shift+Alt+R)',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				
				browserWindow.reload();
				
				/* DoNotClose = true; // avoids fully closing the app if no other windows are open
				
				var args = browserWindow.args; // reloading doesn't work otherwise
				args.url = browserWindow.webContents.getURL();
				var title = browserWindow.getTitle();
				browserWindow.destroy();
				createWindow(args, title); // we close the window and open it again; a faked refresh
				DoNotClose = false; */
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
						try {
							browserWindow.loadURL(formatURL(r));
						} catch(e){
							console.error(e);
						}
						if (onTop) {
							browserWindow.setAlwaysOnTop(true);
						}
						console.log(browserWindow);
						console.log(formatURL(r));
						
						// var args = browserWindow.args; // reloading doesn't work otherwise
						// args.url = r;
						// var title = browserWindow.getTitle();
						
						// var size = browserWindow.getSize();
						// args.width = size[0];
						// args.height = size[1];
						
						// if (process.platform !== "darwin"){
							// args.fullscreen = browserWindow.isFullScreen();
						// } else {
							// args.fullscreen = browserWindow.isMaximized();
						// }
						
						// args.fullscreen = true;
						
						// browserWindow.destroy();
						// createWindow(args, title); // we close the window and open it again; a faked refresh
						// DoNotClose = false;
						
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
		click: async () => {
		  var onTop = browserWindow.isAlwaysOnTop();
		  if (onTop) {
			browserWindow.setAlwaysOnTop(false);
		  }
		  const savedValue = await browserWindow.webContents.executeJavaScript(`localStorage.getItem('insertCSS');`);
		  
		  console.log(savedValue);
		  prompt({
			title: 'Insert Custom CSS',
			label: 'CSS:',
			value: savedValue || "body {background-color:#0000;}",
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
			  browserWindow.webContents.executeJavaScript(`localStorage.setItem('insertCSS', '${r}');`);
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
		  label: '📝 Insert JavaScript',
		  visible: true,
		  click: async () => {
			var onTop = browserWindow.isAlwaysOnTop();
			if (onTop) {
			  browserWindow.setAlwaysOnTop(false);
			}
			const savedValue = await browserWindow.webContents.executeJavaScript(`localStorage.getItem('insertJS');`);
			
			prompt({
			  title: 'Insert Custom JavaScript',
			  label: 'JavaScript:',
			  value: savedValue || "console.log('Custom JavaScript loaded');",
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
				browserWindow.webContents.executeJavaScript(`
				  localStorage.setItem('insertJS', ${JSON.stringify(r)});
				`);
				if (onTop) {
				  browserWindow.setAlwaysOnTop(true);
				}
				browserWindow.webContents.executeJavaScript(r);
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
					label: 'Fullscreen (alt+tab)',
					// Only show if not already full-screen
					visible: !browserWindow.isMaximized(),
					click: () => {
						if (process.platform == "darwin"){ // On certain electron builds, fullscreen fails on macOS; this is in case it starts happening again
							browserWindow.isMaximized() ? browserWindow.unmaximize() : browserWindow.maximize();
						} else {
							if (browserWindow.full || browserWindow.isFullScreen()){
								browserWindow.full = false;
								browserWindow.setFullScreen(false);
							} else {
								browserWindow.full = true;
								browserWindow.setFullScreen(true);
							}
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
						let factor = screen.getDisplayNearestPoint(point).scaleFactor || 1;
						browserWindow.setSize(parseInt(1920/factor), parseInt(1080/factor));
						browserWindow.full = false;
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
						let factor = screen.getDisplayNearestPoint(point).scaleFactor || 1;
						browserWindow.setSize(parseInt(1280/factor), parseInt(720/factor));
						browserWindow.full = false;
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
						let factor = screen.getDisplayNearestPoint(point).scaleFactor || 1;
						browserWindow.setSize(parseInt(640/factor), parseInt(360/factor));
						browserWindow.full = false;
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
								browserWindow.full = false;
								if (onTop) {
									browserWindow.setAlwaysOnTop(true);
								}
								if (process.platform !== "darwin"){
									if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
								} else {
									if (browserWindow.isMaximized()){browserWindow.unmaximize();}
								}	
								let point =  screen.getCursorScreenPoint();
								let factor = screen.getDisplayNearestPoint(point).scaleFactor || 1;
								console.log(r);
								console.log(factor);
								browserWindow.setSize(parseInt(r.split('x')[0]/factor), parseInt(r.split('x')[1]/factor));
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
			label: '🖱️ Hide cursor',
			type: 'checkbox',
			visible: true,
			checked: browserWindow.args.hidecursor || false,
			click: () => { 
				browserWindow.args.hidecursor = !browserWindow.args.hidecursor || false;
				if (browserWindow.args.hidecursor){
					browserWindow.webContents.insertCSS(`
					  * {
						cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), none !important;
						user-select: none!important;
					  }
					  :root {
						  --electron-drag-fix: none!important;
						  
					  }
					`);
				} else {
					browserWindow.webContents.insertCSS(`
					  * {
						cursor: auto!important;
					  }
					  :root {
						  --electron-drag-fix: drag!important;
						  
					  }
					`);
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
			label: '🚫🖱 ️Make UnClickable until in-focus or CTRL+SHIFT+ALT+X',
			visible: true, // Only show it when pinned
			click: () => {
				if (browserWindow){
					if (!browserWindow.isAlwaysOnTop()) {
						if (process.platform == 'darwin'){
							browserWindow.setAlwaysOnTop(true, "floating", 1)
						} else {
							browserWindow.setAlwaysOnTop(true, "level");
						}
						browserWindow.setVisibleOnAllWorkspaces(true);
					}
					browserWindow.mouseEvent = true;
					browserWindow.setIgnoreMouseEvents(browserWindow.mouseEvent);
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

/* app.on('second-instance', (event, commandLine, workingDirectory, argv2) => {
	createWindow(argv2, argv2.title); // works, but not with deeplinks for example
}); */

app.on('second-instance', (event, commandLine, workingDirectory, argv2) => {
    console.log('Second instance launched with args:', commandLine);
    
    // Check for deep link first
    const deepLinkUrl = commandLine.find(arg => arg.startsWith('electroncapture://'));
    if (deepLinkUrl) {
        console.log('Processing deep link:', deepLinkUrl);
        const args = parseDeepLink(deepLinkUrl);
        if (args) {
            createWindow(args);
            return;
        }
    }

    const windowConfig = {
        ...Argv,  // Start with default arguments
        ...argv2, // Override with new arguments
        width: argv2.w || argv2.width || Argv.width,
        height: argv2.h || argv2 || Argv.height,
        x: typeof argv2.x !== 'undefined' ? argv2.x : Argv.x,
        y: typeof argv2.y !== 'undefined' ? argv2.y : Argv.y
    };

    console.log('Creating window with config:', windowConfig);
    createWindow(windowConfig, windowConfig.title);
});

// macOS deep linking support
app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('Received open-url event:', url);
    if (url.startsWith('electroncapture://')) {
        const args = parseDeepLink(url);
        if (args) {
            // Ensure app is ready before creating window
            if (app.isReady()) {
                console.log('Creating window from deep link with args:', args);
                createWindow(args);
            } else {
                app.on('ready', () => {
                    console.log('App ready, creating window from deep link with args:', args);
                    createWindow(args);
                });
            }
        }
    }
});

var DoNotClose = false;
app.on('window-all-closed', () => {
  if (DoNotClose){ // Your existing DoNotClose logic
    //console.log("DO NOT CLOSE!");
    return;
  }
  console.log("'window-all-closed': All windows are closed. Unregistering all shortcuts and quitting.");
  globalShortcut.unregisterAll();
  app.quit();
});

var closing = 0;

app.on('before-quit', (event) => {
  console.log("Application 'before-quit' event triggered.");
  if (!BrowserWindow.getAllWindows().length) {
    console.log("'before-quit': No windows open, quitting normally.");
    return; // No need to preventDefault or delay if no windows.
  }

  // The 'closing' variable logic is from your original code.
  if (global.closing !== 2) { // Assuming 'closing' is a global or appropriately scoped variable
    global.closing = 1;
    console.log("'before-quit': Preventing immediate quit to process windows.");
    event.preventDefault(); // Prevent immediate quit

    BrowserWindow.getAllWindows().forEach((bw) => {
      if (bw && !bw.isDestroyed()) {
        console.log(`'before-quit': Processing window ID ${bw.id}.`);
        windowStateManager.save(bw); // Use the robust save function
        bw.hide();
        if (bw.webContents && !bw.webContents.isDestroyed()) {
          bw.webContents.send('postMessage', {'hangup':true});
        }
        // Note: The window's own 5-second destroy timer (from its 'close' event)
        // might be initiated if bw.close() was called, but here we are directly
        // hiding and sending hangup. The app's 1.6s quit timer will likely take precedence.
      }
    });

    setTimeout(() => {
      console.log("'before-quit': 1.6-second app shutdown timer elapsed. Forcing quit.");
      global.closing = 2;
      app.quit();
    }, 1600); // Your original 1.6-second timeout
  } else {
    console.log("'before-quit': Already in closing process (closing === 2).");
  }
});

const folder = path.join(app.getPath('appData'), `${app.name}`);
if (!fs.existsSync(folder)) {
	fs.mkdirSync(folder, { recursive: true });
}
app.setPath('userData', folder);

function checkProtocolHandler() {
  const isDefault = app.isDefaultProtocolClient('electroncapture');
  console.log('Is electroncapture protocol handler registered?', isDefault);
  
  if (!isDefault) {
    const success = app.setAsDefaultProtocolClient('electroncapture');
    console.log('Attempted to register protocol handler:', success);
  }
}

// Remove the checkProtocolHandler function as it's redundant with registerProtocolHandling

app.whenReady().then(function(){
    console.log("APP READY");
    
    // Set up permission handling
    session.fromPartition("default").setPermissionRequestHandler((webContents, permission, callback) => {
        try {
            let allowedPermissions = [
                "audioCapture", 
                "desktopCapture", 
                "pageCapture", 
                "tabCapture", 
                "experimental"
            ];
            
            if (allowedPermissions.includes(permission)) {
                callback(true); // Approve permission request
            } else {
                console.error(
                    `The application tried to request permission for '${permission}'. This permission was not whitelisted and has been blocked.`
                );
                callback(false); // Deny
            }
        } catch(e) {
            console.error(e);
            callback(false); // Deny on error
        }
    });

    // Register protocol handler first
    registerProtocolHandling();
    
	createWindow(Argv);
    
    // Handle Windows-specific startup
    if (process.platform === 'win32') {
        try {
            const squirrelStartup = require('electron-squirrel-startup');
            if (squirrelStartup) {
                app.quit();
                return;
            }
        } catch(e) {
            console.error('Error checking squirrel startup:', e);
        }
    }
}).catch(console.error);


// Add Windows installer events if you're using electron-squirrel-startup
if (require('electron-squirrel-startup')) app.quit();

if (process.platform === 'win32') {
  const handleStartupEvent = () => {
    if (process.platform !== 'win32') {
      return false;
    }

    const squirrelCommand = process.argv[1];
    switch (squirrelCommand) {
      case '--squirrel-install':
      case '--squirrel-updated':
        // Register protocol handler
        registerProtocolHandling();
        return true;
      case '--squirrel-uninstall':
        // Remove protocol handler registration
        app.removeAsDefaultProtocolClient('electroncapture');
        return true;
      case '--squirrel-obsolete':
        app.quit();
        return true;
    }
  };

  if (handleStartupEvent()) {
    app.quit();
  }
}

app.on('ready', () => {
    // Clear any problematic cache entries on startup
    const userDataPath = app.getPath('userData');
    const cachePath = path.join(userDataPath, 'Cache');
    try {
        if (fs.existsSync(cachePath)) {
            fs.rmdirSync(cachePath, { recursive: true });
        }
    } catch (error) {
        console.warn('Could not clear cache:', error);
    }

    // Your existing ready handler code
    app.on('web-contents-created', (e, wc) => {
        wc.on('context-menu', (ee, params) => {
            wc.send('context-menu-ipc', params);
        });
    });
    
    app.on('browser-window-focus', (event, win) => {
        console.log('browser-window-focus', win.webContents.id);
        win.setIgnoreMouseEvents(false);
    });
    
    if (!isDev) {
        registerProtocolHandling();
    }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(Argv); // createWindow will load and apply saved state
  }
});

electron.powerMonitor.on('on-battery', () => {
	var notification = new electron.Notification(
		{
			title: 'Electron-capture performance is degraded',
			body: 'You are now on battery power. Please consider connecting your charger for improved performance.',
			icon: path.join(__dirname, "assets", "icons", "png", "256x256.png")
		});
	notification.show();
})
