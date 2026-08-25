!ifndef AKA_AGENT_INSTALLER_NSH_INCLUDED
!define AKA_AGENT_INSTALLER_NSH_INCLUDED

# These hooks implement the akaAgent desktop upgrade contract. Electron Builder
# also auto-loads this file for the Zalo Server package, so keep every custom
# macro compile-time scoped to the desktop product.
!if "${PRODUCT_NAME}" == "akaAgent"

!include FileFunc.nsh
!include getProcessInfo.nsh
!include LogicLib.nsh

!ifndef BUILD_UNINSTALLER
  # electron-builder normally defines this support only when no custom app
  # running check exists. Keep its standard process-closing behavior, then mark
  # the point after which cancelling would leave a partially replaced binary.
  Var pid
  Var akaInstallCommitStarted
  Var akaInstallLogHandle
  Var akaInstallSourceHandled
  Var akaInstallSourcePid
  !define MUI_CUSTOMFUNCTION_ABORT akaGuardInstallAbort

  !macro akaWriteInstallLog MESSAGE
    ClearErrors
    FileOpen $akaInstallLogHandle "$TEMP\akaAgent-installer.log" a
    ${IfNot} ${Errors}
      FileWrite $akaInstallLogHandle "${MESSAGE}$\r$\n"
      FileClose $akaInstallLogHandle
    ${EndIf}
    ClearErrors
  !macroend

  # A fixed akaAgent updater passes its exact main-process PID. Setup never
  # terminates by image name in that flow; it only waits for the application,
  # which has already started its own asynchronous graceful quit.
  !macro akaWaitForUpdateSourceProcess
    StrCpy $akaInstallSourceHandled "0"
    StrCpy $akaInstallSourcePid ""
    ${GetParameters} $R0
    ${GetOptions} $R0 "--aka-source-pid=" $akaInstallSourcePid

    ${If} $akaInstallSourcePid == ""
      !insertmacro akaWriteInstallLog `No update source PID was supplied; using the manual installer guard.`
      Goto akaSourceWaitDone
    ${EndIf}

    ${GetProcessInfo} 0 $R5 $R0 $R1 $R2 $R3
    ${If} $akaInstallSourcePid == $R5
      !insertmacro akaWriteInstallLog `Rejected update source PID because it equals the installer PID.`
      Goto akaSourceWaitDone
    ${EndIf}

    ${GetProcessInfo} $akaInstallSourcePid $R0 $R1 $R2 $R3 $R4
    ${If} $R0 == ""
      StrCpy $akaInstallSourceHandled "1"
      !insertmacro akaWriteInstallLog `Update source PID $akaInstallSourcePid has already exited.`
      Goto akaSourceWaitDone
    ${EndIf}
    ${If} $R3 != "${APP_EXECUTABLE_FILENAME}"
      !insertmacro akaWriteInstallLog `Rejected update source PID $akaInstallSourcePid because its image is $R3.`
      Goto akaSourceWaitDone
    ${EndIf}

    StrCpy $akaInstallSourceHandled "1"
    !insertmacro akaWriteInstallLog `Waiting only for akaAgent source PID $akaInstallSourcePid at $R4.`

  akaSourceWaitOpen:
    System::Call 'kernel32::OpenProcess(i 0x00100000, i 0, i $akaInstallSourcePid) p.R5'
    ${If} $R5 == 0
      !insertmacro akaWriteInstallLog `Source PID $akaInstallSourcePid is no longer running.`
      Goto akaSourceWaitDone
    ${EndIf}

    StrCpy $R6 0
  akaSourceWaitPoll:
    System::Call 'kernel32::WaitForSingleObject(p R5, i 0) i.R7'
    ${If} $R7 == 0
      System::Call 'kernel32::CloseHandle(p R5)'
      !insertmacro akaWriteInstallLog `Source PID $akaInstallSourcePid exited normally.`
      Goto akaSourceWaitDone
    ${EndIf}
    ${If} $R7 != 258
      System::Call 'kernel32::CloseHandle(p R5)'
      !insertmacro akaWriteInstallLog `WaitForSingleObject failed for source PID $akaInstallSourcePid with code $R7.`
      Goto akaSourceWaitRetry
    ${EndIf}

    Sleep 250
    IntOp $R6 $R6 + 1
    ${If} $R6 < 40
      Goto akaSourceWaitPoll
    ${EndIf}

    System::Call 'kernel32::CloseHandle(p R5)'
    !insertmacro akaWriteInstallLog `Source PID $akaInstallSourcePid did not finish cleanup within 10 seconds.`

  akaSourceWaitRetry:
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "akaAgent chua thoat hoan tat.$\nVui long cho ung dung dong, sau do nhan Retry." /SD IDCANCEL IDRETRY akaSourceWaitOpen
    Quit

  akaSourceWaitDone:
  !macroend

  # Legacy clients cannot pass a source PID. Their old executable name is
  # distinct from this akaAgent Setup, so retain the old OK-equivalent close
  # action only for akaBizAuto.exe.
  !macro akaCloseIfRunning PROCESS_FILE DISPLAY_NAME LABEL_PREFIX
    !insertmacro FIND_PROCESS "${PROCESS_FILE}" $R0
    ${If} $R0 != 0
      Goto ${LABEL_PREFIX}NotRunning
    ${EndIf}

    ${LABEL_PREFIX}Stop:
      DetailPrint `Closing "${PROCESS_FILE}"...`
      !insertmacro akaWriteInstallLog `Requesting ${PROCESS_FILE} to close with elevated taskkill.exe.`
      nsExec::Exec `"$SYSDIR\taskkill.exe" /IM "${PROCESS_FILE}"`
      Pop $R1
      !insertmacro akaWriteInstallLog `taskkill.exe for ${PROCESS_FILE} exited with code $R1.`

      StrCpy $R2 0
    ${LABEL_PREFIX}Wait:
      Sleep 250
      !insertmacro FIND_PROCESS "${PROCESS_FILE}" $R0
      ${If} $R0 != 0
        Goto ${LABEL_PREFIX}Closed
      ${EndIf}
      IntOp $R2 $R2 + 1
      ${If} $R2 < 40
        Goto ${LABEL_PREFIX}Wait
      ${EndIf}

      !insertmacro akaWriteInstallLog `${PROCESS_FILE} is still running after the normal close request.`
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Khong the tat ${DISPLAY_NAME}.$\nVui long tat ung dung thu cong, sau do nhan Retry." /SD IDCANCEL IDRETRY ${LABEL_PREFIX}Stop
      Quit

    ${LABEL_PREFIX}Closed:
      !insertmacro akaWriteInstallLog `${PROCESS_FILE} closed normally; continuing installation.`

    ${LABEL_PREFIX}NotRunning:
  !macroend

  !macro customCheckAppRunning
    Delete "$TEMP\akaAgent-installer.log"
    !insertmacro akaWriteInstallLog `Install section started.`
    !insertmacro akaWaitForUpdateSourceProcess
    ${If} $akaInstallSourceHandled != "1"
      # Legacy updaters save the downloaded Setup itself as akaAgent.exe. In
      # that case an image-name guard would find and terminate this installer.
      ${GetProcessInfo} 0 $R0 $R1 $R2 $R3 $R4
      ${If} $R3 == "${APP_EXECUTABLE_FILENAME}"
        !insertmacro akaWriteInstallLog `Skipped akaAgent image-name guard because the installer itself is $R3 at $R4.`
      ${Else}
        !insertmacro akaWriteInstallLog `Manual Setup image is $R3; applying the standard akaAgent running-app guard.`
        !insertmacro _CHECK_APP_RUNNING
      ${EndIf}
    ${EndIf}
    !insertmacro akaCloseIfRunning "akaBizAuto.exe" "akaBizAuto" akaLegacy
    StrCpy $akaInstallCommitStarted "1"
    !insertmacro akaWriteInstallLog `Running-app guard completed; replacing application files.`
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
  !insertmacro akaWriteInstallLog `Installation completed successfully.`
!macroend

!endif
!endif
