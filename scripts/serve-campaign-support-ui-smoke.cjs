const { mkdtempSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { createServer } = require('node:http')
const { buildSync } = require('esbuild')
const directory = mkdtempSync(join(tmpdir(), 'akaagent-support-ui-'))
buildSync({ entryPoints: [join(__dirname, 'campaign-support-ui-smoke.tsx')], outdir: directory,
  bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
  define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning' })
writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Trợ lý AI — smoke</title><link rel="stylesheet" href="campaign-support-ui-smoke.css"><body><div id="root"></div><script src="campaign-support-ui-smoke.js"></script></body></html>')
const allowed = { '/': ['index.html', 'text/html'], '/campaign-support-ui-smoke.css': ['campaign-support-ui-smoke.css', 'text/css'],
  '/campaign-support-ui-smoke.js': ['campaign-support-ui-smoke.js', 'text/javascript'] }
const server = createServer((request, response) => {
  const file = allowed[request.url]
  if (!file) { response.writeHead(404); response.end(); return }
  response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' })
  response.end(readFileSync(join(directory, file[0])))
})
const port = Number(process.env.CAMPAIGN_SUPPORT_SMOKE_PORT || 4183)
server.listen(port, '127.0.0.1', () => console.log(`Campaign support UI smoke: http://127.0.0.1:${port}`))
const stop = () => server.close(() => { rmSync(directory, { recursive: true, force: true }); process.exit() })
process.on('SIGINT', stop); process.on('SIGTERM', stop)
