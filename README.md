Prototype for the OBS.Ninja desktop app. It's designed to be a viewer for remote streams that is "Window Capture" friendly, as it is frameless.

I don't know exactly how much value this will have for everyone, but if Browser Source isn't working for you in OBS, this is perhaps an option. Audio Capture will still require some desktop capture audio tool.

note: If you rename the file executable to the name of the streamID, it will auto-load that streamID, ready to play. This could be helpful with streamlining the setup and reloading process.

## Windows Build
https://obs.ninja/alpha/OBSNinja.exe

## Mac Build
(coming soon)

## Linux Build
(coming soon)


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