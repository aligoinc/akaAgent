// Cụm PostgreSQL dùng một lần cho bộ kiểm V679 / V680. Chạy được cả khi tiến trình là root (initdb chạy bằng user postgres).
// Module pg: PG_MODULE_DIR trỏ tới thư mục có node_modules/pg (mặc định thử repo và akaAgentChatApi bên cạnh).
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
function requirePg() {
  const dirs = [process.env.PG_MODULE_DIR, ROOT, path.resolve(ROOT, '../akaAgentChatApi')].filter(Boolean)
  for (const dir of dirs) { try { return require(require.resolve('pg', { paths: [dir] })) } catch { /* thử tiếp */ } }
  throw new Error('Không tìm thấy module pg; đặt PG_MODULE_DIR')
}
const { Client } = requirePg()
const BIN = process.env.PG_BIN || ['/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin', '/opt/homebrew/opt/postgresql@17/bin']
  .find(dir => fs.existsSync(path.join(dir, 'initdb')))
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

function run(cmd, args) {
  const full = isRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args]
  const r = spawnSync(full[0], full[1], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })
  if (r.status !== 0) throw new Error(`${cmd} lỗi: ${r.stderr || r.stdout}`)
  return r.stdout
}

async function startCluster() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'uidguard-pg-'))
  const data = path.join(base, 'data')
  if (isRoot) { fs.chmodSync(base, 0o777); spawnSync('chown', ['postgres', base]) }
  run(path.join(BIN, 'initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'])
  const port = 20000 + Math.floor(Math.random() * 20000)
  run(path.join(BIN, 'pg_ctl'), ['-D', data, '-w', '-l', path.join(base, 'log'), '-o',
    `-p ${port} -k ${base} -c listen_addresses='' -c fsync=off -c synchronous_commit=off -c full_page_writes=off`, 'start'])
  const stop = () => {
    try { run(path.join(BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop']) } catch { /* đã dừng */ }
    try { fs.rmSync(base, { recursive: true, force: true }) } catch { /* bỏ qua */ }
  }
  process.on('exit', stop)
  const connect = async () => { const c = new Client({ host: base, port, user: 'postgres', database: 'postgres' }); await c.connect(); return c }
  return { base, port, connect, stop }
}

module.exports = { startCluster, Client, ROOT }
