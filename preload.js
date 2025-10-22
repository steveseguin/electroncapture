// preload.js
const { ipcRenderer, contextBridge } = require('electron');
const path = require('path');

let WindowAudioStream = null;
try {
  WindowAudioStream = require(path.join(__dirname, 'window-audio-stream.js'));
  if (WindowAudioStream && typeof WindowAudioStream !== 'function' && WindowAudioStream.default) {
    WindowAudioStream = WindowAudioStream.default;
  }
} catch (error) {
  console.error('Failed to load WindowAudioStream module:', error);
}

const WINDOW_AUDIO_EVENT_CHANNEL = 'windowAudioStreamData';
const APP_AUDIO_PARAM_NAMES = ['appaudio', 'appAudio', 'appAudioTarget'];

let appAudioTarget = null;
let windowAudioStreamInstance = null;
let displayMediaHookInstalled = false;

function sanitizeAppAudioTarget(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return String(Math.floor(value));
  }
  if (typeof value === 'bigint') {
    if (value <= 0n) {
      return null;
    }
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    if (['0', 'none', 'false', 'off', 'null'].includes(lower)) {
      return null;
    }
    return trimmed;
  }
  return null;
}

function extractAppAudioTargetFromUrl() {
  try {
    const currentUrl = new URL(window.location.href);
    for (const key of APP_AUDIO_PARAM_NAMES) {
      const value = currentUrl.searchParams.get(key);
      if (value) {
        return value;
      }
    }
  } catch (error) {
    console.warn('Unable to parse app audio target from URL:', error);
  }
  return null;
}

function ensureWindowAudioStreamInstance() {
  if (!WindowAudioStream) {
    return null;
  }
  if (!windowAudioStreamInstance) {
    windowAudioStreamInstance = new WindowAudioStream();
  }
  return windowAudioStreamInstance;
}

function updateAppAudioTarget(value) {
  const sanitized = sanitizeAppAudioTarget(value);
  if (sanitized === appAudioTarget) {
    return appAudioTarget;
  }

  appAudioTarget = sanitized;

  if (windowAudioStreamInstance && windowAudioStreamInstance.isCapturing()) {
    windowAudioStreamInstance.stop().catch((error) => {
      console.warn('Failed to stop window audio stream after retargeting:', error);
    });
  }

  return appAudioTarget;
}

async function attachApplicationAudio(stream) {
  if (!appAudioTarget) {
    return;
  }

  const instance = ensureWindowAudioStreamInstance();
  if (!instance) {
    console.warn('WindowAudioStream unavailable; skipping application audio attachment.');
    return;
  }

  try {
    const audioStream = await instance.start(appAudioTarget);
    if (!audioStream) {
      console.warn('WindowAudioStream returned no audio stream for target:', appAudioTarget);
      return;
    }

    const clonedTracks = [];
    audioStream.getAudioTracks().forEach((track) => {
      const clone = track.clone();
      clonedTracks.push(clone);
      stream.addTrack(clone);
    });

    const cleanup = async () => {
      clonedTracks.forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn('Error stopping cloned audio track:', error);
        }
      });
      if (instance.isCapturing()) {
        try {
          await instance.stop();
        } catch (error) {
          console.warn('Failed to stop WindowAudioStream during cleanup:', error);
        }
      }
    };

    const onceCleanup = () => {
      cleanup().catch((error) => console.error('Error cleaning up application audio tracks:', error));
    };

    if (typeof stream.addEventListener === 'function') {
      stream.addEventListener('inactive', onceCleanup, { once: true });
    }
    stream.getVideoTracks().forEach((track) => track.addEventListener('ended', onceCleanup, { once: true }));
    clonedTracks.forEach((track) => track.addEventListener('ended', onceCleanup, { once: true }));
  } catch (error) {
    console.error('Failed to attach application audio to display stream:', error);
  }
}

function installDisplayMediaHook() {
  if (displayMediaHookInstalled) {
    return;
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    return;
  }

  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getDisplayMedia = async (...args) => {
    const stream = await originalGetDisplayMedia(...args);
    if (appAudioTarget) {
      await attachApplicationAudio(stream);
    }
    return stream;
  };

  displayMediaHookInstalled = true;
}

appAudioTarget = sanitizeAppAudioTarget(extractAppAudioTargetFromUrl());
if (appAudioTarget) {
  console.log('WindowAudioStream: App audio target configured as', appAudioTarget);
}
installDisplayMediaHook();

window.addEventListener('beforeunload', () => {
  if (windowAudioStreamInstance && windowAudioStreamInstance.isCapturing()) {
    windowAudioStreamInstance.stop().catch((error) => {
      console.warn('Error stopping WindowAudioStream on unload:', error);
    });
  }
});

window.addEventListener('DOMContentLoaded', () => {
  installDisplayMediaHook();
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };
  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type]);
  }
  try {
    if (session && session.version) {
      ipcRenderer.send('vdonVersion', { ver: session.version });
    }
  } catch (e) {}
});

let doSomethingInWebApp = null;

function createElectronApi() {
  return {
    'exposeDoSomethingInWebApp': function(callback) {
      doSomethingInWebApp = callback;
    },
    'updateVersion': function(version) {
      console.log("33:" + version);
      ipcRenderer.send('vdonVersion', { ver: version });
    },
    'updatePPT': function(PPTHotkey) {
      console.log("updatePPT received!!!");
      ipcRenderer.send('PPTHotkey', PPTHotkey);
    },
    'noCORSFetch': (args) => ipcRenderer.invoke('noCORSFetch', args),
    'readStreamChunk': (streamId) => ipcRenderer.invoke('readStreamChunk', streamId),
    'closeStream': (streamId) => ipcRenderer.invoke('closeStream', streamId),
    'startStreamCapture': (target) => ipcRenderer.invoke('windowAudio:startStreamCapture', target),
    'stopStreamCapture': (target) => ipcRenderer.invoke('windowAudio:stopStreamCapture', target),
    'getWindowAudioTargets': () => ipcRenderer.invoke('windowAudio:getTargets'),
    'getWindowAudioSessions': () => ipcRenderer.invoke('windowAudio:getSessions'),
    'onAudioStreamData': (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }
      const handler = (_event, payload) => {
        try {
          callback(payload);
        } catch (err) {
          console.error('Error in onAudioStreamData handler:', err);
        }
      };
      ipcRenderer.on(WINDOW_AUDIO_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(WINDOW_AUDIO_EVENT_CHANNEL, handler);
    },
    'setAppAudioTarget': (target) => {
      const updated = updateAppAudioTarget(target);
      installDisplayMediaHook();
      return { success: true, target: updated };
    },
    'getAppAudioTarget': () => appAudioTarget,
    'isWindowAudioCaptureAvailable': () => Boolean(WindowAudioStream)
  };
}

const electronApi = createElectronApi();

(function registerElectronApi() {
  const canUseContextBridge = Boolean(process && process.contextIsolated && contextBridge && typeof contextBridge.exposeInMainWorld === 'function');
  let exposedViaContextBridge = false;

  if (canUseContextBridge) {
    try {
      contextBridge.exposeInMainWorld('electronApi', electronApi);
      if (WindowAudioStream) {
        contextBridge.exposeInMainWorld('WindowAudioStream', WindowAudioStream);
      }
      exposedViaContextBridge = true;
    } catch (error) {
      console.error('Failed to expose APIs via contextBridge:', error);
    }
  }

  if (!exposedViaContextBridge) {
    try {
      window.electronApi = electronApi;
      if (WindowAudioStream) {
        window.WindowAudioStream = WindowAudioStream;
      }
    } catch (error) {
      console.error('Failed to attach APIs to window:', error);
    }
  } else if (WindowAudioStream) {
    // Provide a mirror on window as well for compatibility when contextIsolation is enabled.
    try {
      window.WindowAudioStream = WindowAudioStream;
    } catch (error) {
      // Ignore - window may not be writable in some sandboxed contexts.
    }
  }
})();

window.addEventListener('message', ({ data }) => {
	console.log("preload.js-Message-Incoming: "+data);
    ipcRenderer.send('postMessage', data)
});


try {
	if ((typeof session !== 'undefined') && session.version){
		ipcRenderer.send('vdonVersion', {ver:session.version}); // clear the current Version; let it load if needed.
	} else {
		ipcRenderer.send('vdonVersion', {ver:false}); // clear the current Version; let it load if needed.
	}
} catch(e){
	console.log(e);
}


var storedEle = null;
var PPTTimeout = null;
ipcRenderer.on('postMessage', (event, ...args) => {
	console.log(args);
	
	try {
		if (!doSomethingInWebApp){
			if (session && session.remoteInterfaceAPI){
				doSomethingInWebApp = session.remoteInterfaceAPI;
			}
		}
	}catch(e){}
	
	try {
		if ("record" in args[0]) {
			if (doSomethingInWebApp) {
			  console.log("doSomethingInWebApp");
			  var x = args[0].params.x;
			  var y = args[0].params.y;
			  var ele = document.elementFromPoint(x,y);
			  
			  if (ele.id){
				  var fauxEvent = {};
			      fauxEvent.data = {};
			      fauxEvent.data.record = ele.id;;
				  doSomethingInWebApp(fauxEvent);
			  }
			} else {
				console.log(doSomethingInWebApp);
				console.log(session.remoteInterfaceAPI);
				console.log("no doSomethingInWebApp");
			}
		}
		
		if ("hangup" in args[0]) {
			if (args[0].hangup == "estop"){
				if (doSomethingInWebApp) {
					console.log("HANG UP ESTOP1 ");
					var fauxEvent = {};
					fauxEvent.data = {};
					fauxEvent.data.hangup = "estop";
					doSomethingInWebApp(fauxEvent);
				} else {
					console.log("HANG UP ESTOP1 2");
					session.hangup(false, true); // no reload, estop=true
					console.log(session.remoteInterfaceAPI);
					console.log("no doSomethingInWebApp");
				}
			} else {
				if (doSomethingInWebApp) {
					console.log("HANG UP 1");
					var fauxEvent = {};
					fauxEvent.data = {};
					fauxEvent.data.close = true; // close and hangup are the same; close is compatible with older vdon versions tho. no estop tho.
					doSomethingInWebApp(fauxEvent);
				} else {
					console.log("HANG UP 2");
					session.hangup();
					console.log(session.remoteInterfaceAPI);
					console.log("no doSomethingInWebApp");
				}
			}
		}
		
		if (doSomethingInWebApp && ("mic" in args[0])){ // this is the new version.
			var fauxEvent = {};
			fauxEvent.data = {};
			fauxEvent.data.mic = args[0].mic 
			doSomethingInWebApp(fauxEvent);
			return;
		} else if ("micOld" in args[0]) { // this is for old pre v22 version
			if (session && (args[0].micOld === true)){ // unmute
				session.muted = false; // set
				toggleMute(true); // apply 
			} else if (session && (args[0].micOld === false)){ // mute
				session.muted = true; // set
				toggleMute(true); // apply
			} else if (args[0].micOld === "toggle") { // toggle
				toggleMute();
			}
			return;
		}
		
		if ("PPT" in args[0]){
			console.log(args[0].PPT);
			if (PPTTimeout){
				clearTimeout(PPTTimeout);
				PPTTimeout = setTimeout(function(node){
					PPTTimeout=null;
					if (node){
						session.muted = true;
						toggleMute(true);
						getById("mutebutton").classList.remove("PPTActive");
					} else if (doSomethingInWebApp){
						var fauxEvent = {};
						fauxEvent.data = {};
						fauxEvent.data.PPT = false;
						doSomethingInWebApp(fauxEvent);
					}
				},200, args[0].node);
			} else {
				if (args[0].node){
					session.muted = false;
					toggleMute(true);
					getById("mutebutton").classList.add("PPTActive");
				} else if (doSomethingInWebApp){
					var fauxEvent = {};
					fauxEvent.data = {};
					fauxEvent.data.PPT = true;
					doSomethingInWebApp(fauxEvent);
				}
				PPTTimeout = setTimeout(function(node){
					PPTTimeout=null;
					if (node){
						session.muted = true;
						toggleMute(true);
						getById("mutebutton").classList.remove("PPTActive");
					} else if (doSomethingInWebApp){
						var fauxEvent = {};
						fauxEvent.data = {};
						fauxEvent.data.PPT = false;
						doSomethingInWebApp(fauxEvent);
					}
				},600, args[0].node);
			}
			return;
		}
		
		if ("getDeviceList" in args[0]) {
			
			var x = args[0].params.x;
			var y = args[0].params.y;
			var ele = document.elementFromPoint(x,y);
			storedEle = ele;
			var menu = ele.dataset.menu;
			
			var response = {};
			response.menu = menu || false;
			response.eleId = ele.id || false;
			response.UUID = ele.dataset.UUID || false;
			response.params = args[0].params;
  
			if (typeof enumerateDevices === "function"){
				enumerateDevices().then(function(deviceInfos) {
					response.deviceInfos = deviceInfos;
					response = JSON.parse(JSON.stringify(response));
					ipcRenderer.send('deviceList', response);
				})
			} else {
				console.log("calling requestOutputAudioStream");
				requestOutputAudioStream().then(function(deviceInfos) {
					
					response.deviceInfos = deviceInfos;
					response = JSON.parse(JSON.stringify(response));
					ipcRenderer.send('deviceList', response);
					
					//deviceInfos = JSON.parse(JSON.stringify(deviceInfos));
					
					/* var output = [];
					for (var i=0;i<deviceInfos.length;i++){
						if (deviceInfos[i].kind === "audiooutput"){
							output.push(deviceInfos[i]);
						}
					} */
					
					console.log("Should only be audio output");
					//console.log(output);
					//ipcRenderer.send('deviceList', deviceInfos);
				})
			}
		}
		
		
		if ("changeVideoDevice" in args[0]) {
			changeVideoDeviceById(args[0].changeVideoDevice);
		}
		
		if ("nativeList" in args[0]){
			//console.log("nativeList got");
			event.returnValue = true;
		}
		
		if ("changeAudioDevice" in args[0]) {
			changeAudioDeviceById(args[0].changeAudioDevice);
		}
		
		if ("changeAudioOutputDevice" in args[0]) {
			//args[0].data.menu = menu || false;
			//args[0].data.eleId = ele.id || false;
			//args[0].data.UUID = ele.dataset.UUID || false;
			//args[0].deviceInfos;
			//args[0].data.params = params;
			if ("data" in args[0]){
				setSink(storedEle, args[0].changeAudioOutputDevice);
				storedEle.manualSink = args[0].changeAudioOutputDevice;
				//storedEle.manualSink = args[0].changeAudioOutputDevice;
			} else if (typeof changeAudioOutputDeviceById === "function"){
				changeAudioOutputDeviceById(args[0].changeAudioOutputDevice);
			} else {
				changeAudioOutputDeviceByIdThirdParty(args[0].changeAudioOutputDevice);
			}
			storedEle = null;
		} 
	} catch(e){
		console.error(e);
	}
})


function setSink(ele, id){
	ele.setSinkId(id).then(() => {
		console.log("New Output Device:" + id);
	}).catch(error => {
		console.error(error);
	});
}

function changeAudioOutputDeviceByIdThirdParty(deviceID){
	console.log("Output deviceID: "+deviceID);
	
	document.querySelectorAll("audio, video").forEach(ele=>{
		try {
			if (ele.manualSink){
				setSink(ele,ele.manualSink);
			} else {
				setSink(ele,deviceID);
			}
		} catch(e){}
	});
	document.querySelectorAll('iframe').forEach( item =>{
		try{
			item.contentWindow.document.body.querySelectorAll("audio, video").forEach(ele=>{
				try {
					if (ele.manualSink){
						setSink(ele,ele.manualSink);
					} else {
						setSink(ele,deviceID);
					}
				} catch(e){}
			});
		} catch(e){}
	});	
	
}

function enumerateDevicesThirdParty() {
	if (typeof navigator.enumerateDevices === "function") {
		return navigator.enumerateDevices();
	} else if (typeof navigator.mediaDevices === "object" && typeof navigator.mediaDevices.enumerateDevices === "function") {
		return navigator.mediaDevices.enumerateDevices();
	} else {
		return new Promise((resolve, reject) => {
			try {
				if (window.MediaStreamTrack == null || window.MediaStreamTrack.getSources == null) {
					throw new Error();
				}
				window.MediaStreamTrack.getSources((devices) => {
					resolve(devices
						.filter(device => {
							return device.kind.toLowerCase() === "video" || device.kind.toLowerCase() === "videoinput";
						})
						.map(device => {
							return {
								deviceId: device.deviceId != null ? device.deviceId : ""
								, groupId: device.groupId
								, kind: "videoinput"
								, label: device.label
								, toJSON: /*  */ function() {
									return this;
								}
							};
						}));
				});
			} catch (e) {}
		});
	}
}

function requestOutputAudioStream() {
	console.log("requestOutputAudioStream");
	return navigator.mediaDevices.getUserMedia({audio: true, video: false}).then(function(stream) { // Apple needs thi to happen before I can access EnumerateDevices. 
		return enumerateDevicesThirdParty().then(function(deviceInfos) {
			console.log("enumerateDevicesThirdParty");
			stream.getTracks().forEach(function(track) { // We don't want to keep it without audio; so we are going to try to add audio now.
				track.stop(); // I need to do this after the enumeration step, else it breaks firefox's labels
			});
			console.log(deviceInfos);
			return deviceInfos;
		});
	});
}





