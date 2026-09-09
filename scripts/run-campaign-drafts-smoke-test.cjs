const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-drafts-smoke-'))
  try {
    const output = join(directory, 'smoke.cjs')
    await build({ entryPoints: [join(__dirname, 'campaign-drafts-smoke-test.ts')], outfile: output,
      bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning',
      plugins: [{ name: 'draft-isolated-dependencies', setup(plugin) {
        plugin.onResolve({ filter: /(?:supabaseClient|accountRepository|entitlementRepository)$/ },
          args => ({ path: args.path.split('/').pop(), namespace: 'draft-mock' }))
        plugin.onLoad({ filter: /.*/, namespace: 'draft-mock' }, args => ({
          contents: args.path === 'supabaseClient'
            ? 'export const getSupabaseClient = () => ({ rpc: (...args) => globalThis.draftSmoke.rpc(...args) })'
            : `export const ${args.path === 'accountRepository' ? 'getAccount' : 'ensureCurrentUserCanUseCampaignAction'} = (...args) => globalThis.draftSmoke.${args.path === 'accountRepository' ? 'getAccount' : 'ensureCurrentUserCanUseCampaignAction'}(...args)`,
          loader: 'js'
        }))
      } }]
    })
    const result = spawnSync(process.execPath, [output], { cwd: root, stdio: 'inherit' })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
