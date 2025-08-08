// VDO.Ninja Electron Integration Patch
// This script patches VDO.Ninja to work with the Electron audio capture

console.log('VDO.Ninja Electron Integration Patch Loading...');

// Wait for VDO.Ninja to initialize
function patchVDONinja() {
    // Check if we're in Electron
    if (navigator.userAgent.toLowerCase().indexOf(" electron/") === -1) {
        console.log('Not running in Electron, skipping patch');
        return;
    }

    console.log('Patching VDO.Ninja for Electron...');

    // Override the ElectronDesktopCapture flag
    if (typeof window !== 'undefined') {
        window.ElectronDesktopCapture = true;
        console.log('Set ElectronDesktopCapture = true');
        
        // Initialize windowAudioCapture if not already done
        if (!window.windowAudioCapture && window.WindowAudioStream) {
            try {
                window.windowAudioCapture = new window.WindowAudioStream();
                console.log('Initialized window.windowAudioCapture');
            } catch (e) {
                console.error('Failed to initialize WindowAudioStream:', e);
            }
        }
    }

    // Ensure ipcRenderer is available
    if (!window.ipcRenderer && window.require) {
        try {
            window.ipcRenderer = window.require('electron').ipcRenderer;
            console.log('ipcRenderer loaded via require');
        } catch (e) {
            console.error('Failed to load ipcRenderer:', e);
        }
    }

    // Check if VDO.Ninja's Electron code is working
    if (window.ipcRenderer) {
        console.log('ipcRenderer is available, using VDO.Ninja native implementation');
        return;
    }
    
    console.log('ipcRenderer not available, using our custom implementation');
    
    // DISABLED: Patch navigator.mediaDevices.getDisplayMedia if needed
    if (false && !window.originalGetDisplayMedia && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        window.originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
        
        navigator.mediaDevices.getDisplayMedia = function(constraints) {
            console.log('getDisplayMedia called with constraints:', constraints);
            
            return new Promise(async (resolve, reject) => {
                try {
                    // If ipcRenderer is available, use Electron's desktop capturer
                    if (window.ipcRenderer) {
                        console.log('Using Electron desktop capturer');
                        
                        // For auto-start scenarios
                        if (window.session && window.session.autostart) {
                            // Handle autostart logic
                            const sources = await window.ipcRenderer.sendSync("getSources", { types: ["screen", "window"] });
                            console.log('Got sources for autostart:', sources.length);
                            
                            // ... rest of autostart logic from VDO.Ninja
                            reject(new Error('Autostart not fully implemented'));
                            return;
                        }
                        
                        // Show source picker UI
                        const sources = await window.ipcRenderer.sendSync("getSources", { types: ["screen", "window"] });
                        console.log('Got sources:', sources.length);
                        
                        // Skip window list for now to avoid crashes
                        let windowsWithAudio = [];
                        let hasAudioCapture = false;
                        
                        // TODO: Re-enable window-specific audio after fixing IPC issue
                        console.log('Window-specific audio capture temporarily disabled');
                        
                        // Check if we can do system audio capture
                        const isWindows = navigator.platform.toLowerCase().includes('win');
                        const canCaptureSystemAudio = isWindows; // System audio works on Windows
                        
                        // Create and show the source picker
                        const selectionElem = document.createElement("div");
                        selectionElem.classList = "desktop-capturer-selection";
                        selectionElem.style.position = 'fixed';
                        selectionElem.style.top = '0';
                        selectionElem.style.left = '0';
                        selectionElem.style.width = '100%';
                        selectionElem.style.height = '100%';
                        selectionElem.style.backgroundColor = 'rgba(0,0,0,0.8)';
                        selectionElem.style.zIndex = '99999';
                        selectionElem.style.display = 'flex';
                        selectionElem.style.alignItems = 'center';
                        selectionElem.style.justifyContent = 'center';

                        // Build source list with audio options
                        const sourcesList = sources.map(({ id, name, thumbnail }) => {
                            // Check if this is a window that might have audio
                            const isWindow = !name.toLowerCase().includes('screen');
                            let audioOption = '';
                            
                            if (isWindow && hasAudioCapture) {
                                // Try to find matching window in audio list
                                const matchingWindow = windowsWithAudio.find(w => 
                                    w.title.includes(name) || name.includes(w.title)
                                );
                                if (matchingWindow) {
                                    audioOption = `
                                        <label style="display: flex; align-items: center; margin-top: 5px; font-size: 12px;">
                                            <input type="checkbox" class="capture-window-audio" data-window-id="${matchingWindow.id}" style="margin-right: 5px;">
                                            <span>Capture window audio</span>
                                        </label>
                                    `;
                                }
                            }
                            
                            return `
                                <li class="desktop-capturer-selection__item" style="border: 1px solid #ccc; padding: 10px; cursor: pointer; text-align: center;">
                                    <button class="desktop-capturer-click desktop-capturer-selection__btn" data-id="${id}" data-name="${name}" title="${name}" style="border: none; background: none; cursor: pointer; width: 100%;">
                                        <img class="desktop-capturer-selection__thumbnail" src="${thumbnail.toDataURL()}" style="width: 100%; height: auto;" />
                                        <span class="desktop-capturer-selection__name" style="display: block; margin-top: 5px;">${name}</span>
                                        ${audioOption}
                                    </button>
                                </li>
                            `;
                        }).join("");

                        const innerHtml = `
                            <div style="background: white; padding: 20px; border-radius: 10px; max-width: 90%; max-height: 90%; overflow: auto;">
                                <h2>Select a window or screen to share</h2>
                                ${canCaptureSystemAudio ? `
                                    <div style="margin: 10px 0; padding: 10px; background: #f0f0f0; border-radius: 5px;">
                                        <label style="display: flex; align-items: center; font-weight: bold;">
                                            <input type="checkbox" id="captureSystemAudio" checked style="margin-right: 10px;">
                                            <span>Include system audio</span>
                                        </label>
                                        ${!hasAudioCapture ? `
                                            <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">
                                                Note: Window-specific audio capture requires elevated privileges. 
                                                Right-click the app and select "Elevate App Privileges" to enable.
                                            </p>
                                        ` : ''}
                                    </div>
                                ` : ''}
                                <div class="desktop-capturer-selection__scroller">
                                    <ul class="desktop-capturer-selection__list" style="list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px;">
                                        ${sourcesList}
                                    </ul>
                                    <button id="cancelscreenshare" style="margin-top: 20px; padding: 10px 20px; background-color: #f44336; color: white; border: none; border-radius: 5px; cursor: pointer;">Cancel</button>
                                </div>
                            </div>
                        `;
                        
                        selectionElem.innerHTML = innerHtml;
                        document.body.appendChild(selectionElem);

                        // Handle cancel
                        document.getElementById("cancelscreenshare").addEventListener("click", () => {
                            selectionElem.remove();
                            reject(new Error('User cancelled'));
                        });

                        // Handle source selection
                        document.querySelectorAll(".desktop-capturer-click").forEach(button => {
                            button.addEventListener("click", async () => {
                                try {
                                    const id = button.getAttribute("data-id");
                                    const name = button.getAttribute("data-name");
                                    
                                    console.log('Selected source:', id, name);
                                    
                                    // Check if system audio should be captured
                                    const captureSystemAudioCheckbox = document.getElementById('captureSystemAudio');
                                    const shouldCaptureSystemAudio = captureSystemAudioCheckbox && captureSystemAudioCheckbox.checked;
                                    
                                    // Check if window-specific audio should be captured
                                    const windowAudioCheckbox = button.querySelector('.capture-window-audio');
                                    const windowAudioId = windowAudioCheckbox?.checked ? windowAudioCheckbox.getAttribute('data-window-id') : null;
                                    
                                    // Create constraints for video
                                    const videoConstraints = {
                                        mandatory: {
                                            chromeMediaSource: "desktop",
                                            chromeMediaSourceId: id
                                        }
                                    };
                                    
                                    // Apply any additional constraints
                                    if (constraints && constraints.video) {
                                        if (constraints.video.width?.ideal) {
                                            videoConstraints.mandatory.maxWidth = constraints.video.width.ideal;
                                        }
                                        if (constraints.video.height?.ideal) {
                                            videoConstraints.mandatory.maxHeight = constraints.video.height.ideal;
                                        }
                                        if (constraints.video.frameRate?.ideal) {
                                            videoConstraints.mandatory.maxFrameRate = constraints.video.frameRate.ideal;
                                        }
                                    }
                                    
                                    // Get video stream
                                    console.log('Getting video stream with constraints:', videoConstraints);
                                    const stream = await navigator.mediaDevices.getUserMedia({
                                        audio: false,
                                        video: videoConstraints
                                    });
                                    
                                    // Temporarily disable system audio to debug crash
                                    if (shouldCaptureSystemAudio && false) {
                                        try {
                                            console.log('System audio capture temporarily disabled for debugging');
                                            /*
                                            const audioStream = await navigator.mediaDevices.getUserMedia({
                                                audio: {
                                                    mandatory: {
                                                        chromeMediaSource: "desktop"
                                                    }
                                                },
                                                video: false
                                            });
                                            
                                            if (audioStream.getAudioTracks().length > 0) {
                                                stream.addTrack(audioStream.getAudioTracks()[0]);
                                                console.log('Added system audio track');
                                            }
                                            */
                                        } catch (audioErr) {
                                            console.warn('Failed to capture system audio:', audioErr);
                                        }
                                    }
                                    
                                    // Add window-specific audio if requested
                                    if (windowAudioId && window.windowAudioCapture) {
                                        try {
                                            console.log('Starting window audio capture for ID:', windowAudioId);
                                            const audioStream = await window.windowAudioCapture.start(windowAudioId);
                                            if (audioStream && audioStream.getAudioTracks().length > 0) {
                                                stream.addTrack(audioStream.getAudioTracks()[0]);
                                                console.log('Added window-specific audio track');
                                            }
                                        } catch (audioErr) {
                                            console.warn('Failed to capture window audio:', audioErr);
                                        }
                                    }
                                    
                                    selectionElem.remove();
                                    
                                    // Store the window audio capture instance for cleanup
                                    if (window.windowAudioCapture && window.windowAudioCapture.isCapturing()) {
                                        // Add event listener to stop audio capture when video stops
                                        const videoTrack = stream.getVideoTracks()[0];
                                        if (videoTrack) {
                                            videoTrack.addEventListener('ended', () => {
                                                console.log('Video track ended, stopping window audio capture');
                                                window.windowAudioCapture.stop();
                                            });
                                        }
                                    }
                                    
                                    resolve(stream);
                                    
                                } catch (err) {
                                    console.error('Error getting stream:', err);
                                    selectionElem.remove();
                                    reject(err);
                                }
                            });
                        });
                        
                    } else {
                        // Fallback to original implementation
                        console.log('Falling back to original getDisplayMedia');
                        return window.originalGetDisplayMedia.call(navigator.mediaDevices, constraints);
                    }
                } catch (err) {
                    console.error('Error in getDisplayMedia override:', err);
                    reject(err);
                }
            });
        };
        
        console.log('Patched navigator.mediaDevices.getDisplayMedia');
    }
}

// Try to patch immediately
patchVDONinja();

// Also try after a delay in case VDO.Ninja hasn't loaded yet
setTimeout(patchVDONinja, 1000);
setTimeout(patchVDONinja, 3000);

console.log('VDO.Ninja Electron Integration Patch loaded');