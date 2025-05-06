@echo off
call npx node-gyp clean
call npx node-gyp configure
call npx node-gyp rebuild