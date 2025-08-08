// Test using default audio loopback instead of process-specific

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

console.log('=== Default Audio Loopback Test ===\n');
console.log('This test will attempt to capture ALL system audio\n');

// Since the current module doesn't support default loopback,
// let's create a simple test to show what needs to be done

async function testDefaultLoopback() {
    // Check if we're admin
    exec('net session', (error) => {
        if (error) {
            console.log('⚠️  Not running as administrator');
            console.log('Default loopback capture requires admin privileges\n');
        } else {
            console.log('✓ Running as administrator\n');
        }
    });
    
    console.log('The current native module only supports process-specific capture.');
    console.log('Process-specific capture is failing with E_OUTOFMEMORY (0x8000000e).\n');
    
    console.log('To fix this issue, the native module needs to be modified to support:');
    console.log('1. Default audio endpoint loopback capture');
    console.log('2. Fallback from process-specific to default capture');
    console.log('3. Option to choose capture method\n');
    
    console.log('Suggested modification to window_audio_capture.cc:');
    console.log('================================================\n');
    
    const suggestion = `
// Add this method to WindowAudioCapture class:
bool WindowAudioCapture::CreateDefaultLoopbackCapture() {
    // Get default audio endpoint
    ComPtr<IMMDevice> device;
    HRESULT hr = deviceEnumerator->GetDefaultAudioEndpoint(
        eRender, eConsole, device.GetAddressOf());
    
    if (FAILED(hr)) {
        std::cerr << "Failed to get default audio endpoint" << std::endl;
        return false;
    }
    
    // Activate audio client for loopback
    hr = device->Activate(
        __uuidof(IAudioClient), CLSCTX_ALL, NULL, 
        (void**)audioClient.GetAddressOf());
    
    if (FAILED(hr)) {
        std::cerr << "Failed to activate audio client" << std::endl;
        return false;
    }
    
    // Get mix format
    hr = audioClient->GetMixFormat(&pwfx);
    if (FAILED(hr)) {
        std::cerr << "Failed to get mix format" << std::endl;
        return false;
    }
    
    // Initialize in loopback mode
    hr = audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK,
        0, 0, pwfx, NULL);
    
    if (FAILED(hr)) {
        std::cerr << "Failed to initialize audio client in loopback mode" << std::endl;
        return false;
    }
    
    // Get capture client
    hr = audioClient->GetService(
        __uuidof(IAudioCaptureClient),
        (void**)captureClient.GetAddressOf());
    
    if (FAILED(hr)) {
        std::cerr << "Failed to get capture client" << std::endl;
        return false;
    }
    
    return true;
}

// Modify StartCapture to fallback to default loopback:
Napi::Value WindowAudioCapture::StartCapture(const Napi::CallbackInfo& info) {
    // ... existing code ...
    
    // If process-specific fails, try default loopback
    if (!CreateProcessSpecificLoopbackCapture(processId)) {
        std::cerr << "Process-specific capture failed, trying default loopback..." << std::endl;
        
        if (!CreateDefaultLoopbackCapture()) {
            // Return error
        } else {
            std::cerr << "Using default audio loopback capture" << std::endl;
            usingProcessSpecificLoopback = false;
        }
    }
    
    // ... rest of existing code ...
}
`;
    
    console.log(suggestion);
    
    console.log('\nWith this modification, the test would work by capturing');
    console.log('all system audio instead of just Windows Media Player audio.');
    console.log('\nThis is more reliable but less selective.');
}

testDefaultLoopback();