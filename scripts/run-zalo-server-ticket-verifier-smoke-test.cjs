const { mkdtempSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawnSync } = require('child_process')
const { buildSync } = require('esbuild')

const projectRoot = resolve(__dirname, '..')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'akaagent-ticket-verifier-'))
const outputFile = join(temporaryDirectory, 'zalo-server-ticket-verifier-smoke-test.cjs')

try {
  buildSync({
    entryPoints: [join(projectRoot, 'scripts', 'zalo-server-ticket-verifier-smoke-test.ts')],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'warning'
  })
  const result = spawnSync(process.execPath, [outputFile], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error) throw result.error
  process.exitCode = result.status === null ? 1 : result.status
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true })
}
