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

requireContract(/!macro\s+customInstall\b/i.test(installerScript), 'Legacy shortcut cleanup must run only from customInstall.')
requireContract(/!insertmacro\s+_CHECK_APP_RUNNING/i.test(installerScript), 'Installer must retain the standard app-running guard.')
requireContract(/FIND_PROCESS\s+"akaBizAuto\.exe"/i.test(installerScript), 'Installer must also guard the legacy akaBizAuto.exe process.')
requireContract(/MUI_CUSTOMFUNCTION_ABORT\s+akaGuardInstallAbort/i.test(installerScript), 'Installer must guard against cancelling during file replacement.')
requireContract(/resources\\app\.asar/.test(installerScript), 'Installer must verify resources\\app.asar after extraction.')
requireContract(!/akaDeleteShortcut\s+"\$DESKTOP\\akaAgent\.lnk"/i.test(installerScript), 'Legacy cleanup must not delete the new akaAgent desktop shortcut.')

requireContract(
  /Wait-Process\s+-Id\s+\$sourcePid/.test(updaterSource),
  'Windows update helper must wait for the current app PID to exit.'
)
requireContract(
  /Get-Process\s+-Name\s+\$sourceProcessName/.test(updaterSource),
  'Windows update helper must wait for every remaining app process.'
)
requireContract(
  /ArgumentList\s+@\('--updated'\)/.test(updaterSource),
  'Fixed-to-fixed updates must launch NSIS with --updated so InstallLocation is reused.'
)
requireContract(!/quitAppAfterInstallerOpens/.test(updaterSource), 'Windows updater must not use the legacy 1.5-second launch race.')
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
