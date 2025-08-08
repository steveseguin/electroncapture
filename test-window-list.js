// Test script to check window list functionality
console.log('Testing window list functionality...');

// Add a simple test button
const testButton = document.createElement('button');
testButton.textContent = 'Test Window List';
testButton.style.position = 'fixed';
testButton.style.top = '10px';
testButton.style.right = '10px';
testButton.style.zIndex = '99999';
testButton.style.padding = '10px';
testButton.style.backgroundColor = '#4CAF50';
testButton.style.color = 'white';
testButton.style.border = 'none';
testButton.style.borderRadius = '5px';
testButton.style.cursor = 'pointer';

testButton.addEventListener('click', async () => {
    console.log('Testing window list...');
    
    if (window.electronApi && window.electronApi.getWindowList) {
        try {
            console.log('Calling getWindowList...');
            const windows = await window.electronApi.getWindowList();
            console.log('Window list result:', windows);
            console.log('Number of windows:', windows ? windows.length : 0);
            if (windows && windows.length > 0) {
                console.log('First window:', windows[0]);
            }
        } catch (e) {
            console.error('Error getting window list:', e);
        }
    } else {
        console.error('electronApi.getWindowList not available');
    }
});

document.body.appendChild(testButton);
console.log('Test button added to page');

// Add diagnostic info
console.log('Electron environment check:');
console.log('- typeof require:', typeof require);
console.log('- typeof window.require:', typeof window.require);
console.log('- typeof ipcRenderer:', typeof ipcRenderer);
console.log('- typeof window.ipcRenderer:', typeof window.ipcRenderer);
console.log('- ElectronDesktopCapture:', typeof ElectronDesktopCapture !== 'undefined' ? ElectronDesktopCapture : 'undefined');

// Check if we can access electron
if (typeof require !== 'undefined') {
    try {
        const electron = require('electron');
        console.log('- electron module loaded:', !!electron);
        console.log('- electron.ipcRenderer:', !!electron.ipcRenderer);
        console.log('- electron.desktopCapturer:', !!electron.desktopCapturer);
    } catch (e) {
        console.log('- Failed to require electron:', e.message);
    }
}