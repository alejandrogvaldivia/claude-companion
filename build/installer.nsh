; Al desinstalar: quitar los hooks de Claude Code y el inicio con Windows (lo hace la propia app)
!macro customUnInstall
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall'
!macroend
