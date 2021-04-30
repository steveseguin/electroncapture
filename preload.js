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
	}catch(e){
		console.error(e);
	}
})
