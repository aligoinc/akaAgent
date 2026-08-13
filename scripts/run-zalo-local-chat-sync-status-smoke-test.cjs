const { mkdtempSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawnSync } = require('child_process')
const { buildSync } = require('esbuild')

const projectRoot = resolve(__dirname, '..')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'akaagent-local-chat-status-'))
const outputFile = join(temporaryDirectory, 'zalo-local-chat-sync-status-smoke-test.cjs')

try {
  buildSync({
    entryPoints: [join(projectRoot, 'scripts', 'zalo-local-chat-sync-status-smoke-test.ts')],
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
