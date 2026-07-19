!include "nsDialogs.nsh"

!define ELECAP_REG_KEY "Software\ElectronCapture"
!define ELECAP_PATH_HELPER_TARGET "$INSTDIR\resources\installer-user-path.ps1"

!ifndef BUILD_UNINSTALLER

Var AddToPathCheckbox
Var AddToPathSelection

!macro customInit
    ; PATH changes are opt-in. Preserve the choice only when this installer manages an existing entry.
    StrCpy $AddToPathSelection 0
    ClearErrors
    ReadRegStr $0 HKCU "${ELECAP_REG_KEY}" "PathEntry"
    IfErrors 0 +2
        StrCpy $0 ""
    StrCmp $0 "" +2 0
        StrCpy $AddToPathSelection 1
!macroend

!macro customPageAfterChangeDir
    Page custom AddToPathPageCreate AddToPathPageLeave
!macroend

Function AddToPathPageCreate
    nsDialogs::Create 1018
    Pop $0
    StrCmp $0 error 0 +2
        Abort

    ${NSD_CreateLabel} 0 0 100% 24u "Optional setup step: make Electron Capture available from Command Prompt and PowerShell."
    Pop $0

    ${NSD_CreateCheckbox} 0 32u 100% 12u "Add the install directory to my user PATH"
    Pop $AddToPathCheckbox
    ${NSD_SetState} $AddToPathCheckbox $AddToPathSelection

    ${NSD_CreateLabel} 0 54u 100% 28u "This allows you to run elecap from a new terminal. The entry is removed when you uninstall."
    Pop $0

    nsDialogs::Show
FunctionEnd

Function AddToPathPageLeave
    ${NSD_GetState} $AddToPathCheckbox $AddToPathSelection
FunctionEnd

!macro AddPathHelperFile
    Push $0
    StrCpy $0 $OUTDIR
    SetOutPath "$INSTDIR\resources"
    File "/oname=installer-user-path.ps1" "${PROJECT_DIR}\scripts\installer-user-path.ps1"
    SetOutPath "$0"
    Pop $0
!macroend

!macro customFiles_x64
    !insertmacro AddPathHelperFile
!macroend

!macro customFiles_ia32
    !insertmacro AddPathHelperFile
!macroend

!macro customFiles_arm64
    !insertmacro AddPathHelperFile
!macroend

Function RunPathHelper
    Exch $0
    Push $1
    Push $2

    StrCpy $1 "${ELECAP_PATH_HELPER_TARGET}"
    IfFileExists "$1" 0 missing_helper
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$1" -Mode $0 -InstallDir "$INSTDIR" -Selected "$AddToPathSelection"' $2
    Goto cleanup

    missing_helper:
        StrCpy $2 1

    cleanup:
    Pop $2
    Pop $1
    Pop $0
FunctionEnd

!macro customInstall
    IfSilent 0 +6
    ClearErrors
    ReadRegStr $0 HKCU "${ELECAP_REG_KEY}" "PathEntry"
    IfErrors 0 +2
        StrCpy $0 ""
    StrCmp $0 "" +2 0
        StrCpy $AddToPathSelection 1
    Push "install"
    Call RunPathHelper
!macroend

!else

Function un.RunPathHelper
    Exch $0
    Push $1
    Push $2

    StrCpy $1 "${ELECAP_PATH_HELPER_TARGET}"
    IfFileExists "$1" 0 missing_helper
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$1" -Mode $0 -InstallDir "$INSTDIR" -Selected "0"' $2
    Goto cleanup

    missing_helper:
        StrCpy $2 1

    cleanup:
    Pop $2
    Pop $1
    Pop $0
FunctionEnd

!macro customUnInstall
    Push "uninstall"
    Call un.RunPathHelper
!macroend

!endif
