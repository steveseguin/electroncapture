@cd /d "%~dp0"
@TITLE Google SwiftShader setup utility
@echo Welcome to SwiftShader setup utility
@echo ------------------------------------
@echo This utility purpose is to make Google SwiftShader usage easier.
@echo.
@echo Press any key to begin...
@pause>nul
@cls

@rem Check if Vulkan runtime is available
@set detectvk=0
@IF /I %PROCESSOR_ARCHITECTURE%==AMD64 IF EXIST "%windir%\system32\vulkan-1.dll" IF EXIST "%windir%\syswow64\vulkan-1.dll" set detectvk=1
@IF /I %PROCESSOR_ARCHITECTURE%==x86 IF EXIST "%windir%\system32\vulkan-1.dll" set detectvk=1

@rem Get access rights
@set adminrights=1
@CMD /C EXIT 0
@"%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system" >nul 2>&1
@if NOT "%ERRORLEVEL%"=="0" set adminrights=0

@rem Compute menu length for all cases
@IF %detectvk%==1 IF %adminrights%==1 set menulength=1
@IF %detectvk%==1 IF %adminrights%==0 set menulength=2
@IF %detectvk%==0 set menulength=0

@rem Quit if menu length is 0
@IF %menulength% EQU 0 (
@echo Vulkan runtime is required. Download it from https://vulkan.lunarg.com/sdk/home#windows
@echo.
@pause
@exit
)

:mainmenu
@echo Main Menu
@echo ---------
@IF %detectvk%==1 echo 1. Run programs with SwiftShader as the only Vulkan driver*
@IF %detectvk%==1 IF %adminrights%==0 echo 2. Run programs as admin with SwiftShader as the only Vulkan driver*
@IF %detectvk%==1 echo.
@IF %detectvk%==1 echo *Some programs may intentionally ignore CPU type Vulkan devices (ex: PPSSPP PSP emulator), but it may still be possible to use SwiftShader by force selecting Vulkan API on a case by case basis, usually by tweaking configuration files of such programs.
@IF %detectvk%==1 echo.
@IF %menulength% GTR 0 set /p choice=Enter choice:
@IF %menulength% GTR 0 echo.
@IF "%choice%"=="" (
@echo Invalid input.
@echo.
@pause
@cls
@GOTO mainmenu
)
@IF %choice% LEQ 0 (
@echo Invalid input.
@echo.
@pause
@cls
@GOTO mainmenu
)
@IF %choice% GTR %menulength% (
@echo Invalid input.
@echo.
@pause
@cls
@GOTO mainmenu
)
@IF %detectvk%==1 IF %choice%==1 start modules\runprogramswiftshadervk.cmd
@IF %detectvk%==1 IF %adminrights%==0 IF %choice%==2 powershell -Command Start-Process ""modules\runprogramswiftshadervk.cmd"" -Verb runAs 2>nul
@cls
@GOTO mainmenu