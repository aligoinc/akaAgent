const { build } = require('esbuild')
const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve, extname } = require('node:path')
const { createServer } = require('node:http')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-drafts-ui-'))
  const root = resolve(__dirname, '..')
  await build({ entryPoints: [join(__dirname, 'campaign-drafts-ui-smoke.tsx')], outdir: directory,
    bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
  writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="/campaign-drafts-ui-smoke.css"><body><div id="root"></div><script src="/campaign-drafts-ui-smoke.js"></script></body></html>')
  const server = createServer((request, response) => {
    const path = request.url === '/' ? 'index.html' : request.url.slice(1).split('?')[0]
    if (!/^[a-zA-Z0-9._-]+$/.test(path)) { response.writeHead(404).end(); return }
    try {
      const data = readFileSync(join(directory, path))
      response.setHeader('Content-Type', extname(path) === '.js' ? 'application/javascript' : extname(path) === '.css' ? 'text/css' : 'text/html')
      response.end(data)
    } catch { response.writeHead(404).end() }
  })
  server.listen(0, '127.0.0.1', () => console.log(`Draft UI smoke: http://127.0.0.1:${server.address().port}`))
  const cleanup = () => { server.close(); rmSync(directory, { recursive: true, force: true }); process.exit(0) }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
