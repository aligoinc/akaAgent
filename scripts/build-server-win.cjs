const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { dirname, join, resolve } = require('path')
const { spawnSync } = require('child_process')

const projectRoot = resolve(__dirname, '..')
const betterSqliteDir = join(projectRoot, 'node_modules', 'better-sqlite3')
const betterSqliteNativePath = join(betterSqliteDir, 'build', 'Release', 'better_sqlite3.node')
const nativeBackupDir = mkdtempSync(join(tmpdir(), 'aka-zalo-server-win-native-'))
const betterSqliteBackupPath = join(nativeBackupDir, 'better_sqlite3.node')
let nativePreparationStarted = false
const serverDistDir = join(projectRoot, 'dist-server')
const serverMainPath = join(projectRoot, 'out-server', 'main', 'index.js')
const packagedNativePath = join(
  serverDistDir,
  'win-unpacked',
  'resources',
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
)

function command(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

function run(cmd, args, options = {}) {
  console.log(`> ${cmd} ${args.join(' ')}`)
  const result = spawnSync(cmd, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    ...options
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${result.status}`)
  }
}

function getElectronVersion() {
  try {
    return require(join(projectRoot, 'node_modules', 'electron', 'package.json')).version
  } catch {
    throw new Error('Cannot read installed Electron version. Run npm ci before npm run build:server:win.')
  }
}

function getAppVersion() {
  return require(join(projectRoot, 'package.json')).version
}

function readHeader(filePath) {
  return readFileSync(filePath).subarray(0, 2).toString('ascii')
}

function assertWindowsNativeModule(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing native module: ${filePath}`)
  }

  const header = readHeader(filePath)
  if (header !== 'MZ') {
    throw new Error(`Expected Windows PE/MZ native module at ${filePath}, got ${JSON.stringify(header)}.`)
  }
}

function prepareWindowsNativeModules() {
  if (!existsSync(betterSqliteDir)) {
    throw new Error('Missing node_modules/better-sqlite3. Run npm ci before npm run build:server:win.')
  }

  nativePreparationStarted = true
  if (existsSync(betterSqliteNativePath)) {
    copyFileSync(betterSqliteNativePath, betterSqliteBackupPath)
  }

  mkdirSync(dirname(betterSqliteNativePath), { recursive: true })
  run(command('npx'), [
    'prebuild-install',
    '--runtime',
    'electron',
    '--target',
    getElectronVersion(),
    '--platform',
    'win32',
    '--arch',
    'x64',
    '--force'
  ], { cwd: betterSqliteDir })

  assertWindowsNativeModule(betterSqliteNativePath)
  console.log('Prepared better-sqlite3 Windows x64 native module for server packaging.')
}

function restoreHostNativeModules() {
  try {
    if (!nativePreparationStarted) return
    if (existsSync(betterSqliteBackupPath)) {
      copyFileSync(betterSqliteBackupPath, betterSqliteNativePath)
      console.log('Restored host better-sqlite3 native module.')
      return
    }

    if (existsSync(betterSqliteNativePath) && process.platform !== 'win32') {
      rmSync(betterSqliteNativePath, { force: true })
    }
  } finally {
    rmSync(nativeBackupDir, { recursive: true, force: true })
  }
}

function cleanServerWindowsDist() {
  const appVersion = getAppVersion()
  const paths = [
    join(serverDistDir, 'win-unpacked'),
    join(serverDistDir, 'win-ia32-unpacked'),
    join(serverDistDir, 'win-arm64-unpacked'),
    join(serverDistDir, 'builder-debug.yml'),
    join(serverDistDir, 'builder-effective-config.yaml'),
    join(serverDistDir, 'latest.yml'),
    join(serverDistDir, `akaAgent-Zalo-Server-Setup-${appVersion}.exe`)
  ]

  for (const pathToRemove of paths) {
    rmSync(pathToRemove, { recursive: true, force: true })
  }
}

function assertServerBuildOutput() {
  if (!existsSync(serverMainPath)) {
    throw new Error(`Missing server main build output: ${serverMainPath}`)
  }
}

try {
  cleanServerWindowsDist()
  run(command('npm'), ['run', 'build:server'])
  assertServerBuildOutput()
  prepareWindowsNativeModules()
  run(command('npx'), [
    'electron-builder',
    '--win',
    '--x64',
    '--config',
    'electron-builder.server.yml',
    '--publish',
    'never'
  ])
  assertWindowsNativeModule(packagedNativePath)
  run(process.execPath, [
    join(projectRoot, 'scripts', 'verify-win-native-modules.cjs'),
    join('dist-server', 'win-unpacked'),
    'akaAgent Zalo Server.exe',
    'server'
  ])
  console.log('Verified packaged better-sqlite3 Windows x64 native module for akaAgent Zalo Server.')
} finally {
  restoreHostNativeModules()
}
