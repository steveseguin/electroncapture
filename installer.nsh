!macro customInstall
    ReadEnvStr $0 "PATH"
    FileOpen $1 "$INSTDIR\path_backup.txt" a
    FileWrite $1 "$0$\r$\n"
    FileClose $1

    StrLen $3 "$INSTDIR"

    ; Check if path exists
    StrCpy $2 "$0"
    SearchPath:
        StrCmp "$2" "" NotFound
        StrCpy $4 "$2" $3 
        StrCmp "$4" "$INSTDIR" Found
        StrCpy $2 "$2" "" 1 
        Goto SearchPath

    Found:
        StrCpy $1 "$0"
        Goto Done

    NotFound:
        StrCmp "$0" "" EmptyPath
        StrCpy $1 "$0;$INSTDIR"
        Goto Done

    EmptyPath:
        StrCpy $1 "$INSTDIR"

    Done:
        WriteRegExpandStr HKCU "Environment" "PATH" $1
        SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend