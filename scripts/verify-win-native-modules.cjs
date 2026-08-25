const { existsSync, readFileSync, readdirSync } = require('fs')
const { join, relative, resolve } = require('path')

const packageRoot = resolve(process.argv[2] || join('dist', 'win-unpacked'))

function listFiles(directory) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(fullPath))
    else if (entry.isFile()) files.push(fullPath)
  }
  return files
}

let failed = false

if (!existsSync(packageRoot)) {
  console.error(`Missing Windows package directory: ${packageRoot}`)
  process.exit(1)
}

const packagedFiles = listFiles(packageRoot)
const backupFiles = packagedFiles.filter(filePath => /host-backup/i.test(filePath))
for (const backupFile of backupFiles) {
  console.error(`Unexpected host native backup in Windows package: ${relative(packageRoot, backupFile)}`)
  failed = true
}

const expectedExecutable = join(packageRoot, 'akaAgent.exe')
const legacyExecutable = join(packageRoot, 'akaBizAuto.exe')
if (!existsSync(expectedExecutable)) {
  console.error(`Missing renamed Windows application executable: ${relative(packageRoot, expectedExecutable)}`)
  failed = true
} else {
  console.log(`Verified Windows application executable: ${relative(packageRoot, expectedExecutable)}`)
}
if (existsSync(legacyExecutable)) {
  console.error(`Unexpected legacy Windows application executable: ${relative(packageRoot, legacyExecutable)}`)
  failed = true
}

const requiredRuntimeFiles = [
  join(packageRoot, 'resources', 'app.asar'),
  join(packageRoot, 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'package.json'),
  join(
    packageRoot,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'playwright',
    'node_modules',
    'playwright-core',
    'package.json'
  ),
  join(packageRoot, 'resources', 'app.asar.unpacked', 'node_modules', 'quickjs-wasi', 'package.json')
]

for (const requiredFile of requiredRuntimeFiles) {
  if (!existsSync(requiredFile)) {
    console.error(`Missing required Windows runtime file: ${relative(packageRoot, requiredFile)}`)
    failed = true
  } else {
    console.log(`Verified Windows runtime file: ${relative(packageRoot, requiredFile)}`)
  }
}

const nativeModules = packagedFiles.filter(filePath => filePath.endsWith('.node'))
if (nativeModules.length === 0) {
  console.error(`No native modules found in Windows package: ${packageRoot}`)
  failed = true
}

for (const fullPath of nativeModules) {
  const relativePath = relative(packageRoot, fullPath)
  const content = readFileSync(fullPath)
  if (content.length < 64 || content.subarray(0, 2).toString('ascii') !== 'MZ') {
    console.error(`Invalid Windows native module: ${relativePath}`)
    console.error('Expected a PE/MZ x64 module.')
    failed = true
    continue
  }

  const peOffset = content.readUInt32LE(0x3c)
  if (
    peOffset + 6 > content.length ||
    content.subarray(peOffset, peOffset + 4).toString('binary') !== 'PE\u0000\u0000'
  ) {
    console.error(`Invalid Windows native module: ${relativePath}`)
    console.error('PE signature is missing or truncated.')
    failed = true
    continue
  }

  const machine = content.readUInt16LE(peOffset + 4)
  if (machine !== 0x8664) {
    console.error(`Invalid Windows native module architecture: ${relativePath}`)
    console.error(`Expected PE x64 machine 0x8664, got 0x${machine.toString(16)}.`)
    failed = true
    continue
  }

  console.log(`Verified Windows x64 native module: ${relativePath}`)
}

if (failed) process.exit(1)
