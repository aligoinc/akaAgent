const { readFileSync } = require('fs')
const { join, resolve } = require('path')

const projectRoot = resolve(__dirname, '..')
const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
const installerScript = readFileSync(join(projectRoot, 'build', 'installer.nsh'), 'utf8')
const updaterSource = readFileSync(join(projectRoot, 'src', 'main', 'services', 'updater.ts'), 'utf8')
const localDbSource = readFileSync(
  join(projectRoot, 'src', 'main', 'data', 'repositories', 'localAccountContactRepository.ts'),
  'utf8'
)

const failures = []

function requireContract(condition, message) {
  if (!condition) failures.push(message)
}

const nsis = packageJson.build?.nsis || {}
requireContract(packageJson.build?.appId === 'com.akabiz.auto', 'Windows appId must stay com.akabiz.auto for upgrades.')
requireContract(packageJson.name === 'aka-biz-auto', 'Package name must stay aka-biz-auto for Electron userData continuity.')
requireContract(packageJson.build?.productName === 'akaAgent', 'Product name must be akaAgent.')
requireContract(nsis.oneClick === false, 'NSIS must use the assisted installer (oneClick=false).')
requireContract(nsis.perMachine === true, 'NSIS must install per-machine so x64 defaults to Program Files.')
requireContract(
  nsis.allowToChangeInstallationDirectory === true,
  'NSIS must allow choosing a custom installation directory.'
)
requireContract(nsis.deleteAppDataOnUninstall !== true, 'Updates/uninstalls must not opt into deleting app data.')
requireContract(nsis.shortcutName === 'akaAgent', 'Windows shortcut name must be akaAgent.')
requireContract(nsis.artifactName === 'akaAgent-Setup-${version}.${ext}', 'Windows artifact must use the akaAgent name.')

const forbiddenInstallerPatterns = [
  [/!macro\s+customInit\b/i, 'customInit must not mutate the existing installation before CHECK_APP_RUNNING.'],
  [/Delete\s+\/REBOOTOK/i, 'Installer must not schedule installed application files for reboot deletion.'],
  [/RMDir\s+\/r\s+["']?\$INSTDIR/i, 'Installer must not recursively delete $INSTDIR from a custom hook.'],
  [/DeleteRegKey[^\n]+INSTALL_REGISTRY_KEY/i, 'Installer must preserve electron-builder InstallLocation registry state.']
]

for (const [pattern, message] of forbiddenInstallerPatterns) {
  requireContract(!pattern.test(installerScript), message)
}

requireContract(
  /!if\s+"\$\{PRODUCT_NAME\}"\s*==\s*"akaAgent"/i.test(installerScript),
  'Desktop installer hooks must be compile-time scoped away from the Zalo Server package.'
)
requireContract(/!macro\s+customInstall\b/i.test(installerScript), 'Legacy shortcut cleanup must run only from customInstall.')
requireContract(
  /GetOptions[^\n]+--aka-source-pid=/i.test(installerScript) &&
    /WaitForSingleObject/i.test(installerScript),
  'Fixed-to-fixed installer must parse and wait for the exact updater source PID.'
)
requireContract(
  /!insertmacro\s+akaCloseIfRunning\s+"akaBizAuto\.exe"\s+"akaBizAuto"/i.test(installerScript),
  'Installer must automatically request the legacy akaBizAuto process to close.'
)
requireContract(
  !/akaCloseIfRunning\s+"\$\{APP_EXECUTABLE_FILENAME\}"/i.test(installerScript),
  'Fixed-to-fixed installer must never terminate akaAgent by image name.'
)
requireContract(
  /\$R3\s*==\s*"\$\{APP_EXECUTABLE_FILENAME\}"[\s\S]+Skipped akaAgent image-name guard because the installer itself/i.test(installerScript),
  'Legacy-named Setup must skip the akaAgent image-name guard so it cannot terminate itself.'
)
requireContract(
  !/\/F\s+\/IM|nsProcess::KillProcess/i.test(installerScript),
  'Installer must not force-kill the running desktop process.'
)
requireContract(
  /akaAgent-installer\.log/i.test(installerScript),
  'Installer must persist running-app guard diagnostics in the Windows temp directory.'
)
requireContract(/MUI_CUSTOMFUNCTION_ABORT\s+akaGuardInstallAbort/i.test(installerScript), 'Installer must guard against cancelling during file replacement.')
requireContract(/resources\\app\.asar/.test(installerScript), 'Installer must verify resources\\app.asar after extraction.')
requireContract(!/akaDeleteShortcut\s+"\$DESKTOP\\akaAgent\.lnk"/i.test(installerScript), 'Legacy cleanup must not delete the new akaAgent desktop shortcut.')

requireContract(
  /Start-Process\s+-FilePath/.test(updaterSource),
  'Windows updater must open the elevated Setup directly.'
)
requireContract(
  /-ArgumentList\s+@\('\-\-updated','--aka-source-pid=\$\{process\.pid\}'\)/.test(updaterSource),
  'Fixed-to-fixed updates must launch NSIS with --updated and the exact source PID.'
)
requireContract(
  /-Verb\s+RunAs/.test(updaterSource),
  'Per-machine updates must explicitly request UAC elevation.'
)
requireContract(
  /spawn\('powershell\.exe'/.test(updaterSource) && /'-Command',\s*\n\s*command/.test(updaterSource),
  'Windows updater must invoke only the direct one-line PowerShell launcher.'
)
requireContract(
  /windowsHide:\s*true/.test(updaterSource) && !/detached:\s*true/.test(updaterSource),
  'Direct Windows launcher must stay hidden and attached until Setup launch succeeds.'
)
requireContract(
  !/Wait-Process|Get-Process\s+-Name|-EncodedCommand|runWindowsInstallerAfterAppExits|spawn\(installerPath/.test(updaterSource),
  'Windows updater must not use a post-exit helper or spawn Setup with CreateProcess.'
)
requireContract(
  /quitAppAfterInstallerOpens\(0\)/.test(updaterSource),
  'Direct update flow must begin graceful quit immediately after elevated Setup opens.'
)
requireContract(
  /installerFilename:\s*'akaAgent-Setup\.exe'/.test(updaterSource),
  'Downloaded Setup filename must not collide with the installed akaAgent.exe process name.'
)

requireContract(
  /app\.getPath\(['"]userData['"]\)/.test(localDbSource),
  'Local SQLite data must remain under Electron userData, outside the installation directory.'
)

if (failures.length > 0) {
  console.error('Windows installer contract verification failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Windows installer contract verified.')
