// Simple fix to ensure VDO.Ninja can access ipcRenderer
(function() {
    try {
        // Don't run if we're not in Electron
        if (navigator.userAgent.toLowerCase().indexOf(" electron/") === -1) {
            return;
        }
        
        console.log('VDO Electron Fix: Running in Electron');
        
        // Make sure require is available globally
        if (typeof require === 'undefined' && typeof window.require !== 'undefined') {
            window.require = window.require;
            console.log('VDO Electron Fix: Made require available globally');
        }
        
        // Ensure ipcRenderer is accessible for VDO.Ninja
        if (typeof window.ipcRenderer === 'undefined') {
            if (window.require) {
                try {
                    window.ipcRenderer = window.require('electron').ipcRenderer;
                    console.log('VDO Electron Fix: ipcRenderer made available');
                } catch (e) {
                    console.error('VDO Electron Fix: Failed to load ipcRenderer:', e);
                }
            }
        }
        
        // Ensure Electron module is accessible
        if (typeof require !== 'undefined') {
            try {
                const electron = require('electron');
                console.log('VDO Electron Fix: Electron module loaded successfully');
                
                // VDO.Ninja expects to be able to require electron and access ipcRenderer
                if (!window.electron) {
                    window.electron = electron;
                }
                
                // Also ensure desktopCapturer is available
                if (!window.desktopCapturer && electron.desktopCapturer) {
                    window.desktopCapturer = electron.desktopCapturer;
                    console.log('VDO Electron Fix: desktopCapturer made available');
                }
            } catch (e) {
                console.error('VDO Electron Fix: Failed to load electron module:', e);
            }
        }
    } catch (e) {
        // Silently fail to avoid breaking anything
        if (typeof console !== 'undefined' && console.error) {
            console.error('VDO Electron Fix error:', e);
        }
    }
})();