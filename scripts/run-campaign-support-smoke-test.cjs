const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const directory = mkdtempSync(join(tmpdir(), 'akaagent-support-smoke-'))
try {
  const output = join(directory, 'smoke.cjs')
  buildSync({ entryPoints: [resolve(__dirname, 'campaign-support-smoke-test.ts')], outfile: output,
    bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning' })
  const result = spawnSync(process.execPath, [output], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
  if (process.exitCode === 0) {
    const access = spawnSync(process.execPath, [join(__dirname, 'run-campaign-support-access-smoke-test.cjs')], { stdio: 'inherit' })
    if (access.error) throw access.error
    process.exitCode = access.status ?? 1
  }
  if (process.exitCode === 0) {
    const imageOutput = join(directory, 'images.cjs')
    buildSync({ entryPoints: [resolve(__dirname, 'campaign-support-image-smoke-test.ts')], outfile: imageOutput,
      bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['electron'], logLevel: 'warning' })
    const environment = { ...process.env, AKA_AGENT_SUPPORT_SMOKE_DIRECTORY: join(directory, 'electron-profile') }
    delete environment.ELECTRON_RUN_AS_NODE
    const images = spawnSync(require('electron'), [imageOutput], { env: environment, stdio: 'inherit', timeout: 30_000 })
    if (images.error) throw images.error
    process.exitCode = images.status ?? 1
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
