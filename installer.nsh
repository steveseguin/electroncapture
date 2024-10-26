!macro customInstall
	ReadEnvStr $0 "PATH"
	FileOpen $1 "$INSTDIR\path_backup.txt" w
	FileWrite $1 "$0$\r$\n"
	FileClose $1
	
	SetOutPath $INSTDIR
	StrCpy $1 "$0;$INSTDIR"
	WriteRegExpandStr HKCU "Environment" "PATH" $1
	SendMessage ${HWND_BROADCAST} ${WM_WININICHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend