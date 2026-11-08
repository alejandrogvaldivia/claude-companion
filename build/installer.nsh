; Al desinstalar: quitar los hooks de Claude Code y el inicio con Windows (lo hace la propia app).
; En una ACTUALIZACIÓN también se corre el desinstalador de la versión vieja: ahí NO se quita nada.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --uninstall'
  ${endIf}
!macroend
