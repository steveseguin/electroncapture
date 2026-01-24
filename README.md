## This is the **Electron Capture app**,
Created originally for <a href="https://vdo.ninja">VDO.Ninja</a> users, it can provide users a clean way of window capturing websites or as a production-oriented Chrome-alternative with numerous performance tweaks. It can also be used to pin <a href="https://socialstream.ninja">live chat overlays</a> on screen, screen share without user interaction, increase the resolution of Zoom streams, and much much more.

#### <a href="https://github.com/steveseguin/electroncapture#links-to-downloads-below">Jump to Downloads Section</a>

<img src="https://user-images.githubusercontent.com/2575698/121296394-94292d00-c8be-11eb-908e-638e5616691a.png " alt="" data-canonical-src="https://user-images.githubusercontent.com/2575698/121296394-94292d00-c8be-11eb-908e-638e5616691a.png"  style="display:inline-block" height="300" />

## Why was this made ?
On some systems the OBS Browser Source plugin isn't available or doesn't work all that well, so this tool was made as a viable agnostic alternative. It was originally built to let you cleanly screen-grab just a video stream without the need of the OBS Browser Source plugin. The app was also made to make selecting the output audio playback device easy, outputting audio to something such as a Virtual Audio device: ie) https://vb-audio.com/Cable/ (Windows & macOS; donationware) or VAC (Windows @ https://vac.muzychenko.net/), or Loopback (macOS).  

While the OBS Browser source is ever maturing, and issues with video smearing, crashing, and dropped audio are far less common these days, there are still user reports of desync issues and other mishaps with OBS browser sources. As a result, Electron Capture remains the preference for many professional VDO.Ninja users, and over time it has evolved to offer additional solutions for many different use cases in the video production world.

The app can be set to remain on top of other windows, can hide the mouse cursor when possible, provides accurate window sizes options for 1:1 pixel mapping, and supports global system hotkeys (CTRL+M on Windows, for example). It also offers relatively low-CPU usage, command-line launch tools, built-in recording options, and it won't crash if OBS crashes. It may be worth exploring before your next production.

The Electron Capture app uses recent versions of Chromium, and is setup to more resistant to desync, video smearing, and other issues that might exist in the native OBS browser source capture method. If a cutting edge web feature becomes available within browsers, it will also become available to Electron Capture first, making certain experimental features within VDO.Ninja accessible. The app is also optimized to not throttle when the system is stressed, ensuring that production-critical web-oriented code and media does not slow down or stop when its most needed.

For non-VDO.Ninja users, the window-sharing focus of Electron Capture is also useful for Zoom or other users. For example, when screen sharing it into Zoom, the published video will be high-resolution, since Zoom publishes virtual webcam and other camera streams at lower quality compared to screen shares. You can screen share websites without the browser frame, search history, or nav bar from appearing. When doing a Power Point presentation, you can screen share the window via Electron Capture, while also pinning the it in place on top, avoiding having to toggle between multiple windows as you present. 

[More benefits listed here](https://github.com/steveseguin/electroncapture/blob/master/BENEFITS.md)

Lastly, since playback is agnostic, you can window-capture the same video multiple times, using one copy in a mixed-down live stream, while using a window-capture to record a clean full-resolution isolated video stream.  Both YouTube, Twitch, Facebook, and more are supported in this regard, where a full-window clean output option is available for those sites as well. There's even optimizations for sites like Twitch, letting you easily full-window any video on the page, without overlays or other effects from appearing.

## Video guide on how to use Electron Capture
[![Video Guide for Electron](https://user-images.githubusercontent.com/2575698/129784248-3270a876-6831-4595-9eb5-63665843e631.png)](https://youtu.be/mZ7X7WvRcRA "Video Guide for Electron")

## Custom Electron Build (QP20)
- The pipeline now targets the custom binaries published on `steveseguin/electron` under the `v36.9.5-qp20` tag. During `npm install` our `postinstall` hook (`scripts/install-custom-electron.js`) replaces the stock Electron bits with the patched archive that clamps QP to 0-20 and enables NVENC.
- Requirements: Node.js ≥ 18, git, and network access to GitHub Releases. From PowerShell or WSL run `npm install` (or `npm ci`) at the repo root; the hook pulls `electron-v36.9.5-qp20-${platform}-${arch}.zip` (Linux: `linux-x64`, Windows: `win32-x64`), unpacks it into `node_modules/electron/dist`, and stamps `.custom-version` so reinstalls are skipped.
- Verify with `node scripts/install-custom-electron.js` (re-runs the hook) or by checking `node_modules/electron/dist/.custom-version`—it should read `36.9.5-qp20`. At runtime `npx electron --version` will still report the upstream package version, but the bundled bits are the custom build.
- Building for Windows uses the same commands as before (`npm run build:win32`). The new `build.electronVersion` metadata keeps the generated installer aligned with the custom runtime.
- To fall back to stock Electron set `CUSTOM_ELECTRON_SKIP=1` before installing, or delete `node_modules/electron/dist` and reinstall.

## Settings and Parameters

| Parameter          | Alias     | Description                                     | Example values                     | Notes                                           |
|-------------------|-----------|-------------------------------------------------|-----------------------------------|------------------------------------------------|
| --width           | -w        | The width of the window in pixels.             | 1280                              | Value in px                                     |
| --height          | -h        | The height of the window in pixels.            | 720                               | Value in px                                     |
| --x               | -x        | The x-position of the window in pixels.         | 100                              | Value in px                                     |
| --y               | -y        | The y-position of the window in pixels.         | 100                               | Value in px                                     |
| --url             | -u        | The URL of the window to load.                  | "https://vdo.ninja/electron"     |                                                |
| --title           | -t        | The default Title for the app Window.           | "My App"                          | Handy for use with OBS window capture          |
| --pin             | -p        | Enables always on top.                          |                                   |                                                |
| --hwa             | -a        | Enables Hardware Acceleration.                  |                                   |                                                |
| --node            | -n        | Enables node-integration.                       |                                   | Required for screen capture, global hotkeys, etc. |
| --minimized       | --min     | Starts the window minimized.                   |                                   |                                                |
| --fullscreen      | -f        | Enables full-screen mode for the first window on its load. |                       |                                                |
| --unclickable     | --uc      | The page will pass through any mouse clicks or other mouse events. |               |                                                |
| --savefolder      | --sf      | Where to save a file on disk.                   | "/path/to/folder"                 |                                                |
| --mediafoundation | --mf      | Enables media foundation video capture.         |                                   |                                                |
| --disablemediafoundation | --dmf | Disables media foundation video capture; helps capture some webcams. |          |                                                |
| --chroma          | --color   | Set background CSS to target hex color.         | "FFF" or "0000"                   |                                                |
| --js              | -js       | Have local JavaScript script be auto-loaded into every page | "script.js"          | Path to JavaScript file to inject              |
| --css             | -css      | Have local CSS script be auto-loaded into every page | "style.css"                 | Path to CSS file to inject                     |
| --hidecursor      | -hc       | Hide the mouse pointer / cursor                 |                                   |                                                |
| --monitor         | -m        | Monitor index to open on (0-based index)        | 0                                 | Select which monitor to display on             |
| --disableAdaptiveScaling | --noScaling | Disable WebRTC adaptive scaling (lock resolution + framerate) |               | Custom Electron build only (v39.2.7+)          |
| --lockResolution  | --lockRes | Lock WebRTC resolution only (framerate can adapt) |                              | Custom Electron build only (v39.2.7+)          |
| --lockFramerate   | --lockFps | Lock WebRTC framerate only (resolution can adapt) |                              | Custom Electron build only (v39.2.7+)          |
| --hideCursorCapture | --noCursor | Hide cursor in screen capture by default      |                                   | Custom Electron build only (v39.2.7+)          |
| --playoutDelay    | --bufferDelay | Default playout delay for WebRTC receivers (seconds) | 0-600                    | Custom Electron build only (v39.2.7+)          |

**Notes:**
* Use the `--help` command to get the most recent available commands and options.
* The default frameless resolution of the capture window is 1280x720. The app automatically accounts for high-DPI displays, so it is always 1:1 pixel-accurate with the specified resolution on even Apple Retina displays.
* For screen-sharing and advanced features such as global hotkeys, you need to enable node integration with the `--node` parameter.

### Command Line Examples

The optional Command Line arguments can be seen as examples below, along with their default values.

#### Windows example (recommended format)
```
elecap.exe --width=1280 --height=720 --url="https://vdo.ninja/electron" --title="my Window name" --x=1 --y=1 --node=1
```
As shown above, using an equal sign (`=`) and double quotes to encapsulate strings is recommended for Windows command line / batch file users.

#### Linux/macOS example
```
./elecap -w 1280 -h 720 -u 'https://vdo.ninja/electron' -t 'my Window name' --x 10 --y 10 -n 1
```

#### Custom CSS/JavaScript example
```
elecap.exe --width=1280 --height=720 --url="https://vdo.ninja/electron" --js="custom.js" --css="style.css"
```

#### Escape ampersand characters in Windows without quotes
```
elecap -t=feed2 --url https://vdo.ninja/?view=ePz9hnx^&scene^&codec=h264^&room=SOMETHINGTEST123
```
The above usage requires escaping ampersand (`&`) characters with a caret (`^`) character.

#### Simpler format with complex URLs
```
elecap.exe --node true --title feed2 --url "https://vdo.ninja/?view=ePz9hnx&scene&codec=h264&room=SOMETHINGTEST123"
```
Note that the elecap.exe is the 'portable' version of Electron Capture; you can choose the installer or the single-file portable version. The portable one is easier to use via command line, with the installer version better without command line usage.
As well, if running from Windows command prompt, without encapsulating quotes, any ampersand "&" characters will need to be escaped with a "^" character, as seen below:
```
elecap -t=feed2 --url https://vdo.ninja/?view=ePz9hnx^&scene^&codec=h264^&room=SOMETHINGTEST123
```
The above usage isn't probably ideally suited for windows users though, but it might work.


You can also use it like this, if you are in the same folder as the app itself, and so long as the complex string value is last.
```
elecap.exe --node true --title feed2 --url "https://vdo.ninja/?view=ePz9hnx&scene&codec=h264&room=SOMETHINGTEST123"
````
Note that the elecap.exe is the 'portable' version of Electron Capture; you can choose the installer or the single-file portable version. I personally find the portable one easier to use via command line, with the installer version better without command line usage.

If running from a Windows batch file with the goal of launching multiple instances at a time, try the following as an example:
```
start elecap.exe -w 640 -h 360 -x 0 -y 0 -s -u="https://vdo.ninja/?scene&fakeguests=1&room=SOMETHINGTEST123" -t="Guest 1" -p
timeout /T 1
start elecap.exe -w 640 -h 360 -x 640 -y 0 -u="https://vdo.ninja/?scene&fakeguests=1&room=SOMETHINGTEST123" -t="Guest 2" -p
timeout /T 1
start elecap.exe -w 640 -h 360 -x 0 -y 360 -u="https://vdo.ninja/?scene&fakeguests=1&room=SOMETHINGTEST123" -t="Guest 3" -p
timeout /T 1
start elecap.exe -w 640 -h 360 -x 640 -y 360 -u="https://vdo.ninja/?scene&fakeguests=1&room=SOMETHINGTEST123" -t="Guest 4" -p
```
- If not using an equal sign (=) between the parameter and value, there may be issues with Windows command line
- Please also note,the use ot timeout /T 1, as adding a delay between loading apps allows them to load correctly
- x and y position is available in v1.5.2 and up; x or y values must be greater than 0.

If you want each launch to operate as a completely separate process (instead of reusing the existing instance's windows), start it with the `--multiinstance` flag (alias: `--standalone`).

<img src="https://user-images.githubusercontent.com/2575698/80891745-290d3000-8c94-11ea-85c4-ae0e7cd1ec19.png " alt="" data-canonical-src="https://user-images.githubusercontent.com/2575698/80891745-290d3000-8c94-11ea-85c4-ae0e7cd1ec19.png " style="display:inline-block" height="300" />

If you right-click the application, you'll get a context menu with additional options. Changing resolutions dynamically is an option, for example.

### Screen-share, global hotkeys, and user-prompts

##### screen sharing
Starting with version 1.6.0, to enable screen-share support and some other features, the app needs Node Integration enabled; aka, Elevated Privileges. This will allow remote websites to run node-based code, which is a security concern if visiting untrusted websites.

You can enable Elevated Privileges for the app via the command line with `--node 1` or in the app by right-clicking and selecting "Elevate Privileges" from the context-menu. If right-clicking to enable this mode, the app may reload the page afterwards.

A unique feature about the Electron Capture app is that it can auto-select a screen or window when screen-sharing with VDO.Ninja, without user-input. Adding to the VDO.Ninja URL, &ss=1 will select display 1, &ss=2 for the second display, etc.  Or specify a window with &ss=window_name_here.

To select Screen 1 automatically on load, for example you can do:

```elecap.exe --node 1 --url="https://vdo.ninja/beta/?ss=1&autostart"```

or to select Discord automatically

```
elecap.exe --node 1 --url="https://vdo.ninja/beta/?ss=Discord&autostart"
```

It's also possible to select audio-only when screen sharing via Electron Capture with VDO.Ninja; you do not need to select a video if you wish to share audio-only.

#### global hotkeys

Global Hotkeys, such as CTRL+M, are supported. CTRL+M will mute the mic, in the most recently opened window.  You can assign a custom global hot-key in VDO.Ninja, and it will be respected by Electron Capture. (VDO.Ninja Settings -> User -> Global Hotkey)

Youtube has a built-in automatic ad-skipper added, and for both Youtube, Twitch, and more, when watching a video, you can full-window the video, allowing for clean video capture. This option is available via the context menu of Electron Capture; just right-click somewhere on the page that is empty and select Clean Video Output.

![image](https://user-images.githubusercontent.com/2575698/130308991-4a6e15f2-00e3-453f-a79f-8a874d2a6417.png)


### ASIO Audio Capture (Windows Only)

Electron Capture now supports **ASIO audio capture** for professional audio interfaces. ASIO (Audio Stream Input/Output) provides ultra-low latency audio capture directly from your audio interface, bypassing the Windows audio mixer.

#### Why ASIO?

- **Ultra-low latency**: ASIO drivers provide latency as low as 1-10ms vs 50-100ms+ for standard Windows audio
- **Professional quality**: Direct bit-perfect audio capture from your interface
- **Multi-channel support**: Capture multiple channels simultaneously from multi-channel interfaces
- **Sample rate flexibility**: Support for professional sample rates (44.1kHz to 192kHz)

#### Requirements

1. **Windows only** - ASIO is a Windows audio standard
2. **ASIO driver installed** - Either:
   - Your audio interface's native ASIO driver (Focusrite, Universal Audio, RME, etc.)
   - [ASIO4ALL](https://www.asio4all.org/) - Free universal ASIO driver for any audio device
3. **Node integration enabled** - Launch with `--node` flag

#### Usage

```bash
# Launch Electron Capture with node integration
elecap.exe --node --url="file:///path/to/demo/asio-waveform.html"
```

#### JavaScript API

```js
// Check if ASIO is available
if (window.electronApi.isAsioAvailable()) {
    // Get list of ASIO devices
    const devices = window.electronApi.getAsioDevices();
    console.log('ASIO Devices:', devices);

    // Create an ASIO audio stream
    const stream = window.electronApi.createAsioStream({
        deviceIndex: devices[0].index,  // First ASIO device
        sampleRate: 48000,               // Sample rate in Hz
        channels: 2,                     // Number of channels
        framesPerBuffer: 256             // Buffer size (lower = less latency)
    });

    // Listen for audio data
    stream.on('data', (audioData) => {
        // audioData is a Float32Array of audio samples
        console.log('Received', audioData.length, 'samples');
    });

    stream.on('error', (err) => {
        console.error('ASIO Error:', err);
    });

    // Start capturing
    stream.start();

    // Stop when done
    // stream.stop();
}
```

#### Demo

A waveform visualization demo is available at: **https://electroncapture.app/demo/asio-waveform.html**

Open it in Electron Capture with node integration enabled:

```bash
elecap.exe --node --url="https://electroncapture.app/demo/asio-waveform.html"
```

#### VDO.Ninja Integration

VDO.Ninja will automatically detect and use ASIO when available in Electron Capture. No additional configuration is needed - just launch Electron Capture with `--node` and VDO.Ninja will offer ASIO devices as audio input options.

#### Limitations & Considerations

- **Windows only** - ASIO is a Windows-specific audio standard; macOS and Linux are not supported
- **Exclusive device access** - ASIO typically takes exclusive control of the audio device; other applications may not be able to use it simultaneously
- **Driver required** - You must have an ASIO driver installed (either your audio interface's native driver or ASIO4ALL)
- **Node integration required** - Must launch with `--node` flag, which has security implications for untrusted websites
- **Single device per stream** - Each ASIO stream captures from one device at a time
- **No output routing** - ASIO capture is input-only; audio output still uses standard Windows audio

### Audio Output

A popular way of outputting audio from the Electron Capture app into OBS is done using a virtual audio cable. Some such cables include:

Mac Audio Options: https://rogueamoeba.com/loopback/ (macOS & non-free, but excellent), and https://existential.audio/blackhole/ (macOS & free)
(and more here https://github.com/steveseguin/vdoninja/wiki/FAQ#macaudio)

Windows Audio Option: https://www.vb-audio.com/Cable/ (donationware)

If you intend to have more than a 6 virtual audio cables, you can try VAC instead of VB Cables, as VAC seems to support dozens of virtual audio cables, while VB Cable supports just a few: https://vac.muzychenko.net/

You can also use some advanced URL parameters to output the audio to specific channels. The following link links the parameters and the outcome, based on device/software used:
https://docs.google.com/spreadsheets/d/1R-y7xZ2BCn-GzTlwqq63H8lorXecO02DU9Hu4twuhuA/edit?usp=sharing

You can still capture audio via OBS Browser source, appending &novideo to the URL to disable video.  Appending &noaudio to the Electron Capture URL would conversely disable audio there, allowing you to capture audio with OBS browser source and video with Electron Capture.  The audio/video sync might be slightly off in this setup, but not noticible in most cases.

More recently, with newer versions of OBS, you can capture an application's audio using OBS natively, but with older versions you can use the following OBS plugin to also do it: https://github.com/bozbez/win-capture-audio 

![image](https://github.com/steveseguin/electroncapture/assets/2575698/f59f940b-c277-44f5-9876-06562b3f2658)


#### Changing the audio output device

If you right click the app when on a site, you can change the audio output device for that site. This is useful for setting a Youtube or VDO.Ninja video to output to a virtual audio cable or headphones, rather than playout via the default audio device.

On macOS, this is especially helpful since there is a lack of audio routing controls.

Please note:  To use this feature, you will need to elevate the app's privilleges, which can expose the user to security issues on untrusted websites. 

### Pinning and click-pass thru

You can pin the app on top of other apps via the right-click menu, and when enabled, you can then also enable "click thru" mode also via the context-menu, so no mouse input is captured. The app acts a bit like it is invisible, turning it into a bit of HUD for other applications and games.

If using socialstream or vdo.ninja, you can append &transparent to those URLs to make the background transparent.  You can also use custom CSS to make web pages shown semi-transparent, so you can still see underneath.

Once "click thru" mode is enabled, you can re-enable click-capture by just selecting the app via the task bar, as bringing the app into focus will disable the click-thru mode.

### Deep linking

You can load Electron Capture via deep-links in websites and web-apps; assuming you have already installed and have used the app before.

eg: `electroncapture://vdo.ninja/?view=abc123` will open Elecap and load a VDO.Ninja view link.

The page below will let you customize deep links with additional settings, such as width, height, and position:

[https://vdo.ninja/electroncapture](https://vdo.ninja/electroncapture)

![image](https://github.com/user-attachments/assets/48692af7-ae90-4fa0-b4b6-e5e01b444172)

### Syphon Output

While there is no native Syphon or NDI output option yet available, one user has mentioned a solution for some users:
http://www.sigmasix.ch/syphoner/

### Automation Workflows with VDO.Ninja

You can see a quick start / cheat sheet guide for example uses of the app with VDO.Ninja here: https://github.com/steveseguin/vdo.ninja/blob/quickstart/automation/cheatsheet_obsn_automation.md

## Notes on Using and Closing the App

#### For Windows users:

- Right click to bring up the context menu, which allows you to close the app. You can also press ALT-F4 in many cases.

- You can disable hardware-assisted rendering by passing '-a 0' to the command line when lauching; this can help hide the windows mouse cursor with some setups when using BitBlt capture mode.

- You can use the Win+Tab key combo on Windows 10 machines to create a secondary desktop and load the Electron Capture into that. In this way, you can hide your electron capture windows, yet still have them be available to OBS for window-capture. This is a great option for window-capturing without on computers with limited desktop screen space.

#### For Mac users:

- You can hover your mouse cursor over the top-left corner of the app to show the close button.

- Also note, the top portion of the app is draggable, so you can move it around to place it accordingly. It is also resizable.

- Multiple versions of the app can run on macOS; just make a copy of the file with a different name to open up a new window.

- Desktop audio capture with screen share is not supported by Electron (https://www.electronjs.org/docs/latest/api/desktop-capturer#caveats)

- You need to enable Screen Capture support in the macOS security preferences for the app to enable desktop capture support on macOS 10.15 Catalina or higher. Yuo also need to enable elevated privillges in the Electron Capture app itself.

- If capturing the window with OBS, you can use either DISPLAY CAPTURE with a WINDOW CROP  -or-  WINDOW CAPTURE

--- *WINDOW CAPTURE* will have a video delay of up to ~800ms, but Windows can be stacked without issue

--- *DISPLAY CAPTURE* will have no delay, but the windows cannot be stacked, which could be a problem if you only have one screen

# Links to downloads below.

You can find the newest release builds of the app here: https://github.com/steveseguin/electroncapture/releases  or see below.

Please note that the Electron Capture app does not auto-update to newer versions of Chromium. This can become a security issue if it is left to become out of date. It's also recommended to not use the Electron Capture app with websites and remote VDO.Ninja peers that you do not trust.

### Windows Version 🪟

There are two versions for Windows. An installer for x64 systems. There's also a portable version, which is larger in size, but supports x64 and x86 (32-bit) systems. The portable version requires no install and is easier to use from the command-line or from a batch file.

New release here: https://github.com/steveseguin/electroncapture/releases/

If you have problems, try a different version or contact me on Discord.

### Mac Version 🍎
- Newest version can be found here:
https://github.com/steveseguin/electroncapture/releases/

- If having problems, there's an older version here (v1.1.3)
https://github.com/steveseguin/electroncapture/releases/download/1.1.3/obsn-1.1.3.dmg

If on version of Electron doesn't work for you all that well, try a different version. There may be some issues with rounded edges depending on you macOS version and the Electron version used.

### Linux Version 🐧
- Newest version can be found here, available primarily as AppImages, but variations are available:  https://github.com/steveseguin/electroncapture/releases/

For most Linux users though, we're recommending Linux users build it themselves. Details below

Getting the correct nodejs/npm versions can be hard on linux, but using snap can help there.
```
sudo apt-get update
sudo apt-get install snapd -y
sudo snap install node --classic --channel=18
# sudo snap refresh node --channel=20 ## If you need to update to a different version of node, to match the manifest's minimum ersion, you can do so like this I think
```
Next, close the shell and open a new one, to ensure the installation is completed.

To get the actual app source code and to build a distributable version, see below
```
git clone https://github.com/steveseguin/electroncapture
cd electroncapture
npm install
npm run build:linux
```
The file you need to run will be in the dist folder.

## Installing / building for the Raspberry Pi 🥧

- Newest version can be found here, whichi includes an AppImage specific for the RPI, but more generic ARM-Linux options exist, too.
https://github.com/steveseguin/electroncapture/releases/

If you want to compile on Raspberry Pi, it's possible, but keep in mind the GPU may not work without also patching Electron.js to support the GPU. Currently you'll need to run it without hardware-acceleration disabled, which is rather disappointing.  Contributions that can help fix this are welcomed.

Anyways, this is all much like with the Linux install, but we also need to install `fpm` before trying to build the app.

```
sudo apt-get update
sudo apt-get install snapd -y
sudo apt-get remove nodejs -y
sudo snap install node --classic --channel=14

 ## close the current terminal shell and open a new one here ##

sudo apt install ruby ruby-dev -y
sudo gem install fpm 
```

We also need to build the app using `build:rpi` instead of `build:linux`, as we need to target ARM versus x64.
```
git clone https://github.com/steveseguin/electroncapture
cd electroncapture
npm install
npm run build:rpi
```
You should get a `.deb` file in the dist file with this option. If you install the deb file, it should appear in the Raspbian start menu, under `Other -> ElectronCapture`

This will probably file if you do not disable the GPU / hardware-acceration within the Electron Capture app first, but who knows -- maybe you can get it working?

## Building from source on Windows

You'll also need nodejs and npm installed. 

If on Windows, you can find the NPM/Nodejs install files here: https://nodejs.org/en/download/current/

and then to get the source code for Electron Capture,

```
git clone https://github.com/steveseguin/electroncapture.git
cd electroncapture
```

To just run the app from source without building, you can:
```
npm install
npm start
```

If you get an error about node versions, you can install the required version with something like this:

```
npm install -g node@14.6.0
npm install
npm run build:win32
```
### Building the app from source on macOS :

* For Mac, please also see this issue for building: https://github.com/electron-userland/electron-builder/issues/3828

The basic idea is is to first install node, npm, and git.  Then to clone and build the folder:

```
git clone https://github.com/steveseguin/electroncapture.git
cd electroncapture
npm install -g node@14.6.0
npm install
npm run build:darwin
```

If you need to sign the build, for distribution, you can then try:
```
npm install
export appleId={yourApp@dev.email}
export appleIdPassword={app-specific-password-here}
sudo -E npm run build:darwin
```

### Trouble-shooting  -- if can't hide cursor when window capturing using OBS:
Change the capture method in OBS to "BitBlt"and uncheck the Capture Cursor. Also make sure OBS runs in compatibility mode for win 7, so you don't get a black screen

![image](https://user-images.githubusercontent.com/2575698/126881460-1d8fe840-6ec4-4c35-bde2-fc6db5a9ae30.png)

![image](https://user-images.githubusercontent.com/2575698/126881462-b6916972-aa46-41bd-be01-54e3c2a58906.png)

Adding &nocursor to VDO.Ninja will hide the cursor in that browser window, but that often isn't enough. If the above fails, make sure you are window capturing with OBS using the same display adapter for both OBS and the Electron window.

Lastly, if that still doesn't help, you can try Windows + Tab (on windows), and host the Electron Capture app on the secondary windows desktop. Window+Tab back to the main one and select the window then.  You may need to toggle between the two desktops after selecting the window to capture, to get it to show in OBS, but it is one way of hiding the mouse.

You can also drag the Electron Capture far off screen, so the cursor can't approach it really.


##### Issues with dependencies when compiling

Sometimes a dependency won't update to the value stated in the package.json.

This option might be able to update the package.json to the newest version of dependencies automatically, 
```
npx npm-check-updates -u
npm install
```
Seems to work with newer npm versions


### Advanced encoder controls (optional)

These tweaks are entirely optional and aimed at advanced workflows. By default Electron Capture:

- Prefers hardware encoding through Media Foundation on Windows (NVENC) while leaving the newer Chromium D3D12 encoder disabled unless opted in.
- Enables `PlatformHEVCEncoderSupport` so HEVC/H.265 hardware encode is available when the operating system exposes it.
- Falls back to software automatically when alpha channels, 10‑bit color, or unsupported codecs are requested.

#### CLI switches

```
--encmode=<hardware|software|auto>   # default hardware; switch to software to disable GPU encode or auto to let the renderer decide
--d3d12enc                           # opt-in to Chromium’s D3D12 Video Encode Accelerator (off by default)
--vaapienc                           # toggle VA-API hardware encode on Linux (enabled by default)
--webrtcCodec=<auto|h264|vp9|av1>    # optional codec hint exposed to the renderer for custom scripts
--webrtcBr=<bits-per-second>         # optional bitrate hint exposed to the renderer (0 leaves Chromium defaults)
--ignoregpub                         # ignore Chromium’s GPU blocklist (default is to respect it)
--gpuinfo                            # open a chrome://gpu diagnostics window on launch
--h264keytrial                       # enable the WebRTC H.264 SPS/PPS keyframe workaround (off by default)
```

Pass these on the command line or embed them in electroncapture:// links (for example `...&encmode=software` or `...&h264keytrial=1`).

Codec and bitrate hints are only surfaced through the renderer API; Electron Capture no longer overrides WebRTC settings on your behalf, so VDO.Ninja can manage them natively.

#### In-app console helpers

Inside any renderer window you can use `window.electronCaptureEncoder` to inspect or adjust the current session:

```js
window.electronCaptureEncoder.getState();             // returns { defaultMode, preferredMode, codecPreference, maxBitrate }
window.electronCaptureEncoder.setPreferredMode('software'); // flip hardware/software/auto at runtime
window.electronCaptureEncoder.resetPreferredMode();  // revert to the CLI default
window.electronCaptureEncoder.openGpuDiagnostics();  // open chrome://gpu from within Electron
```

Use the preferred mode helper to toggle hardware acceleration without restarting the app, or check the GPU diagnostics window to confirm whether `mf_video_encode` (Media Foundation / NVENC) is active.


### Custom Electron Build Features (v39.2.7+)

> **⚠️ WINDOWS ONLY**: The Windows build uses a custom-patched Electron with enhanced WebRTC capabilities. These features are compiled into the Electron binary and **only work on the Windows custom build**. Mac and Linux use official Electron releases without these patches.

#### 1. QP-Cap Patches (ON by Default - Windows Only)

**✅ Enabled automatically** - no configuration needed.

**What it does**: Limits the maximum quantizer parameter (QP) to 20 instead of the default 51-58. Lower QP = higher quality, less compression artifacts.

**Why it's great for professional use**: Standard WebRTC was designed for video calls, not broadcast - it aggressively compresses video to save bandwidth, causing visible quality loss. This patch forces near-lossless encoding, which is essential for:
- **Screen sharing** - text stays crisp and readable
- **Pixel art / retro games** - no smearing or block artifacts
- **Color-critical work** - gradients stay smooth, no banding
- **Professional broadcasts** - broadcast-quality output over WebRTC

**Affected codecs**: H.264, H.265/HEVC, VP8, VP9, AV1 (all benefit automatically)

**How to verify**: Use `chrome://webrtc-internals` and look for `googQpSum` in the stats - values should stay low (under 25).

#### 2. NVENC Hardware Encoding (ON by Default - Windows Only)

**✅ Enabled automatically** - uses your NVIDIA GPU when available.

**What it does**: Enables NVIDIA GPU hardware encoding through FFmpeg's NVENC support for H.264, H.265/HEVC, and AV1.

**Why it's great for professional use**:
- **Lower CPU usage** - encoding offloaded to GPU, freeing CPU for other tasks
- **Better multi-stream performance** - encode multiple streams without CPU bottleneck
- **Consistent quality** - hardware encoders maintain steady performance under load
- **Cooler, quieter system** - less CPU heat during long streaming sessions

**Requirements**: NVIDIA GPU with NVENC support (GTX 600 series or newer). The `nvEncodeAPI64.dll` is included in the release.

**How to verify**: Check `chrome://gpu` for "Video Encode" acceleration status, or monitor GPU usage during encoding.

> **💡 HEVC/H.265 Support**: Electron Capture supports HEVC/H.265 hardware encoding, which OBS Browser Source does not support as of December 2025. This gives Electron Capture an advantage for high-quality, low-bandwidth streaming scenarios where HEVC's superior compression is beneficial.

#### 3. Adaptive Scaling Controls (Windows Only)

**What it does**: Controls WebRTC's `DegradationPreference` which determines how video quality adapts under CPU/network stress.

**Why it matters**: By default, WebRTC will automatically reduce resolution (1080p → 720p) or framerate (60fps → 30fps) when your system is under load. For professional streaming where quality is paramount, you may want to disable this behavior.

**Available Modes**:

| Mode | CLI Flag | Resolution | Framerate | Use Case |
|------|----------|------------|-----------|----------|
| BALANCED (default) | *(none)* | Can drop | Can drop | General use, adapts to conditions |
| DISABLED | `--disableAdaptiveScaling` | Locked | Locked | Maximum quality, good hardware required |
| MAINTAIN_RESOLUTION | `--lockResolution` | Locked | Can drop | Prioritize sharpness over smoothness |
| MAINTAIN_FRAMERATE | `--lockFramerate` | Can drop | Locked | Prioritize smoothness over sharpness |

**Examples**:
```bash
# DISABLED - Lock both resolution AND framerate (maximum quality)
elecap.exe --disableAdaptiveScaling --url="https://vdo.ninja/..."

# MAINTAIN_RESOLUTION - Keep resolution sharp, allow framerate to drop if needed
elecap.exe --lockResolution --url="https://vdo.ninja/..."

# MAINTAIN_FRAMERATE - Keep smooth motion, allow resolution to drop if needed
elecap.exe --lockFramerate --url="https://vdo.ninja/..."
```

**Trade-offs**:
- `--disableAdaptiveScaling`: May cause frame drops or stuttering if CPU/network can't keep up
- `--lockResolution`: Video stays sharp but may stutter under load
- `--lockFramerate`: Video stays smooth but may get blurry under load

#### 4. Cursor Suppression (Windows Only)

**What it does**: Hides the mouse cursor from screen capture streams.

**Why it matters**: When sharing your screen for presentations or tutorials, you may want the cursor visible locally but hidden from viewers.

**CLI Option**:
```bash
# Enable cursor suppression for all screen captures
elecap.exe --hideCursorCapture --url="https://vdo.ninja/..."
```

**JavaScript API** (can be used even without the CLI flag):
```js
// Hide cursor in capture
const stream = await navigator.mediaDevices.getDisplayMedia({
  video: { cursor: 'never' }
});

// Other options: 'always' (default), 'motion' (hide when stationary)
```

#### 5. Extended Playout Delay (Windows Only)

**What it does**: Increases maximum receiver buffer from 10 seconds to 10 minutes (600 seconds).

**Why it matters**: For professional streaming over unreliable networks, a larger buffer allows better packet loss recovery - similar to how SRT or RTMP handle poor connections. Standard WebRTC is optimized for low-latency video calls, not high-latency broadcast scenarios.

**Improvements in this patch**:
- Frame buffer: 800 → 7,200 frames (2 min @ 60fps)
- NACK history: 1 second → 2 minutes
- Maximum delay: 10 seconds → 10 minutes

**CLI Option**:
```bash
# Set default 30-second buffer for all incoming streams
elecap.exe --playoutDelay=30 --url="https://vdo.ninja/..."

# For longer buffers (e.g., satellite uplinks)
elecap.exe --playoutDelay=120 --url="https://vdo.ninja/..."
```

**JavaScript API** (on the receiver side):
```js
// Set buffer directly on RTCRtpReceiver
receiver.playoutDelayHint = 120; // 2 minute buffer

// Or use the Electron helper
window.electronApi.applyPlayoutDelay(receiver, 60); // 60 seconds
```

**Trade-off**: Higher playout delay = more latency. A 30-second buffer means 30 seconds of delay before video appears.

#### JavaScript API Summary

Access all capture preferences programmatically:

```js
// Get all preferences
window.electronApi.getCapturePreferences();
// Returns: { hideCursorCapture, playoutDelay, disableAdaptiveScaling, lockResolution, lockFramerate }

// Individual checks
window.electronApi.isCursorSuppressionEnabled();  // true/false
window.electronApi.isAdaptiveScalingDisabled();   // true/false
window.electronApi.getPlayoutDelay();             // number (seconds)

// Apply playout delay to an RTCRtpReceiver
window.electronApi.applyPlayoutDelay(rtcRtpReceiver, 30);
```

#### Feature Availability Summary

| Feature | Windows | Mac | Linux | Requires CLI Flag |
|---------|---------|-----|-------|-------------------|
| QP-Cap (quality lock) | ✅ | ❌ | ❌ | No (automatic) |
| NVENC encoding | ✅ | ❌ | ❌ | No (automatic) |
| Adaptive scaling control | ✅ | ❌ | ❌ | Yes |
| Cursor suppression | ✅ | ❌ | ❌ | Optional |
| Extended playout delay | ✅ | ❌ | ❌ | Optional |
| ASIO audio capture | ✅ | ❌ | ❌ | --node |


### Security considerations

The Electron Capture doesn't auto-update. This is partially because a stable browser with expected and tested outcomes is important for live streaming. Browsers that auto-update are not reliable, and introduce unexpected issues, month to month.

However, security vulnerabilities constantly appear in the browser world, making older unpatched versions a security hazard.

While I try to release builds of the Electron Capture app that are within a version or two of the newest Chromium stable release, you still will need to manually update to them. And if I do not provide them, you can build them yourself, via updating the package.json file with the target version of the electron.js framework that you wish to use.

Using Electron Capture should still be relatively safe if using it only on trusted domains, not opening unknown links with it, and not using it as a general browser for surfing the greater web with.

Please understand the security implications of using the Electron Capture app, as although it's very powerful, using it improperly can get you hurt.

### Thank you

"Electron capture is one process that unstable atoms can use to become more stable. " - https://education.jlab.org/glossary/electroncapture.html
