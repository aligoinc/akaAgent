const { mkdtempSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawnSync } = require('child_process')
const { buildSync } = require('esbuild')

const root = resolve(__dirname, '..')
const temporary = mkdtempSync(join(tmpdir(), 'aka-device-smoke-'))
try {
  const output = join(temporary, 'smoke.cjs')
  buildSync({ entryPoints: [join(__dirname, 'device-change-smoke-test.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning' })
  const result = spawnSync(process.execPath, [output], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally { rmSync(temporary, { recursive: true, force: true }) }
