# electron-asio

Native ASIO audio support for Electron (Windows only).

Uses PortAudio with ASIO backend for low-latency professional audio I/O.

## Requirements

- Windows 10/11
- Node.js 18+
- Python 3.x (for node-gyp)
- Visual Studio Build Tools 2019+ with C++ workload
- ASIO drivers (ASIO4ALL, manufacturer drivers, etc.)

## Building

```bash
cd native-modules/electron-asio
npm install
```

This will compile the native addon using node-gyp.

## Pre-built Binary

A pre-built `electron_asio.node` is included in `build/Release/` for convenience.

## Dependencies

- **PortAudio** - Audio I/O library with ASIO support
  - Header: `deps/portaudio/include/portaudio.h`
  - Library: `deps/portaudio/lib/portaudio_x64.lib`
  - Runtime: `deps/portaudio/lib/portaudio_x64.dll`

## API

### Module Functions

```javascript
const asio = require('electron-asio/lib/index');

// Initialize PortAudio
asio.initialize();

// Check if ASIO is available
if (asio.isAvailable()) {
    console.log('ASIO devices:', asio.getDevices());
}

// Create a stream
const stream = asio.createStream({
    deviceIndex: 0,      // Device index or -1 for default
    sampleRate: 48000,
    bufferSize: 256,
    inputChannels: [0, 1],  // Capture channels 0 and 1
});

// Set callback for audio data
stream.setProcessCallback((inputBuffers, outputBuffers) => {
    // inputBuffers is array of Float32Array (one per channel)
    console.log('Received', inputBuffers[0].length, 'samples');
});

// Start streaming
stream.start();

// Later: stop and cleanup
stream.stop();
stream.close();
asio.terminate();
```

### AsioStream Properties

- `isRunning` - Boolean, true if stream is active
- `inputLatency` - Input latency in milliseconds
- `outputLatency` - Output latency in milliseconds
- `sampleRate` - Sample rate in Hz
- `bufferSize` - Buffer size in frames
- `inputChannelCount` - Number of input channels
- `outputChannelCount` - Number of output channels
- `stats` - Object with `callbackCount`, `inputUnderflows`, `outputUnderflows`, `cpuLoad`

## License

MIT - Uses PortAudio (MIT license)

Note: ASIO is a trademark of Steinberg Media Technologies GmbH.
