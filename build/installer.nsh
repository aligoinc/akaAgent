!ifndef AKA_AGENT_INSTALLER_NSH_INCLUDED
!define AKA_AGENT_INSTALLER_NSH_INCLUDED

!include LogicLib.nsh

!macro akaDeleteInstallRegistry ROOT_KEY
  DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}"
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY_2}"
  !endif
  DeleteRegKey ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}"
!macroend

!macro akaDeleteShortcut LINK_PATH
  WinShell::UninstShortcut "${LINK_PATH}"
  Delete "${LINK_PATH}"
  ClearErrors
!macroend

!macro akaDeleteLegacyShortcuts ROOT_KEY
  ClearErrors
  ReadRegStr $R8 ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" ShortcutName
  ReadRegStr $R9 ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" MenuDirectory

  ${if} $R8 != ""
  ${andIf} $R8 != "akaBizAuto"
    !insertmacro akaDeleteShortcut "$DESKTOP\$R8.lnk"
    ${if} $R9 == ""
      !insertmacro akaDeleteShortcut "$SMPROGRAMS\$R8.lnk"
    ${else}
      !insertmacro akaDeleteShortcut "$SMPROGRAMS\$R9\$R8.lnk"
    ${endif}
  ${endif}

  !insertmacro akaDeleteShortcut "$DESKTOP\akaAgent.lnk"
  !insertmacro akaDeleteShortcut "$SMPROGRAMS\akaAgent.lnk"
  !insertmacro akaDeleteShortcut "$SMPROGRAMS\akaAgent\akaAgent.lnk"
  !insertmacro akaDeleteShortcut "$SMPROGRAMS\akaBizAuto\akaAgent.lnk"
  RMDir "$SMPROGRAMS\akaAgent"
  ClearErrors
!macroend

!macro akaCleanupRegistryInstallDir ROOT_KEY
  ClearErrors
  ReadRegStr $R9 ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $R9 != ""
    !insertmacro akaRemoveInstallDirBestEffort $R9
  ${endif}
  !insertmacro akaDeleteInstallRegistry ${ROOT_KEY}
  ClearErrors
!macroend

!macro akaScheduleKnownFilesForRemoval TARGET_DIR
  Delete /REBOOTOK "${TARGET_DIR}\${APP_EXECUTABLE_FILENAME}"
  Delete /REBOOTOK "${TARGET_DIR}\akaAgent.exe"
  Delete /REBOOTOK "${TARGET_DIR}\akaBizAuto.exe"
  Delete /REBOOTOK "${TARGET_DIR}\${UNINSTALL_FILENAME}"
  Delete /REBOOTOK "${TARGET_DIR}\Uninstall akaAgent.exe"
  Delete /REBOOTOK "${TARGET_DIR}\Uninstall akaBizAuto.exe"

  Delete /REBOOTOK "${TARGET_DIR}\chrome_100_percent.pak"
  Delete /REBOOTOK "${TARGET_DIR}\chrome_200_percent.pak"
  Delete /REBOOTOK "${TARGET_DIR}\d3dcompiler_47.dll"
  Delete /REBOOTOK "${TARGET_DIR}\ffmpeg.dll"
  Delete /REBOOTOK "${TARGET_DIR}\icudtl.dat"
  Delete /REBOOTOK "${TARGET_DIR}\libEGL.dll"
  Delete /REBOOTOK "${TARGET_DIR}\libGLESv2.dll"
  Delete /REBOOTOK "${TARGET_DIR}\resources.pak"
  Delete /REBOOTOK "${TARGET_DIR}\snapshot_blob.bin"
  Delete /REBOOTOK "${TARGET_DIR}\v8_context_snapshot.bin"
  Delete /REBOOTOK "${TARGET_DIR}\vk_swiftshader.dll"
  Delete /REBOOTOK "${TARGET_DIR}\vk_swiftshader_icd.json"
  Delete /REBOOTOK "${TARGET_DIR}\vulkan-1.dll"

  Delete /REBOOTOK "${TARGET_DIR}\resources\app.asar"
  Delete /REBOOTOK "${TARGET_DIR}\resources\elevate.exe"
  Delete /REBOOTOK "${TARGET_DIR}\resources\version.txt"
  Delete /REBOOTOK "${TARGET_DIR}\locales\*.pak"
!macroend

!macro akaRemoveInstallDirBestEffort TARGET_DIR
  ${if} "${TARGET_DIR}" == ""
    DetailPrint "akaAgent cleanup: install folder is empty, skipping file cleanup."
  ${elseif} ${FileExists} "${TARGET_DIR}\${APP_EXECUTABLE_FILENAME}"
  ${orIf} ${FileExists} "${TARGET_DIR}\${UNINSTALL_FILENAME}"
  ${orIf} ${FileExists} "${TARGET_DIR}\akaAgent.exe"
  ${orIf} ${FileExists} "${TARGET_DIR}\akaBizAuto.exe"
  ${orIf} ${FileExists} "${TARGET_DIR}\Uninstall akaAgent.exe"
  ${orIf} ${FileExists} "${TARGET_DIR}\Uninstall akaBizAuto.exe"
  ${orIf} ${FileExists} "${TARGET_DIR}\resources\app.asar"
    DetailPrint "akaAgent cleanup: removing old install folder ${TARGET_DIR}."
    ClearErrors
    RMDir /r "${TARGET_DIR}"

    ${if} ${Errors}
      DetailPrint "akaAgent cleanup: old install folder was only partially removed; scheduling known files for deletion after reboot."
      ClearErrors
      !insertmacro akaScheduleKnownFilesForRemoval ${TARGET_DIR}
      RMDir "${TARGET_DIR}\locales"
      RMDir "${TARGET_DIR}\resources"
      RMDir "${TARGET_DIR}"
      ClearErrors
    ${endif}
  ${else}
    DetailPrint "akaAgent cleanup: ${TARGET_DIR} does not look like an akaAgent install folder, skipping file cleanup."
  ${endif}

  ClearErrors
!macroend

!macro customInit
  DetailPrint "akaAgent cleanup: bypassing old uninstaller and cleaning stale install records."
  !insertmacro akaDeleteLegacyShortcuts SHELL_CONTEXT
  !insertmacro akaDeleteLegacyShortcuts HKEY_CURRENT_USER
  !insertmacro akaRemoveInstallDirBestEffort $INSTDIR
  !insertmacro akaDeleteInstallRegistry SHELL_CONTEXT
  !insertmacro akaCleanupRegistryInstallDir HKEY_CURRENT_USER
!macroend

!endif
