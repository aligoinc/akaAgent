// Đóng gói scripts/zalo-chat-realtime-only-smoke-test.ts bằng esbuild rồi chạy bằng Node (như smoke quét data của Chat).
const { mkdtempSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawnSync } = require('child_process')
const { buildSync } = require('esbuild')

const projectRoot = resolve(__dirname, '..')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'akaagent-chat-realtime-only-'))
const outputFile = join(temporaryDirectory, 'zalo-chat-realtime-only-smoke-test.cjs')

try {
  buildSync({
    entryPoints: [join(projectRoot, 'scripts', 'zalo-chat-realtime-only-smoke-test.ts')],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'warning',
    external: ['electron', 'bufferutil', 'utf-8-validate']
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
