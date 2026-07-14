const { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { dirname, join, resolve } = require('path')
const { spawnSync } = require('child_process')

const projectRoot = resolve(__dirname, '..')
const betterSqliteDir = join(projectRoot, 'node_modules', 'better-sqlite3')
const betterSqliteNativePath = join(betterSqliteDir, 'build', 'Release', 'better_sqlite3.node')
const nativeBackupDir = mkdtempSync(join(tmpdir(), 'akabiz-mac-intel-native-'))
const betterSqliteBackupPath = join(nativeBackupDir, 'better_sqlite3.node')
const intelAppPath = join(projectRoot, 'dist', 'mac', 'akaBizAuto.app')
const intelExecutablePath = join(intelAppPath, 'Contents', 'MacOS', 'akaBizAuto')
const packagedNativePath = join(
  intelAppPath,
  'Contents',
  'Resources',
  'app.asar.unpacked',
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node'
)
let nativePreparationStarted = false

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
    throw new Error('Cannot read installed Electron version. Run npm ci before npm run build:mac:intel.')
  }
}

function assertArchitecture(filePath, expectedArchitecture) {
  if (!existsSync(filePath)) throw new Error(`Missing Mach-O file: ${filePath}`)
  const result = spawnSync('lipo', ['-archs', filePath], {
    cwd: projectRoot,
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Cannot inspect architecture for ${filePath}: ${String(result.stderr || '').trim()}`)
  }
  const architectures = String(result.stdout || '').trim().split(/\s+/).filter(Boolean)
  if (!architectures.includes(expectedArchitecture)) {
    throw new Error(
      `Expected ${expectedArchitecture} at ${filePath}, got ${architectures.join(', ') || 'unknown'}.`
    )
  }
  console.log(`Verified ${expectedArchitecture}: ${filePath}`)
}

function prepareIntelNativeModule() {
  if (!existsSync(betterSqliteDir)) {
    throw new Error('Missing node_modules/better-sqlite3. Run npm ci before npm run build:mac:intel.')
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
    'darwin',
    '--arch',
    'x64',
    '--force'
  ], { cwd: betterSqliteDir })
  assertArchitecture(betterSqliteNativePath, 'x86_64')
}

function restoreHostNativeModule() {
  try {
    if (!nativePreparationStarted) return
    if (existsSync(betterSqliteBackupPath)) {
      copyFileSync(betterSqliteBackupPath, betterSqliteNativePath)
      console.log('Restored host better-sqlite3 native module.')
      return
    }
    rmSync(betterSqliteNativePath, { force: true })
  } finally {
    rmSync(nativeBackupDir, { recursive: true, force: true })
  }
}

function cleanIntelDist() {
  const distDir = join(projectRoot, 'dist')
  for (const pathToRemove of [
    join(distDir, 'mac'),
    join(distDir, 'akaAgentIntel.dmg'),
    join(distDir, 'akaAgentIntel.dmg.blockmap')
  ]) {
    rmSync(pathToRemove, { recursive: true, force: true })
  }
}

try {
  cleanIntelDist()
  run(command('npm'), ['run', 'build'])
  prepareIntelNativeModule()
  run(command('npx'), [
    'electron-builder',
    '--mac',
    'dir',
    '--x64',
    '--config.mac.identity=null',
    '--config.npmRebuild=false',
    '--publish',
    'never'
  ])
  assertArchitecture(intelExecutablePath, 'x86_64')
  assertArchitecture(packagedNativePath, 'x86_64')
  run(process.execPath, [join(projectRoot, 'scripts', 'sign-mac-adhoc.cjs'), intelAppPath])
  run(command('npx'), [
    'electron-builder',
    '--mac',
    'dmg',
    '--x64',
    '--prepackaged',
    join('dist', 'mac'),
    '--config.mac.identity=null',
    "--config.mac.artifactName=akaAgentIntel.${ext}",
    '--publish',
    'never'
  ])
} finally {
  restoreHostNativeModule()
}
