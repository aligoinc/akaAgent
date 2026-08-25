!ifndef AKA_AGENT_INSTALLER_NSH_INCLUDED
!define AKA_AGENT_INSTALLER_NSH_INCLUDED

# These hooks implement the akaAgent desktop upgrade contract. Electron Builder
# also auto-loads this file for the Zalo Server package, so keep every custom
# macro compile-time scoped to the desktop product.
!if "${PRODUCT_NAME}" == "akaAgent"

!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
  # electron-builder normally defines this support only when no custom app
  # running check exists. Keep its standard process-closing behavior, then mark
  # the point after which cancelling would leave a partially replaced binary.
  !include getProcessInfo.nsh
  Var pid
  Var akaInstallCommitStarted
  !define MUI_CUSTOMFUNCTION_ABORT akaGuardInstallAbort

  # Legacy clients launch Setup before their delayed app.quit(). Give the old
  # akaBizAuto.exe time to finish its asynchronous session/runtime cleanup, then
  # fall back to the same close/retry behavior as electron-builder.
  !macro akaCheckLegacyAppRunning
    StrCpy $R1 0

    akaLegacyGraceWait:
      !insertmacro FIND_PROCESS "akaBizAuto.exe" $R0
      ${If} $R0 != 0
        Goto akaLegacyNotRunning
      ${EndIf}
      ${If} $R1 >= 30
        Goto akaLegacyPrompt
      ${EndIf}
      IntOp $R1 $R1 + 1
      Sleep 500
      Goto akaLegacyGraceWait

    akaLegacyPrompt:
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "akaBizAuto dang chay.$\nNhan OK de dong ung dung cu va tiep tuc nang cap." /SD IDOK IDOK akaLegacyStop
      Quit

    akaLegacyStop:
      DetailPrint `Closing legacy "akaBizAuto.exe"...`
      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /im "akaBizAuto.exe" /fi "PID ne $pid"`
      !else
        nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /im "akaBizAuto.exe" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
      !endif
      Sleep 500
      StrCpy $R1 0

    akaLegacyCloseWait:
      !insertmacro FIND_PROCESS "akaBizAuto.exe" $R0
      ${If} $R0 != 0
        Goto akaLegacyNotRunning
      ${EndIf}
      ${If} $R1 >= 10
        Goto akaLegacyForceStop
      ${EndIf}
      IntOp $R1 $R1 + 1
      Sleep 500
      Goto akaLegacyCloseWait

    akaLegacyForceStop:
      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /f /im "akaBizAuto.exe" /fi "PID ne $pid"`
      !else
        nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "akaBizAuto.exe" /fi "PID ne $pid" /fi "USERNAME eq %USERNAME%"`
      !endif
      Sleep 500
      !insertmacro FIND_PROCESS "akaBizAuto.exe" $R0
      ${If} $R0 == 0
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Khong the dong akaBizAuto.$\nVui long dong ung dung cu thu cong, sau do nhan Retry." /SD IDCANCEL IDRETRY akaLegacyStop
        Quit
      ${EndIf}

    akaLegacyNotRunning:
  !macroend

  !macro customCheckAppRunning
    !insertmacro _CHECK_APP_RUNNING
    !insertmacro akaCheckLegacyAppRunning
    StrCpy $akaInstallCommitStarted "1"
  !macroend

  Function akaGuardInstallAbort
    ${If} $akaInstallCommitStarted == "1"
      MessageBox MB_OK|MB_ICONINFORMATION "akaAgent dang duoc thay the. Vui long cho qua trinh cai dat hoan tat."
      Abort
    ${EndIf}
  FunctionEnd
!endif

!macro akaDeleteShortcut LINK_PATH
  WinShell::UninstShortcut "${LINK_PATH}"
  Delete "${LINK_PATH}"
  ClearErrors
!macroend

!macro akaDeleteLegacyShortcuts ROOT_KEY
  # registryAddInstallInfo has already written the new akaAgent shortcut name at
  # this point. Remove only known legacy links; never touch the new shortcut.
  !insertmacro akaDeleteShortcut "$DESKTOP\akaBizAuto.lnk"
  !insertmacro akaDeleteShortcut "$SMPROGRAMS\akaBizAuto.lnk"
  !insertmacro akaDeleteShortcut "$SMPROGRAMS\akaBizAuto\akaBizAuto.lnk"
  RMDir "$SMPROGRAMS\akaBizAuto"
  ClearErrors
!macroend

!macro customInstall
  # File removal and old-version uninstall are deliberately left to
  # electron-builder after CHECK_APP_RUNNING. This hook only removes shortcut
  # names used by legacy releases, after the new application files and
  # InstallLocation have been written successfully.
  SetShellVarContext current
  !insertmacro akaDeleteLegacyShortcuts HKEY_CURRENT_USER

  SetShellVarContext all
  !insertmacro akaDeleteLegacyShortcuts HKEY_LOCAL_MACHINE

  # Never launch a package that is missing one of the unpacked dependency
  # manifests involved in the historical startup failure.
  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar"
    MessageBox MB_OK|MB_ICONSTOP "Cai dat akaAgent khong hoan tat: thieu resources\app.asar."
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar.unpacked\node_modules\better-sqlite3\package.json"
    MessageBox MB_OK|MB_ICONSTOP "Cai dat akaAgent khong hoan tat: thieu better-sqlite3."
    SetErrorLevel 2
    Abort
  ${EndIf}
  ${IfNot} ${FileExists} "$INSTDIR\resources\app.asar.unpacked\node_modules\playwright\node_modules\playwright-core\package.json"
    MessageBox MB_OK|MB_ICONSTOP "Cai dat akaAgent khong hoan tat: thieu playwright-core."
    SetErrorLevel 2
    Abort
  ${EndIf}

  # The fixed Windows installer is per-machine, so keep the shell context in
  # the mode expected by the remaining electron-builder finish-page logic.
  SetShellVarContext all
  StrCpy $akaInstallCommitStarted "0"
!macroend

!endif
!endif
