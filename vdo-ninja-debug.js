// Debug VDO.Ninja's Electron setup
console.log('VDO.Ninja Debug: Checking Electron setup...');

// Check if the override was successful
setTimeout(() => {
    console.log('VDO.Ninja Debug: Checking after delay...');
    console.log('- navigator.mediaDevices.getDisplayMedia:', typeof navigator.mediaDevices.getDisplayMedia);
    console.log('- ElectronDesktopCapture:', window.ElectronDesktopCapture);
    console.log('- windowAudioCapture:', !!window.windowAudioCapture);
    
    // Check if VDO.Ninja's override is in place
    if (navigator.mediaDevices.getDisplayMedia) {
        const funcString = navigator.mediaDevices.getDisplayMedia.toString();
        console.log('- getDisplayMedia is custom:', !funcString.includes('[native code]'));
        console.log('- getDisplayMedia first 100 chars:', funcString.substring(0, 100));
    }
    
    // Try to manually test the getSources call
    if (window.ipcRenderer) {
        console.log('Testing getSources IPC call...');
        try {
            const testSources = window.ipcRenderer.sendSync("getSources", { types: ["screen"] });
            console.log('getSources test result:', testSources ? testSources.length + ' sources' : 'null/undefined');
        } catch (e) {
            console.error('getSources test error:', e);
        }
    }
}, 1000);