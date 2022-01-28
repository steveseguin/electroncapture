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
    ipcRenderer.send('postMessage', data)
})

ipcRenderer.on('postMessage', (event, ...args) => {
	try{
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
		}
		
		if ("getDeviceList" in args[0]) {
			return enumerateDevices().then(function(deviceInfos) {
				deviceInfos = JSON.parse(JSON.stringify(deviceInfos));
				return ipcRenderer.send('deviceList', deviceInfos);
			}).catch(console.error);;
		}
		
		if ("changeVideoDevice" in args[0]) {
			changeVideoDeviceById(args[0].changeVideoDevice);
		}
		
		if ("changeAudioDevice" in args[0]) {
			changeAudioDeviceById(args[0].changeAudioDevice);
		}
		
		if ("changeAudioOutputDevice" in args[0]) {
			changeAudioOutputDeviceById(args[0].changeAudioOutputDevice);
		}
		
	}catch(e){
		console.error(e);
	}
})
