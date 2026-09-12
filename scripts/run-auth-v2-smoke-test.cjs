const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const temporary = mkdtempSync(join(tmpdir(), 'aka-auth-v2-smoke-'))
try {
  const output = join(temporary, 'smoke.cjs')
  buildSync({ entryPoints: [join(__dirname, 'auth-v2-smoke-test.ts')], outfile: output, bundle: true,
    platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning' })
  const result = spawnSync(process.execPath, [output], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally { rmSync(temporary, { recursive: true, force: true }) }
