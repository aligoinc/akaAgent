const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { build } = require('esbuild')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-chat-web-'))
  try {
    const certificate = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(directory, 'key.pem'), '-out', join(directory, 'cert.pem'), '-days', '1', '-subj', '/CN=localhost'],
    { stdio: 'ignore' })
    if (certificate.status !== 0) throw new Error('The Electron smoke test requires openssl for its local HTTPS fixture.')
    writeFileSync(join(directory, 'preload.cjs'), `
      const { contextBridge, ipcRenderer } = require('electron');
      let latest = null;
      ipcRenderer.on('chat-web:state', (_, state) => { latest = state; });
      contextBridge.exposeInMainWorld('smoke', {
        prepare: () => ipcRenderer.invoke('chat-web:prepare'),
        reload: () => ipcRenderer.invoke('chat-web:reload'),
        state: () => latest
      });
      contextBridge.exposeInMainWorld('electronAPI', {
        prepareChatWeb: () => ipcRenderer.invoke('chat-web:prepare'),
        reloadChatWeb: () => ipcRenderer.invoke('chat-web:reload'),
        onChatWebState: callback => {
          const handler = (_, state) => callback(state);
          ipcRenderer.on('chat-web:state', handler);
          return () => ipcRenderer.removeListener('chat-web:state', handler);
        }
      });
    `)
    await build({
      entryPoints: [join(root, 'scripts/chat-web-smoke-renderer.tsx')],
      outfile: join(directory, 'renderer.js'), bundle: true, platform: 'browser', format: 'esm',
      jsx: 'automatic', logLevel: 'warning',
      plugins: [{
        name: 'local-brand-image',
        setup(builder) {
          builder.onLoad({ filter: /TopBar\.tsx$/ }, ({ path }) => ({
            contents: readFileSync(path, 'utf8').replace(
              "new URL('../../assets/app-icon.png', import.meta.url).href",
              JSON.stringify(require('node:url').pathToFileURL(join(root, 'src/renderer/src/assets/app-icon.png')).href)
            ), loader: 'tsx', resolveDir: resolve(path, '..')
          }))
        }
      }]
    })
    await build({
      entryPoints: [join(root, 'scripts/chat-web-smoke-test.ts')],
      outfile: join(directory, 'test.cjs'), bundle: true, platform: 'node', format: 'cjs',
      target: 'node20', external: ['electron'], logLevel: 'warning',
      plugins: [{
        name: 'local-chat-fixture-only',
        setup(builder) {
          builder.onLoad({ filter: /chatWebService\.ts$/ }, ({ path }) => {
            const source = readFileSync(path, 'utf8')
            const constant = "const CHAT_URL = 'https://chat.akabiz.biz/'"
            if (!source.includes(constant)) throw new Error('Chat URL fixture replacement needs updating.')
            return { contents: source.replace(constant, 'const CHAT_URL = process.env.AKA_AGENT_CHAT_SMOKE_URL!'), loader: 'ts', resolveDir: resolve(path, '..') }
          })
        }
      }]
    })
    const environment = { ...process.env, AKA_AGENT_CHAT_SMOKE_DIRECTORY: directory }
    delete environment.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [join(directory, 'test.cjs')], {
      cwd: root, env: environment, stdio: 'inherit', timeout: 120_000
    })
    if (result.error) throw result.error
    process.exitCode = result.status ?? 1
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
