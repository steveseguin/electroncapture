const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector)
    if (element) element.innerText = text
  }

  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type])
  }
})

window.addEventListener('message', ({ data }) => {
	console.log("MessageIncoming:15:"+data);
    ipcRenderer.send('postMessage', data)
})

var PPTTimeout = null;
ipcRenderer.on('postMessage', (event, ...args) => {
	try {
		if ("mic" in args[0]) { // this should work for the director's mic mute button as well. Needs to be manually enabled the first time still tho.
			if (args[0].mic === true) { // unmute
				session.muted = false; // set
				toggleMute(true); // apply 
			} else if (args[0].mic === false) { // mute
				session.muted = true; // set
				toggleMute(true); // apply
			} else if (args[0].mic === "toggle") { // toggle
				toggleMute();
			}
			return;
		}
		
		if (args[0].PPT){
			if (PPTTimeout){
				clearTimeout(PPTTimeout);
				PPTTimeout = setTimeout(function(){
					PPTTimeout=null;
					session.muted = true;
					toggleMute(true);
					getById("mutebutton").classList.remove("PPTActive");
				},200);
			} else {
				session.muted = false;
				toggleMute(true);
				getById("mutebutton").classList.add("PPTActive");
				PPTTimeout = setTimeout(function(){
					PPTTimeout=null;
					session.muted = true;
					toggleMute(true);
					getById("mutebutton").classList.remove("PPTActive");
				},600);
			}
			return;
		}
		
		if ("getDeviceList" in args[0]) {
			if (typeof enumerateDevices === "function"){
				enumerateDevices().then(function(deviceInfos) {
					deviceInfos = JSON.parse(JSON.stringify(deviceInfos));
					ipcRenderer.send('deviceList', deviceInfos);
				})
			} else {
				console.log("calling requestOutputAudioStream");
				requestOutputAudioStream().then(function(deviceInfos) {
					
					deviceInfos = JSON.parse(JSON.stringify(deviceInfos));
					
					var output = [];
					for (var i=0;i<deviceInfos.length;i++){
						if (deviceInfos[i].kind === "audiooutput"){
							output.push(deviceInfos[i]);
						}
					}
					
					console.log("Should only be audio output");
					console.log(output);
					ipcRenderer.send('deviceList', output);
				})
			}
		}
		
		
		if ("changeVideoDevice" in args[0]) {
			changeVideoDeviceById(args[0].changeVideoDevice);
		}
		
		if ("changeAudioDevice" in args[0]) {
			changeAudioDeviceById(args[0].changeAudioDevice);
		}
		
		if ("changeAudioOutputDevice" in args[0]) {
			if (typeof changeAudioOutputDeviceById === "function"){
				changeAudioOutputDeviceById(args[0].changeAudioOutputDevice);
			} else {
				changeAudioOutputDeviceByIdThirdParty(args[0].changeAudioOutputDevice);
			}
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
			setSink(ele,deviceID);
		} catch(e){}
	});
	document.querySelectorAll("audio, video").forEach(ele=>{
		try {
			setSink(ele,deviceID);
		} catch(e){}
	});
	document.querySelectorAll('iframe').forEach( item =>{
		try{
			item.contentWindow.document.body.querySelectorAll("audio, video").forEach(ele=>{
				try {
					setSink(ele,deviceID);
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