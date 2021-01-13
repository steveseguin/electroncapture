#### Update for macOS users:

If downloading this app for the purpose of OBS.Ninja on macOS, OBS v26.1.2 and newer should now support OBS.Ninja on macOS !! 😃

You may not need to use Electron Capture app anymore, although it still has its advantages and will see continued development efforts.


### This is the **Electron Capture app**,
created for <a href="https://obs.ninja">OBS.Ninja</a> users, but can be (unofficially) used with <a href='https://docs.google.com/document/d/e/2PACX-1vS3ol8Tpnu4NrqRrGjzzmcOXxocsQ7pWj3Jrb1x_essbmcC5mxRp1QFCY1LUCoVglIgF0tb2UykbFTO/pub'>Stage Ten</a> as well.
It's designed to help make "Screen Capturing" of live video using applications like OBS or Zoom easier and more reliable.

#### <a href="https://github.com/steveseguin/electroncapture#links-to-downloads-below">Jump to Downloads Section</a>

<img src="https://user-images.githubusercontent.com/2575698/91703607-74ebbb00-eb48-11ea-94d2-f205da2976b1.png " alt="" data-canonical-src="https://user-images.githubusercontent.com/2575698/91703607-74ebbb00-eb48-11ea-94d2-f205da2976b1.png"  style="display:inline-block" height="300" />

## Why ?
OBS on macOS currently doesn't support its Browser Source plugin all that well, so this tool is a viable alternative. It lets you cleanly screen-grab just a video stream without the need of the Browser Source plugin. It also makes it easy to select the output audio playback device, such as a Virtual Audio device: ie) https://rogueamoeba.com/loopback/ (macOS & non-free, but excellent) and https://existential.audio/blackhole/ (macOS & free)

The app also remains on top of other windows, attempts to hide the mouse cursor when possible, and provides accurate window sizes for 1:1 pixel mapping.

Windows users may find it beneficial too, as it offers support for OBS.Ninja's <a href="https://github.com/steveseguin/obsninja/wiki/Advanced-Settings#viewers-obs-link-options">&buffer</a> audio sync command and it has robust support for video packet loss. In other words, it can playback live video better than OBS can, with fewer video playback errors and with better audio/video sync. If you have a spare monitor, it may at times be worth the hassle to use instead of OBS alone.

The Electron Capture app uses the newest version of Chromium, which is more resistant to desync, video smearing, and other issues that might exist in the native OBS browser source capture method. [More benefits listed here](https://github.com/steveseguin/electroncapture/blob/master/BENEFITS.md)

## Video Guide (primarily for macOS users)

[![Everything Is AWESOME](https://yt-embed.herokuapp.com/embed?v=z3uDpGMzHCg)](https://www.youtube.com/watch?v=z3uDpGMzHCg "Everything Is AWESOME")

## Settings and Parameters

The default frameless resolution of the capture window is 1280x720. The app automatically accounts for high-DPI displays, so it is always 1:1 pixel-accurate with the specified resolution on even Apple Retina displays.

The optional Command Line arguments can be seen as examples below, along with their default values.

```
OBSN.exe --width 1280 --height 720 --url https://obs.ninja/electron --title "my Window name"
```
or for example
```
./OBSN -w 1280 -h 720 -u https://obs.ninja/electron -t "my Window name"
```

If running from Windows command prompt, any ampersand "&" characters will need to be escape with a "^" character, as seen below:

```
C:\Users\Steve\Desktop>obsn -t feed2 -u https://obs.ninja/?view=ePz9hnx^&scene^&codec=h264^&room=SOMETHINGTEST123
```

<img src="https://user-images.githubusercontent.com/2575698/80891745-290d3000-8c94-11ea-85c4-ae0e7cd1ec19.png " alt="" data-canonical-src="https://user-images.githubusercontent.com/2575698/80891745-290d3000-8c94-11ea-85c4-ae0e7cd1ec19.png " style="display:inline-block" height="300" />


### Audio Output 

A popular way of outputting audio from the Electron Capture app into OBS is done using a virtual audio cable. Some such cables include:

Mac Audio Options: https://github.com/steveseguin/obsninja/wiki/FAQ#macaudio
Windows Audio Option: https://www.vb-audio.com/Cable/

You can also use some advanced URL parameters to output the audio to specific channels. The following link links the parameters and the outcome, based on device/software used:
https://docs.google.com/spreadsheets/d/1R-y7xZ2BCn-GzTlwqq63H8lorXecO02DU9Hu4twuhuA/edit?usp=sharing

### Syphon Output

While there is no native Syphon or NDI output option yet available, one user has mentioned a solution for some users:
http://www.sigmasix.ch/syphoner/

### Automation Workflows with OBS.Ninja

You can see a quick start / cheat sheet guide for example uses of the app with OBS.Ninja here: https://github.com/steveseguin/obsninja/tree/quickstart#automating-obsn-start-up-currently-in-beta-only

## Notes on Using and Closing the App

#### For Windows users:

- Right click to bring up the context menu, which allows you to close the app. You can also press ALT-F4 in many cases.

#### For Mac users:

- You can hover your mouse cursor over the top-left corner of the app to show the close button.

- Also note, the top portion of the app is draggable, so you can move it around to place it accordingly. It is also resizable.

- Multiple versions of the app can run on macOS; just make a copy of the file with a different name to open up a new window.

- If capturing the window with OBS, you can use either DISPLAY CAPTURE with a WINDOW CROP  -or-  WINDOW CAPTURE

--- *WINDOW CAPTURE* will have a video delay of up to ~800ms, but Windows can be stacked without issue

--- *DISPLAY CAPTURE* will have no delay, but the windows cannot be stacked, which could be a problem if you only have one screen

# Links to downloads below.

You can find the newest release builds of the app here: https://github.com/steveseguin/electroncapture/releases  or see below.

### Windows Version
- Installs the app for easy loading from Start Menu
https://github.com/steveseguin/electroncapture/releases/download/1.1.3/obsn_win_installer.zip

- Portable version; no install needed
https://github.com/steveseguin/electroncapture/releases/download/1.1.3/obsn_win_portable.zip

### Mac Version
https://github.com/steveseguin/electroncapture/releases/download/1.1.3/obsn-1.1.3.dmg

### Linux Version
(likely best to build it yourself?)

## Building the App from Source

You'll need to download and extract the source code; or git clone it.
You'll also need npm installed.

### To run the app from source, you can:
```
npm install
npm start
```

### Building the app from source:
Building does not support cross-compiling. In order to build you must be logged in to a host having the target OS for the build. Once logged in, type the following:

```
npm install
npm run build
```

* For Mac, please also see this issue for building: https://github.com/electron-userland/electron-builder/issues/3828

And for notorization on macOS,..
```
npm install
export appleId={yourApp@dev.email}
export appleIdPassword={app-specific-password-here}
sudo -E npm run build

```


"Electron capture is one process that unstable atoms can use to become more stable. " - https://education.jlab.org/glossary/electroncapture.html


![Usage on macOS](https://user-images.githubusercontent.com/2575698/91704607-d52f2c80-eb49-11ea-9e7a-f9566a77ab94.png)
