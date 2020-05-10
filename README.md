Prototype for the OBS.Ninja desktop app. It's designed to be a viewer for remote streams that is "Window Capture" friendly, as it is frameless and uses the newest version of Chromium.  Default frameless resolution is 1280x720.

Links to downloads below.

Top 1" of the window can be used to drag the window around. You can also right click the top 1" of the window to get a menu to minimize, fullscreen, and close.  Options to "reload" and "load a camera" are coming.

I don't know exactly how much value this will have for everyone, but if Browser Source isn't working for you in OBS, this is perhaps an option. Audio Capture will still require some desktop capture audio tool.

note: If you rename the file executable to the name of the streamID, it will auto-load that streamID, ready to play. This could be helpful with streamlining the setup and reloading process.

## Windows Build
https://obs.ninja/alpha/OBSNinja.exe

## Mac Build
https://obs.ninja/alpha/OBS.Ninja.Desktop.App-1.0.1.pkg

## Linux Build
(likely best to build it yourself?)


## Running
In order to run locally type the following:

```
npm install
npm start
```

## Building
Building does not support cross-compiling. In order to build you must be logged in to a host having the target OS for the build. Once logged in, type the following:

```
npm install
npm run build
```

* For Mac, please also see this issue for building: https://github.com/electron-userland/electron-builder/issues/3828


"Electron capture is one process that unstable atoms can use to become more stable. " - https://education.jlab.org/glossary/electroncapture.html



![image](https://user-images.githubusercontent.com/2575698/80891669-8eacec80-8c93-11ea-8166-0ce6de83c5d0.png)

![example](https://github.com/steveseguin/electroncapture/raw/master/example.jpg)

![image](https://user-images.githubusercontent.com/2575698/80891745-290d3000-8c94-11ea-85c4-ae0e7cd1ec19.png)
