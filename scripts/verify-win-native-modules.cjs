const { existsSync, readFileSync } = require('fs')
const { join } = require('path')

const nativeModules = [
  join('dist', 'win-unpacked', 'resources', 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
]

let failed = false

for (const relativePath of nativeModules) {
  const fullPath = join(process.cwd(), relativePath)
  if (!existsSync(fullPath)) {
    console.error(`Missing native module: ${relativePath}`)
    failed = true
    continue
  }

  const header = readFileSync(fullPath).subarray(0, 2).toString('ascii')
  if (header !== 'MZ') {
    console.error(`Invalid Windows native module: ${relativePath}`)
    console.error(`Expected PE/MZ header, got ${JSON.stringify(header)}.`)
    failed = true
    continue
  }

  console.log(`Verified Windows native module: ${relativePath}`)
}

if (failed) process.exit(1)

