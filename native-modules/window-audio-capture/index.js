// Replace your current index.js with this implementation

const { WindowAudioCapture } = require('bindings')('window_audio_capture');

class AppAudioCapture {
  constructor() {
    this.captureInstance = new WindowAudioCapture();
    this.isCapturing = false;
    this.sampleRate = 0;
    this.channels = 0;
    this.windowList = [];
    this.audioListeners = [];
    this.captureIntervalId = null;
    this.processingAudio = false;
  }

  /**
   * Get list of windows with audio sessions
   * @returns {Promise<Array>} List of windows with their handles, titles, and process info
   */
  async getWindowList() {
    try {
      // Get the raw windows list
      const nativeWindows = this.captureInstance.getWindowList();
      console.log("Raw windows type:", typeof nativeWindows);
      
      let windows = [];
      
      // Handle different return types
      if (Array.isArray(nativeWindows)) {
        windows = nativeWindows;
      } else if (nativeWindows && typeof nativeWindows === 'object') {
        // First try checking for length property (common for array-like objects)
        const length = nativeWindows.length;
        
        if (typeof length === 'number' && length > 0) {
          // Convert an array-like object to a real array
          for (let i = 0; i < length; i++) {
            if (nativeWindows[i]) {
              windows.push(nativeWindows[i]);
            }
          }
        } else {
          // Try extracting numeric keys if length property doesn't work
          for (let key in nativeWindows) {
            if (!isNaN(parseInt(key)) && nativeWindows[key]) {
              windows.push(nativeWindows[key]);
            }
          }
        }
      }
      
      console.log("Windows found:", windows.length);
      
      // Filter out windows without executable names
      const filteredList = windows.filter(window => {
        if (!window || !window.executableName) return false;
        const exe = window.executableName.toLowerCase();
        return exe && 
               !exe.includes('explorer.exe') && 
               !exe.includes('dwm.exe') &&
               !exe.includes('taskmgr.exe');
      });
      
      return filteredList;
    } catch (err) {
      console.error('Error getting window list:', err);
      return [];
    }
  }
  
  /**
   * Get list of audio sessions
   * @returns {Promise<Array>} List of audio sessions with process info
   */
  async getAudioSessions() {
    try {
      const sessions = this.captureInstance.getAudioSessions();
      console.log("Audio sessions found:", sessions?.length || 0);
      return sessions || [];
    } catch (err) {
      console.error('Error getting audio sessions:', err);
      return [];
    }
  }
  
  /**
   * Start capturing audio from a specific window with streaming
   * @param {number} windowId - Window handle to capture
   * @param {Function} callback - Callback function to receive audio data
   * @returns {Object} Success status and audio format info
   */
  async startStreamCapture(windowId, callback) {
    if (this.isCapturing) {
      await this.stopCapture();
    }
    
    try {
      console.log(`Start window stream capture request: ${windowId} ${typeof windowId}`);
      
      // Check if the native module supports streaming
      if (!this.captureInstance.startStreamCapture) {
        console.error("Native module does not support startStreamCapture");
        return { 
          success: false, 
          error: "Stream capture not supported by native module" 
        };
      }
      
      // Get available audio sessions to help with debugging
      const sessions = await this.getAudioSessions();
      console.log(`Audio session process IDs: ${JSON.stringify(sessions.map(s => s.processId))}`);
      
      // Start streaming capture from the native module
      // Note: This may fail with 0x8000000e (E_OUTOFMEMORY)
      let result;
      try {
        result = this.captureInstance.startStreamCapture(windowId, (audioData) => {
          callback(audioData);
        });
      } catch (error) {
        console.error("Direct stream capture failed:", error.message);
        
        // If the error is E_OUTOFMEMORY, try to fallback to a different capture method
        if (error.message && error.message.includes("Failed to create process-specific loopback")) {
          // Try to find a matching audio session for this window/process
          console.log("Attempting to find a matching audio session for fallback capture");
          
          // Try to find audio session that matches our window
          let targetSession = null;
          
          // If windowId is a HWND (large number), we need to find the matching process ID
          // This requires knowledge from the window list, which we're having trouble with
          // So let's try to match by process info from sessions
          
          // For now, let's fallback to active audio sessions
          const activeSessions = sessions.filter(s => s.isActive);
          if (activeSessions.length > 0) {
            console.log(`Found ${activeSessions.length} active audio sessions for fallback`);
            targetSession = activeSessions[0]; // Use the first active session
            
            // Try to start capture using the session ID
            try {
              if (this.captureInstance.startCapture) {
                // Try to use startCapture with process ID
                result = this.captureInstance.startCapture(targetSession.processId);
                console.log(`Fallback capture for process ${targetSession.processId} result:`, result);
              }
            } catch (fallbackError) {
              console.error("Fallback capture failed:", fallbackError.message);
              throw error; // Re-throw the original error since fallback failed
            }
          } else {
            throw error; // Re-throw original error if no fallback is available
          }
        } else {
          throw error; // Re-throw for non-memory errors
        }
      }
      
      // Validate the result
      if (!result || typeof result !== 'object') {
        throw new Error("Invalid or null result from native module");
      }
      
      // Set capture state
      this.isCapturing = result.success === true;
      this.sampleRate = result.sampleRate || 48000;
      this.channels = result.channels || 2;
      
      return {
        success: this.isCapturing,
        clientId: Date.now(), // Generate a unique client ID
        sampleRate: this.sampleRate,
        channels: this.channels
      };
    } catch (err) {
      console.error('Error starting stream capture:', err);
      return { 
        success: false, 
        error: err.message || "Unknown error starting stream capture"
      };
    }
  }

  /**
   * Stop a streaming capture session
   * @returns {Object} Success status
   */
  async stopStreamCapture() {
    return await this.stopCapture();
  }
  
  /**
   * Start capturing audio from a specific window
   * @param {number|string} windowIdentifier - Window handle or string identifier
   * @param {Object} options - Capture options
   * @returns {Promise<Object>} Success status and audio format info
   */
  async startCapture(windowIdentifier, options = {}) {
    if (this.isCapturing) {
      await this.stopCapture();
    }

    // Resolve windowIdentifier to a window handle
    let windowHandle;
    if (typeof windowIdentifier === 'number') {
      // Assume it's already a window handle
      windowHandle = windowIdentifier;
    } else if (typeof windowIdentifier === 'string') {
      // Try to find by title or executable name
      const windows = await this.getWindowList();
      const matchWindow = windows.find(w => 
        w.title.includes(windowIdentifier) || 
        w.executableName.toLowerCase().includes(windowIdentifier.toLowerCase())
      );
      
      if (matchWindow) {
        windowHandle = matchWindow.id;
      } else {
        throw new Error(`Could not find window matching: ${windowIdentifier}`);
      }
    } else {
      throw new Error('Invalid window identifier. Must be a number (handle) or string (title/exe name)');
    }

    try {
      // If callback is provided, use streaming mode
      if (options.onAudioData && typeof options.onAudioData === 'function') {
        return await this.startStreamCapture(windowHandle, options.onAudioData);
      } else {
        // Use polling mode
        const result = this.captureInstance.startCapture(windowHandle);
        
        if (!result) {
          throw new Error("Null result from native module");
        }
        
        this.isCapturing = result.success === true;
        this.sampleRate = result.sampleRate || 48000;
        this.channels = result.channels || 2;
        
        // Set up polling if listeners are registered
        if (this.audioListeners.length > 0 && !this.captureIntervalId) {
          this._startPolling(options.pollingInterval || 100);
        }
        
        return {
          success: this.isCapturing,
          sampleRate: this.sampleRate,
          channels: this.channels
        };
      }
    } catch (err) {
      console.error('Error starting capture:', err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Stop audio capture
   * @returns {Promise<boolean>} Success status
   */
  async stopCapture() {
    if (!this.isCapturing) {
      return true;
    }
    
    try {
      // Stop polling if active
      if (this.captureIntervalId) {
        clearInterval(this.captureIntervalId);
        this.captureIntervalId = null;
      }
      
      const result = this.captureInstance.stopCapture();
      this.isCapturing = false;
      return result;
    } catch (err) {
      console.error('Error stopping capture:', err);
      return false;
    }
  }

  /**
   * Get the latest audio data (polling mode)
   * @returns {Float32Array} Audio samples
   */
  getAudioData() {
    if (!this.isCapturing) {
      return new Float32Array(0);
    }
    
    try {
      const data = this.captureInstance.getAudioData();
      return new Float32Array(data);
    } catch (err) {
      console.error('Error getting audio data:', err);
      return new Float32Array(0);
    }
  }

  /**
   * Add a listener for audio data (polling mode)
   * @param {Function} callback - Function to call with audio data
   */
  addAudioListener(callback) {
    if (typeof callback !== 'function') {
      throw new Error('Audio listener must be a function');
    }
    
    this.audioListeners.push(callback);
    
    // Start polling if we're capturing but not polling yet
    if (this.isCapturing && !this.captureIntervalId) {
      this._startPolling();
    }
  }

  /**
   * Remove an audio listener
   * @param {Function} callback - Function to remove
   */
  removeAudioListener(callback) {
    const index = this.audioListeners.indexOf(callback);
    if (index !== -1) {
      this.audioListeners.splice(index, 1);
    }
    
    // Stop polling if no listeners remain
    if (this.audioListeners.length === 0 && this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
      this.captureIntervalId = null;
    }
  }

  /**
   * Start the polling interval for audio data
   * @private
   * @param {number} interval - Polling interval in ms
   */
  _startPolling(interval = 100) {
    if (this.captureIntervalId) {
      clearInterval(this.captureIntervalId);
    }
    
    this.captureIntervalId = setInterval(() => {
      if (this.processingAudio || !this.isCapturing) return;
      
      this.processingAudio = true;
      try {
        const audioData = this.getAudioData();
        
        if (audioData.length > 0) {
          const audioInfo = {
            samples: audioData,
            sampleRate: this.sampleRate,
            channels: this.channels
          };
          
          // Notify all listeners
          this.audioListeners.forEach(listener => {
            try {
              listener(audioInfo);
            } catch (err) {
              console.error('Error in audio listener:', err);
            }
          });
        }
      } finally {
        this.processingAudio = false;
      }
    }, interval);
  }
}

module.exports = new AppAudioCapture();