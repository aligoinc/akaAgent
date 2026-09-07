const { mkdtempSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { join, resolve } = require('path')
const { spawnSync } = require('child_process')
const { build } = require('esbuild')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-login-content-'))
  try {
    const outputFile = join(directory, 'smoke.cjs')
    await build({
      entryPoints: [join(root, 'scripts/login-screen-content-smoke-test.ts')],
      outfile: outputFile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning',
      plugins: [{
        name: 'isolated-login-dependencies',
        setup(plugin) {
          plugin.onResolve({ filter: /(^electron$|\/supabaseClient$)/ }, args => ({ path: args.path, namespace: 'login-smoke' }))
          plugin.onLoad({ filter: /.*/, namespace: 'login-smoke' }, args => ({
            contents: args.path === 'electron'
              ? 'export const ipcMain = { handle: (key, handler) => globalThis.loginSmokeHandlers.set(key, handler) }'
              : 'export const getSupabaseClient = () => globalThis.loginSmokeClient',
            loader: 'js'
          }))
        }
      }]
    })
    const result = spawnSync(process.execPath, [outputFile], { cwd: root, stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
