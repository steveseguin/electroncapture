// Fix for VDO.Ninja's Electron initialization
console.log('VDO.Ninja Electron Fix: Initializing...');

// Wait for VDO.Ninja to load, then fix the initialization
function fixVDONinjaElectron() {
    // Check if we're in Electron
    if (navigator.userAgent.toLowerCase().indexOf(" electron/") === -1) {
        console.log('Not in Electron, skipping fix');
        return;
    }
    
    // Check if VDO.Ninja failed to initialize Electron support
    if (window.ElectronDesktopCapture === false || !navigator.mediaDevices.getDisplayMedia.toString().includes('ipcRenderer')) {
        console.log('VDO.Ninja Electron initialization failed, applying fix...');
        
        // Ensure ipcRenderer is available
        if (!window.ipcRenderer && window.require) {
            try {
                window.ipcRenderer = window.require('electron').ipcRenderer;
                console.log('ipcRenderer loaded');
            } catch (e) {
                console.error('Failed to load ipcRenderer:', e);
                return;
            }
        }
        
        // Initialize WindowAudioStream if needed
        if (!window.windowAudioCapture && window.WindowAudioStream) {
            try {
                window.windowAudioCapture = new window.WindowAudioStream();
                console.log('WindowAudioStream initialized');
            } catch (e) {
                console.warn('Failed to initialize WindowAudioStream:', e);
                // Continue anyway - screen sharing should still work
            }
        }
        
        // Apply the getDisplayMedia override from VDO.Ninja
        const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
        navigator.mediaDevices.getDisplayMedia = function(constraints = false) {
            console.log('Custom getDisplayMedia called');
            
            return new Promise(async (resolve, reject) => {
                try {
                    // For now, just show a simple source picker
                    const sources = await window.ipcRenderer.sendSync("getSources", { types: ["screen", "window"] });
                    console.log('Got sources:', sources.length);
                    
                    // Create a simple selection UI
                    const selectionElem = document.createElement("div");
                    selectionElem.style.cssText = `
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: rgba(0,0,0,0.8);
                        z-index: 99999;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    `;
                    
                    const innerDiv = document.createElement("div");
                    innerDiv.style.cssText = `
                        background: white;
                        padding: 20px;
                        border-radius: 10px;
                        max-width: 90%;
                        max-height: 90%;
                        overflow: auto;
                    `;
                    
                    innerDiv.innerHTML = `
                        <h2>Select a window or screen to share</h2>
                        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin: 20px 0;">
                            ${sources.map(source => `
                                <button class="source-select" data-id="${source.id}" style="
                                    border: 1px solid #ccc;
                                    padding: 10px;
                                    cursor: pointer;
                                    background: white;
                                    text-align: center;
                                ">
                                    <img src="${source.thumbnail.toDataURL()}" style="width: 100%; height: auto; margin-bottom: 5px;">
                                    <div>${source.name}</div>
                                </button>
                            `).join('')}
                        </div>
                        <button id="cancel-screenshare" style="
                            padding: 10px 20px;
                            background: #f44336;
                            color: white;
                            border: none;
                            border-radius: 5px;
                            cursor: pointer;
                        ">Cancel</button>
                    `;
                    
                    selectionElem.appendChild(innerDiv);
                    document.body.appendChild(selectionElem);
                    
                    // Handle source selection
                    innerDiv.querySelectorAll('.source-select').forEach(button => {
                        button.addEventListener('click', async () => {
                            const sourceId = button.getAttribute('data-id');
                            console.log('Selected source:', sourceId);
                            
                            // Remove the UI
                            selectionElem.remove();
                            
                            // Get the stream
                            try {
                                const streamConstraints = {
                                    audio: false,
                                    video: {
                                        mandatory: {
                                            chromeMediaSource: "desktop",
                                            chromeMediaSourceId: sourceId
                                        }
                                    }
                                };
                                
                                // Apply constraints from the original request
                                if (constraints && constraints.video) {
                                    if (constraints.video.width?.ideal) {
                                        streamConstraints.video.mandatory.maxWidth = constraints.video.width.ideal;
                                    }
                                    if (constraints.video.height?.ideal) {
                                        streamConstraints.video.mandatory.maxHeight = constraints.video.height.ideal;
                                    }
                                    if (constraints.video.frameRate?.ideal) {
                                        streamConstraints.video.mandatory.maxFrameRate = constraints.video.frameRate.ideal;
                                    }
                                }
                                
                                // Add system audio if requested
                                if (constraints && constraints.audio !== false) {
                                    try {
                                        // Get system audio
                                        const audioConstraints = {
                                            audio: {
                                                mandatory: {
                                                    chromeMediaSource: "desktop"
                                                }
                                            },
                                            video: false
                                        };
                                        
                                        const audioStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
                                        const videoStream = await navigator.mediaDevices.getUserMedia(streamConstraints);
                                        
                                        // Combine streams
                                        if (audioStream.getAudioTracks().length > 0) {
                                            videoStream.addTrack(audioStream.getAudioTracks()[0]);
                                        }
                                        
                                        resolve(videoStream);
                                    } catch (audioErr) {
                                        console.warn('Failed to get system audio, continuing with video only:', audioErr);
                                        const stream = await navigator.mediaDevices.getUserMedia(streamConstraints);
                                        resolve(stream);
                                    }
                                } else {
                                    const stream = await navigator.mediaDevices.getUserMedia(streamConstraints);
                                    resolve(stream);
                                }
                            } catch (err) {
                                console.error('Failed to get stream:', err);
                                reject(err);
                            }
                        });
                    });
                    
                    // Handle cancel
                    innerDiv.querySelector('#cancel-screenshare').addEventListener('click', () => {
                        selectionElem.remove();
                        reject(new Error('User cancelled'));
                    });
                    
                } catch (err) {
                    console.error('Error in custom getDisplayMedia:', err);
                    reject(err);
                }
            });
        };
        
        // Set the flag
        window.ElectronDesktopCapture = true;
        console.log('VDO.Ninja Electron fix applied successfully');
    } else {
        console.log('VDO.Ninja Electron already initialized correctly');
    }
}

// Try to apply the fix immediately
fixVDONinjaElectron();

// Also try after a delay to catch late initialization
setTimeout(fixVDONinjaElectron, 500);
setTimeout(fixVDONinjaElectron, 1500);