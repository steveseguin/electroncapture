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


ipcMain.on('getSources', async function(eventRet, args) {
	try{
		const sources = await desktopCapturer.getSources({ types: args.types });
		eventRet.returnValue = sources;
	} catch(e){console.error(e);}
});


const { Readable } = require('stream');
const { fetch: undiciFetch } = require('undici');
const activeStreams = new Map();
const https = require('https');
const { execSync } = require('child_process');

let windowAudioCapture = null;
const WINDOW_AUDIO_EVENT_CHANNEL = 'windowAudioStreamData';
let activeWindowAudioSession = null;
let cachedElevationState;

function isProcessElevated() {
	if (typeof cachedElevationState === 'boolean') {
		return cachedElevationState;
	}
	if (process.platform === 'win32') {
		try {
			execSync('fltmc', { stdio: 'ignore' });
			cachedElevationState = true;
		} catch (error) {
			if (error && error.code === 'ENOENT') {
				console.warn('Elevation check failed: fltmc command not available; assuming process is not elevated.');
			}
			cachedElevationState = false;
		}
		return cachedElevationState;
	}
	if (typeof process.getuid === 'function') {
		cachedElevationState = process.getuid() === 0;
		return cachedElevationState;
	}
	cachedElevationState = false;
	return cachedElevationState;
}

process.on('uncaughtException', function (error) {
	console.error("uncaughtException");
    console.error(error);
});

unhandled();

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

var ver = app.getVersion();
const DEFAULT_URL = `https://vdo.ninja/electron?version=${ver}`;

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
	default: DEFAULT_URL,
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
  .option("usewgc", {
    alias: "wgc",
    describe: "Allow Windows Graphics Capture backend. Disable for better compatibility when running elevated.",
    type: "boolean"
  })
  .describe("help", "Show help.") // Override --help usage message.
  .wrap(process.stdout.columns); 
  
  return argv.argv;
}

function sanitizeCliToken(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function collectPotentialCliArgs() {
  const aggregated = [];

  const directArgs = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  for (const entry of directArgs) {
    const sanitized = sanitizeCliToken(entry);
    if (typeof sanitized === 'string' && sanitized.length) {
      aggregated.push(sanitized);
    }
  }

  const envRaw = process.env.npm_config_argv;
  if (envRaw) {
    try {
      const parsed = JSON.parse(envRaw);
      const candidateLists = [];
      if (Array.isArray(parsed.original)) {
        candidateLists.push(parsed.original);
      }
      if (Array.isArray(parsed.cooked)) {
        candidateLists.push(parsed.cooked);
      }

      const appendTokens = (sequence) => {
        if (!Array.isArray(sequence)) {
          return;
        }
        let startIndex = sequence.indexOf('--');
        if (startIndex === -1) {
          startIndex = 0;
        } else {
          startIndex += 1;
        }
        for (let i = startIndex; i < sequence.length; i++) {
          const sanitized = sanitizeCliToken(sequence[i]);
          if (typeof sanitized === 'string' && sanitized.length && !aggregated.includes(sanitized)) {
            aggregated.push(sanitized);
          }
        }
      };

      candidateLists.forEach(appendTokens);
    } catch (error) {
      console.warn('Unable to parse npm_config_argv for CLI hydration:', error);
    }
  }

  return aggregated;
}

function hydrateArgsFromRawProcessArgs(args) {
  if (!args || typeof args !== 'object') {
    return args;
  }

  const rawArgs = collectPotentialCliArgs();
  if (!rawArgs.length) {
    return args;
  }

  try {
    console.log('hydrateArgsFromRawProcessArgs.rawArgs', rawArgs);
  } catch (e) {}

  const findIndex = (predicate) => rawArgs.findIndex(predicate);

  const urlKeys = new Set(['--url', '-u']);
  let urlIndex = findIndex((entry) => urlKeys.has(entry));
  let resolvedUrl = null;

  if (urlIndex !== -1) {
    const nextValue = rawArgs[urlIndex + 1];
    if (typeof nextValue === 'string' && !nextValue.startsWith('-')) {
      resolvedUrl = nextValue;
    }
  } else {
    urlIndex = findIndex((entry) => typeof entry === 'string' && entry.toLowerCase().startsWith('--url='));
    if (urlIndex !== -1) {
      resolvedUrl = rawArgs[urlIndex].slice(6);
    }
  }

  if (!resolvedUrl) {
    const httpIndex = findIndex((entry) => typeof entry === 'string' && /^https?:\/\//i.test(entry));
    if (httpIndex !== -1) {
      const collected = [rawArgs[httpIndex]];
      for (let i = httpIndex + 1; i < rawArgs.length; i++) {
        const value = rawArgs[i];
        if (typeof value !== 'string' || value.startsWith('-')) {
          break;
        }
        collected.push(value);
      }
      resolvedUrl = collected.join(' ');
    }
  }

  if (resolvedUrl && typeof resolvedUrl === 'string') {
    const sanitizedUrl = sanitizeCliToken(resolvedUrl);
    if (sanitizedUrl.length) {
      args.url = sanitizedUrl;
      args.u = sanitizedUrl;
      if (Array.isArray(args._)) {
        if (!args._.includes(sanitizedUrl)) {
          args._.unshift(sanitizedUrl);
        }
      } else {
        args._ = [sanitizedUrl];
      }
    }
  }

  const coerceBoolean = (value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        if (value === 0) {
          return false;
        }
        if (value === 1) {
          return true;
        }
      }
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.length) {
        return undefined;
      }
      if (/^(false|0|no|off|disable|disabled)$/i.test(trimmed)) {
        return false;
      }
      if (/^(true|1|yes|on|enable|enabled)$/i.test(trimmed)) {
        return true;
      }
    }
    return undefined;
  };

  let nodeExplicit = false;

  const applyNodeValue = (value) => {
    if (typeof value === 'boolean') {
      args.node = value;
      args.n = value;
      nodeExplicit = true;
    }
  };

  const tryApplyBoolean = (candidate) => {
    const coerced = coerceBoolean(candidate);
    if (typeof coerced === 'boolean') {
      applyNodeValue(coerced);
      return true;
    }
    return false;
  };

  const normalizeToken = (token) => (typeof token === 'string' ? token.trim() : '');

  if (typeof args.node === 'boolean') {
    args.n = args.node;
  } else if (typeof args.n === 'boolean') {
    args.node = args.n;
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const token = normalizeToken(rawArgs[i]);
    if (!token) {
      continue;
    }

    const lower = token.toLowerCase();

    if (lower === '--no-node' || lower === '--disable-node') {
      applyNodeValue(false);
      continue;
    }

    if (token === '--node' || token === '-n') {
      const nextValue = rawArgs[i + 1];
      if (!tryApplyBoolean(nextValue)) {
        applyNodeValue(true);
      } else {
        i += 1;
      }
      continue;
    }

    if (lower.startsWith('--node=')) {
      const value = token.slice('--node='.length);
      if (!tryApplyBoolean(value)) {
        applyNodeValue(true);
      }
      continue;
    }

    if (lower.startsWith('-n=')) {
      const value = token.slice(3);
      if (!tryApplyBoolean(value)) {
        applyNodeValue(true);
      }
      continue;
    }
  }

  if (!nodeExplicit && typeof args.url === 'string') {
    try {
      const parsedUrl = new URL(args.url);
      const nodeParamKeys = ['node', 'nodeintegration', 'nodeIntegration', 'enableNode'];
      for (const key of nodeParamKeys) {
        if (!parsedUrl.searchParams.has(key)) {
          continue;
        }
        const rawValue = parsedUrl.searchParams.get(key);
        if (rawValue === null || rawValue === '') {
          applyNodeValue(true);
        } else if (!tryApplyBoolean(rawValue)) {
          const lowered = rawValue.trim().toLowerCase();
          if (lowered && /^(disable|disabled|off|no)$/i.test(lowered)) {
            applyNodeValue(false);
          } else if (lowered && /^(auto)$/i.test(lowered)) {
            // leave for heuristic step
          } else {
            applyNodeValue(true);
          }
        }
        break;
      }
    } catch (_error) {
      // ignore malformed URLs
    }
  }

  if (!nodeExplicit) {
    let preferNodeIntegration = false;
    if (typeof args.url === 'string') {
      const loweredUrl = args.url.toLowerCase();
      if (loweredUrl.includes('screenshare') || loweredUrl.includes('appaudio')) {
        preferNodeIntegration = true;
      }
    }
    if (preferNodeIntegration) {
      applyNodeValue(true);
    }
  }

  if (typeof args.node !== 'boolean') {
    args.node = false;
  }
  if (typeof args.n !== 'boolean') {
    args.n = args.node;
  }

  args.__nodeExplicit = nodeExplicit;

  return args;
}

var Argv = hydrateArgsFromRawProcessArgs(createYargs());
;

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

const enableFeatureSet = new Set();
const disableFeatureSet = new Set();

if (!(Argv.mf)){
	enableFeatureSet.add('MediaFoundationVideoCapture');
	//app.commandLine.appendSwitch('force-directshow')
	//console.log("Media Foundations video cap ENABLED");
	// --force-directshow
}
if (!(Argv.dmf)){
	disableFeatureSet.add('MediaFoundationVideoCapture');
	//app.commandLine.appendSwitch('force-directshow')
	//console.log("Media Foundations video cap ENABLED");
	// --force-directshow
}

if (process.platform === 'win32') {
	const wgcValue = typeof Argv.usewgc !== 'undefined' ? Argv.usewgc : Argv.wgc;
	const wgcOptionProvided = typeof wgcValue !== 'undefined';
	const preferWgc = wgcValue === true;
	const disableWgcViaCli = wgcOptionProvided && wgcValue === false;
	let elevatedForCapture = false;
	if (!disableWgcViaCli && !preferWgc) {
		try {
			elevatedForCapture = isProcessElevated();
		} catch (error) {
			console.warn('Unable to determine elevation state; assuming not elevated for WGC decisions.', error);
		}
	}
	if (disableWgcViaCli || (!preferWgc && elevatedForCapture)) {
		disableFeatureSet.add('WinUseBrowserMediaSource');
		if (!disableWgcViaCli && elevatedForCapture) {
			console.log('Windows Graphics Capture disabled automatically for elevated session. Launch with --usewgc to override.');
		}
	}
}

if (enableFeatureSet.size > 0) {
	app.commandLine.appendSwitch('enable-features', Array.from(enableFeatureSet).join(','));
}

if (disableFeatureSet.size > 0) {
	app.commandLine.appendSwitch('disable-features', Array.from(disableFeatureSet).join(','));
	if (disableFeatureSet.has('WinUseBrowserMediaSource')) {
		console.log('Windows Graphics Capture disabled (override with --wgc to re-enable).');
	}
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

function normalizeAudioCaptureTarget(rawTarget) {
	if (rawTarget === null || rawTarget === undefined) {
		return null;
	}
	if (typeof rawTarget === 'number') {
		if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
			return null;
		}
		return {
			requestTarget: rawTarget,
			clientId: String(rawTarget)
		};
	}
	if (typeof rawTarget === 'string') {
		const trimmed = rawTarget.trim();
		if (!trimmed.length) {
			return null;
		}
		if (/^\d+$/.test(trimmed)) {
			const numericValue = Number(trimmed);
			if (!Number.isFinite(numericValue) || numericValue <= 0) {
				return null;
			}
			return {
				requestTarget: numericValue,
				clientId: trimmed
			};
		}
		return {
			requestTarget: trimmed,
			clientId: trimmed
		};
	}
	return null;
}

async function stopActiveWindowAudioCapture(reason = 'unknown', expectedWebContentsId = null) {
	if (!windowAudioCapture || typeof windowAudioCapture.stopStreamCapture !== 'function') {
		activeWindowAudioSession = null;
		return { success: false, error: 'window-audio-capture module unavailable' };
	}
	if (!activeWindowAudioSession) {
		return { success: true };
	}
	if (expectedWebContentsId !== null && activeWindowAudioSession.webContentsId !== expectedWebContentsId) {
		return { success: true };
	}

	const { webContents, destroyListener } = activeWindowAudioSession;

	if (webContents && !webContents.isDestroyed() && typeof destroyListener === 'function') {
		webContents.removeListener('destroyed', destroyListener);
	}

	activeWindowAudioSession = null;

	try {
		await windowAudioCapture.stopStreamCapture();
		return { success: true };
	} catch (error) {
		console.warn('Error stopping window audio capture (' + reason + '):', error);
		return { success: false, error: error.message || 'Failed to stop window audio capture' };
	}
}

function forwardWindowAudioData(webContents, clientId, baseSampleRate, baseChannels, payload) {
	if (!payload || !webContents || webContents.isDestroyed()) {
		return;
	}

	const data = payload && payload.data ? payload.data : payload;
	if (!data) {
		return;
	}

	let samples = data.samples;

	if (!(samples instanceof Float32Array)) {
		if (Array.isArray(samples) || (samples && typeof samples.length === 'number')) {
			try {
				samples = Float32Array.from(samples);
			} catch (err) {
				console.warn('Failed to convert audio samples to Float32Array:', err);
				samples = new Float32Array(0);
			}
		} else {
			samples = new Float32Array(0);
		}
	}

	const message = {
		clientId,
		data: {
			samples,
			sampleRate: data.sampleRate || baseSampleRate || 48000,
			channels: data.channels || baseChannels || 2
		}
	};

	try {
		webContents.send(WINDOW_AUDIO_EVENT_CHANNEL, message);
	} catch (error) {
		console.warn('Failed to forward window audio data to renderer:', error);
	}
}

ipcMain.handle('windowAudio:getTargets', async () => {
	if (!windowAudioCapture) {
		return { success: false, error: 'window-audio-capture module unavailable' };
	}
	try {
		const windows = typeof windowAudioCapture.getWindowList === 'function' ? await windowAudioCapture.getWindowList() : [];
		const sessions = typeof windowAudioCapture.getAudioSessions === 'function' ? await windowAudioCapture.getAudioSessions() : [];
		return { success: true, windows, sessions };
	} catch (error) {
		console.error('Error retrieving window audio targets:', error);
		return { success: false, error: error.message || 'Failed to retrieve audio targets' };
	}
});

ipcMain.handle('windowAudio:getSessions', async () => {
	if (!windowAudioCapture || typeof windowAudioCapture.getAudioSessions !== 'function') {
		return { success: false, error: 'window-audio-capture module unavailable' };
	}
	try {
		const sessions = await windowAudioCapture.getAudioSessions();
		return { success: true, sessions };
	} catch (error) {
		console.error('Error retrieving window audio sessions:', error);
		return { success: false, error: error.message || 'Failed to retrieve audio sessions' };
	}
});

ipcMain.handle('windowAudio:startStreamCapture', async (event, rawTarget) => {
	if (!windowAudioCapture || typeof windowAudioCapture.startStreamCapture !== 'function') {
		return { success: false, error: 'window-audio-capture module unavailable' };
	}

	const normalized = normalizeAudioCaptureTarget(rawTarget);
	if (!normalized) {
		return { success: false, error: 'Invalid window audio capture target' };
	}

	const webContents = event.sender;

	await stopActiveWindowAudioCapture('pre-start cleanup');

	const baseSampleRateFallback = 48000;
	const baseChannelFallback = 2;

	const forwarder = (payload) => {
		if (!activeWindowAudioSession || activeWindowAudioSession.webContentsId !== webContents.id) {
			return;
		}
		const sampleRate = activeWindowAudioSession.sampleRate || baseSampleRateFallback;
		const channels = activeWindowAudioSession.channels || baseChannelFallback;
		forwardWindowAudioData(webContents, normalized.clientId, sampleRate, channels, payload);
	};

	let startResult;
	try {
		startResult = await windowAudioCapture.startStreamCapture(normalized.requestTarget, forwarder);
	} catch (error) {
		console.error('Error starting window audio capture:', error);
		return { success: false, error: error.message || 'Failed to start window audio capture' };
	}

	if (!startResult || startResult.success === false) {
		return { success: false, error: startResult && startResult.error ? startResult.error : 'Failed to start window audio capture' };
	}

	const destroyListener = () => {
		stopActiveWindowAudioCapture('renderer destroyed', webContents.id).catch(err => {
			console.warn('Error stopping window audio capture after renderer destroyed:', err);
		});
	};

	if (!webContents.isDestroyed()) {
		webContents.once('destroyed', destroyListener);
	}

	activeWindowAudioSession = {
		webContents,
		webContentsId: webContents.id,
		clientId: normalized.clientId,
		destroyListener,
		sampleRate: startResult.sampleRate || baseSampleRateFallback,
		channels: startResult.channels || baseChannelFallback
	};

	return {
		success: true,
		sampleRate: activeWindowAudioSession.sampleRate,
		channels: activeWindowAudioSession.channels,
		usingProcessSpecificLoopback: !!(startResult && startResult.usingProcessSpecificLoopback)
	};
});

ipcMain.handle('windowAudio:stopStreamCapture', async (event) => {
	if (!windowAudioCapture || typeof windowAudioCapture.stopStreamCapture !== 'function') {
		return { success: false, error: 'window-audio-capture module unavailable' };
	}

	const result = await stopActiveWindowAudioCapture('renderer request', event && event.sender ? event.sender.id : null);
	if (!result.success && result.error) {
		return result;
	}

	return { success: true };
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


async function createWindow(args, reuse=false) {
  var webSecurity = true;
  
  // Check if args are valid
  if (!args || typeof args !== 'object') {
    console.error('Invalid args passed to createWindow:', args);
    args = createYargs(); // Use default args if invalid
  }
  
  var URL = args.url, NODE = args.node, WIDTH = args.width, HEIGHT = args.height, TITLE = args.title, PIN = args.pin, X = args.x, Y = args.y, FULLSCREEN = args.fullscreen, UNCLICKABLE = args.uc, MINIMIZED = args.min, CSS = args.css, BGCOLOR = args.chroma, JS = args.js;


  let nodeExplicitFlag = args.__nodeExplicit === true;

  const assignNodeIntegration = (value, markExplicit = true) => {
    if (typeof value !== 'boolean') {
      return;
    }
    NODE = value;
    args.node = value;
    args.n = value;
    if (markExplicit) {
      nodeExplicitFlag = true;
    }
  };

  if (typeof NODE !== 'boolean') {
    assignNodeIntegration(false, false);
  }

  if (typeof URL === 'string') {
    URL = formatURL(URL.trim());
  } else if (URL != null) {
    try {
      URL = formatURL(String(URL));
    } catch (conversionError) {
      console.warn('Unable to normalize URL value from args:', conversionError);
    }
  }

  args.url = URL;


  if (!nodeExplicitFlag && typeof URL === 'string') {
    let preferenceResolved = false;
    try {
      const parsedUrl = new URL(URL);
      const nodeParamKeys = ['node', 'nodeintegration', 'nodeIntegration', 'enableNode'];
      for (const key of nodeParamKeys) {
        if (!parsedUrl.searchParams.has(key)) {
          continue;
        }
        const rawValue = parsedUrl.searchParams.get(key);
        if (rawValue === null || rawValue === '') {
          assignNodeIntegration(true);
          preferenceResolved = true;
        } else {
          const normalized = rawValue.trim().toLowerCase();
          if (/^(disable|disabled|off|no|false|0)$/i.test(normalized)) {
            assignNodeIntegration(false);
            preferenceResolved = true;
          } else if (/^(enable|enabled|on|yes|true|1)$/i.test(normalized)) {
            assignNodeIntegration(true);
            preferenceResolved = true;
          } else if (/^(auto)$/i.test(normalized)) {
            // leave for heuristic fallback
          } else {
            assignNodeIntegration(true);
            preferenceResolved = true;
          }
        }
        break;
      }
    } catch (error) {
      // ignore malformed URLs
    }

    if (!preferenceResolved) {
      const loweredUrl = URL.toLowerCase();
      if (loweredUrl.includes('screenshare') || loweredUrl.includes('appaudio')) {
        assignNodeIntegration(true);
        preferenceResolved = true;
      }
    }

    if (preferenceResolved) {
      nodeExplicitFlag = true;
    }
  }

  args.__nodeExplicit = nodeExplicitFlag;

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
		mainWindow.node = NODE;

		if ((X!=-1) || (Y!=-1)) {
			if (X==-1){X=0;}
			if (Y==-1){Y=0;}
			mainWindow.setPosition(Math.floor(X/factor), Math.floor(Y/factor))
		}
	} catch(e){console.error(e);}
	
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
		e.preventDefault();
		mainWindow.hide(); // hide, and wait 2 second before really closing; this allows for saving of files.
		if (!global.closing){ // doesn't wait if we have issued a global app-wide closedown. speeds things up.
			setTimeout(()=>{
				if (!global.closing){
					mainWindow.webContents.send('postMessage', {'hangup':true}); // allows us to disable the director; useful for speed and preventing camera blinking/flickering after the window closes.
					setTimeout(()=>{  // we wait for the camera to be disabled before closing; this is to aviod blinking and for file saving.
						if (!global.closing){
							try{
								mainWindow.destroy(); 
							} catch(e){}
						}
					}, 2000);
				}
			}, 0);
		}
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
			label: '✖️ Open New Window',
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
			label: '⚠️ Elevate Privilege',
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
			label: '✏️ Edit URL', 
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
				label: '✏️ Edit IFrame URL',
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
			label: '✏️ Edit Window Title',
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
			label: '↔️ Resize window',
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
			label: '🚫🖱️ Make UnClickable until in-focus or CTRL+SHIFT+ALT+X',
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













