@TITLE Run program with SwiftShader as unique Vulkan driver
@set "CD="
@cd /d "%~dp0"
@cd ..
@set swiftshaderdir=%CD%

:runprogloop
@echo ATTENTION: Some programs may intentionally ignore CPU type Vulkan devices (ex: PPSSPP PSP emulator), but it may still be possible to use SwiftShader by force selecting Vulkan API on a case by case basis, usually by tweaking configuration files of such programs.
@echo.
@set "progexe="
@set /p progexe=Drag and drop program executable, program launcher script or shortcut:
@IF NOT defined progexe (
@cls
@GOTO runprogloop
)
@IF NOT EXIST %progexe% (
@cls
@GOTO runprogloop
)
@IF /I %PROCESSOR_ARCHITECTURE%==AMD64 set VK_ICD_FILENAMES=%swiftshaderdir%\x64\bin\vk_swiftshader_icd.json;%swiftshaderdir%\x86\bin\vk_swiftshader_icd.json
@IF /I %PROCESSOR_ARCHITECTURE%==x86 set VK_ICD_FILENAMES=%swiftshaderdir%\x86\bin\vk_swiftshader_icd.json
@set progdir=%progexe%
@IF %progdir:~0,1%%progdir:~-1%=="" set progdir=%progdir:~1,-1%

:getprogdir
@IF "%progdir:~-1%"=="\" GOTO doneprog
@set progdir=%progdir:~0,-1%
@GOTO getprogdir

:doneprog
@set progdir=%progdir:~0,-1%
@cd /D "%progdir%"
@call %progexe%
@cls
@GOTO runprogloop